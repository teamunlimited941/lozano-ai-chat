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

// ---------- Chat endpoint ----------
app.post("/api/chat", async (req, reply) => {
  try {
    const { messages = [], url } = req.body || {};
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      return reply.send({
        answer: "Hi, I’m Maria. Can I get your name and best number in case we get disconnected?",
        persisted: false,
      });
    }

    const lead = extractLeadFields(messages);

    let nextGoal = "ask_name_phone";
    if (lead.hasName && lead.hasPhone && lead.project === "unknown") nextGoal = "ask_project";
    else if (lead.hasName && lead.hasPhone && lead.project !== "unknown" && !lead.hasAddress) nextGoal = "ask_address";
    else if (lead.hasAddress && !lead.hasTimeline) nextGoal = "ask_timeline";
    else if (lead.hasTimeline && !lead.hasPlans) nextGoal = "ask_plans";
    else if (lead.hasPlans && !lead.hasBudget) nextGoal = "ask_budget";
    else if (lead.hasBudget && !lead.hasEmail) nextGoal = "ask_email";
    else if (lead.hasEmail) nextGoal = "offer_slots";

    const guidance = `
Use light wit if it helps rapport, but stay professional.
Ask only ONE follow-up. nextGoal=${nextGoal}
Project: ${lead.project}
`;

    const openai = new OpenAI({ apiKey: openaiKey });

    const fewshot = [
      { role: "user", content: "Do you build decks?" },
      { role: "assistant", content: JSON.stringify({
          message: "Absolutely—we love decks. Wood or composite is usually the big choice. What’s your name, and the best number in case we get disconnected?",
          scratchpad: { next_step: "ask_name_phone" }
        })
      },
      { role: "user", content: "Kitchen remodel" },
      { role: "assistant", content: JSON.stringify({
          message: "Nice—kitchens are where the snacks happen. What style are you leaning toward—modern, farmhouse, or something in between?",
          scratchpad: { next_step: "ask_project" }
        })
      },
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
      temperature: 0.5,
      response_format: { type: "json_object" },
      max_tokens: 400,
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { parsed = { message: raw.trim() }; }

    return reply.send({
      answer: parsed.message || "Got it. Can I get your name and best number?",
      persisted: false,
      meta: { scratchpad: parsed?.scratchpad ?? null, lead, nextGoal }
    });

  } catch (err) {
    req.log.error(err);
    return reply.code(200).send({
      answer: "Got it—let’s start simple. What’s your name and best number?",
      persisted: false,
    });
  }
});

// ---------- Start server ----------
const port = Number(process.env.PORT || 8080);
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`API up on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });

