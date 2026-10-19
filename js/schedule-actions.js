/* Central schedule action engine — single source of truth for schedule mutations */

function scheduleValidateDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseLocalDate(value);
  const [year, month, day] = value.split("-").map(Number);
  return !isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function scheduleValidateTime(value) {
  return /^\d{2}:\d{2}$/.test(value) && !isNaN(new Date(`2000-01-01T${value}`).getTime());
}

function scheduleValidateItem(item) {
  if (!item || !["activity", "task", "routine"].includes(item.type)) return "Item type is invalid";
  if (!item.title || !item.title.trim()) return "Title is required";
  const pendingSchedule = item.schedulePending === true;
  if (!pendingSchedule && !scheduleValidateDate(item.date)) return "Valid date (YYYY-MM-DD) is required";
  if (pendingSchedule && (item.date || item.start || item.end)) return "An undecided schedule cannot include a date or time";
  if (item.start && !scheduleValidateTime(item.start)) return "Valid start time (HH:mm) is required";
  if (item.end && !scheduleValidateTime(item.end)) return "Valid end time (HH:mm) is required";
  if (item.start && item.end && item.start >= item.end) return "End time must be after start time";
  if (item.type === "activity" && !pendingSchedule && item.start && !scheduleValidateTime(item.start)) return "Valid start time (HH:mm) is required for activities";
  if (item.type === "activity" && !pendingSchedule && item.end && !scheduleValidateTime(item.end)) return "Valid end time (HH:mm) is required for activities";
  if (item.category && !saGetAvailableCategories().includes(item.category)) return "Category is invalid";
  if (item.recurrence && (!(["daily", "weekly", "monthly"].includes(item.recurrence.frequency)) || !Number.isInteger(item.recurrence.interval) || item.recurrence.interval < 1 || !Array.isArray(item.recurrence.days) || item.recurrence.days.some(day => !Number.isInteger(day) || day < 0 || day > 6))) return "Recurrence is invalid";
  return null;
}

var scheduleRenderCallback = null;

function setScheduleRenderCallback(callback) {
  scheduleRenderCallback = callback;
}

function triggerScheduleRender() {
  if (scheduleRenderCallback) scheduleRenderCallback();
  else if (typeof render === "function") render();
}

async function saCreateItem(item) {
  const error = scheduleValidateItem(item);
  if (error) return { success: false, error };
  const newItem = {
    id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
    title: item.title.trim(),
    date: item.schedulePending ? null : item.date,
    type: item.type,
    start: item.start || "",
    end: item.end || "",
    category: item.category || "Personal",
    notes: item.notes?.trim() || "",
    status: "upcoming",
    postponed: 0,
    schedulePending: item.schedulePending === true
  };
  if (item.recurrence) newItem.recurrence = item.recurrence;
  const existing = items.find(candidate => candidate.id === newItem.id);
  if (existing) return { success: true, item: existing, alreadyCreated: true };
  try { await firebaseStore.createScheduleItem(newItem); }
  catch {
    console.error("schedule_create_failed");
    return { success: false, error: "Could not save this item. Check your connection and retry." };
  }
  items.push(newItem);
  triggerScheduleRender();
  return { success: true, item: newItem };
}

function saFindItemById(id) {
  return items.find(item => item.id === id) || null;
}

function saFindItemsByTitle(title, dateFilter = null) {
  const normalized = title.toLowerCase().trim();
  return items.filter(item => {
    if (!item.title.toLowerCase().includes(normalized)) return false;
    if (dateFilter && item.date !== dateFilter) return false;
    return true;
  });
}

async function saUpdateItem(id, updates) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  const normalizedUpdates = { ...updates };
  if (items[index].schedulePending && (normalizedUpdates.date || normalizedUpdates.start || normalizedUpdates.end)) normalizedUpdates.schedulePending = false;
  const updated = { ...items[index], ...normalizedUpdates };
  const error = scheduleValidateItem(updated);
  if (error) return { success: false, error };
  try { await firebaseStore.updateScheduleItem(id, normalizedUpdates); }
  catch {
    console.error("schedule_update_failed");
    return { success: false, error: "Could not save this change. Check your connection and retry." };
  }
  items[index] = updated;
  triggerScheduleRender();
  return { success: true, item: updated };
}

