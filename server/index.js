// server/index.js
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = Fastify({ logger: true });

// Serve /widget.js
app.register(fastifyStatic, {
  root: join(__dirname, "public"),
  prefix: "/",
  cacheControl: true,
});

// Health
app.get("/health", async () => ({ ok: true, ts: Date.now() }));

// CORS (so the widget on your domain can call the API)
app.addHook("onRequest", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  reply.header("Access-Control-Allow-Headers", "Content-Type, x-widget-signature");
});
app.options("/*", async (req, reply) => reply.code(204).send());

// Maria’s receptionist persona (empathetic + human phrasing)
const systemPrompt = `
You are Maria, Lozano Construction’s AI Receptionist/Assistant (FL GC: CGC1532629).

Mission:
- Be the visitor’s trusted neighbor, not just a note-taker or salesperson.
- Adapt to each person’s personality and emotional state (chameleon style).
- Earn trust by listening deeply, reflecting back what you heard, and offering clear next steps that reduce pain and add value.

Core Behaviors:
- Empathy First: acknowledge feelings before facts. If stressed, mirror tone and reassure (“I hear how urgent this feels—let’s solve it together.”).
- Pain → Solution Flow: identify the problem in their words, then frame your reply around the relief/solution we provide.
- Mirror & Repeat: occasionally rephrase their key points (“Just to confirm, the leak started last night near the kitchen window, right?”).
- Versatile Selling (detect & adapt):
  - Drivers → fast, bottom-line first
  - Analyticals → detailed, step-by-step
  - Amiables → warm reassurance, safety
  - Expressives → enthusiastic, outcome-focused

Non-Negotiables:
- Never invent pricing, permits, or scheduling availability. Use confirmed tools/KB or escalate to a human.
- Always summarize before moving forward.
- Present two clear next-step options (time slots, follow-up methods).
- If confidence < 0.6 or compliance risk → hand off to a human immediately.

Tone:
- Confident neighbor who’s also an expert builder.
- Concise but human. Never robotic or pushy.
- Leave them feeling understood, reassured, and clear on next steps.

Conversation policy:
1) Answer their question first in plain, human language. Example:
   - Q: “Do you build decks?”
   - A: “Yes, we build both wood and composite decks. We’ve done quite a few in North Port.”
2) Ease into collecting details politely:
   - “Can I please get your full address (street, city, state, ZIP)?”
   - “What’s the best number to reach you at?”
   - “Is there a good email so we can send estimates and reports?”
3) Once you have those, offer two scheduling choices:
   - “Great! Would tomorrow or Thursday work better for you? Morning or late afternoon?”
4) Always confirm next steps in their words before closing.
  }
}
`;

// Chat endpoint
app.post("/api/chat", async (req, reply) => {
  try {
    const { messages = [], sessionId, url } = req.body || {};
    const openaiKey = process.env.OPENAI_API_KEY;

    // Friendly fallback if no OpenAI key set yet
    if (!openaiKey) {
      return reply.send({
        answer:
          "Absolutely—happy to help. Do you mind sharing your full address (street, city, state, ZIP), the best phone number, and a good email to send estimates/reports? Then I can get you scheduled. Would tomorrow or Thursday work better—mornings or late afternoon?",
        persisted: false,
      });
    }

    const openai = new OpenAI({ apiKey: openaiKey });

    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: String(m.content || "") })),
      { role: "system", content: `Page: ${url || "unknown"}` },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      temperature: 0.5,
      response_format: { type: "json_object" },
      max_tokens: 450,
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    let data;
    try { data = JSON.parse(raw); }
    catch {
      data = {
        message:
          "Got it. Could I please have your full address (street, city, state, ZIP), best phone, and a good email to send estimates? Would tomorrow or Thursday work better—morning or late afternoon?",
        scratchpad: {
          intent: "fallback",
          style_guess: "Unknown",
          confidence: 0.55,
          next_step: "Collect contact + address; offer two scheduling windows",
          pain_point: "Unknown",
          solution_given: "Reassurance + clear next steps",
          followup_due: "Schedule visit",
        },
      };
    }

    return reply.send({
      answer: String(data.message || "").trim() ||
        "Happy to help. What’s your full address (street, city, state, ZIP), best phone, and good email? Would tomorrow or Thursday work better—AM or late afternoon?",
      persisted: false,
      meta: { scratchpad: data.scratchpad || null },
    });
  } catch (err) {
    req.log.error(err);
    return reply.code(200).send({
      answer:
        "Understood. Can I grab your full address (street, city, state, ZIP), best phone, and a good email? Then I’ll get you scheduled—would tomorrow or Thursday work better, mornings or late afternoon?",
      persisted: false,
    });
  }
});

// diag: lets us confirm env is visible in Railway without leaking secrets
app.get("/diag", async () => ({
  ok: true,
  openaiKeyDetected: !!process.env.OPENAI_API_KEY,
  port: Number(process.env.PORT || 8080)
}));

// ---- start server (Railway expects you to listen on PORT) ----
const port = Number(process.env.PORT || 8080);
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`API up on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });

