/* Assistant page — local schedule assistant. No AI service is connected. */

const assistantEls = {
  date: document.querySelector("#assistantDate"),
  conversation: document.querySelector("#conversation"),
  empty: document.querySelector("#assistantEmpty"),
  starters: document.querySelector("#starterActions"),
  input: document.querySelector("#assistantInput"),
  send: document.querySelector("#sendButton"),
  voice: document.querySelector("#voiceButton"),
  voiceNotice: document.querySelector("#voiceNotice"),
  clear: document.querySelector("#clearConversation"),
  nav: document.querySelector("#navAssistant")
};

let voiceNoticeTimer = null;

// Assistant page rendering — all dynamic text goes through textContent, never innerHTML
function renderConversationEntry(entry) {
  const message = document.createElement("div");
  message.className = entry.role === "user" ? "message user-message" : "message assistant-message";
  const text = document.createElement("p");
  text.textContent = entry.text;
  message.appendChild(text);
  if (entry.items && entry.items.length) {
    const list = document.createElement("ul");
    list.className = "response-list";
    for (const item of entry.items) {
      const row = document.createElement("li");
      const time = document.createElement("span");
      time.className = "response-time";
      time.textContent = item.time;
      const title = document.createElement("span");
      title.className = "response-title";
      title.textContent = item.title;
      const status = document.createElement("span");
      status.className = "response-status";
      status.textContent = item.status;
      row.append(time, title, status);
      list.appendChild(row);
    }
    message.appendChild(list);
  }
  assistantEls.conversation.appendChild(message);
  assistantEls.conversation.scrollTop = assistantEls.conversation.scrollHeight;
}

function renderConversation() {
  assistantEls.conversation.replaceChildren();
  for (const entry of conversation) renderConversationEntry(entry);
  assistantEls.empty.hidden = conversation.length > 0;
}

// Conversation persistence — separate key from schedule data, capped at the latest 30 entries
const ASSISTANT_STORAGE_KEY = "matson-time-assistant-v1";
const MAX_CONVERSATION_ENTRIES = 30;

function loadConversation() {
  try {
    const saved = localStorage.getItem(ASSISTANT_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(entry => entry && (entry.role === "user" || entry.role === "assistant") && typeof entry.text === "string").slice(-MAX_CONVERSATION_ENTRIES);
  } catch { return []; }
}

function saveConversation() {
  localStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(conversation.slice(-MAX_CONVERSATION_ENTRIES)));
}

let conversation = loadConversation();

// Local intent matching — deliberately limited to exact schedule questions
function getAssistantResponse(rawText) {
  const question = rawText.trim().toLowerCase().replace(/\?+$/, "");
  if (question === "what do i have today") return answerHaveToday();
  if (question === "what should i do now") return answerWhatNow();
  if (question === "what is coming next") return answerComingNext();
  if (question === "what is still remaining today") return answerRemaining();
  if (question === "what did i miss this week") return answerMissedWeek();
  return { text: "I can't process that request yet. The schedule assistant will support more natural instructions when its language service is connected." };
}

// Schedule response generation — reads the single schedule store
function todayItems() {
  return items.filter(item => item.date === localDateString(new Date()));
}

function listItem(item) {
  return { time: itemTime(item), title: item.title, status: item.status.replace("-", " ") };
}

function answerHaveToday() {
  const dateItems = sortForDate(todayItems());
  if (!dateItems.length) return { text: "Nothing is planned for today." };
  return { text: `You have ${dateItems.length} item${dateItems.length === 1 ? "" : "s"} planned today.`, items: dateItems.map(listItem) };
}

function answerWhatNow() {
  const attention = getAttentionItem(todayItems());
  if (!attention) return { text: "Nothing needs attention right now." };
  const reason = attention.status === "in-progress" ? "It is currently scheduled." : attention.postponed ? `It has been postponed ${attention.postponed} time${attention.postponed === 1 ? "" : "s"}.` : "It is the next item needing attention.";
  return { text: `${attention.title} — ${itemTime(attention)}. ${reason}`, items: [listItem(attention)] };
}

function answerComingNext() {
  const today = localDateString(new Date());
  const next = items
    .filter(item => item.date && item.start && item.status !== "completed" && item.status !== "cancelled" && item.date >= today)
    .sort((a, b) => (a.date + "|" + a.start).localeCompare(b.date + "|" + b.start))[0];
  if (!next) return { text: "Nothing is currently upcoming." };
  const when = next.date === today ? "today" : formatDateLabel(next.date);
  return { text: `Next up: ${next.title}, ${when} at ${formatTime(next.start)}.`, items: [{ time: when, title: next.title, status: next.status.replace("-", " ") }] };
}

function answerRemaining() {
  const remaining = sortForDate(todayItems().filter(item => item.status !== "completed" && item.status !== "cancelled"));
  if (!remaining.length) return { text: "Everything planned for today is complete." };
  return { text: `${remaining.length} item${remaining.length === 1 ? "" : "s"} remaining today.`, items: remaining.map(listItem) };
}

function answerMissedWeek() {
  const today = parseLocalDate(localDateString(new Date()));
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = localDateString(monday);
  const weekEnd = localDateString(sunday);
  const missed = items
    .filter(item => item.date && item.status === "missed" && item.date >= weekStart && item.date <= weekEnd)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!missed.length) return { text: "No missed items are recorded this week." };
  return { text: `You missed ${missed.length} item${missed.length === 1 ? "" : "s"} this week.`, items: missed.map(item => ({ time: formatDateLabel(item.date), title: item.title, status: "missed" })) };
}

function sendMessage(rawText) {
  const text = rawText.trim();
  if (!text) return;
  appendEntry({ role: "user", text });
  const response = getAssistantResponse(text);
  appendEntry({ role: "assistant", text: response.text, items: response.items });
  saveConversation();
}

function appendEntry(entry) {
  conversation.push(entry);
  renderConversationEntry(entry);
}

function submitInput() {
  sendMessage(assistantEls.input.value);
  assistantEls.input.value = "";
  assistantEls.input.style.height = "auto";
  assistantEls.input.focus();
}

// Input, starter actions, voice placeholder, and conversation controls
assistantEls.nav.addEventListener("click", () => {
  assistantEls.date.textContent = formatDateLabel(localDateString(new Date()));
  setView("assistant");
  assistantEls.conversation.scrollTop = assistantEls.conversation.scrollHeight;
});

assistantEls.send.addEventListener("click", submitInput);

assistantEls.input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitInput();
  }
});

assistantEls.input.addEventListener("input", () => {
  assistantEls.input.style.height = "auto";
  assistantEls.input.style.height = Math.min(assistantEls.input.scrollHeight, 120) + "px";
});

assistantEls.starters.addEventListener("click", event => {
  const starter = event.target.closest("[data-starter]");
  if (!starter) return;
  if (starter.dataset.starter === "add") { openAddDialog(); return; }
  sendMessage(starter.dataset.starter);
});

assistantEls.voice.addEventListener("click", () => {
  assistantEls.voiceNotice.hidden = false;
  clearTimeout(voiceNoticeTimer);
  voiceNoticeTimer = setTimeout(() => { assistantEls.voiceNotice.hidden = true; }, 3000);
});

assistantEls.clear.addEventListener("click", () => {
  conversation = [];
  saveConversation();
  renderConversation();
  assistantEls.input.focus();
});

renderConversation();
