import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, orderBy, limit, where, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { MATSON_FIREBASE_CONFIG } from "./firebase-config.js";

const app = initializeApp(MATSON_FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
let persistenceReady = setPersistence(auth, browserLocalPersistence);
let conversationMessageCache = new Map();

function userId() {
  const user = auth.currentUser;
  if (!user) throw new Error("A user session is required.");
  return user.uid;
}
function userDoc(...segments) { return doc(db, "users", userId(), ...segments); }
function userCollection(...segments) { return collection(db, "users", userId(), ...segments); }
function normalizeScheduleItem(entry) {
  const value = entry.data();
  const dateParts = typeof value.date === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.date);
  const parsedDate = dateParts ? new Date(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3])) : null;
  const safeDate = parsedDate && parsedDate.getFullYear() === Number(dateParts[1]) && parsedDate.getMonth() === Number(dateParts[2]) - 1 && parsedDate.getDate() === Number(dateParts[3]) ? value.date : "";
  const safeTime = value => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "";
  const item = {
    id: entry.id,
    type: ["activity", "task", "routine"].includes(value.type) ? value.type : "task",
    title: typeof value.title === "string" ? value.title.slice(0, 200) : "Untitled item",
    date: safeDate,
    start: safeTime(value.start),
    end: safeTime(value.end),
    category: typeof value.category === "string" ? value.category.slice(0, 60) : "Personal",
    notes: typeof value.notes === "string" ? value.notes.slice(0, 2000) : "",
    status: ["upcoming", "in-progress", "overdue", "completed", "missed", "cancelled", "postponed", "awaiting-check-in"].includes(value.status) ? value.status : "upcoming",
    postponed: Number.isInteger(value.postponed) && value.postponed >= 0 ? value.postponed : 0,
    schedulePending: value.schedulePending === true,
    postponementHistory: Array.isArray(value.postponementHistory) ? value.postponementHistory.filter(entry => entry && typeof entry === "object").slice(-20) : [],
    createdAt: value.createdAt || null, updatedAt: value.updatedAt || null
  };
  const recurrence = value.recurrence;
  if (recurrence && typeof recurrence === "object" && !Array.isArray(recurrence) && ["daily", "weekly", "monthly"].includes(recurrence.frequency)) {
    item.recurrence = {
      frequency: recurrence.frequency,
      days: Array.isArray(recurrence.days) ? recurrence.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6).slice(0, 7) : [],
      interval: Number.isInteger(recurrence.interval) && recurrence.interval > 0 ? recurrence.interval : 1
    };
  } else item.recurrence = null;
  return item;
}
function normalizeConversation(entry) {
  const value = entry.data();
  return {
    id: entry.id, title: typeof value.title === "string" ? value.title.slice(0, 100) : "Conversation",
    summary: typeof value.summary === "string" ? value.summary.slice(0, 600) : "",
    keywords: Array.isArray(value.keywords) ? value.keywords.filter(word => typeof word === "string").slice(0, 40) : [],
    status: value.status === "archived" ? "archived" : "active",
    createdAt: value.createdAt || null, updatedAt: value.updatedAt || null
  };
}
function itemPayload(item, creating = false) {
  const payload = {
    id: item.id, type: item.type, title: item.title, date: item.schedulePending ? null : item.date,
    start: item.start || "", end: item.end || "", category: item.category || "Personal",
    notes: item.notes || "", status: item.status || "upcoming", recurrence: item.recurrence || null,
    postponed: Number.isInteger(item.postponed) ? item.postponed : 0,
    schedulePending: item.schedulePending === true,
    postponementHistory: Array.isArray(item.postponementHistory) ? item.postponementHistory.slice(-20) : [],
    updatedAt: serverTimestamp()
  };
  if (creating && !item.createdAt) payload.createdAt = serverTimestamp();
  else if (item.createdAt) payload.createdAt = item.createdAt;
  return payload;
}
function cleanMessage(message) {
  return {
    role: message.role,
    text: String(message.text || ""),
    kind: message.kind || (message.role === "user" ? "user_message" : "assistant_message"),
    referencedItemIds: Array.isArray(message.referencedItemIds) ? [...new Set(message.referencedItemIds.filter(id => typeof id === "string"))] : [],
    deletedItemIds: Array.isArray(message.deletedItemIds) ? [...new Set(message.deletedItemIds.filter(id => typeof id === "string"))] : [],
    proposalSummary: message.proposalSummary || null,
    resolved: message.resolved !== false,
    createdAt: message.createdAt || serverTimestamp()
  };
}

