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
function extractLeadFields(messages = []) {
  const text = messages.map(m => (m?.content || "")).join("\n ").toLowerCase();

  const emailMatch = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  const phoneMatch = text.match(/\+?1?[\s\-\.]?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}\b/);
  const zipMatch   = text.match(/\b\d{5}(?:-\d{4})?\b/);
  const addressMatch = text.match(/\b\d{1,6}\s+([a-z0-9.'-]+\s)+(st|street|ave|avenue|rd|road|dr|drive|blvd|lane|ln|ct|court|trail|trl|way)\b/i);

  const nameMatch = text.match(/\b(my name is|i'?m|this is)\s+([a-z]{2,}\s+[a-z]{2,})\b/i);

  const project = detectProject(text);

  const timeline = /\b(asap|soon|this week|next week|month|couple of|in \d+ (days|weeks|months))\b/i.test(text);
  const plans = /\b(plan|plans|blueprint|design|drawings|architect)\b/i.test(text);
  const budget = /\b(\$?\d{2,}(?:,\d{3})*(?:\.\d{2})?\s*(k|grand)?|budget)\b/i.test(text);

  return {
    hasName: !!nameMatch,
    hasPhone: !!phoneMatch,
    hasEmail: !!emailMatch,
    hasAddress: !!addressMatch || !!zipMatch,
    project,
    hasTimeline: timeline,
    hasPlans: plans,
    hasBudget: budget,
  };
}

function detectProject(text) {
  if (/\bdeck(s)?\b/.test(text)) return "deck";
  if (/\bkitchen(s)?\b/.test(text)) return "kitchen";
  if (/\bbath(room|s)?\b/.test(text)) return "bath";
  if (/\b(roof|roofing|soffit|fascia)\b/.test(text)) return "roofing";
  if (/\bconcrete\b/.test(text)) return "concrete";
  if (/\baddition\b/.test(text)) return "addition";
  return "unknown";
}

// ---------- Maria’s brain ----------
const systemPrompt = `
You are Maria, Lozano Construction’s AI Receptionist/Assistant (FL GC: CGC1532629).

Mission:
- Be quick, helpful, witty (lightly), and professional.
- Sound like a friendly neighbor who happens to be a pro builder.
- Answer first, then ONE follow-up to guide the chat toward scheduling.

Tone:
- Confident, concise, positive. Sprinkle humor only if it helps rapport.
- Adapt style: Driver → fast & direct, Analytical → detailed, Amiable → warm, Expressive → upbeat.

Rules:
- One follow-up question per turn.
- General flow: Name+Phone → Project specifics → Rapport → Address → Timeline → Plans → Budget → Offer 2 slots (Wed/Fri, AM/PM) → Email last.
- Never ask for more than one detail at once.
- Never invent prices or availability.

Output STRICT JSON:
{
  "message": "ONE short, friendly bubble (answer + one follow-up).",
  "scratchpad": { ... }
}
`;

// ---------- Chat endpoint (consent-based scheduling, adaptive availability) ----------
app.post("/api/chat", async (req, reply) => {
  try {
    const { messages = [], url } = req.body || {};
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      return reply.send({
        answer: "Hi, I’m Maria. Happy to help—what are you planning?",
        persisted: false,
      });
    }

    // --- helpers (inline) ---
    const textAll = messages.map(m => String(m?.content || "")).join("\n ").toLowerCase();

    const refusals = (textAll.match(/\b(no|not yet|don'?t want|won'?t|can'?t|prefer not)\b/g) || []).length;
    const userSaidNoToSchedule = /\b(no|not now|not yet|can'?t|won'?t|i can'?t|i told you)\b.*\b(schedule|wednesday|friday|time|appointment|book|meeting)\b/i.test(textAll);
    const userSaidNoToContact  = /\b(no|not now|not yet|later|privacy)\b.*\b(phone|number|email|contact)\b/i.test(textAll);

    // detect explicit availability mentions (e.g., Monday)
    const availability = (() => {
      const day = (textAll.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i) || [])[0];
      const tod = (textAll.match(/\b(morning|afternoon|evening|night|am|pm)\b/i) || [])[0];
      return { day: day ? day.toLowerCase() : null, tod: tod ? tod.toLowerCase() : null };
    })();

    // crude lead extraction reused from earlier version
    const lead = (() => {
      const emailMatch = textAll.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      const phoneMatch = textAll.match(/\+?1?[\s\-\.]?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}\b/);
      const zipMatch   = textAll.match(/\b\d{5}(?:-\d{4})?\b/);
      const addrMatch  = textAll.match(/\b\d{1,6}\s+([a-z0-9.'-]+\s)+(st|street|ave|avenue|rd|road|dr|drive|blvd|lane|ln|ct|court|trail|trl|way)\b/i);
      const nameGiven  = /\b(my name is|i'?m|this is)\s+[a-z]{2,}\s+[a-z]{2,}\b/i.test(textAll);
      const project = (() => {
        if (/\bdeck(s)?\b/.test(textAll)) return "deck";
        if (/\bkitchen(s)?\b/.test(textAll)) return "kitchen";
        if (/\bbath(room|s)?\b/.test(textAll)) return "bath";
        if (/\b(roof|roofing|soffit|fascia)\b/.test(textAll)) return "roofing";
        if (/\bconcrete\b/.test(textAll)) return "concrete";
        if (/\baddition\b/.test(textAll)) return "addition";
        if (/\bnew house|new build|custom home|site prep|site-prep|clearing\b/.test(textAll)) return "new_home";
        return "unknown";
      })();
      const timeline = /\b(asap|soon|this week|next week|month|couple of|in \d+ (days|weeks|months))\b/i.test(textAll);
      const plans = /\b(plan|plans|blueprint|design|drawings|architect)\b/i.test(textAll);
      const budget = /\b(\$?\d{2,}(?:,\d{3})*(?:\.\d{2})?\s*(k|grand)?|budget)\b/i.test(textAll);
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
    })();

    // Consent gate for scheduling: only propose slots if (a) user asks to schedule OR (b) we have enough info AND they haven’t declined twice.
    const userAskedToSchedule = /\b(schedule|book|set (a )?time|appointment|meet|estimate|quote)\b/i.test(textAll);
    const allowedToOfferSlots =
      userAskedToSchedule ||
      (lead.hasAddress && lead.hasTimeline && lead.hasPlans && lead.hasBudget && refusals < 2 && !userSaidNoToSchedule);

    // Decide the single next follow-up
    let nextGoal = "ask_project"; // default
    // order: name+phone -> project specifics -> address -> timeline -> plans -> budget -> (offer slots only if allowed) -> email last
    if (!lead.hasName || !lead.hasPhone) nextGoal = userSaidNoToContact ? "ask_project" : "ask_name_phone";
    else if (lead.project === "unknown") nextGoal = "ask_project";
    else if (!lead.hasAddress) nextGoal = "ask_address";
    else if (!lead.hasTimeline) nextGoal = "ask_timeline";
    else if (!lead.hasPlans) nextGoal = "ask_plans";
    else if (!lead.hasBudget) nextGoal = "ask_budget";
    else if (allowedToOfferSlots) nextGoal = "offer_slots";
    else if (!lead.hasEmail) nextGoal = "ask_email";
    else nextGoal = "value_add"; // keep helping, no pressure

    // If they declined scheduling twice, freeze scheduling & contact asks; stay helpful.
    if (refusals >= 2 || userSaidNoToSchedule) {
      if (nextGoal === "offer_slots") nextGoal = !lead.hasEmail ? "ask_email_soft" : "value_add";
    }
    if (userSaidNoToContact) {
      if (nextGoal === "ask_name_phone" || nextGoal === "ask_email") nextGoal = "ask_project";
    }

    // Build guidance for the model
    const availabilityHint = availability.day
      ? `User mentioned availability: ${availability.day}${availability.tod ? " (" + availability.tod + ")" : ""}. Prefer offering that day/time.`
      : `If offering slots, suggest two options that match typical windows; if user named a day (e.g., Monday), prefer that.`;

    const guidance = `
Use light, tasteful wit only if it helps rapport. Be fast and professional.
Ask EXACTLY ONE follow-up this turn.
nextGoal=${nextGoal}
${availabilityHint}
User refusals so far: ${refusals}. If they refused scheduling, do NOT push slots again—ask permission first or keep helping.
Never ask for more than one detail at once. Never contradict stated availability (e.g., if they said Monday, don't push Wed/Fri).
`;

    const openai = new OpenAI({ apiKey: openaiKey });

    // small few-shot emphasizing consent
    const fewshot = [
      { role: "user", content: "Can we set a time?" },
      { role: "assistant", content: JSON.stringify({
          message: "Absolutely. Would Monday morning or Monday afternoon work better?",
          scratchpad: { intent: "schedule_request", next_step: "offer_slots", confidence: 0.9 }
        })
      },
      { role: "user", content: "I don't want to share my phone yet." },
      { role: "assistant", content: JSON.stringify({
          message: "No problem—totally your call. Want to tell me a bit more about the project and your timeline first?",
          scratchpad: { intent: "privacy_preference", next_step: "ask_project", confidence: 0.9 }
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
      max_tokens: 420,
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = { message: String(raw || "").trim() }; }
    let answer = (parsed && typeof parsed.message === "string" && parsed.message.trim())
      ? parsed.message.trim()
      : "Happy to help—what would you like to tackle first?";

    // Hard guards: keep it one question; no pushy scheduling if refused; respect Monday preference
    const qCount = (answer.match(/\?/g) || []).length;
    if (qCount >= 2 && !["offer_slots"].includes(nextGoal)) {
      // replace with a single-question fallback based on nextGoal
      const single = {
        ask_name_phone: "What’s your name, and the best number in case we get disconnected?",
        ask_project: "Tell me a bit about the project—what are you planning?",
        ask_address: "What’s the full address (street, city, state, ZIP)?",
        ask_timeline: "How soon are you hoping to start?",
        ask_plans: "Do you already have plans or designs?",
        ask_budget: "Do you have a rough budget range in mind?",
        ask_email: "What’s a good email for estimates and reports?",
        ask_email_soft: "If you’d like, I can send a follow-up—what’s a good email, or we can keep chatting here.",
        offer_slots: availability.day
          ? `Would ${availability.day} ${availability.tod ? availability.tod : "morning"} work, or do you prefer ${availability.day} ${availability.tod ? "later" : "afternoon"}?`
          : "Would Monday morning or Monday afternoon work better?"
      }[nextGoal] || "What would you like to tackle first?";
      answer = single;
    }

    if ((userSaidNoToSchedule || refusals >= 2) && /schedule|book|appointment|time|meet/i.test(answer)) {
      answer = availability.day
        ? `Totally fine—we can keep planning here. For later, does ${availability.day} ${availability.tod || "morning"} generally work for you?`
        : "Totally fine—we can keep planning here and pencil something in later if you want.";
    }

    // if user said Monday, prefer Monday in any slot offer
    if (nextGoal === "offer_slots" && availability.day && /wednesday|friday/i.test(answer)) {
      answer = `Great—how does ${availability.day} ${availability.tod || "morning"} look for you?`;
    }

    return reply.send({
      answer,
      persisted: false,
      meta: { scratchpad: parsed?.scratchpad ?? null, lead, nextGoal, availability, refusals }
    });

  } catch (err) {
    req.log.error(err);
    return reply.code(200).send({
      answer: "All good—we can keep planning here. What part of the project would you like to sort out next?",
      persisted: false,
    });
  }
});

// ---------- Start server ----------
const port = Number(process.env.PORT || 8080);
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`API up on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });

