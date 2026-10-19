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
let waitingStartedAt = null;
let activeRevealController = null;
let responseRevealQueue = Promise.resolve();
const scheduleProposalRegistry = new Map();
let quickQuestionInProgress = false;
let quickQuestionSelectionPending = false;
const GUIDED_LAUNCHER_PENDING_KEY = `matson-time-guided-launcher-pending-${firebaseStore.getCurrentUser().uid}`;
let activeRequestId = null;
let drawerConversations = [];
let isDrawerOpen = false;
let drawerTriggerButton = null;
let drawerLimit = 20;
let contextMenuConv = null;
let contextMenuTriggerEl = null;
let deletingConversationId = null;
let renamingConversationId = null;
let conversation = Array.isArray(window.initialConversation?.messages) ? window.initialConversation.messages.map(message => ({ id: message.id, role: message.role, text: message.text, kind: message.kind, proposalSummary: message.proposalSummary || null, guidedFlowId: message.guidedFlowId, guidedStepId: message.guidedStepId, resolved: message.resolved, referencedItemIds: message.referencedItemIds || [], deletedItemIds: message.deletedItemIds || [] })) : [];
let activeConversationId = window.initialConversation?.id || window.initialAssistantState?.activeConversationId || null;
let guidedFlowsByConversation = window.initialAssistantState?.guidedFlowsByConversation && typeof window.initialAssistantState.guidedFlowsByConversation === "object" ? { ...window.initialAssistantState.guidedFlowsByConversation } : {};
const initialGuidedFlow = activeConversationId ? (guidedFlowsByConversation[activeConversationId] || (window.initialAssistantState?.activeConversationId === activeConversationId ? window.initialAssistantState?.guidedFlow : null)) : null;
let guidedCompletedFlow = initialGuidedFlow?.status === "completed" ? initialGuidedFlow : null;
let guidedFlow = guidedCompletedFlow ? null : initialGuidedFlow;
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
  else if (guidedFlowsByConversation[activeConversationId]?.status !== "completed") delete guidedFlowsByConversation[activeConversationId];
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
    proposalSummary: encodeStructuredEntry(entry),
    resolved: entry.resolved !== false,
    ...(entry.guidedFlowId ? { guidedFlowId: entry.guidedFlowId, guidedStepId: entry.guidedStepId } : {})
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
      id: message.id, role: message.role,
      text: message.text,
      kind: message.kind,
      proposalSummary: message.proposalSummary || null,
      guidedFlowId: message.guidedFlowId, guidedStepId: message.guidedStepId,
      resolved: message.resolved !== false,
      referencedItemIds: message.referencedItemIds || [],
      deletedItemIds: message.deletedItemIds || []
    }));

    currentProposal = null;

    const state = await firebaseStore.loadAssistantState();
    const isActive = state.activeConversationId === id;
    guidedFlowsByConversation = state.guidedFlowsByConversation && typeof state.guidedFlowsByConversation === "object" ? { ...state.guidedFlowsByConversation } : guidedFlowsByConversation;
    const savedGuidedFlow = guidedFlowsByConversation[id] || (isActive ? state.guidedFlow || null : null);
    guidedCompletedFlow = savedGuidedFlow?.status === "completed" ? savedGuidedFlow : null;
    guidedFlow = guidedCompletedFlow ? null : savedGuidedFlow;
    pendingQuickQuestionId = guidedFlow?.queuedQuickQuestion || null;
    if (guidedFlow) guidedFlowsByConversation[id] = guidedFlow;
    pendingClarification = isActive ? state.pendingClarification : restoreNaturalClarificationFromConversation(conversation);
    activePlanningContext = isActive ? state.planningContext : null;
    entityRegistry = isActive && Array.isArray(state.entityRegistry) ? state.entityRegistry.slice(-10) : [];
    pendingOperation = isActive ? state.pendingOperation || null : null;
    referencedSets = isActive && Array.isArray(state.referencedSets) ? state.referencedSets.slice(-5) : [];
    lastConfirmedAction = isActive ? state.lastConfirmedAction || null : null;
    currentProposal = restorePendingScheduleProposal(conversation, id);
    if (currentProposal?.confirmationState === "failed") persistScheduleProposalState(currentProposal, "failed").catch(() => {});

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
    if (guidedFlow) { if (!guidedFlow.id) guidedFlow.id = crypto.randomUUID(); renderGuidedHistoryControls(); renderGuidedControls(); }
    else if (guidedCompletedFlow) renderGuidedHistoryControls(guidedCompletedFlow);
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
  waitingStartedAt = performance.now();
  const shouldKeepBottom = isNearBottom();
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
  updateAssistantEmptyState();
  if (shouldKeepBottom) {
    scrollToBottom();
  }
}

function removeWaitingState() {
  if (waitingEl) {
    waitingEl.remove();
    waitingEl = null;
    waitingStartedAt = null;
    updateAssistantEmptyState();
  }
}

function updateAssistantEmptyState() {
  if (!assistantEls.empty || !assistantEls.conversation) return;
  const hasActiveAssistantState = Boolean(
    guidedFlow || waitingEl || currentProposal || pendingClarification ||
    ["awaiting_confirmation", "executing"].includes(pendingOperation?.state)
  );
  const showEmptyState = conversation.length === 0 && !hasActiveAssistantState && assistantEls.conversation.childElementCount === 0;
  assistantEls.empty.hidden = !showEmptyState;
  assistantEls.conversation.hidden = showEmptyState;
}

function waitForPresentation(startedAt, minimumMs = 350) {
  const remaining = Math.max(0, minimumMs - (performance.now() - startedAt));
  return remaining ? new Promise(resolve => setTimeout(resolve, remaining)) : Promise.resolve();
}

function restoreStructuredEntry(entry) {
  if (!entry || entry.items?.length || typeof entry.proposalSummary !== "string" || !entry.proposalSummary.startsWith("matson-structured-v1:")) return entry;
  try {
    const value = JSON.parse(entry.proposalSummary.slice("matson-structured-v1:".length));
    return { ...entry, proposalSummary: value.proposalSummary || null, items: Array.isArray(value.items) ? value.items : [], scheduleItem: value.scheduleItem || null, proposalSnapshot: value.proposalSnapshot || null };
  } catch { return entry; }
}

function restorePendingScheduleProposal(entries, conversationId) {
  for (const rawEntry of [...(entries || [])].reverse()) {
    if (rawEntry.role !== "assistant" || rawEntry.kind !== "proposal_summary" || rawEntry.resolved !== false) continue;
    const entry = restoreStructuredEntry(rawEntry);
    const snapshot = entry.proposalSnapshot;
    if (!snapshot?.id || snapshot.sourceConversationId !== conversationId || !snapshot.action?.type) continue;
    if (!["create_item", "update_item", "reschedule_item", "postpone_item", "cancel_item", "complete_item"].includes(snapshot.action.type)) continue;
    const state = snapshot.confirmationState === "confirming" ? "failed" : snapshot.confirmationState;
    if (!["pending", "failed"].includes(state)) continue;
    const proposal = registerScheduleProposal({
      id: snapshot.id,
      conversationId,
      operation: snapshot.operation,
      confirmationState: state,
      lifecycle: state,
      action: snapshot.action,
      message: entry.text,
      source: "local",
      originalItem: snapshot.action.targetId ? saFindItemById(snapshot.action.targetId) : null,
      summaryMessageId: rawEntry.id,
      summaryText: entry.text
    }, conversationId);
    return proposal;
  }
  return null;
}

function encodeStructuredEntry(entry) {
  if (!entry.items?.length && !entry.scheduleItem && !entry.proposalSnapshot) return entry.proposalSummary || null;
  return "matson-structured-v1:" + JSON.stringify({ proposalSummary: entry.proposalSummary || null, items: Array.isArray(entry.items) ? entry.items.slice(0, 200) : [], scheduleItem: entry.scheduleItem || null, proposalSnapshot: entry.proposalSnapshot || null });
}

function revealStructuredRows(container, signal, onUpdate) {
  if (!container?.children?.length) return Promise.resolve();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rows = [...container.children];
  if (reduced) { rows.forEach(row => row.classList.add("is-revealed")); onUpdate?.(); return Promise.resolve(); }
  return rows.reduce((queue, row) => queue.then(() => new Promise(resolve => {
    if (signal?.aborted || !container.isConnected) { resolve(); return; }
    row.classList.add("is-revealed");
    onUpdate?.();
    setTimeout(resolve, Math.max(35, Math.min(85, Math.floor(520 / Math.max(rows.length, 1)))));
  })), Promise.resolve());
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
  if (!entry.id) entry.id = crypto.randomUUID();
  conversation.push(entry);
  updateAssistantEmptyState();
  if (entry.role === "assistant" && !options.skipRender && !options.restoring) {
    appendAssistantWithReveal(entry, activeConversationId);
  } else if (!options.skipRender) {
    renderConversationEntry(entry, options);
  }
  const message = {
    id: entry.id,
    role: entry.role, text: entry.text, kind: entry.kind || (entry.role === "user" ? "user_message" : "assistant_message"),
    referencedItemIds: entry.referencedItemIds || [],
    deletedItemIds: entityRegistry.filter(entity => entity.deleted && (entry.referencedItemIds || []).includes(entity.id)).map(entity => entity.id),
    proposalSummary: encodeStructuredEntry(entry),
    resolved: entry.resolved !== false,
    ...(entry.guidedFlowId ? { guidedFlowId: entry.guidedFlowId, guidedStepId: entry.guidedStepId } : {})
  };
  pendingMessageWrites.push({ conversationId: activeConversationId, message });
  localStorage.setItem(PENDING_MESSAGE_WRITES_KEY, JSON.stringify(pendingMessageWrites));
  persistenceQueue = persistenceQueue.then(persistPendingMessages);
  if (entry.role === "assistant" && activeConversationId) {
    firebaseStore.updateConversationSummary(activeConversationId, conversationSummary("active")).catch(showPersistenceFailure);
  }
}

async function appendAssistantWithReveal(entry, conversationId = activeConversationId) {
  if (activeConversationId !== conversationId) {
    saveEntryForConversation(conversationId, entry);
    return;
  }
  if (!conversation.some(existing => existing.id === entry.id)) appendEntry(entry, { skipRender: true });
  const reveal = async () => {
    if (activeConversationId !== conversationId) return;
    const startedAt = waitingStartedAt || performance.now();
    if (!waitingEl) showWaitingState();
    await new Promise(resolve => requestAnimationFrame(resolve));
    await waitForPresentation(startedAt, 350);
    if (activeConversationId !== conversationId) return;
    removeWaitingState();
    await renderConversationEntry(entry, { reveal: true });
  };
  const task = responseRevealQueue.catch(() => {}).then(reveal);
  responseRevealQueue = task.catch(() => {});
  return task;
}

function renderConversationEntry(entry, options = {}) {
  entry = restoreStructuredEntry(entry);
  const shouldKeepBottom = isNearBottom();
  const message = document.createElement("div");
  message.className = entry.role === "user" ? "message user-message" : "message assistant-message";
  if (entry.guidedFlowId) { message.dataset.guidedFlowId = entry.guidedFlowId; message.dataset.guidedStep = entry.guidedStepId || ""; }

  if (entry.role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "user-bubble";
    bubble.textContent = entry.text;
    message.appendChild(bubble);
  } else {
    const bubble = document.createElement("div");
    bubble.className = "assistant-bubble";
    if (entry.kind === "guided_completion") { message.tabIndex = -1; bubble.setAttribute("role", "status"); bubble.setAttribute("aria-live", "polite"); bubble.setAttribute("aria-atomic", "true"); }
    if (entry.kind === "schedule_completion") message.tabIndex = -1;
    const text = document.createElement("p");
    text.className = "assistant-text";
    bubble.appendChild(text);
    message.appendChild(bubble);

    let responseList = null;
    let completionDetails = null;
    const displayText = entry.kind === "guided_completion" ? String(entry.text || "").split("\n")[0] : entry.text;
    if (entry.kind === "guided_completion") {
      const details = String(entry.text || "").split("\n").slice(1).filter(Boolean);
      if (details.length) {
        completionDetails = document.createElement("div");
        completionDetails.className = "guided-completed-summary";
        for (const [index, detail] of details.entries()) {
          const line = document.createElement("p");
          if (index === 0) line.className = "guided-completed-title";
          line.textContent = detail;
          completionDetails.appendChild(line);
        }
      }
    }
    if (entry.items && entry.items.length) {
      const list = document.createElement("ul");
      list.className = "response-list";
      let lastDate = null;
      for (const item of entry.items) {
        const group = item.date || item.groupLabel || null;
        if (group && group !== lastDate) {
          const heading = document.createElement("li");
          heading.className = "response-date-heading";
          heading.textContent = item.date ? formatKampalaDate(item.date, { weekday: "long", month: "long", day: "numeric" }) : String(item.groupLabel);
          list.appendChild(heading);
          lastDate = group;
        }
        const row = document.createElement("li");
        row.className = "response-row";
        const time = document.createElement("span");
        time.className = "response-time";
        time.textContent = item.time || (item.date ? "Time not set" : "Date not set");
        const title = document.createElement("span");
        title.className = "response-title";
        title.textContent = item.title;
        const status = document.createElement("span");
        status.className = "response-status";
        const statusTone = String(item.status || "").toLowerCase().replaceAll(" ", "-");
        if (["upcoming", "in-progress", "completed", "postponed", "awaiting-check-in", "overdue", "missed", "cancelled"].includes(statusTone)) {
          status.classList.add(`status-${statusTone}`);
        }
        status.textContent = item.status || "Upcoming";
        row.append(time, title, status);
        list.appendChild(row);
      }
      responseList = list;
    }
    if (entry.kind === "schedule_completion" && entry.scheduleItem) {
      const item = entry.scheduleItem;
      completionDetails = document.createElement("div");
      completionDetails.className = "guided-completed-summary schedule-completion-card";
      const addField = (label, value, className = "") => {
        const line = document.createElement("p");
        if (className) line.className = className;
        const key = document.createElement("span"); key.className = "completion-label"; key.textContent = label;
        const content = document.createElement("span"); content.className = "completion-value"; content.textContent = value;
        line.append(key, content); completionDetails.appendChild(line);
      };
      addField("Title", item.title || "Schedule item", "guided-completed-title");
      addField("Date", item.date ? formatKampalaDate(item.date, { weekday: "long", month: "long", day: "numeric" }) : "Date not set");
      addField("Time", item.start ? `${formatKampalaTime(item.start)}${item.end ? ` – ${formatKampalaTime(item.end)}` : ""}` : "Time not set");
      if (item.category) addField("Category", item.category);
      if (item.notes) addField("Note", item.notes);
      if (item.recurrence) addField("Repeats", `${item.recurrence.frequency} · every ${item.recurrence.interval}`);
    }

    if (options.reveal && !options.restoring) {
      activeRevealController?.abort();
      const controller = new AbortController();
      activeRevealController = controller;
      assistantEls.conversation.appendChild(message);
      if (shouldKeepBottom) scrollToBottom();
      let followLatest = shouldKeepBottom;
      let lastAutoScrollTop = assistantEls.conversation.scrollTop;

      return revealAssistantMessage(text, displayText, {
        signal: controller.signal,
        onUpdate: () => {
          if (followLatest && assistantEls.conversation.scrollTop < lastAutoScrollTop - 4) followLatest = false;
          if (followLatest) {
            scrollToBottom();
            lastAutoScrollTop = assistantEls.conversation.scrollTop;
          }
        }
      }).then(async () => {
        if (displayText && entry.kind !== "guided_completion" && message.isConnected) {
          const announcement = document.createElement("span");
          announcement.className = "sr-only";
          announcement.setAttribute("role", "status");
          announcement.setAttribute("aria-live", "polite");
          announcement.setAttribute("aria-atomic", "true");
          announcement.textContent = displayText;
          bubble.appendChild(announcement);
        }
        if (responseList && message.isConnected) {
          responseList.dataset.progressive = "true";
          message.appendChild(responseList);
          await revealStructuredRows(responseList, controller.signal, () => { if (followLatest) scrollToBottom(); });
          delete responseList.dataset.progressive;
        }
        if (completionDetails && message.isConnected) {
          completionDetails.dataset.progressive = "true";
          message.appendChild(completionDetails);
          await revealStructuredRows(completionDetails, controller.signal, () => { if (followLatest) scrollToBottom(); });
          delete completionDetails.dataset.progressive;
        }
        if (followLatest) scrollToBottom();
      });
    } else {
      text.textContent = displayText;
    }
    if (responseList) message.appendChild(responseList);
    if (completionDetails) message.appendChild(completionDetails);
  }

  assistantEls.conversation.appendChild(message);
  if (options.scrollToBottom !== false) {
    if (shouldKeepBottom || options.forceScroll) {
      scrollToBottom();
    }
  }
  return Promise.resolve();
}

function renderConversation(options = {}) {
  activeRevealController?.abort();
  removeWaitingState();
  assistantEls.conversation.replaceChildren();
  if (assistantEls.scrollLatest) assistantEls.scrollLatest.hidden = true;
  for (const entry of conversation) {
    const restoredProposalId = restoreStructuredEntry(entry).proposalSnapshot?.id;
    const hasActiveProposal = entry.resolved === false && currentProposal?.id === restoredProposalId;
    const displayEntry = entry.resolved === false && !hasActiveProposal
      ? { ...entry, text: `${entry.text} (This earlier proposal expired when you left the conversation; request it again to review it.)` }
      : entry;
    renderConversationEntry(displayEntry, { restoring: true, scrollToBottom: false });
  }
  updateAssistantEmptyState();
  if (conversation.length > 0) {
    scrollToBottom();
  }
  renderGuidedControls();
  renderNaturalPendingChoices();
  if (currentProposal?.conversationId === activeConversationId) renderProposal(currentProposal);
}

async function renderNaturalChoiceControls(choices, { reveal = true } = {}) {
  assistantEls.conversation.querySelectorAll(".natural-choice-controls").forEach(node => node.remove());
  const shell = document.createElement("div");
  shell.className = "message assistant-message guided-controls-message natural-choice-controls";
  const card = document.createElement("div");
  card.className = "guided-choice-card";
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", "Choose a schedule detail");
  for (const [value, label] of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "guided-choice-row";
    button.dataset.naturalChoice = value;
    button.setAttribute("aria-label", label);
    button.disabled = reveal;
    if (reveal) { button.setAttribute("aria-disabled", "true"); button.classList.add("choice-reveal-pending"); }
    const marker = document.createElement("span");
    marker.className = "guided-choice-square";
    marker.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "guided-choice-label";
    text.textContent = label;
    button.append(marker, text);
    card.appendChild(button);
  }
  shell.appendChild(card);
  assistantEls.conversation.appendChild(shell);
  scrollToBottom();
  const buttons = [...card.querySelectorAll("button")];
  if (!reveal) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    buttons.forEach(button => { button.classList.remove("choice-reveal-pending"); button.classList.add("is-revealed"); button.disabled = false; button.removeAttribute("aria-disabled"); });
    return;
  }
  for (const button of buttons) {
    button.classList.remove("choice-reveal-pending");
    button.classList.add("is-revealed");
    await new Promise(resolve => setTimeout(resolve, 55));
  }
  buttons.forEach(button => { button.disabled = false; button.removeAttribute("aria-disabled"); });
}

function renderNaturalPendingChoices() {
  const pending = pendingClarification;
  const rawMessage = pending?.knownFields?.rawMessage;
  if (!rawMessage || !["natural_create", "natural_edit_target", "natural_edit_time"].includes(pending.intent)) return;
  const result = processNaturalScheduleCommand(rawMessage, {});
  if (result.choices?.length) renderNaturalChoiceControls(result.choices, { reveal: false });
}

async function renderProposal(proposal, { reveal = false } = {}) {
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
    addDetailRow(details, "Title", item.title || "Schedule item");
    addDetailRow(details, "Type", item.type);
    addDetailRow(details, "Date", item.date ? formatDateLabel(item.date) : "Date not set");
    addDetailRow(details, "Time", item.start ? formatTime(item.start) + (item.end ? "–" + formatTime(item.end) : "") : "Time not set");
    addDetailRow(details, "Category", item.category);
    if (item.notes) addDetailRow(details, "Note", item.notes);
    if (item.recurrence) addDetailRow(details, "Repeats", item.recurrence.frequency + " · every " + item.recurrence.interval + (item.recurrence.frequency === "weekly" ? " · " + item.recurrence.days.map(day => GUIDED_WEEKDAYS[day]).join(", ") : ""));
  } else if (proposal.action?.targetId) {
    const target = saFindItemById(proposal.action.targetId) || proposal.originalItem;
    if (target) {
      addDetailRow(details, "Item", target.title);
      addDetailRow(details, "Date", target.date ? formatDateLabel(target.date) : "Date not set");
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
  conflictRow.appendChild(document.createTextNode(` ${proposal.conflict.items.join(" and ")} overlap${proposal.conflict.date ? ` on ${formatDateLabel(proposal.conflict.date)}` : ""}${proposal.conflict.start && proposal.conflict.end ? ` from ${formatTime(proposal.conflict.start)} to ${formatTime(proposal.conflict.end)}` : ""}.`));
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
    if (changes.schedulePending) { addDetailRow(details, "New date", "Date not set"); addDetailRow(details, "New time", "Time not set"); }
  }

  if (proposal.action?.postponeMinutes) {
    addDetailRow(details, "Postpone by", `${proposal.action.postponeMinutes} minutes`);
  }
  if (proposal.action?.type === "postpone_item" && proposal.action.schedule) {
    const schedule = proposal.action.schedule;
    addDetailRow(details, "New date", schedule.schedulePending ? "Date not set" : (schedule.date ? formatDateLabel(schedule.date) : "Date not set"));
    addDetailRow(details, "New time", schedule.schedulePending || !schedule.start ? "Time not set" : formatTime(schedule.start) + (schedule.end ? "–" + formatTime(schedule.end) : ""));
  }

  container.appendChild(details);

  const actionsEl = document.createElement("div");
  actionsEl.className = "proposal-actions";
  actionsEl.hidden = reveal;
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "primary-button";
  confirmBtn.dataset.proposalId = proposal.id || "current";
  const planDeletes = proposal.plan?.actions?.some(action => action.type === "delete_item");
  confirmBtn.textContent = proposal.action?.type === "create_item" ? "Add to schedule" : ["update_item", "reschedule_item"].includes(proposal.action?.type) ? "Confirm change" : proposal.bulkAction?.type === "delete_items" || proposal.bulkAction?.type === "deduplicate_items" || proposal.action?.type === "delete_item" ? "Delete permanently" : proposal.bulkAction?.type === "cancel_items" ? "Cancel items" : planDeletes ? "Confirm plan with permanent deletion" : proposal.plan ? "Confirm plan" : "Confirm";
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
  if (reveal) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const content = [header, ...details.children];
    if (!reduced) for (const row of content) row.classList.add("reveal-pending");
    for (const row of content) {
      if (!reduced) await new Promise(resolve => setTimeout(resolve, 45));
      row.classList.remove("reveal-pending");
      row.classList.add("is-revealed");
    }
    actionsEl.hidden = false;
    actionsEl.classList.add("is-revealed");
    actionsEl.querySelectorAll("button").forEach(button => { button.disabled = false; button.removeAttribute("aria-disabled"); });
  }
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
  if (actionType === "create_item" && proposal.action.item?.title) return proposal.action.item.title;
  if (proposal.action?.targetId && ["update_item", "reschedule_item", "postpone_item"].includes(actionType)) return (saFindItemById(proposal.action.targetId) || proposal.originalItem)?.title || "Review schedule change";
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
    /what.*(?:have|schedule).*(?:this week|next week|this month|next month)/i,
    /what.*(?:unscheduled|still needs? (?:a )?(?:date|time)|not scheduled|missing from my schedule|need a date|need a time)/i,
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
  return shiftIsoDate(kampalaToday(), days);
}

function resolveWeekday(weekday) {
  const weekdays = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const target = weekdays[weekday.toLowerCase()];
  if (target === undefined) return null;
  const today = kampalaToday();
  const currentDay = new Date(today + "T12:00:00Z").getUTCDay();
  let diff = target - currentDay;
  if (diff < 0) diff += 7;
  if (diff === 0) {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    if (hour >= 12) diff = 7;
  }
  return shiftIsoDate(today, diff);
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
    date: item.date,
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
    date: item.date,
    time: itemTime(item),
    title: item.title,
    status: item.status.replace("-", " ")
  }));
  return { text: `You have ${sorted.length} item${sorted.length === 1 ? "" : "s"} planned for ${formatDateLabel(dateStr)}.`, items };
}

function answerWeekSchedule() {
  const today = kampalaToday();
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
      items.push({ date: dateStr, time: itemTime(item), title: item.title, status: item.status.replace("-", " ") });
    }
  }
  return { text: `This week has ${weekItems.length} planned item${weekItems.length === 1 ? "" : "s"}.`, items };
}

function answerNaturalDateRange(startDate, endDate, label) {
  const selected = items.filter(item => item.date && item.date >= startDate && item.date <= endDate && !["cancelled", "missed"].includes(item.status)).sort((a, b) => a.date.localeCompare(b.date) || (a.start || "").localeCompare(b.start || ""));
  if (!selected.length) return { text: "Nothing is scheduled for " + label + "." };
  return { text: "You have " + selected.length + " item" + (selected.length === 1 ? "" : "s") + " scheduled for " + label + ".", items: selected.map(item => ({ date: item.date, time: formatDateLabel(item.date) + (item.start ? " at " + formatTime(item.start) : " · Time not set"), title: item.title, status: item.status.replace("-", " ") })) };
}

function answerUnscheduledItems(message) {
  const text = message.toLowerCase();
  const wantDate = /\b(?:date|day)\b/.test(text) && !/\btime\b/.test(text);
  const wantTime = /\btime\b/.test(text) && !/\bdate\b/.test(text);
  const selected = items.filter(item => {
    if (["cancelled", "completed", "missed"].includes(item.status)) return false;
    const dateMissing = item.schedulePending === true || !item.date;
    const timeMissing = item.type !== "task" && (!item.start || !item.end);
    return wantDate ? dateMissing : wantTime ? timeMissing : dateMissing || timeMissing;
  });
  if (!selected.length) return { text: "No schedule items are waiting for more details." };
  const rows = selected.map(item => ({ date: item.date || null, groupLabel: item.date ? null : "Date not set", time: item.start ? formatTime(item.start) + (item.end ? "–" + formatTime(item.end) : "") : item.type === "task" ? "Anytime" : "Time not set", title: item.title, status: !item.date ? "Date not set" : item.type !== "task" && (!item.start || !item.end) ? "Time not set" : "Details incomplete" }));
  const groups = new Set(rows.map(row => row.status));
  return { text: "Here are the plans that still need details: " + [...groups].join(", ") + ".", items: rows };
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

  if (/\b(?:unscheduled|still needs? (?:a )?(?:date|time)|not scheduled|missing from my schedule|need a date|need a time)\b/.test(text)) return answerUnscheduledItems(text);
  if (/what.*have.*today|what.*doing.*today/i.test(text)) return answerHaveToday();
  if (/what should i do now/i.test(text)) return answerWhatNow();
  if (/what.*(?:have|schedule).*(?:next week)/i.test(text)) {
    const today = kampalaToday();
    const monday = shiftIsoDate(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7) + 7);
    return answerNaturalDateRange(monday, shiftIsoDate(monday, 6), "next week");
  }
  if (/what.*(?:have|schedule).*(?:this week)/i.test(text)) {
    const today = kampalaToday();
    const monday = shiftIsoDate(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
    return answerNaturalDateRange(monday, shiftIsoDate(monday, 6), "this week");
  }
  if (/what.*(?:have|schedule).*(?:this month)/i.test(text)) {
    const today = kampalaToday();
    const start = today.slice(0, 8) + "01";
    const [year, month] = today.split("-").map(Number);
    const endDate = new Date(Date.UTC(year, month, 0, 12));
    const end = endDate.getUTCFullYear() + "-" + String(endDate.getUTCMonth() + 1).padStart(2, "0") + "-" + String(endDate.getUTCDate()).padStart(2, "0");
    return answerNaturalDateRange(start, end, "this month");
  }
  if (/what.*coming next|what.*next/i.test(text) && !/studio/i.test(text)) return answerComingNext();
  if (/what.*remaining today|what.*still.*today/i.test(text)) return answerRemaining();
  if (/what.*complete.*today/i.test(text)) return answerCompletedToday();
  if (/what.*miss.*this week/i.test(text)) return answerMissedWeek();
  if (/what.*have.*tomorrow/i.test(text)) return answerHaveDate(resolveDateOffset(1));
  if (/what.*have.*friday/i.test(text)) return answerHaveDate(resolveWeekday("friday") || resolveDateOffset(0));
  const requestedDate = extractDateEntities(text);
  if (requestedDate.date && /\b(?:what|show|list|schedule)\b/.test(text)) return answerHaveDate(requestedDate.date);
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

function parseCommandTime(text) {
  const match = /\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i.exec(text);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "pm") hour += 12;
  return String(hour).padStart(2, "0") + ":" + (match[2] || "00");
}

