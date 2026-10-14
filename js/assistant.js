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
let conversation = Array.isArray(window.initialConversation?.messages) ? window.initialConversation.messages.map(message => ({ role: message.role, text: message.text, kind: message.kind, resolved: message.resolved, referencedItemIds: message.referencedItemIds || [], deletedItemIds: message.deletedItemIds || [] })) : [];
let activeConversationId = window.initialConversation?.id || window.initialAssistantState?.activeConversationId || null;
let pendingClarification = window.initialAssistantState?.pendingClarification || null;
let entityRegistry = Array.isArray(window.initialAssistantState?.entityRegistry) ? window.initialAssistantState.entityRegistry.slice(-10) : [];
let pendingOperation = window.initialAssistantState?.pendingOperation || null;
let referencedSets = Array.isArray(window.initialAssistantState?.referencedSets) ? window.initialAssistantState.referencedSets.slice(-5) : [];
let lastConfirmedAction = window.initialAssistantState?.lastConfirmedAction || null;
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
  firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction, currentTopic: activePlanningContext?.topic || pendingOperation?.intent || null }).catch(showPersistenceFailure);
}
function rememberScheduleEntity(item, lastAction = "updated", mentions = []) {
  if (!item?.id) return;
  const existing = entityRegistry.find(entry => entry.id === item.id);
  const mentionedAs = [...new Set([...(existing?.mentionedAs || []), item.title, ...mentions].filter(Boolean))].slice(-8);
  entityRegistry = [...entityRegistry.filter(entry => entry.id !== item.id), {
    entityType: "schedule_item", id: item.id, title: item.title, type: item.type,
    date: item.date || null, start: item.start || null, end: item.end || null,
    status: item.status || "upcoming", lastAction, mentionedAs, updatedAt: new Date().toISOString(),
    saved: true, deleted: lastAction === "deleted", ...(lastAction === "deleted" ? { deletedAt: new Date().toISOString() } : {}),
    lastMentionedOrder: conversation.length
  }].slice(-10);
}
function saveConversation() { /* Conversation writes are queued by appendEntry. */ }

