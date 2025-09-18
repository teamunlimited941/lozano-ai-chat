// server/index.js
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------- Create app ----------
const app = Fastify({ logger: true });

// ---------- Static: serve /widget.js ----------
app.register(fastifyStatic, {
  root: join(__dirname, "public"),
  prefix: "/",
  cacheControl: true,
});

// ---------- Health ----------
app.get("/health", async () => ({ ok: true, ts: Date.now() }));

// ---------- CORS (for WP) ----------
app.addHook("onRequest", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  reply.header("Access-Control-Allow-Headers", "Content-Type, x-widget-signature");
});
app.options("/*", async (_req, reply) => reply.code(204).send());

// ---------- Diag ----------
app.get("/diag", async () => ({
  ok: true,
  openaiKeyDetected: !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith("sk-"),
  port: Number(process.env.PORT || 8080),
}));

// ---------- Helpers ----------
function detectProject(text) {
  if (/\bdeck(s)?\b/.test(text)) return "deck";
  if (/\bkitchen(s)?\b/.test(text)) return "kitchen";
  if (/\bbath(room|s)?\b/.test(text)) return "bath";
  if (/\b(roof|roofing|soffit|fascia)\b/.test(text)) return "roofing";
  if (/\bconcrete\b/.test(text)) return "concrete";
  if (/\baddition\b/.test(text)) return "addition";
  if (/\bnew (house|build)|custom home|site prep|site-prep|clearing\b/.test(text)) return "new_home";
  return "unknown";
}

