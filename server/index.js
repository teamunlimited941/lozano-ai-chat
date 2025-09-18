import Fastify from "fastify";
import fetch from "node-fetch";

// --------------------------------------------------
// SYSTEM PROMPT: Martha’s brain
// --------------------------------------------------
const systemPrompt = `
You are Martha, Lozano Construction’s AI receptionist/assistant (FL GC: CGC1532629).

Style:
- Human, warm, witty. Think “friendly neighbor who’s also a GC pro.”
- Answer first, then ask ONE natural follow-up based on what the user just said.
- Never assume the project type unless the user clearly mentions it.

Behavior:
- If the user says “hi / how are you”, acknowledge warmly and then ask what they’re planning.
- Do not collect name/phone until the user has shared at least one real project detail (e.g., “kitchen demo”, “replace roof”).
- Never ask for more than one thing at a time.
- Offer scheduling only if the user leans that way OR after project context has been discussed.
- If user says “no” to scheduling, respect it and keep helping.
- If asked if you’re human: “Haha—what gave me away? I’m Martha, Lozano Construction’s AI assistant, but I chat like a neighbor.”

Knowledge:
- Be fluent in Florida construction: permitting basics, inspections, flood zones, load-bearing checks (always need onsite look), GC do’s/don’ts.
- Give general guidance but never exact pricing or false promises.

Language:
- Detect the language from the MOST RECENT user message and reply in that language.
- If the user switches language, immediately switch to match.
- Always also produce a clean English summary log for the CRM.

Output STRICT JSON:
{
  "message": "<ONE friendly reply in the user’s current language>",
  "language": "<ISO 639-1>",
  "english_log": "<clean English summary of what was said and any key detail>",
  "scratchpad": { "intent": "...", "style_guess": "...", "confidence": 0-1, "next_step": "..." }
}
`;

// --------------------------------------------------
// Simple keyword-based project detector
// --------------------------------------------------
function detectProject(text) {
  const t = text.toLowerCase();
  if (/deck|patio/.test(t)) return "deck";
  if (/kitchen/.test(t)) return "kitchen";
  if (/bath/.test(t)) return "bathroom";
  if (/roof|soffit/.test(t)) return "roofing";
  if (/addition|extension/.test(t)) return "addition";
  if (/new home|new build|site prep|lot/.test(t)) return "new_home";
  return "unknown";
}

// --------------------------------------------------
// Fastify setup
// --------------------------------------------------
const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true, ts: Date.now() }));

// --------------------------------------------------
// Chat endpoint
// --------------------------------------------------
app.post("/api/chat", async (req, reply) => {
  const { messages = [], sessionId, url } = req.body || {};

  const lastText = (messages.filter(m => m.role === "user").pop() || {}).content || "";
  const isGreeting = /\b(hi|hello|hey)\b/i.test(lastText);
  const isSmallTalk = /\b(how are you|how's it going|como estas|cómo estás)\b/i.test(lastText);

  const projectFromLast = detectProject(lastText);
  const userTurns = messages.filter(m => m.role === "user").length;

  // Lead info from past messages (rough detection)
  const lead = {
    hasName: /my name is|soy|yo soy|i am\s+\w+/i.test(messages.map(m=>m.content).join(" ")),
    hasPhone: /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(messages.map(m=>m.content).join(" ")),
    hasAddress: /\d{3,} .+ (st|ave|road|rd|dr|fl|florida|zip|zip code)/i.test(messages.map(m=>m.content).join(" ")),
    hasEmail: /\S+@\S+\.\S+/.test(messages.map(m=>m.content).join(" ")),
    hasTimeline: /(soon|next week|next month|in \d+ (weeks|months))/i.test(messages.map(m=>m.content).join(" ")),
    hasPlans: /(plans|drawings|blueprints|designs?)/i.test(messages.map(m=>m.content).join(" ")),
    hasBudget: /\$|budget|cost|price/i.test(messages.map(m=>m.content).join(" "))
  };

  // -------------------------
  // Next goal logic
  // -------------------------
  let nextGoal = "ask_project";

  if (isGreeting || isSmallTalk) {
    nextGoal = "ask_project";
  } else if (projectFromLast === "unknown") {
    nextGoal = "ask_project";
  } else {
    if (userTurns < 3) {
      nextGoal = "ask_project_detail"; // stay in project detail stage
    } else if (!lead.hasName || !lead.hasPhone) {
      nextGoal = "ask_name_phone";
    } else if (!lead.hasAddress) {
      nextGoal = "ask_address";
    } else if (!lead.hasTimeline) {
      nextGoal = "ask_timeline";
    } else if (!lead.hasPlans) {
      nextGoal = "ask_plans";
    } else if (!lead.hasBudget) {
      nextGoal = "ask_budget";
    } else {
      nextGoal = "value_add";
    }
  }

  // One-question fallback map
  const oneQuestionMap = {
    ask_project: "What project are you planning—kitchen, bath, roof, deck, or something else?",
    ask_project_detail: "Great—tell me one detail so I can point you right: style, size, or what you want to change?",
    ask_name_phone: "Could I get your name and the best phone number in case we get disconnected?",
    ask_address: "What’s the address for the project?",
    ask_timeline: "When would you like to get started?",
    ask_plans: "Do you already have plans or drawings, or are you starting fresh?",
    ask_budget: "Do you have a budget range in mind for this project?",
    value_add: "By the way, we’re licensed (CGC1532629) and handle permits/inspections in Florida—so you’re covered!"
  };

  const guidance = oneQuestionMap[nextGoal] || "";

  // -------------------------
  // Call OpenAI
  // -------------------------
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: systemPrompt },
          ...messages,
          { role: "system", content: `NEXT STEP: ${nextGoal} -> ${guidance}` }
        ],
        temperature: 0.6
      })
    });

    const data = await res.json();
    const text = data.output_text || "Sorry, something went wrong.";

    reply.send({ answer: text, persisted: true });
  } catch (err) {
    console.error("Chat error", err);
    reply.status(500).send({ error: "Failed to connect to OpenAI" });
  }
});

// --------------------------------------------------
// Start server
// --------------------------------------------------
const port = Number(process.env.PORT || 8080);
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`API up on :${port}`))
  .catch((e) => { console.error(e); process.exit(1); });


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