async function ensureConversation() {
  if (activeConversationId) return activeConversationId;
  activeConversationId = await firebaseStore.createConversation({ title: "New conversation", status: "active" });
  await firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction });
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
  if (!/\b(remember|recall|asked about|talked about|discussed|previous conversation|last time|earlier conversation|normally|usually|preference|prefer|duration|travel time|flexib|fixed commitment)\b/i.test(text)) return null;
  const keywords = firebaseStore.tokenizeKeywords(text);
  if (!keywords.length) return null;
  try {
    const [matches, memories] = await Promise.all([
      firebaseStore.searchConversationSummaries(keywords, 5),
      firebaseStore.searchMemories(keywords, 10)
    ]);
    const conversations = [];
    for (const match of matches.slice(0, 5)) {
      const loaded = await firebaseStore.loadConversation(match.id, 8);
      const relevant = loaded.messages.filter(message => {
        const words = new Set(firebaseStore.tokenizeKeywords(message.text));
        return keywords.some(word => words.has(word));
      }).slice(-2).map(message => ({ role: message.role, text: String(message.text).slice(0, 140) }));
      conversations.push({ title: String(match.title || "").slice(0, 80), summary: String(match.summary || "").slice(0, 180), messages: relevant });
    }
    return {
      conversations,
      memories: memories.slice(0, 10).map(memory => ({ type: String(memory.type || "").slice(0, 50), text: String(memory.text || "").slice(0, 180) }))
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
  pendingOperation = null;
  referencedSets = [];
  entityRegistry = [];
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
      resolved: message.resolved !== false,
      referencedItemIds: message.referencedItemIds || [],
      deletedItemIds: message.deletedItemIds || []
    }));
    currentProposal = null;
    const state = await firebaseStore.loadAssistantState();
    const isActive = state.activeConversationId === id;
    pendingClarification = isActive ? state.pendingClarification : null;
    activePlanningContext = isActive ? state.planningContext : null;
    entityRegistry = isActive && Array.isArray(state.entityRegistry) ? state.entityRegistry.slice(-10) : [];
    pendingOperation = isActive ? state.pendingOperation || null : null;
    referencedSets = isActive && Array.isArray(state.referencedSets) ? state.referencedSets.slice(-5) : [];
    lastConfirmedAction = isActive ? state.lastConfirmedAction || null : null;
    await firebaseStore.saveAssistantState({ activeConversationId: id, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction });
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
    referencedItemIds: entry.referencedItemIds || [],
    deletedItemIds: entityRegistry.filter(entity => entity.deleted && (entry.referencedItemIds || []).includes(entity.id)).map(entity => entity.id),
    proposalSummary: entry.proposalSummary || null,
    resolved: entry.resolved !== false
  };
  pendingMessageWrites.push({ conversationId: activeConversationId, message });
  localStorage.setItem(PENDING_MESSAGE_WRITES_KEY, JSON.stringify(pendingMessageWrites));
  persistenceQueue = persistenceQueue.then(persistPendingMessages);
  if (entry.role === "assistant" && activeConversationId) {
    firebaseStore.updateConversationSummary(activeConversationId, conversationSummary("active")).catch(showPersistenceFailure);
  }
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

  if (proposal.bulkAction) {
    const bulk = proposal.bulkAction;
    const scope = bulk.scope || {};
    addDetailRow(details, "Scope", `${scopeLabel(scope)} · ${bulk.affectedCount} item${bulk.affectedCount === 1 ? "" : "s"}`);
    addDetailRow(details, "Operation", bulkOperationLabel(bulk.type));
    const list = document.createElement("ul");
    if (bulk.items?.length > 10) {
      const disclosure = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `Previewing 5 of ${bulk.items.length}; inspect full list`;
      disclosure.appendChild(summary);
      for (const item of bulk.items.slice(0, 5)) { const row = document.createElement("p"); row.textContent = `${item.title} · ${formatDateLabel(item.date)}${item.start ? ` · ${formatTime(item.start)}${item.end ? `–${formatTime(item.end)}` : ""}` : ""}`; disclosure.appendChild(row); }
      const fullList = document.createElement("ul");
      for (const item of bulk.items) { const row = document.createElement("li"); row.textContent = `${item.title} · ${formatDateLabel(item.date)}${item.start ? ` · ${formatTime(item.start)}${item.end ? `–${formatTime(item.end)}` : ""}` : ""}${item.type === "routine" ? " · Routine" : ""}`; fullList.appendChild(row); }
      disclosure.appendChild(fullList);
      details.appendChild(disclosure);
    }
    const visibleItems = bulk.items?.length > 10 ? bulk.items.slice(0, 5) : (bulk.items || []);
    for (const item of visibleItems) {
      const row = document.createElement("li");
      row.textContent = `${item.title} · ${formatDateLabel(item.date)}${item.start ? ` · ${formatTime(item.start)}${item.end ? `–${formatTime(item.end)}` : ""}` : ""}${item.type === "routine" ? " · Routine" : ""}`;
      list.appendChild(row);
    }
    if (bulk.items?.length <= 10) details.appendChild(list);
  } else if (proposal.plan) {
    renderPlanDetails(details, proposal);
  } else if (proposal.action?.item) {
    const item = proposal.action.item;
    addDetailRow(details, "Type", item.type);
    addDetailRow(details, "Date", item.date || "");
    if (item.start) addDetailRow(details, "Start", item.start);
    if (item.end) addDetailRow(details, "End", item.end);
    addDetailRow(details, "Category", item.category);
  } else if (proposal.action?.targetId) {
    const target = saFindItemById(proposal.action.targetId) || proposal.originalItem;
    if (target) {
      addDetailRow(details, "Item", target.title);
      addDetailRow(details, "Date", formatDateLabel(target.date));
      if (target.start) addDetailRow(details, "Current time", `${formatTime(target.start)}${target.end ? `–${formatTime(target.end)}` : ""}`);
    }
    if (proposal.action.type === "delete_item") addDetailRow(details, "Warning", "Permanent deletion cannot be undone through normal app controls.");
  }

  if (proposal.conflict) {
    const conflictRow = document.createElement("div");
    conflictRow.className = "conflict";
    const conflictTitle = document.createElement("strong");
    conflictTitle.textContent = "Schedule conflict:";
    conflictRow.appendChild(conflictTitle);
    conflictRow.appendChild(document.createTextNode(` ${proposal.conflict.items.join(" and ")} overlap.`));
    details.appendChild(conflictRow);
  }

  if (proposal.action?.changes) {
    if (["reschedule_item", "update_item"].includes(proposal.action.type) && proposal.originalItem && (proposal.action.changes.start || proposal.action.changes.date)) {
      addDetailRow(details, "Current", `${formatDateLabel(proposal.originalItem.date)} · ${formatTime(proposal.originalItem.start)}–${formatTime(proposal.originalItem.end)}`);
      const nextDate = proposal.action.changes.date || proposal.originalItem.date;
      const nextStart = proposal.action.changes.start || proposal.originalItem.start;
      const nextEnd = proposal.action.changes.end || proposal.originalItem.end;
      addDetailRow(details, "Proposed", `${formatDateLabel(nextDate)} · ${formatTime(nextStart)}–${formatTime(nextEnd)}`);
    }
    const changes = proposal.action.changes;
    const labels = { title: "New title", date: "New date", start: "New start", end: "New end", category: "Category", notes: "Notes", status: "Status" };
    for (const [field, label] of Object.entries(labels)) if (changes[field] != null && !(field === "date" && (changes.start || changes.end))) addDetailRow(details, label, field === "date" ? formatDateLabel(changes[field]) : changes[field]);
  }

  if (proposal.action?.postponeMinutes) {
    addDetailRow(details, "Postpone by", `${proposal.action.postponeMinutes} minutes`);
  }

  container.appendChild(details);

  const actionsEl = document.createElement("div");
  actionsEl.className = "proposal-actions";
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "primary-button";
  const planDeletes = proposal.plan?.actions?.some(action => action.type === "delete_item");
  confirmBtn.textContent = proposal.bulkAction?.type === "delete_items" || proposal.bulkAction?.type === "deduplicate_items" || proposal.action?.type === "delete_item" ? "Delete permanently" : planDeletes ? "Confirm plan with permanent deletion" : proposal.plan ? "Confirm plan" : "Confirm";
  confirmBtn.dataset.action = "confirm";
  const editBtn = document.createElement("button");
  editBtn.className = "secondary-button";
  editBtn.textContent = proposal.bulkAction ? "Edit scope" : "Edit";
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
    title.textContent = item.title || action.changes?.title || actionLabel(action.type);
    entry.appendChild(title);
    const details = document.createElement("p");
    details.textContent = `${item.date ? formatDateLabel(item.date) : "Date not specified"}${item.start ? ` · ${formatTime(item.start)}${item.end ? `–${formatTime(item.end)}` : ""}` : " · Anytime"}${item.category ? ` · ${item.category}` : ""}`;
    entry.appendChild(details);
    if (action.type === "delete_item") { const warning = document.createElement("small"); warning.textContent = "Permanent deletion cannot be undone through normal app controls."; entry.appendChild(warning); }
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

function scopeLabel(scope) {
  const labels = { today: "Today", tomorrow: "Tomorrow", current_week: "This week", next_week: "Next week", current_month: "This month", future: "Upcoming", overdue: "Overdue", completed: "Completed items", missed: "Missed items", cancelled: "Cancelled items", routines: "Routines", tasks: "Tasks", activities: "Activities", all_active: "All active upcoming items", absolutely_all: "All schedule history", specific_date: scope.startDate || "Selected date", date_range: `${scope.startDate || "Start"}–${scope.endDate || "End"}`, category: scope.categories?.join(", ") || "Selected category", title_match: scope.titleQuery || "Title match", referenced_items: "Referenced items", selected_item: "Selected items", current_item: "Current item" };
  return labels[scope.scopeType] || "Selected schedule scope";
}

