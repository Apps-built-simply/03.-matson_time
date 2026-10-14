/* Assistant page — coordinator for deterministic and Gemini-assisted schedule requests */

const PENDING_MESSAGE_WRITES_KEY = `matson-time-pending-message-writes-${firebaseStore.getCurrentUser().uid}`;
const MAX_CONVERSATION_ENTRIES = 30;

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
  nav: document.querySelector("#navAssistant"),
  newConversation: document.querySelector("#newConversationButton"),
  recentConversations: document.querySelector("#recentConversations"),
  saveNotice: document.querySelector("#conversationSaveNotice"),
  saveText: document.querySelector("#conversationSaveText"),
  retrySave: document.querySelector("#retryConversationSave")
};

let voiceNoticeTimer = null;
let conversation = Array.isArray(window.initialConversation?.messages) ? window.initialConversation.messages.map(message => ({ role: message.role, text: message.text, kind: message.kind, resolved: message.resolved })) : [];
let activeConversationId = window.initialConversation?.id || window.initialAssistantState?.activeConversationId || null;
let pendingClarification = window.initialAssistantState?.pendingClarification || null;
let currentProposal = null;
let activePlanningContext = window.initialAssistantState?.planningContext || null;
let planningTopicResolved = false;
let persistenceQueue = Promise.resolve();
let pendingMessageWrites = loadPendingMessageWrites();

function loadPendingMessageWrites() {
  try { const saved = JSON.parse(localStorage.getItem(PENDING_MESSAGE_WRITES_KEY) || "[]"); return Array.isArray(saved) ? saved : []; }
  catch { return []; }
}
function savePlanningContext() {
  firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext }).catch(showPersistenceFailure);
}
function saveConversation() { /* Conversation writes are queued by appendEntry. */ }

async function ensureConversation() {
  if (activeConversationId) return activeConversationId;
  activeConversationId = await firebaseStore.createConversation({ title: "New conversation", status: "active" });
  await firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext });
  await refreshRecentConversationList();
  return activeConversationId;
}

async function refreshRecentConversationList(max = 15) {
  const recent = await firebaseStore.listRecentConversations(max);
  const selected = activeConversationId;
  assistantEls.recentConversations.replaceChildren(new Option("Select conversation", ""));
  for (const item of recent) {
    const option = new Option(item.title || "Conversation", item.id);
    assistantEls.recentConversations.add(option);
  }
  if (max <= 15) assistantEls.recentConversations.add(new Option("Load older conversations…", "__load_more__"));
  assistantEls.recentConversations.value = selected || "";
}

function conversationSummary(status = "active") {
  const userMessages = conversation.filter(entry => entry.role === "user").map(entry => entry.text);
  const title = (userMessages[0] || "Matson Time conversation").slice(0, 72);
  const summary = conversation.slice(-6).map(entry => `${entry.role === "user" ? "Matson" : "Assistant"}: ${entry.text}`).join(" ").slice(0, 500);
  return { title, summary, keywords: firebaseStore.tokenizeKeywords(`${title} ${summary}`), status };
}

function updateSummaryIfPlanningResolved() {
  if (!planningTopicResolved || !activeConversationId) return;
  planningTopicResolved = false;
  firebaseStore.updateConversationSummary(activeConversationId, conversationSummary("active")).catch(showPersistenceFailure);
}

async function getRecallContext(text) {
  if (!/\b(remember|recall|asked about|talked about|discussed|previous conversation|last time|earlier conversation)\b/i.test(text)) return null;
  const keywords = firebaseStore.tokenizeKeywords(text);
  if (!keywords.length) return null;
  try {
    const [matches, memories] = await Promise.all([
      firebaseStore.searchConversationSummaries(keywords, 5),
      firebaseStore.searchMemories(keywords, 5)
    ]);
    const conversations = [];
    for (const match of matches.slice(0, 3)) {
      const loaded = await firebaseStore.loadConversation(match.id, 8);
      const relevant = loaded.messages.filter(message => {
        const words = new Set(firebaseStore.tokenizeKeywords(message.text));
        return keywords.some(word => words.has(word));
      }).slice(-3).map(message => ({ role: message.role, text: String(message.text).slice(0, 220) }));
      conversations.push({ title: String(match.title || "").slice(0, 80), summary: String(match.summary || "").slice(0, 300), messages: relevant });
    }
    return {
      conversations,
      memories: memories.map(memory => ({ type: String(memory.type || ""), text: String(memory.text || "").slice(0, 240) }))
    };
  } catch (error) {
    console.error("Conversation recall failed", { name: error?.name || "Error", message: String(error?.message || error) });
    return null;
  }
}

async function startNewConversation() {
  if (activeConversationId) {
    await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
    await firebaseStore.updateConversationSummary(activeConversationId, conversationSummary("archived"));
  }
  activeConversationId = null;
  conversation = [];
  pendingClarification = null;
  currentProposal = null;
  activePlanningContext = null;
  await firebaseStore.clearAssistantState();
  renderConversation();
  await refreshRecentConversationList();
  assistantEls.recentConversations.value = "";
}

async function openConversation(id) {
  if (!id) return;
  if (id === "__load_more__") {
    await refreshRecentConversationList(1000);
    assistantEls.recentConversations.value = activeConversationId || "";
    return;
  }
  try {
    if (activeConversationId && activeConversationId !== id) {
      await firebaseStore.updateConversationSummary(activeConversationId, conversationSummary("archived"));
    }
    const loaded = await firebaseStore.loadConversation(id, 50);
    await firebaseStore.updateConversationSummary(id, { status: "active" });
    activeConversationId = id;
    conversation = loaded.messages.map(message => ({
      role: message.role,
      text: message.text,
      kind: message.kind,
      resolved: message.resolved !== false
    }));
    currentProposal = null;
    const state = await firebaseStore.loadAssistantState();
    const isActive = state.activeConversationId === id;
    pendingClarification = isActive ? state.pendingClarification : null;
    activePlanningContext = isActive ? state.planningContext : null;
    await firebaseStore.saveAssistantState({ activeConversationId: id, pendingClarification, planningContext: activePlanningContext });
    renderConversation();
  } catch (error) {
    showPersistenceFailure();
    console.error("Conversation load failed", { name: error?.name || "Error", message: String(error?.message || error) });
  }
}

