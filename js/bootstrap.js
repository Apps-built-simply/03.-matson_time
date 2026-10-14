import { firebaseStore } from "./firebase-store.js";

const login = document.querySelector("#loginGate");
const loading = document.querySelector("#cloudLoading");
const appShell = document.querySelector(".app-shell");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const cloudError = document.querySelector("#cloudError");
const retryButton = document.querySelector("#retryCloudButton");
const signOutButton = document.querySelector("#signOutButton");
let activeUser = null;
let hasAuthenticated = false;
let scriptsLoaded = false;
let cloudLoadInProgress = false;

const defaultCategories = [
  { id: "music", name: "Music", color: "#8B5CF6" },
  { id: "health", name: "Health", color: "#EC4899" },
  { id: "personal", name: "Personal", color: "#14B8A6" },
  { id: "meetings", name: "Meetings", color: "#F97316" },
  { id: "travel", name: "Travel", color: "#6366F1" }
];

function showLogin() {
  login.hidden = false;
  loading.hidden = true;
  appShell.hidden = true;
}
function showLoading() {
  login.hidden = true;
  loading.hidden = false;
  appShell.hidden = true;
}
function showCloudError(error) {
  console.error("Cloud startup failed", { name: error?.name || "Error", message: String(error?.message || error) });
  loading.hidden = false;
  cloudError.hidden = false;
  cloudError.textContent = "Matson Time couldn’t load your cloud data. Check your connection and retry.";
  retryButton.hidden = false;
}

function parseLocalJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}

function todayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function normalizeLocalScheduleItems(localItems) {
  const validStatuses = new Set(["upcoming", "in-progress", "overdue", "completed", "missed", "cancelled", "postponed", "awaiting-check-in"]);
  return localItems.filter(item => item && typeof item === "object").map(item => ({
    id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
    type: ["activity", "task", "routine"].includes(item.type) ? item.type : "task",
    title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Untitled item",
    date: typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : todayLocalDate(),
    start: typeof item.start === "string" ? item.start : "", end: typeof item.end === "string" ? item.end : "",
    category: typeof item.category === "string" ? item.category : "Personal",
    notes: typeof item.notes === "string" ? item.notes : "",
    status: validStatuses.has(item.status) ? item.status : "upcoming",
    recurrence: item.recurrence && typeof item.recurrence === "object" ? item.recurrence : null,
    postponed: Number.isInteger(item.postponed) && item.postponed >= 0 ? item.postponed : 0,
    ...(item.createdAt ? { createdAt: item.createdAt } : {})
  }));
}

async function migrateLocalData(user) {
  const marker = `matson-time-firestore-migrated-${user.uid}`;
  if (localStorage.getItem(marker)) return;

  const cloudItems = await firebaseStore.loadScheduleItems();
  const categories = await firebaseStore.loadCategories();
  const existingAssistantState = await firebaseStore.loadAssistantState();
  const localItems = parseLocalJson("matson-time-items-v1", []);
  const localCategories = parseLocalJson("matson-time-categories-v1", []);
  if (!cloudItems.length && Array.isArray(localItems) && localItems.length) {
    const normalizedItems = normalizeLocalScheduleItems(localItems);
    for (let offset = 0; offset < normalizedItems.length; offset += 450) {
      await firebaseStore.writeSchedulePlanBatch(normalizedItems.slice(offset, offset + 450));
    }
  }

  if (Array.isArray(localCategories)) {
    const categoryIds = new Set(categories.map(category => category.id));
    for (const category of localCategories.filter(value => value && typeof value === "object")) {
      const id = category.id || category.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (!categoryIds.has(id)) await firebaseStore.createCategory(category);
    }
  }
  if (!categories.length && !localCategories.length) {
    for (const category of defaultCategories) await firebaseStore.createCategory(category);
  }

  const oldMessages = parseLocalJson("matson-time-assistant-v1", []);
  if (Array.isArray(oldMessages) && oldMessages.length) {
    const id = await firebaseStore.createConversation({
      id: "local-import-v1",
      title: "Imported conversation",
      summary: "Imported Assistant history from this browser. Any previous proposal is expired and must be requested again.",
      keywords: firebaseStore.tokenizeKeywords(oldMessages.map(message => message?.text || "").join(" ")),
      status: "archived"
    });
    for (const [index, message] of oldMessages.entries()) {
      if (message && ["user", "assistant"].includes(message.role) && typeof message.text === "string") {
        await firebaseStore.addConversationMessage(id, { ...message, id: `import-${index}`, kind: "imported_history", resolved: true, proposalSummary: null });
      }
    }
  }

  const planningContext = parseLocalJson("matson-time-active-planning-v1", null);
  const safePlanningContext = planningContext && typeof planningContext === "object" &&
    Array.isArray(planningContext.proposedItems) && Array.isArray(planningContext.constraints) &&
    typeof planningContext.goal === "string" ? planningContext : null;
  if (safePlanningContext && !existingAssistantState.planningContext) {
    await firebaseStore.saveAssistantState({ ...existingAssistantState, planningContext: safePlanningContext });
  }
  localStorage.setItem(marker, "1");
}

