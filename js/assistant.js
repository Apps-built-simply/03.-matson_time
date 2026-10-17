/* Assistant page — coordinator for deterministic and Gemini-assisted schedule requests */

const PENDING_MESSAGE_WRITES_KEY = `matson-time-pending-message-writes-${firebaseStore.getCurrentUser().uid}`;
const MAX_CONVERSATION_ENTRIES = 30;

const assistantEls = {
  conversation: document.querySelector("#conversation"),
  empty: document.querySelector("#assistantEmpty"),
  quickQuestionsControl: document.querySelector("#quickQuestionsControl"),
  quickQuestionsPanel: document.querySelector("#quickQuestionsPanel"),
  input: document.querySelector("#assistantInput"),
  send: document.querySelector("#sendButton"),
  voice: document.querySelector("#voiceButton"),
  voiceNotice: document.querySelector("#voiceNotice"),
  nav: document.querySelector("#navAssistant"),
  saveNotice: document.querySelector("#conversationSaveNotice"),
  saveText: document.querySelector("#conversationSaveText"),
  retrySave: document.querySelector("#retryConversationSave"),
  scrollLatest: document.querySelector("#scrollLatestButton"),
  historyButton: document.querySelector("#conversationHistoryButton"),
  newConversationHeaderButton: document.querySelector("#newConversationHeaderButton"),
  assistantGuidanceButton: document.querySelector("#assistantGuidanceButton"),
  drawer: document.querySelector("#conversationDrawer"),
  drawerBackdrop: document.querySelector("#drawerBackdrop"),
  closeDrawerButton: document.querySelector("#closeDrawerButton"),
  drawerNewConversationButton: document.querySelector("#drawerNewConversationButton"),
  drawerSearchInput: document.querySelector("#drawerSearchInput"),
  drawerLoading: document.querySelector("#drawerLoading"),
  drawerError: document.querySelector("#drawerError"),
  drawerRetryButton: document.querySelector("#drawerRetryButton"),
  drawerEmpty: document.querySelector("#drawerEmpty"),
  drawerNoResults: document.querySelector("#drawerNoResults"),
  drawerConversationList: document.querySelector("#drawerConversationList"),
  drawerLoadMoreWrap: document.querySelector("#drawerLoadMoreWrap"),
  drawerLoadMoreButton: document.querySelector("#drawerLoadMoreButton"),
  drawerDeleteButton: document.querySelector("#drawerDeleteConversationButton"),
  deleteDialog: document.querySelector("#deleteConversationDialog"),
  confirmDeleteButton: document.querySelector("#confirmDeleteConversationButton"),
  keepDeleteButton: document.querySelector("#keepDeleteConversationButton"),
  contextMenu: document.querySelector("#conversationContextMenu"),
  contextRenameButton: document.querySelector("#contextRenameButton"),
  contextDeleteButton: document.querySelector("#contextDeleteButton"),
  renameDialog: document.querySelector("#renameConversationDialog"),
  renameForm: document.querySelector("#renameConversationForm"),
  renameInput: document.querySelector("#renameConversationInput"),
  renameError: document.querySelector("#renameConversationError"),
  closeRenameButton: document.querySelector("#closeRenameDialogButton"),
  cancelRenameButton: document.querySelector("#cancelRenameButton"),
  saveRenameButton: document.querySelector("#saveRenameButton")
};

let voiceNoticeTimer = null;
const composerDrafts = new Map();
let isComposing = false;
let sendInProgress = false;
let newConversationInProgress = false;
let waitingEl = null;
let activeRevealController = null;
let activeRequestId = null;
let drawerConversations = [];
let isDrawerOpen = false;
let drawerTriggerButton = null;
let drawerLimit = 20;
let contextMenuConv = null;
let contextMenuTriggerEl = null;
let deletingConversationId = null;
let renamingConversationId = null;
let conversation = Array.isArray(window.initialConversation?.messages) ? window.initialConversation.messages.map(message => ({ role: message.role, text: message.text, kind: message.kind, resolved: message.resolved, referencedItemIds: message.referencedItemIds || [], deletedItemIds: message.deletedItemIds || [] })) : [];
let activeConversationId = window.initialConversation?.id || window.initialAssistantState?.activeConversationId || null;
let guidedFlowsByConversation = window.initialAssistantState?.guidedFlowsByConversation && typeof window.initialAssistantState.guidedFlowsByConversation === "object" ? { ...window.initialAssistantState.guidedFlowsByConversation } : {};
let guidedFlow = activeConversationId ? (guidedFlowsByConversation[activeConversationId] || (window.initialAssistantState?.activeConversationId === activeConversationId ? window.initialAssistantState?.guidedFlow : null)) : null;
let pendingClarification = window.initialAssistantState?.pendingClarification || null;
let entityRegistry = Array.isArray(window.initialAssistantState?.entityRegistry) ? window.initialAssistantState.entityRegistry.slice(-10) : [];
let pendingOperation = window.initialAssistantState?.pendingOperation || null;
if (["awaiting_confirmation", "executing", "failed"].includes(pendingOperation?.state)) {
  pendingOperation = { ...pendingOperation, state: "expired", targetIds: [] };
  pendingClarification = null;
}
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
  firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction, guidedFlow, guidedFlowsByConversation, currentTopic: activePlanningContext?.topic || pendingOperation?.intent || null }).catch(showPersistenceFailure);
}
function saveGuidedFlow() {
  if (activeConversationId) {
    if (guidedFlow) guidedFlowsByConversation[activeConversationId] = guidedFlow;
    else delete guidedFlowsByConversation[activeConversationId];
  }
  return firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction, guidedFlow, guidedFlowsByConversation }).catch(() => { showPersistenceFailure(); return false; });
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
window.refreshAssistantScheduleItem = (item, lastAction = "updated") => {
  rememberScheduleEntity(item, lastAction, ["that", "it", item?.title]);
  savePlanningContext();
};
function saveConversation() { /* Conversation writes are queued by appendEntry. */ }

function deriveConversationTitle(rawText) {
  if (!rawText || typeof rawText !== "string") return "New conversation";
  let text = rawText.trim().replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, "");

  if (/\b(?:[a-f0-9]{16,}|ai[a-z0-9_-]{20,})\b/i.test(text)) {
    return "Schedule request";
  }

  const moveMatch = text.match(/^(?:please\s+)?(?:move|reschedule)\s+(?:my\s+)?([a-z0-9\s]+?)(?:\s+(?:to|for|at|on)\b.*)?$/i);
  if (moveMatch && moveMatch[1]?.trim()) {
    const item = moveMatch[1].trim();
    if (item.length <= 25) {
      return item.charAt(0).toUpperCase() + item.slice(1) + " move";
    }
  }

  const manageMatch = text.match(/^(?:help\s+me\s+)?manage\s+(?:the\s+)?([a-z0-9\s]+?)(?:\s+and\s+(?:the\s+)?([a-z0-9\s]+?))?$/i);
  if (manageMatch && manageMatch[1]) {
    const part1 = manageMatch[1].trim();
    const part2 = manageMatch[2]?.trim();
    if (part2) {
      const p1 = part1.charAt(0).toUpperCase() + part1.slice(1);
      const p2 = part2.replace(/^meeting with\s+/i, "");
      const p2Title = p2.charAt(0).toUpperCase() + p2.slice(1);
      return `${p1} and ${p2Title} meeting`;
    }
  }

  text = text.replace(/^(?:can you|could you|please|help me|i want to|i need to|tell me|what do i have|what is|how about)\s+/i, "");
  if (!text) text = rawText.trim();
  if (text.length > 34) {
    const cut = text.slice(0, 34);
    const lastSpace = cut.lastIndexOf(" ");
    text = (lastSpace > 16 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function conversationSummary(status = "active") {
  const userMessages = conversation.filter(entry => entry.role === "user").map(entry => entry.text);
  const firstUserMessage = userMessages[0] || "";
  const title = firstUserMessage ? deriveConversationTitle(firstUserMessage) : "New conversation";
  const summary = conversation.slice(-6).map(entry => `${entry.role === "user" ? "Matson" : "Assistant"}: ${entry.text}`).join(" ").slice(0, 500);
  return { title, summary, keywords: firebaseStore.tokenizeKeywords(`${title} ${summary}`), status };
}

async function ensureConversation() {
  if (activeConversationId) return activeConversationId;
  activeConversationId = await firebaseStore.createConversation({ title: "New conversation", status: "active" });
  await firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction, guidedFlow, guidedFlowsByConversation });
  loadDrawerConversations().catch(() => {});
  return activeConversationId;
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

function saveEntryForConversation(convId, entry) {
  const message = {
    id: crypto.randomUUID(),
    role: entry.role,
    text: entry.text,
    kind: entry.kind || (entry.role === "user" ? "user_message" : "assistant_message"),
    referencedItemIds: entry.referencedItemIds || [],
    deletedItemIds: [],
    proposalSummary: entry.proposalSummary || null,
    resolved: entry.resolved !== false
  };
  pendingMessageWrites.push({ conversationId: convId, message });
  localStorage.setItem(PENDING_MESSAGE_WRITES_KEY, JSON.stringify(pendingMessageWrites));
  persistenceQueue = persistenceQueue.then(persistPendingMessages);
  firebaseStore.updateConversationSummary(convId, {
    status: "active",
    summary: entry.text.slice(0, 300)
  }).catch(() => {});
}

function formatDrawerDate(val) {
  if (!val) return "";
  let date;
  if (typeof val.toDate === "function") date = val.toDate();
  else if (val instanceof Date) date = val;
  else if (val.seconds) date = new Date(val.seconds * 1000);
  else return "";

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getConversationPreview(conv) {
  if (conv.summary && conv.summary.trim()) return conv.summary.trim();
  if (conv.lastMessagePreview && conv.lastMessagePreview.trim()) return conv.lastMessagePreview.trim();
  return "No messages yet";
}

function normalizeSearchTerm(str) {
  return (str || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim();
}

function filterDrawerConversations() {
  const query = normalizeSearchTerm(assistantEls.drawerSearchInput?.value);
  if (!query) return drawerConversations;
  const terms = query.split(/\s+/).filter(Boolean);
  return drawerConversations.filter(conv => {
    const title = (conv.title || "").toLowerCase();
    const summary = (conv.summary || "").toLowerCase();
    const preview = (conv.lastMessagePreview || "").toLowerCase();
    const keywords = (conv.keywords || []).map(k => String(k).toLowerCase());
    return terms.every(term =>
      title.includes(term) ||
      summary.includes(term) ||
      preview.includes(term) ||
      keywords.some(k => k.includes(term))
    );
  });
}

function openContextMenu(conv, x, y, triggerEl) {
  if (!assistantEls.contextMenu || !conv) return;
  contextMenuConv = conv;
  contextMenuTriggerEl = triggerEl || null;

  assistantEls.contextMenu.hidden = false;
  const menuWidth = 150;
  const menuHeight = 84;

  let left = x;
  let top = y;

  if (left + menuWidth > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuWidth - 8);
  }
  if (top + menuHeight > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - menuHeight - 8);
  }

  assistantEls.contextMenu.style.left = `${left}px`;
  assistantEls.contextMenu.style.top = `${top}px`;

  if (triggerEl && triggerEl.classList.contains("drawer-item-menu-button")) {
    triggerEl.setAttribute("aria-expanded", "true");
  }

  assistantEls.contextRenameButton?.focus();
}

function closeContextMenu() {
  if (!assistantEls.contextMenu || assistantEls.contextMenu.hidden) return;
  assistantEls.contextMenu.hidden = true;
  if (contextMenuTriggerEl && contextMenuTriggerEl.classList.contains("drawer-item-menu-button")) {
    contextMenuTriggerEl.removeAttribute("aria-expanded");
  }
  if (contextMenuTriggerEl && contextMenuTriggerEl.isConnected) {
    contextMenuTriggerEl.focus();
  }
  contextMenuConv = null;
  contextMenuTriggerEl = null;
}

function renderDrawerList(items) {
  if (!assistantEls.drawerConversationList) return;
  assistantEls.drawerConversationList.replaceChildren();
  if (!items.length) {
    if (assistantEls.drawerSearchInput?.value.trim()) {
      assistantEls.drawerNoResults.hidden = false;
    } else {
      assistantEls.drawerEmpty.hidden = false;
    }
    return;
  }
  assistantEls.drawerNoResults.hidden = true;
  assistantEls.drawerEmpty.hidden = true;

  for (const conv of items) {
    const row = document.createElement("div");
    row.className = "drawer-conversation-item" + (conv.id === activeConversationId ? " active" : "");
    row.dataset.id = conv.id;
    row.setAttribute("role", "listitem");
    row.tabIndex = 0;

    const title = document.createElement("span");
    title.className = "drawer-item-title";
    title.textContent = conv.title || "New conversation";
    row.appendChild(title);

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "drawer-item-menu-button";
    menuBtn.setAttribute("aria-label", `Conversation options for ${conv.title || "New conversation"}`);
    menuBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;
    row.appendChild(menuBtn);

    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let longPressTriggered = false;

    function clearPressTimer() {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }

    row.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      if (event.target.closest(".drawer-item-menu-button")) return;
      startX = event.clientX;
      startY = event.clientY;
      longPressTriggered = false;
      clearPressTimer();
      pressTimer = setTimeout(() => {
        longPressTriggered = true;
        openContextMenu(conv, startX, startY, row);
      }, 550);
    });

    row.addEventListener("pointermove", event => {
      if (!pressTimer) return;
      const dx = Math.abs(event.clientX - startX);
      const dy = Math.abs(event.clientY - startY);
      if (dx > 8 || dy > 8) {
        clearPressTimer();
      }
    });

    row.addEventListener("pointerup", () => {
      clearPressTimer();
    });

    row.addEventListener("pointercancel", () => {
      clearPressTimer();
    });

    row.addEventListener("contextmenu", event => {
      event.preventDefault();
      clearPressTimer();
      openContextMenu(conv, event.clientX, event.clientY, row);
    });

    row.addEventListener("click", event => {
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      if (event.target.closest(".drawer-item-menu-button")) return;
      openConversation(conv.id);
    });

    row.addEventListener("keydown", event => {
      if (event.target !== row) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openConversation(conv.id);
      } else if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
        event.preventDefault();
        const rect = row.getBoundingClientRect();
        openContextMenu(conv, rect.left + 40, rect.bottom, row);
      }
    });

    menuBtn.addEventListener("click", event => {
      event.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      openContextMenu(conv, rect.left, rect.bottom + 4, menuBtn);
    });

    assistantEls.drawerConversationList.appendChild(row);
  }
}

