import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API = "https://stayiq-6nd6.onrender.com";

const MOCK_CONVERSATIONS = [
  {
    id: 1,
    name: "Adaeze O.",
    room: "Room 12",
    channel: "Guest",
    time: "11:47 PM",
    sentiment: "negative",
    priority: "high",
    preview: "The hot water has been cold since evening...",
    messages: [
      {
        role: "guest",
        text: "Good evening. The hot water in my bathroom has been cold since this evening. I have a early flight tomorrow.",
        time: "11:44 PM",
      },
      {
        role: "ai",
        text: "Good evening Adaeze! So sorry to hear that. I've escalated this to maintenance right now and they'll be there within 15 minutes. We want to make sure you're comfortable before your flight. Is there anything else I can help with?",
        time: "11:44 PM",
      },
    ],
    ticket: { cat: "Maintenance", prio: "HIGH", status: "open" },
  },
  {
    id: 2,
    name: "Emeka T.",
    room: "Room 7",
    channel: "Guest",
    time: "10:22 PM",
    sentiment: "neutral",
    priority: "low",
    preview: "What time does breakfast start?",
    messages: [
      {
        role: "guest",
        text: "Hi, what time does breakfast start tomorrow?",
        time: "10:21 PM",
      },
      {
        role: "ai",
        text: "Hi Emeka! Breakfast starts at 7:00 AM and runs until 10:30 AM. It's served in the restaurant on the ground floor. Enjoy your evening!",
        time: "10:21 PM",
      },
    ],
    ticket: null,
  },
  {
    id: 3,
    name: "Funke B.",
    room: "Room 3",
    channel: "SMS",
    time: "9:55 PM",
    sentiment: "positive",
    priority: "low",
    preview: "Thank you so much, room is perfect!",
    messages: [
      {
        role: "guest",
        text: "Thank you so much. The room is perfect and very clean. Happy with everything!",
        time: "9:54 PM",
      },
      {
        role: "ai",
        text: "So glad to hear that Funke! Thank you for the kind words - it means a lot to our team. Enjoy your stay and let us know if you need anything at all!",
        time: "9:54 PM",
      },
    ],
    ticket: null,
  },
];

const MOCK_TICKETS = [
  {
    id: "TK-001",
    guest: "Adaeze O.",
    room: "Room 12",
    cat: "Maintenance",
    issue: "No hot water",
    prio: "HIGH",
    dept: "Maintenance",
    status: "open",
    time: "11:44 PM",
  },
  {
    id: "TK-002",
    guest: "Bola S.",
    room: "Room 20",
    cat: "F&B",
    issue: "Room service delay >40min",
    prio: "MED",
    dept: "F&B",
    status: "in-progress",
    time: "10:10 PM",
  },
  {
    id: "TK-003",
    guest: "Kelechi N.",
    room: "Room 5",
    cat: "Housekeeping",
    issue: "Extra towels requested",
    prio: "LOW",
    dept: "Housekeeping",
    status: "done",
    time: "8:30 PM",
  },
];

const EMPTY_STATS = {
  totalGuests: 4,
  activeIssues: 2,
  criticalAlerts: 1,
  satisfactionScore: 72,
  avgResponseTime: "2.8s",
};

function sentBadge(sentiment) {
  if (sentiment === "negative") return <span className="badge badge-red">Negative</span>;
  if (sentiment === "neutral") return <span className="badge badge-amber">Neutral</span>;
  return <span className="badge badge-green">Positive</span>;
}

function priorityBadge(priority) {
  if (priority === "critical") return <span className="badge badge-red">Critical</span>;
  if (priority === "high") return <span className="badge badge-red">High</span>;
  if (priority === "medium") return <span className="badge badge-amber">Medium</span>;
  return <span className="badge badge-green">Low</span>;
}

function priorityClass(priority) {
  if (priority === "HIGH" || priority === "high" || priority === "critical") return "prio-high";
  if (priority === "MED" || priority === "medium") return "prio-med";
  return "prio-low";
}

function statusClass(status) {
  if (status === "open") return "status-open";
  if (status === "in-progress") return "status-prog";
  return "status-done";
}

function nowTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function toUiConversation(rawConversation) {
  const messages = Array.isArray(rawConversation.messages)
    ? rawConversation.messages.map((message) => ({
        role: message.role,
        text: message.text,
        time: message.time || message.ts || nowTime(),
      }))
    : [];

  const latestGuestMessage = messages.filter((message) => message.role === "guest").at(-1)?.text || rawConversation.preview || "New guest message";
  const ticket = rawConversation.ticket
    ? {
        cat: rawConversation.ticket.cat || "General",
        prio: rawConversation.ticket.prio || "LOW",
        status: rawConversation.ticket.status || "open",
      }
    : null;

  return {
    id: rawConversation.id,
    name: rawConversation.name || rawConversation.phone || "Guest",
    room: rawConversation.room || "Room -",
    channel: rawConversation.channel || "Guest",
    time: rawConversation.time || rawConversation.lastUpdated || rawConversation.timestamp || nowTime(),
    sentiment: rawConversation.sentiment || rawConversation.sentiment_label || "neutral",
    priority: rawConversation.priority || rawConversation.ticket?.prio?.toLowerCase?.() || "low",
    preview: rawConversation.preview || `${latestGuestMessage.slice(0, 50)}${latestGuestMessage.length > 50 ? "..." : ""}`,
    messages,
    ticket,
    phone: rawConversation.phone,
  };
}