async function saRescheduleItem(id, newDate, newStart, newEnd) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  const item = items[index];
  if (item.type !== "activity") return { success: false, error: "Only activities can be rescheduled" };
  if (!scheduleValidateDate(newDate)) return { success: false, error: "Valid date (YYYY-MM-DD) is required" };
  if (!scheduleValidateTime(newStart)) return { success: false, error: "Valid start time (HH:mm) is required" };
  if (!scheduleValidateTime(newEnd)) return { success: false, error: "Valid end time (HH:mm) is required" };
  if (newStart >= newEnd) return { success: false, error: "End time must be after start time" };
  const updated = { ...item, date: newDate, start: newStart, end: newEnd, schedulePending: false };
  try { await firebaseStore.updateScheduleItem(id, { date: newDate, start: newStart, end: newEnd, schedulePending: false }); }
  catch { return { success: false, error: "Could not save this change. Check your connection and retry." }; }
  items[index] = updated;
  triggerScheduleRender();
  return { success: true, item: updated };
}

async function saPostponeItem(id, schedule) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  const item = items[index];
  if (typeof schedule === "number") {
    if (!item.date || !item.start || !item.end) return { success: false, error: "Only timed items can be postponed" };
    const baseDate = parseLocalDate(item.date);
    const [startHour, startMinute] = item.start.split(":").map(Number);
    const [endHour, endMinute] = item.end.split(":").map(Number);
    const startDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), startHour, startMinute + schedule);
    const endDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), endHour, endMinute + schedule);
    schedule = {
      date: localDateString(startDate),
      start: `${String(startDate.getHours()).padStart(2, "0")}:${String(startDate.getMinutes()).padStart(2, "0")}`,
      end: `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`,
      schedulePending: false
    };
  }
  if (!schedule || typeof schedule !== "object") return { success: false, error: "Choose a postponement schedule." };
  const pending = schedule.schedulePending === true;
  const updated = {
    ...item,
    date: pending ? "" : schedule.date,
    start: pending ? "" : (schedule.start || ""),
    end: pending ? "" : (schedule.end || ""),
    schedulePending: pending,
    status: "postponed",
    postponed: (item.postponed || 0) + 1,
    postponementHistory: [...(Array.isArray(item.postponementHistory) ? item.postponementHistory : []), {
      previousDate: item.date || null,
      previousStart: item.start || null,
      previousEnd: item.end || null,
      newDate: pending ? null : (schedule.date || null),
      newStart: pending ? null : (schedule.start || null),
      newEnd: pending ? null : (schedule.end || null),
      schedulePending: pending,
      postponedAt: new Date().toISOString()
    }].slice(-20)
  };
  const validationError = scheduleValidateItem(updated);
  if (validationError) return { success: false, error: validationError };
  const changes = {
    date: pending ? null : updated.date,
    start: updated.start,
    end: updated.end,
    schedulePending: pending,
    status: updated.status,
    postponed: updated.postponed,
    postponementHistory: updated.postponementHistory
  };
  try { await firebaseStore.updateScheduleItem(id, changes); }
  catch { return { success: false, error: "Could not save this change. Check your connection and retry." }; }
  items[index] = updated;
  triggerScheduleRender();
  return { success: true, item: items[index] };
}

async function saCompleteItem(id) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  const updated = { ...items[index], status: "completed" };
  try { await firebaseStore.updateScheduleItem(id, { status: updated.status }); }
  catch { return { success: false, error: "Could not save this change. Check your connection and retry." }; }
  items[index] = updated;
  triggerScheduleRender();
  return { success: true, item: items[index] };
}

async function saMarkItemMissed(id) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  const updated = { ...items[index], status: "missed" };
  try { await firebaseStore.updateScheduleItem(id, { status: updated.status }); }
  catch { return { success: false, error: "Could not save this change. Check your connection and retry." }; }
  items[index] = updated;
  triggerScheduleRender();
  return { success: true, item: items[index] };
}

async function saCancelItem(id) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  const updated = { ...items[index], status: "cancelled" };
  try { await firebaseStore.updateScheduleItem(id, { status: updated.status }); }
  catch { return { success: false, error: "Could not save this change. Check your connection and retry." }; }
  items[index] = updated;
  triggerScheduleRender();
  return { success: true, item: items[index] };
}

async function saRestoreItem(id) {
  const index = items.findIndex(item => item.id === id);
  if (index < 0 || items[index].status !== "cancelled") return { success: false, error: "Only a cancelled item can be restored." };
  const restored = { ...items[index], status: "upcoming" };
  try { await firebaseStore.updateScheduleItem(id, { status: "upcoming" }); }
  catch { return { success: false, error: "Could not restore this item. Check your connection and retry." }; }
  items[index] = restored;
  triggerScheduleRender();
  return { success: true, item: restored };
}

async function saDeleteItem(id) {
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return { success: false, error: "Item no longer exists." };
  const deleted = items[index];
  try { await firebaseStore.deleteScheduleItem(id); }
  catch { return { success: false, error: "Could not permanently delete this item. Check your connection and retry." }; }
  items.splice(index, 1);
  triggerScheduleRender();
  return { success: true, item: deleted };
}

function saGetItemsForDate(dateStr) {
  return items.filter(item => item.date === dateStr && !item.schedulePending);
}

function saGetTodayItems() {
  return saGetItemsForDate(localDateString(new Date()));
}

function saGetUpcomingItems() {
  const today = localDateString(new Date());
  return items.filter(item => item.date && !item.schedulePending && item.date >= today && item.status !== "completed" && item.status !== "cancelled");
}

function saGetCurrentOrNextItem() {
  const today = localDateString(new Date());
  const todayItems = saGetTodayItems();
  const attention = getAttentionItem(todayItems);
  if (attention) return attention;
  const upcoming = saGetUpcomingItems().sort((a, b) => (a.date + "|" + (a.start || "")).localeCompare(b.date + "|" + (b.start || "")));
  return upcoming[0] || null;
}

function saGetWeekItems(startDate = null) {
  const base = startDate ? parseLocalDate(startDate) : new Date();
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = localDateString(monday);
  const weekEnd = localDateString(sunday);
  return items.filter(item => item.date && item.date >= weekStart && item.date <= weekEnd);
}

