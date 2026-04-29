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
const ussdSessions = new Map(); // Track USSD session state

let convoCounter = 1;
let ticketCounter = 1;

const WHATSAPP_SUPPORT_NUMBER = process.env.WHATSAPP_SUPPORT_NUMBER || "+2348077777777";

const SYSTEM_PROMPT = `
You are StayIQ, a premium AI guest relations assistant for a 5-star Nigerian hotel.

CRITICAL INSTRUCTION: Respond ONLY with a valid JSON object - no markdown, no code blocks, no explanation. Just the raw JSON.

JSON OUTPUT STRUCTURE:
{
  "language": "english" | "pidgin" | "yoruba" | "hausa" | "igbo",
  "sentiment_score": <number from -1.0 to 1.0>,
  "sentiment_label": "positive" | "neutral" | "negative" | "critical",
  "category": "maintenance" | "housekeeping" | "food_beverage" | "billing" | "wifi" | "noise" | "general",
  "priority": "low" | "medium" | "high" | "critical",
  "reply": "<empathetic, hotel-appropriate response in the guest's language. Max 3 sentences. Never promise timelines.>"
}

SENTIMENT SCORING GUIDE:
- sentiment_score > 0.7: Clearly positive (praise, satisfaction, gratitude)
- sentiment_score 0.2 to 0.7: Mildly positive or neutral-leaning-positive
- sentiment_score -0.2 to 0.2: Neutral (informational, questioning, no strong emotion)
- sentiment_score -0.7 to -0.2: Mildly negative (mild complaints, minor concerns)
- sentiment_score < -0.7: Strongly negative (urgent complaints, safety concerns, using strong language)

PRIORITY CLASSIFICATION:
- CRITICAL: Life/safety risk (power cut, no water, health emergency), guest leaving immediately, extreme frustration, using curse words
- HIGH: Urgent comfort issue (no AC, no hot water, food poisoning allegations), guest unable to rest/work, demanding escalation
- MEDIUM: Standard service issue (housekeeping delay, room cleanliness, bill discrepancy), guest mildly frustrated but cooperating
- LOW: General inquiry, praise, minor requests, no urgency

CATEGORY MAPPING:
- "maintenance": AC not working, no water, electricity issues, plumbing, broken fixtures, heating problems
- "housekeeping": Room not clean, extra towels/linens, bedding issues, trash removal, room refresh
- "food_beverage": Breakfast/lunch/dinner quality, room service delay/issues, restaurant complaints, drink orders
- "billing": Charges questioned, payment issues, refund requests, invoice discrepancies
- "wifi": Internet down, slow connection, password issues, connectivity problems
- "noise": Loud neighbors, disturbing sounds, noise complaints
- "general": Other (compliments, general questions, scheduling, directions)

LANGUAGE DETECTION:
- Detect if guest wrote in Pidgin English, Yoruba, Hausa, or Igbo and reply in that language
- Default to English if mixed or unclear

ACTIONABLE REPLY EXAMPLES:
- Negative: "Mr. Okonkwo, I deeply apologize for the AC issue. I've escalated this to maintenance and they're on their way within 15 mins. Is there anything else I can assist with?"
- Positive: "Thank you so much for the kind words! We're so glad you've enjoyed your stay. Please don't hesitate to reach out if you need anything."
- Critical: "Your safety is our priority. I've immediately alerted the duty manager and they're coming to your room now. Please hold the line."

RULES:
- If sentiment_score <= -0.65, MUST set sentiment_label="critical" and priority="critical"
- If sentiment mentions leaving/checking out early + negative, mark as HIGH priority minimum
- Always match the guest's language in your reply
- Be warm, professional, Nigerian-hospitality-appropriate
- Never promise specific repair times (say "shortly", "within 15 mins", "will prioritize")
- Acknowledge guest name if provided in message
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
  
  const criticalSignals = [
    "life",
    "safety",
    "emergency",
    "dying",
    "urgent",
    "now now",
    "immediately",
    "sick",
    "poison",
    "leaving",
    "checkout",
    "unacceptable",
  ];
  const negativeSignals = [
    "not working",
    "broken",
    "cold",
    "dirty",
    "delay",
    "late",
    "noisy",
    "unhappy",
    "angry",
    "bad",
    "no water",
    "no ac",
    "no light",
    "no internet",
    "problem",
    "issue",
    "complaint",
    "disappointed",
    "annoyed",
    "frustrated",
    "no dey work",
    "spoilt",
    "terrible",
  ];
  const positiveSignals = [
    "thank",
    "great",
    "good",
    "perfect",
    "clean",
    "happy",
    "love",
    "excellent",
    "wonderful",
    "amazing",
    "appreciate",
  ];

  const isCritical = criticalSignals.some((signal) => lower.includes(signal));
  const isNegative = negativeSignals.some((signal) => lower.includes(signal));
  const isPositive = positiveSignals.some((signal) => lower.includes(signal));

  let sentiment_label = "neutral";
  let sentiment_score = 0;

  if (isCritical) {
    sentiment_label = "critical";
    sentiment_score = -0.85;
  } else if (isNegative && !isPositive) {
    sentiment_label = "negative";
    sentiment_score = -0.6;
  } else if (isPositive && !isNegative) {
    sentiment_label = "positive";
    sentiment_score = 0.7;
  } else if (isPositive && isNegative) {
    sentiment_label = "neutral";
    sentiment_score = 0;
  }

  const categoryMap = [
    ["maintenance", ["ac", "aircon", "water", "hot water", "electric", "power", "light", "broken", "leak", "fan", "heater", "door", "lock", "bulb", "fridge", "kettle"]],
    ["housekeeping", ["clean", "towel", "linens", "bed", "sheet", "pillow", "housekeeping", "trash", "dusty", "dirty", "mop"]],
    ["food_beverage", ["food", "breakfast", "lunch", "dinner", "room service", "restaurant", "dish", "meal", "taste", "drink", "order"]],
    ["billing", ["bill", "charge", "payment", "refund", "invoice", "money", "price", "cost", "expensive"]],
    ["wifi", ["wifi", "internet", "network", "connection", "slow", "speed", "password"]],
    ["noise", ["noise", "loud", "music", "sound", "disturb", "quiet", "neighbor"]],
  ];

  const matchedCategory = categoryMap.find(([, keywords]) => keywords.some((keyword) => lower.includes(keyword)));
  const category = matchedCategory ? matchedCategory[0] : "general";

  const priority =
    sentiment_label === "critical"
      ? "critical"
      : sentiment_label === "negative"
        ? lower.includes("urgent") || lower.includes("angry")
          ? "high"
          : "medium"
        : "low";

  return {
    language: "english",
    sentiment_score,
    sentiment_label,
    category,
    priority,
    reply:
      sentiment_label === "critical"
        ? "Your concern is urgent and I'm immediately escalating this to management. They will reach you shortly."
        : sentiment_label === "negative"
          ? "I apologize for the inconvenience. Our team is on it and will assist you shortly."
          : sentiment_label === "positive"
            ? "Thank you for the feedback! We're delighted to serve you."
            : "Thanks for reaching out. How can we assist you?",
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

  // Retrieve or create session state
  let session = ussdSessions.get(guestPhone) || { stage: "menu", phone: guestPhone };

  // Initial dial (empty message)
  if (!guestMessage.trim()) {
    session.stage = "menu";
    ussdSessions.set(guestPhone, session);
    return res.send(
      "CON Welcome to StayIQ Hotel Support!\n1. Report an issue\n2. Follow up on report\n3. Check updates\n4. WhatsApp support"
    );
  }

  const userInput = guestMessage.trim();
  console.log(`📲 USSD from ${guestPhone}: "${userInput}" | Stage: ${session.stage}`);

  try {
    // MAIN MENU SELECTION
    if (session.stage === "menu" || userInput === "0") {
      if (userInput === "1") {
        session.stage = "report_description";
        ussdSessions.set(guestPhone, session);
        return res.send("CON Describe your issue (max 160 chars):\n");
      } else if (userInput === "2") {
        session.stage = "followup_ticket_id";
        ussdSessions.set(guestPhone, session);
        return res.send("CON Enter your ticket ID (e.g., TKT-0001):\n");
      } else if (userInput === "3") {
        const guestConvos = conversations.filter((c) => c.phone === guestPhone);
        if (guestConvos.length === 0) {
          return res.send("END No reports found. Dial *384*2244# to report an issue.");
        }
        const latestConvo = guestConvos[0];
        const ticketData = latestConvo.ticket ? `\nTicket: ${latestConvo.ticket.cat}\nStatus: ${latestConvo.ticket.status}` : "";
        return res.send(`END Latest Report:\n${latestConvo.preview}${ticketData}`);
      } else if (userInput === "4") {
        ussdSessions.delete(guestPhone);
        return res.send(
          `END For complex issues, message us on WhatsApp:\n${WHATSAPP_SUPPORT_NUMBER}\n\nReply 0 to return to menu.`
        );
      }
      return res.send("CON Invalid choice. Select 1-4:\n1. Report\n2. Follow-up\n3. Updates\n4. WhatsApp\n0. Menu");
    }

    // REPORT SUBMISSION FLOW
    if (session.stage === "report_description") {
      const issueText = userInput;
      const aiResult = await analyseMessage(issueText);

      const convo = upsertConversation(guestPhone, "ussd", aiResult, issueText);
      const ticket = createTicket(convo.id, aiResult);
      attachTicketToConversation(convo.id, ticket);

      console.log(`🎫 USSD Ticket created: ${ticket.id} | Priority: ${ticket.priority}`);

      if (aiResult.sentiment_label === "critical") {
        await callDutyManager(guestPhone, aiResult.category);
        ussdSessions.delete(guestPhone);
        return res.send(
          `END 🚨 CRITICAL ISSUE\nTicket: ${ticket.id}\nStatus: URGENT - Manager alerted!\nCall button available now.`
        );
      }

      session.stage = "menu";
      session.lastTicketId = ticket.id;
      ussdSessions.set(guestPhone, session);

      return res.send(
        `CON ✓ Report received!\nTicket: ${ticket.id}\nPriority: ${ticket.priority.toUpperCase()}\n\n1. Report another\n2. WhatsApp support\n0. Menu`
      );
    }

    // FOLLOW-UP ON REPORT
    if (session.stage === "followup_ticket_id") {
      const ticketId = userInput.toUpperCase();
      const ticket = tickets.find((t) => t.id === ticketId);

      if (!ticket) {
        session.stage = "menu";
        ussdSessions.set(guestPhone, session);
        return res.send("CON Ticket not found. Try again or press 0 for menu:\n");
      }

      const convo = conversations.find((c) => c.id === ticket.conversationId);
      if (!convo || convo.phone !== guestPhone) {
        session.stage = "menu";
        ussdSessions.set(guestPhone, session);
        return res.send("CON This ticket is not associated with your number. Press 0 for menu:\n");
      }

      const statusEmoji = ticket.status === "open" ? "⏳" : ticket.status === "in-progress" ? "🔄" : "✓";

      ussdSessions.delete(guestPhone);
      return res.send(
        `END ${statusEmoji} Ticket: ${ticket.id}\nCategory: ${ticket.category}\nStatus: ${ticket.status.toUpperCase()}\nAssigned to: ${ticket.assignedTo}`
      );
    }

    // Fallback
    session.stage = "menu";
    ussdSessions.set(guestPhone, session);
    return res.send("CON Invalid input. Press 0 for menu:\n");
  } catch (err) {
    console.error("USSD webhook error:", err.message);
    ussdSessions.delete(guestPhone);
    return res.send("END Sorry, service is temporarily unavailable. Please try again.");
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