function showPersistenceFailure() {
  assistantEls.saveNotice.hidden = false;
  assistantEls.saveText.textContent = "A message is waiting to sync. Retry when your connection is available.";
}

async function persistPendingMessages() {
  try {
    while (pendingMessageWrites.length) {
      const pending = pendingMessageWrites[0];
      pending.conversationId = pending.conversationId || await ensureConversation();
      localStorage.setItem(PENDING_MESSAGE_WRITES_KEY, JSON.stringify(pendingMessageWrites));
      await firebaseStore.addConversationMessage(pending.conversationId, pending.message);
      pendingMessageWrites.shift();
      localStorage.setItem(PENDING_MESSAGE_WRITES_KEY, JSON.stringify(pendingMessageWrites));
    }
    pendingMessageWrites = [];
    localStorage.removeItem(PENDING_MESSAGE_WRITES_KEY);
    assistantEls.saveNotice.hidden = true;
  } catch (error) {
    localStorage.setItem(PENDING_MESSAGE_WRITES_KEY, JSON.stringify(pendingMessageWrites));
    showPersistenceFailure();
    console.error("Conversation message save failed", { name: error?.name || "Error", message: String(error?.message || error) });
  }
}

function appendEntry(entry) {
  conversation.push(entry);
  renderConversationEntry(entry);
  const message = {
    id: crypto.randomUUID(),
    role: entry.role, text: entry.text, kind: entry.kind || (entry.role === "user" ? "user_message" : "assistant_message"),
    referencedItemIds: entry.referencedItemIds || [], proposalSummary: entry.proposalSummary || null,
    resolved: entry.resolved !== false
  };
  pendingMessageWrites.push({ conversationId: activeConversationId, message });
  localStorage.setItem(PENDING_MESSAGE_WRITES_KEY, JSON.stringify(pendingMessageWrites));
  persistenceQueue = persistenceQueue.then(persistPendingMessages);
}

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
  for (const entry of conversation) {
    const displayEntry = entry.resolved === false
      ? { ...entry, text: `${entry.text} (This earlier proposal expired when you left the conversation; request it again to review it.)` }
      : entry;
    renderConversationEntry(displayEntry);
  }
  assistantEls.empty.hidden = conversation.length > 0;
  if (conversation.length > 0) {
    assistantEls.conversation.scrollTop = assistantEls.conversation.scrollHeight;
  }
}

function renderProposal(proposal) {
  const container = document.createElement("div");
  container.className = "proposal";
  container.dataset.proposalId = proposal.id || "current";

  const header = document.createElement("div");
  header.className = "proposal-header";
  const title = document.createElement("h3");
  title.textContent = getProposalTitle(proposal);
  header.appendChild(title);
  container.appendChild(header);

  const details = document.createElement("div");
  details.className = "proposal-details";

  if (proposal.plan) {
    renderPlanDetails(details, proposal);
  } else if (proposal.action?.item) {
    const item = proposal.action.item;
    addDetailRow(details, "Type", item.type);
    addDetailRow(details, "Date", item.date || "");
    if (item.start) addDetailRow(details, "Start", item.start);
    if (item.end) addDetailRow(details, "End", item.end);
    addDetailRow(details, "Category", item.category);
    if (proposal.conflict) {
      const conflictRow = document.createElement("div");
      conflictRow.className = "conflict";
      conflictEl = document.createElement("strong");
      conflictEl.textContent = "Schedule conflict:";
      conflictRow.appendChild(conflictEl);
      const conflictText = document.createTextNode(` ${proposal.conflict.items.join(" and ")} overlap.`);
      conflictRow.appendChild(conflictText);
      details.appendChild(conflictRow);
    }
  }

  if (proposal.action?.changes) {
    const changesEl = document.createElement("div");
    changesEl.className = "proposal-changes";
    const changesTitle = document.createElement("strong");
    changesTitle.textContent = "Changed fields:";
    changesEl.appendChild(changesTitle);
    const list = document.createElement("ul");
    list.className = "change-list";
    for (const [field, value] of Object.entries(proposal.action.changes)) {
      if (value === null || value === undefined) continue;
      const li = document.createElement("li");
      li.textContent = `${field}: ${value}`;
      list.appendChild(li);
    }
    changesEl.appendChild(list);
    details.appendChild(changesEl);
  }

  if (proposal.action?.postponeMinutes) {
    addDetailRow(details, "Postpone by", `${proposal.action.postponeMinutes} minutes`);
  }

  container.appendChild(details);

  const actionsEl = document.createElement("div");
  actionsEl.className = "proposal-actions";
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "primary-button";
  confirmBtn.textContent = proposal.plan ? "Confirm plan" : "Confirm";
  confirmBtn.dataset.action = "confirm";
  const editBtn = document.createElement("button");
  editBtn.className = "secondary-button";
  editBtn.textContent = "Edit";
  editBtn.dataset.action = "edit";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "secondary-button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.dataset.action = "cancel";
  actionsEl.append(confirmBtn, editBtn, cancelBtn);
  container.appendChild(actionsEl);

  assistantEls.conversation.appendChild(container);
  assistantEls.conversation.scrollTop = assistantEls.conversation.scrollHeight;
}

function renderPlanDetails(container, proposal) {
  const recommendation = document.createElement("p");
  recommendation.className = "plan-recommendation";
  recommendation.textContent = proposal.message;
  container.appendChild(recommendation);

  const list = document.createElement("ol");
  list.className = "plan-action-list";
  proposal.plan.actions.forEach((action, index) => {
    const item = action.item || saFindItemById(action.targetId) || {};
    const entry = document.createElement("li");
    entry.className = "plan-action-item";
    const title = document.createElement("strong");
    title.textContent = item.title || action.changes?.title || action.type.replaceAll("_", " ");
    entry.appendChild(title);
    const details = document.createElement("p");
    details.textContent = `${item.date ? formatDateLabel(item.date) : "Date not specified"}${item.start ? ` · ${formatTime(item.start)}${item.end ? `–${formatTime(item.end)}` : ""}` : " · Anytime"}${item.category ? ` · ${item.category}` : ""}`;
    entry.appendChild(details);
    const editor = document.createElement("div");
    editor.className = "plan-editor";
    editor.hidden = true;
    if (action.item && ["create_item", "reschedule_item"].includes(action.type)) {
      addPlanEditField(editor, index, "title", "Title", item.title || "", "text");
      addPlanEditField(editor, index, "date", "Date", item.date || "", "date");
      addPlanEditField(editor, index, "start", "Start", item.start || "", "time");
      addPlanEditField(editor, index, "end", "End", item.end || "", "time");
      addPlanEditField(editor, index, "category", "Category", item.category || "Personal", "text");
    }
    entry.appendChild(editor);
    list.appendChild(entry);
  });
  container.appendChild(list);
}

