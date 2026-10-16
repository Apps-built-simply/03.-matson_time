var items = loadItems();

// View state: the month being displayed and the selected date (YYYY-MM-DD)
let calendarCursor = new Date();
let selectedDate = localDateString(new Date());
let attentionCarouselIndex = 0;
let attentionCarouselInitialized = false;
let attentionSelectedItemId = null;
let attentionItems = [];
let cancelTargetId = null;
let cancelTrigger = null;
let cancellationCommitted = false;
let cancelWriteInProgress = false;
let postponeTargetId = null;
let postponeTrigger = null;
let postponeWriteInProgress = false;
let postponeConflictConfirmed = "";
let editingItemId = null;

const scheduleStatusPresentation = {
  upcoming: { label: "Upcoming", className: "upcoming" },
  "in-progress": { label: "In progress", className: "in-progress" },
  completed: { label: "Completed", className: "completed" },
  postponed: { label: "Postponed", className: "postponed" },
  "awaiting-check-in": { label: "Awaiting check-in", className: "awaiting-check-in" },
  overdue: { label: "Overdue", className: "overdue" },
  missed: { label: "Missed", className: "missed" },
  cancelled: { label: "Cancelled", className: "cancelled" }
};

const attentionVisuals = {
  Health: { className: "health", image: "assets/illustrations/health.png" },
  Music: { className: "music", image: "assets/illustrations/music.png" },
  Meetings: { className: "meetings", image: "assets/illustrations/meetings.png" },
  Personal: { className: "personal", image: "assets/illustrations/personal.png" },
  Travel: { className: "travel", image: "assets/illustrations/travel.png" }
};

const els = {
  todayView: document.querySelector("#todayView"), calendarView: document.querySelector("#calendarView"), assistantView: document.querySelector("#assistantView"), progressView: document.querySelector("#progressView"),
  todayMain: document.querySelector("#todayMain"), emptyDay: document.querySelector("#emptyDayState"), emptyAdd: document.querySelector("#emptyAddButton"), attentionSection: document.querySelector("#attentionSection"), todayScheduleSection: document.querySelector("#todayScheduleSection"), dailyProgress: document.querySelector("#dailyProgress"),
  list: document.querySelector("#scheduleList"), count: document.querySelector("#scheduleCount"),
  now: document.querySelector("#nowCard"), conflict: document.querySelector("#conflictNotice"),
  monthYear: document.querySelector("#monthYear"), calendarGrid: document.querySelector("#calendarGrid"), calendarCard: document.querySelector("#calendarCard"),
  calendarDateForm: document.querySelector("#calendarDateForm"), calendarDayInput: document.querySelector("#calendarDayInput"), calendarMonthInput: document.querySelector("#calendarMonthInput"),
  calendarYearInput: document.querySelector("#calendarYearInput"), calendarMonthSuggestions: document.querySelector("#calendarMonthSuggestions"), calendarDateError: document.querySelector("#calendarDateError"),
  selectedTitle: document.querySelector("#selectedDateTitle"), selectedCount: document.querySelector("#selectedCount"),
  selectedSchedule: document.querySelector("#selectedSchedule"), selectedConflict: document.querySelector("#selectedConflict"),
  dialog: document.querySelector("#addDialog"), form: document.querySelector("#addForm"),
  type: document.querySelector("#itemType"), timeFields: document.querySelector("#timeFields"),
  navToday: document.querySelector("#navToday"), navCalendar: document.querySelector("#navCalendar"), navAssistant: document.querySelector("#navAssistant"), navProgress: document.querySelector("#navProgress"), navAdd: document.querySelector("#navAddButton"),
  prevMonth: document.querySelector("#prevMonthButton"), nextMonth: document.querySelector("#nextMonthButton"),
  cancelDialog: document.querySelector("#attentionCancelDialog"), cancelItemTitle: document.querySelector("#cancelItemTitle"),
  cancelItemDate: document.querySelector("#cancelItemDate"), cancelItemTime: document.querySelector("#cancelItemTime"),
  cancelItemCategory: document.querySelector("#cancelItemCategory"), cancelError: document.querySelector("#cancelItemError"),
  confirmCancel: document.querySelector("#confirmCancelItem"), keepCancel: document.querySelector("#keepCancelItem"),
  addDialogTitle: document.querySelector("#addDialogTitle"), recurrenceFrequency: document.querySelector("#recurrenceFrequency"),
  postponeDialog: document.querySelector("#postponeDialog"), postponeForm: document.querySelector("#postponeForm"),
  postponeItemTitle: document.querySelector("#postponeItemTitle"), postponeCurrentDate: document.querySelector("#postponeCurrentDate"),
  postponeCurrentTime: document.querySelector("#postponeCurrentTime"), postponeUnknown: document.querySelector("#postponeUnknown"),
  postponeKnownFields: document.querySelector("#postponeKnownFields"), postponeNewDate: document.querySelector("#postponeNewDate"),
  postponeTimeFields: document.querySelector("#postponeTimeFields"),
  postponeNewStart: document.querySelector("#postponeNewStart"), postponeKeepDuration: document.querySelector("#postponeKeepDuration"),
  postponeNewEnd: document.querySelector("#postponeNewEnd"), postponeNewEndLabel: document.querySelector("#postponeNewEndLabel"),
  postponeDurationLabel: document.querySelector("#postponeDurationLabel"), postponeConflict: document.querySelector("#postponeConflict"),
  postponeError: document.querySelector("#postponeError"), savePostpone: document.querySelector("#savePostponeButton"),
  eventDetailDialog: document.querySelector("#calendarEventDialog"), eventDetailTitle: document.querySelector("#eventDetailTitle"), eventDetailContent: document.querySelector("#eventDetailContent"),
  closeEventDetailButton: document.querySelector("#closeEventDetailButton"), closeEventDetailAction: document.querySelector("#closeEventDetailAction"), editEventDetailButton: document.querySelector("#editEventDetailButton"),
  eventDetailTrigger: null, eventDetailItemId: null
};