function normalizeScheduleLanguage(message) {
  return String(message || "").normalize("NFKC").replace(/[’‘]/g, "'").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

function kampalaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = type => parts.find(entry => entry.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftIsoDate(dateText, amount) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function extractDateEntities(message) {
  const text = normalizeScheduleLanguage(message).toLowerCase();
  const explicit = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (explicit) {
    const value = `${explicit[1]}-${explicit[2].padStart(2, "0")}-${explicit[3].padStart(2, "0")}`;
    if (scheduleValidateDate(value)) return { date: value, source: "explicit" };
  }
  if (/\bday after tomorrow\b/.test(text)) return { date: shiftIsoDate(kampalaToday(), 2), source: "relative" };
  if (/\btomorrow\b/.test(text)) return { date: shiftIsoDate(kampalaToday(), 1), source: "relative" };
  if (/\byesterday\b/.test(text)) return { date: shiftIsoDate(kampalaToday(), -1), source: "relative" };
  if (/\btoday\b/.test(text)) return { date: kampalaToday(), source: "relative" };
  const weekdays = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const match = /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(text);
  if (match) {
    const today = kampalaToday();
    const day = new Date(`${today}T12:00:00Z`).getUTCDay();
    const target = weekdays[match[2]];
    let offset = (target - day + 7) % 7;
    if (match[1] || offset === 0) offset += 7;
    return { date: shiftIsoDate(today, offset), source: "weekday" };
  }
  if (/\b(?:date|day) (?:is )?(?:not decided|unknown|undecided|not set)\b|\b(?:don't|do not|haven't) know (?:the )?(?:date|day)\b/.test(text)) return { date: null, source: "undecided" };
  return { date: null, source: "missing" };
}

function timeToMinutes(hourText, minuteText, meridiem, contextPeriod) {
  let hour = Number(hourText);
  const minute = Number(minuteText || 0);
  if (hour > 23 || minute > 59) return null;
  const period = (meridiem || contextPeriod || "").toLowerCase();
  if (period === "am" || period === "pm") {
    if (hour < 1 || hour > 12) return null;
    hour %= 12;
    if (period === "pm") hour += 12;
  }
  return hour * 60 + minute;
}

function minutesToTime(total) {
  if (!Number.isInteger(total) || total < 0 || total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function extractDurationChange(message) {
  const text = normalizeScheduleLanguage(message).toLowerCase();
  const words = { one: 1, an: 1, a: 1, two: 2, three: 3, four: 4, five: 5 };
  const match = /\b(one|an|a|two|three|four|five|\d+)\s+(hour|minute)s?\s+(later|earlier)\b/.exec(text);
  if (match) return { minutes: (words[match[1]] || Number(match[1])) * (match[2] === "hour" ? 60 : 1) * (match[3] === "earlier" ? -1 : 1), kind: "shift" };
  const setDuration = /\b(?:make|set|change)\b.*?\b(one|an|a|two|three|four|five|\d+)\s+hours?\b/.exec(text);
  if (setDuration) return { minutes: (words[setDuration[1]] || Number(setDuration[1])) * 60, kind: "set" };
  return null;
}

function extractTimeEntities(message) {
  const text = normalizeScheduleLanguage(message).toLowerCase();
  if (/\b(?:time|hour) (?:is )?(?:not decided|unknown|undecided|not set)\b|\b(?:don't|do not|haven't) know (?:the )?time\b|\btime\s*(?:tbd|to be decided)\b/.test(text)) return { start: null, end: null, source: "undecided" };
  const period = /\b(?:morning|this morning)\b/.test(text) ? "am" : /\b(?:afternoon|evening|tonight|this evening)\b/.test(text) ? "pm" : "";
  const range = /\b(?:from|between)\s+(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\s+(?:to|and|-)\s+(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\b/i.exec(text);
  if (range) {
    if (!range[3] && !range[6] && !period && Number(range[1]) <= 12 && Number(range[4]) <= 12) return { ambiguous: true, source: "range" };
    let firstPeriod = range[3] || range[6] || period;
    let secondPeriod = range[6] || range[3] || period;
    let startMinutes = timeToMinutes(range[1], range[2], range[3], firstPeriod);
    let endMinutes = timeToMinutes(range[4], range[5], range[6], secondPeriod);
    if (startMinutes == null || endMinutes == null) return { ambiguous: true, source: "range" };
    if (!range[3] && range[6] && startMinutes > endMinutes && startMinutes >= 12 * 60) startMinutes -= 12 * 60;
    if (range[3] && !range[6] && endMinutes <= startMinutes) endMinutes += 12 * 60;
    const start = minutesToTime(startMinutes);
    const end = minutesToTime(endMinutes);
    if (!start || !end || start >= end) return { ambiguous: true, source: "range" };
    return { start, end, source: "range" };
  }
  const exact24 = /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (exact24) return { start: `${String(Number(exact24[1])).padStart(2, "0")}:${exact24[2]}`, end: null, source: "exact" };
  const single = /\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b|\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s+(?:in the )?(morning|afternoon|evening|tonight)\b|\b(noon|midnight)\b/i.exec(text);
  if (!single) return { start: null, end: null, source: "missing" };
  if (single[7]) return { start: single[7].toLowerCase() === "noon" ? "12:00" : "00:00", end: null, source: "exact" };
  const meridiem = single[3] || (single[6] === "morning" ? "am" : single[6] ? "pm" : "");
  const hour = single[1] || single[4];
  const minute = single[2] || single[5];
  if (!meridiem && Number(hour) <= 12) return { ambiguous: true, source: "single" };
  const value = timeToMinutes(hour, minute, meridiem, "");
  return value == null ? { ambiguous: true, source: "single" } : { start: minutesToTime(value), end: null, source: "exact" };
}

function extractRecurrenceEntities(message) {
  const text = normalizeScheduleLanguage(message).toLowerCase();
  if (!/\b(?:every|daily|weekly|each morning|weekdays)\b/.test(text)) return null;
  const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const days = Object.entries(dayMap).filter(([name]) => new RegExp(`\\b${name}s?\\b`).test(text)).map(([, day]) => day);
  if (/\b(?:every day|daily|each morning|every morning)\b/.test(text)) return { frequency: "daily", interval: 1, days: [] };
  if (/\b(?:weekdays|every weekday)\b/.test(text)) return { frequency: "weekly", interval: 1, days: [1, 2, 3, 4, 5] };
  if (days.length) return { frequency: "weekly", interval: 1, days };
  const interval = /\bevery\s+(\d+)\s+(day|week|month)s?\b/.exec(text);
  if (interval) return { frequency: ({ day: "daily", week: "weekly", month: "monthly" })[interval[2]], interval: Math.max(1, Number(interval[1])), days: [] };
  return null;
}

function inferScheduleType(message, recurrence, hasTime) {
  const text = normalizeScheduleLanguage(message).toLowerCase();
  if (recurrence) return { type: "routine", confidence: 0.98 };
  if (/\b(meeting|appointment|interview|match|class|session|event|flight|consultation)\b/.test(text)) return { type: "activity", confidence: 0.98 };
  if (/\b(?:send|buy|review|pay|remember to|submit|collect|pick up|clean|cook|finish|call)\b/.test(text)) return { type: "task", confidence: 0.91 };
  if (hasTime) return { type: "activity", confidence: 0.82 };
  if (/\b(?:i have|book|attend|go to)\b/.test(text)) return { type: "activity", confidence: 0.78 };
  return { type: "task", confidence: 0.6 };
}

function inferScheduleCategory(message) {
  const text = normalizeScheduleLanguage(message).toLowerCase();
  const mappings = [
    ["Health", /\b(gym|workout|doctor|hospital|medicine|run|exercise)\b/],
    ["Meetings", /\b(meeting|interview|appointment|consultation)\b/],
    ["Music", /\b(studio|rehearsal|dj|mix|playlist|recording|performance)\b/],
    ["Travel", /\b(flight|airport|trip|journey|hotel|travel)\b/],
    ["Personal", /\b(shopping|cooking|errands|cleaning|family|personal)\b/]
  ];
  const available = saGetAvailableCategories();
  const found = mappings.find(([category, pattern]) => available.includes(category) && pattern.test(text));
  return found?.[0] || "Personal";
}

function extractScheduleTitle(message) {
  let title = normalizeScheduleLanguage(message).replace(/[.!?]+$/g, "").trim();
  title = title.replace(/^(?:(?:please|can you|could you)\s+)?(?:i have|i've got|i need to|i need|remember that i need to|remember to|remember|add|create|schedule|put|note|book|set up)\s+/i, "");
  title = title.replace(/^a\s+(?=(?:meeting|appointment|task|event|activity|routine)\b)/i, "");
  title = title.replace(/\s*(?:,?\s+but\s+(?:i\s+)?(?:don't|do not|haven't|have not)\s+know\b).*$/i, "");
  title = title.replace(/\s*(?:,?\s+)?(?:from|between)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:to|and|-)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?.*$/i, "");
  title = title.replace(/\s+\d{4}-\d{2}-\d{2}\b.*$/i, "");
  title = title.replace(/\s+\b(?:today|tomorrow|yesterday|next\s+week|this\s+week|this\s+weekend|next\s+month|this\s+month|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b.*$/i, "");
  title = title.replace(/\s+\b(?:every\s+day|daily|weekdays|every\s+weekday|every\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)).*$/i, "");
  title = title.replace(/\s*(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}(?::\d{2})?\s*(?:am|pm)).*$/i, "");
  title = title.replace(/\s*(?:,?\s+)?(?:time|date)\s+(?:is\s+)?(?:not decided|unknown|undecided|not set|tbd).*$/i, "");
  return title.replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "").replace(/\s+/g, " ").replace(/^\w/, char => char.toUpperCase());
}

function calculateInterpretationConfidence({ intent, title, typeConfidence = 0, target, date, time }) {
  if (target) return 0.94;
  if (intent === "create" && title && typeConfidence >= 0.78) return 0.91;
  if (intent === "create" && title) return 0.68;
  if (date?.source === "undecided" || time?.source === "undecided") return 0.86;
  return 0.35;
}

function activeScheduleItems() {
  return items.filter(item => !["completed", "cancelled", "missed"].includes(item.status));
}

function resolveScheduleItemReference(message, conversationContext = {}) {
  if (conversationContext.pendingClarification?.intent === "natural_selected_target") {
    const selected = items.find(item => item.id === conversationContext.pendingClarification.knownFields?.targetId);
    if (selected) return { item: selected, matches: [selected], confidence: 0.98 };
  }
  const text = normalizeScheduleLanguage(message).toLowerCase();
  const lastResult = [...conversation].reverse().find(entry => Array.isArray(entry.referencedItemIds) && entry.referencedItemIds.length);
  const recentIds = lastResult?.referencedItemIds || [];
  const uniqueRecent = [...new Set(recentIds)].map(id => items.find(item => item.id === id)).filter(Boolean);
  const ordinal = /\b(?:the\s+)?(first|second|third|last)\s+(?:one|item|event|activity|task|routine)\b/i.exec(text);
  if (ordinal && uniqueRecent.length) {
    const index = ordinal[1].toLowerCase() === "first" ? 0 : ordinal[1].toLowerCase() === "second" ? 1 : ordinal[1].toLowerCase() === "third" ? 2 : uniqueRecent.length - 1;
    return { item: uniqueRecent[index] || null, matches: uniqueRecent, confidence: uniqueRecent[index] ? 0.98 : 0 };
  }
  if (/\b(?:it|that|this one|the same one)\b/.test(text) && uniqueRecent.length) return { item: uniqueRecent[0], matches: [uniqueRecent[0]], confidence: 0.9 };
  const candidates = activeScheduleItems();
  const matchDate = extractDateEntities(text).date;
  const tokens = text.replace(/\b(?:move|shift|push|reschedule|postpone|change|update|edit|cancel|complete|finish|mark|done|the|a|an|my|item|event|activity|task|routine|to|on|at|from|with|tomorrow|today|friday|monday|tuesday|wednesday|thursday|saturday|sunday|next|this|in|morning|evening|am|pm)\b/gi, " ").replace(/\b\d{1,2}(?::\d{2})?\b/g, " ").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(token => token.length > 1);
  const scored = candidates.map(item => {
    const titleTokens = item.title.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(token => token.length > 1);
    const overlap = titleTokens.filter(token => tokens.includes(token)).length;
    const exact = text.includes(item.title.toLowerCase()) ? 3 : 0;
    const dateBoost = matchDate && item.date === matchDate ? 1 : 0;
    const recency = uniqueRecent.some(recent => recent.id === item.id) ? 0.5 : 0;
    return { item, score: exact + overlap + dateBoost + recency };
  }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { item: null, matches: [], confidence: 0 };
  const best = scored.filter(candidate => candidate.score === scored[0].score).map(candidate => candidate.item);
  return { item: best.length === 1 ? best[0] : null, matches: best, confidence: best.length === 1 ? Math.min(0.97, 0.65 + scored[0].score * 0.1) : 0.5 };
}

function buildNaturalActionProposal(action, message, item = null) {
  return registerScheduleProposal({ action, message, conflict: null, originalMessage: message, source: "local", ...(item ? { originalItem: { ...item } } : {}) });
}

function registerScheduleProposal(proposal, conversationId = activeConversationId) {
  if (!proposal.id) proposal.id = crypto.randomUUID();
  proposal.conversationId = conversationId || proposal.conversationId || activeConversationId || null;
  proposal.lifecycle = proposal.lifecycle || "pending";
  proposal.confirmationState = proposal.confirmationState || "pending";
  proposal.operation = proposal.operation || (proposal.action?.type === "create_item" ? "schedule.create" : proposal.action?.type === "update_item" || proposal.action?.type === "reschedule_item" ? "schedule.update" : proposal.action?.type === "postpone_item" ? "schedule.postpone" : proposal.action?.type === "cancel_item" ? "schedule.cancel" : proposal.action?.type === "complete_item" ? "schedule.complete" : proposal.action?.type || "schedule.plan");
  if (proposal.action) proposal.action.operation = proposal.operation;
  if (proposal.action && !proposal.conflict) proposal.conflict = findProposalConflict(proposal.action, proposal.id);
  scheduleProposalRegistry.set(proposal.id, proposal);
  return proposal;
}

function makeProposalSnapshot(proposal) {
  const action = proposal?.action || {};
  const item = action.item;
  return {
    id: proposal.id,
    summaryMessageId: proposal.summaryMessageId || null,
    operation: proposal.operation,
    confirmationState: proposal.confirmationState,
    sourceConversationId: proposal.conversationId,
    action: {
      type: action.type || null,
      operation: action.operation || proposal.operation,
      targetId: action.targetId || null,
      item: item ? { type: item.type, title: item.title, date: item.schedulePending ? null : (item.date || null), schedulePending: item.schedulePending === true, start: item.start || null, end: item.end || null, category: item.category || "Personal", notes: item.notes || "", recurrence: item.recurrence || null } : null,
      changes: action.changes ? { ...action.changes } : null,
      schedule: action.schedule ? { ...action.schedule } : null
    }
  };
}

function makeProposalSummaryEntry(proposal, text, referencedItemIds = []) {
  proposal.summaryText = text;
  const entry = { id: crypto.randomUUID(), role: "assistant", text, kind: "proposal_summary", proposalSummary: text, proposalSnapshot: makeProposalSnapshot(proposal), resolved: false, referencedItemIds };
  proposal.summaryMessageId = entry.id;
  entry.proposalSnapshot = makeProposalSnapshot(proposal);
  return entry;
}

async function persistScheduleProposalState(proposal, confirmationState) {
  proposal.confirmationState = confirmationState;
  proposal.lifecycle = confirmationState;
  const entry = proposal.summaryMessageId ? conversation.find(message => message.id === proposal.summaryMessageId) : null;
  if (entry) {
    entry.proposalSnapshot = makeProposalSnapshot(proposal);
    entry.proposalSummary = entry.proposalSummary || proposal.message || "";
    entry.resolved = confirmationState === "resolved";
  }
  if (proposal.summaryMessageId && proposal.conversationId) {
    await persistenceQueue.catch(() => {});
    await firebaseStore.updateConversationMessage(proposal.conversationId, proposal.summaryMessageId, {
      resolved: confirmationState === "resolved",
      proposalSummary: encodeStructuredEntry({ proposalSummary: proposal.summaryText || proposal.message || "", proposalSnapshot: makeProposalSnapshot(proposal) })
    });
  }
}

function restoreNaturalClarificationFromConversation(entries) {
  const index = entries.findLastIndex(entry => entry.role === "assistant" && (
    ["What should I call it?", "What would you like to add?", "Do you mean 5:00 AM or 5:00 PM?", "I found more than one possible match. Which one do you mean?"].includes(entry.text)
    || /^I found .+\. Is that the item you mean\?$/.test(entry.text || "")
  ));
  if (index < 0) return null;
  const original = [...entries.slice(0, index)].reverse().find(entry => entry.role === "user");
  if (!original) return null;
  return processNaturalScheduleCommand(original.text, {}).pending || null;
}

function processNaturalScheduleCommand(message, conversationContext = {}) {
  const normalized = normalizeScheduleLanguage(message);
  const lower = normalized.toLowerCase();
  const pending = conversationContext.pendingClarification;

  if (pending?.intent === "natural_edit_target") {
    const targetId = pending.knownFields?.targetId;
    if (targetId && pending.knownFields?.rawMessage) {
      return processNaturalScheduleCommand(pending.knownFields.rawMessage, { pendingClarification: { intent: "natural_selected_target", knownFields: { targetId } } });
    }
  }

  if (/\b(?:what do i have|what is on|show|list).*(?:today|tomorrow|this week|next week|this month)\b/.test(lower)) return { handled: false };

  const recurrence = extractRecurrenceEntities(normalized);
  const date = extractDateEntities(normalized);
  const time = extractTimeEntities(normalized);
  const explicitCreate = /\b(?:add|create|schedule|put|note|remember|book)\b/.test(lower);
  const hasScheduleNoun = /\b(meeting|appointment|interview|match|class|session|event|flight|consultation|gym|workout|studio|rehearsal|task|routine|reminder|errand|shopping|cooking|call|review|payment|medicine)\b/.test(lower);
  const creationIntent = Boolean(recurrence || explicitCreate || (hasScheduleNoun && /\b(?:i have|i've got|i need to|i need|going to|attend)\b/.test(lower)));

  if (pending?.intent === "natural_create") {
    const known = pending.knownFields || {};
    const continued = `${known.rawMessage || ""} ${normalized}`.trim();
    let answeredTime = extractTimeEntities(continued);
    if (pending.missingFields?.includes("type")) {
      const selectedType = /\bactivity\b/i.test(normalized) ? "activity" : /\btask\b/i.test(normalized) ? "task" : /\broutine\b/i.test(normalized) ? "routine" : null;
      if (!selectedType) return { handled: true, clarification: "What would you like to add?", choices: [["activity", "Activity"], ["task", "Task"], ["routine", "Routine"]], pending };
      known.type = selectedType;
      pending.missingFields = pending.missingFields.filter(field => field !== "type");
    }
    if (pending.missingFields?.includes("time_period")) {
      const periodAnswer = /\b(am|pm)\b/i.exec(normalized)?.[1]?.toLowerCase();
      const rawRange = /\b(?:from|between)\s+\d{1,2}(?::[0-5]\d)?\s*(?:am|pm)?\s+(?:to|and|-)\s+\d{1,2}(?::[0-5]\d)?\s*(?:am|pm)?\b/i.exec(known.rawMessage || "");
      const rawTime = /(?:at\s+)?(\d{1,2})(?::([0-5]\d))?/i.exec(known.rawMessage || "");
      if (periodAnswer && rawRange) {
        answeredTime = extractTimeEntities(rawRange[0] + " " + periodAnswer);
      } else if (periodAnswer && rawTime) {
        const minutes = timeToMinutes(rawTime[1], rawTime[2], periodAnswer, "");
        answeredTime = { start: minutesToTime(minutes), end: null, source: "exact" };
      }
    }
    if (pending.missingFields?.includes("title") && !known.title) {
      const proposedTitle = extractScheduleTitle(normalized);
      if (proposedTitle && !/^(?:meeting|appointment|event|activity|task|routine|item|something)$/i.test(proposedTitle)) {
        known.title = proposedTitle;
        pending.knownFields = known;
        pending.missingFields = [];
      }
    }
    const title = known.title || extractScheduleTitle(normalized);
    if (pending.missingFields?.includes("time_period") && answeredTime.ambiguous) return { handled: true, clarification: "Please choose a clear time, such as 5 AM or 5 PM.", pending };
    if (pending.missingFields?.includes("time_period") && !answeredTime.start) return { handled: true, clarification: "Do you mean 5:00 AM or 5:00 PM?", pending };
    if (answeredTime.ambiguous && !pending.missingFields?.includes("time_period")) return { handled: true, clarification: "Do you mean 5:00 AM or 5:00 PM?", choices: [["am", "5:00 AM"], ["pm", "5:00 PM"]], pending: { intent: "natural_create", knownFields: { ...known, title, rawMessage: continued }, missingFields: ["time_period"] } };
    let recurrence = null;
    try { recurrence = known.recurrenceJson ? JSON.parse(known.recurrenceJson) : null; } catch {}
    const hasDate = Boolean(known.date);
    const item = { type: known.type || "activity", title, date: hasDate ? known.date : null, start: hasDate ? (answeredTime.start || known.start || "") : "", end: hasDate ? (answeredTime.end || known.end || "") : "", category: known.category || "Personal", notes: known.notes || "", recurrence, schedulePending: !hasDate };
    if (!title || /^(?:meeting|appointment|event|activity|task|routine|item|something)$/i.test(title)) return { handled: true, clarification: "What should I call it?", pending: { intent: "natural_create", knownFields: { ...known, rawMessage: continued }, missingFields: ["title"] } };
    return { handled: true, proposal: buildNaturalActionProposal({ type: "create_item", item }, message), response: item.schedulePending ? "I’ve added the known details. Review the schedule item below; its date and time can be set later." : "I’ve added the known details. You can set the time later. Review the schedule item below." };
  }

  if (pending?.intent === "natural_edit_time") {
    const target = items.find(item => item.id === pending.knownFields?.targetId);
    const period = /\b(am|pm)\b/i.exec(normalized)?.[1]?.toLowerCase();
    const rawTime = /(?:to|at)\s+(\d{1,2})(?::([0-5]\d))?/i.exec(pending.knownFields?.rawMessage || "");
    const minutes = period && rawTime ? timeToMinutes(rawTime[1], rawTime[2], period, "") : null;
    const start = minutesToTime(minutes);
    if (!target || !start) return { handled: true, clarification: "Do you mean 5:00 AM or 5:00 PM?", pending };
    const changes = { start, schedulePending: false };
    if (target.start && target.end) {
      const duration = Number(target.end.slice(0, 2)) * 60 + Number(target.end.slice(3)) - Number(target.start.slice(0, 2)) * 60 - Number(target.start.slice(3));
      changes.end = minutesToTime(minutes + duration) || "";
    } else if (target.end) changes.end = target.end;
    return { handled: true, proposal: buildNaturalActionProposal({ type: "update_item", targetId: target.id, item: null, changes, postponeMinutes: null }, "I found " + target.title + " and prepared the change below.", target) };
  }

  const actionIntent = /\b(?:move|shift|push|reschedule|postpone|change|update|edit|set|make|cancel|call off|complete|finish(?:ed)?|mark done|mark .* done|add (?:a )?note to)\b/.test(lower);
  if (actionIntent) {
    const resolved = resolveScheduleItemReference(normalized, conversationContext);
    if (!resolved.item) {
      if (resolved.matches.length > 1) return { handled: true, clarification: "I found more than one possible match. Which one do you mean?", matches: resolved.matches, choices: resolved.matches.map(item => ["target:" + item.id, item.title + " · " + (item.date ? formatDateLabel(item.date) : "Date not set") + " · " + (item.start ? formatTime(item.start) : "Time not set")]), pending: { intent: "natural_edit_target", knownFields: { rawMessage: normalized, candidateIds: JSON.stringify(resolved.matches.map(item => item.id)) }, missingFields: ["target"] } };
      if (resolved.matches.length === 1) return { handled: true, clarification: "I found " + resolved.matches[0].title + ". Is that the item you mean?", matches: resolved.matches, choices: [["target:" + resolved.matches[0].id, resolved.matches[0].title + " · " + (resolved.matches[0].date ? formatDateLabel(resolved.matches[0].date) : "Date not set") + " · " + (resolved.matches[0].start ? formatTime(resolved.matches[0].start) : "Time not set")]], pending: { intent: "natural_edit_target", knownFields: { rawMessage: normalized, candidateIds: JSON.stringify(resolved.matches.map(item => item.id)) }, missingFields: ["target"] } };
      if (/\b(?:it|that|this one|the same one|first one|second one|third one)\b/.test(lower) || actionIntent) return { handled: true, clarification: "I couldn’t find that schedule item." };
      return { handled: false };
    }
    const target = resolved.item;
    if (/\b(?:cancel|call off)\b/.test(lower)) return { handled: true, proposal: buildNaturalActionProposal({ type: "cancel_item", targetId: target.id, item: null, changes: null, postponeMinutes: null }, `Cancel ${target.title}? Its history will be preserved.`, target) };
    if (/\b(?:complete|finish|mark .* done|done with)\b/.test(lower)) return { handled: true, proposal: buildNaturalActionProposal({ type: "complete_item", targetId: target.id, item: null, changes: null, postponeMinutes: null }, `Mark ${target.title} as completed?`, target) };
    if (time.ambiguous) return { handled: true, clarification: "Do you mean 5:00 AM or 5:00 PM?", choices: [["am", "5:00 AM"], ["pm", "5:00 PM"]], pending: { intent: "natural_edit_time", knownFields: { targetId: target.id, rawMessage: normalized }, missingFields: ["time_period"] } };
    const changes = {};
    if (date.source !== "missing") changes.date = date.date;
    const durationChange = extractDurationChange(normalized);
    if (!time.start && durationChange && target.start) {
      const oldStart = Number(target.start.slice(0, 2)) * 60 + Number(target.start.slice(3));
      const dayOffset = durationChange.kind === "shift" ? Math.floor((oldStart + durationChange.minutes) / 1440) : 0;
      const newStart = durationChange.kind === "shift" ? oldStart + durationChange.minutes - dayOffset * 1440 : oldStart;
      const oldEnd = target.end ? Number(target.end.slice(0, 2)) * 60 + Number(target.end.slice(3)) : null;
      const newEnd = oldEnd == null ? null : durationChange.kind === "shift" ? oldEnd + durationChange.minutes - dayOffset * 1440 : newStart + durationChange.minutes;
      if (newStart < 0 || newStart >= 1440 || newEnd != null && (newEnd >= 1440 || newEnd <= newStart)) return { handled: true, clarification: "That change would cross midnight. What date should I use?" };
      changes.start = minutesToTime(newStart);
      if (newEnd != null) changes.end = minutesToTime(newEnd);
      if (dayOffset && target.date) changes.date = shiftIsoDate(target.date, dayOffset);
    }
    if (time.start) {
      changes.start = time.start;
      if (time.end) changes.end = time.end;
      else if (target.start && target.end) {
        const oldDuration = Number(target.end.slice(0, 2)) * 60 + Number(target.end.slice(3)) - Number(target.start.slice(0, 2)) * 60 - Number(target.start.slice(3));
        changes.end = minutesToTime(Number(time.start.slice(0, 2)) * 60 + Number(time.start.slice(3)) + oldDuration) || "";
      } else if (target.end) changes.end = target.end;
    }
    const category = inferScheduleCategory(normalized);
    if (/\b(?:category|as|to)\s+(?:personal|health|meetings|music|travel)\b/i.test(normalized) && saGetAvailableCategories().includes(category)) changes.category = category;
    const note = /\b(?:note|saying)\s+(.+)$/i.exec(normalized);
    if (note) changes.notes = note[1].replace(/[.!?]+$/, "").trim();
    const newTitle = /\b(?:change|rename)\s+(?:the\s+)?(?:title|name)\s+(?:to\s+)?(.+)$/i.exec(normalized);
    if (newTitle) changes.title = newTitle[1].trim();
    if (/\bpostpone\b/.test(lower) && !time.start && date.source === "missing" && /\b(?:don't|do not|don't know|unknown|not sure)\b/.test(lower)) {
      Object.assign(changes, { date: null, start: "", end: "", schedulePending: true, status: "postponed" });
    }
    if (!Object.keys(changes).length) return { handled: false };
    changes.schedulePending ??= target.schedulePending === true && !changes.date && !changes.start && !changes.end;
    if (/\bpostpone\b/.test(lower)) {
      const schedule = changes.schedulePending ? { schedulePending: true } : {
        date: changes.date !== undefined ? changes.date : target.date,
        start: changes.start !== undefined ? changes.start : (target.start || ""),
        end: changes.end !== undefined ? changes.end : (target.end || ""),
        schedulePending: false
      };
      return { handled: true, proposal: buildNaturalActionProposal({ type: "postpone_item", targetId: target.id, item: null, changes: null, schedule, postponeMinutes: null }, "I found " + target.title + " and prepared the postponement below.", target) };
    }
    const updated = { ...target, ...changes };
    return { handled: true, proposal: buildNaturalActionProposal({ type: "update_item", targetId: target.id, item: null, changes, postponeMinutes: null }, `I found ${target.title} and prepared the change below.`, target), proposedItem: updated };
  }

  if (!creationIntent) return { handled: false };
  const typeInfo = inferScheduleType(normalized, recurrence, Boolean(time.start || time.end));
  const title = extractScheduleTitle(normalized);
  const confidence = calculateInterpretationConfidence({ intent: "create", title, typeConfidence: typeInfo.confidence, date, time });
  if (confidence < 0.55) return { handled: false, confidence };
  if (title && !/^(?:meeting|appointment|event|activity|task|routine|item|something)$/i.test(title) && typeInfo.confidence < 0.7) {
    return { handled: true, clarification: "What would you like to add?", choices: [["activity", "Activity"], ["task", "Task"], ["routine", "Routine"]], pending: { intent: "natural_create", knownFields: { title, date: date.date, category: inferScheduleCategory(normalized), recurrenceJson: recurrence ? JSON.stringify(recurrence) : "", rawMessage: normalized }, missingFields: ["type"] } };
  }
  if (!title || /^(?:meeting|appointment|event|activity|task|routine|item|something)$/i.test(title)) {
    return { handled: true, clarification: "What should I call it?", pending: { intent: "natural_create", knownFields: { type: typeInfo.type, date: date.date, category: inferScheduleCategory(normalized), recurrenceJson: recurrence ? JSON.stringify(recurrence) : "", rawMessage: normalized }, missingFields: ["title"] } };
  }
  if (time.ambiguous) {
    return { handled: true, clarification: "Do you mean 5:00 AM or 5:00 PM?", choices: [["am", "5:00 AM"], ["pm", "5:00 PM"]], pending: { intent: "natural_create", knownFields: { type: typeInfo.type, title, date: date.date, category: inferScheduleCategory(normalized), recurrenceJson: recurrence ? JSON.stringify(recurrence) : "", rawMessage: normalized }, missingFields: ["time_period"] } };
  }
  const item = { type: typeInfo.type, title, date: date.date, start: time.start || "", end: time.end || "", category: inferScheduleCategory(normalized), notes: "", recurrence, schedulePending: !date.date };
  if (item.schedulePending) { item.date = null; item.start = ""; item.end = ""; }
  return { handled: true, proposal: buildNaturalActionProposal({ type: "create_item", item }, message), response: time.source === "undecided" ? "I’ve added the known details. You can set the time later." : "I’ve structured the item below." };
}

function makeScope(scopeType, extra = {}) {
  const today = kampalaToday();
  const scope = { scopeType, startDate: null, endDate: null, statuses: ["upcoming", "in-progress", "postponed", "overdue", "awaiting-check-in"], itemTypes: [], categories: [], titleQuery: null, includeCompleted: false, includeCancelled: false, ...extra };
  if (scopeType === "today") scope.startDate = scope.endDate = today;
  if (scopeType === "tomorrow") scope.startDate = scope.endDate = shiftIsoDate(today, 1);
  if (scopeType === "specific_date" && scope.startDate) scope.endDate = scope.startDate;
  if (scopeType === "current_week" || scopeType === "next_week") {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const start = shiftIsoDate(today, -((weekday + 6) % 7) + (scopeType === "next_week" ? 7 : 0));
    scope.startDate = start; scope.endDate = shiftIsoDate(start, 6);
  }
  if (scopeType === "current_month") { scope.startDate = today.slice(0, 7) + "-01"; const [year, month] = today.split("-").map(Number); scope.endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); }
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

async function presentBulkProposal(type, scope, selected, message) {
  if (!selected.length) { pendingOperation = null; pendingClarification = null; savePlanningContext(); await appendAssistantWithReveal({ role: "assistant", text: "I couldn't find items in that scope." }); return; }
  if (selected.length > 450) { pendingOperation = null; pendingClarification = null; savePlanningContext(); await appendAssistantWithReveal({ role: "assistant", text: "That scope is too large for one safe batch. Narrow the date range or item type first." }); return; }
  currentProposal = createTrustedBulkProposal(type, scope, selected, message);
  currentProposal = registerScheduleProposal(currentProposal);
  await appendAssistantWithReveal(makeProposalSummaryEntry(currentProposal, message, selected.map(item => item.id)));
  await renderProposal(currentProposal, { reveal: true });
}

function createTrustedBulkProposal(type, scope, selected, message) {
  const proposalId = crypto.randomUUID();
  const targetIds = Object.freeze(selected.map(item => item.id));
  const frozenScope = Object.freeze({ ...scope, statuses: Object.freeze([...(scope.statuses || [])]), itemTypes: Object.freeze([...(scope.itemTypes || [])]), categories: Object.freeze([...(scope.categories || [])]) });
  const bulkAction = Object.freeze({ type, scope: frozenScope, targetIds, affectedCount: targetIds.length, items: Object.freeze(selected.map(item => Object.freeze({ ...item }))) });
  currentProposal = registerScheduleProposal({ id: proposalId, bulkAction, confirmationSnapshot: Object.freeze({ proposalId, targetIds: Object.freeze([...targetIds]), scope: frozenScope }), lifecycle: "awaiting_confirmation", message, source: "application" });
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

async function proposeDuplicateCleanup(pair, newStart) {
  const sorted = [...pair].sort((a, b) => (a.createdAt?.toMillis?.() ?? new Date(a.createdAt || 0).getTime()) - (b.createdAt?.toMillis?.() ?? new Date(b.createdAt || 0).getTime()));
  const keep = sorted[0], remove = sorted[1];
  const duration = Number(keep.end.slice(0, 2)) * 60 + Number(keep.end.slice(3)) - Number(keep.start.slice(0, 2)) * 60 - Number(keep.start.slice(3));
  const endMinutes = newStart ? Number(newStart.slice(0, 2)) * 60 + Number(newStart.slice(3)) + duration : 0;
  const end = newStart ? String(Math.floor(endMinutes / 60)).padStart(2, "0") + ":" + String(endMinutes % 60).padStart(2, "0") : null;
  currentProposal = registerScheduleProposal({ id: crypto.randomUUID(), plan: { title: "Clean up duplicate " + keep.title, actions: [
    { type: "delete_item", targetId: remove.id, item: null, changes: null, postponeMinutes: null },
    { type: "reschedule_item", targetId: keep.id, item: null, changes: { start: newStart, end }, postponeMinutes: null }
  ] }, message: "I recommend keeping the older " + keep.title + ", permanently deleting the newer duplicate, and moving the remaining session" + (newStart ? " to " + formatTime(newStart) + " while preserving its duration." : ". Permanent deletion cannot be undone through normal app controls."), source: "local" });
  await appendAssistantWithReveal(makeProposalSummaryEntry(currentProposal, currentProposal.message, [remove.id, keep.id]));
  await renderProposal(currentProposal, { reveal: true });
}

async function routePendingOperation(text) {
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
      await presentBulkProposal(operation, scope, selected, bulkProposalMessage(operation, scope, selected.length));
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
    await presentBulkProposal(operation, scope, selected, bulkProposalMessage(operation, scope, selected.length));
    return true;
  }
  if (pendingOperation.intent === "deduplicate_and_reschedule") {
    const time = parseCommandTime(text);
    if (!time) { appendEntry({ role: "assistant", text: "What time should I move the remaining " + (pendingOperation.title || pendingOperation.knownFields?.title || "item") + " to?" }); return true; }
    const pair = (pendingOperation.targetIds || []).map(id => saFindItemById(id)).filter(Boolean);
    if (pair.length !== 2) { pendingOperation = null; pendingClarification = null; appendEntry({ role: "assistant", text: "Those schedule items have changed. Please describe the duplicate cleanup again." }); savePlanningContext(); return true; }
    pendingOperation = null; pendingClarification = null; savePlanningContext();
    await proposeDuplicateCleanup(pair, time);
    return true;
  }
  return false;
}

async function routeBulkCommand(text) {
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
    await presentBulkProposal("deduplicate_items", scope, remove, `Keep the oldest item in each exact duplicate group and permanently delete ${remove.length} newer duplicate${remove.length === 1 ? "" : "s"}?`); return true;
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
  await presentBulkProposal(op, scope, selected, bulkProposalMessage(op, scope, selected.length));
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
  const requestPendingClarification = pendingClarification;
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

    const structuredGuidedStep = guidedFlow && ["type", "date", "time_range", "category"].includes(guidedFlow.step);
    if (!structuredGuidedStep) appendEntry({ role: "user", text, ...(guidedFlow?.id ? { guidedFlowId: guidedFlow.id, guidedStepId: guidedFlow.step } : {}) });
    showWaitingState();
    await new Promise(resolve => requestAnimationFrame(resolve));

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

    if (activeConversationId === requestConvId && await routePendingOperation(text)) {
      saveConversation();
      return;
    }
    if (activeConversationId === requestConvId && await routeBulkCommand(text)) {
      saveConversation();
      return;
    }

    const recallContext = await getRecallContext(text);
    if (recallContext) {
      const normalizedRecallText = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const recallItems = saGetRelevantItemsForContext(text, 20).filter(item => item.title && normalizedRecallText.includes(item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()));
      recallItems.forEach(item => rememberScheduleEntity(item, "recalled", [item.title, "that", "it"]));
      if (recallItems.length && activeConversationId === requestConvId) await firebaseStore.saveAssistantState({ activeConversationId: requestConvId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction });
    }
    const classification = recallContext ? "analytical_query" : classifyRequest(text);

    let result;

    if (classification === "deterministic_query") {
      result = handleDeterministicQuery(text);
      if (result) {
        const resultIds = [...new Set((result.items || []).flatMap(row => items.filter(item => item.title === row.title && (!row.date || item.date === row.date)).map(item => item.id)))];
        if (resultIds.length && activeConversationId === requestConvId) {
          referencedSets = [...referencedSets.filter(set => set.alias !== "last result"), { alias: "last result", targetIds: resultIds, updatedAt: new Date().toISOString() }].slice(-5);
          await firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction });
        }
        await appendAssistantWithReveal({ role: "assistant", text: result.text, items: result.items || [], referencedItemIds: resultIds }, requestConvId);
        if (result.proposal || result.clarification) {
          handleProposalOrClarification(result, text);
        }
        saveConversation();
        return;
      }
    }

    const naturalResult = processNaturalScheduleCommand(text, { pendingClarification: requestPendingClarification });
    if (naturalResult.handled) {
      if (naturalResult.clarification) {
        if (activeConversationId === requestConvId) {
          pendingClarification = naturalResult.pending || { intent: "natural_schedule", knownFields: {}, missingFields: ["target"] };
          await firebaseStore.saveAssistantState({ activeConversationId: requestConvId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction });
        }
        await appendAssistantWithReveal({ role: "assistant", text: naturalResult.clarification, items: [] }, requestConvId);
        if (activeConversationId === requestConvId && naturalResult.choices?.length) await renderNaturalChoiceControls(naturalResult.choices);
        if (activeConversationId === requestConvId && naturalResult.matches?.length) {
          const matchingIds = naturalResult.matches.map(item => item.id);
          referencedSets = [...referencedSets.filter(set => set.alias !== "last result"), { alias: "last result", targetIds: matchingIds, updatedAt: new Date().toISOString() }].slice(-5);
          await firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction });
        }
        saveConversation();
        return;
      }
      if (naturalResult.proposal) {
        const proposal = registerScheduleProposal(naturalResult.proposal, requestConvId);
        if (activeConversationId === requestConvId) { pendingClarification = null; currentProposal = proposal; }
        const proposalText = naturalResult.response || proposal.message;
        const targetIds = proposal.action.targetId ? [proposal.action.targetId] : [];
        await appendAssistantWithReveal(makeProposalSummaryEntry(proposal, proposalText, targetIds), requestConvId);
        if (activeConversationId === requestConvId) await renderProposal(proposal, { reveal: true });
        saveConversation();
        return;
      }
    }

    if (activeConversationId === requestConvId) currentProposal = null;

    if (classification === "direct_interface_action") {
      const directResult = handleDirectInterfaceAction(text);
      if (directResult.proposal) {
        const proposal = registerScheduleProposal(directResult.proposal, requestConvId);
        if (activeConversationId === requestConvId) currentProposal = proposal;
        await appendAssistantWithReveal(makeProposalSummaryEntry(proposal, directResult.proposal.message), requestConvId);
        if (activeConversationId === requestConvId) await renderProposal(proposal, { reveal: true });
        saveConversation();
        return;
      }
      if (directResult.clarification) {
        pendingClarification = { intent: "unknown", knownFields: {}, missingFields: ["target"] };
      await appendAssistantWithReveal({ role: "assistant", text: directResult.clarification }, requestConvId);
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
          appendEntry({ role: "assistant", text: "The schedule assistant is temporarily busy. Please try again." });
        }
        return;
      }

      result = processGeminiResponse(geminiResponse);

      if (result.proposal) {
        currentProposal = registerScheduleProposal(result.proposal, requestConvId);
        const explanation = result.message || "Here's a proposed action.";
        const entry = makeProposalSummaryEntry(currentProposal, explanation);
        if (activeConversationId === requestConvId) {
          await appendAssistantWithReveal(entry, requestConvId);
          if (activeConversationId === requestConvId) {
            await renderProposal(currentProposal, { reveal: true });
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
          await appendAssistantWithReveal(entry, requestConvId);
        } else {
          saveEntryForConversation(requestConvId, entry);
        }
        saveConversation();
        return;
      }

      const entry = { role: "assistant", text: result.message, items: result.items || [] };
      if (activeConversationId === requestConvId) {
        await appendAssistantWithReveal(entry, requestConvId);
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
      appendEntry({ role: "assistant", text: "An error occurred while processing your request. Please try again." });
    }
  } finally {
    sendInProgress = false;
    updateSendButtonState();
  }
}

function handleProposalOrClarification(result, message) {
}

function scheduleCompletionPayload(item) {
  return {
    title: item.title,
    date: item.date || null,
    start: item.start || null,
    end: item.end || null,
    category: item.category || "Personal",
    notes: item.notes || "",
    recurrence: item.recurrence || null,
    status: item.status || "upcoming"
  };
}

function findProposalConflict(action, proposalId) {
  let candidate;
  if (action.type === "create_item") candidate = { ...action.item, id: `proposal:${proposalId}` };
  else if (["update_item", "reschedule_item"].includes(action.type)) {
    const original = saFindItemById(action.targetId);
    if (!original) return null;
    candidate = { ...original, ...(action.changes || {}), id: original.id };
  } else if (action.type === "postpone_item") {
    const original = saFindItemById(action.targetId);
    if (!original) return null;
    candidate = { ...original, ...(action.schedule || {}), id: original.id };
  } else return null;
  if (candidate.type !== "activity" || !candidate.date || !candidate.start || !candidate.end) return null;
  const pool = action.type === "create_item" ? [...items, candidate] : [...items.filter(item => item.id !== candidate.id), candidate];
  const conflict = saDetectConflictsForDate(candidate.date, pool).find(entry => entry.firstItemId === candidate.id || entry.secondItemId === candidate.id);
  return conflict ? { items: [conflict.firstTitle, conflict.secondTitle], date: conflict.date, start: conflict.overlapStart, end: conflict.overlapEnd } : null;
}

async function confirmScheduleProposal(proposalId, conversationId) {
  const proposal = scheduleProposalRegistry.get(proposalId) || (currentProposal?.id === proposalId ? currentProposal : null);
  if (!proposal || !proposal.action || proposal.conversationId !== conversationId) return { success: false, error: "Proposal is no longer available." };
  if (proposal.confirmationState === "resolved") return proposal.confirmationResult || { success: true, item: proposal.resultItem || null, alreadyResolved: true };
  if (proposal.confirmationState === "confirming") return { success: false, alreadyConfirming: true };
  if (!["pending", "failed"].includes(proposal.confirmationState)) return { success: false, error: "Proposal is no longer available." };

  await persistScheduleProposalState(proposal, "confirming").catch(() => console.warn("proposal_confirmation_failed"));
  const action = proposal.action;
  let writeSucceeded = false;
  let successResult = null;
  let successResponse = "Your schedule item has been updated.";
  if (activeConversationId === conversationId) {
    assistantEls.conversation.querySelectorAll(`.proposal[data-proposal-id="${proposalId}"] button`).forEach(button => { button.disabled = true; button.setAttribute("aria-disabled", "true"); });
    if (!waitingEl) showWaitingState();
    pendingOperation = { intent: "schedule_proposal", state: "executing", proposalId, operation: proposal.operation, targetIds: action.targetId ? [action.targetId] : [] };
    await firebaseStore.saveAssistantState({ activeConversationId: conversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction }).catch(showPersistenceFailure);
  }

  try {
    let result;
    let responseText;
    let operation;
    if (action.type === "create_item") {
      const sourceItem = action.item || {};
      const normalized = {
        id: proposalId,
        type: sourceItem.type,
        title: typeof sourceItem.title === "string" ? sourceItem.title.trim() : "",
        date: sourceItem.schedulePending === true ? null : (sourceItem.date || null),
        schedulePending: sourceItem.schedulePending === true,
        start: sourceItem.schedulePending === true ? "" : (sourceItem.start || ""),
        end: sourceItem.schedulePending === true ? "" : (sourceItem.end || ""),
        category: sourceItem.category || "Personal",
        notes: typeof sourceItem.notes === "string" ? sourceItem.notes.trim() : "",
        recurrence: sourceItem.recurrence || null
      };
      const validationError = scheduleValidateItem(normalized);
      if (validationError) { console.warn("natural_proposal_validation_failed"); throw new Error(validationError); }
      action.item = normalized;
      proposal.conflict = findProposalConflict(action, proposalId);
      result = await saCreateItem(normalized);
      operation = "schedule.create";
      responseText = "Added to your schedule.";
    } else if (["update_item", "reschedule_item"].includes(action.type)) {
      const target = saFindItemById(action.targetId);
      if (!target) throw new Error("Item no longer exists.");
      const changes = { ...(action.changes || {}) };
      if (Object.prototype.hasOwnProperty.call(changes, "date")) changes.date = changes.schedulePending ? null : (changes.date || null);
      if (Object.prototype.hasOwnProperty.call(changes, "start")) changes.start = changes.start || "";
      if (Object.prototype.hasOwnProperty.call(changes, "end")) changes.end = changes.end || "";
      const candidate = { ...target, ...changes };
      const validationError = scheduleValidateItem(candidate);
      if (validationError) { console.warn("natural_proposal_validation_failed"); throw new Error(validationError); }
      action.changes = changes;
      proposal.conflict = findProposalConflict(action, proposalId);
      result = action.type === "reschedule_item"
        ? await saRescheduleItem(action.targetId, candidate.date, candidate.start, candidate.end)
        : await saUpdateItem(action.targetId, changes);
      operation = "schedule.update";
      responseText = "Your schedule item has been updated.";
    } else if (action.type === "postpone_item") {
      result = await saPostponeItem(action.targetId, action.schedule || action.postponeMinutes || 15);
      operation = "schedule.postpone";
      responseText = "Your schedule item has been postponed.";
    } else if (action.type === "cancel_item") {
      result = await saCancelItem(action.targetId);
      operation = "schedule.cancel";
      responseText = "Your schedule item has been cancelled.";
    } else if (action.type === "complete_item") {
      result = await saCompleteItem(action.targetId);
      operation = "schedule.complete";
      responseText = "Your schedule item has been marked complete.";
    } else return { success: false, unsupported: true };

    if (!result?.success || !result.item) throw new Error(result?.error || "Schedule save failed.");
    writeSucceeded = true;
    await persistScheduleProposalState(proposal, "resolved").catch(() => console.warn("proposal_confirmation_failed"));
    proposal.resultItem = result.item;
    proposal.confirmationResult = { success: true, item: result.item };
    successResult = result;
    successResponse = responseText;
    lastConfirmedAction = { type: operation, targetId: result.item.id, proposalId, confirmedAt: new Date().toISOString() };
    if (activeConversationId === conversationId) {
      const proposalElement = assistantEls.conversation.querySelector(`.proposal[data-proposal-id="${proposalId}"]`);
      proposalElement?.remove();
      if (currentProposal?.id === proposalId) currentProposal = null;
      conversation.forEach(entry => { if (entry.kind === "proposal_summary" && entry.resolved === false) entry.resolved = true; });
      rememberScheduleEntity(result.item, action.type === "create_item" ? "created" : action.type === "update_item" || action.type === "reschedule_item" ? "updated" : action.type === "postpone_item" ? "postponed" : action.type === "cancel_item" ? "cancelled" : "completed", ["that", "it", result.item.title]);
    }
    await firebaseStore.resolveUnresolvedProposals(conversationId).catch(() => {});
    if (activeConversationId === conversationId) {
      pendingOperation = null;
      await firebaseStore.saveAssistantState({ activeConversationId: conversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation: null, referencedSets, lastConfirmedAction }).catch(showPersistenceFailure);
      const completion = { id: proposal.completionEntryId || crypto.randomUUID(), role: "assistant", kind: "schedule_completion", text: responseText, scheduleItem: scheduleCompletionPayload(result.item), referencedItemIds: [result.item.id] };
      proposal.completionEntryId = completion.id;
      await appendAssistantWithReveal(completion, conversationId);
      assistantEls.conversation.lastElementChild?.focus({ preventScroll: true });
      await persistenceQueue;
      await firebaseStore.updateConversationSummary(conversationId, conversationSummary("active")).catch(showPersistenceFailure);
    } else {
      const completion = { id: proposal.completionEntryId || crypto.randomUUID(), role: "assistant", kind: "schedule_completion", text: responseText, scheduleItem: scheduleCompletionPayload(result.item), referencedItemIds: [result.item.id] };
      proposal.completionEntryId = completion.id;
      saveEntryForConversation(conversationId, completion);
    }
    return proposal.confirmationResult;
  } catch (error) {
    if (writeSucceeded && successResult?.item) {
      proposal.confirmationState = "resolved";
      proposal.lifecycle = "resolved";
      proposal.confirmationResult ||= { success: true, item: successResult.item };
      if (activeConversationId === conversationId) {
        assistantEls.conversation.querySelector(`.proposal[data-proposal-id="${proposalId}"]`)?.remove();
        if (currentProposal?.id === proposalId) currentProposal = null;
        if (!conversation.some(entry => entry.id === proposal.completionEntryId)) {
          const completion = { id: proposal.completionEntryId || crypto.randomUUID(), role: "assistant", kind: "schedule_completion", text: successResponse, scheduleItem: scheduleCompletionPayload(successResult.item), referencedItemIds: [successResult.item.id] };
          proposal.completionEntryId = completion.id;
          await appendAssistantWithReveal(completion, conversationId).catch(() => {});
        }
      } else if (!proposal.completionEntryId) {
        const completion = { id: crypto.randomUUID(), role: "assistant", kind: "schedule_completion", text: successResponse, scheduleItem: scheduleCompletionPayload(successResult.item), referencedItemIds: [successResult.item.id] };
        proposal.completionEntryId = completion.id;
        saveEntryForConversation(conversationId, completion);
      }
      return proposal.confirmationResult;
    }
    await persistScheduleProposalState(proposal, "failed").catch(() => console.warn("proposal_confirmation_failed"));
    proposal.confirming = false;
    console.warn("proposal_confirmation_failed");
    if (activeConversationId === conversationId) {
      pendingOperation = { intent: "schedule_proposal", state: "failed", proposalId, operation: proposal.operation, targetIds: action.targetId ? [action.targetId] : [] };
      await firebaseStore.saveAssistantState({ activeConversationId: conversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction }).catch(showPersistenceFailure);
      const proposalElement = assistantEls.conversation.querySelector(`.proposal[data-proposal-id="${proposalId}"]`);
      proposalElement?.querySelectorAll("button").forEach(button => { button.disabled = false; button.removeAttribute("aria-disabled"); });
      await appendAssistantWithReveal({ role: "assistant", text: "The schedule item could not be saved. Try again." }, conversationId);
      proposalElement?.querySelector('[data-action="confirm"]')?.focus({ preventScroll: true });
    } else {
      saveEntryForConversation(conversationId, { role: "assistant", text: "The schedule item could not be saved. Try again." });
    }
    return { success: false, error: "The schedule item could not be saved. Try again." };
  } finally {
    if (activeConversationId === conversationId && waitingEl && proposal.confirmationState !== "confirming") removeWaitingState();
  }
}

async function confirmProposal() {
  if (!currentProposal) return;
  if (currentProposal.action && ["create_item", "update_item", "reschedule_item", "postpone_item", "cancel_item", "complete_item"].includes(currentProposal.action.type)) {
    await confirmScheduleProposal(currentProposal.id, currentProposal.conversationId || activeConversationId);
    return;
  }
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

  const proposal = currentProposal;
  currentProposal.lifecycle = "cancelled";
  currentProposal = null;
  await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
  conversation.forEach(entry => { if (entry.kind === "proposal_summary") entry.resolved = true; });

  if (proposal.action?.type === "update_item" && proposal.action.targetId) {
    window.startAssistantScheduleEdit(proposal.action.targetId, { proposedChanges: proposal.action.changes || {} });
    return;
  }

  if (proposal.action?.item) {
    const item = proposal.action.item;
    if (proposal.action.type === "update" || proposal.action.type === "reschedule") {
      const targetId = proposal.action.targetItemId || item.id;
      if (targetId) {
        window.startAssistantScheduleEdit(targetId, {
          proposedDate: item.date,
          proposedStart: item.start,
          proposedEnd: item.end
        });
        return;
      }
    }
    window.startAssistantScheduleCreation({
      itemType: item.type || "activity",
      title: item.title || "",
      date: item.date || "",
      start: item.start || "",
      end: item.end || "",
      category: item.category || "Personal",
      notes: item.notes || ""
    });
  }
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

function showProcessingError(message) {
  const proposal = currentProposal;
  if (proposal) proposal.confirming = false;
  assistantEls.conversation.querySelector(".proposal")?.remove();
  appendAssistantWithReveal({ role: "assistant", text: message }).then(() => {
    if (proposal && currentProposal?.id === proposal.id) renderProposal(proposal, { reveal: true });
  });
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
function quickQuestionRows(occurrences, grouped = false) {
  return [...occurrences].sort((a, b) => grouped ? a.effectiveDate.localeCompare(b.effectiveDate) || compareScheduleOccurrences(a, b) : compareScheduleOccurrences(a, b)).map(item => ({
    ...(grouped ? { date: item.effectiveDate } : {}),
    time: item.start ? `${formatKampalaTime(item.start)}${item.end ? ` – ${formatKampalaTime(item.end)}` : ""}` : "Anytime",
    title: item.title,
    status: formatScheduleStatus(item.status)
  }));
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
  return { text: "Here is your schedule for this week.", items: quickQuestionRows(range, true) };
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
  return { text: `You have ${range.length} scheduled occurrence${range.length === 1 ? "" : "s"} this month${range.length > visible.length ? `; showing the first ${visible.length}` : ""}.`, items: quickQuestionRows(visible, true) };
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
  const time = item.start ? `${formatKampalaTime(item.start)}${item.end ? ` – ${formatKampalaTime(item.end)}` : ""}` : "Anytime";
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

const GUIDED_ADD_INITIAL_VALUES = Object.freeze({ itemType: null, title: null, date: null, dateDraft: null, timeDraft: null, start: null, end: null, category: null, notes: "", recurrence: null, weekdays: [] });
let guidedSaveInProgress = false;
let pendingQuickQuestionId = null;
let guidedDraftSaveTimer = null;
function queueGuidedDraftSave() { clearTimeout(guidedDraftSaveTimer); guidedDraftSaveTimer = setTimeout(() => saveGuidedFlow(), 250); }

function guidedSteps(flow = guidedFlow) {
  const type = flow?.values?.itemType;
  const steps = ["type", "title", "date"];
  if (type === "activity" || type === "routine") steps.push("time_range");
  if (type === "routine") {
    steps.push("frequency", "interval");
    if (flow.values.recurrence?.frequency === "weekly") steps.push("weekdays");
  }
  steps.push("category", "notes", "summary");
  return steps;
}
function pruneGuidedValues(values, step) {
  const clean = { ...values, recurrence: values.recurrence ? { ...values.recurrence, days: [...(values.recurrence.days || [])] } : null, weekdays: [...(values.weekdays || [])] };
  const rank = { type: 0, title: 1, date: 2, time_range: 3, frequency: 4, interval: 5, weekdays: 6, category: 7, notes: 8, summary: 9 };
  const keep = rank[step] ?? 0;
  if (keep < rank.title) clean.title = null;
  if (keep < rank.date) clean.date = null;
  if (keep < rank.date || step === "date") clean.dateDraft = null;
  if (keep < rank.time_range) { clean.start = null; clean.end = null; }
  if (keep < rank.time_range || step === "time_range") clean.timeDraft = null;
  if (keep < rank.frequency) { clean.recurrence = null; clean.weekdays = []; }
  if (keep < rank.category) clean.category = null;
  if (keep < rank.notes) clean.notes = "";
  return clean;
}
function guidedPrompt(step, flow = guidedFlow) {
  const type = flow?.values?.itemType;
  if (step === "type") return "What would you like to add?";
  if (step === "title") return type === "activity" ? "What is the activity called?" : type === "routine" ? "What is the routine called?" : "What is the task called?";
  if (step === "date") return type === "routine" ? "What date should this routine start?" : "What date should it be scheduled for?";
  if (step === "time_range") return type === "routine" ? "What time should the routine start and end?" : "What time should the activity start and end?";
  if (step === "frequency") return "How often should this routine repeat?";
  if (step === "interval") return `How often should it repeat? Enter a positive number of ${flow.values.recurrence.frequency === "daily" ? "days" : flow.values.recurrence.frequency === "weekly" ? "weeks" : "months"}.`;
  if (step === "weekdays") return "Which days should this routine repeat? Select one or more days, then continue.";
  if (step === "category") return type === "task" ? "Choose a category, or skip this optional step." : "Choose a category.";
  if (step === "notes") return "Would you like to add a note? Type it here or skip this step.";
  if (step === "edit_choice") return "What would you like to change?";
  return "Review the schedule details below.";
}
async function guidedAppendAssistant(text, { wait = false, showControls = true, kind } = {}) {
  const conversationId = activeConversationId;
  const startedAt = performance.now();
  if (wait && activeConversationId === conversationId) {
    showWaitingState();
    await new Promise(resolve => requestAnimationFrame(resolve));
    await waitForPresentation(startedAt, 350);
  }
  await appendAssistantWithReveal({ role: "assistant", text, ...(kind ? { kind } : {}), ...(guidedFlow?.id ? { guidedFlowId: guidedFlow.id, guidedStepId: guidedFlow.step } : {}) }, conversationId);
  if (kind === "guided_completion" && activeConversationId === conversationId) assistantEls.conversation?.lastElementChild?.focus({ preventScroll: true });
  if (showControls && activeConversationId === conversationId && guidedFlow) renderGuidedControls();
}

let scheduleCreationInProgress = false;

async function startAssistantScheduleCreation(prefilledValues = {}) {
  if (scheduleCreationInProgress) return;
  scheduleCreationInProgress = true;
  try {
    activeRevealController?.abort();
    removeWaitingState();
    closeQuickQuestions();
    document.querySelectorAll("dialog[open]").forEach(d => {
      if (typeof d.close === "function") d.close();
    });

    if (typeof window.setView === "function") {
      window.setView("assistant");
    }

    let pendingConversationId = null;
    try { pendingConversationId = sessionStorage.getItem(GUIDED_LAUNCHER_PENDING_KEY); } catch {}
    const canReusePendingConversation = Boolean(activeConversationId && pendingConversationId === activeConversationId && conversation.length === 0 && !guidedFlow && !currentProposal);
    if (!canReusePendingConversation) {
      if (activeConversationId) {
        await saveGuidedFlow();
        if (assistantEls.input) composerDrafts.set(activeConversationId, assistantEls.input.value);
        await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
        await firebaseStore.updateConversationSummary(activeConversationId, { status: "archived" }).catch(() => {});
      }

      const newId = await firebaseStore.createConversation({ title: "New schedule item", status: "active" });
      activeConversationId = newId;
      try { sessionStorage.setItem(GUIDED_LAUNCHER_PENDING_KEY, newId); } catch {}
      conversation = [];
      guidedFlow = null;
      currentProposal = null;
      pendingClarification = null;
      lastConfirmedAction = null;
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
      if (assistantEls.input) assistantEls.input.value = "";
      updateComposerHeight();
      updateSendButtonState();
      loadDrawerConversations().catch(() => {});
    }

    guidedCompletedFlow = null;
    guidedFlow = {
      id: crypto.randomUUID(),
      type: "create_schedule_item",
      step: "type",
      values: {
        ...GUIDED_ADD_INITIAL_VALUES,
        recurrence: null,
        weekdays: [],
        ...(prefilledValues || {})
      }
    };
    updateAssistantEmptyState();
    await saveGuidedFlow();
    await guidedAppendAssistant(guidedPrompt("type"));
    try { if (sessionStorage.getItem(GUIDED_LAUNCHER_PENDING_KEY) === activeConversationId) sessionStorage.removeItem(GUIDED_LAUNCHER_PENDING_KEY); } catch {}
    assistantEls.conversation?.querySelector("#guidedControls-type button")?.focus({ preventScroll: true });
  } catch (error) {
    console.error("startAssistantScheduleCreation failed", error);
    if (assistantEls.saveNotice && assistantEls.saveText) {
      assistantEls.saveText.textContent = "A new conversation could not be started. Try again.";
      assistantEls.saveNotice.hidden = false;
      setTimeout(() => { if (assistantEls.saveNotice) assistantEls.saveNotice.hidden = true; }, 4000);
    }
  } finally {
    scheduleCreationInProgress = false;
  }
}

async function startAssistantScheduleEdit(itemId, options = {}) {
  if (scheduleCreationInProgress) return;
  const item = items.find(candidate => candidate.id === itemId);
  if (!item) return;

  scheduleCreationInProgress = true;
  try {
    activeRevealController?.abort();
    removeWaitingState();
    closeQuickQuestions();
    document.querySelectorAll("dialog[open]").forEach(d => {
      if (typeof d.close === "function") d.close();
    });

    if (typeof window.setView === "function") {
      window.setView("assistant");
    }

    const title = `Edit ${item.title || "item"}`;
    if (activeConversationId) {
      await saveGuidedFlow();
      if (assistantEls.input) composerDrafts.set(activeConversationId, assistantEls.input.value);
      await firebaseStore.resolveUnresolvedProposals(activeConversationId).catch(() => {});
      await firebaseStore.updateConversationSummary(activeConversationId, { status: "archived" }).catch(() => {});
    }

    const newId = await firebaseStore.createConversation({ title, status: "active" });
    activeConversationId = newId;
    conversation = [];
    guidedFlow = null;
    currentProposal = null;
    pendingClarification = null;
    lastConfirmedAction = null;
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
    if (assistantEls.input) assistantEls.input.value = "";
    updateComposerHeight();
    updateSendButtonState();
    loadDrawerConversations().catch(() => {});

    const proposedChanges = options?.proposedChanges && typeof options.proposedChanges === "object" ? options.proposedChanges : {};
    const proposedDate = Object.prototype.hasOwnProperty.call(proposedChanges, "date") ? (proposedChanges.date || "") : (options?.proposedDate || item.date || "");
    const proposedStart = Object.prototype.hasOwnProperty.call(proposedChanges, "start") ? (proposedChanges.start || null) : (options?.proposedStart !== undefined && options.proposedStart !== "" ? options.proposedStart : (item.start || null));
    const proposedEnd = Object.prototype.hasOwnProperty.call(proposedChanges, "end") ? (proposedChanges.end || null) : (options?.proposedEnd !== undefined && options.proposedEnd !== "" ? options.proposedEnd : (item.end || null));
    const hasProposedChanges = Object.keys(proposedChanges).length > 0 || Boolean(options?.proposedDate || options?.proposedStart || options?.proposedEnd);
    const step = options?.step || (hasProposedChanges ? "summary" : "edit_choice");

    guidedCompletedFlow = null;
    guidedFlow = {
      id: crypto.randomUUID(),
      type: "edit_schedule_item",
      itemId: item.id,
      originalItem: { ...item },
      step,
      values: {
        itemType: proposedChanges.type || item.type,
        title: Object.prototype.hasOwnProperty.call(proposedChanges, "title") ? proposedChanges.title : item.title,
        date: proposedDate,
        dateDraft: null,
        timeDraft: null,
        start: proposedStart,
        end: proposedEnd,
        category: proposedChanges.category || item.category || "Personal",
        notes: Object.prototype.hasOwnProperty.call(proposedChanges, "notes") ? proposedChanges.notes : (item.notes || ""),
        recurrence: proposedChanges.recurrence || (item.recurrence ? JSON.parse(JSON.stringify(item.recurrence)) : null),
        weekdays: (proposedChanges.recurrence || item.recurrence)?.days ? [...(proposedChanges.recurrence || item.recurrence).days] : [],
        schedulePending: proposedChanges.schedulePending ?? item.schedulePending === true,
        status: proposedChanges.status || item.status
      }
    };

    updateAssistantEmptyState();
    await saveGuidedFlow();
    await guidedAppendAssistant(guidedPrompt(step));
    assistantEls.conversation?.querySelector(`#guidedControls-${step} button`)?.focus({ preventScroll: true });
  } catch (error) {
    console.error("startAssistantScheduleEdit failed", error);
    if (assistantEls.saveNotice && assistantEls.saveText) {
      assistantEls.saveText.textContent = "A new conversation could not be started. Try again.";
      assistantEls.saveNotice.hidden = false;
      setTimeout(() => { if (assistantEls.saveNotice) assistantEls.saveNotice.hidden = true; }, 4000);
    }
  } finally {
    scheduleCreationInProgress = false;
  }
}

window.startAssistantScheduleCreation = startAssistantScheduleCreation;
window.startAssistantScheduleEdit = startAssistantScheduleEdit;

async function beginGuidedAdd({ logUser = false } = {}) {
  if (logUser) appendEntry({ role: "user", text: "Add something to my schedule." });
  await startAssistantScheduleCreation();
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
function guidedNavButton(label, action, path, tone) {
  const button = guidedControlButton("", action, null, `guided-nav-action guided-nav-${tone}`);
  button.setAttribute("aria-label", label);
  button.title = label;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "path");
  icon.setAttribute("d", path);
  svg.appendChild(icon);
  const text = document.createElement("span");
  text.textContent = label === "Back to previous step" ? "Back" : "Cancel";
  button.append(svg, text);
  return button;
}
function guidedCategoryColor(name) {
  const keys = { Music: "music", Health: "health", Personal: "personal", Meetings: "meetings", Travel: "travel" };
  const key = Object.hasOwn(keys, name) ? keys[name] : keys.Personal;
  return getComputedStyle(document.documentElement).getPropertyValue(`--category-${key}`).trim() || "#14B8A6";
}
function renderGuidedDateControl(parent, value) {
  const form = document.createElement("form");
  form.className = "guided-date-form";
  form.noValidate = true;
  form.dataset.guidedDate = "true";
  const control = document.createElement("div");
  control.className = "date-entry-control";
  const raw = value && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = raw ? new Date(Number(raw[1]), Number(raw[2]) - 1, Number(raw[3])) : null;
  const draft = guidedFlow.values.dateDraft || {};
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const day = document.createElement("input");
  day.className = "date-entry-day"; day.placeholder = "Day"; day.maxLength = 2; day.inputMode = "numeric"; day.setAttribute("aria-label", "Day");
  day.value = draft.day ?? (date ? String(date.getDate()).padStart(2, "0") : "");
  const wrap = document.createElement("div"); wrap.className = "month-entry-wrap";
  const month = document.createElement("input");
  month.className = "date-entry-month"; month.placeholder = "Month"; month.setAttribute("aria-label", "Month"); month.setAttribute("role", "combobox"); month.setAttribute("aria-autocomplete", "list"); month.setAttribute("aria-expanded", "false"); month.autocomplete = "off";
  month.value = draft.month ?? (date ? date.toLocaleString("en", { month: "long" }) : "");
  const list = document.createElement("ul");
  list.id = `guided-month-suggestions-${guidedFlow.id}`; list.className = "month-suggestions"; list.setAttribute("role", "listbox"); list.setAttribute("aria-label", "Month suggestions");
  month.setAttribute("aria-controls", list.id); list.hidden = true; wrap.append(month, list);
  const year = document.createElement("input");
  year.className = "date-entry-year"; year.placeholder = "Year"; year.maxLength = 4; year.inputMode = "numeric"; year.setAttribute("aria-label", "Year");
  year.value = draft.year ?? (date ? String(date.getFullYear()) : "");
  const submit = document.createElement("button");
  submit.type = "submit"; submit.className = "date-entry-go"; submit.setAttribute("aria-label", "Enter date");
  const submitIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); submitIcon.setAttribute("viewBox", "0 0 24 24"); submitIcon.setAttribute("aria-hidden", "true");
  const submitPath = document.createElementNS("http://www.w3.org/2000/svg", "path"); submitPath.setAttribute("d", "M20 5v4a5 5 0 0 1-5 5H5m0 0 5-5m-5 5 5 5"); submitIcon.appendChild(submitPath); submit.appendChild(submitIcon);
  const error = document.createElement("p"); error.className = "date-entry-error"; error.setAttribute("role", "alert"); error.hidden = true;
  control.append(wrap, day, year, submit); form.append(control, error); parent.appendChild(form);

  const clearError = () => { error.hidden = true; error.textContent = ""; };
  const saveDraft = () => { guidedFlow.values.dateDraft = { day: day.value, month: month.value, year: year.value }; queueGuidedDraftSave(); };
  const monthIndex = input => names.findIndex(name => name.toLowerCase() === input.trim().toLowerCase() || name.slice(0, 3).toLowerCase() === input.trim().toLowerCase());
  const selectMonth = index => {
    if (index < 0 || index > 11) return false;
    month.value = names[index];
    month.dataset.monthNumber = String(index + 1);
    list.hidden = true; month.setAttribute("aria-expanded", "false");
    saveDraft(); clearError(); day.focus();
    return true;
  };
  const validateDay = () => /^\d{1,2}$/.test(day.value.trim()) && Number(day.value) >= 1 && Number(day.value) <= 31;
  const goToYear = () => { if (!validateDay()) { error.textContent = "Enter a valid day."; error.hidden = false; return false; } clearError(); year.focus(); return true; };
  const updateSuggestions = () => {
    const query = month.value.trim().toLowerCase();
    const matches = query ? names.map((name, index) => ({ name, index })).filter(item => item.name.toLowerCase().startsWith(query) || item.name.slice(0, 3).toLowerCase().startsWith(query)) : [];
    list.replaceChildren(...matches.map(item => { const option = document.createElement("li"); option.setAttribute("role", "option"); option.setAttribute("aria-selected", "false"); option.dataset.month = String(item.index); option.textContent = item.name; return option; }));
    list.hidden = !list.childElementCount; month.setAttribute("aria-expanded", String(!list.hidden));
    activeMonth = list.hidden ? -1 : 0;
    if (activeMonth >= 0) list.children[activeMonth].setAttribute("aria-selected", "true");
    const exact = monthIndex(month.value);
    if (exact >= 0 && month.value.trim().length >= 3) selectMonth(exact);
  };
  let activeMonth = -1;
  day.addEventListener("input", () => { day.value = day.value.replace(/\D/g, "").slice(0, 2); saveDraft(); clearError(); if (day.value.length === 2 && validateDay()) year.focus(); });
  year.addEventListener("input", () => { year.value = year.value.replace(/\D/g, "").slice(0, 4); saveDraft(); clearError(); });
  month.addEventListener("input", () => { saveDraft(); clearError(); updateSuggestions(); });
  month.addEventListener("keydown", event => {
    event.stopPropagation();
    const options = [...list.children];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (list.hidden || !options.length) return;
      event.preventDefault(); options[activeMonth]?.setAttribute("aria-selected", "false");
      activeMonth = (activeMonth + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[activeMonth].setAttribute("aria-selected", "true");
    } else if (event.key === "Enter") {
      event.preventDefault();
      const exact = monthIndex(month.value);
      if (exact >= 0) selectMonth(exact);
      else if (activeMonth >= 0) selectMonth(Number(options[activeMonth].dataset.month));
      else { error.textContent = "Enter a valid month."; error.hidden = false; }
    } else if (event.key === "Tab") { list.hidden = true; month.setAttribute("aria-expanded", "false"); }
  });
  day.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Enter" || event.key === "ArrowRight") { event.preventDefault(); goToYear(); }
  });
  year.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); form.requestSubmit(submit); } });
  list.addEventListener("pointerdown", event => event.preventDefault());
  list.addEventListener("click", event => { const option = event.target.closest('[role="option"]'); if (option) selectMonth(Number(option.dataset.month)); });
  form.addEventListener("submit", async event => {
    event.preventDefault(); event.stopPropagation();
    const monthNumber = monthIndex(month.value) + 1;
    const dayNumber = Number(day.value.trim());
    const yearNumber = Number(year.value.trim());
    if (!monthNumber) { error.textContent = "Enter a valid month."; error.hidden = false; month.focus(); return; }
    if (!validateDay()) { error.textContent = "Enter a valid day."; error.hidden = false; day.focus(); return; }
    if (!/^\d{4}$/.test(year.value.trim()) || yearNumber < 1900 || yearNumber > 2100) { error.textContent = "Enter a four-digit year."; error.hidden = false; year.focus(); return; }
    const candidate = new Date(yearNumber, monthNumber - 1, dayNumber);
    if (candidate.getFullYear() !== yearNumber || candidate.getMonth() !== monthNumber - 1 || candidate.getDate() !== dayNumber) { error.textContent = "Enter a valid date."; error.hidden = false; day.focus(); return; }
    clearError();
    guidedFlow.values.date = `${yearNumber}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
    guidedFlow.values.schedulePending = false;
    guidedFlow.values.dateDraft = null;
    control.querySelectorAll("input, button").forEach(field => { field.disabled = true; });
    guidedAdvance(); await guidedAskCurrentStep();
  });
}
function renderGuidedTimeControl(parent, start, end) {
  const control = document.createElement("div");
  control.className = "guided-time-control";
  const card = document.createElement("div");
  card.className = "guided-time-range";
  const line = document.createElement("div");
  line.className = "guided-time-line";
  function group(name, value) {
    const [hour24 = "", minute = ""] = (value || "").split(":");
    let hour = Number(hour24);
    const meridiem = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;
    const draft = guidedFlow.values.timeDraft?.[name.toLowerCase()] || {};
    const groupElement = document.createElement("div");
    groupElement.className = `guided-time-group guided-time-${name.toLowerCase()}`;
    groupElement.setAttribute("role", "group");
    groupElement.setAttribute("aria-label", `${name} time`);
    const hourInput = document.createElement("input");
    hourInput.inputMode = "numeric"; hourInput.maxLength = 2; hourInput.placeholder = "HH"; hourInput.setAttribute("aria-label", `${name} hour`);
    hourInput.value = draft.hour ?? (value ? String(hour) : "");
    const minuteInput = document.createElement("input");
    minuteInput.inputMode = "numeric"; minuteInput.maxLength = 2; minuteInput.placeholder = "MM"; minuteInput.setAttribute("aria-label", `${name} minute`);
    minuteInput.value = draft.minute ?? (value ? minute : "");
    const selector = document.createElement("select");
    selector.setAttribute("aria-label", `${name} AM or PM`);
    ["AM", "PM"].forEach(valueName => { const option = document.createElement("option"); option.value = valueName; option.textContent = valueName; selector.appendChild(option); });
    selector.value = draft.meridiem || meridiem;
    groupElement.append(hourInput, minuteInput, selector);
    const save = () => {
      guidedFlow.values.timeDraft ||= {};
      guidedFlow.values.timeDraft[name.toLowerCase()] = { hour: hourInput.value, minute: minuteInput.value, meridiem: selector.value };
      queueGuidedDraftSave();
    };
    [hourInput, minuteInput, selector].forEach(field => { field.addEventListener("input", save); field.addEventListener("change", save); });
    return { element: groupElement, hourInput, minuteInput, selector };
  }
  const startGroup = group("Start", start);
  const separator = document.createElement("span");
  separator.className = "guided-time-separator"; separator.textContent = "to";
  const endGroup = group("End", end);
  const submit = document.createElement("button");
  submit.type = "button"; submit.className = "date-entry-go"; submit.setAttribute("aria-label", "Use entered time range");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", "M20 5v4a5 5 0 0 1-5 5H5m0 0 5-5m-5 5 5 5"); icon.appendChild(path); submit.appendChild(icon);
  const error = document.createElement("p"); error.className = "guided-inline-error"; error.setAttribute("role", "alert"); error.hidden = true;
  line.append(startGroup.element, separator, endGroup.element, submit);
  card.appendChild(line); control.append(card, error); parent.appendChild(control);
  const parse = groupValue => {
    let hour = Number(groupValue.hourInput.value);
    const minute = Number(groupValue.minuteInput.value);
    if (!/^\d{1,2}$/.test(groupValue.hourInput.value) || hour < 1 || hour > 12 || !/^\d{1,2}$/.test(groupValue.minuteInput.value) || minute > 59) return null;
    hour = hour % 12 + (groupValue.selector.value === "PM" ? 12 : 0);
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  };
  submit.addEventListener("click", async () => {
    const startTime = parse(startGroup);
    const endTime = parse(endGroup);
    if (!startTime || !endTime || endTime <= startTime) { error.textContent = "End time must be later than start time."; error.hidden = false; return; }
    guidedFlow.values.start = startTime; guidedFlow.values.end = endTime; guidedFlow.values.timeDraft = null;
    guidedFlow.values.schedulePending = false;
    card.querySelectorAll("input, select, button").forEach(field => { field.disabled = true; field.tabIndex = -1; });
    guidedAdvance(); await guidedAskCurrentStep();
  });
}
function renderGuidedControls() {
  if (!assistantEls.conversation) return;
  if (!guidedFlow) return;
  const shell = document.createElement("div");
  shell.id = `guidedControls-${guidedFlow.step}`;
  assistantEls.conversation.querySelector(`#${shell.id}`)?.remove();
  shell.className = "message assistant-message guided-controls-message";
  const controls = document.createElement("div");
  controls.className = guidedFlow.step === "summary" ? "guided-summary-card" : "guided-controls";
  controls.dataset.guidedStep = guidedFlow.step;
  const values = guidedFlow.values;

  if (guidedFlow.step === "summary") {
    const title = document.createElement("h3");
    title.textContent = values.title || "Schedule item";
    const itemType = document.createElement("p");
    itemType.className = "guided-summary-type";
    itemType.textContent = values.itemType ? values.itemType[0].toUpperCase() + values.itemType.slice(1) : "";
    const date = document.createElement("p");
    date.textContent = values.date ? formatKampalaDate(values.date) : "Date not set";
    const time = document.createElement("p");
    time.textContent = values.start ? `${formatKampalaTime(values.start)}${values.end ? ` – ${formatKampalaTime(values.end)}` : ""}` : "Time not set";
    const category = document.createElement("p");
    category.textContent = values.category || "Personal";
    controls.append(title, itemType, date, time, category);
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
    const prior=guidedSteps().indexOf(guidedFlow.returnStep);
    if(prior>0) actions.appendChild(guidedNavButton("Back to previous step","back","M15 18l-6-6 6-6","back"));
    actions.appendChild(guidedNavButton("Cancel schedule creation","cancel","M6 6l12 12M18 6 6 18","cancel"));
    controls.appendChild(actions);
  } else {
    const step = guidedFlow.step;
    if (step === "type") {
      const card = document.createElement("div"); card.className = "guided-choice-card"; card.setAttribute("role", "group"); card.setAttribute("aria-label", "Choose item type");
      [["activity","Activity"],["task","Task"],["routine","Routine"]].forEach(([value,label]) => { const button=guidedControlButton(label,"type",value); button.className="guided-choice-row"; button.setAttribute("aria-pressed",String(values.itemType===value)); button.tabIndex=0; const square=document.createElement("span"); square.className="guided-choice-square"; square.setAttribute("aria-hidden","true"); const text=document.createElement("span"); text.className="guided-choice-label"; text.textContent=label; button.replaceChildren(square,text); card.appendChild(button); }); controls.appendChild(card);
    } else if (step === "frequency") {
      for (const [value, label] of [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]]) controls.appendChild(guidedControlButton(label, "frequency", value));
    } else if (step === "category") {
      const card=document.createElement("div"); card.className="guided-choice-card"; card.setAttribute("role","group"); card.setAttribute("aria-label","Choose category");
      for (const name of guidedCategoryNames()) { const button=guidedControlButton(name,"category",name); button.className="guided-choice-row"; button.setAttribute("aria-pressed",String(values.category===name)); button.tabIndex=0; const square=document.createElement("span"); square.className="guided-choice-square"; square.setAttribute("aria-hidden","true"); if(values.category===name) square.style.setProperty("--guided-choice-accent", guidedCategoryColor(name)); const text=document.createElement("span"); text.className="guided-choice-label"; text.textContent=name; button.replaceChildren(square,text); card.appendChild(button); }
      controls.appendChild(card);
    } else if (step === "date") {
      renderGuidedDateControl(controls, values.date);
    } else if (step === "time_range") {
      renderGuidedTimeControl(controls, values.start, values.end);
    } else if (step === "weekdays") {
      GUIDED_WEEKDAYS.forEach((name, day) => {
        const button = guidedControlButton(name, "weekday", day);
        button.setAttribute("aria-pressed", String(values.weekdays.includes(day)));
        controls.appendChild(button);
      });
    } else if (step === "edit_choice") {
      const card = document.createElement("div"); card.className = "guided-choice-card"; card.setAttribute("role", "group"); card.setAttribute("aria-label", "Choose a field to change");
      const fields = [["type", "Type"], ["title", "Title"], ["date", "Date"]];
      if (values.itemType === "activity" || values.itemType === "routine") fields.push(["time_range", "Time"]);
      fields.push(["category", "Category"]);
      if (values.itemType === "routine") fields.push(["frequency", "Recurrence"]);
      fields.push(["notes", "Note"]);
      fields.forEach(([field, label]) => {
        const button = guidedControlButton(label, "edit_field", field);
        button.className = "guided-choice-row";
        button.tabIndex = 0;
        const square = document.createElement("span"); square.className = "guided-choice-square"; square.setAttribute("aria-hidden", "true");
        const text = document.createElement("span"); text.className = "guided-choice-label"; text.textContent = label;
        button.replaceChildren(square, text);
        card.appendChild(button);
      });
      controls.appendChild(card);
    }
    const actions = document.createElement("div");
    actions.className = "guided-control-actions";
    if (step === "notes") actions.appendChild(guidedControlButton("Skip note", "skip", null, "guided-skip-note"));
    if (step === "time_range" && values.itemType === "routine") actions.appendChild(guidedControlButton("Skip time", "skip", null, "guided-quiet-action"));
    if (step === "category" && values.itemType === "task") actions.appendChild(guidedControlButton("Skip category", "skip", null, "guided-quiet-action"));
    if (step === "weekdays") actions.appendChild(guidedControlButton("Continue", "continue_weekdays", null, "primary-button"));
    if (guidedSteps().indexOf(step) > 0) actions.appendChild(guidedNavButton("Back to previous step", "back", "M15 18l-6-6 6-6", "back"));
    actions.appendChild(guidedNavButton("Cancel schedule creation", "cancel", "M6 6l12 12M18 6 6 18", "cancel"));
    controls.appendChild(actions);
  }
  shell.appendChild(controls);
  assistantEls.conversation.appendChild(shell);
  if (guidedFlow.step === "notes" && values.notes && assistantEls.input && !assistantEls.input.value) {
    assistantEls.input.value = values.notes;
    updateComposerHeight();
    updateSendButtonState();
  }
  scrollToBottom();
  controls.querySelector("button:not(:disabled), input:not(:disabled)")?.focus({ preventScroll: true });
}
function renderGuidedHistoryControls(flow = guidedFlow) {
  if (!flow?.id || !assistantEls.conversation) return;
  const activeFlow = guidedFlow;
  guidedFlow = flow;
  const originalStep = guidedFlow.step;
  const activeStep = guidedFlow.step === "switch_question" ? guidedFlow.returnStep : guidedFlow.step;
  const steps = guidedSteps();
  const activeIndex = steps.indexOf(activeStep);
  for (const step of steps.slice(0, Math.max(0, activeIndex))) {
    if (!["type", "date", "time_range", "category"].includes(step)) continue;
    const questions = [...assistantEls.conversation.querySelectorAll(`[data-guided-flow-id="${guidedFlow.id}"][data-guided-step="${step}"]`)];
    const question = questions.at(-1);
    if (!question || assistantEls.conversation.querySelector(`#guidedControls-${step}`)) continue;
    guidedFlow.step = step;
    renderGuidedControls();
    const shell = assistantEls.conversation.querySelector(`#guidedControls-${step}`);
    if (!shell) continue;
    shell.querySelector(".guided-control-actions")?.remove();
    shell.querySelectorAll("button, input, select").forEach(control => { control.disabled = true; control.tabIndex = -1; });
    shell.querySelector(".guided-choice-card")?.setAttribute("aria-disabled", "true");
    question.after(shell);
  }
  guidedFlow.step = originalStep;
  guidedFlow = activeFlow;
}
function guidedAdvance() {
  const steps = guidedSteps();
  const index = steps.indexOf(guidedFlow.step);
  guidedFlow.step = steps[Math.min(index + 1, steps.length - 1)];
}
async function guidedAskCurrentStep({ wait = false } = {}) {
  const conversationId = activeConversationId;
  const prompt = guidedPrompt(guidedFlow.step);
  const shouldWait = wait;
  assistantEls.conversation.querySelectorAll(".guided-controls-message").forEach(shell => {
    shell.querySelectorAll("button, input, select").forEach(control => { control.disabled = true; control.tabIndex = -1; });
    shell.querySelector(".guided-choice-card")?.setAttribute("aria-disabled", "true");
    shell.querySelector(".guided-control-actions")?.remove();
  });
  const startedAt = performance.now();
  if (shouldWait && activeConversationId === conversationId) {
    showWaitingState();
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  const saved = saveGuidedFlow();
  if (shouldWait) await waitForPresentation(startedAt, 350);
  await saved;
  await appendAssistantWithReveal({ role: "assistant", text: prompt, guidedFlowId: guidedFlow.id, guidedStepId: guidedFlow.step }, conversationId);
  if (activeConversationId === conversationId && guidedFlow) renderGuidedControls();
}
function validateGuidedValues() {
  const values = guidedFlow.values;
  const pendingEdit = guidedFlow.type === "edit_schedule_item" && values.schedulePending === true;
  if (!values.title?.trim()) return "Enter a title.";
  if (!pendingEdit && (!values.date || !scheduleValidateDate(values.date))) return "Enter a valid date.";
  if (!pendingEdit && values.itemType === "activity" && (!values.start || !scheduleValidateTime(values.start))) return "Select a start time.";
  if (!pendingEdit && values.itemType === "activity" && (!values.end || !scheduleValidateTime(values.end))) return "Select an end time.";
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
  if (step === "switch_question") { await guidedAppendAssistant("Choose whether to cancel schedule creation or keep going with it."); return; }
  if (["type", "date", "time_range", "category"].includes(step)) { await guidedAppendAssistant("Use the controls beneath the question to choose this value."); return; }
  if (step === "edit_choice") {
    const normalized = answer.toLowerCase();
    const fieldMap = { type: "type", title: "title", date: "date", time: "time_range", "time range": "time_range", "time range": "time_range", category: "category", note: "notes", notes: "notes", recurrence: "frequency", repeat: "frequency", frequency: "frequency" };
    const mapped = fieldMap[normalized];
    if (mapped) { guidedFlow.step = mapped; await guidedAskCurrentStep(); return; }
    if (["cancel", "cancel editing"].includes(normalized)) { await cancelGuidedAdd(); return; }
    await guidedAppendAssistant("Choose Type, Title, Date, Time, Category, Recurrence, or Note using the controls.");
    return;
  }
  if (step === "summary") {
    const normalized = answer.toLowerCase();
    if (["cancel", "cancel creation"].includes(normalized)) { await cancelGuidedAdd(); return; }
    if (["edit", "back", "change"].includes(normalized)) { guidedFlow.step = "edit_choice"; await guidedAskCurrentStep(); return; }
    await guidedAppendAssistant("Use Add to schedule, Edit, or Cancel on the summary card.");
    return;
  }
  if (step === "title") {
    if (!answer || answer.length > 200) { await guidedAppendAssistant("Enter a title of 1 to 200 characters."); return; }
    values.title = answer;
    if (guidedFlow.type === "create_schedule_item" && activeConversationId) {
      firebaseStore.updateConversationSummary(activeConversationId, { title: `Add ${answer.slice(0, 40)}` }).catch(() => {});
      loadDrawerConversations().catch(() => {});
    }
  } else if (step === "interval") {
    const interval = Number(answer);
    if (!Number.isInteger(interval) || interval < 1 || interval > 365) { await guidedAppendAssistant("Enter a positive whole number from 1 to 365."); return; }
    values.recurrence.interval = interval;
  } else if (step === "frequency") {
    const frequency = answer.toLowerCase();
    if (!["daily", "weekly", "monthly"].includes(frequency)) { await guidedAppendAssistant("Choose daily, weekly, or monthly."); return; }
    values.recurrence = { frequency, interval: 1, days: [] };
    values.weekdays = [];
  } else if (step === "weekdays") {
    const parts = answer.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const days = parts.map(value => GUIDED_WEEKDAYS.findIndex(day => day.toLowerCase().startsWith(value))).filter(day => day >= 0);
    if (!days.length || days.length !== parts.length) { await guidedAppendAssistant("Enter weekday names such as Monday, Wednesday, or Friday."); return; }
    values.weekdays = [...new Set(days)];
    values.recurrence.days = values.weekdays;
  } else if (step === "notes") {
    if (answer.length > 2000) { await guidedAppendAssistant("Keep the note to 2,000 characters or fewer."); return; }
    values.notes = answer;
  }
  guidedAdvance();
  await guidedAskCurrentStep({ wait: true });
}
function guidedSummaryText(values) {
  const lines = [values.title, values.date ? formatKampalaDate(values.date) : "Date not set", values.start ? `${formatKampalaTime(values.start)}${values.end ? ` – ${formatKampalaTime(values.end)}` : ""}` : "Time not set", values.category || "Personal"];
  if (values.notes) lines.push(values.notes);
  if (values.recurrence) lines.push(`${values.recurrence.frequency[0].toUpperCase()}${values.recurrence.frequency.slice(1)} · every ${values.recurrence.interval}${values.recurrence.frequency === "daily" ? " day(s)" : values.recurrence.frequency === "weekly" ? " week(s)" : " month(s)"}${values.recurrence.frequency === "weekly" ? ` · ${values.recurrence.days.map(day => GUIDED_WEEKDAYS[day]).join(", ")}` : ""}`);
  return lines.join("\n");
}
async function removeGuidedReviewInstruction(flowId) {
  if (!flowId) return;
  const removed = conversation.filter(entry => entry.role === "assistant" && entry.guidedFlowId === flowId && entry.guidedStepId === "summary" && entry.text === "Review the schedule details below.");
  if (!removed.length) return;
  conversation = conversation.filter(entry => !removed.includes(entry));
  assistantEls.conversation?.querySelectorAll("[data-guided-flow-id][data-guided-step='summary']").forEach(message => {
    if (message.dataset.guidedFlowId === flowId && message.querySelector(".assistant-text")?.textContent === "Review the schedule details below.") message.remove();
  });
  const ids = removed.map(entry => entry.id).filter(Boolean);
  if (ids.length && activeConversationId) {
    await persistenceQueue.catch(() => {});
    await firebaseStore.deleteConversationMessages(activeConversationId, ids).catch(showPersistenceFailure);
  }
}
async function cancelGuidedAdd() {
  const wasEdit = guidedFlow?.type === "edit_schedule_item";
  await removeGuidedReviewInstruction(guidedFlow?.id);
  if (activeConversationId) delete guidedFlowsByConversation[activeConversationId];
  guidedCompletedFlow = null;
  guidedFlow = null;
  pendingQuickQuestionId = null;
  await saveGuidedFlow();
  assistantEls.conversation.querySelectorAll(".guided-controls-message").forEach(node => node.remove());
  await guidedAppendAssistant(wasEdit ? "Schedule changes cancelled." : "Schedule creation cancelled.", { showControls: false });
}
async function confirmGuidedAdd() {
  if (!guidedFlow || guidedSaveInProgress) return;
  const validationError = validateGuidedValues();
  if (validationError) { guidedFlow.step = validationError.startsWith("Select a start") || validationError.startsWith("Select an end") || validationError.startsWith("End time") ? "time_range" : validationError.startsWith("Choose a category") ? "category" : validationError.startsWith("Choose a routine") || validationError.startsWith("Enter a positive recurrence") ? "frequency" : validationError.startsWith("Select at least one weekday") ? "weekdays" : validationError.startsWith("Enter a valid date") ? "date" : "title"; await guidedAskCurrentStep(); return; }
  const values = guidedFlow.values;
  const isEdit = guidedFlow.type === "edit_schedule_item";
  const updates = {
    title: values.title.trim(), date: values.schedulePending ? null : values.date, type: values.itemType, start: values.start || "", end: values.end || "",
    category: values.category || "Personal", notes: values.notes.trim(), recurrence: values.recurrence,
    schedulePending: isEdit ? values.schedulePending === true : false,
    ...(isEdit && values.status ? { status: values.status } : {})
  };
  const candidateId = isEdit ? guidedFlow.itemId : "__guided_add_item__";
  const candidate = { ...updates, id: candidateId, status: "upcoming" };
  const conflict = candidate.date && candidate.start && candidate.end
    ? saDetectConflictsForDate(candidate.date, [...(isEdit ? items.filter(item => item.id !== guidedFlow.itemId) : items), candidate]).find(item => item.firstItemId === candidate.id || item.secondItemId === candidate.id)
    : null;
  const conflictKey = conflict ? `${candidate.date}|${candidate.start}|${candidate.end}|${conflict.pairKey}` : "";
  if (conflict && guidedFlow.conflictKey !== conflictKey) {
    const otherTitle = conflict.firstItemId === candidate.id ? conflict.secondTitle : conflict.firstTitle;
    guidedFlow.conflictKey = conflictKey;
    guidedFlow.conflictMessage = `Schedule conflict: ${candidate.title} overlaps with ${otherTitle} from ${formatTime(conflict.overlapStart)} to ${formatTime(conflict.overlapEnd)}.`;
    await saveGuidedFlow();
    await guidedAppendAssistant("Review the schedule details below.");
    return;
  }
  guidedSaveInProgress = true;
  renderGuidedControls();
  const flowId = guidedFlow.id;
  const proposal = registerScheduleProposal({
    id: crypto.randomUUID(),
    conversationId: activeConversationId,
    source: "guided",
    action: isEdit ? { type: "update_item", targetId: guidedFlow.itemId, changes: updates } : { type: "create_item", item: { ...updates, status: "upcoming", postponed: 0 } },
    message: "Review the schedule details below."
  }, activeConversationId);
  currentProposal = proposal;
  const result = await confirmScheduleProposal(proposal.id, activeConversationId);
  guidedSaveInProgress = false;
  if (!result.success) { renderGuidedControls(); return; }
  await removeGuidedReviewInstruction(flowId);
  guidedFlow.status = "completed"; guidedFlow.step = "summary";
  guidedFlowsByConversation[activeConversationId] = guidedFlow; guidedCompletedFlow = guidedFlow;
  guidedFlow = null;
  pendingQuickQuestionId = null;
  await saveGuidedFlow();
  assistantEls.conversation.querySelector("#guidedControls-summary")?.remove();
  currentProposal = null;
  await firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction, guidedFlow, guidedFlowsByConversation }).catch(showPersistenceFailure);
  updateAssistantEmptyState();
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
    const currentStep = guidedFlow.step === "switch_question" ? guidedFlow.returnStep : guidedFlow.step;
    const index = steps.indexOf(currentStep);
    if (index > 0) {
      const returnedStep = steps[index - 1];
      const rank = new Map(steps.map((step, i) => [step, i]));
      const removed = conversation.filter(entry => entry.guidedFlowId === guidedFlow.id && (entry.guidedStepId === "switch_question" || (rank.has(entry.guidedStepId) && rank.get(entry.guidedStepId) >= rank.get(returnedStep))));
      conversation = conversation.filter(entry => !removed.includes(entry));
      for (const entry of removed) assistantEls.conversation.querySelector(`[data-guided-flow-id="${guidedFlow.id}"][data-guided-step="${entry.guidedStepId}"]`)?.remove();
      const ids = removed.map(entry => entry.id).filter(Boolean);
      if (ids.length && activeConversationId) { await persistenceQueue.catch(() => {}); await firebaseStore.deleteConversationMessages(activeConversationId, ids); await firebaseStore.updateConversationSummary(activeConversationId, { summary: conversationSummary("active"), keywords: conversation.map(entry => entry.text || "").join(" ").split(/\s+/).filter(Boolean).slice(-40) }).catch(() => {}); }
      assistantEls.conversation.querySelectorAll(".guided-controls-message").forEach(node => {
        const nodeStep = node.querySelector("[data-guided-step]")?.dataset.guidedStep;
        if (node.id === "guidedControls-switch_question" || (rank.get(nodeStep) ?? -1) >= rank.get(returnedStep)) node.remove();
      });
      guidedFlow.step = returnedStep;
      guidedFlow.returnStep = null;
      delete guidedFlow.queuedQuickQuestion;
      guidedFlow.values = pruneGuidedValues(guidedFlow.values, returnedStep);
    }
    guidedFlow.conflictKey = null;
    guidedFlow.conflictMessage = null;
    await guidedAskCurrentStep();
    return;
  }
  if (action === "edit") {
    guidedFlow.step = "edit_choice";
    await guidedAskCurrentStep();
    return;
  }
  if (action === "edit_field") {
    const field = value;
    if (["title", "date", "time_range", "category", "notes", "frequency", "type"].includes(field)) {
      guidedFlow.step = field;
      await guidedAskCurrentStep();
      return;
    }
    await guidedAppendAssistant("Choose a field to change.");
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
    if (!guidedFlow.values.weekdays.length) { await guidedAppendAssistant("Select at least one weekday."); return; }
    guidedAdvance();
    await guidedAskCurrentStep({ wait: true });
    return;
  }
  if (action === "type") {
    guidedFlow.values.itemType = value;
      const card=assistantEls.conversation.querySelector("#guidedControls-type .guided-choice-card"); if(card) card.setAttribute("aria-disabled","true");
      card?.querySelectorAll("[data-guided-action='type']").forEach(button=>{button.tabIndex=-1;button.disabled=true;button.setAttribute("aria-pressed",String(button.dataset.guidedValue===value));});
    guidedAdvance();
    await guidedAskCurrentStep({ wait: true });
    return;
  }
  if (action === "frequency") {
    guidedFlow.values.recurrence = { frequency: value, interval: 1, days: [] };
    guidedFlow.values.weekdays = [];
    guidedAdvance();
    await guidedAskCurrentStep({ wait: true });
    return;
  }
  if (action === "category") {
    guidedFlow.values.category = value;
    const card=assistantEls.conversation.querySelector("#guidedControls-category .guided-choice-card"); if(card) card.setAttribute("aria-disabled","true");
    card?.querySelectorAll("[data-guided-action='category']").forEach(button=>{button.tabIndex=-1;button.disabled=true;button.setAttribute("aria-pressed",String(button.dataset.guidedValue===value));});
    guidedAdvance();
    await guidedAskCurrentStep({ wait: true });
    return;
  }
  if (action === "skip") {
    if (guidedFlow.step === "category") guidedFlow.values.category = null;
    else if (guidedFlow.step === "notes") {
      guidedFlow.values.notes = "";
      if (assistantEls.input) assistantEls.input.value = "";
      updateComposerHeight();
      updateSendButtonState();
    }
    else if (guidedFlow.step === "time_range") { guidedFlow.values.start = null; guidedFlow.values.end = null; guidedFlow.values.timeDraft = null; }
    const skipped = guidedFlow.step;
    guidedAdvance();
    await guidedAskCurrentStep({ wait: skipped !== "notes" });
  }
}