function addPlanEditField(container, actionIndex, field, label, value, type) {
  const wrapper = document.createElement("label");
  wrapper.className = "plan-edit-field";
  wrapper.textContent = label;
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  input.dataset.actionIndex = String(actionIndex);
  input.dataset.planField = field;
  wrapper.appendChild(input);
  container.appendChild(wrapper);
}

function buildPlanProposalFromGeminiResponse(response) {
  return {
    id: crypto.randomUUID(),
    plan: { title: response.plan.title, actions: response.plan.actions.map(action => ({
      type: action.type,
      targetId: action.targetId || null,
      item: action.item ? { ...action.item } : null,
      changes: action.changes || null,
      postponeMinutes: action.postponeMinutes || null
    })) },
    message: response.message,
    planningContext: response.planningContext,
    source: "gemini"
  };
}

function addDetailRow(container, label, value) {
  const row = document.createElement("div");
  row.className = "detail-row";
  const labelEl = document.createElement("span");
  labelEl.className = "detail-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "detail-value";
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  container.appendChild(row);
}

function getProposalTitle(proposal) {
  if (proposal.plan) return proposal.plan.title || "Proposed plan";
  const actionType = proposal.action?.type;
  switch (actionType) {
    case "create_item": return "Propose new item";
    case "update_item": return "Propose update";
    case "reschedule_item": return "Propose reschedule";
    case "postpone_item": return "Propose postpone";
    case "complete_item": return "Propose complete";
    case "mark_missed": return "Propose mark missed";
    case "cancel_item": return "Propose cancel";
    default: return "Proposed action";
  }
}

function classifyRequest(message) {
  const text = message.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.?]+$/i, "");

  const planningPatterns = [
    /help (?:me )?(?:manage|plan|work this out)/i,
    /best way.*(?:schedule|manage|conflict|week|it|these)/i,
    /(?:based on|using) my schedule.*week/i,
    /fit this into my week/i,
    /resolve this conflict/i,
    /where should i move/i,
    /plan these for me/i,
    /what do you advise/i,
    /not enough time.*(?:gym|meeting|schedule|travel)/i,
    /(?:only|leaves me with).*\d+ minutes/i
  ];
  if (planningPatterns.some(pattern => pattern.test(text))) return "analytical_planning";

  const deterministicPatterns = [
    /what.*(?:have|doing).*(?:today|now)/i,
    /what should i do now/i,
    /what.*coming next/i,
    /what.*remaining today/i,
    /what.*still.*today/i,
    /what.*complete.*today/i,
    /what.*miss.*this week/i,
    /what.*have.*tomorrow/i,
    /what.*have.*friday/i,
    /what.*schedule.*week/i,
    /anything overdue/i,
    /any.*conflict/i,
    /awaiting check.in/i,
    /how many.*remain.*today/i,
    /what.*routines.*today/i,
    /how.*progress.*today/i,
    /how.*progress.*week/i,
    /what.*next.*studio/i,
    /anything.*at.*pm/i,
    /anything.*friday.*pm/i
  ];

  for (const pattern of deterministicPatterns) {
    if (pattern.test(text)) return "deterministic_query";
  }

  const directActionPatterns = [
    /mark.*completed/i,
    /mark.*done/i,
    /postpone.*15.*minute/i,
    /postpone.*30.*minute/i,
    /postpone.*one hour/i,
    /postpone.*this item/i,
    /cancel.*this item/i,
    /cancel.*item/i,
    /mark.*missed/i
  ];

  for (const pattern of directActionPatterns) {
    if (pattern.test(text)) return "direct_interface_action";
  }

  const analyticalPatterns = [
    /least busy/i,
    /when can i fit/i,
    /which activities.*postponed/i,
    /summarize.*week/i,
    /enough time.*between/i,
    /free time/i,
    /busiest day/i
  ];

  for (const pattern of analyticalPatterns) {
    if (pattern.test(text)) return "analytical_query";
  }

  return "natural_language_action";
}

function resolveDateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function resolveWeekday(weekday) {
  const weekdays = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const target = weekdays[weekday.toLowerCase()];
  if (target === undefined) return null;
  const now = new Date();
  const currentDay = now.getDay();
  let diff = target - currentDay;
  if (diff < 0 || (diff === 0 && now.getHours() >= 12)) diff += 7;
  const date = new Date();
  date.setDate(date.getDate() + diff);
  return localDateString(date);
}

function resolveRelativeDate(token) {
  const lower = token.toLowerCase();
  if (["today", "now"].includes(lower)) return localDateString(new Date());
  if (lower === "tomorrow") return resolveDateOffset(1);
  const weekday = resolveWeekday(lower);
  if (weekday) return weekday;
  return null;
}

function answerHaveToday() {
  const todayItemsList = saGetTodayItems();
  const sorted = sortForDate(todayItemsList);
  if (!sorted.length) return { text: "Nothing is planned for today." };
  const items = sorted.map(item => ({
    time: itemTime(item),
    title: item.title,
    status: item.status.replace("-", " ")
  }));
  return { text: `You have ${sorted.length} item${sorted.length === 1 ? "" : "s"} planned today.`, items };
}

function answerWhatNow() {
  const attention = saGetCurrentOrNextItem();
  if (!attention || attention.date !== localDateString(new Date())) {
    const todayItemsList = saGetTodayItems();
    const attentionToday = getAttentionItem(todayItemsList);
    if (!attentionToday) return { text: "Nothing needs attention right now." };
    const reason = attentionToday.status === "in-progress"
      ? "It is currently scheduled."
      : attentionToday.postponed
        ? `It has been postponed ${attentionToday.postponed} time${attentionToday.postponed === 1 ? "" : "s"}.`
        : "It is the next item needing attention.";
    return {
      text: `${attentionToday.title} — ${itemTime(attentionToday)}. ${reason}`,
      items: [{ time: itemTime(attentionToday), title: attentionToday.title, status: attentionToday.status.replace("-", " ") }]
    };
  }
  const reason = attention.status === "in-progress"
    ? "It is currently scheduled."
    : attention.postponed
      ? `It has been postponed ${attention.postponed} time${attention.postponed === 1 ? "" : "s"}.`
      : "It is the next item needing attention.";
  return {
    text: `${attention.title} — ${itemTime(attention)}. ${reason}`,
    items: [{ time: itemTime(attention), title: attention.title, status: attention.status.replace("-", " ") }]
  };
}