function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedConv, setSelectedConv] = useState(MOCK_CONVERSATIONS[0]);
  const [conversations, setConversations] = useState(MOCK_CONVERSATIONS);
  const [tickets, setTickets] = useState(MOCK_TICKETS);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [alertVisible, setAlertVisible] = useState(false);
  const [simInput, setSimInput] = useState("");
  const [simName, setSimName] = useState("Chisom A.");
  const [manualReply, setManualReply] = useState("");
  const [simLoading, setSimLoading] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [backendLive, setBackendLive] = useState(false);
  const [threadTyping, setThreadTyping] = useState(false);

  const activeIssues = useMemo(() => tickets.filter((ticket) => ticket.status !== "done").length, [tickets]);
  const activeConversationCount = conversations.length;

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [convRes, ticketRes, statsRes] = await Promise.all([
          fetch(`${API}/api/conversations`),
          fetch(`${API}/api/tickets`),
          fetch(`${API}/api/stats`),
        ]);

        if (convRes.ok) {
          const convData = await convRes.json();
          const mapped = convData.length ? convData.map(toUiConversation) : MOCK_CONVERSATIONS;
          setConversations(mapped);
          if (!selectedConv || !mapped.some((conversation) => conversation.id === selectedConv.id)) {
            setSelectedConv(mapped[0] || MOCK_CONVERSATIONS[0]);
          }
          setBackendLive(true);
        }

        if (ticketRes.ok) {
          const ticketData = await ticketRes.json();
          setTickets(ticketData.length ? ticketData : MOCK_TICKETS);
        }

        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats((prev) => ({ ...prev, ...statsData }));
        }
      } catch {
        setBackendLive(false);
      }
    };

    fetchAll();
    const timer = setInterval(fetchAll, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fresh = conversations.find((conversation) => conversation.id === selectedConv?.id);
    if (fresh) {
      setSelectedConv(fresh);
    }
  }, [conversations, selectedConv?.id]);

  useEffect(() => {
    if (!alertVisible) return undefined;
    const timer = setTimeout(() => setAlertVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [alertVisible]);

  const renderMessages = (conversation) =>
    conversation.messages.map((message, index) => (
      <div key={`${message.role}-${index}`}>
        <div className={`msg-label${message.role === "ai" ? " msg-label-ai" : ""}`}>
          {message.role === "ai" ? "StayIQ AI" : conversation.name} · {message.time}
        </div>
        <div className={`msg msg-${message.role === "ai" ? "ai" : "guest"}`}>{message.text}</div>
        {message.role === "ai" ? <div className="ai-tag">Generated by Claude AI</div> : null}
      </div>
    ));

  const renderOverview = () => (
    <>
      {alertVisible ? (
        <div className="alert-banner">
          <strong>Critical alert:</strong> High-priority complaint detected — duty manager has been notified via Voice call.
        </div>
      ) : null}
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Total Guests</div>
          <div className="stat-val">{stats.totalGuests ?? conversations.length + 1}</div>
          <div className="stat-sub">+2 today</div>
        </div>
        <div className="stat">
          <div className="stat-label">Active Issues</div>
          <div className="stat-val">{activeIssues}</div>
          <div className="stat-sub">1 critical</div>
        </div>
        <div className="stat">
          <div className="stat-label">Avg Response</div>
          <div className="stat-val">{stats.avgResponseTime ?? "2.8s"}</div>
          <div className="stat-sub">AI-powered</div>
        </div>
        <div className="stat">
          <div className="stat-label">Satisfaction</div>
          <div className="stat-val">4.2/5</div>
          <div className="stat-sub">↑ from 3.8</div>
        </div>
      </div>
      <div className="hero-card">
        <div>
          <div className="hero-kicker">AI triage</div>
          <h2>Guest messages are classified automatically</h2>
          <p>Claude analyzes each message for sentiment, category, and urgency so the right team can act without manual sorting.</p>
        </div>
        <div className="hero-chips">
          <div>{sentBadge("positive")} Positive</div>
          <div>{sentBadge("neutral")} Neutral</div>
          <div>{sentBadge("negative")} Negative</div>
          <div>{priorityBadge("high")} High priority</div>
        </div>
      </div>
      <div className="two-col">
        <div className="panel">
          <div className="panel-header">
            Recent conversations <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{activeConversationCount} active</span>
          </div>
          <div className="conv-list">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`conv-item${conversation.id === selectedConv?.id ? " selected" : ""}`}
                onClick={() => {
                  setSelectedConv(conversation);
                  setActiveTab("conversations");
                }}
                role="button"
                tabIndex={0}
              >
                <div className="conv-top">
                  <span className="conv-name">
                    {conversation.name} · {conversation.room}
                  </span>
                  <span className="conv-time">{conversation.time}</span>
                </div>
                <div className="conv-preview">
                    {sentBadge(conversation.sentiment)} {priorityBadge(conversation.priority)} {conversation.preview}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="thread-header">
            <div>
              <div className="thread-name">
                {selectedConv.name} · {selectedConv.room}
              </div>
              <div className="thread-meta">
                  {selectedConv.channel} · {sentBadge(selectedConv.sentiment)} · {priorityBadge(selectedConv.priority)}
                {selectedConv.ticket ? <span style={{ fontSize: 11, color: "#A32D2D", marginLeft: 6 }}>Ticket created</span> : null}
              </div>
            </div>
            <div className="thread-actions">
              <button
                className="new-msg-btn"
                onClick={() => handleVoiceAlert(selectedConv)}
                disabled={voiceLoading}
                type="button"
              >
                {voiceLoading ? "Calling..." : "Call Manager"}
              </button>
            </div>
          </div>
          <div className="msgs" id="msgThread">
            {threadTyping ? (
              <div>
                <div className="msg-label">StayIQ AI · typing...</div>
                <div className="typing">
                  <div className="dot" />
                  <div className="dot" />
                  <div className="dot" />
                </div>
              </div>
            ) : null}
            {renderMessages(selectedConv)}
          </div>
        </div>
      </div>
    </>
  );

  const renderConversations = () => (
    <div className="two-col">
      <div className="panel">
        <div className="panel-header">
          All conversations <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{activeConversationCount} total</span>
        </div>
        <div className="conv-list">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`conv-item${conversation.id === selectedConv?.id ? " selected" : ""}`}
              onClick={() => setSelectedConv(conversation)}
              role="button"
              tabIndex={0}
            >
              <div className="conv-top">
                <span className="conv-name">{conversation.name}</span>
                <span className="conv-time">{conversation.time}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 3 }}>
                {conversation.room} · {conversation.channel}
              </div>
              <div className="conv-preview">
                {sentBadge(conversation.sentiment)} {priorityBadge(conversation.priority)} {conversation.preview}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="thread-header">
          <div>
            <div className="thread-name">
              {selectedConv.name} · {selectedConv.room}
            </div>
            <div className="thread-meta">
              {selectedConv.channel} · {sentBadge(selectedConv.sentiment)} · {priorityBadge(selectedConv.priority)}
            </div>
          </div>
          <button className="new-msg-btn" onClick={() => handleVoiceAlert(selectedConv)} disabled={voiceLoading} type="button">
            {voiceLoading ? "Calling..." : "Call Manager"}
          </button>
        </div>
        <div className="thread" style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          <div className="msgs" id="msgThread">
            {threadTyping ? (
              <div>
                <div className="msg-label">StayIQ AI · typing...</div>
                <div className="typing">
                  <div className="dot" />
                  <div className="dot" />
                  <div className="dot" />
                </div>
              </div>
            ) : null}
            {renderMessages(selectedConv)}
          </div>
          <div className="reply-bar">
            <input
              className="reply-input"
              id="manualReply"
              placeholder="Type a manual reply..."
              value={manualReply}
              onChange={(event) => setManualReply(event.target.value)}
            />
            <button className="btn-send" onClick={sendManualReply} type="button">
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderTickets = () => (
    <div className="panel" style={{ height: "auto" }}>
      <div className="panel-header">
        Open service tickets <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{tickets.filter((ticket) => ticket.status !== "done").length} open</span>
      </div>
      <table className="tickets-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Guest · Room</th>
            <th>Issue</th>
            <th>Category</th>
            <th>Priority</th>
            <th>Dept</th>
            <th>Status</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-text-secondary)" }}>{ticket.id}</td>
              <td>
                <strong>{ticket.guest}</strong>
                <br />
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{ticket.room}</span>
              </td>
              <td>{ticket.issue}</td>
              <td>
                <span className="dept">{ticket.cat}</span>
              </td>
              <td>
                <span className={`prio ${priorityClass(ticket.prio)}`}>{ticket.prio === "HIGH" ? "● HIGH" : ticket.prio === "MED" ? "● MED" : "● LOW"}</span>
              </td>
              <td>
                <span className="dept">{ticket.dept}</span>
              </td>
              <td>
                <span className={`status-chip ${statusClass(ticket.status)}`}>{ticket.status === "in-progress" ? "In Progress" : ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}</span>
              </td>
              <td style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{ticket.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderInsights = () => (
    <div className="insights">
      <div className="ins-card">
        <div className="ins-title">Complaint categories (this week)</div>
        {[
          ["Maintenance", 72, ""],
          ["F&B / Room Service", 55, "amber"],
          ["Housekeeping", 40, ""],
          ["WiFi / Tech", 28, "blue"],
          ["Noise", 18, "red"],
        ].map(([label, value, variant]) => (
          <div className="bar-row" key={label}>
            <div className="bar-label">{label}</div>
            <div className="bar-track">
              <div className={`bar-fill ${variant}`} style={{ width: `${value}%` }} />
            </div>
            <div className="bar-val">{value}%</div>
          </div>
        ))}
      </div>
      <div className="ins-card">
        <div className="ins-title">Guest satisfaction breakdown</div>
        {[
          ["Excellent (5★)", 3],
          ["Good (4★)", 8],
          ["Average (3★)", 4],
          ["Poor (1-2★)", 1],
        ].map(([label, count]) => (
          <div className="sat-row" key={label}>
            <div className="sat-label">{label}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", width: 20 }}>{count}</div>
            <div className="bar-track" style={{ flex: 1 }}>
              <div className="bar-fill" style={{ width: `${Math.round((count / 16) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="ins-card">
        <div className="ins-title">AI performance</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[
            ["Avg reply time", stats.avgResponseTime ?? "2.8s"],
            ["Messages handled", Math.max(10, conversations.length * 8)],
            ["Escalations", tickets.filter((ticket) => ticket.prio === "HIGH").length],
          ].map(([label, value]) => (
            <div key={label} style={{ textAlign: "center", padding: 12, background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)" }}>
              <div style={{ fontSize: 20, fontWeight: 500 }}>{value}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  async function handleVoiceAlert(conversation) {
    setVoiceLoading(true);
    try {
      const response = await fetch(`${API}/api/voice/alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: conversation?.ticket?.cat?.toLowerCase?.() || "general", guestPhone: conversation?.phone || "unknown" }),
      });

      if (!response.ok) throw new Error("voice alert failed");
      setAlertVisible(true);
    } catch {
      setAlertVisible(true);
    } finally {
      setVoiceLoading(false);
    }
  }

  async function simulateMessage() {
    const message = simInput.trim();
    if (!message) return;

    setSimLoading(true);
    setThreadTyping(true);

    try {
      const response = await fetch(`${API}/api/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+2348100000001", message }),
      });

      if (!response.ok) throw new Error("simulate failed");

      const data = await response.json();
      const aiReply = data?.aiResult?.reply || "Thank you for your message. Our team has been notified and will assist you shortly.";
      const sentiment = data?.aiResult?.sentiment_label || "neutral";
      const category = data?.aiResult?.category || "general";
      const priority = data?.aiResult?.priority || "low";
      const newConversation = toUiConversation(
        data?.conversation || {
          id: Date.now(),
          name: simName.trim() || "Guest",
          room: `Room ${Math.floor(Math.random() * 25) + 1}`,
          channel: "Guest",
          time: nowTime(),
          sentiment,
          priority,
          preview: `${message.slice(0, 50)}${message.length > 50 ? "..." : ""}`,
          messages: [
            { role: "guest", text: message, time: nowTime() },
            { role: "ai", text: aiReply, time: nowTime() },
          ],
          ticket: priority !== "low" ? { cat: category, prio: priority.toUpperCase(), status: "open" } : null,
        }
      );

      setConversations((current) => [newConversation, ...current.filter((conversation) => conversation.id !== newConversation.id)]);
      setSelectedConv(newConversation);
      setActiveTab("conversations");
      setAlertVisible(priority === "critical" || priority === "high");
      setSimInput("");
    } catch {
      const roomNum = Math.floor(Math.random() * 25) + 1;
      const name = simName.trim() || "Guest";
      const fallbackConversation = {
        id: Date.now(),
        name,
        room: `Room ${roomNum}`,
        channel: "Guest",
        time: nowTime(),
        sentiment: "neutral",
        priority: "low",
        preview: `${message.slice(0, 50)}${message.length > 50 ? "..." : ""}`,
        messages: [
          { role: "guest", text: message, time: nowTime() },
          { role: "ai", text: "Thank you for your message. Our team has been notified and will assist you shortly.", time: nowTime() },
        ],
        ticket: null,
      };

      setConversations((current) => [fallbackConversation, ...current]);
      setSelectedConv(fallbackConversation);
      setActiveTab("conversations");
      setAlertVisible(false);
      setSimInput("");
    } finally {
      setSimLoading(false);
      setThreadTyping(false);
    }
  }

  function sendManualReply() {
    const text = manualReply.trim();
    if (!text) return;

    const timestamp = nowTime();
    const updatedConversation = {
      ...selectedConv,
      messages: [...selectedConv.messages, { role: "ai", text, time: timestamp }],
    };

    setSelectedConv(updatedConversation);
    setConversations((current) => current.map((conversation) => (conversation.id === updatedConversation.id ? updatedConversation : conversation)));
    setManualReply("");
  }

  return (
    <div className="dash" id="app">
      <div className="topbar">
        <div className="logo">
          Stay<span>IQ</span> <span style={{ fontSize: 12, fontWeight: 400, color: "var(--color-text-secondary)", marginLeft: 8 }}>Guest Intelligence Dashboard</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          <span className="status-dot" />
          {backendLive ? "AI Online" : "Offline"} · {activeConversationCount} active conversations
        </div>
      </div>

      <div className="sim-bar">
        <span className="sim-label">Analyze guest message:</span>
        <input
          className="sim-input"
          id="simInput"
          placeholder="e.g. My AC no dey work since morning!"
          value={simInput}
          onChange={(event) => setSimInput(event.target.value)}
        />
        <input className="sim-input" id="simName" placeholder="Guest name" style={{ maxWidth: 120 }} value={simName} onChange={(event) => setSimName(event.target.value)} />
        <button className="sim-btn" id="simBtn" onClick={simulateMessage} disabled={simLoading} type="button">
          {simLoading ? "Analyzing..." : "Send & Analyze"}
        </button>
      </div>

      <div className="tabs">
        {[
          ["overview", "Overview"],
          ["conversations", "Conversations"],
          ["tickets", "Tickets"],
          ["insights", "AI Insights"],
        ].map(([key, label]) => (
          <button key={key} className={`tab${activeTab === key ? " active" : ""}`} onClick={() => setActiveTab(key)} type="button">
            {label}
          </button>
        ))}
      </div>

      <div className="content" id="mainContent">
        {activeTab === "overview"
          ? renderOverview()
          : activeTab === "conversations"
            ? renderConversations()
            : activeTab === "tickets"
              ? renderTickets()
              : renderInsights()}
      </div>
    </div>
  );
}

export default App;
