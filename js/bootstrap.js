const loading = document.querySelector("#cloudLoading");
const appShell = document.querySelector(".app-shell");
const cloudError = document.querySelector("#cloudError");
const retryButton = document.querySelector("#retryCloudButton");
let loaderImage = document.querySelector("#appLoaderImage");
const APP_LOADER_ANIMATION_CYCLE_MS = 2200; // The nine SVG animations share dur="2.2s".
const APP_LOADER_MINIMUM_LOOPS = 3; // Keep startup visible for three complete animation loops.
const APP_LOADER_MINIMUM_DURATION_MS = APP_LOADER_ANIMATION_CYCLE_MS * APP_LOADER_MINIMUM_LOOPS;
let firebaseStore = null;
let firebaseStorePromise = null;
let activeUser = null;
let scriptsLoaded = false;
const loadedScripts = new Set();
let cloudLoadInProgress = false;
let anonymousSignInInProgress = false;
let authInitializationPromise = null;
let startupAttemptNumber = 0;
let currentStartupAttempt = null;

function loadFirebaseStore() {
  if (firebaseStore) return Promise.resolve(firebaseStore);
  if (!firebaseStorePromise) {
    firebaseStorePromise = import("./firebase-store.js").then(module => {
      if (!module.firebaseStore) throw new Error("Firebase store module unavailable.");
      firebaseStore = module.firebaseStore;
      return firebaseStore;
    }).catch(error => {
      firebaseStorePromise = null;
      throw error;
    });
  }
  return firebaseStorePromise;
}

const defaultCategories = [
  { id: "music", name: "Music", color: "#8B5CF6" },
  { id: "health", name: "Health", color: "#EC4899" },
  { id: "personal", name: "Personal", color: "#14B8A6" },
  { id: "meetings", name: "Meetings", color: "#F97316" },
  { id: "travel", name: "Travel", color: "#6366F1" }
];
window.defaultCategories = defaultCategories;

function showLoading() {
  loading.classList.remove("has-error");
  loading.removeAttribute("aria-hidden");
  loading.setAttribute("aria-label", "Loading Matson Time.");
  loading.hidden = false;
  appShell.hidden = true;
  cloudError.hidden = true;
  retryButton.hidden = true;
}
function createMinimumLoaderDurationPromise(image, attempt) {
  return new Promise(resolve => {
    let finished = false;
    let durationTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (durationTimer !== null) window.clearTimeout(durationTimer);
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
      resolve();
    };
    const onLoad = () => {
      if (finished) return;
      image.classList.add("is-ready");
      durationTimer = window.setTimeout(finish, APP_LOADER_MINIMUM_DURATION_MS);
    };
    const onError = () => {
      if (!image.dataset.assetFailureReported) {
        image.dataset.assetFailureReported = "true";
        image.hidden = true;
        console.error("Matson Time application loader asset failed to load.");
      }
      finish();
    };

    attempt.cancelMinimumDuration = finish;
    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
    if (image.complete) {
      if (image.naturalWidth > 0) onLoad();
      else onError();
    }
  });
}
function startStartupAttempt({ restartLoader = false } = {}) {
  currentStartupAttempt?.cancelMinimumDuration?.();
  showLoading();
  startupAttemptNumber += 1;

  if (restartLoader) {
    const nextImage = loaderImage.cloneNode(false);
    nextImage.removeAttribute("hidden");
    nextImage.classList.remove("is-ready");
    delete nextImage.dataset.assetFailureReported;
    nextImage.src = `assets/animations/app-loader.svg?startup-attempt=${startupAttemptNumber}`;
    loaderImage.replaceWith(nextImage);
    loaderImage = nextImage;
  }

  const attempt = { id: startupAttemptNumber, failed: false, cancelMinimumDuration: null };
  currentStartupAttempt = attempt;
  attempt.minimumDurationPromise = createMinimumLoaderDurationPromise(loaderImage, attempt);
  return attempt;
}
function failCurrentStartupAttempt() {
  if (!currentStartupAttempt || currentStartupAttempt.failed) return;
  currentStartupAttempt.failed = true;
  currentStartupAttempt.cancelMinimumDuration?.();
}
function showConnectionError() {
  failCurrentStartupAttempt();
  loading.classList.add("has-error");
  loading.removeAttribute("aria-label");
  loading.hidden = false;
  appShell.hidden = true;
  cloudError.hidden = false;
  cloudError.textContent = "Matson Time could not connect. Try again.";
  retryButton.hidden = false;
}
function showCloudError() {
  console.error("Matson Time startup could not complete.");
  showConnectionError();
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
  const attempt = currentStartupAttempt;
  if (!activeUser || cloudLoadInProgress || !attempt || attempt.failed) return;
  cloudLoadInProgress = true;
  showLoading();
  cloudError.hidden = true;
  retryButton.hidden = true;
  try {
    const applicationInitializationPromise = (async () => {
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
          if (loadedScripts.has(source)) continue;
          await loadClassicScript(source);
          loadedScripts.add(source);
        }
        scriptsLoaded = true;
      }
    })();
    await Promise.all([applicationInitializationPromise, attempt.minimumDurationPromise]);
    if (currentStartupAttempt !== attempt || attempt.failed) return;
    loading.hidden = true;
    loading.classList.remove("has-error");
    loading.removeAttribute("aria-hidden");
    appShell.hidden = false;
  } catch {
    showCloudError();
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

async function connectAnonymously() {
  if (anonymousSignInInProgress) return;
  anonymousSignInInProgress = true;
  showLoading();
  try {
    await firebaseStore.signInAnonymouslyWhenNeeded();
  } catch {
    showConnectionError();
  } finally {
    anonymousSignInInProgress = false;
  }
}

retryButton.addEventListener("click", () => {
  startStartupAttempt({ restartLoader: true });
  if (activeUser) loadCloudApp();
  else if (firebaseStore) connectAnonymously();
  else initializeCloudAuth();
});

function initializeCloudAuth() {
  if (authInitializationPromise) return authInitializationPromise;
  authInitializationPromise = loadFirebaseStore().then(store => {
    store.observeAuthState(user => {
      if (!user) {
        activeUser = null;
        connectAnonymously();
        return;
      }
      activeUser = user;
      loadCloudApp();
    }, showConnectionError);
  }).catch(() => {
    authInitializationPromise = null;
    showConnectionError();
  });
  return authInitializationPromise;
}

startStartupAttempt();
initializeCloudAuth();