function answerComingNext() {
  const next = saGetCurrentOrNextItem();
  if (!next) return { text: "Nothing is currently upcoming." };
  const today = localDateString(new Date());
  const when = next.date === today ? "today" : formatDateLabel(next.date);
  return {
    text: `Next up: ${next.title}, ${when} at ${formatTime(next.start || "00:00")}.`,
    items: [{ time: `${when}${next.start ? " at " + formatTime(next.start) : ""}`, title: next.title, status: next.status.replace("-", " ") }]
  };
}

function answerRemaining() {
  const todayItemsList = saGetTodayItems();
  const remaining = sortForDate(todayItemsList.filter(item => item.status !== "completed" && item.status !== "cancelled"));
  if (!remaining.length) return { text: "Everything planned for today is complete." };
  return {
    text: `${remaining.length} item${remaining.length === 1 ? "" : "s"} remaining today.`,
    items: remaining.map(item => ({ time: itemTime(item), title: item.title, status: item.status.replace("-", " ") }))
  };
}

function answerCompletedToday() {
  const todayItemsList = saGetTodayItems();
  const completed = todayItemsList.filter(item => item.status === "completed");
  if (!completed.length) return { text: "Nothing has been completed yet today." };
  return {
    text: `You completed ${completed.length} item${completed.length === 1 ? "" : "s"} today.`,
    items: completed.map(item => ({ time: itemTime(item), title: item.title, status: "completed" }))
  };
}

function answerMissedWeek() {
  const today = localDateString(new Date());
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = localDateString(monday);
  const weekEnd = localDateString(sunday);
  const missed = items.filter(item => item.date && item.status === "missed" && item.date >= weekStart && item.date <= weekEnd)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!missed.length) return { text: "No missed items are recorded this week." };
  return {
    text: `You missed ${missed.length} item${missed.length === 1 ? "" : "s"} this week.`,
    items: missed.map(item => ({ time: formatDateLabel(item.date), title: item.title, status: "missed" }))
  };
}

function answerHaveDate(dateStr) {
  const dateItems = saGetItemsForDate(dateStr);
  const sorted = sortForDate(dateItems);
  if (!sorted.length) return { text: `Nothing is planned for ${formatDateLabel(dateStr)}.` };
  const items = sorted.map(item => ({
    time: itemTime(item),
    title: item.title,
    status: item.status.replace("-", " ")
  }));
  return { text: `You have ${sorted.length} item${sorted.length === 1 ? "" : "s"} planned for ${formatDateLabel(dateStr)}.`, items };
}

function answerWeekSchedule() {
  const today = localDateString(new Date());
  const weekItems = saGetWeekItems(today);
  if (!weekItems.length) return { text: "Nothing is scheduled for this week." };
  const byDate = {};
  for (const item of weekItems) {
    if (!byDate[item.date]) byDate[item.date] = [];
    byDate[item.date].push(item);
  }
  const items = [];
  for (const dateStr of Object.keys(byDate).sort()) {
    for (const item of sortForDate(byDate[dateStr])) {
      items.push({ time: `${formatDateLabel(dateStr)}${item.start ? " at " + formatTime(item.start) : ""}`, title: item.title, status: item.status.replace("-", " ") });
    }
  }
  return { text: `This week has ${weekItems.length} planned item${weekItems.length === 1 ? "" : "s"}.`, items };
}

function answerOverdue() {
  const overdueItems = items.filter(item => item.status === "overdue" && item.date);
  if (!overdueItems.length) return { text: "Nothing is currently overdue." };
  return {
    text: `${overdueItems.length} item${overdueItems.length === 1 ? "" : "s"} is overdue.`,
    items: overdueItems.map(item => ({ time: formatDateLabel(item.date), title: item.title, status: "overdue" }))
  };
}

function answerConflicts() {
  const today = localDateString(new Date());
  const conflicts = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const dateStr = localDateString(date);
    const conflict = saDetectConflictsForDate(dateStr);
    if (conflict) conflicts.push({ date: dateStr, items: [conflict[0].title, conflict[1].title] });
  }
  if (!conflicts.length) return { text: "No schedule conflicts detected this week." };
  const messages = conflicts.map(c => `${formatDateLabel(c.date)}: ${c.items[0]} overlaps with ${c.items[1]}`);
  return { text: `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} found.\n${messages.join("\n")}` };
}

function answerAwaitingCheckin() {
  const awaiting = items.filter(item => item.status === "awaiting-check-in");
  if (!awaiting.length) return { text: "No items are awaiting check-in." };
  return {
    text: `${awaiting.length} item${awaiting.length === 1 ? "" : "s"} awaiting check-in.`,
    items: awaiting.map(item => ({ time: formatDateLabel(item.date), title: item.title, status: "awaiting check-in" }))
  };
}

function answerRemainingCount() {
  const remaining = saGetTodayItems().filter(item => item.status !== "completed" && item.status !== "cancelled");
  return { text: `${remaining.length} item${remaining.length === 1 ? "" : "s"} remain today.` };
}

function answerRoutinesToday() {
  const routines = saGetTodayItems().filter(item => item.type === "routine");
  if (!routines.length) return { text: "No routines are scheduled for today." };
  return {
    text: `${routines.length} routine${routines.length === 1 ? "" : "s"} scheduled for today.`,
    items: routines.map(item => ({ time: itemTime(item), title: item.title, status: item.status.replace("-", " ") }))
  };
}

function answerProgressToday() {
  const progress = saCalculateDailyProgress();
  if (!progress.planned) return { text: "Nothing is planned for today." };
  return { text: `${progress.completed} of ${progress.planned} completed (${progress.percent}%). ${progress.remaining} remaining.` };
}