function saTimeToMinutes(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function saMinutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function saDetectConflictsForDate(dateStr, scheduleItems = items) {
  if (!scheduleValidateDate(dateStr)) return [];
  const eligibleStatuses = new Set(["upcoming", "in-progress", "overdue", "awaiting-check-in", "postponed"]);
  const timed = scheduleItems.filter(item => {
    if (!item || !item.id || item.date !== dateStr || !eligibleStatuses.has(item.status) || item.schedulePending) return false;
    if (item.status === "postponed" && (!item.date || !item.start || !item.end)) return false;
    const start = saTimeToMinutes(item.start), end = saTimeToMinutes(item.end);
    return start !== null && end !== null && end > start;
  }).map(item => ({ item, start: saTimeToMinutes(item.start), end: saTimeToMinutes(item.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end || String(a.item.id).localeCompare(String(b.item.id)));

  const conflicts = [];
  const seen = new Set();
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const first = timed[i], second = timed[j];
      if (second.start >= first.end) break;
      if (first.item.id === second.item.id) continue;
      const [smallerId, largerId] = [String(first.item.id), String(second.item.id)].sort();
      const pairKey = `${smallerId}::${largerId}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      conflicts.push({
        firstItemId: first.item.id,
        firstTitle: typeof first.item.title === "string" ? first.item.title : "Schedule item",
        secondItemId: second.item.id,
        secondTitle: typeof second.item.title === "string" ? second.item.title : "Schedule item",
        date: dateStr,
        overlapStart: saMinutesToTime(Math.max(first.start, second.start)),
        overlapEnd: saMinutesToTime(Math.min(first.end, second.end)),
        pairKey: `${dateStr}|${pairKey}`
      });
    }
  }
  return conflicts.sort((a, b) => saTimeToMinutes(a.overlapStart) - saTimeToMinutes(b.overlapStart) || a.pairKey.localeCompare(b.pairKey));
}

function saCalculateDailyProgress(dateStr = null) {
  const targetDate = dateStr || localDateString(new Date());
  const dateItems = saGetItemsForDate(targetDate);
  const planned = dateItems.filter(item => item.status !== "cancelled");
  const completed = planned.filter(item => item.status === "completed").length;
  const missed = planned.filter(item => item.status === "missed").length;
  const postponed = planned.filter(item => item.status === "postponed").length;
  const awaiting = planned.filter(item => item.status === "awaiting-check-in").length;
  const remaining = planned.length - completed - missed;
  const routines = planned.filter(item => item.type === "routine");
  const routineCompleted = routines.filter(item => item.status === "completed").length;
  const routineMissed = routines.filter(item => item.status === "missed").length;
  const percent = planned.length ? Math.round((completed / planned.length) * 100) : 0;
  const routinePercent = routines.length ? Math.round((routineCompleted / routines.length) * 100) : 0;
  return {
    planned: planned.length, completed, missed, remaining, awaiting, postponed,
    routines: routines.length, routineCompleted, routineMissed,
    routineRemaining: routines.length - routineCompleted - routineMissed, routinePercent, percent
  };
}

function saCalculateWeeklyProgress(startDate = null) {
  const weekItems = saGetWeekItems(startDate);
  const planned = weekItems.filter(item => item.status !== "cancelled");
  const completed = planned.filter(item => item.status === "completed").length;
  const missed = planned.filter(item => item.status === "missed").length;
  const remaining = planned.length - completed - missed;
  const percent = planned.length ? Math.round((completed / planned.length) * 100) : 0;
  return { planned: planned.length, completed, missed, remaining, percent };
}

function saGetAvailableCategories() {
  const normalizeNames = categories => {
    if (!Array.isArray(categories)) return [];
    const names = [];
    const seen = new Set();
    for (const category of categories) {
      const rawName = typeof category === "string" ? category : category?.name;
      if (typeof rawName !== "string") continue;
      const name = rawName.trim();
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    return names;
  };

  const loadedCategories = normalizeNames(window.cloudCategories);
  if (loadedCategories.length) return loadedCategories;
  return normalizeNames(window.defaultCategories);
}

function saGetAvailableItemTypes() {
  return ["activity", "task", "routine"];
}

function saGetAllowedActions() {
  return ["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item", "restore_item", "delete_item"];
}

function saNormalizeTitle(title) { return String(title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function saFindDuplicateGroups(scheduleItems = items) {
  const groups = new Map();
  for (const item of scheduleItems) {
    const key = [saNormalizeTitle(item.title), item.date, item.start || "", item.end || "", item.type].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()].filter(group => group.length > 1).map(group => ({
    classification: "exact_duplicate",
    items: group.sort((a, b) => {
      const created = value => value?.toMillis?.() ?? (value ? new Date(value).getTime() : 0);
      return created(a.createdAt) - created(b.createdAt);
    })
  }));
}

function saItemMatchesScope(item, scope) {
  if (!scope || typeof scope !== "object") return false;
  const type = scope.scopeType;
  const today = localDateString(new Date());
  const monday = parseLocalDate(today); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekStart = localDateString(monday);
  const weekEndDate = new Date(monday); weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEnd = localDateString(weekEndDate);
  let start = scope.startDate || null;
  let end = scope.endDate || start;
  if (type === "today") start = end = today;
  if (type === "tomorrow") { const date = parseLocalDate(today); date.setDate(date.getDate() + 1); start = end = localDateString(date); }
  if (type === "current_week") { start = weekStart; end = weekEnd; }
  if (type === "next_week") { const date = parseLocalDate(weekStart); date.setDate(date.getDate() + 7); start = localDateString(date); date.setDate(date.getDate() + 6); end = localDateString(date); }
  if (type === "future") start = today;
  if (type === "current_month") { start = `${today.slice(0, 7)}-01`; const date = parseLocalDate(start); date.setMonth(date.getMonth() + 1); date.setDate(0); end = localDateString(date); }
  if (type === "absolutely_all") return true;
  if (type === "all_active") return ["upcoming", "in-progress", "postponed", "overdue", "awaiting-check-in"].includes(item.status);
  if (["completed", "missed", "cancelled"].includes(type) && item.status !== type) return false;
  if (type === "overdue" && item.status !== "overdue") return false;
  if (type === "future" && item.date < today) return false;
  if (type === "routines" && item.type !== "routine") return false;
  if (type === "tasks" && item.type !== "task") return false;
  if (type === "activities" && item.type !== "activity") return false;
  if (scope.statuses?.length && !scope.statuses.includes(item.status)) return false;
  if (scope.itemTypes?.length && !scope.itemTypes.includes(item.type)) return false;
  if (scope.categories?.length && !scope.categories.includes(item.category)) return false;
  if (scope.titleQuery && !saNormalizeTitle(item.title).includes(saNormalizeTitle(scope.titleQuery))) return false;
  if (start && item.date < start) return false;
  if (end && item.date > end) return false;
  if (!scope.includeCompleted && item.status === "completed") return false;
  if (!scope.includeCancelled && item.status === "cancelled") return false;
  return true;
}

function saGetRelevantItemsForContext(message, maxItems = 30) {
  const text = String(message || "").toLowerCase();
  const normalizedText = text.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const today = parseLocalDate(localDateString(new Date()));
  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  let constrainedDate = dateMatch?.[1] || null;
  const relative = /\b(today|tomorrow|yesterday)\b/.exec(text);
  if (!constrainedDate && relative) {
    const offset = relative[1] === "tomorrow" ? 1 : relative[1] === "yesterday" ? -1 : 0;
    const date = new Date(today); date.setDate(date.getDate() + offset);
    constrainedDate = localDateString(date);
  }
  if (!constrainedDate) {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const weekday = days.findIndex(day => new RegExp(`\\b${day}\\b`).test(text));
    if (weekday >= 0) {
      let offset = (weekday - today.getDay() + 7) % 7;
      if (/\bnext\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(text) || offset === 0) offset += 7;
      const date = new Date(today); date.setDate(date.getDate() + offset);
      constrainedDate = localDateString(date);
    }
  }
  const titleMatches = items.filter(item => item.title && normalizedText.includes(String(item.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()) && (!constrainedDate || item.date === constrainedDate));
  const dateMatches = constrainedDate ? items.filter(item => item.date === constrainedDate) : [];
  if (titleMatches.length || dateMatches.length) return [...new Map([...titleMatches, ...dateMatches].map(item => [item.id, item])).values()].slice(0, Math.min(maxItems, 20));
  const upcoming = saGetUpcomingItems();
  const candidates = [...saGetTodayItems(), ...upcoming];
  return [...new Map(candidates.map(item => [item.id, item])).values()].slice(0, Math.min(maxItems, 20));
}

function saGetCompactFacts() {
  const today = localDateString(new Date());
  const weekItems = saGetWeekItems(today);
  const dailyMinutes = {};
  for (const item of weekItems) {
    if (!item.start || !item.end) continue;
    const [sh, sm] = item.start.split(":").map(Number);
    const [eh, em] = item.end.split(":").map(Number);
    const minutes = (eh * 60 + em) - (sh * 60 + sm);
    dailyMinutes[item.date] = (dailyMinutes[item.date] || 0) + minutes;
  }
  const postponementCounts = {};
  for (const item of items) {
    if ((item.postponed || 0) > 0) {
      postponementCounts[item.title] = (postponementCounts[item.title] || 0) + item.postponed;
    }
  }
  const conflicts = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(parseLocalDate(today));
    date.setDate(date.getDate() + i);
    const dateStr = localDateString(date);
    for (const conflict of saDetectConflictsForDate(dateStr)) conflicts.push({ date: dateStr, items: [conflict.firstTitle, conflict.secondTitle] });
  }
  return { dailyMinutes, postponementCounts, conflicts };
}

function saGetPlanningItems(planningContext = null) {
  const today = localDateString(new Date());
  const weekItems = saGetWeekItems(today);
  const relevantDates = new Set((planningContext?.proposedItems || []).map(item => item.date).filter(Boolean));
  return [...new Map([...weekItems, ...items.filter(item => relevantDates.has(item.date))].map(item => [item.id, saFormatItemForContext(item)])).values()];
}

function saGetWeeklyAvailabilityFacts() {
  const today = parseLocalDate(localDateString(new Date()));
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekStart = localDateString(monday);
  const weekEndDate = new Date(monday);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEnd = localDateString(weekEndDate);
  const weekItems = items.filter(item => item.date >= weekStart && item.date <= weekEnd);
  const days = [];

  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(monday);
    date.setDate(date.getDate() + offset);
    const dateStr = localDateString(date);
    const dateItems = weekItems.filter(item => item.date === dateStr);
    const timed = dateItems.filter(item => item.start && item.end && item.status !== "cancelled" && item.status !== "completed")
      .sort((a, b) => a.start.localeCompare(b.start));
    const scheduledPeriods = timed.map(item => ({ start: item.start, end: item.end, title: item.title }));
    const openPeriods = [];
    for (let i = 1; i < timed.length; i++) {
      if (timed[i - 1].end < timed[i].start) openPeriods.push({ start: timed[i - 1].end, end: timed[i].start });
    }
    const conflicts = saDetectConflictsForDate(dateStr, dateItems).map(conflict => [conflict.firstTitle, conflict.secondTitle]);
    days.push({
      date: dateStr,
      scheduledPeriods,
      openPeriods,
      untimedTaskCount: dateItems.filter(item => item.type === "task" && !item.start).length,
      conflicts,
      earliestScheduledTime: timed[0]?.start || null,
      latestScheduledTime: timed.length ? timed[timed.length - 1].end : null
    });
  }
  return { weekStart, weekEnd, days };
}

function saValidatePlanAction(action, scheduleItems = items) {
  const actionTypes = saGetAllowedActions();
  if (!action || !actionTypes.includes(action.type)) return "Unsupported plan action";
  if (action.type === "create_item") {
    if (action.targetId) return "Create actions cannot target a saved item";
    if (!action.item) return "Create action is missing its item";
    return scheduleValidateItem(action.item);
  }
  const targetIndex = scheduleItems.findIndex(item => item.id === action.targetId);
  if (!action.targetId || targetIndex < 0) return "Plan target item no longer exists";
  const target = scheduleItems[targetIndex];
  if (action.type === "restore_item") return target.status === "cancelled" ? null : "Only cancelled items can be restored";
  if (action.type === "delete_item") return null;
  if (action.type === "update_item") {
    if (!action.changes || typeof action.changes !== "object") return "Update action is missing changes";
    const changes = Object.fromEntries(Object.entries(action.changes).filter(([, value]) => value !== null && value !== undefined));
    if (!Object.keys(changes).length) return "Update action requires non-empty changes";
    if (action.item) return "Update action cannot replace the complete item";
    if (changes.start && changes.end === undefined && target.start && target.end) {
      const toMinutes = value => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
      const newEnd = toMinutes(changes.start) + toMinutes(target.end) - toMinutes(target.start);
      changes.end = `${String(Math.floor(newEnd / 60) % 24).padStart(2, "0")}:${String(newEnd % 60).padStart(2, "0")}`;
      action.changes.end = changes.end;
    }
    return scheduleValidateItem({ ...target, ...changes });
  }
  if (action.type === "reschedule_item") {
    const changes = action.changes && typeof action.changes === "object" ? Object.fromEntries(Object.entries(action.changes).filter(([, value]) => value !== null && value !== undefined)) : {};
    if (target.type !== "activity" || !Object.keys(changes).some(key => ["date", "start", "end"].includes(key))) return "Reschedule requires date or time changes";
    if (action.item) return "Reschedule must provide changes, not a replacement item";
    if (changes.start && changes.end === undefined && target.start && target.end) {
      const toMinutes = value => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
      const newEnd = toMinutes(changes.start) + toMinutes(target.end) - toMinutes(target.start);
      changes.end = `${String(Math.floor(newEnd / 60) % 24).padStart(2, "0")}:${String(newEnd % 60).padStart(2, "0")}`;
      action.changes.end = changes.end;
    }
    const updated = { ...target, ...changes };
    return scheduleValidateItem(updated);
  }
  if (action.type === "postpone_item" && (!target.start || !target.end || !Number.isInteger(action.postponeMinutes) || action.postponeMinutes < 1)) return "Postpone requires a timed item and positive whole number of minutes";
  return null;
}

async function saApplyPlanAtomically(actions) {
  if (!Array.isArray(actions) || !actions.length || actions.length > 20) return { success: false, error: "A plan must contain between one and twenty actions." };
  const original = items;
  const nextItems = original.map(item => ({ ...item }));
  const changedIds = new Set();
  const deletedIds = new Set();
  const deletedItems = [];
  const originalConflictKeys = new Set(saScheduleConflictKeys(original));

  for (const action of actions) {
    const validationError = saValidatePlanAction(action, nextItems);
    if (validationError) return { success: false, error: validationError };
    if (action.type === "create_item") {
      nextItems.push({
        id: crypto.randomUUID(), title: action.item.title.trim(), date: action.item.date, type: action.item.type,
        start: action.item.start || "", end: action.item.end || "", category: action.item.category || "Personal",
        notes: action.item.notes?.trim() || "", status: "upcoming", postponed: 0,
        ...(action.item.recurrence ? { recurrence: action.item.recurrence } : {})
      });
      changedIds.add(nextItems[nextItems.length - 1].id);
      continue;
    }

    const index = nextItems.findIndex(item => item.id === action.targetId);
    const target = nextItems[index];
    if (action.type === "delete_item") { deletedIds.add(target.id); deletedItems.push({ ...target }); nextItems.splice(index, 1); continue; }
    if (action.type === "update_item") {
      const changes = Object.fromEntries(Object.entries(action.changes).filter(([, value]) => value !== null && value !== undefined));
      nextItems[index] = { ...target, ...changes };
    }
    else if (action.type === "reschedule_item") nextItems[index] = { ...target, ...(action.changes || {}) };
    else if (action.type === "complete_item") nextItems[index] = { ...target, status: "completed" };
    else if (action.type === "mark_missed") nextItems[index] = { ...target, status: "missed" };
    else if (action.type === "cancel_item") nextItems[index] = { ...target, status: "cancelled" };
    else if (action.type === "restore_item") nextItems[index] = { ...target, status: "upcoming" };
    else if (action.type === "postpone_item") {
      const start = parseLocalDate(target.date);
      const [sh, sm] = target.start.split(":").map(Number);
      const [eh, em] = target.end.split(":").map(Number);
      const startDateTime = new Date(start.getFullYear(), start.getMonth(), start.getDate(), sh, sm + action.postponeMinutes);
      const endDateTime = new Date(start.getFullYear(), start.getMonth(), start.getDate(), eh, em + action.postponeMinutes);
      const time = value => `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
      nextItems[index] = { ...target, date: localDateString(startDateTime), start: time(startDateTime), end: time(endDateTime), status: "postponed", postponed: (target.postponed || 0) + 1 };
    }
    changedIds.add(action.targetId);
  }

  for (const item of nextItems) {
    const error = scheduleValidateItem(item);
    if (error) return { success: false, error };
  }
  const introducedConflicts = saScheduleConflictKeys(nextItems).filter(key => !originalConflictKeys.has(key));
  if (introducedConflicts.length) return { success: false, error: "This plan would create a new schedule conflict." };

  try {
    await firebaseStore.writeSchedulePlanBatch(nextItems, [...changedIds], [...deletedIds]);
  } catch {
    return { success: false, error: "The plan could not be saved. No schedule changes were applied." };
  }
  items = nextItems;
  triggerScheduleRender();
  return { success: true, items: nextItems, changedItems: nextItems.filter(item => changedIds.has(item.id)), deletedIds: [...deletedIds], deletedItems };
}

async function saApplyBulkAtomically(bulkAction) {
  if (!bulkAction || !Array.isArray(bulkAction.targetIds) || !bulkAction.targetIds.length || bulkAction.targetIds.length > 450) return { success: false, error: "The bulk operation has no valid targets or exceeds the batch limit." };
  const freshItems = await firebaseStore.loadScheduleItems().catch(() => null);
  if (!freshItems) return { success: false, error: "Could not revalidate the current schedule." };
  const ids = [...new Set(bulkAction.targetIds)];
  const selected = ids.map(id => freshItems.find(item => item.id === id));
  if (selected.some(item => !item) || ids.length !== bulkAction.affectedCount) return { success: false, error: "The schedule changed after this proposal. Review it again." };
  if (selected.some(item => !saItemMatchesScope(item, bulkAction.scope))) return { success: false, error: "One or more items no longer match this scope." };
  const action = bulkAction.type;
  const normalizedAction = action === "deduplicate_items" ? "delete_items" : action;
  if (!["cancel_items", "delete_items", "complete_items", "reschedule_items", "update_items"].includes(normalizedAction)) return { success: false, error: "This bulk operation is not supported." };
  if (normalizedAction === "cancel_items" && selected.some(item => ["cancelled", "completed"].includes(item.status))) return { success: false, error: "A selected item cannot be cancelled in its current state." };
  if (normalizedAction === "complete_items" && selected.some(item => ["completed", "cancelled"].includes(item.status))) return { success: false, error: "A selected item cannot be completed in its current state." };
  if (normalizedAction === "reschedule_items" && selected.some(item => item.type !== "activity")) return { success: false, error: "All selected items must be activities to reschedule them together." };
  const targetIds = new Set(ids);
  const nextItems = freshItems.map(item => {
    if (!targetIds.has(item.id)) return item;
    if (normalizedAction === "cancel_items") return { ...item, status: "cancelled" };
    if (normalizedAction === "complete_items") return { ...item, status: "completed" };
    if (["update_items", "reschedule_items"].includes(normalizedAction)) return { ...item, ...(bulkAction.changes || {}) };
    return item;
  });
  const deletedIds = normalizedAction === "delete_items" ? ids : [];
  const keptItems = normalizedAction === "delete_items" ? nextItems.filter(item => !targetIds.has(item.id)) : nextItems;
  for (const item of selected) if (normalizedAction === "reschedule_items" || normalizedAction === "update_items") {
    const updated = keptItems.find(candidate => candidate.id === item.id);
    const validationError = scheduleValidateItem(updated);
    if (validationError) return { success: false, error: validationError };
  }
  try { await firebaseStore.writeSchedulePlanBatch(keptItems, normalizedAction === "delete_items" ? [] : ids, deletedIds); }
  catch { return { success: false, error: "The bulk change could not be saved. No items were changed." }; }
  items = keptItems;
  triggerScheduleRender();
  return { success: true, items: selected, changedItems: keptItems.filter(item => targetIds.has(item.id)), deletedIds };
}

function saScheduleConflictKeys(scheduleItems) {
  const dates = new Set(scheduleItems.map(item => item.date).filter(Boolean));
  return [...dates].flatMap(date => saDetectConflictsForDate(date, scheduleItems).map(conflict => conflict.pairKey));
}

function saFormatDateForGemini(dateStr) {
  return dateStr;
}

function saFormatItemForContext(item) {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    date: item.date,
    start: item.start || null,
    end: item.end || null,
    category: item.category,
    notes: item.notes,
    status: item.status,
    postponed: item.postponed || 0,
    recurrence: item.recurrence || null
  };
}

setScheduleRenderCallback(function() {
  if (typeof render === "function") render();
});