function bulkOperationLabel(type) {
  if (type === "delete_items" || type === "deduplicate_items") return "Permanently delete selected items. This cannot be undone through normal app controls.";
  if (type === "cancel_items") return "Cancel selected items and keep their history.";
  if (type === "complete_items") return "Mark selected items completed.";
  if (type === "reschedule_items") return "Reschedule selected items.";
  if (type === "update_items") return "Update selected items.";
  return "Change selected schedule items.";
}

function actionLabel(type) {
  return ({ create_item: "Create an item", update_item: "Update an item", reschedule_item: "Reschedule an item", postpone_item: "Postpone an item", complete_item: "Complete an item", mark_missed: "Mark an item missed", cancel_item: "Cancel an item", restore_item: "Restore an item", delete_item: "Permanently delete an item" })[type] || "Schedule change";
}

function getProposalTitle(proposal) {
  if (proposal.bulkAction) return proposal.bulkAction.type === "delete_items" || proposal.bulkAction.type === "deduplicate_items" ? "Permanent schedule deletion" : "Bulk schedule change";
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
    case "restore_item": return "Restore cancelled item";
    case "delete_item": return "Permanently delete item";
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
  if (!["answer", "clarification", "proposed_action", "plan_proposal", "bulk_proposal", "no_action", "error"].includes(response.kind)) {
    return "Unsupported response kind";
  }
  if (!Object.prototype.hasOwnProperty.call(response, "planningContext")) return "Missing planning context";
  if (response.planningContext !== null && (!response.planningContext || typeof response.planningContext !== "object" || !Array.isArray(response.planningContext.proposedItems) || !Array.isArray(response.planningContext.constraints) || typeof response.planningContext.goal !== "string")) return "Invalid planning context";
  const validateAction = action => {
    if (!action || !saGetAllowedActions().includes(action.type)) return "Unsupported action type";
    if (action.type === "create_item" && (!action.item || action.targetId || action.changes)) return "create_item requires item and forbids targetId and changes";
    if (action.type !== "create_item" && !action.targetId) return `${action.type} requires targetId`;
    if (action.type !== "create_item" && !saFindItemById(action.targetId)) return "Target item not found";
    if (action.type === "restore_item" && saFindItemById(action.targetId)?.status !== "cancelled") return "restore_item requires a cancelled item";
    return saValidatePlanAction(action);
  };
  if (response.kind === "proposed_action") {
    if (!response.requiresConfirmation) return "Proposed action must require confirmation";
    const error = validateAction(response.action);
    if (error) return error;
  }
  if (response.kind === "plan_proposal") {
    if (!response.requiresConfirmation || response.action !== null || !response.plan || typeof response.plan.title !== "string" || !Array.isArray(response.plan.actions) || response.plan.actions.length < 2 || response.plan.actions.length > 20) return "Invalid plan proposal";
    const duplicateKeys = new Set();
    for (const action of response.plan.actions) {
      const error = validateAction(action);
      if (error) return error;
      const key = action.targetId ? `target|${action.targetId}` : `${action.type}|${action.item.type}|${action.item.title.toLowerCase()}|${action.item.date}|${action.item.start || ""}|${action.item.end || ""}`;
      if (duplicateKeys.has(key)) return "Plan contains duplicate actions";
      duplicateKeys.add(key);
    }
  }
  if (response.kind === "bulk_proposal") {
    const bulk = response.bulkAction;
    if (!response.requiresConfirmation || response.action !== null || response.plan !== null || !bulk || !Array.isArray(bulk.targetIds) || !bulk.targetIds.length || new Set(bulk.targetIds).size !== bulk.targetIds.length || bulk.affectedCount !== bulk.targetIds.length) return "Invalid bulk proposal";
    if (!bulk.scope || !["cancel_items", "delete_items", "complete_items", "reschedule_items", "update_items", "deduplicate_items"].includes(bulk.type)) return "Bulk operation and scope are required";
    const targets = bulk.targetIds.map(id => saFindItemById(id));
    if (targets.some(item => !item || !saItemMatchesScope(item, bulk.scope))) return "Bulk targets no longer match the requested scope";
  }
  return null;
}

