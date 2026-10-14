/* Central schedule action engine — single source of truth for schedule mutations */

function scheduleValidateDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(parseLocalDate(value).getTime());
}

function scheduleValidateTime(value) {
  return /^\d{2}:\d{2}$/.test(value) && !isNaN(new Date(`2000-01-01T${value}`).getTime());
}

function scheduleValidateItem(item) {
  if (!item.title || !item.title.trim()) return "Title is required";
  if (!scheduleValidateDate(item.date)) return "Valid date (YYYY-MM-DD) is required";
  if (item.type === "activity") {
    if (!scheduleValidateTime(item.start)) return "Valid start time (HH:mm) is required for activities";
    if (!scheduleValidateTime(item.end)) return "Valid end time (HH:mm) is required for activities";
    if (item.start >= item.end) return "End time must be after start time";
  }
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

function saCreateItem(item) {
  const error = scheduleValidateItem(item);
  if (error) return { success: false, error };
  const newItem = {
    id: crypto.randomUUID(),
    title: item.title.trim(),
    date: item.date,
    type: item.type,
    start: item.start || "",
    end: item.end || "",
    category: item.category || "Personal",
    notes: item.notes?.trim() || "",
    status: "upcoming",
    postponed: 0
  };
  if (item.recurrence) newItem.recurrence = item.recurrence;
  items.push(newItem);
  saveItems(items);
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

function saUpdateItem(id, updates) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  const updated = { ...items[index], ...updates };
  const error = scheduleValidateItem(updated);
  if (error) return { success: false, error };
  items[index] = updated;
  saveItems(items);
  triggerScheduleRender();
  return { success: true, item: updated };
}

function saRescheduleItem(id, newDate, newStart, newEnd) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  const item = items[index];
  if (item.type !== "activity") return { success: false, error: "Only activities can be rescheduled" };
  if (!scheduleValidateDate(newDate)) return { success: false, error: "Valid date (YYYY-MM-DD) is required" };
  if (!scheduleValidateTime(newStart)) return { success: false, error: "Valid start time (HH:mm) is required" };
  if (!scheduleValidateTime(newEnd)) return { success: false, error: "Valid end time (HH:mm) is required" };
  if (newStart >= newEnd) return { success: false, error: "End time must be after start time" };
  items[index] = { ...item, date: newDate, start: newStart, end: newEnd };
  saveItems(items);
  triggerScheduleRender();
  return { success: true, item: items[index] };
}

function saPostponeItem(id, minutes = 15) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  const item = items[index];
  if (!item.start || !item.end) return { success: false, error: "Only timed items can be postponed" };
  const startDate = parseLocalDate(item.date);
  const [sh, sm] = item.start.split(":").map(Number);
  const [eh, em] = item.end.split(":").map(Number);
  const startMs = startDate.getTime() + sh * 3600000 + sm * 60000 + minutes * 60000;
  const endMs = startDate.getTime() + eh * 3600000 + em * 60000 + minutes * 60000;
  const newStart = new Date(startMs);
  const newEnd = new Date(endMs);
  const newDate = localDateString(newStart);
  const newStartTime = `${String(newStart.getHours()).padStart(2, "0")}:${String(newStart.getMinutes()).padStart(2, "0")}`;
  const newEndTime = `${String(newEnd.getHours()).padStart(2, "0")}:${String(newEnd.getMinutes()).padStart(2, "0")}`;
  items[index] = {
    ...item,
    date: newDate,
    start: newStartTime,
    end: newEndTime,
    status: "postponed",
    postponed: (item.postponed || 0) + 1
  };
  saveItems(items);
  triggerScheduleRender();
  return { success: true, item: items[index], postponedMinutes: minutes };
}

function saCompleteItem(id) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  items[index] = { ...items[index], status: "completed" };
  saveItems(items);
  triggerScheduleRender();
  return { success: true, item: items[index] };
}

function saMarkItemMissed(id) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  items[index] = { ...items[index], status: "missed" };
  saveItems(items);
  triggerScheduleRender();
  return { success: true, item: items[index] };
}

function saCancelItem(id) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { success: false, error: "Item not found" };
  items[index] = { ...items[index], status: "cancelled" };
  saveItems(items);
  triggerScheduleRender();
  return { success: true, item: items[index] };
}

function saGetItemsForDate(dateStr) {
  return items.filter(item => item.date === dateStr);
}

function saGetTodayItems() {
  return saGetItemsForDate(localDateString(new Date()));
}

function saGetUpcomingItems() {
  const today = localDateString(new Date());
  return items.filter(item => item.date && item.date >= today && item.status !== "completed" && item.status !== "cancelled");
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

function saDetectConflictsForDate(dateStr) {
  const dateItems = saGetItemsForDate(dateStr);
  return detectConflict(dateItems);
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
  return Object.keys(categoryColors);
}

function saGetAvailableItemTypes() {
  return ["activity", "task", "routine"];
}

function saGetAllowedActions() {
  return ["create_item", "update_item", "reschedule_item", "postpone_item", "complete_item", "mark_missed", "cancel_item"];
}

function saGetRelevantItemsForContext(message, maxItems = 30) {
  const today = localDateString(new Date());
  const todayItemsArr = saGetTodayItems();
  const upcomingItems = saGetUpcomingItems().slice(0, maxItems - todayItemsArr.length);
  return [...todayItemsArr, ...upcomingItems];
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
    const conflict = saDetectConflictsForDate(dateStr);
    if (conflict) conflicts.push({ date: dateStr, items: [conflict[0].title, conflict[1].title] });
  }
  return { dailyMinutes, postponementCounts, conflicts };
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