async function loadCloudApp() {
  if (!activeUser || cloudLoadInProgress) return;
  cloudLoadInProgress = true;
  showLoading();
  cloudError.hidden = true;
  retryButton.hidden = true;
  try {
    await migrateLocalData(activeUser);
    const [scheduleItems, categories, assistantState] = await Promise.all([
      firebaseStore.loadScheduleItems(), firebaseStore.loadCategories(), firebaseStore.loadAssistantState()
    ]);
    if (!categories.length) throw new Error("No categories could be loaded.");
    const recent = await firebaseStore.listRecentConversations(15);
    const conversationId = assistantState.activeConversationId || recent[0]?.id || null;
    let activeConversation = null;
    if (conversationId) {
      try { activeConversation = await firebaseStore.loadConversation(conversationId, 50); }
      catch (error) {
        if (!String(error?.message || "").includes("was not found")) throw error;
        assistantState.activeConversationId = null;
        await firebaseStore.saveAssistantState({ activeConversationId: null, pendingClarification: null, planningContext: assistantState.planningContext || null });
      }
    }
    if (activeConversation && activeConversation.status !== "active") {
      await firebaseStore.updateConversationSummary(conversationId, { status: "active" });
      activeConversation.status = "active";
      await firebaseStore.saveAssistantState({ activeConversationId: conversationId, pendingClarification: assistantState.pendingClarification || null, planningContext: assistantState.planningContext || null });
      assistantState.activeConversationId = conversationId;
    }
    window.firebaseStore = firebaseStore;
    window.initialScheduleItems = scheduleItems;
    window.cloudCategories = categories;
    window.initialAssistantState = assistantState;
    window.initialConversation = activeConversation?.status === "active" ? activeConversation : null;
    window.recentConversations = recent;
    if (!scriptsLoaded) {
      for (const source of ["js/data.js", "js/config.js", "js/schedule-actions.js", "js/app.js", "js/assistant.js", "js/progress.js"]) {
        await loadClassicScript(source);
      }
      scriptsLoaded = true;
    }
    login.hidden = true;
    loading.hidden = true;
    appShell.hidden = false;
  } catch (error) {
    showCloudError(error);
  } finally {
    cloudLoadInProgress = false;
  }
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}.`));
    document.body.appendChild(script);
  });
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  loginError.hidden = true;
  const submit = loginForm.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    await firebaseStore.signIn(loginForm.elements.email.value.trim(), loginForm.elements.password.value);
    loginForm.elements.password.value = "";
  } catch {
    loginError.textContent = "Sign-in failed. Check your details and try again.";
    loginError.hidden = false;
  } finally {
    submit.disabled = false;
  }
});
retryButton.addEventListener("click", loadCloudApp);
signOutButton.addEventListener("click", () => firebaseStore.signOutUser().catch(error => console.error("Sign out failed", { message: String(error?.message || error) })));

firebaseStore.observeAuthState(user => {
  if (!user) {
    if (hasAuthenticated) {
      window.location.reload();
      return;
    }
    activeUser = null;
    showLogin();
    return;
  }
  hasAuthenticated = true;
  activeUser = user;
  loadCloudApp();
});
