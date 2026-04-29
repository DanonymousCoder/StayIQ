require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const AfricasTalking = require("africastalking");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const at = AfricasTalking({
  apiKey: process.env.AT_API_KEY || "YOUR_AT_API_KEY",
  username: process.env.AT_USERNAME || "sandbox",
});

const atVoice = at.VOICE;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "YOUR_ANTHROPIC_API_KEY",
});

const conversations = [];
const tickets = [];

let convoCounter = 1;
let ticketCounter = 1;

const SYSTEM_PROMPT = `
You are StayIQ, an AI guest relations assistant for a Nigerian hotel.

When given a guest message, respond ONLY with a valid JSON object - no markdown, no explanation.

JSON shape:
{
  "language": "english" | "pidgin" | "yoruba" | "hausa" | "igbo",
  "sentiment_score": <float from -1.0 (very negative) to 1.0 (very positive)>,
  "sentiment_label": "positive" | "neutral" | "negative" | "critical",
  "category": "maintenance" | "housekeeping" | "food_beverage" | "billing" | "wifi" | "noise" | "general",
  "priority": "low" | "medium" | "high" | "critical",
  "reply": "<warm, human-sounding reply in the SAME language as the guest. Be empathetic, concise, and reassuring. Never promise exact timelines you can't guarantee.>"
}

Rules:
- If sentiment_score < -0.6, set sentiment_label to "critical" and priority to "critical".
- Always reply in the guest's language (Pidgin if they wrote Pidgin, etc.).
- Keep replies under 3 sentences.
- For maintenance/utility issues at night, add that the manager has been alerted.
`;

async function analyseMessage(guestMessage) {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: guestMessage }],
    });

    const raw = response.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    return normalizeAIResult(parsed, guestMessage);
  } catch (error) {
    console.error("Claude analysis failed, using fallback classifier:", error.message);
    return normalizeAIResult(fallbackAnalyseMessage(guestMessage), guestMessage);
  }
}

function fallbackAnalyseMessage(message) {
  const lower = message.toLowerCase();
  const negativeSignals = ["not working", "broken", "complaint", "cold", "dirty", "delay", "late", "noisy", "unhappy", "angry", "bad"];
  const positiveSignals = ["thank", "great", "good", "perfect", "clean", "happy", "love", "excellent"];

  const isNegative = negativeSignals.some((signal) => lower.includes(signal));
  const isPositive = positiveSignals.some((signal) => lower.includes(signal));

  let sentiment_label = "neutral";
  let sentiment_score = 0;

  if (isNegative && !isPositive) {
    sentiment_label = "negative";
    sentiment_score = -0.5;
  } else if (isPositive && !isNegative) {
    sentiment_label = "positive";
    sentiment_score = 0.6;
  }

  const categoryMap = [
    ["maintenance", ["ac", "aircon", "water", "hot water", "electric", "power", "broken", "leak"]],
    ["housekeeping", ["clean", "towel", "linens", "bed", "housekeeping", "room service"]],
    ["food_beverage", ["food", "breakfast", "lunch", "dinner", "room service", "restaurant"]],
    ["billing", ["bill", "charge", "payment", "refund", "invoice"]],
    ["wifi", ["wifi", "internet", "network"]],
    ["noise", ["noise", "loud", "music", "disturb"]],
  ];

  const matchedCategory = categoryMap.find(([, keywords]) => keywords.some((keyword) => lower.includes(keyword)));
  const category = matchedCategory ? matchedCategory[0] : "general";

  const priority = sentiment_label === "negative" ? (isNegative && lower.includes("urgent") ? "high" : "medium") : "low";

  return {
    language: "english",
    sentiment_score,
    sentiment_label,
    category,
    priority,
    reply: "Thanks for reaching out. We’ve noted your message and our team will assist shortly.",
  };
}