function answerProgressWeek() {
  const progress = saCalculateWeeklyProgress();
  if (!progress.planned) return { text: "Nothing is planned for this week." };
  return { text: `${progress.completed} of ${progress.planned} completed this week (${progress.percent}%).` };
}

function answerStudioNext() {
  const studioItems = items.filter(item => item.title.toLowerCase().includes("studio") && item.date && item.date >= localDateString(new Date()) && item.status !== "completed" && item.status !== "cancelled");
  if (!studioItems.length) return { text: "No upcoming studio sessions found." };
  studioItems.sort((a, b) => (a.date + "|" + (a.start || "")).localeCompare(b.date + "|" + (b.start || "")));
  const next = studioItems[0];
  return {
    text: `${next.title} on ${formatDateLabel(next.date)}${next.start ? ` at ${formatTime(next.start)}` : "."}`,
    items: [{ time: `${formatDateLabel(next.date)}${next.start ? " at " + formatTime(next.start) : ""}`, title: next.title, status: next.status.replace("-", " ") }]
  };
}

function answerAtTime(dateStr, timeStr) {
  const dateItems = saGetItemsForDate(dateStr);
  const matching = dateItems.filter(item => item.start && item.start <= timeStr && item.end && item.start <= timeStr);
  if (!matching.length) return { text: `Nothing is scheduled for ${formatDateLabel(dateStr)} at ${timeStr}.` };
  return {
    text: `${matching.length} item${matching.length === 1 ? "" : "s"} at ${timeStr} on ${formatDateLabel(dateStr)}.`,
    items: matching.map(item => ({ time: itemTime(item), title: item.title, status: item.status.replace("-", " ") }))
  };
}

function handleDeterministicQuery(message) {
  const text = message.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.?]+$/i, "");

  if (/what.*have.*today|what.*doing.*today|what should i do now/i.test(text)) return answerHaveToday();
  if (/what.*coming next|what.*next/i.test(text) && !/studio/i.test(text)) return answerComingNext();
  if (/what.*remaining today|what.*still.*today/i.test(text)) return answerRemaining();
  if (/what.*complete.*today/i.test(text)) return answerCompletedToday();
  if (/what.*miss.*this week/i.test(text)) return answerMissedWeek();
  if (/what.*have.*tomorrow/i.test(text)) return answerHaveDate(resolveDateOffset(1));
  if (/what.*have.*friday/i.test(text)) return answerHaveDate(resolveWeekday("friday") || resolveDateOffset(0));
  if (/what.*schedule.*week|show.*schedule.*week/i.test(text)) return answerWeekSchedule();
  if (/anything overdue|what.*overdue/i.test(text)) return answerOverdue();
  if (/any.*conflict/i.test(text)) return answerConflicts();
  if (/awaiting check.in/i.test(text)) return answerAwaitingCheckin();
  if (/how many.*remain.*today/i.test(text)) return answerRemainingCount();
  if (/what.*routines.*today/i.test(text)) return answerRoutinesToday();
  if (/how.*progress.*today/i.test(text)) return answerProgressToday();
  if (/how.*progress.*week/i.test(text)) return answerProgressWeek();
  if (/what.*next.*studio|studio.*session/i.test(text)) return answerStudioNext();
  if (/anything.*at.*pm/i.test(text) || /friday.*at/i.test(text)) {
    const timeMatch = text.match(/(\d+(?::\d+)?)\s*(pm|am)?/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      if (timeMatch[2] && timeMatch[2].toLowerCase() === "pm" && hour < 12) hour += 12;
      if (timeMatch[2] && timeMatch[2].toLowerCase() === "am" && hour === 12) hour = 0;
      const timeStr = `${String(hour).padStart(2, "0")}:00`;
      const dateMatch = text.match(/friday/i) ? resolveWeekday("friday") || resolveDateOffset(0) : localDateString(new Date());
      return answerAtTime(dateMatch, timeStr);
    }
  }

  return null;
}

function handleDirectInterfaceAction(message) {
  const text = message.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.?]+$/i, "");

  let actionType = null;
  let targetItem = null;

  if (/postpone/i.test(text)) {
    actionType = "postpone_item";
    const minutes = text.includes("30") ? 30 : text.includes("one hour") ? 60 : 15;
    targetItem = getDirectActionTarget();
    if (targetItem) {
      const conflict = saDetectConflictsForDate(targetItem.date);
      return {
        proposal: {
          id: crypto.randomUUID(),
          action: {
            type: actionType,
            targetId: targetItem.id,
            item: null,
            changes: null,
            postponeMinutes: minutes
          },
          message: `Postpone "${targetItem.title}" by ${minutes} minutes?`,
          conflict: conflict || null,
          originalMessage: message,
          source: "local"
        }
      };
    }
    return { clarification: "Which item should I postpone?" };
  }

  if (/complete|done/i.test(text)) {
    actionType = "complete_item";
    targetItem = getDirectActionTarget();
    if (targetItem) {
      return {
        proposal: {
          id: crypto.randomUUID(),
          action: {
            type: actionType,
            targetId: targetItem.id,
            item: null,
            changes: null,
            postponeMinutes: null
          },
          message: `Mark "${targetItem.title}" as completed?`,
          conflict: null,
          originalMessage: message,
          source: "local"
        }
      };
    }
    return { clarification: "Which item should I mark completed?" };
  }

  if (/cancel/i.test(text)) {
    actionType = "cancel_item";
    targetItem = getDirectActionTarget();
    if (targetItem) {
      return {
        proposal: {
          id: crypto.randomUUID(),
          action: {
            type: actionType,
            targetId: targetItem.id,
            item: null,
            changes: null,
            postponeMinutes: null
          },
          message: `Cancel "${targetItem.title}"?`,
          conflict: null,
          originalMessage: message,
          source: "local"
        }
      };
    }
    return { clarification: "Which item should I cancel?" };
  }

  if (/missed/i.test(text)) {
    actionType = "mark_missed";
    targetItem = getDirectActionTarget();
    if (targetItem) {
      return {
        proposal: {
          id: crypto.randomUUID(),
          action: {
            type: actionType,
            targetId: targetItem.id,
            item: null,
            changes: null,
            postponeMinutes: null
          },
          message: `Mark "${targetItem.title}" as missed?`,
          conflict: null,
          originalMessage: message,
          source: "local"
        }
      };
    }
    return { clarification: "Which item should I mark missed?" };
  }

  return null;
}