async function runQuickQuestion(id, { logUser = true } = {}) {
  const spec = quickQuestionSpecs[id];
  if (!spec || id === "guided_add" || quickQuestionInProgress) return;
  quickQuestionInProgress = true;
  let requestConvId;
  try {
    requestConvId = await ensureConversation();
    if (logUser) appendEntry({ role: "user", text: spec.label });
    const userMessages = conversation.filter(message => message.role === "user");
    if (userMessages.length === 1 && requestConvId) {
      firebaseStore.updateConversationSummary(requestConvId, { title: deriveConversationTitle(spec.label) }).catch(() => {});
    }

    const waitingStartedAt = performance.now();
    showWaitingState();
    await new Promise(resolve => requestAnimationFrame(resolve));
    let result;
    try { result = spec.run(); }
    catch { result = { text: "I couldn't answer that right now." }; }
    await waitForPresentation(waitingStartedAt, 350);
    await appendAssistantWithReveal({ role: "assistant", text: result.text, items: result.items || [] }, requestConvId);
    if (activeConversationId === requestConvId) {
      updateAssistantEmptyState();
      assistantEls.input?.focus();
    }
  } finally {
    if (activeConversationId === requestConvId) removeWaitingState();
    quickQuestionInProgress = false;
  }
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
}

async function handleQuickQuestion(id) {
  const spec = quickQuestionSpecs[id];
  if (!spec || quickQuestionInProgress || quickQuestionSelectionPending) return;
  quickQuestionSelectionPending = true;
  try {
    if (id === "guided_add") {
      if (quickQuestionsOpen) closeQuickQuestions();
      await startAssistantScheduleCreation();
      return;
    }
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
      await guidedAppendAssistant("You’re in the middle of creating a schedule item. Cancel it before asking this question?");
      return;
    }
    if (quickQuestionsOpen) closeQuickQuestions();
    if (guidedFlow) { guidedFlow = null; await saveGuidedFlow(); }
    await runQuickQuestion(id);
  } finally {
    quickQuestionSelectionPending = false;
  }
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
  const choice = event.target.closest("[data-natural-choice]");
  if (choice && !choice.disabled && assistantEls.conversation.contains(choice)) {
    choice.disabled = true;
    if (choice.dataset.naturalChoice.startsWith("target:")) {
      const targetId = choice.dataset.naturalChoice.slice("target:".length);
      const rawMessage = pendingClarification?.knownFields?.rawMessage;
      pendingClarification = { intent: "natural_edit_target", knownFields: { targetId, rawMessage }, missingFields: [] };
      firebaseStore.saveAssistantState({ activeConversationId, pendingClarification, planningContext: activePlanningContext, entityRegistry, pendingOperation, referencedSets, lastConfirmedAction }).catch(showPersistenceFailure);
      sendMessage("that one");
      return;
    }
    sendMessage(choice.dataset.naturalChoice);
    return;
  }
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
  } else {
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

currentProposal = currentProposal || restorePendingScheduleProposal(conversation, activeConversationId);
renderConversation();
if (guidedFlow) { if (!guidedFlow.id) guidedFlow.id = crypto.randomUUID(); renderGuidedHistoryControls(); renderGuidedControls(); }
else if (guidedCompletedFlow) renderGuidedHistoryControls(guidedCompletedFlow);
loadDrawerConversations().catch(showPersistenceFailure);
updateComposerHeight();
updateSendButtonState();
updateConversationPadding();
if (pendingMessageWrites.length) showPersistenceFailure();

function classifyAndProcess(text) {
  const classification = classifyRequest(text);
  return classification;
}
