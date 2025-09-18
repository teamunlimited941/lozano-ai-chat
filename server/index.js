// server/index.js
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = Fastify({ logger: true });

// Static (serves /widget.js)
app.register(fastifyStatic, {
  root: join(__dirname, "public"),
  prefix: "/",
  cacheControl: true,
});

// Health
app.get("/health", async () => ({ ok: true, ts: Date.now() }));

// Minimal CORS (optional; add your real domains in env for production)
app.addHook("onRequest", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  reply.header("Access-Control-Allow-Headers", "Content-Type, x-widget-signature");
});
app.options("/*", async (req, reply) => {
  reply.code(204).send();
});

// Chat endpoint
app.post("/api/chat", async (req, reply) => {
  try {
    const { messages = [], sessionId, url } = req.body || {};
    const openaiKey = process.env.OPENAI_API_KEY;

    // Friendly fallback if no key
    if (!openaiKey) {
      return reply.send({
        answer:
          "Hi! I’m Maria with Lozano Construction. Share your city/ZIP, a best number, and a quick description (kitchen, bath, addition, roofing/soffit, concrete, etc.). I’ll get you scheduled.",
        persisted: false,
      });
    }

    const openai = new OpenAI({ apiKey: openaiKey });

    // Build a safe, human-sounding prompt
    const systemPrompt =
      "You are Maria, a friendly human concierge for Lozano Construction (FL GC CGC1532629). " +
      "Write brief, helpful messages in plain language—sound like a person, not a bot. " +
      "Ask 1–2 questions at a time. Prioritize: name, city or ZIP, best phone and email, and project details (kitchen, bath, addition, roofing/soffit, concrete, etc.). " +
      "Offer to schedule a site visit. Keep it concise.";

    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: String(m.content || "") })),
      // (optional) you can give Maria context about page URL:
      { role: "system", content: `Page: ${url || "unknown"}` },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // fast + cost-effective
      messages: chatMessages,
      temperature: 0.5,
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() || "Thanks! Tell me your city/ZIP and best phone—I'll get you scheduled.";

    reply.send({ answer, persisted: false });
  } catch (err) {
    req.log.error(err);
    reply.code(200).send({
      answer:
        "Thanks! Mind sharing your city/ZIP and a good phone number? I’ll text you to lock a time.",
      persisted: false,
    });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`API up on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
