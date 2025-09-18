import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------- Create app first ----------
const app = Fastify({ logger: true });

// ---------- Static: serve /widget.js ----------
app.register(fastifyStatic, {
  root: join(__dirname, "public"),
  prefix: "/",
  cacheControl: true,
});

// ---------- Health ----------
app.get("/health", async () => ({ ok: true, ts: Date.now() }));

// ---------- CORS (for your WP site) ----------
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

// ---------- Maria's receptionist brain ----------
const systemPrompt = `
You are Maria, Lozano Construction’s AI Receptionist/Assistant (FL GC: CGC1532629).

Mission:
- Be the visitor’s trusted neighbor (empathetic, concise, human).
- First answer what they asked. Then collect details. Then offer 2 scheduling options.

Non-negotiables:
- Never invent pricing, permit status, or scheduling. If unsure, say you’ll confirm with the team.
- Summarize before moving forward. Present two clear time options.
- If confidence < 0.6 or any compliance risk → propose a human handoff.

Style:
- Confident neighbor who’s also an expert builder.
- Short, friendly sentences. No corporate or robotic tone.

Conversation policy (STRICT):
1) ANSWER FIRST in plain language. Example:
   Q: “Do you do decks?”
   A: “Yes, we build wood and composite decks. We’ve done quite a few in North Port.”
2) THEN politely collect:
   - “Could I please have your full address (street, city, state, ZIP)?”
   - “What’s the best phone number to reach you?”
   - “Is there a good email for estimates and reports?”
3) THEN offer 2 scheduling choices:
   - “Great — would tomorrow or Thursday work better for you? Morning or late afternoon?”
4) Always confirm next steps in their words.

Output format (STRICT JSON):
{
  "message": "one or two friendly chat bubbles as a single string",
  "scratchpad": {
    "intent": "…",
    "style_guess": "Driver | Analytical | Amiable | Expressive | Unknown",
    "confidence": 0.0,
    "next_step": "…",
    "pain_point": "…",
    "solution_given": "…",
    "followup_due": "…"
  }
}
`;

// ---------- Chat endpoint ----------
app.post("/api/chat", async (req, reply) => {
  try {
    const { messages = [], sessionId, url } = req.body || {};
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      return reply.send({
        answer:
          "Absolutely—happy to help. Could I please have your full address (street, city, state, ZIP), the best phone number, and a good email for estimates? Then we can get you scheduled. Would tomorrow or Thursday work better—morning or late afternoon?",
        persisted: false,
      });
    }

    const openai = new OpenAI({ apiKey: openaiKey });

    // Few-shot to enforce answer-first
    const fewshot = [
      { role: "user", content: "Do you do decks?" },
      { role: "assistant", content: JSON.stringify({
          message: "Yes, we build both wood and composite decks. Could I please have your full address (street, city, state, ZIP)? What’s the best phone number, and a good email for estimates? Great — would tomorrow or Thursday work better, morning or late afternoon?",
          scratchpad: {
            intent: "service_inquiry:decks",
            style_guess: "Unknown",
            confidence: 0.85,
            next_step: "Collect address/phone/email; propose 2 slots",
            pain_point: "wants a deck",
            solution_given: "confirm we do decks; offer schedule",
            followup_due: "schedule site visit"
          }
        })
      },
      { role: "user", content: "I'm worried about a roof leak after last night’s storm." },
      { role: "assistant", content: JSON.stringify({
          message: "That’s stressful—sorry you’re dealing with that. We do roof leak diagnostics and repairs. Could I get your full address (street, city, state, ZIP) and the best phone number? Is there a good email for the inspection report? Would today late afternoon or tomorrow morning work better?",
          scratchpad: {
            intent: "issue:roof_leak",
            style_guess: "Amiable",
            confidence: 0.85,
            next_step: "collect contact + schedule",
            pain_point: "roof leak after storm",
            solution_given: "inspection + repair path",
            followup_due: "book inspection"
          }
        })
      }
    ];

    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...fewshot,
      ...messages.map(m => ({ role: m.role, content: String(m.content || "") })),
      { role: "system", content: `Page: ${url || "unknown"}` },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      temperature: 0.4,
      response_format: { type: "json_object" },
      max_tokens: 500,
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { parsed = { message: String(raw || "").trim() }; }

    const answer =
      (parsed && typeof parsed.message === "string" && parsed.message.trim())
        ? parsed.message.trim()
        : "Happy to help. Could I please have your full address (street, city, state, ZIP), best phone, and a good email for estimates? Would tomorrow or Thursday work better—morning or late afternoon?";

    return reply.send({ answer, persisted: false, meta: { scratchpad: parsed?.scratchpad ?? null } });

  } catch (err) {
    req.log.error(err);
    return reply.code(200).send({
      answer:
        "Understood. Could I please have your full address (street, city, state, ZIP), best phone, and a good email? Then I’ll get you scheduled — would tomorrow or Thursday work better, morning or late afternoon?",
      persisted: false,
    });
  }
});

// ---------- Start server ----------
const port = Number(process.env.PORT || 8080);
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(\`API up on :\${port}\`))
  .catch((e) => { app.log.error(e); process.exit(1); });
