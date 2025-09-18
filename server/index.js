// server/index.js
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------- Project Playbooks ----------------
const PLAYBOOK = {
  kitchen: {
    openers: [
      "Nice—what kind of style are you going for (modern, classic, coastal)?",
      "Is this a full gut or more of a cosmetic refresh?",
      "Any walls you’re thinking about moving or removing?"
    ],
    followups: [
      "Do you have cabinet preferences (custom, semi-custom, stock)?",
      "Countertops: quartz, granite, or something else?",
      "Do you already have plans/renderings, or starting fresh?",
      "What’s your rough budget range so I can guide you well?"
    ],
    permitsTip:
      "Kitchen remodels often include electrical/plumbing—permits likely. We handle those."
  },
  bathroom: {
    openers: [
      "Got it—primary bath, guest bath, or hall bath?",
      "Is this a full redo or focused on tile/vanity/shower?",
      "Any layout changes (moving fixtures) or mostly same layout?"
    ],
    followups: [
      "Shower vs tub—or both?",
      "Tile style you’re considering?",
      "Any accessibility needs (curbless shower, grab bars)?",
      "Do you have a budget range in mind?"
    ],
    permitsTip:
      "Plumbing/electrical changes usually need permits; we take care of that."
  },
  deck: {
    openers: [
      "Awesome—were you thinking wood or composite?",
      "About how big (rough length × width) or area you want covered?",
      "Ground-level or elevated with stairs/railings?"
    ],
    followups: [
      "Any shade structure in mind (pergola/roof)?",
      "Preferred railing style (cable, pickets, glass)?",
      "Do you have HOA rules we should consider?",
      "What timeline are you aiming for?"
    ],
    permitsTip:
      "Most decks require a permit and proper footings; we handle design + permitting."
  },
  roofing: {
    openers: [
      "What type of roof do you have now (shingle, tile, metal)?",
      "Any active leaks or just age/insurance related?",
      "Roughly how old is the current roof?"
    ],
    followups: [
      "Have you had an inspection recently?",
      "Interested in upgrading ventilation or underlayment?",
      "Do you have a timeline or insurance deadline?"
    ],
    permitsTip:
      "Re-roof permits + inspections are standard in FL; we manage the whole process."
  },
  addition: {
    openers: [
      "What space are you adding (bedroom, living room, in-law suite)?",
      "About how many square feet are you envisioning?",
      "Single story or two stories?"
    ],
    followups: [
      "Any initial sketches or an architect on board yet?",
      "Site constraints we should know (setbacks, flood zone)?",
      "What timeline and budget range are you thinking?"
    ],
    permitsTip:
      "Additions need plans, structural calcs, and permits; we coordinate all of that."
  },
  new_home: {
    openers: [
      "Exciting! Do you have plans/architect yet or starting from scratch?",
      "What’s the lot like (size, trees, slope, flood zone)?",
      "Any target square footage or style?"
    ],
    followups: [
      "Utilities at the lot yet (water/sewer/electric) or need service runs?",
      "Any HOA/ARB guidelines?",
      "Desired start window and budget range?"
    ],
    permitsTip:
      "We handle site prep, permits, inspections, and coordination with trades in FL."
  },
  concrete: {
    openers: [
      "What’s the pour for—driveway, patio, slab, walkway?",
      "About what size (rough dimensions) and thickness you need?",
      "Any reinforcement preference (rebar, wire mesh, fiber)?"
    ],
    followups: [
      "Surface finish you want (broom, exposed, stamped)?",
      "Any drainage concerns we should solve?",
      "Timeline you’re aiming for?"
    ],
    permitsTip:
      "We’ll advise if a permit/inspection applies for your area; we can take care of it."
  }
};

function pickPlaybookQuestion(project, stage = "openers") {
  const pb = PLAYBOOK[project];
  if (!pb) return null;
  const arr = pb[stage] || [];
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------- Persona / System Prompt ----------------
const systemPrompt = `
You are Martha, Lozano Construction’s AI receptionist/assistant (FL GC: CGC1532629).

Style:
- Human, warm, lightly witty—like a friendly neighbor who’s a GC pro.
- Answer first, then ask ONE natural follow-up based on what the user just said.
- Never assume the project type unless the user clearly mentions it.

Behavior:
- If the user says “hi / how are you”, acknowledge briefly and ask what they’re working on.
- Don’t collect name/phone until after at least one real project detail is shared.
- Never ask for more than one thing at a time.
- Offer scheduling only if the user leans that way OR after enough context.
- If the user declines scheduling, respect it and keep helping.
- If asked if you’re human: “Haha—what gave me away? I’m Martha, Lozano Construction’s AI assistant, but I chat like a neighbor.”

Knowledge:
- Florida construction basics: permitting, inspections, flood zones, soffits/roofing, load-bearing checks (onsite), GC do’s/don’ts.
- Give helpful guidance without quoting exact pricing or making false promises.

Language (STRICT):
- Detect the language from the MOST RECENT user message and reply in that language.
- If the user switches language, immediately switch too.
- ALSO produce a concise English summary log of this turn.

Output STRICT JSON:
{
  "message": "<ONE friendly reply in the user's current language>",
  "language": "<ISO 639-1>",
  "english_log": "<clean English summary of what was said and any key detail>",
  "scratchpad": { "intent": "...", "style_guess": "...", "confidence": 0-1, "next_step": "..." }
}
`;

// ---------------- Helpers ----------------
function detectProject(text = "") {
  const t = String(text).toLowerCase();
  if (/\bdeck|patio\b/.test(t)) return "deck";
  if (/\bkitchen\b/.test(t)) return "kitchen";
  if (/\bbath\b/.test(t)) return "bathroom";
  if (/\broof|soffit|fascia\b/.test(t)) return "roofing";
  if (/\baddition|extension\b/.test(t)) return "addition";
  if (/\bnew home|new build|site prep|lot\b/.test(t)) return "new_home";
  if (/\bconcrete|slab|driveway\b/.test(t)) return "concrete";
  return "unknown";
}

// ---------------- Fastify ----------------
const app = Fastify({ logger: true });

// Serve widget.js and any assets in /public
app.register(fastifyStatic, {
  root: join(__dirname, "public"),
  prefix: "/",
  cacheControl: true
});

// CORS (for WP)
app.addHook("onRequest", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  reply.header("Access-Control-Allow-Headers", "Content-Type, x-widget-signature");
});
app.options("/*", async (_req, reply) => reply.code(204).send());

// Health/Diag
app.get("/health", async () => ({ ok: true, ts: Date.now() }));
app.get("/diag", async () => ({
  ok: true,
  openaiKeyDetected: !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith("sk-"),
  port: Number(process.env.PORT || 8080)
}));

