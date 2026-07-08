import { useState, useRef, useEffect } from "react";

const STORAGE_KEY = "mukesh-todos-v2";
const today = () => new Date().toISOString().split("T")[0];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function getOpeningMessage(overdueCount, todayCount) {
  const h = new Date().getHours();
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  let taskNote = "";
  if (overdueCount > 0) taskNote = `\n\n⚠️ You have ${overdueCount} overdue task${overdueCount > 1 ? "s" : ""} from previous days.`;
  else if (todayCount > 0) taskNote = `\n\n📅 You have ${todayCount} task${todayCount > 1 ? "s" : ""} due today.`;
  if (h < 12) return `It's ${date}. Ready to plan your day? Tell me what's on your mind and I'll organise everything for you.${taskNote}\n\nTap the button below and start talking.`;
  if (h < 17) return `It's ${date}. How's the day going? Anything new to capture, or want to review what's open?${taskNote}\n\nTap below when ready.`;
  return `It's ${date}. Time for your end of day review. What got done? What's still on your mind?${taskNote}\n\nTap below when ready.`;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function isOverdue(dateStr) { return dateStr && dateStr < today(); }
function isDueToday(dateStr) { return dateStr === today(); }

const CATEGORIES = ["Job search", "Income / business", "Personal", "Admin", "Fitness", "Follow-up"];
const PRIORITIES = ["High", "Medium", "Low"];
const priorityColor = { High: "#ef4444", Medium: "#f59e0b", Low: "#6b7280" };
const categoryColors = { "Job search": "#3b82f6", "Income / business": "#10b981", "Personal": "#8b5cf6", "Admin": "#6b7280", "Fitness": "#f59e0b", "Follow-up": "#ef4444" };

export default function DailyAssistant() {
  const [screen, setScreen] = useState("greeting");
  const [todos, setTodos] = useState(() => { try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : []; } catch { return []; } });
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState("");
  const [pendingTasks, setPendingTasks] = useState([]);
  const [filter, setFilter] = useState("all");
  const [successMsg, setSuccessMsg] = useState("");
  const [editingDate, setEditingDate] = useState(null);
  const [loading, setLoading] = useState(false);
  const recognitionRef = useRef(null);
  const restartRef = useRef(false);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(todos)); } catch {} }, [todos]);

  const overdueCount = todos.filter(t => isOverdue(t.dueDate) && !t.done).length;
  const todayCount = todos.filter(t => isDueToday(t.dueDate) && !t.done).length;
  const openCount = todos.filter(t => !t.done).length;

  function startListening() {
    setMicError("");
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setMicError("Voice not supported in this browser. Please type instead.");
      setScreen("listening");
      return;
    }

    // Request mic permission explicitly first
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then(() => {
        beginRecognition(SR);
      })
      .catch(() => {
        setMicError("Microphone permission denied. Please type instead or check Settings > Safari > Microphone.");
        setScreen("listening");
      });
  }

  function beginRecognition(SR) {
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = "en-GB";
    r.maxAlternatives = 1;

    r.onstart = () => {
      setIsRecording(true);
      setScreen("listening");
    };

    r.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalText += e.results[i][0].transcript + " ";
        } else {
          interimText += e.results[i][0].transcript;
        }
      }
      if (finalText) setTranscript(prev => prev + finalText);
      setInterimTranscript(interimText);
    };

    r.onend = () => {
      setIsRecording(false);
      setInterimTranscript("");
      // Auto restart if user hasn't manually stopped
      if (restartRef.current) {
        restartRef.current = false;
        return;
      }
      // On iOS, recognition stops frequently — restart automatically
      if (screen === "listening") {
        try {
          r.start();
          setIsRecording(true);
        } catch(e) {
          // Recognition ended naturally, that's fine
        }
      }
    };

    r.onerror = (e) => {
      setIsRecording(false);
      setInterimTranscript("");
      if (e.error === "not-allowed") {
        setMicError("Microphone blocked. Go to Settings > Safari > Microphone and allow access.");
      } else if (e.error === "no-speech") {
        // No speech detected, just restart quietly
        try { r.start(); setIsRecording(true); } catch {}
      } else if (e.error !== "aborted") {
        setMicError(`Mic error: ${e.error}. Try typing instead.`);
      }
    };

    recognitionRef.current = r;
    restartRef.current = false;
    try {
      r.start();
    } catch(e) {
      setMicError("Could not start microphone. Please type instead.");
      setScreen("listening");
    }
  }

  function stopListening() {
    restartRef.current = true;
    recognitionRef.current?.stop();
    setIsRecording(false);
    setInterimTranscript("");
  }

  async function processSpeech() {
    const fullText = (transcript + " " + interimTranscript).trim();
    if (!fullText) return;
    stopListening();
    setLoading(true);
    setScreen("processing");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content: `You are Jarvis, a smart personal assistant. The user has done a brain dump of everything on their mind. Your job is to carefully extract EVERY separate task, action, or thing they need to do — even if mentioned casually or in passing.

User said: "${fullText}"

Rules:
- Split into AS MANY separate tasks as possible. If they mention 5 things, create 5 tasks. Never merge separate actions into one task.
- Look for connecting words like "and", "also", "plus", "then", "I need to", "I should", "I have to", "don't forget" — each signals a new task.
- Each task title must start with an action verb (Call, Email, Book, Reply, Send, Follow up, Complete, Check, Update, Research, Apply, Message, etc.)
- Keep titles clear and concise — one action per task
- Category must be one of: Job search, Income / business, Personal, Admin, Fitness, Follow-up
- Priority: High (urgent or time-sensitive), Medium (this week), Low (someday/no rush)
- Due date as YYYY-MM-DD. Today is ${today()}. Use context: "today"=today, "tomorrow"=tomorrow, "this week"=within 7 days. If no date clue, use null.

Respond ONLY with a valid JSON array. No markdown, no explanation, no extra text:
[{"title":"...","category":"...","priority":"...","dueDate":"...or null"}]` }]
        })
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "[]";
      const tasks = JSON.parse(text.replace(/```json|```/g, "").trim());
      setPendingTasks(tasks.map((t, i) => ({ ...t, id: `p${i}` })));
    } catch {
      setPendingTasks([{ id: "p0", title: fullText, category: "Personal", priority: "Medium", dueDate: null }]);
    }
    setLoading(false);
    setScreen("confirm");
  }

  function updatePending(id, field, val) {
    setPendingTasks(p => p.map(t => t.id === id ? { ...t, [field]: val } : t));
  }

  function confirmTasks() {
    const newTasks = pendingTasks.map(t => ({ ...t, id: Date.now() + Math.random(), done: false, createdAt: today() }));
    setTodos(prev => [...prev, ...newTasks]);
    setPendingTasks([]);
    setTranscript("");
    setInterimTranscript("");
    setSuccessMsg(`${newTasks.length} task${newTasks.length > 1 ? "s" : ""} added!`);
    setTimeout(() => setSuccessMsg(""), 3000);
    setScreen("tasks");
  }

  function toggleDone(id) { setTodos(p => p.map(t => t.id === id ? { ...t, done: !t.done } : t)); }
  function deleteTodo(id) { setTodos(p => p.filter(t => t.id !== id)); }
  function updateTodo(id, field, val) { setTodos(p => p.map(t => t.id === id ? { ...t, [field]: val } : t)); }

  const filtered = todos.filter(t => {
    if (filter === "today") return isDueToday(t.dueDate) && !t.done;
    if (filter === "overdue") return isOverdue(t.dueDate) && !t.done;
    if (filter === "done") return t.done;
    return !t.done;
  });

  // GREETING
  if (screen === "greeting") return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#0f0f1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 40px rgba(99,102,241,0.4)" }}>
          <span style={{ fontSize: 32 }}>🤖</span>
        </div>
        <div style={{ background: "#1e1e32", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 20, borderTopLeftRadius: 4, padding: "20px 22px", marginBottom: 28 }}>
          <p style={{ margin: "0 0 6px", color: "#6366f1", fontSize: 13, fontWeight: 600, letterSpacing: "0.04em" }}>JARVIS</p>
          <p style={{ margin: 0, color: "#e2e8f0", fontSize: 16, lineHeight: 1.6, whiteSpace: "pre-line" }}>
            {getGreeting()}, Mukesh 👋{"\n\n"}{getOpeningMessage(overdueCount, todayCount)}
          </p>
        </div>
        <button onClick={startListening}
          style={{ width: "100%", padding: "16px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 600, cursor: "pointer", marginBottom: 12, boxShadow: "0 4px 20px rgba(99,102,241,0.4)" }}>
          🎙️ I'm ready — start listening
        </button>
        <button onClick={() => setScreen("listening")}
          style={{ width: "100%", padding: "14px", background: "rgba(255,255,255,0.06)", color: "#9ca3af", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, fontSize: 15, cursor: "pointer", marginBottom: 16 }}>
          ✏️ I'd rather type
        </button>
        {openCount > 0 && (
          <button onClick={() => setScreen("tasks")}
            style={{ width: "100%", padding: "12px", background: "transparent", color: "#6366f1", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 14, fontSize: 14, cursor: "pointer" }}>
            📋 View my {openCount} open task{openCount > 1 ? "s" : ""}
            {overdueCount > 0 && <span style={{ marginLeft: 8, background: "#ef4444", color: "#fff", borderRadius: 10, fontSize: 11, padding: "2px 7px" }}>{overdueCount} overdue</span>}
          </button>
        )}
      </div>
    </div>
  );

  // LISTENING
  if (screen === "listening") return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#0f0f1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div onClick={isRecording ? stopListening : startListening}
            style={{ width: 100, height: 100, borderRadius: "50%", background: isRecording ? "linear-gradient(135deg, #ef4444, #dc2626)" : "linear-gradient(135deg, #6366f1, #8b5cf6)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: isRecording ? "0 0 0 16px rgba(239,68,68,0.15), 0 0 0 32px rgba(239,68,68,0.07)" : "0 0 40px rgba(99,102,241,0.4)", transition: "all 0.3s" }}>
            <span style={{ fontSize: 40 }}>{isRecording ? "⏹" : "🎙️"}</span>
          </div>
          <p style={{ color: isRecording ? "#ef4444" : "#6366f1", fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>
            {isRecording ? "Listening… tap to stop" : "Tap mic to speak"}
          </p>
          <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>Talk naturally — I'll sort it all out</p>
        </div>

        {micError && (
          <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
            <p style={{ margin: 0, color: "#ef4444", fontSize: 13, lineHeight: 1.5 }}>⚠️ {micError}</p>
          </div>
        )}

        <div style={{ background: "#1e1e32", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 16, padding: 16, marginBottom: 16, minHeight: 90 }}>
          <p style={{ margin: "0 0 6px", color: "#6366f1", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em" }}>TRANSCRIPT</p>
          {(transcript || interimTranscript) ? (
            <p style={{ margin: 0, color: "#e2e8f0", fontSize: 15, lineHeight: 1.6 }}>
              {transcript}
              {interimTranscript && <span style={{ color: "#6b7280" }}>{interimTranscript}</span>}
            </p>
          ) : (
            <p style={{ margin: 0, color: "#4b5563", fontSize: 14, fontStyle: "italic" }}>Your words will appear here…</p>
          )}
        </div>

        <p style={{ color: "#4b5563", fontSize: 13, textAlign: "center", margin: "0 0 10px" }}>Or type it out:</p>
        <textarea value={transcript} onChange={e => setTranscript(e.target.value)}
          placeholder="Type anything on your mind…"
          rows={3}
          style={{ width: "100%", background: "#1e1e32", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "12px 14px", color: "#e2e8f0", fontSize: 14, resize: "none", outline: "none", fontFamily: "inherit", lineHeight: 1.6, boxSizing: "border-box", marginBottom: 14 }} />

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => { stopListening(); setTranscript(""); setInterimTranscript(""); setScreen("greeting"); }}
            style={{ flex: 1, padding: "13px", background: "rgba(255,255,255,0.06)", color: "#9ca3af", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>
            ← Back
          </button>
          <button onClick={processSpeech} disabled={!transcript.trim() && !interimTranscript.trim()}
            style={{ flex: 2, padding: "13px", background: (transcript || interimTranscript).trim() ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "#1e1e32", color: (transcript || interimTranscript).trim() ? "#fff" : "#4b5563", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Organise this →
          </button>
        </div>
      </div>
    </div>
  );

  // PROCESSING
  if (screen === "processing") return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#0f0f1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 32 }}>⚡</span>
        </div>
        <p style={{ color: "#e2e8f0", fontSize: 17, fontWeight: 500, margin: "0 0 8px" }}>Organising your thoughts…</p>
        <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>Pulling out your tasks and priorities</p>
      </div>
    </div>
  );

  // CONFIRM
  if (screen === "confirm") return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#0f0f1a", padding: "24px 16px 40px" }}>
      <div style={{ maxWidth: 420, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <p style={{ color: "#6366f1", fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", margin: "0 0 4px" }}>JARVIS</p>
          <p style={{ color: "#e2e8f0", fontSize: 16, margin: "0 0 4px", fontWeight: 500 }}>Here's what I got from you:</p>
          <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>Tweak anything, then confirm.</p>
        </div>
        {pendingTasks.map(task => (
          <div key={task.id} style={{ background: "#1e1e32", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <input value={task.title} onChange={e => updatePending(task.id, "title", e.target.value)}
              style={{ width: "100%", background: "#0f0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 12px", fontSize: 14, color: "#e2e8f0", outline: "none", boxSizing: "border-box", marginBottom: 10, fontFamily: "inherit", fontWeight: 500 }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={task.category} onChange={e => updatePending(task.id, "category", e.target.value)}
                style={{ flex: 1, minWidth: 120, background: "#0f0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "#9ca3af", outline: "none" }}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <select value={task.priority} onChange={e => updatePending(task.id, "priority", e.target.value)}
                style={{ flex: 1, minWidth: 90, background: "#0f0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "#9ca3af", outline: "none" }}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
              <input type="date" value={task.dueDate || ""} onChange={e => updatePending(task.id, "dueDate", e.target.value || null)}
                style={{ flex: 1, minWidth: 120, background: "#0f0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: task.dueDate ? "#9ca3af" : "#4b5563", outline: "none" }} />
            </div>
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button onClick={() => { setPendingTasks([]); setTranscript(""); setScreen("listening"); }}
            style={{ flex: 1, padding: "13px", background: "rgba(255,255,255,0.06)", color: "#9ca3af", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>
            ← Redo
          </button>
          <button onClick={confirmTasks}
            style={{ flex: 2, padding: "13px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Add {pendingTasks.length} task{pendingTasks.length > 1 ? "s" : ""} ✓
          </button>
        </div>
      </div>
    </div>
  );

  // TASKS LIST
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#0f0f1a", paddingBottom: 40 }}>
      <div style={{ background: "#13132a", padding: "16px 16px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ maxWidth: 420, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <p style={{ margin: 0, color: "#6b7280", fontSize: 12 }}>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
              <h1 style={{ margin: "2px 0 0", color: "#e2e8f0", fontSize: 18, fontWeight: 600 }}>My Tasks</h1>
            </div>
            <button onClick={() => setScreen("greeting")}
              style={{ padding: "8px 16px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              + Add
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[["overdue", overdueCount, "#ef4444"], ["today", todayCount, "#f59e0b"], ["open", openCount, "#6366f1"]].map(([k, count, color]) => (
              <button key={k} onClick={() => setFilter(k === "open" ? "all" : k)}
                style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 4px", cursor: "pointer", textAlign: "center" }}>
                <div style={{ color, fontSize: 18, fontWeight: 700 }}>{count}</div>
                <div style={{ color: "#6b7280", fontSize: 11, textTransform: "capitalize" }}>{k}</div>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 12 }}>
            {[["all", "All open"], ["today", "Today"], ["overdue", "Overdue"], ["done", "Done"]].map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                style={{ flexShrink: 0, padding: "5px 14px", borderRadius: 20, border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", background: filter === k ? "#6366f1" : "rgba(255,255,255,0.06)", color: filter === k ? "#fff" : "#6b7280" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ maxWidth: 420, margin: "0 auto", padding: "16px 16px 0" }}>
        {successMsg && (
          <div style={{ background: "#064e3b", color: "#6ee7b7", padding: "10px 14px", borderRadius: 10, fontSize: 14, marginBottom: 14, fontWeight: 500 }}>✓ {successMsg}</div>
        )}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#4b5563" }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>{filter === "done" ? "🎉" : "✨"}</div>
            <p style={{ margin: 0, fontSize: 15 }}>{filter === "done" ? "Nothing completed yet" : "All clear!"}</p>
          </div>
        )}
        {filtered.map(task => (
          <div key={task.id} style={{ background: "#1e1e32", borderRadius: 14, padding: "14px 16px", marginBottom: 10, borderLeft: `3px solid ${priorityColor[task.priority]}`, opacity: task.done ? 0.5 : 1 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <button onClick={() => toggleDone(task.id)}
                style={{ width: 24, height: 24, borderRadius: "50%", border: `2px solid ${task.done ? "#10b981" : "#374151"}`, background: task.done ? "#10b981" : "transparent", cursor: "pointer", flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {task.done && <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>✓</span>}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 500, color: "#e2e8f0", textDecoration: task.done ? "line-through" : "none", lineHeight: 1.4 }}>{task.title}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 10, background: (categoryColors[task.category] || "#6b7280") + "22", color: categoryColors[task.category] || "#9ca3af" }}>{task.category}</span>
                  {task.dueDate ? (
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: isOverdue(task.dueDate) && !task.done ? "rgba(239,68,68,0.15)" : isDueToday(task.dueDate) ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.06)", color: isOverdue(task.dueDate) && !task.done ? "#ef4444" : isDueToday(task.dueDate) ? "#f59e0b" : "#9ca3af", fontWeight: 500 }}>
                      {isOverdue(task.dueDate) && !task.done ? "⚠ " : isDueToday(task.dueDate) ? "📅 " : ""}{formatDate(task.dueDate)}
                    </span>
                  ) : !task.done && (
                    <button onClick={() => setEditingDate(task.id)}
                      style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(255,255,255,0.04)", color: "#4b5563", border: "1px dashed #374151", cursor: "pointer" }}>
                      + due date
                    </button>
                  )}
                </div>
                {editingDate === task.id && (
                  <input type="date" autoFocus
                    onChange={e => { updateTodo(task.id, "dueDate", e.target.value || null); setEditingDate(null); }}
                    onBlur={() => setEditingDate(null)}
                    style={{ marginTop: 8, background: "#0f0f1a", border: "1px solid #6366f1", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: "#e2e8f0", outline: "none" }} />
                )}
              </div>
              <button onClick={() => deleteTodo(task.id)}
                style={{ background: "none", border: "none", color: "#374151", cursor: "pointer", fontSize: 18, padding: "0 2px", flexShrink: 0 }}>×</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