const categorySelect = document.querySelector('#addForm select[name="category"]');
if (categorySelect && window.cloudCategories?.length) {
  categorySelect.replaceChildren(...window.cloudCategories.map(category => new Option(category.name, category.name)));
}

// Local date helpers — every YYYY-MM-DD value is built and read in local time
function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLabel(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date not set";
  return new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parseLocalDate(value));
}

function formatTime(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return "Time not set";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour, minute));
}

function itemTime(item) {
  if (item.schedulePending || (!item.date && item.status === "postponed")) return "Time not set";
  if (!item.start) return "Anytime today";
  return item.start ? `${formatTime(item.start)}${item.end ? ` – ${formatTime(item.end)}` : ""}` : "Anytime today";
}

function getAttentionItem(dateItems) {
  const activeItems = dateItems.filter(item => !item.schedulePending && !["completed", "cancelled", "missed"].includes(item.status));
  return activeItems.find(item => item.status === "in-progress") || activeItems.find(item => item.status === "overdue") || activeItems[0] || null;
}

function getAttentionItems(dateItems) {
  const eligibleStatuses = ["in-progress", "overdue", "awaiting-check-in", "upcoming", "postponed"];
  return sortTodayItems(dateItems.filter(item => !item.schedulePending && eligibleStatuses.includes(item.status)));
}

function getInitialTodayHeroItem(heroItems) {
  return heroItems.find(item => item.status === "in-progress")
    || heroItems.find(item => item.status === "overdue")
    || heroItems.find(item => item.status === "awaiting-check-in")
    || heroItems.find(item => item.status === "upcoming" && item.start)
    || heroItems.find(item => item.status === "postponed")
    || heroItems.find(item => !item.start)
    || heroItems[0]
    || null;
}

function resolveTodayState(todayItems, heroItems) {
  if (!todayItems.length) return "empty_day";
  return heroItems.length ? "active_day" : "resolved_day";
}