function getDirectActionTarget() {
  const todayItemsList = saGetTodayItems();
  const attention = getAttentionItem(todayItemsList);
  if (attention) return attention;
  return null;
}

function validateGeminiResponse(response) {
  if (!response || typeof response !== "object") return "Invalid response format";
  if (!["answer", "clarification", "proposed_action", "plan_proposal", "no_action", "error"].includes(response.kind)) {
    return "Unsupported response kind";
  }
  if (!Object.prototype.hasOwnProperty.call(response, "planningContext")) return "Missing planning context";
  if (response.planningContext !== null && (!response.planningContext || typeof response.planningContext !== "object" || !Array.isArray(response.planningContext.proposedItems) || !Array.isArray(response.planningContext.constraints) || typeof response.planningContext.goal !== "string")) return "Invalid planning context";
  const validateAction = action => {
    if (!action || !saGetAllowedActions().includes(action.type)) return "Unsupported action type";
    if (action.type === "create_item" && (!action.item || action.targetId)) return "Invalid create action";
    if (action.type !== "create_item" && !saFindItemById(action.targetId)) return "Target item not found";
    return saValidatePlanAction(action);
  };
  if (response.kind === "proposed_action") {
    if (!response.requiresConfirmation) return "Proposed action must require confirmation";
    const error = validateAction(response.action);
    if (error) return error;
  }
  if (response.kind === "plan_proposal") {
    if (!response.requiresConfirmation || response.action !== null || !response.plan || typeof response.plan.title !== "string" || !Array.isArray(response.plan.actions) || !response.plan.actions.length || response.plan.actions.length > 5) return "Invalid plan proposal";
    const duplicateKeys = new Set();
    for (const action of response.plan.actions) {
      const error = validateAction(action);
      if (error) return error;
      const key = action.targetId ? `target|${action.targetId}` : `${action.type}|${action.item.type}|${action.item.title.toLowerCase()}|${action.item.date}|${action.item.start || ""}|${action.item.end || ""}`;
      if (duplicateKeys.has(key)) return "Plan contains duplicate actions";
      duplicateKeys.add(key);
    }
  }
  return null;
}

async function callGeminiEndpoint(message, planningRequest = false, priorContext = null) {
  const isPlanning = planningRequest || Boolean(activePlanningContext);
  const relevantItems = isPlanning ? saGetPlanningItems(activePlanningContext) : saGetRelevantItemsForContext(message);
  const compactFacts = isPlanning ? saGetWeeklyAvailabilityFacts() : saGetCompactFacts();

  const requestBody = {
    message: message.trim(),
    context: relevantItems,
    pendingClarification: pendingClarification,
    compactFacts: compactFacts,
    activePlanningContext: activePlanningContext,
    priorContext
  };

  try {
    const response = await fetch(MATSON_CONFIG.assistantEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.kind === "error" && data.message) {
        return { kind: "error", message: data.message };
      }
      return { kind: "error", message: "The schedule language service is not connected in this preview." };
    }

    return await response.json();
  } catch {
    return { kind: "error", message: "The schedule language service is not connected in this preview." };
  }
}

function processGeminiResponse(response) {
  const validationError = validateGeminiResponse(response);
  if (validationError) {
    return {
      message: "I had trouble understanding that request.",
      items: []
    };
  }

  const hadPlanningContext = Boolean(activePlanningContext);
  if (response.kind !== "error") activePlanningContext = response.planningContext || null;
  const persistResponseState = () => {
    savePlanningContext();
    if (hadPlanningContext && !activePlanningContext) planningTopicResolved = true;
  };

  switch (response.kind) {
    case "answer":
      pendingClarification = null;
      persistResponseState();
      return {
        message: response.message || "Here's what I found.",
        items: []
      };

    case "clarification":
      pendingClarification = response.pendingClarification || null;
      persistResponseState();
      return {
        message: response.message || "Could you clarify?",
        items: [],
        clarification: true
      };

    case "proposed_action":
      pendingClarification = null;
      persistResponseState();
      const proposal = buildProposalFromGeminiResponse(response);
      if (!proposal) {
        return {
          message: "I couldn't build a safe action from that request.",
          items: []
        };
      }
      return {
        message: response.message || "",
        items: [],
        proposal: proposal
      };

    case "plan_proposal":
      pendingClarification = null;
      persistResponseState();
      return {
        message: response.message || "Here's the plan I recommend.",
        items: [],
        proposal: buildPlanProposalFromGeminiResponse(response)
      };

    case "no_action":
      pendingClarification = null;
      persistResponseState();
      return {
        message: response.message || "I can't help with that.",
        items: []
      };

    case "error":
      persistResponseState();
      return {
        message: response.message || "Something went wrong.",
        items: []
      };

    default:
      return {
        message: "I'm not sure how to help with that.",
        items: []
      };
  }
}

function buildProposalFromGeminiResponse(response) {
  const action = response.action;
  if (!action) return null;

  let conflict = null;
  if (action.item?.date && (action.type === "create_item" || action.type === "reschedule_item")) {
    conflict = saDetectConflictsForDate(action.item.date);
    if (conflict && action.action?.targetId) {
      conflict = (conflict[0].id === action.targetId || conflict[1].id === action.targetId) ? null : conflict;
    }
  }

  const proposal = {
    id: crypto.randomUUID(),
    action: {
      type: action.type,
      targetId: action.targetId || null,
      item: action.item ? { ...action.item } : null,
      changes: action.changes || null,
      postponeMinutes: action.postponeMinutes || null
    },
    message: response.message || "",
    conflict: conflict ? { items: [conflict[0].title, conflict[1].title] } : null,
    originalMessage: response.message || "",
    source: "gemini"
  };

  return proposal;
}

function renderProposalMessage(text) {
  const message = document.createElement("div");
  message.className = "message assistant-message proposal-message";
  const p = document.createElement("p");
  p.textContent = text;
  message.appendChild(p);
  assistantEls.conversation.appendChild(message);
  assistantEls.conversation.scrollTop = assistantEls.conversation.scrollHeight;
}