async function callGeminiEndpoint(message, planningRequest = false, priorContext = null) {
  const isPlanning = planningRequest || Boolean(activePlanningContext);
  const referencedIds = [...new Set([
    ...entityRegistry.slice(-10).map(entity => entity.id),
    ...conversation.slice(-8).flatMap(entry => entry.referencedItemIds || [])
  ])];
  const referencedItems = referencedIds.map(id => saFindItemById(id)).filter(Boolean);
  const baselineItems = isPlanning ? saGetPlanningItems(activePlanningContext) : saGetRelevantItemsForContext(message, 20);
  const relevantItems = [...new Map([...referencedItems, ...baselineItems].map(item => [item.id, item])).values()].slice(0, 20);
  const compactFacts = isPlanning ? saGetWeeklyAvailabilityFacts() : saGetCompactFacts();
  const latestMessages = conversation.slice(-6).map(entry => ({ role: entry.role, text: String(entry.text || "").slice(0, 240), referencedItemIds: (entry.referencedItemIds || []).slice(0, 10) }));
  const toMinutes = value => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
  const now = new Date();
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map(part => [part.type, part.value]));
  const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const currentTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const scheduled = relevantItems.filter(item => item.date && item.start && item.end && !["completed", "cancelled"].includes(item.status)).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const calculatedFacts = {
    todayItems: relevantItems.filter(item => item.date === today).map(item => ({ id: item.id, title: item.title, start: item.start || null, end: item.end || null })),
    nextItem: scheduled.find(item => item.date > today || (item.date === today && item.start >= currentTime)) || null,
    durations: scheduled.map(item => ({ id: item.id, minutes: toMinutes(item.end) - toMinutes(item.start) })),
    gaps: scheduled.slice(1).filter((item, index) => item.date === scheduled[index].date).map((item, index) => ({ afterId: scheduled[index].id, beforeId: item.id, minutes: toMinutes(item.start) - toMinutes(scheduled[index].end) })),
    conflicts: scheduled.flatMap((item, index) => scheduled.slice(index + 1).filter(next => next.date === item.date && next.start < item.end).map(next => ({ date: item.date, itemIds: [item.id, next.id] }))),
    postponementHistory: relevantItems.filter(item => item.postponed > 0).map(item => ({ id: item.id, count: item.postponed })),
    candidateTimeSlots: (() => {
      const byDate = new Map();
      for (const item of scheduled) { if (!byDate.has(item.date)) byDate.set(item.date, []); byDate.get(item.date).push(item); }
      const slots = [];
      for (const [date, dayItems] of byDate) {
        let cursor = date === today && currentTime > "08:00" ? currentTime : "08:00";
        for (const item of dayItems) {
          if (item.start > cursor) {
            const minutes = toMinutes(item.start) - toMinutes(cursor);
            if (minutes >= 30) slots.push({ date, start: cursor, end: item.start, minutes });
          }
          if (item.end > cursor) cursor = item.end;
        }
        if (cursor < "20:00") {
          const minutes = toMinutes("20:00") - toMinutes(cursor);
          if (minutes >= 30) slots.push({ date, start: cursor, end: "20:00", minutes });
        }
      }
      return slots.slice(0, 10);
    })()
  };

  const requestBody = {
    message: message.trim().slice(0, 1200),
    context: relevantItems,
    conversationContext: {
      conversationId: activeConversationId,
      summary: "",
      latestMessages,
      currentTopic: activePlanningContext?.topic || null,
      continuesPreviousTopic: conversation.length > 1 && conversation[conversation.length - 2]?.role === "assistant",
      recentEntities: entityRegistry.slice(-10)
    },
    pendingOperation,
    referencedSets,
    pendingClarification: pendingClarification,
    compactFacts: compactFacts,
    calculatedFacts,
    activePlanningContext: activePlanningContext,
    priorContext
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MATSON_CONFIG.assistantTimeoutMs);
  try {
    const response = await fetch(MATSON_CONFIG.assistantEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal
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
    if (controller.signal.aborted) return { kind: "error", message: "The schedule assistant took too long to respond. Please try again." };
    return { kind: "error", message: "The schedule language service is not connected in this preview." };
  } finally {
    clearTimeout(timeoutId);
  }
}