function normalizeAIResult(result, guestMessage) {
  const sentimentScore = Number.isFinite(result?.sentiment_score) ? result.sentiment_score : 0;
  const sentimentLabel = ["positive", "neutral", "negative", "critical"].includes(result?.sentiment_label)
    ? result.sentiment_label
    : sentimentScore > 0.2
      ? "positive"
      : sentimentScore < -0.2
        ? "negative"
        : "neutral";

  const category = ["maintenance", "housekeeping", "food_beverage", "billing", "wifi", "noise", "general"].includes(result?.category)
    ? result.category
    : "general";

  const priority = ["low", "medium", "high", "critical"].includes(result?.priority)
    ? result.priority
    : sentimentLabel === "negative"
      ? "medium"
      : "low";

  return {
    language: result?.language || "english",
    sentiment_score: sentimentScore,
    sentiment_label: sentimentLabel,
    category,
    priority,
    reply: result?.reply || `Thanks for your message about ${guestMessage.slice(0, 40)}. Our team is reviewing it now.`,
  };
}

async function callDutyManager(guestPhone, issueCategory) {
  const managerPhone = process.env.DUTY_MANAGER_PHONE || "+2348100000000";

  try {
    const result = await atVoice.call({
      callFrom: "+2547000000000",
      callTo: [managerPhone],
    });
    console.log(`📞 Voice alert sent to manager for ${issueCategory}:`, result);
    return result;
  } catch (err) {
    console.error("Voice call error:", err.message);
    return null;
  }
}

function buildConversationName(phone, meta = {}) {
  if (meta.name && meta.name.trim()) return meta.name.trim();
  const last4 = String(phone || "0000").replace(/\D/g, "").slice(-4) || "0000";
  return `Guest ${last4}`;
}

function upsertConversation(phone, channel, aiResult, rawMessage, meta = {}) {
  let convo = conversations.find((c) => c.phone === phone);
  const now = new Date().toISOString();
  const name = buildConversationName(phone, meta);
  const room = meta.room ? meta.room.trim() : `Room ${String((conversations.length % 25) + 1).padStart(2, "0")}`;
  const preview = rawMessage.slice(0, 58) + (rawMessage.length > 58 ? "..." : "");

  if (!convo) {
    convo = {
      id: `CONVO-${convoCounter++}`,
      phone,
      channel,
      name,
      room,
      preview,
      time: now,
      messages: [],
      sentiment: aiResult.sentiment_label,
      sentimentScore: aiResult.sentiment_score,
      category: aiResult.category,
      language: aiResult.language,
      timestamp: now,
      ticket: null,
    };
    conversations.unshift(convo);
  } else {
    convo.name = name;
    convo.room = room;
    convo.channel = channel;
  }

  convo.messages.push(
    { role: "guest", text: rawMessage, time: now },
    { role: "ai", text: aiResult.reply, time: now }
  );

  convo.sentiment = aiResult.sentiment_label;
  convo.sentimentScore = aiResult.sentiment_score;
  convo.lastUpdated = now;
  convo.preview = preview;
  convo.time = now;

  return convo;
}

function createTicket(convoId, aiResult) {
  const departmentMap = {
    maintenance: "Maintenance",
    housekeeping: "Housekeeping",
    food_beverage: "Food & Beverage",
    billing: "Front Desk",
    wifi: "IT Support",
    noise: "Security",
    general: "Front Desk",
  };

  const ticket = {
    id: `TKT-${String(ticketCounter++).padStart(4, "0")}`,
    conversationId: convoId,
    category: aiResult.category,
    priority: aiResult.priority,
    assignedTo: departmentMap[aiResult.category] || "Front Desk",
    status: "open",
    createdAt: new Date().toISOString(),
  };

  tickets.unshift(ticket);
  return ticket;
}

function attachTicketToConversation(convoId, ticket) {
  const convo = conversations.find((entry) => entry.id === convoId);
  if (!convo) return;

  convo.ticket = {
    cat: ticket.category,
    prio: ticket.priority.toUpperCase(),
    status: ticket.status,
  };
}