async function sendMessage(rawText) {
  const text = rawText.trim();
  if (!text) return;

  try { await ensureConversation(); }
  catch { /* The message is retained locally and a retry notice is shown below. */ }
  appendEntry({ role: "user", text });

  if (/^(?:never mind|forget (?:it|that|the plan)|drop the plan|cancel (?:this|the) plan|abandon (?:this|the) plan)$/i.test(text.trim())) {
    activePlanningContext = null;
    pendingClarification = null;
    currentProposal = null;
    savePlanningContext();
    appendEntry({ role: "assistant", text: "Okay, I’ve cleared that planning topic." });
    updateSummaryIfPlanningResolved();
    renderConversation();
    return;
  }

  const recallContext = await getRecallContext(text);
  const classification = recallContext ? "analytical_query" : classifyRequest(text);

  let result;

  if (classification === "deterministic_query") {
    result = handleDeterministicQuery(text);
    if (result) {
      appendEntry({ role: "assistant", text: result.text, items: result.items || [] });
      if (result.proposal || result.clarification) {
        handleProposalOrClarification(result, text);
      }
      saveConversation();
      return;
    }
  }

  currentProposal = null;

  if (classification === "direct_interface_action") {
    const directResult = handleDirectInterfaceAction(text);
    if (directResult.proposal) {
      currentProposal = directResult.proposal;
      renderProposalMessage(directResult.proposal.message);
      renderProposal(currentProposal);
      appendEntry({ role: "assistant", text: directResult.proposal.message, kind: "proposal_summary", proposalSummary: directResult.proposal.message, resolved: false });
      saveConversation();
      return;
    }
    if (directResult.clarification) {
      pendingClarification = { intent: "unknown", knownFields: {}, missingFields: ["target"] };
      appendEntry({ role: "assistant", text: directResult.clarification });
      saveConversation();
      return;
    }
    appendEntry({ role: "assistant", text: "I couldn't understand that action." });
    saveConversation();
    return;
  }

  if (classification === "analytical_query" || classification === "analytical_planning" || classification === "natural_language_action" || classification === "clarification_reply") {
    const geminiResponse = await callGeminiEndpoint(text, classification === "analytical_planning", recallContext);
    result = processGeminiResponse(geminiResponse);

    if (result.proposal) {
      currentProposal = result.proposal;
      renderProposalMessage(result.message || "I've prepared an action for you to review.");
      renderProposal(currentProposal);
      appendEntry({ role: "assistant", text: result.message || "Here's a proposed action.", kind: "proposal_summary", proposalSummary: result.message || "", resolved: false });
      saveConversation();
      return;
    }

    if (result.clarification) {
      appendEntry({ role: "assistant", text: result.message });
      saveConversation();
      return;
    }

    appendEntry({ role: "assistant", text: result.message, items: result.items || [] });
    updateSummaryIfPlanningResolved();
    saveConversation();
    return;
  }

  appendEntry({ role: "assistant", text: "I can't help with that yet." });
  saveConversation();
}

function handleProposalOrClarification(result, message) {
}

async function confirmProposal() {
  if (!currentProposal) return;
  if (currentProposal.plan) {
    await confirmPlanProposal();
    return;
  }

  const action = currentProposal.action;
  let result;

  switch (action.type) {
    case "create_item":
      if (!action.item) {
        showProcessingError("Missing item data.");
        return;
      }
      result = await saCreateItem(action.item);
      if (!result.success) {
        showProcessingError(result.error);
        return;
      }
      appendEntry({ role: "assistant", text: `Created "${result.item.title}" for ${formatDateLabel(result.item.date)}.` });
      break;

    case "complete_item":
      result = await saCompleteItem(action.targetId);
      if (!result.success) {
        showProcessingError(result.error);
        return;
      }
      appendEntry({ role: "assistant", text: `Marked "${result.item.title}" as completed.` });
      break;

    case "cancel_item":
      result = await saCancelItem(action.targetId);
      if (!result.success) {
        showProcessingError(result.error);
        return;
      }
      appendEntry({ role: "assistant", text: `Cancelled "${result.item.title}".` });
      break;

    case "mark_missed":
      result = await saMarkItemMissed(action.targetId);
      if (!result.success) {
        showProcessingError(result.error);
        return;
      }
      appendEntry({ role: "assistant", text: `Marked "${result.item.title}" as missed.` });
      break;

    case "reschedule_item":
      const target = saFindItemById(action.targetId);
      if (!target) {
        showProcessingError("Item no longer exists.");
        return;
      }
      if (!action.item || !action.item.date || !action.item.start || !action.item.end) {
        showProcessingError("Missing new schedule details.");
        return;
      }
      const conflictCheck = saDetectConflictsForDate(action.item.date);
      if (conflictCheck && !conflictCheck.find(i => i.id === action.targetId)) {
        renderProposalMessage(`Warning: ${conflictCheck[0].title} and ${conflictCheck[1].title} overlap on ${formatDateLabel(action.item.date)}.`);
      }
      result = await saRescheduleItem(action.targetId, action.item.date, action.item.start, action.item.end);
      if (!result.success) {
        showProcessingError(result.error);
        return;
      }
      appendEntry({ role: "assistant", text: `Moved "${result.item.title}" to ${formatDateLabel(result.item.date)} at ${formatTime(result.item.start)}.` });
      break;

    case "update_item":
      const updateTarget = saFindItemById(action.targetId);
      if (!updateTarget) {
        showProcessingError("Item no longer exists.");
        return;
      }
      result = await saUpdateItem(action.targetId, action.changes || {});
      if (!result.success) {
        showProcessingError(result.error);
        return;
      }
      appendEntry({ role: "assistant", text: `Updated "${result.item.title}".` });
      break;

    case "postpone_item":
      const postponeTarget = saFindItemById(action.targetId);
      if (!postponeTarget) {
        showProcessingError("Item no longer exists.");
        return;
      }
      result = await saPostponeItem(action.targetId, action.postponeMinutes || 15);
      if (!result.success) {
        showProcessingError(result.error);
        return;
      }
      appendEntry({ role: "assistant", text: `Postponed "${result.item.title}" by ${result.postponedMinutes} minutes.` });
      break;

    default:
      showProcessingError("Unsupported action type.");
      return;
  }

  currentProposal = null;
  await persistenceQueue;
  await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
  conversation.forEach(entry => { if (entry.kind === "proposal_summary") entry.resolved = true; });
  await firebaseStore.updateConversationSummary(activeConversationId, conversationSummary("active")).catch(showPersistenceFailure);
  saveConversation();
  renderConversation();
}