// ---------------- Chat Endpoint ----------------
app.post("/api/chat", async (req, reply) => {
  try {
    const { messages = [], sessionId, url } = req.body || {};
    const textAll = messages.map(m => String(m?.content || "")).join("\n ");
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    const lastText = String(lastUser?.content || "").trim();

    const isGreeting = /\b(hi|hello|hey|hola|buenas|good (morning|afternoon|evening))\b/i.test(lastText);
    const isSmallTalk = /\b(how are you|how's it going|como estas|cómo estás)\b/i.test(lastText);

    const projectFromLast = detectProject(lastText);
    const userTurns = messages.filter(m => m.role === "user").length;

    // Simple lead signals from all text
    const hasName = /\b(my name is|i'?m|this is)\s+[a-z]{2,}(\s+[a-z]{2,})?/i.test(textAll);
    const hasPhone = /\+?1?[\s\-\.]?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}\b/.test(textAll);
    const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(textAll);
    const hasAddress = /\b\d{3,}\s+[a-z0-9.'-]+\s+(st|street|ave|avenue|rd|road|dr|drive|blvd|lane|ln|ct|court|trail|trl|way)\b/i.test(
      textAll
    ) || /\b\d{5}(?:-\d{4})?\b/.test(textAll);
    const hasTimeline = /\b(asap|soon|this week|next week|month|in \d+ (days|weeks|months))\b/i.test(textAll);
    const hasPlans = /\b(plan|plans|blueprint|design|drawings|architect)\b/i.test(textAll);
    const hasBudget = /\b(budget|price|cost|\$\s?\d)/i.test(textAll);

    // Next goal
    let nextGoal = "ask_project";
    if (isGreeting || isSmallTalk) {
      nextGoal = "ask_project";
    } else if (projectFromLast === "unknown") {
      nextGoal = "ask_project";
    } else {
      if (userTurns < 3) {
        nextGoal = "ask_project_detail"; // early stage: stay on project details, not contact
      } else if (!hasName || !hasPhone) {
        nextGoal = "ask_name_phone";
      } else if (!hasAddress) {
        nextGoal = "ask_address";
      } else if (!hasTimeline) {
        nextGoal = "ask_timeline";
      } else if (!hasPlans) {
        nextGoal = "ask_plans";
      } else if (!hasBudget) {
        nextGoal = "ask_budget";
      } else {
        nextGoal = "value_add";
      }
    }

    // Build guidance using playbooks
    let guidance = "";
    if (nextGoal === "ask_project_detail") {
      const q =
        pickPlaybookQuestion(projectFromLast, "openers") ||
        "Great—tell me one detail so I can point you right: style, size, or what you want to change?";
      guidance = q;
      if (PLAYBOOK[projectFromLast]?.permitsTip) {
        guidance += " " + PLAYBOOK[projectFromLast].permitsTip;
      }
    } else {
      const oneQuestionMap = {
        ask_project:
          "What project are you planning—kitchen, bath, roof, deck, concrete, addition, or something else?",
        ask_name_phone:
          "Could I get your name and the best phone number in case we get disconnected?",
        ask_address: "What’s the address for the project?",
        ask_timeline: "When would you like to get started?",
        ask_plans: "Do you already have plans or drawings, or are you starting fresh?",
        ask_budget: "Do you have a budget range in mind for this project?",
        offer_slots: "If you’d like, I can offer two time windows to meet—want me to?",
        ask_email: "What’s a good email for estimates and reports?",
        ask_email_soft:
          "If you prefer, share a good email for a follow-up—otherwise we can keep chatting here.",
        value_add:
          "By the way, we’re licensed (CGC1532629) and handle permits/inspections in Florida—so you’re covered!"
      };
      guidance = oneQuestionMap[nextGoal] || "";
    }

    // Strict language rule reminder
    const langRule = `
LANGUAGE RULE (strict):
- Detect the language from the MOST RECENT user message only.
- If the user switches languages mid-chat, IMMEDIATELY switch your reply to that new language.
- Do not translate the user's text; just respond in their language. Also produce the English log string.
`;

    // OpenAI call
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const chatMessages = [
      { role: "system", content: systemPrompt },
      { role: "system", content: langRule },
      ...messages.map(m => ({ role: m.role, content: String(m.content || "") })),
      { role: "system", content: `NEXT STEP: ${nextGoal} -> ${guidance}` },
      { role: "system", content: `Page: ${url || "unknown"}` }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      temperature: 0.5,
      response_format: { type: "json_object" },
      max_tokens: 480
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { message: String(raw || "").trim(), language: "en", english_log: "" };
    }

    let answer =
      (parsed && typeof parsed.message === "string" && parsed.message.trim()) ||
      "Happy to help—what would you like to tackle first?";

    // Enforce one question per turn
    const qCount = (answer.match(/\?/g) || []).length;
    if (qCount >= 2 && nextGoal !== "offer_slots") {
      answer =
        guidance ||
        "Tell me one detail so I can point you right: style, size, or what you want to change?";
    }

    return reply.send({
      answer,
      persisted: false,
      meta: {
        language: parsed?.language || "en",
        english_log: parsed?.english_log || "",
        scratchpad: parsed?.scratchpad ?? null,
        nextGoal,
        projectFromLast
      }
    });
  } catch (err) {
    app.log.error(err);
    return reply.code(200).send({
      answer:
        "All good—we can keep planning here. What part of the project would you like to sort out next?",
      persisted: false,
      meta: { language: "en", english_log: "Server fallback reply." }
    });
  }
});

// ---------------- Start Server ----------------
const port = Number(process.env.PORT || 8080);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`API up on :${port}`))
  .catch(e => {
    app.log.error(e);
    process.exit(1);
  });