function updateDrawerActiveItem() {
  if (!assistantEls.drawerConversationList) return;
  assistantEls.drawerConversationList.querySelectorAll(".drawer-conversation-item").forEach(item => {
    item.classList.toggle("active", item.dataset.id === activeConversationId);
  });
}

async function loadDrawerConversations() {
  if (!assistantEls.drawerLoading) return;
  assistantEls.drawerLoading.hidden = false;
  assistantEls.drawerError.hidden = true;
  assistantEls.drawerEmpty.hidden = true;
  assistantEls.drawerNoResults.hidden = true;

  try {
    const list = await firebaseStore.listRecentConversations(drawerLimit);
    drawerConversations = list;
    assistantEls.drawerLoading.hidden = true;
    if (!list.length) {
      assistantEls.drawerEmpty.hidden = false;
      assistantEls.drawerConversationList.replaceChildren();
      if (assistantEls.drawerLoadMoreWrap) assistantEls.drawerLoadMoreWrap.hidden = true;
      return;
    }
    renderDrawerList(filterDrawerConversations());
    if (assistantEls.drawerLoadMoreWrap) {
      assistantEls.drawerLoadMoreWrap.hidden = list.length < drawerLimit;
    }
  } catch (error) {
    assistantEls.drawerLoading.hidden = true;
    assistantEls.drawerError.hidden = false;
    console.error("Drawer conversation load failed", error);
  }
}

function openDrawer() {
  if (isDrawerOpen) return;
  isDrawerOpen = true;
  drawerTriggerButton = document.activeElement;
  assistantEls.drawerBackdrop.hidden = false;
  assistantEls.drawer.hidden = false;
  requestAnimationFrame(() => {
    assistantEls.drawer.classList.add("open");
  });
  document.body.style.overflow = "hidden";
  loadDrawerConversations();
  assistantEls.drawerSearchInput?.focus();
}

function closeDrawer() {
  if (!isDrawerOpen) return;
  isDrawerOpen = false;
  assistantEls.drawer.classList.remove("open");
  document.body.style.overflow = "";
  setTimeout(() => {
    if (!isDrawerOpen) {
      assistantEls.drawer.hidden = true;
      assistantEls.drawerBackdrop.hidden = true;
    }
  }, 220);
  if (drawerTriggerButton && drawerTriggerButton.isConnected) {
    drawerTriggerButton.focus();
  } else {
    assistantEls.historyButton?.focus();
  }
}

async function startNewConversation() {
  if (newConversationInProgress) return;
  newConversationInProgress = true;
  if (assistantEls.newConversationHeaderButton) assistantEls.newConversationHeaderButton.disabled = true;
  if (assistantEls.drawerNewConversationButton) assistantEls.drawerNewConversationButton.disabled = true;

  try {
    activeRevealController?.abort();
    removeWaitingState();
    closeQuickQuestions();

    const isCurrentEmpty = conversation.length === 0;
    if (isCurrentEmpty && activeConversationId) {
      closeDrawer();
      renderConversation();
      assistantEls.input.value = composerDrafts.get(activeConversationId) || "";
      updateComposerHeight();
      updateSendButtonState();
      assistantEls.input.focus();
      return;
    }

    if (activeConversationId) {
      await saveGuidedFlow();
      composerDrafts.set(activeConversationId, assistantEls.input.value);
      await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
      await firebaseStore.updateConversationSummary(activeConversationId, { status: "archived" }).catch(() => {});
    }

    const newId = await firebaseStore.createConversation({ title: "New conversation", status: "active" });
    activeConversationId = newId;
    conversation = [];
    guidedFlow = null;
    currentProposal = null;
    pendingClarification = null;
    activePlanningContext = null;
    pendingOperation = null;
    referencedSets = [];
    entityRegistry = [];

    await firebaseStore.saveAssistantState({
      activeConversationId: newId,
      pendingClarification: null,
      planningContext: null,
      entityRegistry: [],
      pendingOperation: null,
      referencedSets: [],
      lastConfirmedAction: null,
      guidedFlow: null,
      guidedFlowsByConversation
    }).catch(showPersistenceFailure);

    renderConversation();

    assistantEls.input.value = "";
    updateComposerHeight();
    updateSendButtonState();

    closeDrawer();
    loadDrawerConversations().catch(() => {});
    assistantEls.input.focus();
  } catch (error) {
    if (assistantEls.saveNotice && assistantEls.saveText) {
      assistantEls.saveText.textContent = "A new conversation could not be started. Try again.";
      assistantEls.saveNotice.hidden = false;
    }
    console.error("New conversation creation failed", error);
  } finally {
    newConversationInProgress = false;
    if (assistantEls.newConversationHeaderButton) assistantEls.newConversationHeaderButton.disabled = false;
    if (assistantEls.drawerNewConversationButton) assistantEls.drawerNewConversationButton.disabled = false;
  }
}