function processGeminiResponse(response) {
  const validationError = validateGeminiResponse(response);
  if (validationError) {
    return {
      message: friendlyValidationMessage(validationError),
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

    case "bulk_proposal":
      pendingClarification = null;
      persistResponseState();
      return { message: response.message || "Review the selected schedule items.", items: [], proposal: buildBulkProposalFromGeminiResponse(response) };

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

function friendlyValidationMessage(reason) {
  if (/target item not found|targetid/i.test(reason)) return "I understood that you want to change the schedule, but I could not safely identify a current item. Which item do you mean?";
  if (/scope|bulk target/i.test(reason)) return "I could not safely resolve which schedule items are included. What date range or items should I use?";
  if (/cancelled item/i.test(reason)) return "I can restore an item only after it has been cancelled. Which cancelled item should I bring back?";
  return "I understood the schedule request, but need one more detail before I can prepare a safe proposal.";
}

function buildBulkProposalFromGeminiResponse(response) {
  const bulkAction = response.bulkAction;
  const items = bulkAction.targetIds.map(id => saFindItemById(id)).filter(Boolean).map(item => ({ ...item }));
  return { id: crypto.randomUUID(), bulkAction: { ...bulkAction, items }, message: response.message || "Review these schedule changes before confirming.", source: "gemini" };
}

function buildProposalFromGeminiResponse(response) {
  const action = response.action;
  if (!action) return null;

  const target = action.targetId ? saFindItemById(action.targetId) : null;
  let changes = action.changes ? { ...action.changes } : null;
  if (["reschedule_item", "update_item"].includes(action.type) && target && changes?.start && changes.end == null && target.start && target.end) {
    const [oldStartHour, oldStartMinute] = target.start.split(":").map(Number);
    const [oldEndHour, oldEndMinute] = target.end.split(":").map(Number);
    const [newHour, newMinute] = changes.start.split(":").map(Number);
    const endMinutes = newHour * 60 + newMinute + (oldEndHour * 60 + oldEndMinute - oldStartHour * 60 - oldStartMinute);
    changes.end = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
  }
  let conflict = null;
  const proposedDate = ["reschedule_item", "update_item"].includes(action.type) ? (changes?.date || target?.date) : action.item?.date;
  if (proposedDate && (["create_item", "reschedule_item"].includes(action.type) || (action.type === "update_item" && (changes?.date || changes?.start || changes?.end)))) {
    const candidate = action.item || (target ? { ...target, ...changes } : null);
    if (candidate?.start && candidate.end) {
      const peer = saGetItemsForDate(proposedDate).find(item => item.id !== target?.id && !["cancelled", "completed"].includes(item.status) && item.start && item.end && candidate.start < item.end && item.start < candidate.end);
      if (peer) conflict = [candidate, peer];
    }
  }
  const proposal = {
    id: crypto.randomUUID(),
    action: {
      type: action.type,
      targetId: action.targetId || null,
      item: action.item ? { ...action.item } : null,
      changes,
      postponeMinutes: action.postponeMinutes || null
    },
    message: response.message || "",
    conflict: conflict ? { items: [conflict[0].title, conflict[1].title] } : null,
    originalMessage: response.message || "",
    source: "gemini"
  };
  if (target && changes && ["reschedule_item", "update_item"].includes(action.type)) proposal.originalItem = { ...target };

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

function parseCommandTime(text) {
  const match = /\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i.exec(text);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "pm") hour += 12;
  return String(hour).padStart(2, "0") + ":" + (match[2] || "00");
}

function makeScope(scopeType, extra = {}) {
  const today = localDateString(new Date());
  const scope = { scopeType, startDate: null, endDate: null, statuses: ["upcoming", "in-progress", "postponed", "overdue", "awaiting-check-in"], itemTypes: [], categories: [], titleQuery: null, includeCompleted: false, includeCancelled: false, ...extra };
  if (scopeType === "today") scope.startDate = scope.endDate = today;
  if (scopeType === "tomorrow") { const date = parseLocalDate(today); date.setDate(date.getDate() + 1); scope.startDate = scope.endDate = localDateString(date); }
  if (scopeType === "specific_date" && scope.startDate) scope.endDate = scope.startDate;
  if (scopeType === "current_week" || scopeType === "next_week") {
    const start = parseLocalDate(today); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + (scopeType === "next_week" ? 7 : 0));
    const end = new Date(start); end.setDate(end.getDate() + 6); scope.startDate = localDateString(start); scope.endDate = localDateString(end);
  }
  if (scopeType === "current_month") { scope.startDate = today.slice(0, 7) + "-01"; const end = parseLocalDate(scope.startDate); end.setMonth(end.getMonth() + 1); end.setDate(0); scope.endDate = localDateString(end); }
  if (["completed", "missed", "cancelled", "overdue"].includes(scopeType)) { scope.statuses = [scopeType]; scope.includeCompleted = scopeType === "completed"; scope.includeCancelled = scopeType === "cancelled"; }
  if (scopeType === "all_active") scope.statuses = ["upcoming", "in-progress", "postponed", "overdue", "awaiting-check-in"];
  if (scopeType === "absolutely_all") { scope.statuses = []; scope.includeCompleted = true; scope.includeCancelled = true; }
  return scope;
}

function inferBulkScope(text) {
  const lower = text.toLowerCase();
  const explicitDate = /\b(\d{4}-\d{2}-\d{2})\b/.exec(lower)?.[1];
  let scopeType = null;
  if (/\b(today|this day|the day)\b/.test(lower)) scopeType = "today";
  else if (/\btomorrow\b/.test(lower)) scopeType = "tomorrow";
  else if (/\bnext week\b/.test(lower)) scopeType = "next_week";
  else if (/\b(this week|the week)\b/.test(lower)) scopeType = "current_week";
  else if (/\bthis month\b/.test(lower)) scopeType = "current_month";
  else if (explicitDate) scopeType = "specific_date";
  else if (/\boverdue\b/.test(lower)) scopeType = "overdue";
  else if (/\bcompleted|done\b/.test(lower)) scopeType = "completed";
  else if (/\bmissed|skipped\b/.test(lower)) scopeType = "missed";
  else if (/\bcancelled|canceled\b/.test(lower)) scopeType = "cancelled";
  else if (/\broutines?\b/.test(lower)) scopeType = "routines";
  else if (/\btasks?\b/.test(lower)) scopeType = "tasks";
  else if (/\bactivities\b/.test(lower)) scopeType = "activities";
  else if (/\b(future|upcoming|active)\b/.test(lower)) scopeType = "all_active";
  else if (/\b(all|everything|every)\b/.test(lower)) scopeType = "absolutely_all";
  if (!scopeType) return null;
  const scope = makeScope(scopeType, explicitDate ? { startDate: explicitDate, endDate: explicitDate } : {});
  if (/\bcompleted\b/.test(lower) && scopeType !== "completed") { scope.statuses = ["completed"]; scope.includeCompleted = true; }
  if (/\bcancelled|canceled\b/.test(lower) && scopeType !== "cancelled") { scope.statuses = ["cancelled"]; scope.includeCancelled = true; }
  if (/\broutines?\b/.test(lower)) scope.itemTypes = ["routine"];
  else if (/\btasks?\b/.test(lower)) scope.itemTypes = ["task"];
  else if (/\bactivities\b/.test(lower)) scope.itemTypes = ["activity"];
  const title = /\b(gym|studio|meeting|practice|rehearsal)\b/.exec(lower)?.[1];
  if (title) scope.titleQuery = title;
  return scope;
}

function presentBulkProposal(type, scope, selected, message) {
  if (!selected.length) { appendEntry({ role: "assistant", text: "I couldn't find items in that scope." }); return; }
  if (selected.length > 450) { appendEntry({ role: "assistant", text: "That scope is too large for one safe batch. Narrow the date range or item type first." }); return; }
  currentProposal = { id: crypto.randomUUID(), bulkAction: { type, scope, targetIds: selected.map(item => item.id), affectedCount: selected.length, items: selected.map(item => ({ ...item })) }, message, source: "local" };
  renderProposalMessage(message); renderProposal(currentProposal);
  appendEntry({ role: "assistant", text: message, kind: "proposal_summary", proposalSummary: message, resolved: false, referencedItemIds: selected.map(item => item.id) });
}

function askOperationClarification(question, operation) {
  pendingOperation = operation;
  pendingClarification = { intent: operation.intent, knownFields: operation.knownFields || {}, missingFields: operation.missingFields || [] };
  savePlanningContext();
  appendEntry({ role: "assistant", text: question });
}

function detectDuplicatePair(text) {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const groups = saFindDuplicateGroups().filter(group => {
    const title = group.items[0].title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return group.classification === "exact_duplicate" && normalized.includes(title);
  });
  return groups.length === 1 && groups[0].items.length === 2 ? groups[0].items : null;
}

function proposeDuplicateCleanup(pair, newStart) {
  const sorted = [...pair].sort((a, b) => (a.createdAt?.toMillis?.() ?? new Date(a.createdAt || 0).getTime()) - (b.createdAt?.toMillis?.() ?? new Date(b.createdAt || 0).getTime()));
  const keep = sorted[0], remove = sorted[1];
  const duration = Number(keep.end.slice(0, 2)) * 60 + Number(keep.end.slice(3)) - Number(keep.start.slice(0, 2)) * 60 - Number(keep.start.slice(3));
  const endMinutes = newStart ? Number(newStart.slice(0, 2)) * 60 + Number(newStart.slice(3)) + duration : 0;
  const end = newStart ? String(Math.floor(endMinutes / 60)).padStart(2, "0") + ":" + String(endMinutes % 60).padStart(2, "0") : null;
  currentProposal = { id: crypto.randomUUID(), plan: { title: "Clean up duplicate " + keep.title, actions: [
    { type: "delete_item", targetId: remove.id, item: null, changes: null, postponeMinutes: null },
    { type: "reschedule_item", targetId: keep.id, item: null, changes: { start: newStart, end }, postponeMinutes: null }
  ] }, message: "I recommend keeping the older " + keep.title + ", permanently deleting the newer duplicate, and moving the remaining session" + (newStart ? " to " + formatTime(newStart) + " while preserving its duration." : ". Permanent deletion cannot be undone through normal app controls."), source: "local" };
  renderProposalMessage(currentProposal.message); renderProposal(currentProposal);
  appendEntry({ role: "assistant", text: currentProposal.message, kind: "proposal_summary", proposalSummary: currentProposal.message, resolved: false, referencedItemIds: [remove.id, keep.id] });
}

function routePendingOperation(text) {
  if (!pendingOperation) return false;
  const lower = text.toLowerCase();
  if (pendingOperation.intent === "clear_scope") {
    let scopeType = null;
    if (/\b(active|upcoming|future|planned)\b/.test(lower)) scopeType = "all_active";
    else if (/\b(everything|all|every).*(history|stored|completed|cancelled|canceled)|\b(include|including).*(history|completed|cancelled|canceled)/.test(lower)) scopeType = "absolutely_all";
    if (!scopeType) { appendEntry({ role: "assistant", text: "Should I clear only active upcoming items, or every schedule item including completed and cancelled history?" }); return true; }
    const method = pendingOperation.method || pendingOperation.knownFields?.method || null;
    pendingOperation = { intent: "clear_method", scope: makeScope(scopeType), knownFields: { method } };
    if (method) return routePendingOperation(method);
    askOperationClarification("Should I cancel those items and keep their history, or delete them permanently?", pendingOperation);
    return true;
  }
  if (pendingOperation.intent === "clear_method") {
    const explicitDelete = /\b(delete|erase|permanently|remove permanently|get rid of completely)\b/.test(lower) || /\bdelete\b/.test(lower);
    const explicitCancel = /\b(cancel|keep their history)\b/.test(lower);
    if (!explicitDelete && !explicitCancel) { appendEntry({ role: "assistant", text: "Should I cancel those items and keep their history, or delete them permanently?" }); return true; }
    const scope = pendingOperation.scope;
    const selected = items.filter(item => saItemMatchesScope(item, scope));
    pendingOperation = null; pendingClarification = null; savePlanningContext();
    presentBulkProposal(explicitDelete ? "delete_items" : "cancel_items", scope, selected, `${explicitDelete ? "Permanently delete" : "Cancel"} ${selected.length} item${selected.length === 1 ? "" : "s"} in ${scopeLabel(scope)}?`);
    return true;
  }
  if (pendingOperation.intent === "deduplicate_and_reschedule") {
    const time = parseCommandTime(text);
    if (!time) { appendEntry({ role: "assistant", text: "What time should I move the remaining " + (pendingOperation.title || pendingOperation.knownFields?.title || "item") + " to?" }); return true; }
    const pair = (pendingOperation.targetIds || []).map(id => saFindItemById(id)).filter(Boolean);
    if (pair.length !== 2) { pendingOperation = null; pendingClarification = null; appendEntry({ role: "assistant", text: "Those schedule items have changed. Please describe the duplicate cleanup again." }); savePlanningContext(); return true; }
    pendingOperation = null; pendingClarification = null; savePlanningContext();
    proposeDuplicateCleanup(pair, time);
    return true;
  }
  return false;
}

function routeBulkCommand(text) {
  const lower = text.toLowerCase();
  if (/\bduplicate|repeated|repetition\b/.test(lower) && /\b(move|reschedule|postpone|remainder|remaining|rest)\b/.test(lower)) {
    const pair = detectDuplicatePair(text);
    if (!pair) { appendEntry({ role: "assistant", text: "I understood the duplicate cleanup, but I could not identify one exact pair. Which item and date do you mean?" }); return true; }
    pair.forEach(item => rememberScheduleEntity(item, "referenced", ["duplicate", "remaining"]));
    referencedSets = [...referencedSets, { title: pair[0].title, ids: pair.map(item => item.id), date: pair[0].date, createdAt: new Date().toISOString() }].slice(-5);
    const time = parseCommandTime(text);
    if (!time) { const sorted = [...pair].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)); pendingOperation = { intent: "deduplicate_and_reschedule", targetIds: sorted.map(item => item.id), knownFields: { title: sorted[0].title, date: sorted[0].date, currentStart: sorted[0].start, currentEnd: sorted[0].end, keepId: sorted[0].id, deleteId: sorted[1].id } }; pendingClarification = { intent: pendingOperation.intent, knownFields: pendingOperation.knownFields, missingFields: ["start"] }; savePlanningContext(); appendEntry({ role: "assistant", text: `What time should I move the remaining ${sorted[0].title} to?` }); return true; }
    proposeDuplicateCleanup(pair, time); return true;
  }
  if (/\bduplicate|repeated|repetition\b/.test(lower) && /\b(delete|remove|clean|deduplicate)\b/.test(lower)) {
    const groups = saFindDuplicateGroups().filter(group => group.classification === "exact_duplicate");
    const titleText = lower.replace(/[^\p{L}\p{N}]+/gu, " ");
    const groupsForTitle = groups.filter(group => titleText.includes(saNormalizeTitle(group.items[0].title)));
    const chosen = groupsForTitle.length ? groupsForTitle : groups;
    const remove = chosen.flatMap(group => group.items.slice(1));
    if (!remove.length) { appendEntry({ role: "assistant", text: "I couldn't find exact duplicate schedule items to remove." }); return true; }
    const scope = makeScope("referenced_items", { statuses: [], includeCompleted: true, includeCancelled: true });
    presentBulkProposal("deduplicate_items", scope, remove, `Keep the oldest item in each exact duplicate group and permanently delete ${remove.length} newer duplicate${remove.length === 1 ? "" : "s"}?`); return true;
  }
  const bulkIntent = /\b(clear|wipe|empty|free|remove|delete|cancel|complete|mark).*(\ball\b|\bevery\b|\beverything\b|\brest\b|\bremainder\b|\bduplicates?\b)|\b(cancel|delete) the week\b/.test(lower);
  if (!bulkIntent) return false;
  let scope = inferBulkScope(text);
  const explicitDelete = /\b(delete|erase|permanently|remove permanently|get rid of completely)\b/.test(lower);
  const explicitCancel = /\bcancel\b/.test(lower);
  const op = /\bcomplete|mark .*done\b/.test(lower) ? "complete_items" : explicitDelete ? "delete_items" : explicitCancel ? "cancel_items" : null;
  if (!scope || (scope.scopeType === "absolutely_all" && !/\b(today|tomorrow|week|month|completed|missed|cancelled|canceled|routine|task|activity|gym|studio|meeting|practice)\b/.test(lower))) {
    pendingOperation = { intent: "clear_scope", method: op === "delete_items" ? "delete permanently" : op === "cancel_items" ? "cancel" : null };
    pendingClarification = { intent: "clear_scope", knownFields: pendingOperation, missingFields: ["scope"] }; savePlanningContext();
    appendEntry({ role: "assistant", text: "Do you mean all active upcoming items, or every schedule item including completed and cancelled history?" }); return true;
  }
  if (!op) { askOperationClarification("Should I cancel those items and preserve their history, or delete them permanently?", { intent: "clear_method", scope }); return true; }
  const selected = items.filter(item => saItemMatchesScope(item, scope));
  presentBulkProposal(op, scope, selected, `${op === "delete_items" ? "Permanently delete" : op === "cancel_items" ? "Cancel" : "Mark completed"} ${selected.length} item${selected.length === 1 ? "" : "s"} in ${scopeLabel(scope)}?`);
  return true;
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
    pendingOperation = null;
    currentProposal = null;
    savePlanningContext();
    appendEntry({ role: "assistant", text: "Okay, I’ve cleared that planning topic." });
    updateSummaryIfPlanningResolved();
    renderConversation();
    return;
  }

  if (routePendingOperation(text)) { saveConversation(); return; }
  if (routeBulkCommand(text)) { saveConversation(); return; }

  const recallContext = await getRecallContext(text);
  if (recallContext) {
    const normalizedRecallText = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const recallItems = saGetRelevantItemsForContext(text, 20).filter(item => item.title && normalizedRecallText.includes(item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()));
    recallItems.forEach(item => rememberScheduleEntity(item, "recalled", [item.title, "that", "it"]));
    if (recallItems.length) await firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction });
  }
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
  if (currentProposal.confirming) return;
  currentProposal.confirming = true;
  if (currentProposal.bulkAction) { await confirmBulkProposal(); return; }
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
      rememberScheduleEntity(result.item, "created", ["that", "it", result.item.title]);
      appendEntry({ role: "assistant", text: `Created "${result.item.title}" for ${formatDateLabel(result.item.date)}.`, referencedItemIds: [result.item.id] });
      break;

    case "complete_item":
      result = await saCompleteItem(action.targetId);
      if (!result.success) {
        showProcessingError(result.error);
        return;
      }
      rememberScheduleEntity(result.item, "completed", ["that", "it"]);
      appendEntry({ role: "assistant", text: `Marked "${result.item.title}" as completed.`, referencedItemIds: [result.item.id] });
      break;

    case "cancel_item":
      result = await saCancelItem(action.targetId);
      if (!result.success) {
        showProcessingError(result.error);
        return;
      }
      rememberScheduleEntity(result.item, "cancelled", ["that", "it"]);
      appendEntry({ role: "assistant", text: `Cancelled "${result.item.title}".`, referencedItemIds: [result.item.id] });
      break;

    case "restore_item":
      result = await saRestoreItem(action.targetId);
      if (!result.success) { currentProposal.confirming = false; showProcessingError(result.error); return; }
      rememberScheduleEntity(result.item, "restored", ["that", "it"]);
      appendEntry({ role: "assistant", text: `Restored "${result.item.title}" to your upcoming schedule.`, referencedItemIds: [result.item.id] });
      break;

    case "delete_item":
      result = await saDeleteItem(action.targetId);
      if (!result.success) { currentProposal.confirming = false; showProcessingError(result.error); return; }
      await firebaseStore.markConversationItemDeleted(activeConversationId, result.item.id).catch(showPersistenceFailure);
      rememberScheduleEntity(result.item, "deleted", ["that", "it"]);
      appendEntry({ role: "assistant", text: `Permanently deleted "${result.item.title}". This cannot be undone through normal app controls.`, referencedItemIds: [result.item.id] });
      break;

    case "mark_missed":
      result = await saMarkItemMissed(action.targetId);
      if (!result.success) {
        showProcessingError(result.error);
        return;
      }
      rememberScheduleEntity(result.item, "missed", ["that", "it"]);
      appendEntry({ role: "assistant", text: `Marked "${result.item.title}" as missed.`, referencedItemIds: [result.item.id] });
      break;

    case "reschedule_item":
      const target = saFindItemById(action.targetId);
      if (!target) {
        showProcessingError("Item no longer exists.");
        return;
      }
      const changes = action.changes || {};
      const nextItem = { ...target, ...changes };
      if (!nextItem.date || !nextItem.start || !nextItem.end || nextItem.start >= nextItem.end) {
        showProcessingError("Missing new schedule details.");
        return;
      }
      const conflictCheck = saDetectConflictsForDate(nextItem.date);
      if (conflictCheck && !conflictCheck.find(i => i.id === action.targetId)) {
        renderProposalMessage(`Warning: ${conflictCheck[0].title} and ${conflictCheck[1].title} overlap on ${formatDateLabel(nextItem.date)}.`);
      }
      result = await saRescheduleItem(action.targetId, nextItem.date, nextItem.start, nextItem.end);
      if (!result.success) {
        showProcessingError(result.error);
        return;
      }
      rememberScheduleEntity(result.item, "rescheduled", ["that", "it"]);
      appendEntry({ role: "assistant", text: `Moved "${result.item.title}" to ${formatDateLabel(result.item.date)} from ${formatTime(result.item.start)} to ${formatTime(result.item.end)}.`, referencedItemIds: [result.item.id] });
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
      rememberScheduleEntity(result.item, "updated", ["that", "it"]);
      appendEntry({ role: "assistant", text: `Updated "${result.item.title}".`, referencedItemIds: [result.item.id] });
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
      rememberScheduleEntity(result.item, "postponed", ["that", "it"]);
      break;

    default:
      showProcessingError("Unsupported action type.");
      return;
  }

  currentProposal = null;
  pendingOperation = null;
  lastConfirmedAction = { type: action.type, targetId: action.targetId || null, confirmedAt: new Date().toISOString() };
  await firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction });
  await persistenceQueue;
  await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
  conversation.forEach(entry => { if (entry.kind === "proposal_summary") entry.resolved = true; });
  await firebaseStore.updateConversationSummary(activeConversationId, conversationSummary("active")).catch(showPersistenceFailure);
  saveConversation();
  renderConversation();
}