function timestampOrder(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  if (typeof value.toMillis === "function") return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function stableItemId(item) {
  return String(item.id || "");
}

function sortTodayItems(dateItems) {
    return [...dateItems].sort((a, b) => {
    const aPending = a.schedulePending === true || (!a.date && a.status === "postponed");
    const bPending = b.schedulePending === true || (!b.date && b.status === "postponed");
    if (aPending !== bPending) return aPending ? 1 : -1;
    if (a.date !== b.date) return String(a.date || "9999-12-31").localeCompare(String(b.date || "9999-12-31"));
    const aTimed = Boolean(a.start), bTimed = Boolean(b.start);
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    if (aTimed && a.start !== b.start) return a.start.localeCompare(b.start);
    if (aTimed && (a.end || "").localeCompare(b.end || "")) return (a.end || "").localeCompare(b.end || "");
    const createdDiff = timestampOrder(a.createdAt) - timestampOrder(b.createdAt);
    if (createdDiff) return createdDiff;
    return stableItemId(a).localeCompare(stableItemId(b));
  });
}

function calendarItemTime(item) {
  if (item.schedulePending || (!item.date && item.status === "postponed")) return "Time not set";
  return item.start ? `${formatTime(item.start)}${item.end ? ` – ${formatTime(item.end)}` : ""}` : "Anytime";
}

function scheduleItemNode(item, todayStyle = false, calendarDate = null) {
  const article = document.createElement("article");
  const activeStatuses = ["upcoming", "in-progress", "overdue", "awaiting-check-in", "postponed"];
  const calendarListing = !todayStyle && calendarDate !== null;
  const isTodayCalendarDate = calendarListing && calendarDate === localDateString(new Date());
  const routesToTodayHero = (todayStyle || isTodayCalendarDate) && activeStatuses.includes(item.status) && !item.schedulePending;
  const selectable = (todayStyle && routesToTodayHero) || calendarListing;
  article.className = `schedule-item${selectable ? " is-selectable" : ""}${attentionSelectedItemId === item.id ? " is-hero-selected" : ""}`;
  if (selectable) {
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    article.setAttribute("aria-label", routesToTodayHero ? `Show ${item.title} in Today focus` : `View ${item.title} details`);
    if (routesToTodayHero) article.dataset.todayHeroItem = item.id;
    else if (calendarListing) article.dataset.calendarItem = item.id;
  }
  const content = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = item.title;
  const detail = document.createElement("p");
  if (todayStyle) {
    detail.className = "schedule-meta";
    const time = document.createElement("span");
    time.className = "schedule-time";
    time.textContent = itemTime(item);
    detail.append(time);
  } else {
    detail.textContent = calendarItemTime(item);
  }

  content.append(title, detail);
  const status = document.createElement("span");
  const statusStyle = scheduleStatusPresentation[item.status] || scheduleStatusPresentation.upcoming;
  const statusClass = statusStyle.className;
  status.className = `item-status status-${statusClass}`;
  status.textContent = statusStyle.label;
  article.append(content, status);
  return article;
}

function renderAttention(dateItems, heroItems = getAttentionItems(dateItems)) {
  attentionItems = heroItems;
  if (!attentionItems.length) {
    attentionCarouselIndex = 0;
    attentionSelectedItemId = null;
    attentionCarouselInitialized = false;
    const empty = document.createElement("div");
    empty.className = "attention-empty";
    empty.textContent = "Nothing needs attention right now.";
    els.now.replaceChildren(empty);
    return;
  }
  if (!attentionCarouselInitialized) {
    const current = getInitialTodayHeroItem(attentionItems);
    attentionCarouselIndex = Math.max(0, attentionItems.findIndex(item => item.id === current?.id));
    attentionCarouselInitialized = true;
  } else {
    const selectedIndex = attentionItems.findIndex(item => item.id === attentionSelectedItemId);
    if (selectedIndex >= 0) attentionCarouselIndex = selectedIndex;
    else attentionCarouselIndex = Math.max(0, Math.min(attentionCarouselIndex, attentionItems.length - 1));
  }
  attentionCarouselIndex = Math.max(0, Math.min(attentionCarouselIndex, attentionItems.length - 1));
  const attention = attentionItems[attentionCarouselIndex];
  attentionSelectedItemId = attention.id;
  const categoryName = attention.category || "Personal";
  const visual = attentionVisuals[categoryName] || attentionVisuals.Personal;
  const stage = document.createElement("div");
  stage.className = `attention-hero-stage category-${visual.className}`;
  const article = document.createElement("article");
  article.className = `attention-item attention-hero-card category-${visual.className}`;
  const illustration = document.createElement("img");
  illustration.className = "attention-illustration";
  illustration.src = visual.image;
  illustration.alt = "";
  illustration.setAttribute("aria-hidden", "true");
  illustration.addEventListener("error", () => { illustration.hidden = true; });
  const information = document.createElement("div");
  information.className = "attention-information";
  const title = document.createElement("h3");
  title.textContent = attention.title;
  title.tabIndex = -1;
  const time = document.createElement("p");
  time.textContent = itemTime(attention);
  const pill = document.createElement("span");
  pill.className = "attention-category";
  pill.textContent = categoryName;
  information.append(title, time, pill);
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "attention-cancel";
  cancel.setAttribute("aria-label", "Cancel schedule item");
  cancel.dataset.attentionCancel = attention.id;
  cancel.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  article.append(information, cancel);
  stage.append(article, illustration);

  const actions = document.createElement("div");
  actions.className = "attention-controls";
  const actionGroup = document.createElement("div");
  actionGroup.className = "attention-actions";
  for (const [action, label, className] of [["complete", "Done", "primary-button"], ["postpone", "Postpone", "secondary-button"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.action = action;
    button.dataset.id = attention.id;
    button.textContent = label;
    actionGroup.appendChild(button);
  }
  actions.appendChild(actionGroup);
  const arrows = document.createElement("div");
  arrows.className = "attention-arrows";
  for (const [direction, label, path] of [["previous", "Previous schedule item", "m15 18-6-6 6-6"], ["next", "Next schedule item", "m9 18 6-6-6-6"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "attention-arrow";
    button.setAttribute("aria-label", label);
    button.hidden = attentionItems.length < 2;
    button.dataset.attentionDirection = direction;
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    arrows.appendChild(button);
  }
  actions.appendChild(arrows);
  els.now.replaceChildren(stage, actions);
}

function renderSchedule(dateItems, listEl, conflictEl, emptyText, todayStyle = false, calendarDate = null) {
  if (dateItems.length) listEl.replaceChildren(...dateItems.map(item => scheduleItemNode(item, todayStyle, calendarDate)));
  else {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    listEl.replaceChildren(empty);
  }
  const conflictDate = calendarDate || dateItems.find(item => item.date)?.date;
  const allConflicts = conflictDate ? saDetectConflictsForDate(conflictDate, dateItems) : [];
  const conflicts = calendarDate === null ? allConflicts.slice(0, 1) : allConflicts;
  if (!conflicts.length) { conflictEl.replaceChildren(); return; }
  const notice = document.createElement("div");
  notice.className = "conflict";
  for (const conflict of conflicts) {
    const line = document.createElement("p");
    line.className = "conflict-line";
    line.textContent = `Schedule conflict: ${conflict.firstTitle} overlaps with ${conflict.secondTitle} from ${formatTime(conflict.overlapStart)} to ${formatTime(conflict.overlapEnd)}.`;
    notice.append(line);
  }
  conflictEl.replaceChildren(notice);
}

function renderCalendar(today) {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  els.monthYear.textContent = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(calendarCursor);

  const itemsByDate = new Map();
  for (const item of items) {
    if (!item.date || item.schedulePending) continue;
    if (!itemsByDate.has(item.date)) itemsByDate.set(item.date, []);
    itemsByDate.get(item.date).push(item);
  }

  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0 … Sunday = 6
  const cells = [];
  for (let index = 0; index < 42; index++) {
    const date = new Date(year, month, index - firstWeekday + 1);
    const dateStr = localDateString(date);
    const dateItems = itemsByDate.get(dateStr) || [];
    const classes = ["calendar-day", date.getMonth() !== month ? "other-month" : "", dateStr === today ? "today" : "", dateStr === selectedDate ? "selected" : ""].filter(Boolean).join(" ");
    cells.push(`<button type="button" class="${classes}" data-date="${dateStr}" aria-label="${formatDateLabel(dateStr)}" aria-pressed="${dateStr === selectedDate}"${dateStr === today ? ' aria-current="date"' : ""}><span class="day-number">${date.getDate()}</span></button>`);
  }

  els.calendarGrid.innerHTML = cells.join("");
}

function renderSelectedDate() {
  const dateItems = items.filter(item => item.date === selectedDate && !item.schedulePending);
  els.selectedTitle.textContent = formatDateLabel(selectedDate);
  els.selectedCount.textContent = `${dateItems.length} item${dateItems.length === 1 ? "" : "s"}`;
  renderSchedule(sortTodayItems(dateItems), els.selectedSchedule, els.selectedConflict, "No items planned for this date.", false, selectedDate);
}

function render() {
  const today = localDateString(new Date());
  const todayItems = items.filter(item => item.date === today && !item.schedulePending);
  const heroItems = getAttentionItems(todayItems);
  const todayState = resolveTodayState(todayItems, heroItems);
  els.todayMain.dataset.todayState = todayState;
  const completed = todayItems.filter(item => item.status === "completed").length;
  const remaining = todayItems.filter(item => !["completed", "cancelled"].includes(item.status)).length;
  const hasTodayItems = todayItems.length > 0;
  els.emptyDay.hidden = hasTodayItems;
  els.todayMain.classList.toggle("is-empty", !hasTodayItems);
  els.attentionSection.hidden = !hasTodayItems;
  els.todayScheduleSection.hidden = !hasTodayItems;
  els.dailyProgress.hidden = !hasTodayItems;

  if (hasTodayItems) {
    els.count.textContent = `${todayItems.length} item${todayItems.length === 1 ? "" : "s"}`;
    els.dailyProgress.textContent = `${completed} completed · ${remaining} remaining`;
    renderAttention(todayItems, heroItems);
    renderSchedule(sortTodayItems(todayItems), els.list, els.conflict, "No items planned for today.", true);
  } else {
    attentionItems = [];
    attentionCarouselIndex = 0;
    attentionSelectedItemId = null;
    attentionCarouselInitialized = false;
    els.list.replaceChildren();
    els.now.replaceChildren();
    els.conflict.replaceChildren();
  }
  renderCalendar(today);
  renderSelectedDate();
}

async function completeItem(id) {
  const result = await saCompleteItem(id);
  if (!result.success) {
    alert(`Could not complete item: ${result.error}`);
  }
}

function postponeItem(id, trigger = null) {
  openPostponeDialog(id, trigger);
}

function formatCurrentItemDate(item) {
  return item.schedulePending || !item.date ? "Date not set" : formatDateLabel(item.date);
}

function openPostponeDialog(id, trigger) {
  const item = items.find(candidate => candidate.id === id);
  if (!item || !["upcoming", "in-progress", "overdue", "awaiting-check-in", "postponed"].includes(item.status)) return;
  postponeTargetId = id;
  postponeTrigger = trigger;
  postponeConflictConfirmed = "";
  postponeWriteInProgress = false;
  els.postponeForm.reset();
  els.postponeItemTitle.textContent = item.title;
  els.postponeCurrentDate.textContent = formatCurrentItemDate(item);
  els.postponeCurrentTime.textContent = itemTime(item);
  els.postponeNewDate.value = item.date || "";
  els.postponeNewStart.value = item.start || "";
  els.postponeNewEnd.value = item.end || "";
  const hasDuration = Boolean(item.start && item.end);
  const hasTimes = Boolean(item.start || item.type === "activity");
  els.postponeNewStart.required = hasTimes;
  els.postponeTimeFields.hidden = !hasTimes;
  els.postponeKeepDuration.checked = hasDuration;
  els.postponeDurationLabel.hidden = !hasDuration;
  els.postponeNewEndLabel.hidden = !hasTimes || hasDuration;
  els.postponeNewEnd.required = hasTimes && !hasDuration;
  els.postponeUnknown.checked = false;
  els.postponeConflict.hidden = true;
  els.postponeConflict.textContent = "";
  els.postponeError.hidden = true;
  els.postponeError.textContent = "";
  updatePostponeFormState();
  els.postponeDialog.returnValue = "";
  els.postponeDialog.showModal();
  els.postponeNewDate.focus();
}

function updatePostponeFormState() {
  const pending = els.postponeUnknown.checked;
  els.postponeKnownFields.hidden = pending;
  for (const input of [els.postponeNewDate, els.postponeNewStart, els.postponeNewEnd, els.postponeKeepDuration]) input.disabled = pending;
  const item = items.find(candidate => candidate.id === postponeTargetId);
  els.savePostpone.disabled = !item || Boolean(getPostponeSchedule(item).error);
}

function setPostponeError(message) {
  els.postponeError.textContent = message;
  els.postponeError.hidden = !message;
}

function getPostponeSchedule(item) {
  if (els.postponeUnknown.checked) return { schedulePending: true };
  const date = els.postponeNewDate.value;
  const hasTimes = item.type === "activity" || Boolean(item.start);
  if (!scheduleValidateDate(date)) return { error: "Choose a valid new date." };
  if (!hasTimes) {
    if (!item.schedulePending && date === item.date) return { error: "Choose a new date for this postponement." };
    return { date, start: "", end: "", schedulePending: false };
  }
  const start = els.postponeNewStart.value;
  if (!scheduleValidateTime(start)) return { error: "Choose a valid new start time." };
  let end = "";
  if (els.postponeKeepDuration.checked) {
    if (!item.start || !item.end || !scheduleValidateTime(item.start) || !scheduleValidateTime(item.end)) return { error: "This item has no valid duration to preserve." };
    const [startHour, startMinute] = start.split(":").map(Number);
    const [oldStartHour, oldStartMinute] = item.start.split(":").map(Number);
    const [oldEndHour, oldEndMinute] = item.end.split(":").map(Number);
    const duration = oldEndHour * 60 + oldEndMinute - (oldStartHour * 60 + oldStartMinute);
    const endMinutes = startHour * 60 + startMinute + duration;
    if (duration <= 0 || endMinutes >= 24 * 60) return { error: "The preserved duration would cross midnight. Turn off Keep current duration and choose an end time." };
    end = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
  } else {
    end = els.postponeNewEnd.value;
    if (!scheduleValidateTime(end) || start >= end) return { error: "Choose an end time later than the start time." };
  }
  if (!item.schedulePending && date === item.date && start === item.start && end === item.end) return { error: "Choose a new date or time for this postponement." };
  return { date, start, end, schedulePending: false };
}

function postponeConflictFor(candidate, scheduleItems = items) {
  if (!candidate || candidate.schedulePending || !candidate.date) return null;
  const conflict = saDetectConflictsForDate(candidate.date, [...scheduleItems.filter(item => item.id !== candidate.id), candidate])
    .find(record => record.firstItemId === candidate.id || record.secondItemId === candidate.id);
  return conflict
    ? `Schedule conflict: ${conflict.firstTitle} overlaps with ${conflict.secondTitle} from ${formatTime(conflict.overlapStart)} to ${formatTime(conflict.overlapEnd)}.`
    : null;
}

async function savePostponement(event) {
  event.preventDefault();
  if (postponeWriteInProgress || !postponeTargetId) return;
  const id = postponeTargetId;
  const localItem = items.find(item => item.id === id);
  if (!localItem) { setPostponeError("This item is no longer available."); return; }
  const schedule = getPostponeSchedule(localItem);
  if (schedule.error) { setPostponeError(schedule.error); return; }
  const candidate = {
    ...localItem,
    date: schedule.schedulePending ? "" : schedule.date,
    start: schedule.schedulePending ? "" : schedule.start,
    end: schedule.schedulePending ? "" : schedule.end,
    schedulePending: schedule.schedulePending,
    status: "postponed"
  };
  postponeWriteInProgress = true;
  els.savePostpone.disabled = true;
  setPostponeError("");
  try {
    const persistedItems = await window.firebaseStore.loadScheduleItems();
    const persisted = persistedItems.find(item => item.id === id);
    if (!persisted || persisted.title !== localItem.title || persisted.status !== localItem.status || persisted.date !== localItem.date || persisted.start !== localItem.start || persisted.end !== localItem.end || persisted.schedulePending !== Boolean(localItem.schedulePending) || persisted.postponed !== (localItem.postponed || 0)) {
      throw new Error("This item changed since it was opened. Close this dialog and try again.");
    }
    const conflict = postponeConflictFor(candidate, persistedItems);
    if (conflict && conflict !== postponeConflictConfirmed) {
      els.postponeConflict.textContent = conflict;
      els.postponeConflict.hidden = false;
      els.savePostpone.textContent = "Save anyway";
      postponeConflictConfirmed = conflict;
      postponeWriteInProgress = false;
      updatePostponeFormState();
      return;
    }
    const result = await saPostponeItem(id, schedule);
    if (!result.success) throw new Error(result.error || "Could not save this postponement. Try again.");
    els.postponeDialog.close("saved");
  } catch (error) {
    setPostponeError(error.message || "Could not save this postponement. Check your connection and retry.");
    postponeWriteInProgress = false;
    updatePostponeFormState();
  }
}

function openEditItem(id, sourceDialog = els.postponeDialog) {
  const item = items.find(candidate => candidate.id === id);
  if (!item) return;
  editingItemId = id;
  const form = els.form;
  form.elements.title.value = item.title;
  form.elements.date.value = item.date || "";
  form.elements.type.value = item.type;
  form.elements.start.value = item.start || "";
  form.elements.end.value = item.end || "";
  form.elements.category.value = item.category || "Personal";
  form.elements.notes.value = item.notes || "";
  const recurrence = item.recurrence || null;
  els.recurrenceFrequency.value = recurrence?.frequency || "";
  form.elements.recurrenceInterval.value = String(recurrence?.interval || 1);
  form.elements.recurrenceDays.value = Array.isArray(recurrence?.days) ? recurrence.days.join(", ") : "";
  els.addDialogTitle.textContent = "Edit item";
  els.dialog.querySelector(".eyebrow").textContent = "Update";
  els.dialog.querySelector('[type="submit"]').textContent = "Save changes";
  els.timeFields.hidden = item.type === "task";
  if (sourceDialog?.open) sourceDialog.close("edit");
  els.dialog.showModal();
  form.elements.title.focus();
}

function appendEventDetailRow(labelText, value) {
  const label = document.createElement("dt");
  label.textContent = labelText;
  const description = document.createElement("dd");
  description.textContent = value;
  els.eventDetailContent.append(label, description);
}

function recurrenceLabel(recurrence) {
  if (!recurrence?.frequency) return "Does not repeat";
  const frequency = recurrence.frequency[0].toUpperCase() + recurrence.frequency.slice(1);
  const interval = Math.max(1, Number(recurrence.interval) || 1);
  const cadence = interval === 1 ? frequency : `Every ${interval} ${recurrence.frequency === "daily" ? "days" : recurrence.frequency === "weekly" ? "weeks" : "months"}`;
  if (recurrence.frequency !== "weekly" || !Array.isArray(recurrence.days) || !recurrence.days.length) return cadence;
  return `${cadence} on ${recurrence.days.join(", ")}`;
}

function openCalendarEventDetails(id, trigger) {
  const item = items.find(candidate => candidate.id === id);
  if (!item) return;
  els.eventDetailItemId = id;
  els.eventDetailTrigger = trigger;
  els.eventDetailTitle.textContent = item.title;
  els.eventDetailContent.replaceChildren();
  appendEventDetailRow("Date", formatDateLabel(item.date));
  appendEventDetailRow("Time", calendarItemTime(item));
  appendEventDetailRow("Status", (scheduleStatusPresentation[item.status] || scheduleStatusPresentation.upcoming).label);
  appendEventDetailRow("Category", item.category || "Personal");
  if (item.notes) appendEventDetailRow("Notes", item.notes);
  appendEventDetailRow("Repeat", recurrenceLabel(item.recurrence));
  els.eventDetailDialog.returnValue = "";
  els.eventDetailDialog.showModal();
  els.closeEventDetailAction.focus();
}

function closeCalendarEventDetails(result = "close") {
  if (els.eventDetailDialog.open) els.eventDetailDialog.close(result);
}

// Primary navigation
function setView(nextView) {
  els.todayView.hidden = nextView !== "today";
  els.calendarView.hidden = nextView !== "calendar";
  els.assistantView.hidden = nextView !== "assistant";
  els.progressView.hidden = nextView !== "progress";
  els.navToday.classList.toggle("active", nextView === "today");
  els.navCalendar.classList.toggle("active", nextView === "calendar");
  els.navAssistant.classList.toggle("active", nextView === "assistant");
  els.navProgress.classList.toggle("active", nextView === "progress");
}

els.navToday.addEventListener("click", () => setView("today"));
els.navCalendar.addEventListener("click", () => setView("calendar"));
// Central Add action: bound once during initialization and enabled only after the
// authenticated schedule state has loaded (app.js runs after the first cloud load)
els.navAdd.disabled = false;
els.navAdd.removeAttribute("aria-disabled");
els.navAdd.addEventListener("click", openAddDialog);
els.emptyAdd.addEventListener("click", openAddDialog);
els.navProgress.addEventListener("click", () => setView("progress"));

// Calendar controls
function shiftMonth(delta) {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + delta, 1);
  selectedDate = localDateString(calendarCursor); // select the first day of the displayed month
  render();
}

els.prevMonth.addEventListener("click", () => shiftMonth(-1));
els.nextMonth.addEventListener("click", () => shiftMonth(1));

const calendarMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
let activeMonthSuggestion = -1;

function closeMonthSuggestions() {
  els.calendarMonthSuggestions.hidden = true;
  els.calendarMonthInput.setAttribute("aria-expanded", "false");
  els.calendarMonthInput.removeAttribute("aria-activedescendant");
  activeMonthSuggestion = -1;
}

function setActiveMonthSuggestion(index) {
  const options = [...els.calendarMonthSuggestions.querySelectorAll('[role="option"]')];
  if (!options.length) return;
  activeMonthSuggestion = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => option.setAttribute("aria-selected", String(optionIndex === activeMonthSuggestion)));
  els.calendarMonthInput.setAttribute("aria-activedescendant", options[activeMonthSuggestion].id);
}

function renderMonthSuggestions() {
  const query = els.calendarMonthInput.value.trim().toLocaleLowerCase();
  if (!query) { closeMonthSuggestions(); return; }
  const matches = calendarMonthNames.map((name, index) => ({ name, index })).filter(month => month.name.toLocaleLowerCase().startsWith(query));
  if (!matches.length) { closeMonthSuggestions(); return; }
  els.calendarMonthSuggestions.replaceChildren(...matches.map(({ name, index }) => {
    const option = document.createElement("li");
    option.id = `calendar-month-option-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.dataset.monthIndex = String(index);
    option.textContent = name;
    return option;
  }));
  activeMonthSuggestion = -1;
  els.calendarMonthSuggestions.hidden = false;
  els.calendarMonthInput.setAttribute("aria-expanded", "true");
  setActiveMonthSuggestion(0);
}

function chooseMonthSuggestion(option) {
  if (!option) return;
  els.calendarMonthInput.value = calendarMonthNames[Number(option.dataset.monthIndex)];
  closeMonthSuggestions();
  if (isEnteredCalendarDateValid()) setCalendarDateError("");
}

function monthIndexFromInput(value) {
  const normalized = value.trim().toLocaleLowerCase();
  return calendarMonthNames.findIndex(name => normalized === name.toLocaleLowerCase() || normalized === name.slice(0, 3).toLocaleLowerCase());
}

function setCalendarDateError(message) {
  els.calendarDateError.textContent = message;
  els.calendarDateError.hidden = !message;
}

function isEnteredCalendarDateValid() {
  const dayText = els.calendarDayInput.value.trim();
  const monthIndex = monthIndexFromInput(els.calendarMonthInput.value);
  const yearText = els.calendarYearInput.value.trim();
  const day = Number(dayText), year = Number(yearText);
  if (!/^\d{1,2}$/.test(dayText) || day < 1 || day > 31 || monthIndex < 0 || !/^\d{4}$/.test(yearText) || year < 1900 || year > 2100) return false;
  const candidate = new Date(year, monthIndex, day);
  return candidate.getFullYear() === year && candidate.getMonth() === monthIndex && candidate.getDate() === day;
}

function goToEnteredDate(event) {
  event.preventDefault();
  if (!els.calendarMonthSuggestions.hidden && activeMonthSuggestion >= 0) {
    chooseMonthSuggestion(els.calendarMonthSuggestions.querySelectorAll('[role="option"]')[activeMonthSuggestion]);
  }
  const dayText = els.calendarDayInput.value.trim();
  const monthIndex = monthIndexFromInput(els.calendarMonthInput.value);
  const yearText = els.calendarYearInput.value.trim();
  const day = Number(dayText), year = Number(yearText);
  if (!/^\d{1,2}$/.test(dayText) || day < 1 || day > 31 || monthIndex < 0 || !/^\d{4}$/.test(yearText) || year < 1900 || year > 2100) {
    setCalendarDateError("Enter a valid date.");
    return;
  }
  const candidate = new Date(year, monthIndex, day);
  if (candidate.getFullYear() !== year || candidate.getMonth() !== monthIndex || candidate.getDate() !== day) {
    setCalendarDateError("Enter a valid date.");
    return;
  }
  selectedDate = localDateString(candidate);
  calendarCursor = new Date(year, monthIndex, 1);
  setCalendarDateError("");
  closeMonthSuggestions();
  render();
}

els.calendarMonthInput.addEventListener("input", () => { if (isEnteredCalendarDateValid()) setCalendarDateError(""); renderMonthSuggestions(); });
els.calendarMonthInput.addEventListener("keydown", event => {
  if (event.key === "ArrowDown" && !els.calendarMonthSuggestions.hidden) { event.preventDefault(); setActiveMonthSuggestion(activeMonthSuggestion + 1); }
  else if (event.key === "ArrowUp" && !els.calendarMonthSuggestions.hidden) { event.preventDefault(); setActiveMonthSuggestion(activeMonthSuggestion <= 0 ? els.calendarMonthSuggestions.children.length - 1 : activeMonthSuggestion - 1); }
  else if (event.key === "Enter" && !els.calendarMonthSuggestions.hidden && activeMonthSuggestion >= 0) {
    event.preventDefault();
    chooseMonthSuggestion(els.calendarMonthSuggestions.querySelectorAll('[role="option"]')[activeMonthSuggestion]);
  } else if (event.key === "Escape" && !els.calendarMonthSuggestions.hidden) { event.preventDefault(); closeMonthSuggestions(); }
});
els.calendarMonthSuggestions.addEventListener("pointerdown", event => event.preventDefault());
document.addEventListener("pointerdown", event => {
  if (!els.calendarDateForm.contains(event.target)) closeMonthSuggestions();
});
els.calendarMonthSuggestions.addEventListener("click", event => {
  const option = event.target.closest('[role="option"]');
  if (option) chooseMonthSuggestion(option);
});
for (const input of [els.calendarDayInput, els.calendarYearInput]) {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, input === els.calendarDayInput ? 2 : 4);
    if (isEnteredCalendarDateValid()) setCalendarDateError("");
  });
}
els.calendarDateForm.addEventListener("submit", goToEnteredDate);

els.calendarGrid.addEventListener("click", event => {
  const day = event.target.closest(".calendar-day");
  if (!day) return;
  selectedDate = day.dataset.date;
  const date = parseLocalDate(selectedDate);
  calendarCursor = new Date(date.getFullYear(), date.getMonth(), 1); // adjacent-month dates navigate to their month
  render();
});

document.addEventListener("click", event => {
  const attentionArrow = event.target.closest("[data-attention-direction]");
  if (attentionArrow && attentionItems.length > 1) {
    const step = attentionArrow.dataset.attentionDirection === "previous" ? -1 : 1;
    attentionCarouselIndex = (attentionCarouselIndex + step + attentionItems.length) % attentionItems.length;
    attentionSelectedItemId = attentionItems[attentionCarouselIndex].id;
    render();
    return;
  }
  const cancel = event.target.closest("[data-attention-cancel]");
  if (cancel) {
    openAttentionCancel(cancel);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "complete") completeItem(button.dataset.id);
  if (button.dataset.action === "postpone") postponeItem(button.dataset.id, button);
});

function selectTodayHeroItem(id) {
  const index = attentionItems.findIndex(item => item.id === id);
  if (index < 0) return;
  attentionCarouselIndex = index;
  attentionSelectedItemId = id;
  setView("today");
  render();
  els.now.querySelector(".attention-item h3")?.focus({ preventScroll: true });
  els.attentionSection.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

els.list.addEventListener("click", event => {
  const row = event.target.closest("[data-today-hero-item]");
  if (row) selectTodayHeroItem(row.dataset.todayHeroItem);
});
els.list.addEventListener("keydown", event => {
  const row = event.target.closest("[data-today-hero-item]");
  if (!row || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  selectTodayHeroItem(row.dataset.todayHeroItem);
});

function handleCalendarScheduleActivation(event) {
  const row = event.target.closest("[data-today-hero-item], [data-calendar-item]");
  if (!row) return;
  if (event.type === "keydown") {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
  }
  if (row.dataset.todayHeroItem) selectTodayHeroItem(row.dataset.todayHeroItem);
  else openCalendarEventDetails(row.dataset.calendarItem, row);
}

els.selectedSchedule.addEventListener("click", handleCalendarScheduleActivation);
els.selectedSchedule.addEventListener("keydown", handleCalendarScheduleActivation);
els.closeEventDetailButton.addEventListener("click", () => closeCalendarEventDetails());
els.closeEventDetailAction.addEventListener("click", () => closeCalendarEventDetails());
els.editEventDetailButton.addEventListener("click", () => {
  const id = els.eventDetailItemId;
  if (id) openEditItem(id, els.eventDetailDialog);
});
els.eventDetailDialog.addEventListener("click", event => {
  if (event.target === els.eventDetailDialog) closeCalendarEventDetails();
});
els.eventDetailDialog.addEventListener("close", () => {
  const trigger = els.eventDetailTrigger;
  const wasEdit = els.eventDetailDialog.returnValue === "edit";
  els.eventDetailTrigger = null;
  els.eventDetailItemId = null;
  if (!wasEdit && trigger?.isConnected) trigger.focus();
});

function openAttentionCancel(trigger) {
  const item = items.find(candidate => candidate.id === trigger.dataset.attentionCancel);
  if (!item || ["cancelled", "completed"].includes(item.status)) return;
  cancelTargetId = item.id;
  cancelTrigger = trigger;
  cancellationCommitted = false;
  els.cancelItemTitle.textContent = item.title;
  els.cancelItemDate.textContent = formatDateLabel(item.date);
  els.cancelItemTime.textContent = itemTime(item);
  els.cancelItemCategory.textContent = item.category || "Personal";
  els.cancelError.hidden = true;
  els.cancelError.textContent = "";
  els.confirmCancel.disabled = false;
  els.keepCancel.disabled = false;
  els.cancelDialog.showModal();
  els.keepCancel.focus();
}

async function confirmAttentionCancel() {
  if (cancelWriteInProgress || !cancelTargetId) return;
  const targetId = cancelTargetId;
  cancelWriteInProgress = true;
  els.confirmCancel.disabled = true;
  els.keepCancel.disabled = true;
  els.cancelError.hidden = true;
  try {
    const localItem = items.find(item => item.id === targetId);
    if (!localItem || ["cancelled", "completed"].includes(localItem.status)) {
      throw new Error("This item is no longer available to cancel.");
    }
    const persistedItems = await window.firebaseStore.loadScheduleItems();
    const persistedItem = persistedItems.find(item => item.id === targetId);
    if (!persistedItem || ["cancelled", "completed"].includes(persistedItem.status)) {
      throw new Error("This item has changed or no longer exists. Your schedule was not changed.");
    }
    const result = await saCancelItem(targetId);
    if (!result.success) throw new Error(result.error || "Could not cancel this item.");
    cancellationCommitted = true;
    els.cancelDialog.close();
  } catch (error) {
    els.cancelError.textContent = error.message || "Could not cancel this item. Your schedule was not changed.";
    els.cancelError.hidden = false;
    els.confirmCancel.disabled = false;
    els.keepCancel.disabled = false;
  } finally {
    cancelWriteInProgress = false;
  }
}

els.confirmCancel.addEventListener("click", confirmAttentionCancel);
els.keepCancel.addEventListener("click", () => { if (!cancelWriteInProgress) els.cancelDialog.close(); });
els.cancelDialog.addEventListener("click", event => { if (event.target === els.cancelDialog && !cancelWriteInProgress) els.cancelDialog.close(); });
els.cancelDialog.addEventListener("cancel", event => { if (cancelWriteInProgress) event.preventDefault(); });
els.cancelDialog.addEventListener("close", () => {
  if (!cancellationCommitted && cancelTrigger?.isConnected) cancelTrigger.focus();
  cancelTargetId = null;
  cancelTrigger = null;
  cancellationCommitted = false;
});

const guidanceDialog = document.querySelector("#guidanceDialog");
const guidanceTitle = document.querySelector("#guidanceTitle");
const guidanceList = document.querySelector("#guidanceList");
let guidanceTrigger = null;
const guidanceCopy = {
  today: ["Today", ["See what needs attention now.", "Move through attention items using the arrows.", "Mark an item done, postpone it, or cancel it.", "Review the complete schedule below."]],
  calendar: ["Calendar", ["Select a date to see its schedule.", "Use the month controls to move between months.", "Dates with scheduled items show the existing calendar indicators."]],
  assistant: ["Assistant", [
    "Ask questions about your schedule.",
    "Give natural instructions to create, change, postpone, cancel, or complete items.",
    "Review proposed changes before they are saved.",
    "Open Chats to return to an earlier conversation.",
    "Start a new conversation for a separate topic.",
    "Voice input will be added later."
  ]],
  progress: ["Progress", ["View Today or This week.", "Review completion and unresolved items.", "Select a week within the current month.", "Review routine completion across Monday to Sunday.", "Expand a day to inspect its schedule."]]
};
document.addEventListener("click", event => {
  const trigger = event.target.closest("[data-guidance]");
  if (!trigger) return;
  const guidance = guidanceCopy[trigger.dataset.guidance];
  if (!guidance) return;
  guidanceTrigger = trigger;
  guidanceTitle.textContent = guidance[0];
  guidanceList.replaceChildren(...guidance[1].map(text => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
  guidanceDialog.showModal();
});
document.querySelector("#closeGuidanceButton").addEventListener("click", () => guidanceDialog.close());
guidanceDialog.addEventListener("click", event => { if (event.target === guidanceDialog) guidanceDialog.close(); });
guidanceDialog.addEventListener("close", () => guidanceTrigger?.focus());

function openAddDialog() {
  editingItemId = null;
  els.form.reset();
  els.form.date.value = localDateString(new Date());
  els.addDialogTitle.textContent = "Add new item";
  els.dialog.querySelector(".eyebrow").textContent = "Create";
  els.dialog.querySelector('[type="submit"]').textContent = "Save item";
  els.timeFields.hidden = false;
  els.dialog.showModal();
  els.form.elements.title.focus();
}

document.querySelector("#closeAddButton").addEventListener("click", () => els.dialog.close());
els.dialog.addEventListener("close", () => { editingItemId = null; });
els.type.addEventListener("change", () => { els.timeFields.hidden = els.type.value === "task"; });
els.form.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(els.form);
  const recurrenceFrequency = data.get("recurrenceFrequency");
  let recurrence = null;
  if (recurrenceFrequency) {
    const rawDays = String(data.get("recurrenceDays") || "").trim();
    const days = rawDays ? rawDays.split(",").map(value => Number(value.trim())) : [];
    if (days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
      els.form.elements.recurrenceDays.setCustomValidity("Enter weekdays as numbers from 0 to 6, separated by commas.");
      els.form.elements.recurrenceDays.reportValidity();
      return;
    }
    els.form.elements.recurrenceDays.setCustomValidity("");
    recurrence = { frequency: recurrenceFrequency, interval: Number(data.get("recurrenceInterval")) || 1, days };
  }
  const updates = {
    title: data.get("title").trim(),
    date: data.get("date"),
    type: data.get("type"),
    start: data.get("start"),
    end: data.get("end"),
    category: data.get("category"),
    notes: data.get("notes").trim(),
    recurrence,
    schedulePending: false
  };
  const result = editingItemId
    ? await saUpdateItem(editingItemId, updates)
    : await saCreateItem({ ...updates, status: "upcoming", postponed: 0 });
  if (!result.success) {
    if (els.form.reportValidity()) alert(`Could not save item: ${result.error}`);
    return;
  }
  els.form.reset();
  els.form.date.value = localDateString(new Date());
  els.timeFields.hidden = false;
  els.dialog.close();
  render();
});

document.querySelector("#postponeForm").addEventListener("input", () => {
  postponeConflictConfirmed = "";
  els.savePostpone.textContent = "Save postponement";
  els.postponeConflict.hidden = true;
  setPostponeError("");
  updatePostponeFormState();
});
els.postponeUnknown.addEventListener("change", () => {
  postponeConflictConfirmed = "";
  els.savePostpone.textContent = "Save postponement";
  els.postponeConflict.hidden = true;
  setPostponeError("");
  updatePostponeFormState();
});
els.postponeKeepDuration.addEventListener("change", () => {
  els.postponeNewEndLabel.hidden = els.postponeKeepDuration.checked;
  els.postponeNewEnd.required = !els.postponeKeepDuration.checked;
  updatePostponeFormState();
});
els.postponeForm.addEventListener("submit", savePostponement);
document.querySelector("#cancelPostponeButton").addEventListener("click", () => { if (!postponeWriteInProgress) els.postponeDialog.close("cancel"); });
document.querySelector("#closePostponeButton").addEventListener("click", () => { if (!postponeWriteInProgress) els.postponeDialog.close("cancel"); });
document.querySelector("#editPostponedItem").addEventListener("click", () => { if (postponeTargetId && !postponeWriteInProgress) openEditItem(postponeTargetId); });
els.postponeDialog.addEventListener("click", event => { if (event.target === els.postponeDialog && !postponeWriteInProgress) els.postponeDialog.close("cancel"); });
els.postponeDialog.addEventListener("cancel", event => { if (postponeWriteInProgress) event.preventDefault(); });
els.postponeDialog.addEventListener("close", () => {
  if (els.postponeDialog.returnValue !== "edit" && els.postponeDialog.returnValue !== "saved" && postponeTrigger?.isConnected) postponeTrigger.focus();
  postponeTargetId = null;
  postponeTrigger = null;
  postponeWriteInProgress = false;
  postponeConflictConfirmed = "";
});

render();