async function openConversation(id) {
  if (!id) return;
  activeRevealController?.abort();
  removeWaitingState();
  closeQuickQuestions();

  try {
    if (activeConversationId) {
      await saveGuidedFlow();
      composerDrafts.set(activeConversationId, assistantEls.input.value);
      if (activeConversationId !== id) {
        await firebaseStore.updateConversationSummary(activeConversationId, conversationSummary("archived")).catch(() => {});
      }
    }

    activeConversationId = id;
    const loaded = await firebaseStore.loadConversation(id, 50);
    await firebaseStore.updateConversationSummary(id, { status: "active" }).catch(() => {});

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
    guidedFlowsByConversation = state.guidedFlowsByConversation && typeof state.guidedFlowsByConversation === "object" ? { ...state.guidedFlowsByConversation } : guidedFlowsByConversation;
    guidedFlow = guidedFlowsByConversation[id] || (isActive ? state.guidedFlow || null : null);
    pendingQuickQuestionId = guidedFlow?.queuedQuickQuestion || null;
    if (guidedFlow) guidedFlowsByConversation[id] = guidedFlow;
    pendingClarification = isActive ? state.pendingClarification : null;
    activePlanningContext = isActive ? state.planningContext : null;
    entityRegistry = isActive && Array.isArray(state.entityRegistry) ? state.entityRegistry.slice(-10) : [];
    pendingOperation = isActive ? state.pendingOperation || null : null;
    referencedSets = isActive && Array.isArray(state.referencedSets) ? state.referencedSets.slice(-5) : [];
    lastConfirmedAction = isActive ? state.lastConfirmedAction || null : null;

    await firebaseStore.saveAssistantState({
      activeConversationId: id,
      pendingClarification,
      planningContext: activePlanningContext,
      entityRegistry,
      pendingOperation,
      referencedSets,
      lastConfirmedAction,
      guidedFlow,
      guidedFlowsByConversation
    }).catch(showPersistenceFailure);

    assistantEls.input.value = composerDrafts.get(id) || "";
    updateComposerHeight();
    updateSendButtonState();

    closeDrawer();
    renderConversation({ restoring: true });
    scrollToBottom();
    updateDrawerActiveItem();
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

function isNearBottom(threshold = 80) {
  const el = assistantEls.conversation;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function scrollToBottom() {
  if (!assistantEls.conversation) return;
  assistantEls.conversation.scrollTop = assistantEls.conversation.scrollHeight;
  if (assistantEls.scrollLatest) assistantEls.scrollLatest.hidden = true;
}

function showWaitingState() {
  if (waitingEl) return;
  const msg = document.createElement("div");
  msg.className = "message assistant-message waiting-message";
  msg.id = "assistantWaiting";
  msg.setAttribute("role", "status");
  msg.setAttribute("aria-live", "polite");

  const sr = document.createElement("span");
  sr.className = "sr-only";
  sr.textContent = "Matson Time is preparing a response.";
  msg.appendChild(sr);

  const content = document.createElement("div");
  content.className = "waiting-content";
  content.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "waiting-text";
  text.textContent = "Just a moment";
  content.appendChild(text);

  const dots = document.createElement("span");
  dots.className = "waiting-dots";
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "dot";
    dots.appendChild(dot);
  }
  content.appendChild(dots);
  msg.appendChild(content);

  assistantEls.conversation.appendChild(msg);
  waitingEl = msg;
  if (isNearBottom()) {
    scrollToBottom();
  }
}

function removeWaitingState() {
  if (waitingEl) {
    waitingEl.remove();
    waitingEl = null;
  }
}

function revealAssistantMessage(targetElement, fullText, { onUpdate, signal } = {}) {
  return new Promise(resolve => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion || !fullText) {
      targetElement.textContent = fullText;
      if (onUpdate) onUpdate();
      resolve();
      return;
    }

    targetElement.textContent = "";
    const textNode = document.createTextNode("");
    targetElement.appendChild(textNode);

    const length = fullText.length;
    const totalDuration = Math.min(1200, Math.max(200, Math.round(length * 2.5)));
    const startTime = performance.now();

    function frame(now) {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / totalDuration);
      const currentLength = Math.max(1, Math.min(length, Math.floor(progress * length)));
      textNode.nodeValue = fullText.slice(0, currentLength);
      if (onUpdate) onUpdate();

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        textNode.nodeValue = fullText;
        if (onUpdate) onUpdate();
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

function appendEntry(entry, options = {}) {
  conversation.push(entry);
  if (!options.skipRender) {
    renderConversationEntry(entry, options);
  }
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

function renderConversationEntry(entry, options = {}) {
  const message = document.createElement("div");
  message.className = entry.role === "user" ? "message user-message" : "message assistant-message";

  if (entry.role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "user-bubble";
    bubble.textContent = entry.text;
    message.appendChild(bubble);
  } else {
    const text = document.createElement("p");
    text.className = "assistant-text";
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

    if (options.reveal && !options.restoring) {
      activeRevealController?.abort();
      const controller = new AbortController();
      activeRevealController = controller;
      const shouldKeepBottom = isNearBottom();
      assistantEls.conversation.appendChild(message);
      if (shouldKeepBottom) scrollToBottom();

      return revealAssistantMessage(text, entry.text, {
        signal: controller.signal,
        onUpdate: () => {
          if (shouldKeepBottom) scrollToBottom();
        }
      });
    } else {
      text.textContent = entry.text;
    }
  }

  assistantEls.conversation.appendChild(message);
  if (options.scrollToBottom !== false) {
    if (isNearBottom() || options.forceScroll) {
      scrollToBottom();
    }
  }
  return Promise.resolve();
}

function renderConversation(options = {}) {
  activeRevealController?.abort();
  removeWaitingState();
  assistantEls.conversation.replaceChildren();
  for (const entry of conversation) {
    const displayEntry = entry.resolved === false
      ? { ...entry, text: `${entry.text} (This earlier proposal expired when you left the conversation; request it again to review it.)` }
      : entry;
    renderConversationEntry(displayEntry, { restoring: true, scrollToBottom: false });
  }
  assistantEls.empty.hidden = conversation.length > 0;
  if (conversation.length > 0) {
    scrollToBottom();
  }
  renderGuidedControls();
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
      summary.textContent = `Previewing 10 of ${bulk.items.length}; inspect full list`;
      disclosure.appendChild(summary);
      const fullList = document.createElement("ul");
      for (const item of bulk.items) { const row = document.createElement("li"); row.textContent = formatBulkItem(item); fullList.appendChild(row); }
      disclosure.appendChild(fullList);
      const more = document.createElement("p"); more.textContent = `And ${bulk.items.length - 10} more items.`; disclosure.appendChild(more);
      details.appendChild(disclosure);
    }
    const visibleItems = bulk.items?.length > 10 ? bulk.items.slice(0, 10) : (bulk.items || []);
    for (const item of visibleItems) {
      const row = document.createElement("li");
      row.textContent = formatBulkItem(item);
      list.appendChild(row);
    }
    if (bulk.items?.length > 10) { const more = document.createElement("li"); more.textContent = `And ${bulk.items.length - 10} more items.`; list.appendChild(more); }
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
  confirmBtn.dataset.proposalId = proposal.id || "current";
  const planDeletes = proposal.plan?.actions?.some(action => action.type === "delete_item");
  confirmBtn.textContent = proposal.bulkAction?.type === "delete_items" || proposal.bulkAction?.type === "deduplicate_items" || proposal.action?.type === "delete_item" ? "Delete permanently" : proposal.bulkAction?.type === "cancel_items" ? "Cancel items" : planDeletes ? "Confirm plan with permanent deletion" : proposal.plan ? "Confirm plan" : "Confirm";
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
  const labels = { today: "All items planned for today", tomorrow: "All items planned for tomorrow", current_week: "All items planned for this week", next_week: "All items planned for next week", current_month: "All items planned for this month", future: "Upcoming items", overdue: "Overdue items", completed: "Completed items", missed: "Missed items", cancelled: "Cancelled items", routines: "Routines", tasks: "Tasks", activities: "Activities", all_active: "All active upcoming items", absolutely_all: "All schedule items, including completed and cancelled items", specific_date: `Items planned for ${formatDateLabel(scope.startDate)}`, date_range: `Items planned from ${formatDateLabel(scope.startDate)} to ${formatDateLabel(scope.endDate)}`, category: scope.categories?.join(", ") || "Selected category", title_match: scope.titleQuery || "Matching items", referenced_items: "Referenced items", selected_item: "Selected items", current_item: "Current item" };
  return labels[scope.scopeType] || "Selected schedule scope";
}

function formatBulkItem(item) {
  const status = ({ upcoming: "Upcoming", "in-progress": "In progress", postponed: "Postponed", overdue: "Overdue", completed: "Completed", missed: "Missed", cancelled: "Cancelled", "awaiting-check-in": "Awaiting check-in" })[item.status] || "Scheduled";
  const time = item.start ? `${formatTime(item.start)}${item.end ? `–${formatTime(item.end)}` : ""}` : "Anytime";
  return `${item.title} · ${formatDateLabel(item.date)} · ${time} · ${status}`;
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
  if (proposal.bulkAction) {
    const bulk = proposal.bulkAction;
    if (bulk.type === "delete_items" || bulk.type === "deduplicate_items") return bulk.scope.scopeType === "absolutely_all" ? "Delete all schedule items?" : `Delete ${bulk.affectedCount} schedule item${bulk.affectedCount === 1 ? "" : "s"}?`;
    if (bulk.type === "cancel_items") return `Cancel ${bulk.affectedCount} schedule item${bulk.affectedCount === 1 ? "" : "s"}?`;
    return "Review schedule changes";
  }
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

function sortForDate(dateItems) {
  return sortTodayItems(dateItems || []);
}

function answerHaveToday() {
  const todayItemsList = saGetTodayItems();
  const sorted = sortForDate(todayItemsList);
  if (!sorted.length) return { text: "You have nothing planned for today." };
  const items = sorted.map(item => ({
    time: itemTime(item),
    title: item.title,
    status: item.status.replace("-", " ")
  }));
  return { text: `You have ${sorted.length} item${sorted.length === 1 ? "" : "s"} planned today.`, items };
}

function answerWhatNow() {
  const attentionOrder = { "in-progress": 0, overdue: 1, "awaiting-check-in": 2, upcoming: 3, postponed: 4 };
  const todayItemsList = saGetTodayItems().filter(item => !item.schedulePending);
  const active = todayItemsList.filter(item => ![ "completed", "cancelled", "missed" ].includes(item.status));
  active.sort((a, b) => attentionOrder[a.status] - attentionOrder[b.status] || (a.start || "").localeCompare(b.start || ""));
  const item = active[0];
  if (!item) return { text: "Nothing needs your attention right now." };
  const reason = item.status === "in-progress"
    ? "It is currently scheduled."
    : item.status === "overdue"
      ? "It is overdue and needs attention."
      : item.status === "awaiting-check-in"
        ? "It is awaiting check-in."
        : item.postponed
          ? `It has been postponed ${item.postponed} time${item.postponed === 1 ? "" : "s"}.`
          : "It is the next item needing attention.";
  return {
    text: `${item.title} — ${itemTime(item)}. ${reason}`,
    items: [{ time: itemTime(item), title: item.title, status: item.status.replace("-", " ") }]
  };
}

function answerComingNext() {
  const now = new Date();
  const today = localDateString(new Date());
  const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const eligible = saGetTodayItems().filter(item => !item.schedulePending && ![ "completed", "cancelled", "missed" ].includes(item.status));
  const timed = eligible.filter(item => Boolean(item.start) && item.start > nowTime).sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  const untimed = eligible.filter(item => !item.start);
  const next = timed[0] || untimed[0];
  if (next) {
    const time = next.start ? formatTime(next.start) : "Anytime today";
    return {
      text: `Next up: ${next.title} today at ${time}.`,
      items: [{ time: `Today at ${time}`, title: next.title, status: next.status.replace("-", " ") }]
    };
  }
  const later = saGetUpcomingItems().filter(item => item.date > today).sort((a, b) => (a.date + "|" + (a.start || "")).localeCompare(b.date + "|" + (b.start || "")))[0];
  if (later) {
    const time = later.start ? formatTime(later.start) : "Anytime";
    return {
      text: `Next up: ${later.title} on ${formatDateLabel(later.date)}${later.start ? ` at ${time}` : ""}.`,
      items: [{ time: `${formatDateLabel(later.date)}${later.start ? ` at ${time}` : ""}`, title: later.title, status: later.status.replace("-", " ") }]
    };
  }
  return { text: "Nothing else is coming up." };
}

function answerRemaining() {
  const todayItemsList = saGetTodayItems();
  const remaining = sortForDate(todayItemsList.filter(item => ![ "completed", "cancelled", "missed" ].includes(item.status)));
  if (!remaining.length) return { text: "You have nothing remaining today." };
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
  if (!missed.length) return { text: "You have not missed anything this week." };
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
    for (const conflict of saDetectConflictsForDate(dateStr)) conflicts.push({ date: dateStr, items: [conflict.firstTitle, conflict.secondTitle], overlapStart: conflict.overlapStart, overlapEnd: conflict.overlapEnd });
  }
  if (!conflicts.length) return { text: "No schedule conflicts detected this week." };
  const messages = conflicts.map(c => `${formatDateLabel(c.date)}: ${c.items[0]} overlaps with ${c.items[1]} from ${formatTime(c.overlapStart)} to ${formatTime(c.overlapEnd)}`);
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

  if (/what.*have.*today|what.*doing.*today/i.test(text)) return answerHaveToday();
  if (/what should i do now/i.test(text)) return answerWhatNow();
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
      const conflict = saDetectConflictsForDate(targetItem.date)[0] || null;
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
          conflict: conflict ? { items: [conflict.firstTitle, conflict.secondTitle], overlapStart: conflict.overlapStart, overlapEnd: conflict.overlapEnd } : null,
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

const ASSISTANT_ACTION_REQUIREMENTS = {
  create_item: { activity: ["item.type", "item.title", "item.date", "item.start", "item.end"], task: ["item.type", "item.title", "item.date"], routine: ["item.type", "item.title", "recurrence", "item.date"] },
  update_item: ["targetId", "changes"], reschedule_item: ["targetId", "dateOrStartOrEnd"], postpone_item: ["targetId", "postponeMinutes"],
  complete_item: ["targetId"], mark_missed: ["targetId"], cancel_item: ["targetId"], restore_item: ["cancelledTargetId"], delete_item: ["targetId", "trustedConfirmation"],
  bulk: ["operation", "scope", "targetIds", "affectedCount", "trustedConfirmation"], plan_proposal: ["twoValidActions"]
};

function evaluateActionCompleteness(action) {
  const missingFields = [], invalidFields = [];
  const missing = field => { if (!missingFields.includes(field)) missingFields.push(field); };
  if (!action || typeof action !== "object") return { complete: false, missingFields: ["action"], invalidFields };
  if (action.type === "create_item") {
    const item = action.item || {};
    for (const field of ASSISTANT_ACTION_REQUIREMENTS.create_item[item.type] || ["item.type", "item.title", "item.date"]) {
      if (field === "item.type" && !["activity", "task", "routine"].includes(item.type)) missing(field);
      if (field === "item.title" && !String(item.title || "").trim()) missing(field);
      if (field === "item.date" && !/^\d{4}-\d{2}-\d{2}$/.test(item.date || "")) missing(field);
      if (field === "item.start" && !item.start) missing(field);
      if (field === "item.end" && !item.end) missing(field);
      if (field === "recurrence" && !item.recurrence) missing(field);
    }
  } else if (["update_item", "reschedule_item"].includes(action.type)) {
    if (!action.targetId) missing("targetId");
    if (action.type === "update_item" && !Object.values(action.changes || {}).some(value => value !== null && value !== undefined && value !== "")) missing("changes");
    if (action.type === "reschedule_item" && !["date", "start", "end"].some(key => action.changes?.[key] !== null && action.changes?.[key] !== undefined)) missing("date or time");
  } else if (Object.hasOwn(ASSISTANT_ACTION_REQUIREMENTS, action.type)) {
    if (!action.targetId) missing("targetId");
    if (action.type === "postpone_item" && (!Number.isInteger(action.postponeMinutes) || action.postponeMinutes <= 0)) missing("postponeMinutes");
  }
  return { complete: !missingFields.length && !invalidFields.length, missingFields, invalidFields };
}

function validateGeminiResponse(response) {
  if (!response || typeof response !== "object") return "Invalid response format";
  if (!["answer", "clarification", "proposed_action", "plan_proposal", "bulk_proposal", "no_action", "error"].includes(response.kind)) {
    return "Unsupported response kind";
  }
  if (!Object.prototype.hasOwnProperty.call(response, "planningContext")) return "Missing planning context";
  if (response.planningContext !== null && (!response.planningContext || typeof response.planningContext !== "object" || !Array.isArray(response.planningContext.proposedItems) || !Array.isArray(response.planningContext.constraints) || typeof response.planningContext.goal !== "string")) return "Invalid planning context";
  if (response.kind === "clarification") {
    const pending = response.pendingClarification;
    if (response.requiresConfirmation || response.action !== null || response.plan !== null || response.bulkAction !== null || !pending || !Array.isArray(pending.missingFields) || pending.missingFields.length === 0) return "invalid_clarification:missing_fields";
    const labels = { "item.type": /type/i, "item.title": /title|what (?:is|should .* be called)/i, "item.date": /date|which day/i, date: /date|which day/i, "item.start": /start|begin|from what time/i, start: /start|begin|from what time/i, "item.end": /end|finish|until|to what time/i, end: /end|finish|until|to what time/i, recurrence: /recurr|which days|how often/i, targetId: /which item|what item|which .* (?:move|change|cancel|delete|complete)/i, scope: /scope|which (?:items|date|week)/i, operation: /cancel or delete|which (?:action|method)/i, changes: /what .* change|which change/i, postponeMinutes: /how many minutes|how long/i };
    const allowedMissing = new Set(["item.type", "item.title", "item.date", "item.start", "item.end", "type", "title", "date", "start", "end", "recurrence", "targetId", "changes", "postponeMinutes", "scope", "operation", "keepId"]);
    for (const field of pending.missingFields) {
      if (!allowedMissing.has(field)) return "invalid_clarification:unsupported_field";
      const key = ({ "item.type": "type", "item.title": "title", "item.date": "date", "item.start": "start", "item.end": "end" })[field] || field;
      if (pending.knownFields?.[key] !== undefined && pending.knownFields?.[key] !== null && pending.knownFields?.[key] !== "") return "invalid_clarification:field_already_known";
      if (labels[field] && !labels[field].test(response.message || "")) return "invalid_clarification:unnamed_missing_field";
    }
    const currentMessage = [...conversation].reverse().find(entry => entry.role === "user")?.text || "";
    const normalized = currentMessage.toLowerCase();
    const times = [...normalized.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/gi)];
    const supplied = new Set();
    if (/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i.test(normalized)) supplied.add("date");
    if (times.length) supplied.add("start");
    if (times.length > 1 || /\bfrom\s+\d{1,2}\s+to\s+\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(normalized)) supplied.add("end");
    if (/\b(for|to)\s+(?:a|an|the)\s+[a-z][\w -]{1,50}/i.test(normalized) || /\b(remind me to|meeting with|gym|studio session|rehearsal|practice|call)\b/i.test(normalized)) supplied.add("title");
    if (pending.missingFields.some(field => supplied.has(({ "item.date": "date", "item.start": "start", "item.end": "end", "item.title": "title" })[field] || field))) return "complete_request_misclassified";
  }
  const validateAction = action => {
    if (!action || !saGetAllowedActions().includes(action.type)) return "Unsupported action type";
    if (action.type === "create_item" && (!action.item || action.targetId || action.changes)) return "create_item requires item and forbids targetId and changes";
    if (action.type !== "create_item" && !action.targetId) return `${action.type} requires targetId`;
    if (action.type !== "create_item" && !saFindItemById(action.targetId)) return "Target item not found";
    if (action.type === "restore_item" && saFindItemById(action.targetId)?.status !== "cancelled") return "restore_item requires a cancelled item";
    const completeness = evaluateActionCompleteness(action);
    if (!completeness.complete) return `missing_required_field:${completeness.missingFields.join(",")}`;
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
    const validScopes = ["current_item", "selected_item", "referenced_items", "today", "tomorrow", "specific_date", "date_range", "current_week", "next_week", "current_month", "future", "overdue", "completed", "missed", "cancelled", "routines", "tasks", "activities", "category", "title_match", "all_active", "absolutely_all"];
    if (!response.requiresConfirmation || response.action !== null || response.plan !== null || !bulk || !Array.isArray(bulk.targetIds) || !bulk.targetIds.length || bulk.targetIds.length > 450 || new Set(bulk.targetIds).size !== bulk.targetIds.length || bulk.affectedCount !== bulk.targetIds.length) return "Invalid bulk proposal";
    if (!bulk.scope || !validScopes.includes(bulk.scope.scopeType) || !["cancel_items", "delete_items", "complete_items", "reschedule_items", "update_items", "deduplicate_items"].includes(bulk.type)) return "Bulk operation and scope are required";
    if (bulk.scope.scopeType === "absolutely_all" && (bulk.scope.includeCompleted !== true || bulk.scope.includeCancelled !== true)) return "All schedule items scope must include completed and cancelled items";
    if (bulk.scope.scopeType === "specific_date" && !/^\d{4}-\d{2}-\d{2}$/.test(bulk.scope.startDate || "")) return "A specific date scope requires a valid date";
    if (bulk.scope.scopeType === "date_range" && (!/^\d{4}-\d{2}-\d{2}$/.test(bulk.scope.startDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(bulk.scope.endDate || "") || bulk.scope.startDate > bulk.scope.endDate)) return "A date range scope requires valid start and end dates";
    if (bulk.scope.scopeType === "category" && !bulk.scope.categories?.length) return "A category scope requires a category";
    if (bulk.scope.scopeType === "title_match" && !bulk.scope.titleQuery) return "A title scope requires a title match";
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
    conflicts: [...new Set(scheduled.map(item => item.date))].flatMap(date => saDetectConflictsForDate(date, relevantItems).map(conflict => ({ date: conflict.date, itemIds: [conflict.firstItemId, conflict.secondItemId], overlapStart: conflict.overlapStart, overlapEnd: conflict.overlapEnd }))),
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
    if (response?.kind === "clarification") {
      pendingClarification = null;
      savePlanningContext();
      if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") console.warn("Assistant clarification rejected", { reason: validationError });
      return { message: "I could not identify what information is missing. Please try the request again.", items: [] };
    }
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
  return "I couldn't safely validate that schedule response. Please try the request again.";
}

function buildBulkProposalFromGeminiResponse(response) {
  const requested = response.bulkAction;
  const explicitIds = new Set(requested.targetIds);
  const selected = ["referenced_items", "selected_item", "current_item"].includes(requested.scope.scopeType)
    ? items.filter(item => explicitIds.has(item.id) && saItemMatchesScope(item, requested.scope))
    : items.filter(item => saItemMatchesScope(item, requested.scope));
  if (!selected.length) return null;
  return createTrustedBulkProposal(requested.type, requested.scope, selected, bulkProposalMessage(requested.type, requested.scope, selected.length));
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
      const candidateWithId = { ...candidate, id: candidate.id || crypto.randomUUID(), date: proposedDate, status: candidate.status || "upcoming", schedulePending: false };
      const peers = saGetItemsForDate(proposedDate).filter(item => item.id !== target?.id);
      conflict = saDetectConflictsForDate(proposedDate, [...peers, candidateWithId]).find(record => record.firstItemId === candidateWithId.id || record.secondItemId === candidateWithId.id) || null;
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
    conflict: conflict ? { items: [conflict.firstTitle, conflict.secondTitle], overlapStart: conflict.overlapStart, overlapEnd: conflict.overlapEnd } : null,
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
  if (!selected.length) { pendingOperation = null; pendingClarification = null; savePlanningContext(); appendEntry({ role: "assistant", text: "I couldn't find items in that scope." }); return; }
  if (selected.length > 450) { pendingOperation = null; pendingClarification = null; savePlanningContext(); appendEntry({ role: "assistant", text: "That scope is too large for one safe batch. Narrow the date range or item type first." }); return; }
  currentProposal = createTrustedBulkProposal(type, scope, selected, message);
  appendEntry({ role: "assistant", text: message, kind: "proposal_summary", proposalSummary: message, resolved: false, referencedItemIds: selected.map(item => item.id) });
  renderProposal(currentProposal);
}

function createTrustedBulkProposal(type, scope, selected, message) {
  const proposalId = crypto.randomUUID();
  const targetIds = Object.freeze(selected.map(item => item.id));
  const frozenScope = Object.freeze({ ...scope, statuses: Object.freeze([...(scope.statuses || [])]), itemTypes: Object.freeze([...(scope.itemTypes || [])]), categories: Object.freeze([...(scope.categories || [])]) });
  const bulkAction = Object.freeze({ type, scope: frozenScope, targetIds, affectedCount: targetIds.length, items: Object.freeze(selected.map(item => Object.freeze({ ...item }))) });
  currentProposal = { id: proposalId, bulkAction, confirmationSnapshot: Object.freeze({ proposalId, targetIds: Object.freeze([...targetIds]), scope: frozenScope }), lifecycle: "awaiting_confirmation", message, source: "application" };
  pendingOperation = { intent: type === "delete_items" || type === "deduplicate_items" ? "destructive_method" : "bulk_operation", state: "awaiting_confirmation", proposalId, targetIds: [...targetIds], scope: { ...scope }, operation: type };
  savePlanningContext();
  return currentProposal;
}

function askOperationClarification(question, operation) {
  pendingOperation = { ...operation, state: operation.state || (operation.intent === "clear_scope" || operation.intent === "bulk_scope" ? "collecting_scope" : "collecting_method") };
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
  appendEntry({ role: "assistant", text: currentProposal.message, kind: "proposal_summary", proposalSummary: currentProposal.message, resolved: false, referencedItemIds: [remove.id, keep.id] });
  renderProposal(currentProposal);
}

function routePendingOperation(text) {
  if (!pendingOperation && pendingClarification && ["bulk_scope", "clear_scope", "destructive_method", "clear_method"].includes(pendingClarification.intent)) {
    const intent = pendingClarification.intent === "clear_scope" ? "bulk_scope" : pendingClarification.intent === "clear_method" ? "destructive_method" : pendingClarification.intent;
    pendingOperation = { intent, state: intent === "bulk_scope" ? "collecting_scope" : "collecting_method", knownFields: pendingClarification.knownFields || {}, scope: pendingClarification.knownFields?.scope || null, operation: pendingClarification.knownFields?.operation || null };
  }
  if (!pendingOperation) return false;
  const lower = text.toLowerCase();
  if (pendingOperation.state === "expired") { pendingOperation = null; pendingClarification = null; savePlanningContext(); return false; }
  if (pendingOperation.state === "awaiting_confirmation" || pendingOperation.state === "executing" || (pendingOperation.state === "failed" && currentProposal)) {
    appendEntry({ role: "assistant", text: pendingOperation.state === "executing" ? "That schedule change is still being saved. Please wait for the result." : "Please use the proposal buttons to retry, edit the scope, or cancel. A message by itself will not apply the change." });
    return true;
  }
  if (["bulk_scope", "clear_scope"].includes(pendingOperation.intent) && pendingOperation.state !== "awaiting_confirmation") {
    let scopeType = null;
    if (/\b(only upcoming|upcoming only|active items?|planned items?|future plans?|still planned|only what(?:'s| is) still planned)\b/.test(lower)) scopeType = "all_active";
    else if (/\b(everything|whole thing|whole schedule|every scheduled item|all scheduled items|all schedule items|absolutely everything|all history)\b/.test(lower) || /\b(include|including)\b.*\b(completed|cancelled|canceled)\b/.test(lower) || /\b(every|all)\b.*\b(completed|cancelled|canceled)\b/.test(lower)) scopeType = "absolutely_all";
    if (!scopeType) {
      const inferred = inferBulkScope(text);
      if (inferred && !["absolutely_all", "all_active"].includes(inferred.scopeType)) scopeType = inferred.scopeType;
    }
    if (!scopeType) { appendEntry({ role: "assistant", text: "Should I clear only active upcoming items, or every schedule item including completed and cancelled history?" }); return true; }
    const scope = makeScope(scopeType);
    const operation = pendingOperation.operation || pendingOperation.knownFields?.operation || null;
    if (operation) {
      const selected = items.filter(item => saItemMatchesScope(item, scope));
      pendingOperation = null; pendingClarification = null;
      presentBulkProposal(operation, scope, selected, bulkProposalMessage(operation, scope, selected.length));
      return true;
    }
    pendingOperation = { intent: "destructive_method", state: "collecting_method", scope, knownFields: { scopeType } };
    pendingClarification = { intent: "destructive_method", knownFields: { scopeType }, missingFields: ["operation"] };
    savePlanningContext();
    appendEntry({ role: "assistant", text: "Should I cancel those items and keep their history, or delete them permanently?" });
    return true;
  }
  if (["destructive_method", "clear_method"].includes(pendingOperation.intent) && pendingOperation.state !== "awaiting_confirmation") {
    const explicitDelete = /\b(delete|erase|permanently|forever|remove forever|remove permanently|get rid of completely)\b/.test(lower);
    const explicitCancel = /\b(cancel|keep (?:the|their) history|preserve history|remove from active plans|call them off)\b/.test(lower);
    if (!explicitDelete && !explicitCancel) { appendEntry({ role: "assistant", text: "Should I cancel those items and keep their history, or delete them permanently?" }); return true; }
    const scope = pendingOperation.scope;
    const selected = items.filter(item => saItemMatchesScope(item, scope));
    const operation = explicitDelete ? "delete_items" : "cancel_items";
    pendingOperation = { ...pendingOperation, operation, state: "ready_for_proposal" };
    pendingClarification = null;
    presentBulkProposal(operation, scope, selected, bulkProposalMessage(operation, scope, selected.length));
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
    pendingOperation = { intent: "bulk_scope", state: "collecting_scope", operation: op };
    pendingClarification = { intent: "bulk_scope", knownFields: { operation: op }, missingFields: ["scope"] }; savePlanningContext();
    appendEntry({ role: "assistant", text: "Do you mean all active upcoming items, or every schedule item including completed and cancelled history?" }); return true;
  }
  if (!op) { askOperationClarification("Should I cancel those items and preserve their history, or delete them permanently?", { intent: "destructive_method", state: "collecting_method", scope }); return true; }
  const selected = items.filter(item => saItemMatchesScope(item, scope));
  presentBulkProposal(op, scope, selected, bulkProposalMessage(op, scope, selected.length));
  return true;
}

function bulkProposalMessage(operation, scope, count) {
  const quantity = `${count} schedule item${count === 1 ? "" : "s"}`;
  if (operation === "delete_items" || operation === "deduplicate_items") {
    const allHistory = scope.scopeType === "absolutely_all";
    return `This will permanently delete ${allHistory ? "all " : ""}${quantity}${allHistory ? ", including completed and cancelled items" : ""}. Conversation history will remain available.`;
  }
  if (operation === "cancel_items") return `Cancel ${count} schedule item${count === 1 ? "" : "s"}? Their history will be preserved.`;
  if (operation === "complete_items") return `Mark ${count} schedule item${count === 1 ? "" : "s"} completed?`;
  return `Review this change to ${count} schedule item${count === 1 ? "" : "s"}.`;
}

async function sendMessage(rawText) {
  const text = rawText.trim();
  if (!text || sendInProgress) return;
  sendInProgress = true;
  updateSendButtonState();

  let requestConvId = activeConversationId;
  try {
    requestConvId = await ensureConversation();
  } catch (err) {
    console.error("Failed to ensure conversation", err);
    sendInProgress = false;
    updateSendButtonState();
    showPersistenceFailure();
    return;
  }

  if (assistantEls.input) {
    assistantEls.input.value = "";
  }
  if (requestConvId) {
    composerDrafts.delete(requestConvId);
  }
  updateComposerHeight();
  updateSendButtonState();

  const requestId = crypto.randomUUID();
  activeRequestId = requestId;

  try {
    const userMessages = conversation.filter(m => m.role === "user");
    if (userMessages.length === 0 && requestConvId) {
      const derivedTitle = deriveConversationTitle(text);
      firebaseStore.updateConversationSummary(requestConvId, { title: derivedTitle }).catch(() => {});
    }

    appendEntry({ role: "user", text });

    if (guidedFlow) {
      await handleGuidedAnswer(text);
      return;
    }

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

    if (routePendingOperation(text)) {
      saveConversation();
      return;
    }
    if (routeBulkCommand(text)) {
      saveConversation();
      return;
    }

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
        appendEntry({ role: "assistant", text: directResult.proposal.message, kind: "proposal_summary", proposalSummary: directResult.proposal.message, resolved: false });
        renderProposal(currentProposal);
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
      if (activeConversationId === requestConvId) {
        showWaitingState();
      }
      let geminiResponse;
      try {
        geminiResponse = await callGeminiEndpoint(text, classification === "analytical_planning", recallContext);
      } catch {
        if (activeConversationId === requestConvId) {
          removeWaitingState();
          appendEntry({ role: "assistant", text: "The schedule assistant is temporarily busy. Please try again." });
        }
        return;
      }

      if (activeConversationId === requestConvId) {
        removeWaitingState();
      }

      result = processGeminiResponse(geminiResponse);

      if (result.proposal) {
        currentProposal = result.proposal;
        const explanation = result.message || "Here's a proposed action.";
        const entry = { role: "assistant", text: explanation, kind: "proposal_summary", proposalSummary: explanation, resolved: false };
        if (activeConversationId === requestConvId) {
          appendEntry(entry, { skipRender: true });
          await renderConversationEntry(entry, { reveal: true });
          if (activeConversationId === requestConvId) {
            renderProposal(currentProposal);
          }
        } else {
          saveEntryForConversation(requestConvId, entry);
        }
        saveConversation();
        return;
      }

      if (result.clarification) {
        const entry = { role: "assistant", text: result.message };
        if (activeConversationId === requestConvId) {
          appendEntry(entry, { skipRender: true });
          await renderConversationEntry(entry, { reveal: true });
        } else {
          saveEntryForConversation(requestConvId, entry);
        }
        saveConversation();
        return;
      }

      const entry = { role: "assistant", text: result.message, items: result.items || [] };
      if (activeConversationId === requestConvId) {
        appendEntry(entry, { skipRender: true });
        await renderConversationEntry(entry, { reveal: true });
      } else {
        saveEntryForConversation(requestConvId, entry);
      }
      updateSummaryIfPlanningResolved();
      saveConversation();
      return;
    }

    appendEntry({ role: "assistant", text: "I can't help with that yet." });
    saveConversation();
  } catch (err) {
    console.error("Assistant message handling error", err);
    if (activeConversationId === requestConvId) {
      removeWaitingState();
      appendEntry({ role: "assistant", text: "An error occurred while processing your request. Please try again." });
    }
  } finally {
    sendInProgress = false;
    updateSendButtonState();
  }
}

function handleProposalOrClarification(result, message) {
}

async function confirmProposal() {
  if (!currentProposal) return;
  if (currentProposal.bulkAction && currentProposal.lifecycle === "failed" && pendingOperation?.state === "failed" && pendingOperation.proposalId === currentProposal.id) {
    currentProposal.lifecycle = "awaiting_confirmation";
    pendingOperation.state = "awaiting_confirmation";
  }
  if (currentProposal.bulkAction && currentProposal.lifecycle !== "awaiting_confirmation") return;
  if (currentProposal.confirming) return;
  currentProposal.confirming = true;
  assistantEls.conversation.querySelectorAll(`.proposal[data-proposal-id="${currentProposal.id}"] button`).forEach(button => { button.disabled = true; });
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
      const nextItem = { ...target, ...changes, schedulePending: false };
      if (!nextItem.date || !nextItem.start || !nextItem.end || nextItem.start >= nextItem.end) {
        showProcessingError("Missing new schedule details.");
        return;
      }
      const conflictCheck = saDetectConflictsForDate(nextItem.date, [...items.filter(item => item.id !== action.targetId), nextItem])
        .find(conflict => conflict.firstItemId === nextItem.id || conflict.secondItemId === nextItem.id);
      if (conflictCheck) renderProposalMessage(`Warning: ${conflictCheck.firstTitle} and ${conflictCheck.secondTitle} overlap on ${formatDateLabel(nextItem.date)} from ${formatTime(conflictCheck.overlapStart)} to ${formatTime(conflictCheck.overlapEnd)}.`);
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
  const snapshot = proposal.confirmationSnapshot;
  const action = proposal.bulkAction;
  if (proposal.lifecycle !== "awaiting_confirmation" || pendingOperation?.state !== "awaiting_confirmation" || pendingOperation.proposalId !== proposal.id || snapshot?.proposalId !== proposal.id || action.affectedCount !== snapshot.targetIds.length || action.targetIds.length !== snapshot.targetIds.length || action.targetIds.some((id, index) => id !== snapshot.targetIds[index]) || JSON.stringify(action.scope) !== JSON.stringify(snapshot.scope)) {
    currentProposal = null; pendingOperation = { intent: "bulk_operation", state: "expired" }; appendEntry({ role: "assistant", text: "This proposal has expired. Please request a fresh review." }); savePlanningContext(); renderConversation(); return;
  }
  proposal.lifecycle = "executing";
  pendingOperation.state = "executing";
  savePlanningContext();
  const result = await saApplyBulkAtomically({ ...action, targetIds: [...snapshot.targetIds], scope: { ...snapshot.scope } });
  if (!result.success) { proposal.lifecycle = "failed"; pendingOperation.state = "failed"; pendingOperation.failedAt = new Date().toISOString(); showProcessingError(result.error); savePlanningContext(); return; }
  if (["delete_items", "deduplicate_items"].includes(proposal.bulkAction.type)) {
    (result.items || []).forEach(item => rememberScheduleEntity(item, "deleted", ["that", "those", item.title]));
    await firebaseStore.markConversationItemsDeleted(activeConversationId, result.items.map(item => item.id)).catch(showPersistenceFailure);
    const deletedSet = new Set(result.items.map(item => item.id));
    referencedSets = referencedSets.map(set => ({ ...set, ids: (set.ids || set.targetIds || []).filter(id => !deletedSet.has(id)), targetIds: (set.targetIds || set.ids || []).filter(id => !deletedSet.has(id)) })).filter(set => (set.ids || set.targetIds || []).length);
  } else {
    const lastAction = ({ cancel_items: "cancelled", complete_items: "completed", update_items: "updated", reschedule_items: "rescheduled" })[proposal.bulkAction.type] || "updated";
    (result.changedItems || []).forEach(item => rememberScheduleEntity(item, lastAction, ["that", "those", item.title]));
  }
  const targetIds = proposal.bulkAction.targetIds.slice();
  proposal.lifecycle = "completed";
  lastConfirmedAction = { type: proposal.bulkAction.type, targetIds, affectedCount: targetIds.length, state: "completed", confirmedAt: new Date().toISOString() };
  pendingOperation = null;
  currentProposal = null;
  await firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction });
  await persistenceQueue;
  await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
  conversation.forEach(entry => { if (entry.kind === "proposal_summary") entry.resolved = true; });
  const deleted = ["delete_items", "deduplicate_items"].includes(proposal.bulkAction.type);
  const cancelled = proposal.bulkAction.type === "cancel_items";
  appendEntry({ role: "assistant", text: deleted ? `Permanently deleted ${targetIds.length} schedule item${targetIds.length === 1 ? "" : "s"}. Conversation history was preserved.` : cancelled ? `Cancelled ${targetIds.length} schedule item${targetIds.length === 1 ? "" : "s"}. Their history was preserved.` : `Updated ${targetIds.length} schedule item${targetIds.length === 1 ? "" : "s"}.`, referencedItemIds: targetIds });
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

async function editProposal() {
  if (!currentProposal) return;
  if (currentProposal.bulkAction) {
    const operation = currentProposal.bulkAction.type;
    currentProposal.lifecycle = "cancelled";
    currentProposal = null;
    pendingOperation = { intent: "bulk_scope", state: "collecting_scope", operation };
    pendingClarification = { intent: "bulk_scope", knownFields: { operation }, missingFields: ["scope"] };
    savePlanningContext();
    await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
    conversation.forEach(entry => { if (entry.kind === "proposal_summary") entry.resolved = true; });
    appendEntry({ role: "assistant", text: "What scope should I apply instead? You can specify a date, week, item type, or all active versus all schedule items." });
    renderConversation();
    return;
  }

  openAddDialogForEdit(currentProposal);
}

async function cancelProposal() {
  if (!currentProposal) return;

  const wasPlan = Boolean(currentProposal.plan);
  const wasBulk = Boolean(currentProposal.bulkAction);
  currentProposal.lifecycle = "cancelled";
  currentProposal = null;
  pendingClarification = null;
  pendingOperation = null;
  if (wasPlan) activePlanningContext = null;
  savePlanningContext();
  await persistenceQueue;
  await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
  conversation.forEach(entry => { if (entry.kind === "proposal_summary") entry.resolved = true; });
  if (wasPlan) appendEntry({ role: "assistant", text: "Plan cancelled. No schedule changes were made." });
  if (wasBulk) appendEntry({ role: "assistant", text: "Cancelled the proposal. No schedule items were changed." });
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

function updateComposerHeight() {
  if (!assistantEls.input) return;
  assistantEls.input.style.height = "auto";
  const newHeight = Math.min(assistantEls.input.scrollHeight, 130);
  assistantEls.input.style.height = newHeight + "px";
  updateConversationPadding();
}

// ── Context menu ──────────────────────────────────────────────────────────────

function openContextMenu(conv, x, y, triggerEl) {
  if (!assistantEls.contextMenu || !conv) return;
  contextMenuConv = conv;
  contextMenuTriggerEl = triggerEl || null;

  const menu = assistantEls.contextMenu;
  menu.hidden = false;

  // Position the menu; keep it within the viewport
  const menuWidth = 180;
  const menuHeight = 88;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(x, vw - menuWidth - 8);
  const top  = Math.min(y, vh - menuHeight - 8);
  menu.style.left = Math.max(8, left) + "px";
  menu.style.top  = Math.max(8, top) + "px";
}

function closeContextMenu() {
  if (!assistantEls.contextMenu) return;
  assistantEls.contextMenu.hidden = true;
  const restore = contextMenuTriggerEl;
  contextMenuConv = null;
  contextMenuTriggerEl = null;
  // Return focus to the trigger button so keyboard users don't lose position
  restore?.focus();
}

// ── Rename dialog ─────────────────────────────────────────────────────────────

function openRenameDialog(conv) {
  if (!assistantEls.renameDialog || !conv) return;
  renamingConversationId = conv.id;
  if (assistantEls.renameInput) {
    assistantEls.renameInput.value = conv.title || "New conversation";
  }
  if (assistantEls.renameError) assistantEls.renameError.hidden = true;
  assistantEls.renameDialog.showModal();
  assistantEls.renameInput?.select();
}

function closeRenameDialog() {
  renamingConversationId = null;
  assistantEls.renameDialog?.close();
}

function updateSendButtonState() {
  if (!assistantEls.send || !assistantEls.input) return;
  const text = (assistantEls.input.value || "").trim();
  const canSend = text.length > 0 && !isComposing && !sendInProgress;
  assistantEls.send.disabled = !canSend;
}

// ── Quick questions accordion ───────────────────────────────────────────
// Compact, logic-only suggested prompts inside the composer. The visible
// wording is trusted static text; the handler is resolved through the stable
// data-quick-question identifier, never by parsing the button label.
let quickQuestionsOpen = false;

// Reserves conversation scroll space for the composer region so the last
// message never hides beneath it. The
// quick-questions panel overlays the conversation temporarily and does not
// add to this reserved space.
function updateConversationPadding() {
  if (!assistantEls.conversation) return;
  const region = assistantEls.quickQuestionsControl?.closest(".assistant-composer-region");
  if (!region) return;
  const composer = region.querySelector(".assistant-composer");
  if (!composer) return;
  const regionStyle = getComputedStyle(region);
  const notice = region.querySelector(".voice-notice");
  const noticeClearance = notice && !notice.hidden
    ? notice.offsetHeight + (parseFloat(getComputedStyle(notice).marginBottom) || 0)
    : 0;
  const rootStyle = getComputedStyle(document.documentElement);
  const footerGap = parseFloat(rootStyle.getPropertyValue("--assistant-footer-gap")) || 12;
  const internalSpacing = parseFloat(regionStyle.paddingTop) || 0;
  // The fixed footer clearance stays below this flex item and is deliberately
  // excluded; reserving the whole region would count the footer twice.
  assistantEls.conversation.style.paddingBottom = `${Math.ceil(composer.offsetHeight + internalSpacing + noticeClearance + footerGap + 8)}px`;
}

const quickQuestionSpecs = {
  schedule_today: { label: "What do I have today?", run: answerScheduleToday },
  schedule_week: { label: "What do I have this week?", run: answerScheduleWeek },
  schedule_month: { label: "What do I have this month?", run: answerScheduleMonth },
  attention_now: { label: "What needs my attention?", run: answerAttentionNow },
  free_time_week: { label: "When am I free this week?", run: answerFreeTimeWeek },
  guided_add: { label: "Add something to my schedule", run: null }
};

const KAMPALA_TIME_ZONE = "Africa/Kampala";
const DAILY_AVAILABILITY_WINDOW = Object.freeze({ start: 8 * 60, end: 22 * 60 });
const GUIDED_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function kampalaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KAMPALA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function dateAsUtcParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}
function dateFromUtc(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`; }
function addCalendarDays(value, count) { const date = dateAsUtcParts(value); if (!date) return ""; date.setUTCDate(date.getUTCDate() + count); return dateFromUtc(date); }
function weekdayForDate(value) { return dateAsUtcParts(value)?.getUTCDay() ?? -1; }
function formatKampalaDate(value, options = { weekday: "long", day: "numeric", month: "long" }) {
  const date = dateAsUtcParts(value);
  return date ? new Intl.DateTimeFormat("en", { ...options, timeZone: KAMPALA_TIME_ZONE }).format(date) : "Date not set";
}
function formatScheduleStatus(status) {
  const readable = ({ "in-progress": "in progress", "awaiting-check-in": "awaiting check-in" })[status] || String(status || "upcoming").replaceAll("-", " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}
function formatKampalaTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return "Anytime";
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}
function recurrenceOccursOn(item, date) {
  if (item.schedulePending || !item.date || date < item.date) return false;
  if (item.status === "postponed") return item.date === date;
  const recurrence = item.recurrence;
  if (!recurrence) return item.date === date;
  const start = dateAsUtcParts(item.date);
  const target = dateAsUtcParts(date);
  if (!start || !target) return false;
  const interval = Math.max(1, Number(recurrence.interval) || 1);
  const dayDiff = Math.round((target.getTime() - start.getTime()) / 86400000);
  if (recurrence.frequency === "daily") return dayDiff % interval === 0;
  if (recurrence.frequency === "weekly") {
    const startMonday = new Date(start);
    startMonday.setUTCDate(startMonday.getUTCDate() - ((startMonday.getUTCDay() + 6) % 7));
    const targetMonday = new Date(target);
    targetMonday.setUTCDate(targetMonday.getUTCDate() - ((targetMonday.getUTCDay() + 6) % 7));
    const weekDiff = Math.round((targetMonday.getTime() - startMonday.getTime()) / (7 * 86400000));
    const days = Array.isArray(recurrence.days) ? recurrence.days : [];
    return weekDiff >= 0 && weekDiff % interval === 0 && (days.length ? days.includes(target.getUTCDay()) : target.getUTCDay() === start.getUTCDay());
  }
  if (recurrence.frequency === "monthly") {
    const monthDiff = (target.getUTCFullYear() - start.getUTCFullYear()) * 12 + target.getUTCMonth() - start.getUTCMonth();
    return monthDiff >= 0 && monthDiff % interval === 0 && target.getUTCDate() === start.getUTCDate();
  }
  return item.date === date;
}
function scheduleOccurrencesBetween(start, end) {
  const occurrences = [];
  for (let date = start; date <= end; date = addCalendarDays(date, 1)) {
    for (const item of items) {
      if (item.status === "postponed" && !item.date) continue;
      if (recurrenceOccursOn(item, date)) occurrences.push({ ...item, effectiveDate: date });
      else if (item.status === "postponed" && !item.recurrence && item.date === date && !item.schedulePending) occurrences.push({ ...item, effectiveDate: date });
    }
  }
  return occurrences;
}
function compareScheduleOccurrences(a, b) {
  const aTimed = Boolean(a.start);
  const bTimed = Boolean(b.start);
  if (!aTimed && !bTimed) return String(a.id).localeCompare(String(b.id));
  return (aTimed === bTimed ? 0 : aTimed ? -1 : 1)
    || (a.start || "").localeCompare(b.start || "")
    || (a.end || "").localeCompare(b.end || "")
    || String(a.id).localeCompare(String(b.id));
}
function quickQuestionRows(occurrences, includeDate = false) {
  return [...occurrences].sort((a, b) => includeDate ? a.effectiveDate.localeCompare(b.effectiveDate) || compareScheduleOccurrences(a, b) : compareScheduleOccurrences(a, b)).map(item => ({
    time: `${includeDate ? `${formatKampalaDate(item.effectiveDate, { weekday: "short", day: "numeric", month: "short" })} · ` : ""}${item.start ? `${formatKampalaTime(item.start)}${item.end ? ` – ${formatKampalaTime(item.end)}` : ""}` : "Untimed"}`,
    title: item.title,
    status: formatScheduleStatus(item.status)
  }));
}
function quickQuestionGroupedText(occurrences) {
  const byDate = new Map();
  for (const item of [...occurrences].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || compareScheduleOccurrences(a, b))) {
    if (!byDate.has(item.effectiveDate)) byDate.set(item.effectiveDate, []);
    const time = item.start ? `${formatKampalaTime(item.start)}${item.end ? `–${formatKampalaTime(item.end)}` : ""}` : "Untimed";
    byDate.get(item.effectiveDate).push(`• ${time} · ${item.title} (${formatScheduleStatus(item.status)})`);
  }
  return [...byDate.entries()].map(([date, rows]) => `${formatKampalaDate(date)}\n${rows.join("\n")}`).join("\n\n");
}
function currentKampalaTimeMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: KAMPALA_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}
function answerScheduleToday() {
  const today = kampalaDate();
  const todayItems = scheduleOccurrencesBetween(today, today);
  return todayItems.length ? { text: `You have ${todayItems.length} item${todayItems.length === 1 ? "" : "s"} planned for today.`, items: quickQuestionRows(todayItems) } : { text: "You have nothing planned for today." };
}
function answerScheduleWeek() {
  const today = kampalaDate();
  const monday = addCalendarDays(today, -((weekdayForDate(today) + 6) % 7));
  const sunday = addCalendarDays(monday, 6);
  const range = scheduleOccurrencesBetween(monday, sunday);
  if (!range.length) return { text: "You have nothing planned for this week." };
  return { text: `This week:\n\n${quickQuestionGroupedText(range)}` };
}
function answerScheduleMonth() {
  const today = kampalaDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEndDate = dateAsUtcParts(monthStart);
  monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1, 0);
  const monthEnd = dateFromUtc(monthEndDate);
  const range = scheduleOccurrencesBetween(monthStart, monthEnd);
  if (!range.length) return { text: "You have nothing planned for this month." };
  const visible = [...range].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || compareScheduleOccurrences(a, b)).slice(0, 12);
  return { text: `You have ${range.length} scheduled occurrence${range.length === 1 ? "" : "s"} this month${range.length > visible.length ? `; showing the first ${visible.length}` : ""}.\n\n${quickQuestionGroupedText(visible)}` };
}
function answerAttentionNow() {
  const today = kampalaDate();
  const now = currentKampalaTimeMinutes();
  const todayItems = scheduleOccurrencesBetween(today, today).filter(item => !["completed", "cancelled", "missed"].includes(item.status));
  const byPriority = status => todayItems.filter(item => item.status === status).sort(compareScheduleOccurrences)[0] || null;
  const inProgress = byPriority("in-progress");
  const overdue = byPriority("overdue");
  const checkIn = byPriority("awaiting-check-in");
  const next = todayItems.filter(item => item.status === "upcoming" && item.start && Number(item.start.slice(0, 2)) * 60 + Number(item.start.slice(3, 5)) >= now).sort(compareScheduleOccurrences)[0] || null;
  const postponed = todayItems.filter(item => item.status === "postponed" && item.start).sort(compareScheduleOccurrences)[0] || null;
  const task = todayItems.filter(item => item.type === "task" && !item.start).sort(compareScheduleOccurrences)[0] || null;
  const item = inProgress || overdue || checkIn || next || postponed || task;
  if (!item) return { text: "Nothing needs your attention right now." };
  const reason = inProgress ? (item.end ? `is in progress until ${formatKampalaTime(item.end)}` : "is in progress")
    : overdue ? "is overdue" : checkIn ? "is awaiting check-in" : next ? "is your next scheduled item today"
      : postponed ? "is postponed and still scheduled today" : "is an untimed task for today";
  const time = item.start ? `${formatKampalaTime(item.start)}${item.end ? ` – ${formatKampalaTime(item.end)}` : ""}` : "Untimed";
  return { text: `${item.title} ${reason}.`, items: [{ time, title: item.title, status: formatScheduleStatus(item.status) }] };
}
function answerFreeTimeWeek() {
  const today = kampalaDate();
  const monday = addCalendarDays(today, -((weekdayForDate(today) + 6) % 7));
  const sunday = addCalendarDays(monday, 6);
  const activeStatuses = new Set(["upcoming", "in-progress", "overdue", "awaiting-check-in", "postponed"]);
  const occurrences = scheduleOccurrencesBetween(monday, sunday).filter(item => item.start && item.end && activeStatuses.has(item.status));
  const free = [];
  for (let date = monday; date <= sunday; date = addCalendarDays(date, 1)) {
    let cursor = date === today ? Math.max(DAILY_AVAILABILITY_WINDOW.start, currentKampalaTimeMinutes()) : DAILY_AVAILABILITY_WINDOW.start;
    const intervals = occurrences.filter(item => item.effectiveDate === date).map(item => ({
      start: Math.max(DAILY_AVAILABILITY_WINDOW.start, Number(item.start.slice(0, 2)) * 60 + Number(item.start.slice(3, 5))),
      end: Math.min(DAILY_AVAILABILITY_WINDOW.end, Number(item.end.slice(0, 2)) * 60 + Number(item.end.slice(3, 5)))
    })).filter(interval => interval.end > interval.start).sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
      else merged.push({ ...interval });
    }
    for (const interval of merged) {
      if (interval.start - cursor >= 30) free.push({ date, start: cursor, end: interval.start });
      cursor = Math.max(cursor, interval.end);
    }
    if (DAILY_AVAILABILITY_WINDOW.end - cursor >= 30) free.push({ date, start: cursor, end: DAILY_AVAILABILITY_WINDOW.end });
  }
  if (!free.length) return { text: "You do not have an open period of at least 30 minutes this week." };
  const clearest = free.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.date.localeCompare(b.date) || a.start - b.start).slice(0, 3);
  const phrases = clearest.map(slot => `${formatKampalaDate(slot.date, { weekday: "long" })} from ${formatKampalaTime(`${String(Math.floor(slot.start / 60)).padStart(2, "0")}:${String(slot.start % 60).padStart(2, "0")}`)} to ${formatKampalaTime(`${String(Math.floor(slot.end / 60)).padStart(2, "0")}:${String(slot.end % 60).padStart(2, "0")}`)}`);
  return { text: `Your clearest open period${phrases.length === 1 ? " is " : "s this week are "}${phrases.join(" and ")}.` };
}

const GUIDED_ADD_INITIAL_VALUES = Object.freeze({ itemType: null, title: null, date: null, start: null, end: null, category: null, notes: "", recurrence: null, weekdays: [] });
let guidedSaveInProgress = false;
let pendingQuickQuestionId = null;

function guidedSteps(flow = guidedFlow) {
  const type = flow?.values?.itemType;
  const steps = ["type", "title", "date"];
  if (type === "activity" || type === "routine") steps.push("start", "end");
  if (type === "routine") {
    steps.push("frequency", "interval");
    if (flow.values.recurrence?.frequency === "weekly") steps.push("weekdays");
  }
  steps.push("category", "notes", "summary");
  return steps;
}
function guidedPrompt(step, flow = guidedFlow) {
  const type = flow?.values?.itemType;
  if (step === "type") return "What would you like to add?";
  if (step === "title") return type === "activity" ? "What is the activity called?" : type === "routine" ? "What is the routine called?" : "What is the task called?";
  if (step === "date") return type === "routine" ? "What date should this routine start? Enter YYYY-MM-DD, today, or tomorrow." : "What date should it be scheduled for? Enter YYYY-MM-DD, today, or tomorrow.";
  if (step === "start") return type === "routine" ? "What time should it start? You can also skip the time." : "What time should the activity start? Enter 2:00 PM or 14:00.";
  if (step === "end") return type === "routine" ? "What time should it end? You can also skip the time." : "What time should the activity end? Enter 3:00 PM or 15:00.";
  if (step === "frequency") return "How often should this routine repeat?";
  if (step === "interval") return `How often should it repeat? Enter a positive number of ${flow.values.recurrence.frequency === "daily" ? "days" : flow.values.recurrence.frequency === "weekly" ? "weeks" : "months"}.`;
  if (step === "weekdays") return "Which days should this routine repeat? Select one or more days, then continue.";
  if (step === "category") return type === "task" ? "Choose a category, or skip this optional step." : "Choose a category.";
  if (step === "notes") return "Would you like to add a note? Type it here or skip this step.";
  return "Review the schedule details below.";
}
function guidedAppendAssistant(text) {
  appendEntry({ role: "assistant", text });
  renderGuidedControls();
}
async function beginGuidedAdd({ logUser = false } = {}) {
  if (logUser) appendEntry({ role: "user", text: "Add something to my schedule." });
  guidedFlow = { type: "create_schedule_item", step: "type", values: { ...GUIDED_ADD_INITIAL_VALUES, recurrence: null, weekdays: [] } };
  await saveGuidedFlow();
  guidedAppendAssistant(guidedPrompt("type"));
}
function guidedSummaryText(values) {
  const lines = [values.title, formatKampalaDate(values.date), values.start ? `${formatKampalaTime(values.start)}${values.end ? ` – ${formatKampalaTime(values.end)}` : ""}` : "Untimed", values.category || "Personal"];
  if (values.notes) lines.push(values.notes);
  if (values.recurrence) lines.push(`${values.recurrence.frequency[0].toUpperCase()}${values.recurrence.frequency.slice(1)} · every ${values.recurrence.interval}${values.recurrence.frequency === "daily" ? " day(s)" : values.recurrence.frequency === "weekly" ? " week(s)" : " month(s)"}${values.recurrence.frequency === "weekly" ? ` · ${values.recurrence.days.map(day => GUIDED_WEEKDAYS[day]).join(", ")}` : ""}`);
  return lines.join("\n");
}
function guidedCategoryNames() {
  const names = typeof saGetAvailableCategories === "function" ? saGetAvailableCategories() : [];
  return names.length ? names : [];
}
function guidedControlButton(label, action, value = null, className = "secondary-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.guidedAction = action;
  if (value !== null) button.dataset.guidedValue = String(value);
  button.textContent = label;
  return button;
}
function renderGuidedControls() {
  if (!assistantEls.conversation) return;
  assistantEls.conversation.querySelector("#guidedControls")?.remove();
  if (!guidedFlow) return;
  const shell = document.createElement("div");
  shell.id = "guidedControls";
  shell.className = "message assistant-message guided-controls-message";
  const controls = document.createElement("div");
  controls.className = guidedFlow.step === "summary" ? "guided-summary-card" : "guided-controls";
  const values = guidedFlow.values;

  if (guidedFlow.step === "summary") {
    const title = document.createElement("h3");
    title.textContent = values.title || "Schedule item";
    const date = document.createElement("p");
    date.textContent = formatKampalaDate(values.date);
    const time = document.createElement("p");
    time.textContent = values.start ? `${formatKampalaTime(values.start)}${values.end ? ` – ${formatKampalaTime(values.end)}` : ""}` : "Untimed";
    const category = document.createElement("p");
    category.textContent = values.category || "Personal";
    controls.append(title, date, time, category);
    if (values.recurrence) {
      const repeat = document.createElement("p");
      repeat.textContent = `${values.recurrence.frequency[0].toUpperCase()}${values.recurrence.frequency.slice(1)} · every ${values.recurrence.interval}${values.recurrence.frequency === "weekly" ? ` · ${values.recurrence.days.map(day => GUIDED_WEEKDAYS[day]).join(", ")}` : ""}`;
      controls.appendChild(repeat);
    }
    if (values.notes) { const note = document.createElement("p"); note.textContent = values.notes; controls.appendChild(note); }
    if (guidedFlow.conflictMessage) { const warning = document.createElement("p"); warning.className = "guided-conflict"; warning.textContent = guidedFlow.conflictMessage; controls.appendChild(warning); }
    const actions = document.createElement("div");
    actions.className = "guided-control-actions";
    actions.append(guidedControlButton(guidedSaveInProgress ? "Adding…" : guidedFlow.conflictKey ? "Add anyway" : "Add to schedule", "confirm", null, "primary-button"), guidedControlButton("Edit", "edit"), guidedControlButton("Cancel", "cancel"));
    actions.querySelector('[data-guided-action="confirm"]').disabled = guidedSaveInProgress;
    controls.appendChild(actions);
  } else if (guidedFlow.step === "switch_question") {
    const actions = document.createElement("div");
    actions.className = "guided-control-actions";
    actions.append(guidedControlButton("Cancel creation and ask", "cancel_and_ask", null, "primary-button"), guidedControlButton("Keep creating", "keep_guided"));
    controls.appendChild(actions);
  } else {
    const step = guidedFlow.step;
    if (step === "type") {
      controls.append(guidedControlButton("Activity", "type", "activity", "primary-button"), guidedControlButton("Task", "type", "task"), guidedControlButton("Routine", "type", "routine"));
    } else if (step === "frequency") {
      for (const [value, label] of [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]]) controls.appendChild(guidedControlButton(label, "frequency", value));
    } else if (step === "category") {
      for (const name of guidedCategoryNames()) controls.appendChild(guidedControlButton(name, "category", name));
      if (values.itemType === "task") controls.appendChild(guidedControlButton("Skip category", "skip"));
    } else if (step === "weekdays") {
      GUIDED_WEEKDAYS.forEach((name, day) => {
        const button = guidedControlButton(name, "weekday", day);
        button.setAttribute("aria-pressed", String(values.weekdays.includes(day)));
        controls.appendChild(button);
      });
      controls.appendChild(guidedControlButton("Continue", "continue_weekdays", null, "primary-button"));
    } else if ((step === "start" || step === "end") && values.itemType === "routine") {
      controls.appendChild(guidedControlButton("Skip time", "skip"));
    } else if (step === "notes") {
      controls.appendChild(guidedControlButton("Skip note", "skip"));
    }
    const actions = document.createElement("div");
    actions.className = "guided-control-actions";
    if (guidedSteps().indexOf(step) > 0) actions.appendChild(guidedControlButton("Back", "back"));
    actions.appendChild(guidedControlButton("Cancel", "cancel"));
    controls.appendChild(actions);
  }
  shell.appendChild(controls);
  assistantEls.conversation.appendChild(shell);
  scrollToBottom();
}
function guidedAdvance() {
  const steps = guidedSteps();
  const index = steps.indexOf(guidedFlow.step);
  guidedFlow.step = steps[Math.min(index + 1, steps.length - 1)];
}
async function guidedAskCurrentStep() {
  await saveGuidedFlow();
  guidedAppendAssistant(guidedPrompt(guidedFlow.step));
}
function parseGuidedDate(text) {
  const value = text.trim().toLowerCase();
  const today = kampalaDate();
  if (value === "today") return today;
  if (value === "tomorrow") return addCalendarDays(today, 1);
  const date = value;
  return scheduleValidateDate(date) ? date : null;
}
function parseGuidedTime(text) {
  const value = text.trim();
  let match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    hour = (hour % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || !scheduleValidateTime(value)) return null;
  return value;
}
function validateGuidedValues() {
  const values = guidedFlow.values;
  if (!values.title?.trim()) return "Enter a title.";
  if (!values.date || !scheduleValidateDate(values.date)) return "Enter a valid date.";
  if (values.itemType === "activity" && (!values.start || !scheduleValidateTime(values.start))) return "Select a start time.";
  if (values.itemType === "activity" && (!values.end || !scheduleValidateTime(values.end))) return "Select an end time.";
  if (values.start && !scheduleValidateTime(values.start)) return "Select a valid start time.";
  if (values.end && !scheduleValidateTime(values.end)) return "Select a valid end time.";
  if (values.start && values.end && values.end <= values.start) return "End time must be later than start time.";
  if (["activity", "routine"].includes(values.itemType) && !values.category) return "Choose a category.";
  if (values.category && !guidedCategoryNames().includes(values.category)) return "Choose a valid category.";
  if (values.itemType === "routine") {
    const recurrence = values.recurrence;
    if (!recurrence || !["daily", "weekly", "monthly"].includes(recurrence.frequency)) return "Choose a routine frequency.";
    if (!Number.isInteger(recurrence.interval) || recurrence.interval < 1 || recurrence.interval > 365) return "Enter a positive recurrence interval.";
    if (recurrence.frequency === "weekly" && !recurrence.days.length) return "Select at least one weekday.";
  }
  return null;
}
async function handleGuidedAnswer(text) {
  const answer = text.trim();
  const values = guidedFlow.values;
  const step = guidedFlow.step;
  if (step === "switch_question" && ["yes", "cancel", "cancel creation"].includes(answer.toLowerCase())) { await handleGuidedControl("cancel_and_ask"); return; }
  if (step === "switch_question" && ["no", "keep", "keep creating"].includes(answer.toLowerCase())) { await handleGuidedControl("keep_guided"); return; }
  if (["cancel", "cancel schedule creation", "cancel creation"].includes(answer.toLowerCase())) { await cancelGuidedAdd(); return; }
  if (step === "switch_question") { guidedAppendAssistant("Choose whether to cancel schedule creation or keep going with it."); return; }
  if (step === "summary") {
    const normalized = answer.toLowerCase();
    if (["cancel", "cancel creation"].includes(normalized)) { await cancelGuidedAdd(); return; }
    if (["edit", "back", "change"].includes(normalized)) { guidedFlow.step = "title"; await guidedAskCurrentStep(); return; }
    guidedAppendAssistant("Use Add to schedule, Edit, or Cancel on the summary card.");
    return;
  }
  if (step === "type") {
    const type = answer.toLowerCase();
    if (!["activity", "task", "routine"].includes(type)) { guidedAppendAssistant("Choose Activity, Task, or Routine."); return; }
    values.itemType = type;
  } else if (step === "title") {
    if (!answer || answer.length > 200) { guidedAppendAssistant("Enter a title of 1 to 200 characters."); return; }
    values.title = answer;
  } else if (step === "date") {
    const date = parseGuidedDate(answer);
    if (!date) { guidedAppendAssistant("Enter a valid date as YYYY-MM-DD, today, or tomorrow."); return; }
    values.date = date;
  } else if (step === "start" || step === "end") {
    if (!answer && values.itemType === "routine") values[step] = null;
    else {
      const time = parseGuidedTime(answer);
      if (!time) { guidedAppendAssistant(`Enter a valid ${step} time, such as 2:00 PM or 14:00.`); return; }
      values[step] = time;
      if (step === "end" && values.start && time <= values.start) { guidedAppendAssistant("End time must be later than start time."); return; }
    }
  } else if (step === "interval") {
    const interval = Number(answer);
    if (!Number.isInteger(interval) || interval < 1 || interval > 365) { guidedAppendAssistant("Enter a positive whole number from 1 to 365."); return; }
    values.recurrence.interval = interval;
  } else if (step === "frequency") {
    const frequency = answer.toLowerCase();
    if (!["daily", "weekly", "monthly"].includes(frequency)) { guidedAppendAssistant("Choose daily, weekly, or monthly."); return; }
    values.recurrence = { frequency, interval: 1, days: [] };
    values.weekdays = [];
  } else if (step === "weekdays") {
    const parts = answer.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const days = parts.map(value => GUIDED_WEEKDAYS.findIndex(day => day.toLowerCase().startsWith(value))).filter(day => day >= 0);
    if (!days.length || days.length !== parts.length) { guidedAppendAssistant("Enter weekday names such as Monday, Wednesday, or Friday."); return; }
    values.weekdays = [...new Set(days)];
    values.recurrence.days = values.weekdays;
  } else if (step === "category") {
    const category = guidedCategoryNames().find(name => name.toLowerCase() === answer.toLowerCase());
    if (!category && !(values.itemType === "task" && !answer)) { guidedAppendAssistant("Choose one of the available categories, or skip this optional step."); return; }
    if (category) values.category = category;
  } else if (step === "notes") {
    if (answer.length > 2000) { guidedAppendAssistant("Keep the note to 2,000 characters or fewer."); return; }
    values.notes = answer;
  }
  if (step === "category" && values.itemType === "task" && !answer) values.category = null;
  guidedAdvance();
  await guidedAskCurrentStep();
}
async function cancelGuidedAdd() {
  guidedFlow = null;
  pendingQuickQuestionId = null;
  await saveGuidedFlow();
  assistantEls.conversation.querySelector("#guidedControls")?.remove();
  appendEntry({ role: "assistant", text: "Schedule creation cancelled." });
}
async function confirmGuidedAdd() {
  if (!guidedFlow || guidedSaveInProgress) return;
  const validationError = validateGuidedValues();
  if (validationError) { guidedFlow.step = validationError.startsWith("Select a start") ? "start" : validationError.startsWith("Select an end") ? "end" : validationError.startsWith("Choose a category") ? "category" : validationError.startsWith("Choose a routine") || validationError.startsWith("Enter a positive recurrence") ? "frequency" : validationError.startsWith("Select at least one weekday") ? "weekdays" : validationError.startsWith("Enter a valid date") ? "date" : "title"; await guidedAskCurrentStep(); return; }
  const values = guidedFlow.values;
  const updates = {
    title: values.title.trim(), date: values.date, type: values.itemType, start: values.start || "", end: values.end || "",
    category: values.category || "Personal", notes: values.notes.trim(), recurrence: values.recurrence, schedulePending: false
  };
  const candidate = { ...updates, id: "__guided_add_item__", status: "upcoming" };
  const conflict = candidate.date && candidate.start && candidate.end
    ? saDetectConflictsForDate(candidate.date, [...items, candidate]).find(item => item.firstItemId === candidate.id || item.secondItemId === candidate.id)
    : null;
  const conflictKey = conflict ? `${candidate.date}|${candidate.start}|${candidate.end}|${conflict.pairKey}` : "";
  if (conflict && guidedFlow.conflictKey !== conflictKey) {
    const otherTitle = conflict.firstItemId === candidate.id ? conflict.secondTitle : conflict.firstTitle;
    guidedFlow.conflictKey = conflictKey;
    guidedFlow.conflictMessage = `Schedule conflict: ${candidate.title} overlaps with ${otherTitle} from ${formatTime(conflict.overlapStart)} to ${formatTime(conflict.overlapEnd)}.`;
    await saveGuidedFlow();
    guidedAppendAssistant(`${guidedFlow.conflictMessage} You can edit the details or add it anyway.`);
    return;
  }
  guidedSaveInProgress = true;
  renderGuidedControls();
  let result;
  try { result = await saCreateItem({ ...updates, status: "upcoming", postponed: 0 }); }
  catch { result = { success: false }; }
  finally { guidedSaveInProgress = false; }
  if (!result?.success) { guidedAppendAssistant("The item could not be saved. Try again."); return; }
  if (result.item && typeof window.refreshAssistantScheduleItem === "function") window.refreshAssistantScheduleItem(result.item, "created");
  const summary = guidedSummaryText(values);
  guidedFlow = null;
  pendingQuickQuestionId = null;
  await saveGuidedFlow();
  appendEntry({ role: "assistant", text: `Added to your schedule.\n${summary}` });
  assistantEls.conversation.querySelector("#guidedControls")?.remove();
}
async function handleGuidedControl(action, value) {
  if (!guidedFlow) return;
  if (action === "cancel") { await cancelGuidedAdd(); return; }
  if (action === "cancel_and_ask") {
    const queuedId = pendingQuickQuestionId;
    await cancelGuidedAdd();
    if (queuedId) await runQuickQuestion(queuedId);
    return;
  }
  if (action === "keep_guided") {
    guidedFlow.step = guidedFlow.returnStep || "type";
    guidedFlow.returnStep = null;
    delete guidedFlow.queuedQuickQuestion;
    pendingQuickQuestionId = null;
    await guidedAskCurrentStep();
    return;
  }
  if (action === "back") {
    const steps = guidedSteps();
    const index = steps.indexOf(guidedFlow.step);
    if (index > 0) guidedFlow.step = steps[index - 1];
    guidedFlow.conflictKey = null;
    guidedFlow.conflictMessage = null;
    await guidedAskCurrentStep();
    return;
  }
  if (action === "edit") {
    guidedFlow.step = "title";
    guidedFlow.conflictKey = null;
    guidedFlow.conflictMessage = null;
    await guidedAskCurrentStep();
    return;
  }
  if (action === "confirm") { await confirmGuidedAdd(); return; }
  if (action === "weekday") {
    const day = Number(value);
    const days = new Set(guidedFlow.values.weekdays);
    if (days.has(day)) days.delete(day); else if (day >= 0 && day <= 6) days.add(day);
    guidedFlow.values.weekdays = [...days].sort((a, b) => a - b);
    guidedFlow.values.recurrence.days = guidedFlow.values.weekdays;
    await saveGuidedFlow();
    renderGuidedControls();
    return;
  }
  if (action === "continue_weekdays") {
    if (!guidedFlow.values.weekdays.length) { guidedAppendAssistant("Select at least one weekday."); return; }
    appendEntry({ role: "user", text: guidedFlow.values.weekdays.map(day => GUIDED_WEEKDAYS[day]).join(", ") });
    guidedAdvance();
    await guidedAskCurrentStep();
    return;
  }
  if (action === "type") {
    guidedFlow.values.itemType = value;
    appendEntry({ role: "user", text: value[0].toUpperCase() + value.slice(1) });
    guidedAdvance();
    await guidedAskCurrentStep();
    return;
  }
  if (action === "frequency") {
    guidedFlow.values.recurrence = { frequency: value, interval: 1, days: [] };
    guidedFlow.values.weekdays = [];
    appendEntry({ role: "user", text: value[0].toUpperCase() + value.slice(1) });
    guidedAdvance();
    await guidedAskCurrentStep();
    return;
  }
  if (action === "category") {
    guidedFlow.values.category = value;
    appendEntry({ role: "user", text: value });
    guidedAdvance();
    await guidedAskCurrentStep();
    return;
  }
  if (action === "skip") {
    if (guidedFlow.step === "category") guidedFlow.values.category = null;
    else if (guidedFlow.step === "notes") guidedFlow.values.notes = "";
    else if (guidedFlow.step === "start" || guidedFlow.step === "end") guidedFlow.values[guidedFlow.step] = null;
    const skipped = guidedFlow.step;
    appendEntry({ role: "user", text: skipped === "notes" ? "Skip note" : skipped === "category" ? "Skip category" : "Skip time" });
    guidedAdvance();
    await guidedAskCurrentStep();
  }
}

async function runQuickQuestion(id, { logUser = true } = {}) {
  const spec = quickQuestionSpecs[id];
  if (!spec || id === "guided_add") return;
  const requestConvId = await ensureConversation();
  if (logUser) appendEntry({ role: "user", text: spec.label });
  const userMessages = conversation.filter(message => message.role === "user");
  if (userMessages.length === 1 && requestConvId) {
    firebaseStore.updateConversationSummary(requestConvId, { title: deriveConversationTitle(spec.label) }).catch(() => {});
  }
  let result;
  try { result = spec.run(); }
  catch {
    result = { text: "I couldn't answer that right now." };
  }
  appendEntry({ role: "assistant", text: result.text, items: result.items || [] });
  if (assistantEls.empty) assistantEls.empty.hidden = conversation.length > 0;
  scrollToBottom();
  assistantEls.input?.focus();
}

function closeQuickQuestions() {
  if (!quickQuestionsOpen) return;
  quickQuestionsOpen = false;
  const control = assistantEls.quickQuestionsControl;
  const panel = assistantEls.quickQuestionsPanel;
  if (control) {
    control.setAttribute("aria-expanded", "false");
    control.setAttribute("aria-label", "Open quick questions");
  }
  if (panel) {
    panel.hidden = true;
    panel.style.maxHeight = "";
  }
  updateConversationPadding();
}

function openQuickQuestions() {
  if (quickQuestionsOpen) return;
  const panel = assistantEls.quickQuestionsPanel;
  if (!panel) return;
  quickQuestionsOpen = true;
  const control = assistantEls.quickQuestionsControl;
  if (control) {
    control.setAttribute("aria-expanded", "true");
    control.setAttribute("aria-label", "Close quick questions");
  }
  panel.hidden = false;
  refreshQuickQuestionsLayout();
  updateConversationPadding();
  const first = panel.querySelector("[data-quick-question]");
  if (first) first.focus();
}

function toggleQuickQuestions() {
  if (quickQuestionsOpen) closeQuickQuestions(); else openQuickQuestions();
}

function refreshQuickQuestionsLayout() {
  if (!quickQuestionsOpen) return;
  const panel = assistantEls.quickQuestionsPanel;
  const control = assistantEls.quickQuestionsControl;
  if (!panel || !control) return;
  const composerRect = control.closest(".assistant-composer")?.getBoundingClientRect();
  if (!composerRect) return;
  const vv = window.visualViewport;
  const viewportTop = vv ? vv.offsetTop : 0;
  const available = Math.floor(composerRect.top - viewportTop - 12);
  panel.style.maxHeight = `${Math.max(72, available)}px`;
  panel.style.maxWidth = `${Math.max(180, Math.min(320, window.innerWidth - composerRect.left - 24))}px`;
  scrollToBottom();
}

async function handleQuickQuestion(id) {
  const spec = quickQuestionSpecs[id];
  if (!spec) return;
  try {
    await ensureConversation();
  } catch {
    showPersistenceFailure();
    return;
  }
  if (guidedFlow && id !== "guided_add") {
    pendingQuickQuestionId = id;
    guidedFlow.returnStep = guidedFlow.step;
    guidedFlow.queuedQuickQuestion = id;
    guidedFlow.step = "switch_question";
    await saveGuidedFlow();
    guidedAppendAssistant("You’re in the middle of creating a schedule item. Cancel it before asking this question?");
    return;
  }
  appendEntry({ role: "user", text: id === "guided_add" ? "Add something to my schedule." : spec.label });
  if (id === "guided_add") {
    await beginGuidedAdd();
    return;
  }
  if (guidedFlow) { guidedFlow = null; await saveGuidedFlow(); }
  await runQuickQuestion(id, { logUser: false });
}

function submitInput() {
  const value = assistantEls.input.value;
  if (!value.trim() || sendInProgress) return;
  // sendMessage clears only after the conversation has been accepted, so a
  // conversation-creation failure leaves the draft available for retry.
  sendMessage(value);
}

function renderProposalButton(button, action) {
  const proposalId = button.dataset.proposalId || button.closest(".proposal")?.dataset.proposalId;
  button.addEventListener("click", () => {
    if (button.disabled || proposalId !== (currentProposal?.id || "current")) return;
    if (action === "confirm" && button.dataset.proposalId !== proposalId) return;
    button.disabled = true;
    if (action === "confirm") confirmProposal();
    if (action === "edit") editProposal();
    if (action === "cancel") cancelProposal();
  });
}

assistantEls.nav?.addEventListener("click", () => {
  setView("assistant");
  scrollToBottom();
  updateComposerHeight();
  updateSendButtonState();
});

assistantEls.send?.addEventListener("click", submitInput);

assistantEls.input?.addEventListener("compositionstart", () => {
  isComposing = true;
});
assistantEls.input?.addEventListener("compositionend", () => {
  isComposing = false;
  updateSendButtonState();
});

assistantEls.input?.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    if (event.isComposing || isComposing) return;
    event.preventDefault();
    if (!assistantEls.send.disabled) {
      submitInput();
    }
  }
});

assistantEls.input?.addEventListener("input", () => {
  updateComposerHeight();
  updateSendButtonState();
  if (activeConversationId) {
    composerDrafts.set(activeConversationId, assistantEls.input.value);
  }
  if (quickQuestionsOpen) refreshQuickQuestionsLayout();
});

assistantEls.input?.addEventListener("paste", () => {
  requestAnimationFrame(updateSendButtonState);
});
assistantEls.input?.addEventListener("cut", () => {
  requestAnimationFrame(updateSendButtonState);
});

assistantEls.quickQuestionsControl?.addEventListener("click", () => {
  toggleQuickQuestions();
});

assistantEls.quickQuestionsPanel?.addEventListener("click", event => {
  const button = event.target.closest("[data-quick-question]");
  if (!button) return;
  closeQuickQuestions();
  handleQuickQuestion(button.dataset.quickQuestion);
});
assistantEls.conversation?.addEventListener("click", event => {
  const button = event.target.closest("[data-guided-action]");
  if (!button || button.disabled || !assistantEls.conversation.contains(button)) return;
  handleGuidedControl(button.dataset.guidedAction, button.dataset.guidedValue).catch(() => showPersistenceFailure());
});

window.closeQuickQuestions = closeQuickQuestions;
window.addEventListener("resize", () => {
  updateConversationPadding();
  if (quickQuestionsOpen) refreshQuickQuestionsLayout();
});
window.visualViewport?.addEventListener("resize", () => {
  updateConversationPadding();
  if (quickQuestionsOpen) refreshQuickQuestionsLayout();
});
window.visualViewport?.addEventListener("scroll", () => {
  if (quickQuestionsOpen) refreshQuickQuestionsLayout();
});

assistantEls.voice?.addEventListener("click", () => {
  if (!assistantEls.voiceNotice) return;
  assistantEls.voiceNotice.hidden = false;
  updateConversationPadding();
  clearTimeout(voiceNoticeTimer);
  voiceNoticeTimer = setTimeout(() => {
    assistantEls.voiceNotice.hidden = true;
    updateConversationPadding();
  }, 3000);
});

assistantEls.historyButton?.addEventListener("click", openDrawer);
assistantEls.newConversationHeaderButton?.addEventListener("click", () => startNewConversation().catch(showPersistenceFailure));

assistantEls.closeDrawerButton?.addEventListener("click", closeDrawer);
assistantEls.drawerBackdrop?.addEventListener("click", closeDrawer);
assistantEls.drawerNewConversationButton?.addEventListener("click", () => {
  closeDrawer();
  startNewConversation().catch(showPersistenceFailure);
});

assistantEls.drawerSearchInput?.addEventListener("input", () => {
  const filtered = filterDrawerConversations();
  renderDrawerList(filtered);
});

assistantEls.drawerRetryButton?.addEventListener("click", loadDrawerConversations);

assistantEls.drawerLoadMoreButton?.addEventListener("click", async () => {
  drawerLimit += 25;
  await loadDrawerConversations();
});

// ── Context menu handlers ─────────────────────────────────────────────────────

assistantEls.contextRenameButton?.addEventListener("click", () => {
  if (!contextMenuConv) return;
  const conv = contextMenuConv;
  closeContextMenu();
  openRenameDialog(conv);
});

assistantEls.contextDeleteButton?.addEventListener("click", () => {
  if (!contextMenuConv) return;
  deletingConversationId = contextMenuConv.id;
  closeContextMenu();
  assistantEls.deleteDialog?.showModal();
});

// Dismiss context menu when clicking outside it
document.addEventListener("click", event => {
  if (assistantEls.contextMenu && !assistantEls.contextMenu.hidden &&
      !event.target.closest("#conversationContextMenu")) {
    closeContextMenu();
  }
}, true /* capture so it fires before any inner click handlers */);

// ── Rename dialog handlers ────────────────────────────────────────────────────

assistantEls.renameForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const title = (assistantEls.renameInput?.value || "").trim();
  if (!title) {
    if (assistantEls.renameError) {
      assistantEls.renameError.textContent = "Please enter a title.";
      assistantEls.renameError.hidden = false;
    }
    return;
  }
  if (title.length > 80) {
    if (assistantEls.renameError) {
      assistantEls.renameError.textContent = "Title must be 80 characters or fewer.";
      assistantEls.renameError.hidden = false;
    }
    return;
  }
  const id = renamingConversationId;
  if (!id) { assistantEls.renameDialog?.close(); return; }
  if (assistantEls.saveRenameButton) assistantEls.saveRenameButton.disabled = true;
  try {
    await firebaseStore.updateConversationSummary(id, { title });
    // Update cached list so the drawer reflects the new title immediately
    const cached = drawerConversations.find(c => c.id === id);
    if (cached) cached.title = title;
    renderDrawerList(filterDrawerConversations());
    updateDrawerActiveItem();
    renamingConversationId = null;
    assistantEls.renameDialog?.close();
  } catch (err) {
    if (assistantEls.renameError) {
      assistantEls.renameError.textContent = "The conversation could not be renamed. Try again.";
      assistantEls.renameError.hidden = false;
    }
    console.error("Rename conversation failed", err);
  } finally {
    if (assistantEls.saveRenameButton) assistantEls.saveRenameButton.disabled = false;
  }
});

assistantEls.closeRenameButton?.addEventListener("click", closeRenameDialog);
assistantEls.cancelRenameButton?.addEventListener("click", closeRenameDialog);



assistantEls.keepDeleteButton?.addEventListener("click", () => {
  assistantEls.deleteDialog?.close();
});

assistantEls.confirmDeleteButton?.addEventListener("click", async () => {
  const targetId = deletingConversationId || activeConversationId;
  if (!targetId) {
    assistantEls.deleteDialog?.close();
    return;
  }
  const wasActive = targetId === activeConversationId;
  assistantEls.confirmDeleteButton.disabled = true;

  try {
    await firebaseStore.deleteConversation(targetId);
    composerDrafts.delete(targetId);
    delete guidedFlowsByConversation[targetId];
    if (wasActive) { guidedFlow = null; pendingQuickQuestionId = null; }
    await saveGuidedFlow();
    deletingConversationId = null;

    if (wasActive) {
      const remaining = await firebaseStore.listRecentConversations(20);
      if (remaining.length > 0) {
        await openConversation(remaining[0].id);
      } else {
        activeConversationId = null;
        await startNewConversation();
      }
    }
    await loadDrawerConversations();
  } catch (error) {
    showPersistenceFailure();
    console.error("Delete conversation failed", error);
  } finally {
    assistantEls.confirmDeleteButton.disabled = false;
    assistantEls.deleteDialog?.close();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (quickQuestionsOpen) {
      closeQuickQuestions();
      return;
    }
    if (assistantEls.contextMenu && !assistantEls.contextMenu.hidden) {
      closeContextMenu();
      return;
    }
    if (isDrawerOpen) {
      closeDrawer();
    }
  }
});

document.addEventListener("click", event => {
  if (!quickQuestionsOpen) return;
  const control = assistantEls.quickQuestionsControl;
  const panel = assistantEls.quickQuestionsPanel;
  if (control && control.contains(event.target)) return;
  if (panel && panel.contains(event.target)) return;
  closeQuickQuestions();
});

assistantEls.conversation?.addEventListener("scroll", () => {
  if (!assistantEls.scrollLatest) return;
  if (isNearBottom(60)) {
    assistantEls.scrollLatest.hidden = true;
  } else if (assistantEls.conversation.scrollHeight - assistantEls.conversation.scrollTop - assistantEls.conversation.clientHeight > 140) {
    assistantEls.scrollLatest.hidden = false;
  }
});
assistantEls.scrollLatest?.addEventListener("click", scrollToBottom);

assistantEls.retrySave?.addEventListener("click", () => {
  persistenceQueue = persistenceQueue.then(persistPendingMessages);
});

assistantEls.conversation?.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const proposalEl = button.closest(".proposal");
  if (!proposalEl) return;
  const proposalId = proposalEl.dataset.proposalId;
  if (proposalId !== (currentProposal?.id || "current")) return;
  if (button.dataset.action === "confirm" && button.dataset.proposalId !== proposalId) return;
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
loadDrawerConversations().catch(showPersistenceFailure);
updateComposerHeight();
updateSendButtonState();
updateConversationPadding();
if (pendingMessageWrites.length) showPersistenceFailure();

function classifyAndProcess(text) {
  const classification = classifyRequest(text);
  return classification;
}