export const observeAuthState = (callback, onError) => { persistenceReady.then(() => onAuthStateChanged(auth, callback)).catch(onError); };
export const signInAnonymouslyWhenNeeded = async () => { await persistenceReady; if (!auth.currentUser) return signInAnonymously(auth); return auth.currentUser; };
export const getCurrentUser = () => auth.currentUser;

export async function loadScheduleItems() {
  const snapshot = await getDocs(userCollection("scheduleItems"));
  return snapshot.docs.map(normalizeScheduleItem);
}
export async function createScheduleItem(item) {
  const ref = userDoc("scheduleItems", item.id);
  await setDoc(ref, itemPayload(item, true));
  return { ...item };
}
export async function updateScheduleItem(id, changes) {
  const ref = userDoc("scheduleItems", id);
  const allowed = ["type", "title", "date", "start", "end", "category", "notes", "status", "recurrence", "postponed", "schedulePending", "postponementHistory"];
  const safeChanges = Object.fromEntries(Object.entries(changes).filter(([key]) => allowed.includes(key)));
  await updateDoc(ref, { ...safeChanges, id, updatedAt: serverTimestamp() });
}
export async function deleteScheduleItem(id) { await deleteDoc(userDoc("scheduleItems", id)); }
export async function writeSchedulePlanBatch(nextItems, changedIds = nextItems.map(item => item.id), deletedIds = []) {
  if (changedIds.length + deletedIds.length > 450) throw new Error("Schedule operation exceeds the Firestore batch limit.");
  const batch = writeBatch(db);
  for (const id of changedIds) {
    const item = nextItems.find(candidate => candidate.id === id);
    if (item) batch.set(userDoc("scheduleItems", item.id), itemPayload(item, !item.createdAt), { merge: true });
  }
  for (const id of deletedIds) batch.delete(userDoc("scheduleItems", id));
  await batch.commit();
}
export async function loadCategories() {
  const snapshot = await getDocs(userCollection("categories"));
  return snapshot.docs.map(entry => {
    const value = entry.data();
    return { id: entry.id, name: typeof value.name === "string" ? value.name.slice(0, 60) : "Personal", color: /^#[0-9a-f]{6}$/i.test(value.color || "") ? value.color : "#2563EB" };
  });
}
export async function createCategory(category) {
  const name = typeof category?.name === "string" ? category.name.trim().slice(0, 60) : "Personal";
  const rawId = typeof category?.id === "string" ? category.id : name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const id = rawId.replace(/[\/.#$?\[\]]/g, "-").slice(0, 100);
  await setDoc(userDoc("categories", id), { id, name, color: /^#[0-9a-f]{6}$/i.test(category?.color || "") ? category.color : "#2563EB", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return id;
}
export async function updateCategory(id, changes) {
  const safeChanges = {};
  if (changes.name !== undefined) safeChanges.name = String(changes.name).slice(0, 60);
  if (changes.color !== undefined) safeChanges.color = /^#[0-9a-f]{6}$/i.test(changes.color) ? changes.color : "#2563EB";
  await updateDoc(userDoc("categories", id), { ...safeChanges, updatedAt: serverTimestamp() });
}

export async function createConversation(data = {}) {
  const ref = data.id ? userDoc("conversations", data.id) : doc(userCollection("conversations"));
  await setDoc(ref, {
    title: data.title || "New conversation", summary: data.summary || "", keywords: data.keywords || [],
    status: data.status || "active", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  conversationMessageCache.set(ref.id, []);
  return ref.id;
}
export async function listRecentConversations(max = 15) {
  const snapshot = await getDocs(query(userCollection("conversations"), orderBy("updatedAt", "desc"), limit(max)));
  return snapshot.docs.map(normalizeConversation);
}
export async function loadConversation(id, max = 50) {
  const conversationRef = userDoc("conversations", id);
  const metadata = await getDoc(conversationRef);
  if (!metadata.exists()) throw new Error("Conversation was not found.");
  const snapshot = await getDocs(query(collection(conversationRef, "messages"), orderBy("createdAt", "desc"), limit(max)));
  const messages = snapshot.docs.map(entry => {
    const value = entry.data();
    return {
      id: entry.id, role: value.role === "user" ? "user" : "assistant",
      text: typeof value.text === "string" ? value.text.slice(0, 4000) : "",
      kind: typeof value.kind === "string" ? value.kind.slice(0, 40) : "assistant_message",
      referencedItemIds: Array.isArray(value.referencedItemIds) ? value.referencedItemIds.filter(id => typeof id === "string").slice(0, 20) : [],
      deletedItemIds: Array.isArray(value.deletedItemIds) ? value.deletedItemIds.filter(id => typeof id === "string").slice(0, 20) : [],
      proposalSummary: typeof value.proposalSummary === "string" ? value.proposalSummary.slice(0, 300) : null,
      resolved: value.resolved !== false, createdAt: value.createdAt || null
    };
  }).reverse();
  conversationMessageCache.set(id, messages);
  return { ...normalizeConversation({ id, data: () => metadata.data() }), messages };
}
export async function addConversationMessage(conversationId, message) {
  const safeMessage = cleanMessage(message);
  const messagesCollection = userCollection("conversations", conversationId, "messages");
  const ref = message.id ? doc(messagesCollection, message.id) : doc(messagesCollection);
  await setDoc(ref, safeMessage);
  const previous = conversationMessageCache.get(conversationId) || [];
  const messages = [...previous, { ...safeMessage, createdAt: new Date() }].slice(-50);
  conversationMessageCache.set(conversationId, messages);
  const metadata = {};
  if (message.role === "user" && previous.length === 0) metadata.title = String(message.text).slice(0, 72);
  const words = tokenizeKeywords([...previous.map(item => item.text), message.text].join(" "));
  metadata.keywords = words;
  metadata.updatedAt = serverTimestamp();
  await updateDoc(userDoc("conversations", conversationId), metadata);
  return ref.id;
}
export async function resolveUnresolvedProposals(conversationId) {
  const messages = await getDocs(query(collection(userDoc("conversations", conversationId), "messages"), where("resolved", "==", false), limit(20)));
  if (messages.empty) return;
  const batch = writeBatch(db);
  messages.docs.forEach(entry => batch.update(entry.ref, { resolved: true }));
  await batch.commit();
}
export async function markConversationItemDeleted(conversationId, itemId) {
  if (!conversationId || !itemId) return;
  const messages = await getDocs(query(collection(userDoc("conversations", conversationId), "messages"), where("referencedItemIds", "array-contains", itemId), limit(450)));
  if (messages.empty) return;
  const batch = writeBatch(db);
  messages.docs.forEach(entry => batch.update(entry.ref, { deletedItemIds: arrayUnion(itemId) }));
  await batch.commit();
}
export async function markConversationItemsDeleted(conversationId, itemIds) {
  const ids = [...new Set((itemIds || []).filter(id => typeof id === "string" && id))];
  if (!conversationId || !ids.length) return;
  const snapshots = await Promise.all(ids.map(id => getDocs(query(collection(userDoc("conversations", conversationId), "messages"), where("referencedItemIds", "array-contains", id), limit(450)))));
  const refs = new Map();
  snapshots.forEach((snapshot, index) => snapshot.docs.forEach(entry => {
    if (!refs.has(entry.id)) refs.set(entry.id, []);
    refs.get(entry.id).push(ids[index]);
  }));
  if (!refs.size || refs.size > 450) return;
  const batch = writeBatch(db);
  for (const [messageId, deletedIds] of refs) batch.update(doc(userDoc("conversations", conversationId), "messages", messageId), { deletedItemIds: arrayUnion(...deletedIds) });
  await batch.commit();
}
export async function updateConversationSummary(id, { title, summary, keywords, status } = {}) {
  await updateDoc(userDoc("conversations", id), {
    ...(title !== undefined ? { title } : {}), ...(summary !== undefined ? { summary } : {}),
    ...(keywords !== undefined ? { keywords: [...new Set(keywords)] } : {}), ...(status !== undefined ? { status } : {}),
    updatedAt: serverTimestamp()
  });
}
export async function searchConversationSummaries(keywords, max = 5) {
  const docs = await listRecentConversations(40);
  const terms = new Set(tokenizeKeywords(keywords.join(" ")));
  return docs.map(entry => ({ ...entry, score: (entry.keywords || []).filter(word => terms.has(word)).length }))
    .filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, max);
}

export async function loadAssistantState() {
  const snapshot = await getDoc(userDoc("assistantState", "current"));
  return snapshot.exists() ? snapshot.data() : { activeConversationId: null, pendingClarification: null, planningContext: null, entityRegistry: [], pendingOperation: null, referencedSets: [] };
}
export async function saveAssistantState(state) {
  const context = state.planningContext;
  const planningContext = context && typeof context === "object" ? {
    topic: String(context.topic || "").slice(0, 160),
    proposedItems: Array.isArray(context.proposedItems) ? context.proposedItems.slice(0, 10).map(item => ({
      temporaryId: String(item.temporaryId || "").slice(0, 80), type: String(item.type || "").slice(0, 24),
      title: String(item.title || "").slice(0, 120), date: item.date ? String(item.date).slice(0, 10) : null,
      start: item.start ? String(item.start).slice(0, 5) : null, end: item.end ? String(item.end).slice(0, 5) : null,
      durationMinutes: Number.isInteger(item.durationMinutes) ? item.durationMinutes : null,
      category: String(item.category || "Personal").slice(0, 40)
    })) : [],
    constraints: Array.isArray(context.constraints) ? context.constraints.slice(0, 12).map(value => String(value).slice(0, 200)) : [],
    goal: String(context.goal || "").slice(0, 300)
  } : null;
  const pending = state.pendingClarification;
  const pendingClarification = pending && typeof pending === "object" ? {
    intent: String(pending.intent || "").slice(0, 40),
    knownFields: Object.fromEntries(["type", "title", "date", "start", "end"].filter(key => pending.knownFields?.[key] != null).map(key => [key, String(pending.knownFields[key]).slice(0, 120)])),
    missingFields: Array.isArray(pending.missingFields) ? pending.missingFields.slice(0, 8).map(value => String(value).slice(0, 40)) : []
  } : null;
  const entityRegistry = Array.isArray(state.entityRegistry) ? state.entityRegistry.slice(-10).filter(entity => entity && typeof entity.id === "string" && entity.id).map(entity => ({
    entityType: "schedule_item", id: entity.id.slice(0, 160), title: String(entity.title || "").slice(0, 120),
    type: ["activity", "task", "routine"].includes(entity.type) ? entity.type : "activity",
    date: entity.date ? String(entity.date).slice(0, 10) : null, start: entity.start ? String(entity.start).slice(0, 5) : null,
    end: entity.end ? String(entity.end).slice(0, 5) : null, status: String(entity.status || "upcoming").slice(0, 30),
    lastAction: String(entity.lastAction || "updated").slice(0, 30),
    mentionedAs: Array.isArray(entity.mentionedAs) ? [...new Set(entity.mentionedAs.filter(value => typeof value === "string").map(value => value.slice(0, 120)))].slice(-8) : [],
    updatedAt: String(entity.updatedAt || new Date().toISOString()).slice(0, 40),
    ...(entity.deleted ? { deleted: true, deletedAt: String(entity.deletedAt || new Date().toISOString()).slice(0, 40) } : {}),
    saved: entity.saved !== false, lastMentionedOrder: Number.isInteger(entity.lastMentionedOrder) ? entity.lastMentionedOrder : 0
  })) : [];
  const pendingOperation = state.pendingOperation && typeof state.pendingOperation === "object" ? {
    intent: String(state.pendingOperation.intent || "").slice(0, 60),
    state: ["collecting_scope", "collecting_method", "ready_for_proposal", "awaiting_confirmation", "executing", "completed", "cancelled", "expired", "failed"].includes(state.pendingOperation.state) ? state.pendingOperation.state : null,
    operation: typeof state.pendingOperation.operation === "string" ? state.pendingOperation.operation.slice(0, 40) : null,
    proposalId: typeof state.pendingOperation.proposalId === "string" ? state.pendingOperation.proposalId.slice(0, 80) : null,
    method: typeof state.pendingOperation.method === "string" ? state.pendingOperation.method.slice(0, 40) : null,
    targetIds: Array.isArray(state.pendingOperation.targetIds) ? [...new Set(state.pendingOperation.targetIds.filter(id => typeof id === "string"))].slice(0, 20) : [],
    knownFields: state.pendingOperation.knownFields && typeof state.pendingOperation.knownFields === "object" ? Object.fromEntries(Object.entries(state.pendingOperation.knownFields).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).slice(0, 12).map(([key, value]) => [key.slice(0, 40), String(value).slice(0, 160)])) : {},
    missingFields: Array.isArray(state.pendingOperation.missingFields) ? state.pendingOperation.missingFields.slice(0, 8).map(value => String(value).slice(0, 40)) : [],
    decisions: state.pendingOperation.decisions && typeof state.pendingOperation.decisions === "object" ? state.pendingOperation.decisions : {},
    scope: state.pendingOperation.scope && typeof state.pendingOperation.scope === "object" ? state.pendingOperation.scope : null
  } : null;
  const referencedSets = Array.isArray(state.referencedSets) ? state.referencedSets.slice(-5).map(set => ({
    alias: String(set.alias || set.title || "").slice(0, 100), targetIds: Array.isArray(set.targetIds || set.ids) ? [...new Set((set.targetIds || set.ids).filter(id => typeof id === "string"))].slice(0, 20) : [],
    updatedAt: String(set.updatedAt || new Date().toISOString()).slice(0, 40)
  })) : [];
  await setDoc(userDoc("assistantState", "current"), {
    activeConversationId: state.activeConversationId || null,
    pendingClarification,
    planningContext,
    entityRegistry,
    recentEntities: entityRegistry,
    currentTopic: String(state.currentTopic || planningContext?.topic || "").slice(0, 160) || null,
    referencedSets,
    pendingOperation,
    lastConfirmedAction: state.lastConfirmedAction && typeof state.lastConfirmedAction === "object" ? state.lastConfirmedAction : null,
    updatedAt: serverTimestamp()
  }, { merge: true });
}
export async function clearAssistantState() { await saveAssistantState({ activeConversationId: null, pendingClarification: null, planningContext: null }); }

export async function createMemory(memory) {
  const ref = doc(userCollection("memories"));
  await setDoc(ref, {
    type: String(memory.type || "note").slice(0, 40), text: String(memory.text || "").slice(0, 1000),
    keywords: [...new Set(tokenizeKeywords((memory.keywords || []).join(" ") + " " + memory.text))],
    sourceConversationId: memory.sourceConversationId || null, active: memory.active !== false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return ref.id;
}
export async function updateMemory(id, changes) {
  const safeChanges = {};
  if (changes.type !== undefined) safeChanges.type = String(changes.type).slice(0, 40);
  if (changes.text !== undefined) safeChanges.text = String(changes.text).slice(0, 1000);
  if (changes.sourceConversationId !== undefined) safeChanges.sourceConversationId = changes.sourceConversationId;
  if (changes.active !== undefined) safeChanges.active = Boolean(changes.active);
  if (changes.keywords !== undefined || changes.text !== undefined) {
    safeChanges.keywords = [...new Set(tokenizeKeywords([...(changes.keywords || []), changes.text || ""].join(" ")))];
  }
  await updateDoc(userDoc("memories", id), { ...safeChanges, updatedAt: serverTimestamp() });
}
export async function listActiveMemories(max = 30) {
  const snapshot = await getDocs(query(userCollection("memories"), where("active", "==", true), limit(max)));
  return snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }));
}
export async function searchMemories(keywords, max = 5) {
  const terms = new Set(tokenizeKeywords(keywords.join(" ")));
  if (!terms.size) return [];
  const snapshot = await getDocs(query(userCollection("memories"), where("keywords", "array-contains-any", [...terms].slice(0, 10)), limit(Math.max(max * 5, 10))));
  return snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() })).filter(entry => entry.active !== false)
    .map(entry => ({ ...entry, score: (entry.keywords || []).filter(word => terms.has(word)).length }))
    .filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, max);
}

export function tokenizeKeywords(text) {
  const fillers = new Set("a an and are as at be been but by can do did for from had has have how i in is it me my of on or our she so that the their them there they this to was we were what when where which who why will with you your about asked remember tell help please".split(" "));
  return [...new Set(String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(word => word.length > 1 && !fillers.has(word)))].slice(0, 40);
}

export const firebaseStore = {
  observeAuthState, signInAnonymouslyWhenNeeded, getCurrentUser,
  loadScheduleItems, createScheduleItem, updateScheduleItem, deleteScheduleItem, writeSchedulePlanBatch, loadCategories, createCategory, updateCategory,
  createConversation, listRecentConversations, loadConversation, addConversationMessage, resolveUnresolvedProposals, markConversationItemDeleted, markConversationItemsDeleted, updateConversationSummary, searchConversationSummaries,
  loadAssistantState, saveAssistantState, clearAssistantState,
  createMemory, updateMemory, listActiveMemories, searchMemories, tokenizeKeywords
};