function validatePlanProposal(proposal) {
  if (!proposal || !proposal.plan || typeof proposal.plan.title !== "string" || !Array.isArray(proposal.plan.actions) || !proposal.plan.actions.length || proposal.plan.actions.length > 5) return "This plan does not contain a valid number of actions.";
  const actionKeys = new Set();
  for (const action of proposal.plan.actions) {
    const error = saValidatePlanAction(action);
    if (error) return error;
    const key = action.targetId ? `target|${action.targetId}` : `${action.type}|${action.item.type}|${action.item.title.toLowerCase()}|${action.item.date}|${action.item.start || ""}|${action.item.end || ""}`;
    if (actionKeys.has(key)) return "This plan contains duplicate actions.";
    actionKeys.add(key);
  }
  return null;
}

function applyPlanEdits(proposal, proposalEl) {
  for (const input of proposalEl.querySelectorAll("[data-action-index][data-plan-field]")) {
    const index = Number(input.dataset.actionIndex);
    const action = proposal.plan.actions[index];
    if (action?.item) action.item[input.dataset.planField] = input.value || null;
  }
}

async function confirmPlanProposal() {
  const proposal = currentProposal;
  const proposalEl = assistantEls.conversation.querySelector(`.proposal[data-proposal-id="${proposal.id}"]`);
  if (!proposalEl) return;
  applyPlanEdits(proposal, proposalEl);
  const validationError = validatePlanProposal(proposal);
  if (validationError) {
    showProcessingError(`I couldn't apply that plan: ${validationError}`);
    renderConversation();
    return;
  }
  const result = await saApplyPlanAtomically(proposal.plan.actions);
  if (!result.success) {
    showProcessingError(`I couldn't apply that plan: ${result.error}`);
    renderConversation();
    return;
  }
  currentProposal = null;
  pendingClarification = null;
  activePlanningContext = null;
  savePlanningContext();
  await persistenceQueue;
  await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
  conversation.forEach(entry => { if (entry.kind === "proposal_summary") entry.resolved = true; });
  appendEntry({ role: "assistant", text: `Confirmed. The complete plan with ${proposal.plan.actions.length} actions has been saved.` });
  await firebaseStore.updateConversationSummary(activeConversationId, conversationSummary("active")).catch(showPersistenceFailure);
  renderConversation();
}

function togglePlanEditor(proposalEl, button) {
  const editors = proposalEl.querySelectorAll(".plan-editor");
  const show = Array.from(editors).some(editor => editor.hidden);
  editors.forEach(editor => { editor.hidden = !show; });
  button.textContent = show ? "Done editing" : "Edit";
}

function editProposal() {
  if (!currentProposal) return;

  openAddDialogForEdit(currentProposal);
}

async function cancelProposal() {
  if (!currentProposal) return;

  const wasPlan = Boolean(currentProposal.plan);
  currentProposal = null;
  pendingClarification = null;
  activePlanningContext = null;
  savePlanningContext();
  await persistenceQueue;
  await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
  conversation.forEach(entry => { if (entry.kind === "proposal_summary") entry.resolved = true; });
  if (wasPlan) appendEntry({ role: "assistant", text: "Plan cancelled. No schedule changes were made." });
  await firebaseStore.updateConversationSummary(activeConversationId, conversationSummary("active")).catch(showPersistenceFailure);
  renderConversation();
}

function openAddDialogForEdit(proposal) {
  const dialog = document.querySelector("#addDialog");
  const form = document.querySelector("#addForm");
  const typeSelect = document.querySelector("#itemType");
  const timeFields = document.querySelector("#timeFields");

  form.reset();
  timeFields.hidden = false;

  if (proposal.action.item) {
    form.title.value = proposal.action.item.title || "";
    form.date.value = proposal.action.item.date || localDateString(new Date());
    form.type.value = proposal.action.item.type || "activity";
    form.start.value = proposal.action.item.start || "";
    form.end.value = proposal.action.item.end || "";
    form.category.value = proposal.action.item.category || "Personal";
    form.notes.value = proposal.action.item.notes || "";
    typeSelect.value = proposal.action.item.type || "activity";
  }

  timeFields.hidden = typeSelect.value === "task";

  dialog.showModal();
  dialog.dataset.proposalId = proposal.id;
  dialog.dataset.editMode = "true";
}

function showProcessingError(message) {
  appendEntry({ role: "assistant", text: message });
}

function submitInput() {
  const value = assistantEls.input.value;
  sendMessage(value);
  assistantEls.input.value = "";
  assistantEls.input.style.height = "auto";
  assistantEls.input.focus();
}

function renderProposalButton(button, action) {
  button.addEventListener("click", () => {
    button.disabled = true;
    if (action === "confirm") confirmProposal();
    if (action === "edit") editProposal();
    if (action === "cancel") cancelProposal();
  });
}

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
  startNewConversation().catch(showPersistenceFailure);
  assistantEls.input.focus();
});

assistantEls.newConversation.addEventListener("click", () => startNewConversation().catch(showPersistenceFailure));
assistantEls.recentConversations.addEventListener("change", event => openConversation(event.target.value));
assistantEls.retrySave.addEventListener("click", () => {
  persistenceQueue = persistenceQueue.then(persistPendingMessages);
});

assistantEls.conversation.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const proposalEl = button.closest(".proposal");
  if (!proposalEl) return;
  const proposalId = proposalEl.dataset.proposalId;
  if (proposalId !== (currentProposal?.id || "current")) return;
  if (button.dataset.action === "edit" && currentProposal.plan) {
    togglePlanEditor(proposalEl, button);
    return;
  }
  button.disabled = true;
  if (button.dataset.action === "confirm") confirmProposal();
  if (button.dataset.action === "edit") editProposal();
  if (button.dataset.action === "cancel") cancelProposal();
});

renderConversation();
refreshRecentConversationList().catch(showPersistenceFailure);
if (pendingMessageWrites.length) showPersistenceFailure();

function openAddDialog() {
  document.querySelector("#addForm").reset();
  document.querySelector("#itemType").value = "activity";
  document.querySelector("#timeFields").hidden = false;
  document.querySelector("#addForm").date.value = localDateString(new Date());
  document.querySelector("#addDialog").showModal();
}

function classifyAndProcess(text) {
  const classification = classifyRequest(text);
  return classification;
}