function extractLeadFields(messages = []) {
  const text = messages.map(m => (m?.content || "")).join("\n ").toLowerCase();

  const emailMatch = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  const phoneMatch = text.match(/\+?1?[\s\-\.]?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}\b/);
  const zipMatch   = text.match(/\b\d{5}(?:-\d{4})?\b/);
  const addrMatch  = text.match(/\b\d{1,6}\s+([a-z0-9.'-]+\s)+(st|street|ave|avenue|rd|road|dr|drive|blvd|lane|ln|ct|court|trail|trl|way)\b/i);
  const nameGiven  = /\b(my name is|i'?m|this is)\s+[a-z]{2,}\s+[a-z]{2,}\b/i.test(text);

  const project = detectProject(text);
  const timeline = /\b(asap|soon|this week|next week|month|couple of|in \d+ (days|weeks|months))\b/i.test(text);
  const plans = /\b(plan|plans|blueprint|design|drawings|architect)\b/i.test(text);
  const budget = /\b(\$?\d{2,}(?:,\d{3})*(?:\.\d{2})?\s*(k|grand)?|budget)\b/i.test(text);

  return {
    hasName: nameGiven,
    hasPhone: !!phoneMatch,
    hasEmail: !!emailMatch,
    hasAddress: !!addrMatch || !!zipMatch,
    project,
    hasTimeline: timeline,
    hasPlans: plans,
    hasBudget: budget
  };
}

// ---------- Martha’s brain (multilingual) ----------
const systemPrompt = `
You are Martha, Lozano Construction’s AI Receptionist/Assistant (FL GC: CGC1532629).

Mission:
- Be quick, helpful, lightly witty, and professional.
- Sound like a friendly neighbor who happens to be a pro builder.
- Always answer first; then ask ONE follow-up to guide toward scheduling (by consent).

Language behavior:
- Detect the user's language from their last message.
- Reply in the user's language.
- Also produce an English log string for the office CRM/Sheet.

Tone:
- Confident, concise, positive. A dash of wit if it helps rapport.
- Adapt style: Driver → fast & direct, Analytical → step-by-step, Amiable → warm, Expressive → upbeat.

Rules:
- One follow-up question per turn.
- Greeting guard: if they just say “hi/hello”, greet back and ask what they need.
- General flow: greet → ask what they need → Name+Phone → Project specifics → Rapport → Address → Timeline → Plans → Budget → Offer 2 slots (only if they’re ready & willing; respect any day they mention) → Email last.
- Never ask for more than one detail at once.
- Never invent prices or availability.
- If user declines contact or scheduling, respect it and keep helping.

Output STRICT JSON:
{
  "message": "<ONE short friendly bubble in the user's language>",
  "language": "<ISO 639-1 language code, e.g., en, es>",
  "english_log": "<clean English summary of what was said this turn and any key details collected>",
  "scratchpad": { "intent": "...", "style_guess": "...", "confidence": 0.0, "next_step": "...", "pain_point": "...", "solution_given": "...", "followup_due": "..." }
}
`;

// ---------- Chat endpoint (greeting guard + consent-based scheduling + multilingual) ----------
app.post("/api/chat", async (req, reply) => {
  try {
    const { messages = [], url } = req.body || {};
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      return reply.send({
        answer: "Hi there! How can I help today—new project, repair, or something you’re planning?",
        persisted: false,
        meta: { language: "en", english_log: "No key set; default greeting." }
      });
    }

    // Greeting guard inputs
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    const lastText = (lastUser?.content || "").toString().trim();
    const isGreeting = /\b(hi|hello|hey|hola|buenas|good (morning|afternoon|evening))\b/i.test(lastText);
    const turns = messages.filter(m => m.role === "user").length;

    // Aggregate text
    const textAll = messages.map(m => String(m?.content || "")).join("\n ").toLowerCase();

    // Refusals & privacy intent
    const refusals = (textAll.match(/\b(no|not yet|don'?t want|won'?t|can'?t|prefer not)\b/g) || []).length;
    const userSaidNoToSchedule = /\b(no|not now|not yet|can'?t|won'?t|i (can'?t|told you))\b.*\b(schedule|wednesday|friday|time|appointment|book|meeting)\b/i.test(textAll);
    const userSaidNoToContact  = /\b(no|not now|not yet|later|privacy)\b.*\b(phone|number|email|contact)\b/i.test(textAll);

    // Availability hints (e.g., Monday morning)
    const availability = (() => {
      const day = (textAll.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b/i) || [])[0];
      const tod = (textAll.match(/\b(morning|afternoon|evening|night|am|pm|mañana|tarde|noche)\b/i) || [])[0];
      return { day: day ? day.toLowerCase() : null, tod: tod ? tod.toLowerCase() : null };
    })();

    // Lead extraction
    const lead = extractLeadFields(messages);

    // Consent to offer slots
    const userAskedToSchedule = /\b(schedule|book|set (a )?time|appointment|meet|estimate|quote|agendar|cita|programar)\b/i.test(textAll);
    const allowedToOfferSlots =
      userAskedToSchedule ||
      (lead.hasAddress && lead.hasTimeline && lead.hasPlans && lead.hasBudget && refusals < 2 && !userSaidNoToSchedule);

    // Decide the next step (ONE question), with greeting guard
    let nextGoal = "ask_project"; // default
    if (isGreeting || turns <= 1) {
      nextGoal = "ask_project"; // greet back → ask what they need
    } else {
      if (!lead.hasName || !lead.hasPhone) nextGoal = userSaidNoToContact ? "ask_project" : "ask_name_phone";
      else if (lead.project === "unknown") nextGoal = "ask_project";
      else if (!lead.hasAddress) nextGoal = "ask_address";
      else if (!lead.hasTimeline) nextGoal = "ask_timeline";
      else if (!lead.hasPlans) nextGoal = "ask_plans";
      else if (!lead.hasBudget) nextGoal = "ask_budget";
      else if (allowedToOfferSlots) nextGoal = "offer_slots";
      else if (!lead.hasEmail) nextGoal = "ask_email";
      else nextGoal = "value_add";
    }

    // If user declined scheduling, don’t push slots; soften email ask
    if (refusals >= 2 || userSaidNoToSchedule) {
      if (nextGoal === "offer_slots") nextGoal = !lead.hasEmail ? "ask_email_soft" : "value_add";
    }
    if (userSaidNoToContact) {
      if (nextGoal === "ask_name_phone" || nextGoal === "ask_email") nextGoal = "ask_project";
    }

    // Guidance for the model
    const availabilityHint = availability.day
      ? `User mentioned availability: ${availability.day}${availability.tod ? " (" + availability.tod + ")" : ""}. Prefer offering that day/time.`
      : `If offering slots, suggest two options that match typical windows; if user named a day (e.g., Monday / Lunes), prefer that.`;

    const guidance = `
Use light, tasteful wit only if it helps rapport. Be fast and professional.
Ask EXACTLY ONE follow-up this turn.

LANGUAGE RULE (strict):
- Detect the language from the MOST RECENT user message only.
- If the user switches languages mid-chat, IMMEDIATELY switch your reply to that new language.
- Do not translate the user's text; just respond in their language. Also produce the English log string.
- Never rush. Always confirm one piece of info at a time and build rapport before asking the next.
- Adapt follow-ups depending on the project type (kitchen, bath, deck, etc.), like a real consultant.
- Scheduling is only offered when the user is clearly ready.

nextGoal=${nextGoal}
${availabilityHint}
User refusals so far: ${refusals}. If they refused scheduling, do NOT push slots—ask permission first or keep helping.
Never ask for more than one detail at once. Never contradict stated availability.
`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Few-shot (includes greeting behavior)
    const fewshot = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: JSON.stringify({
          message: "Hi there! How can I help today—new project, repair, or something you’re planning?",
          language: "en",
          english_log: "Greeted visitor and asked what they need.",
          scratchpad: { next_step: "ask_project" }
        })
      },
      { role: "user", content: "¿Hacen terrazas?" },
      { role: "assistant", content: JSON.stringify({
          message: "¡Claro! Nos encantan las terrazas. ¿Cuál es tu nombre y el mejor número por si se corta la llamada?",
          language: "es",
          english_log: "Confirmed we build decks; asked for name and best phone.",
          scratchpad: { next_step: "ask_name_phone" }
        })
      }
    ];

    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...fewshot,
      { role: "system", content: guidance },
      ...messages.map(m => ({ role: m.role, content: String(m.content || "") })),
      { role: "system", content: `Page: ${url || "unknown"}` },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      temperature: 0.45,
      response_format: { type: "json_object" },
      max_tokens: 480,
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = { message: String(raw || "").trim() }; }

    let answer = (parsed && typeof parsed.message === "string" && parsed.message.trim())
      ? parsed.message.trim()
      : "Happy to help—what would you like to tackle first?";

    // Keep it one question; pick single fallback by goal
    const qCount = (answer.match(/\?/g) || []).length;
    if (qCount >= 2 && !["offer_slots"].includes(nextGoal)) {
      const single = {
        ask_project: "Tell me a bit about the project—what are you planning?",
        ask_name_phone: "What’s your name, and the best number in case we get disconnected?",
        ask_address: "What’s the full address (street, city, state, ZIP)?",
        ask_timeline: "How soon are you hoping to start?",
        ask_plans: "Do you already have plans or designs?",
        ask_budget: "Do you have a rough budget range in mind?",
        ask_email: "What’s a good email for estimates and reports?",
        ask_email_soft: "If you’d like, I can send a follow-up—what’s a good email, or we can keep chatting here.",
        offer_slots: availability.day
          ? `Would ${availability.day} ${availability.tod ? availability.tod : "morning"} work, or do you prefer ${availability.day} ${availability.tod ? "later" : "afternoon"}?`
          : "Would Monday morning or Monday afternoon work better?",
        value_add: "What would you like to sort out next—design, permitting, or timeline?"
      }[nextGoal] || "What would you like to tackle first?";
      answer = single;
    }

    // Respect refusal and availability hints
    if ((userSaidNoToSchedule || refusals >= 2) && /schedule|book|appointment|time|meet|cita|agendar/i.test(answer)) {
      answer = availability.day
        ? `All good—we can keep planning here. For later, does ${availability.day} ${availability.tod || "morning"} generally work for you?`
        : "All good—we can keep planning here and pencil something in later if you want.";
    }
    if (nextGoal === "offer_slots" && availability.day && /wednesday|friday|miércoles|viernes/i.test(answer)) {
      answer = `Great—how does ${availability.day} ${availability.tod || "morning"} look for you?`;
    }

    return reply.send({
      answer,
      persisted: false,
      meta: {
        language: parsed?.language || "en",
        english_log: parsed?.english_log || "",
        scratchpad: parsed?.scratchpad ?? null,
        lead, nextGoal, availability, refusals
      }
    });

  } catch (err) {
    req.log.error(err);
    return reply.code(200).send({
      answer: "All good—we can keep planning here. What part of the project would you like to sort out next?",
      persisted: false,
      meta: { language: "en", english_log: "Server fallback reply." }
    });
  }
});

// ---------- Start server ----------
const port = Number(process.env.PORT || 8080);
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`API up on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
