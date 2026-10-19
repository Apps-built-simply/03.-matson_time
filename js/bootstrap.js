const loading = document.querySelector("#cloudLoading");
const appShell = document.querySelector(".app-shell");
const cloudError = document.querySelector("#cloudError");
const retryButton = document.querySelector("#retryCloudButton");
const loaderVideo = document.querySelector("#appLoaderVideo");
let loaderImage = document.querySelector("#appLoaderFallback");
const APP_LOADER_ANIMATION_CYCLE_MS = 2200; // The nine SVG animations share dur="2.2s".
const APP_LOADER_MINIMUM_LOOPS = 3; // Keep startup visible for three complete animation loops.
const APP_LOADER_SOURCE_DURATION_SECONDS = 1.066667; // ffprobe: source MOV, 64 frames at 60 fps.
const APP_LOADER_REDUCED_MOTION_MINIMUM_MS = 600;
const APP_LOADER_ASSET_FAILURE_MINIMUM_MS = 600;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
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
function createMinimumLoaderDurationPromise(attempt) {
  return new Promise(resolve => {
    let finished = false;
    let durationTimer = null;
    let started = false;
    let activeVisual = "video";
    let videoDurationSeconds = Number.isFinite(loaderVideo.duration) && loaderVideo.duration > 0
      ? loaderVideo.duration : APP_LOADER_SOURCE_DURATION_SECONDS;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (durationTimer !== null) window.clearTimeout(durationTimer);
      loaderVideo.removeEventListener("loadedmetadata", onMetadata);
      loaderVideo.removeEventListener("playing", onPlaying);
      loaderVideo.removeEventListener("error", onVideoError);
      loaderVideo.removeEventListener("loadeddata", onReducedMotionFrame);
      loaderImage.removeEventListener("load", onSvgLoad);
      loaderImage.removeEventListener("error", onSvgError);
      resolve();
    };
    const beginMinimum = duration => {
      if (finished || started) return;
      started = true;
      durationTimer = window.setTimeout(finish, duration);
    };
    const onMetadata = () => {
      if (Number.isFinite(loaderVideo.duration) && loaderVideo.duration > 0) videoDurationSeconds = loaderVideo.duration;
      if (prefersReducedMotion.matches) {
        try { loaderVideo.currentTime = Math.min(videoDurationSeconds / 2, 0.5); }
        catch { /* Keep autoplay as the fallback if seeking is unavailable. */ }
      }
    };
    const onPlaying = () => {
      if (activeVisual !== "video") return;
      loaderVideo.classList.add("is-ready");
      if (prefersReducedMotion.matches) {
        loaderVideo.pause();
        beginMinimum(APP_LOADER_REDUCED_MOTION_MINIMUM_MS);
        return;
      }
      beginMinimum(videoDurationSeconds * APP_LOADER_MINIMUM_LOOPS * 1000);
    };
    const startSvgFallback = () => {
      if (finished || activeVisual === "svg") return;
      activeVisual = "svg";
      loaderVideo.pause();
      loaderVideo.hidden = true;
      loaderImage.hidden = false;
      if (!loaderVideo.dataset.failureReported) {
        loaderVideo.dataset.failureReported = "true";
        console.error("Matson Time application loader video could not play.");
      }
      if (durationTimer !== null) window.clearTimeout(durationTimer);
      durationTimer = null;
      started = false;
      const onSvgReady = () => {
        if (finished || activeVisual !== "svg") return;
        loaderImage.classList.add("is-ready");
        beginMinimum(prefersReducedMotion.matches
          ? APP_LOADER_REDUCED_MOTION_MINIMUM_MS
          : APP_LOADER_ANIMATION_CYCLE_MS * APP_LOADER_MINIMUM_LOOPS);
      };
      if (loaderImage.complete) {
        if (loaderImage.naturalWidth > 0) onSvgReady();
        else onSvgError();
      }
      else {
        loaderImage.addEventListener("load", onSvgReady, { once: true });
        loaderImage.addEventListener("error", onSvgError, { once: true });
      }
    };
    const onSvgError = () => {
      if (activeVisual === "svg") {
        loaderImage.hidden = true;
        if (!loaderImage.dataset.assetFailureReported) {
          loaderImage.dataset.assetFailureReported = "true";
          console.error("Matson Time application loader fallback asset failed to load.");
        }
      }
      if (activeVisual === "svg") beginMinimum(APP_LOADER_ASSET_FAILURE_MINIMUM_MS);
    };
    const onSvgLoad = () => {
      if (activeVisual !== "svg") return;
      loaderImage.classList.add("is-ready");
      beginMinimum(prefersReducedMotion.matches
        ? APP_LOADER_REDUCED_MOTION_MINIMUM_MS
        : APP_LOADER_ANIMATION_CYCLE_MS * APP_LOADER_MINIMUM_LOOPS);
    };
    const onVideoError = () => startSvgFallback();

    attempt.cancelMinimumDuration = finish;
    loaderVideo.addEventListener("loadedmetadata", onMetadata);
    loaderVideo.addEventListener("playing", onPlaying);
    loaderVideo.addEventListener("error", onVideoError);
    loaderVideo.addEventListener("loadeddata", onReducedMotionFrame);
    function onReducedMotionFrame() {
      if (prefersReducedMotion.matches && activeVisual === "video" && loaderVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onPlaying();
    }
    if (loaderImage.complete && loaderImage.naturalWidth > 0) loaderImage.classList.add("is-ready");
    if (loaderVideo.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata();
    if (loaderVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && prefersReducedMotion.matches) onReducedMotionFrame();

    const playPromise = loaderVideo.play();
    if (playPromise && typeof playPromise.catch === "function") playPromise.catch(onVideoError);
    if (loaderVideo.error) onVideoError();
  });
}
function startStartupAttempt({ restartLoader = false } = {}) {
  currentStartupAttempt?.cancelMinimumDuration?.();
  showLoading();
  startupAttemptNumber += 1;

  if (restartLoader) {
    loaderVideo.pause();
    loaderVideo.hidden = false;
    loaderImage.hidden = true;
    loaderImage.classList.remove("is-ready");
    try { loaderVideo.currentTime = 0; } catch { /* play() below restarts where supported. */ }
  }

  const attempt = { id: startupAttemptNumber, failed: false, cancelMinimumDuration: null };
  currentStartupAttempt = attempt;
  attempt.minimumDurationPromise = createMinimumLoaderDurationPromise(attempt);
  return attempt;
}
function failCurrentStartupAttempt() {
  if (!currentStartupAttempt || currentStartupAttempt.failed) return;
  currentStartupAttempt.failed = true;
  currentStartupAttempt.cancelMinimumDuration?.();
}
function showConnectionError() {
  failCurrentStartupAttempt();
  loaderVideo.pause();
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
    loaderVideo.pause();
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