async function confirmBulkProposal() {
  const proposal = currentProposal;
  if (!proposal?.bulkAction) return;
  const result = await saApplyBulkAtomically(proposal.bulkAction);
  if (!result.success) { showProcessingError(result.error); return; }
  if (["delete_items", "deduplicate_items"].includes(proposal.bulkAction.type)) {
    (result.items || []).forEach(item => rememberScheduleEntity(item, "deleted", ["that", "those", item.title]));
    await firebaseStore.markConversationItemsDeleted(activeConversationId, result.items.map(item => item.id)).catch(showPersistenceFailure);
  } else {
    const lastAction = ({ cancel_items: "cancelled", complete_items: "completed", update_items: "updated", reschedule_items: "rescheduled" })[proposal.bulkAction.type] || "updated";
    (result.changedItems || []).forEach(item => rememberScheduleEntity(item, lastAction, ["that", "those", item.title]));
  }
  const targetIds = proposal.bulkAction.targetIds.slice();
  lastConfirmedAction = { type: proposal.bulkAction.type, targetIds, affectedCount: targetIds.length, confirmedAt: new Date().toISOString() };
  pendingOperation = null;
  currentProposal = null;
  await firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction });
  await persistenceQueue;
  await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
  conversation.forEach(entry => { if (entry.kind === "proposal_summary") entry.resolved = true; });
  const deleted = ["delete_items", "deduplicate_items"].includes(proposal.bulkAction.type);
  appendEntry({ role: "assistant", text: deleted ? `Permanently deleted ${targetIds.length} schedule item${targetIds.length === 1 ? "" : "s"}. This cannot be undone through normal app controls.` : `Confirmed. Updated ${targetIds.length} schedule item${targetIds.length === 1 ? "" : "s"}.`, referencedItemIds: targetIds });
  await firebaseStore.updateConversationSummary(activeConversationId, conversationSummary("active")).catch(showPersistenceFailure);
  renderConversation();
}