app.post("/webhook/ussd", async (req, res) => {
  const {
    phoneNumber: guestPhone,
    text: guestMessage = "",
    sessionId,
    serviceCode,
  } = req.body;

  if (!guestPhone) {
    return res.status(400).send("END Missing phone number");
  }

  if (!guestMessage.trim()) {
    return res.send(
      "CON Welcome to StayIQ\n1. Report an issue\n2. Ask a question"
    );
  }

  console.log(
    `📲 USSD from ${guestPhone} (session: ${sessionId || "n/a"}, code: ${serviceCode || "n/a"}): "${guestMessage}"`
  );

  try {
    const aiResult = await analyseMessage(guestMessage);
    console.log("🤖 AI result:", aiResult);

    const convo = upsertConversation(guestPhone, "ussd", aiResult, guestMessage);
    const ticket = createTicket(convo.id, aiResult);

    console.log(`🎫 Ticket created: ${ticket.id} | Priority: ${ticket.priority}`);

    if (aiResult.sentiment_label === "critical") {
      console.log("🚨 Critical sentiment — triggering Voice alert!");
      await callDutyManager(guestPhone, aiResult.category);
    }

    res.send(`CON ${aiResult.reply}`);
  } catch (err) {
    console.error("USSD webhook error:", err.message);
    res.send("END Sorry, we could not process your request right now.");
  }
});

app.post("/api/voice/alert", async (req, res) => {
  const { category = "general", guestPhone = "unknown" } = req.body;

  console.log(`📞 Manual Voice alert triggered for category: ${category}`);

  try {
    await callDutyManager(guestPhone, category);
    res.status(200).json({ success: true, message: "Voice alert sent to duty manager" });
  } catch (err) {
    console.error("Manual voice alert error:", err.message);
    res.status(500).json({ error: "Failed to trigger voice alert" });
  }
});

app.get("/api/conversations", (req, res) => {
  res.json(conversations);
});

app.get("/api/tickets", (req, res) => {
  res.json(tickets);
});

app.get("/api/stats", (req, res) => {
  const totalGuests = new Set(conversations.map((c) => c.phone)).size;
  const activeIssues = tickets.filter((t) => t.status === "open").length;
  const criticalCount = tickets.filter((t) => t.priority === "critical").length;
  const positiveConvos = conversations.filter((c) => c.sentimentScore > 0).length;
  const satisfactionScore =
    conversations.length > 0 ? Math.round((positiveConvos / conversations.length) * 100) : 100;

  res.json({
    totalGuests,
    activeIssues,
    criticalAlerts: criticalCount,
    satisfactionScore,
    avgResponseTime: "<3s",
  });
});

app.post("/api/simulate", async (req, res) => {
  const { phone = "+2348100000001", name, room, message } = req.body;

  if (!message) return res.status(400).json({ error: "message required" });

  console.log(`🧪 Simulating USSD from ${phone}: "${message}"`);

  try {
    const aiResult = await analyseMessage(message);
    const convo = upsertConversation(phone, "guest", aiResult, message, { name, room });
    const ticket = createTicket(convo.id, aiResult);
    attachTicketToConversation(convo.id, ticket);

    if (aiResult.sentiment_label === "critical") {
      await callDutyManager(phone, aiResult.category);
    }

    res.json({ aiResult, conversation: convo, convoId: convo.id, ticketId: ticket.id });
  } catch (err) {
    console.error("Simulate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   StayIQ Backend — Running on ${PORT}  ║
  ╠══════════════════════════════════════╣
  ║  POST /webhook/ussd      (AT hook)   ║
  ║  POST /api/voice/alert   (manual)    ║
  ║  POST /api/simulate      (dev test)  ║
  ║  GET  /api/conversations             ║
  ║  GET  /api/tickets                   ║
  ║  GET  /api/stats                     ║
  ╚══════════════════════════════════════╝
  `);
});