function validatePlanProposal(proposal) {
  if (!proposal || !proposal.plan || typeof proposal.plan.title !== "string" || !Array.isArray(proposal.plan.actions) || proposal.plan.actions.length < 2 || proposal.plan.actions.length > 20) return "This plan does not contain a valid number of actions.";
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
  const actionsById = new Map(proposal.plan.actions.filter(action => action.targetId).map(action => [action.targetId, action.type.replace(/_item$/, "")]));
  const savedIds = new Set(actionsById.keys());
  const createdItems = (result.changedItems || []).filter(item => !savedIds.has(item.id));
  (result.changedItems || []).forEach(item => rememberScheduleEntity(item, actionsById.get(item.id) || (createdItems.includes(item) ? "created" : "updated"), ["that", "it", item.title]));
  (result.deletedItems || []).forEach(item => rememberScheduleEntity(item, "deleted", ["that", "it", item.title]));
  if (result.deletedIds?.length) await firebaseStore.markConversationItemsDeleted(activeConversationId, result.deletedIds).catch(showPersistenceFailure);
  currentProposal = null;
  pendingClarification = null;
  activePlanningContext = null;
  pendingOperation = null;
  lastConfirmedAction = { type: "plan_proposal", targetIds: (result.changedItems || []).map(item => item.id), confirmedAt: new Date().toISOString() };
  await firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction });
  await persistenceQueue;
  await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
  conversation.forEach(entry => { if (entry.kind === "proposal_summary") entry.resolved = true; });
  appendEntry({ role: "assistant", text: `Confirmed. The complete plan with ${proposal.plan.actions.length} actions has been saved.`, referencedItemIds: [...(result.changedItems || []).map(item => item.id), ...(result.deletedIds || [])] });
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
  if (currentProposal) {
    currentProposal.confirming = false;
    assistantEls.conversation.querySelector(".proposal")?.remove();
    renderProposal(currentProposal);
  }
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
