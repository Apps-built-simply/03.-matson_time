var items = loadItems();

// View state: the month being displayed and the selected date (YYYY-MM-DD)
let calendarCursor = new Date();
let selectedDate = localDateString(new Date());
let attentionCarouselIndex = 0;
let attentionCarouselInitialized = false;
let attentionSelectedItemId = null;
let attentionRenderSignature = null;
let attentionItems = [];
let attentionUnderlineAnimatedItemId = null;
let cancelTargetId = null;
let cancelTrigger = null;
let cancellationCommitted = false;
let cancelWriteInProgress = false;
let postponeTargetId = null;
let postponeTrigger = null;
let postponeWriteInProgress = false;
let postponeConflictConfirmed = "";
let editingItemId = null;
let addWriteInProgress = false;
let addConflictConfirmed = "";

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
  Health: { className: "health", image: "assets/animations/matson-health-animation.svg" },
  Music: { className: "music", image: "assets/animations/matson-music-animation.svg" },
  Meetings: { className: "meetings", image: "assets/animations/matson-meetings-animation.svg" },
  Personal: { className: "personal", image: "assets/animations/matson-personal-animation.svg" },
  Travel: { className: "travel", image: "assets/illustrations/travel.png" }
};
const failedAttentionVisualAssets = new Set();

const els = {
  todayView: document.querySelector("#todayView"), calendarView: document.querySelector("#calendarView"), assistantView: document.querySelector("#assistantView"), progressView: document.querySelector("#progressView"),
  todayMain: document.querySelector("#todayMain"), emptyDay: document.querySelector("#emptyDayState"), emptyAdd: document.querySelector("#emptyAddButton"), scheduleCat: document.querySelector("#scheduleCat"), attentionSection: document.querySelector("#attentionSection"), todayScheduleSection: document.querySelector("#todayScheduleSection"),
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

els.scheduleCat.addEventListener("error", () => {
  els.scheduleCat.hidden = true;
  console.error("Matson Time Today schedule illustration failed to load.");
}, { once: true });

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
  const isSelectedTodayHero = todayStyle && routesToTodayHero && attentionSelectedItemId === item.id;
  article.className = `schedule-item${selectable ? " is-selectable" : ""}${isSelectedTodayHero ? " is-hero-selected" : ""}`;
  if (isSelectedTodayHero) {
    const visual = attentionVisuals[item.category] || attentionVisuals.Personal;
    article.style.setProperty("--selected-category-accent", `var(--category-${visual.className})`);
    if (attentionUnderlineAnimatedItemId !== item.id) {
      article.classList.add("is-category-separator-entering");
      attentionUnderlineAnimatedItemId = item.id;
    }
  }
  if (selectable) {
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    article.setAttribute("aria-label", isSelectedTodayHero ? `Current focus item: ${item.title}` : routesToTodayHero ? `Show ${item.title} in Today focus` : `View ${item.title} details`);
    if (isSelectedTodayHero) article.setAttribute("aria-current", "true");
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
    attentionRenderSignature = null;
    attentionUnderlineAnimatedItemId = null;
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
  const renderSignature = JSON.stringify([attention.id, attention.title, itemTime(attention), categoryName, visual.image, attentionItems.length]);
  if (renderSignature === attentionRenderSignature && els.now.querySelector(".attention-hero-card")) return;
  attentionRenderSignature = renderSignature;
  const stage = document.createElement("div");
  stage.className = `attention-hero-stage category-${visual.className}`;
  const article = document.createElement("article");
  article.className = `attention-item attention-hero-card category-${visual.className}`;
  const illustration = document.createElement("img");
  illustration.className = "attention-illustration";
  illustration.src = visual.image;
  illustration.decoding = "async";
  illustration.draggable = false;
  illustration.alt = "";
  illustration.setAttribute("aria-hidden", "true");
  illustration.addEventListener("error", () => {
    illustration.hidden = true;
    if (!failedAttentionVisualAssets.has(visual.image)) {
      failedAttentionVisualAssets.add(visual.image);
      console.error("Matson Time Today hero illustration failed to load.");
    }
  }, { once: true });
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
  if (visual.className === "personal") {
    const personalAnimationWrapper = document.createElement("div");
    personalAnimationWrapper.className = "personal-animation-wrapper";
    personalAnimationWrapper.append(illustration);
    stage.append(article, personalAnimationWrapper);
  } else {
    stage.append(article, illustration);
  }

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
  const hasTodayItems = todayItems.length > 0;
  const isResolvedDay = todayState === "resolved_day";
  els.emptyDay.hidden = todayState === "active_day";
  els.emptyDay.classList.toggle("is-resolved", isResolvedDay);
  if (isResolvedDay) {
    els.emptyDay.removeAttribute("aria-labelledby");
    els.emptyDay.setAttribute("aria-label", "Nothing needs your attention right now.");
  } else {
    els.emptyDay.setAttribute("aria-labelledby", "emptyDayTitle");
    els.emptyDay.removeAttribute("aria-label");
  }
  els.emptyDay.querySelector("#emptyDayTitle").hidden = isResolvedDay;
  els.emptyDay.querySelector("#emptyDayCopy").textContent = isResolvedDay
    ? "Nothing needs your attention right now."
    : "Nothing is scheduled for today.";
  els.todayMain.classList.toggle("is-empty", !hasTodayItems);
  els.attentionSection.hidden = todayState !== "active_day";
  els.todayScheduleSection.hidden = !hasTodayItems;

  if (hasTodayItems) {
    els.count.textContent = `${todayItems.length} item${todayItems.length === 1 ? "" : "s"}`;
    renderAttention(todayItems, heroItems);
    renderSchedule(sortTodayItems(todayItems), els.list, els.conflict, "No items planned for today.", true);
  } else {
    attentionItems = [];
    attentionCarouselIndex = 0;
    attentionSelectedItemId = null;
    attentionUnderlineAnimatedItemId = null;
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
  addConflictConfirmed = "";
  clearAddFormError();
  document.querySelector("#saveItemButton").disabled = false;
  document.querySelector("#saveItemButton").textContent = "Save changes";
  if (window.customSelectType) window.customSelectType.sync(false);
  if (window.customSelectFrequency) window.customSelectFrequency.sync(false);
  if (window.customSelectCategory) window.customSelectCategory.sync(false);
  updateDateDisplay(form.elements.date.value);
  updateTimeDisplay("start", form.elements.start.value);
  updateTimeDisplay("end", form.elements.end.value);
  updateCategorySwatch(form.elements.category.value);
  updateWeekdayButtons(recurrence?.days || []);
  updateFieldVisibility(item.type);
  els.addDialogTitle.textContent = "Edit item";
  els.dialog.querySelector(".eyebrow").textContent = "Update";
  els.dialog.querySelector('[type="submit"]').textContent = "Save changes";
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
  // Centralized access gate: Progress is disabled while the feature flag is
  // false. Returning early keeps the current route, footer state, history and
  // saved navigation state untouched, and throws nothing.
  if (nextView === "progress" && !MATSON_FEATURES.progressAccess) return;
  if (nextView !== "assistant" && typeof window.closeQuickQuestions === "function") {
    window.closeQuickQuestions();
  }
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

// ===========================================================================
// Shared popover manager — only one form popover open at a time (select, date,
// start time, end time). Handles outside click, Escape, dialog close, reset.
// ===========================================================================

let openPopover = null;
const popovers = new Set();

function registerPopover(element) { popovers.add(element); }
function unregisterPopover(element) { popovers.delete(element); }

function closeAllPopovers(restoreFocusTo = null) {
  if (openPopover) { openPopover.close(); openPopover = null; }
  if (restoreFocusTo) restoreFocusTo.focus({ preventScroll: true });
}

function openPopoverAt(popover) {
  if (openPopover && openPopover !== popover) openPopover.close();
  openPopover = popover;
}

function bindPopoverDocumentHandlers() {
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && openPopover) { event.preventDefault(); openPopover.close(); openPopover = null; }
  });
  document.addEventListener("pointerdown", event => {
    if (!openPopover) return;
    const target = event.target;
    if (target === openPopover.trigger || target === openPopover.panel) return;
    if (target.closest && (target.closest(".popover") || target.closest(".option-panel"))) return;
    openPopover.close(); openPopover = null;
  });
}

bindPopoverDocumentHandlers();




// Shared custom dropdown widget instance manager.
class CustomSelect {
  constructor(trigger, panel, nativeSelect, labelId) {
    this.trigger = trigger;
    this.panel = panel;
    this.native = nativeSelect;
    this.labelId = labelId;
    this.isOpen = false;

    const options = panel.querySelectorAll(".option-row");
    options.forEach((option, index) => {
      option.addEventListener("click", () => this.choose(index));
    });

    this.sync();
    this.trigger.addEventListener("click", () => this.toggle());
  }

  // Refresh trigger text/swatch and selected-row state from the native <select>.
  sync(emitChange = true) {
    const index = this.native.selectedIndex;
    const option = this.native.options[index];
    if (!option) return;
    this.trigger.querySelector(".field-display").textContent = option.textContent.trim();
    if (emitChange) this.native.dispatchEvent(new Event("change", { bubbles: true }));
  }

  open() {
    if (this.isOpen) return;
    openPopoverAt(this);
    this.isOpen = true;
    this.trigger.setAttribute("aria-expanded", "true");
    positionPanel(this.panel, this.trigger);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
    if (openPopover === this) openPopover = null;
  }

  toggle() {
    if (this.isOpen) this.close(); else this.open();
  }

  choose(index) {
    const options = this.panel.querySelectorAll(".option-row");
    if (index < 0 || index >= options.length) return;
    const option = options[index];
    const value = option.dataset.value;
    this.native.value = value;
    this.native.selectedIndex = index;
    this.sync();
    this.close();
  }
}

function initCustomSelects() {
  const typeSelect = document.querySelector("#itemType");
  const freqSelect = document.querySelector("#recurrenceFrequency");
  const catSelect = document.querySelector("#itemCategory");

  if (typeSelect && document.querySelector("#typePanel")) {
    window.customSelectType = new CustomSelect(
      document.querySelector("#typeTrigger"),
      document.querySelector("#typePanel"),
      typeSelect,
      "itemTypeLabel"
    );
  }
  if (freqSelect && document.querySelector("#frequencyPanel")) {
    window.customSelectFrequency = new CustomSelect(
      document.querySelector("#recurrenceFrequencyTrigger"),
      document.querySelector("#frequencyPanel"),
      freqSelect,
      "recurrenceFrequencyLabel"
    );
  }
  if (catSelect && document.querySelector("#categoryPanel")) {
    window.customSelectCategory = new CustomSelect(
      document.querySelector("#categoryTrigger"),
      document.querySelector("#categoryPanel"),
      catSelect,
      "categoryLabel"
    );
    renderCategoryOptions();
  }
}

function renderCategoryOptions() {
  const panel = document.querySelector("#categoryPanel");
  if (!panel) return;
  const list = Array.isArray(window.cloudCategories) ? window.cloudCategories : [];
  panel.replaceChildren();
  list.forEach((cat, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option-row";
    button.setAttribute("role", "option");
    button.dataset.value = cat.name;
    button.dataset.index = String(index);
    const swatch = document.createElement("span");
    swatch.className = "category-swatch";
    swatch.style.backgroundColor = /^#[0-9a-fA-F]{3,8}$/.test(String(cat.color || "")) ? cat.color : "";
    swatch.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = cat.name;
    button.appendChild(swatch);
    button.appendChild(label);
    panel.appendChild(button);
  });
  panel.querySelectorAll(".option-row").forEach((option, index) => {
    option.addEventListener("click", () => {
      window.customSelectCategory.choose(index);
    });
  });
  if (window.customSelectCategory) window.customSelectCategory.sync();
}

function positionPanel(panel, trigger) {
  // 1. Make panel measurable without visually flashing in the wrong position.
  panel.classList.add("popover-measuring");
  panel.hidden = false;

  // 2. Read trigger bounding rectangle.
  const triggerRect = trigger.getBoundingClientRect();

  // 3. Read popover measured height/width while in measurement state.
  const popoverRect = panel.getBoundingClientRect();

  // 4. Read current visual viewport dimensions.
  const vv = window.visualViewport;
  const viewportWidth = vv ? vv.width : window.innerWidth;
  const viewportHeight = vv ? vv.height : window.innerHeight;
  const viewportTop = vv ? vv.offsetTop : 0;
  const viewportBottom = viewportTop + viewportHeight;

  const margin = 12; // safe viewport margin (~12px)
  const triggerGap = 8; // gap between trigger and popover

  const popoverHeight = popoverRect.height || 0;
  const popoverWidth = popoverRect.width || 0;

  // 5. Calculate available space below the trigger.
  const spaceBelow = viewportBottom - margin - triggerRect.bottom;
  // 6. Calculate available space above the trigger.
  const spaceAbove = triggerRect.top - (viewportTop + margin);

  // 7. Choose the better direction.
  let openAbove = false;
  let availableHeight = 0;

  if (spaceBelow >= popoverHeight) {
    openAbove = false;
    availableHeight = spaceBelow;
  } else if (spaceAbove >= popoverHeight) {
    openAbove = true;
    availableHeight = spaceAbove;
  } else {
    // Neither side fits completely — use the side with more space.
    openAbove = spaceAbove >= spaceBelow;
    availableHeight = Math.max(spaceAbove, spaceBelow);
  }

  // 8. Clamp horizontal position within visible viewport + safe margin.
  let left = triggerRect.left;
  if (left + popoverWidth > viewportTop + viewportWidth - margin) {
    left = viewportTop + viewportWidth - margin - popoverWidth;
  }
  if (left < margin) {
    left = margin;
  }

  // 9. Apply final top, left, and width.
  let top;
  if (openAbove) {
    top = triggerRect.top - popoverHeight - triggerGap;
    top = Math.max(top, viewportTop + margin);
  } else {
    top = triggerRect.bottom + triggerGap;
    top = Math.min(top, viewportBottom - margin - popoverHeight);
  }

  panel.style.top = Math.round(top) + "px";
  panel.style.left = Math.round(left) + "px";
  panel.style.width = Math.round(popoverWidth) + "px";

  // Constrain popover height when it cannot fit completely above or below.
  if (availableHeight > 0 && availableHeight < popoverHeight) {
    panel.style.maxHeight = Math.round(availableHeight) + "px";
    panel.style.overflowY = "auto";
  } else {
    panel.style.maxHeight = "";
    panel.style.overflowY = "";
  }

  // 10. Reveal the popover.
  panel.classList.remove("popover-measuring");
}

let rafId = null;
function repositionOpenPopover() {
  if (!openPopover || !openPopover.panel) return;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    positionPanel(openPopover.panel, openPopover.trigger);
    rafId = null;
  });
}

window.addEventListener("scroll", repositionOpenPopover, true);
window.addEventListener("resize", repositionOpenPopover, true);
window.addEventListener("orientationchange", repositionOpenPopover, true);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", repositionOpenPopover, true);
}

// Initialize custom selects after DOM is ready
initCustomSelects();

function openAddDialog() {
  editingItemId = null;
  els.form.reset();
  addConflictConfirmed = "";
  clearAddFormError();
  const category = els.form.elements.category;
  if (Array.from(category.options).some(option => option.value === "Personal")) category.value = "Personal";
  else if (category.options.length) category.selectedIndex = 0;
  els.form.elements.type.value = "activity";
  els.recurrenceFrequency.value = "";
  els.form.elements.recurrenceInterval.value = "1";
  els.form.elements.start.value = "";
  els.form.elements.end.value = "";
  window.customSelectType?.sync(false);
  window.customSelectFrequency?.sync(false);
  window.customSelectCategory?.sync(false);
  els.form.date.value = localDateString(new Date());
  updateDateDisplay(els.form.date.value);
  updateTimeDisplay("start", "");
  updateTimeDisplay("end", "");
  updateWeekdayButtons([]);
  updateCategorySwatch(category.value);
  els.addDialogTitle.textContent = "Add new item";
  els.dialog.querySelector(".eyebrow").textContent = "Create";
  document.querySelector("#saveItemButton").textContent = "Save item";
  document.querySelector("#saveItemButton").disabled = false;
  updateFieldVisibility("activity");
  els.dialog.showModal();
  els.form.elements.title.focus();
}

window.openGuidedAddDialog = values => {
  openAddDialog();
  const form = els.form.elements;
  form.type.value = values.itemType || "activity";
  form.title.value = values.title || "";
  form.date.value = values.date || localDateString(new Date());
  form.start.value = values.start || "";
  form.end.value = values.end || "";
  form.category.value = values.category || "Personal";
  form.notes.value = values.notes || "";
  form.recurrenceFrequency.value = values.recurrence?.frequency || "";
  form.recurrenceInterval.value = String(values.recurrence?.interval || 1);
  updateFieldVisibility(form.type.value);
  updateDateDisplay(form.date.value);
  updateTimeDisplay("start", form.start.value);
  updateTimeDisplay("end", form.end.value);
  updateWeekdayButtons(values.recurrence?.days || []);
  updateCategorySwatch(form.category.value);
  window.customSelectType?.sync(false);
  window.customSelectFrequency?.sync(false);
  window.customSelectCategory?.sync(false);
  form.title.focus();
};

document.querySelector("#closeAddButton").addEventListener("click", () => { if (!addWriteInProgress) els.dialog.close(); });
els.dialog.addEventListener("cancel", event => { if (addWriteInProgress) event.preventDefault(); });
els.dialog.addEventListener("close", () => {
  editingItemId = null;
  addConflictConfirmed = "";
  closeAllPopovers();
  window.guidedAddDialogClosed?.();
});
els.type.addEventListener("change", () => {
  updateFieldVisibility(els.type.value);
});
document.querySelector("#itemCategory").addEventListener("change", event => updateCategorySwatch(event.currentTarget.value));

// ── Field visibility by item type ──────────────────────────────────────────

function updateFieldVisibility(type) {
  const isTask = type === "task";

  // Close time popovers when time fields become hidden.
  if (isTask) {
    closeTimePicker("start");
    closeTimePicker("end");
  }

  els.timeFields.hidden = isTask;
  if (isTask) {
    els.form.elements.start.value = "";
    els.form.elements.end.value = "";
    els.recurrenceFrequency.value = "";
    els.form.elements.recurrenceInterval.value = "1";
    updateWeekdayButtons([]);
    window.customSelectFrequency?.sync(false);
    updateTimeDisplay("start", "");
    updateTimeDisplay("end", "");
  }

  // Recurrence: always show the fieldset header; details depend on frequency
  const frequency = els.recurrenceFrequency.value;
  updateFrequencyVisibility(frequency, isTask);
}

function updateFrequencyVisibility(frequency, isTask = false) {
  const hasRepeat = Boolean(frequency);
  const isWeekly = frequency === "weekly";
  const isDailyOrWeeklyOrMonthly = frequency === "daily" || frequency === "weekly" || frequency === "monthly";
  if (!isWeekly) updateWeekdayButtons([]);

  // Every control: only when repeating
  document.querySelector("#everyControl").hidden = !hasRepeat;

  // Unit label
  const unitEl = document.querySelector("#everyUnit");
  if (unitEl) {
    if (frequency === "daily") unitEl.textContent = "day(s)";
    else if (frequency === "weekly") unitEl.textContent = "week(s)";
    else if (frequency === "monthly") unitEl.textContent = "month(s)";
  }

  // Weekday selector: only weekly
  document.querySelector("#weekdaySelector").hidden = !(isWeekly && hasRepeat);

  // Monthly control: only monthly
  document.querySelector("#monthlyControl").hidden = !(frequency === "monthly" && hasRepeat);

  // For tasks, hide recurrence details entirely (tasks don't repeat in this version)
  if (isTask) {
    document.querySelector("#everyControl").hidden = true;
    document.querySelector("#weekdaySelector").hidden = true;
    document.querySelector("#monthlyControl").hidden = true;
  }
}

// ── Display updates ────────────────────────────────────────────────────────

function updateDateDisplay(dateString) {
  const display = document.querySelector("#dateDisplay");
  const hidden = document.querySelector("#dateHidden");
  if (!display || !hidden) return;
  hidden.value = dateString;
  if (!dateString) {
    display.textContent = "Select date";
    return;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!m) { display.textContent = dateString; return; }
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  display.textContent = new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function updateTimeDisplay(field, timeString) {
  const display = document.querySelector(`#${field}TimeDisplay`);
  const hidden = document.querySelector(`#${field}Hidden`);
  const clearBtn = document.querySelector(`#${field}TimeClear`);
  if (!display || !hidden) return;
  hidden.value = timeString || "";
  if (!timeString) {
    display.textContent = "Select time";
    if (clearBtn) clearBtn.hidden = true;
    return;
  }
  const m = /^(\d{2}):(\d{2})$/.exec(timeString);
  if (!m) { display.textContent = timeString; return; }
  let hour = Number(m[1]); const minute = Number(m[2]);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  display.textContent = `${displayHour}:${String(minute).padStart(2,"0")} ${ampm}`;
  if (clearBtn) clearBtn.hidden = false;
}

function updateCategorySwatch(categoryName) {
  const swatch = document.querySelector("#categorySwatch");
  const list = Array.isArray(window.cloudCategories) ? window.cloudCategories : [];
  const match = list.find(c => c && c.name === categoryName);
  const color = match && /^#[0-9a-fA-F]{3,8}$/.test(String(match.color || "")) ? match.color : "#14B8A6";
  if (swatch) swatch.style.backgroundColor = color;
}

function updateWeekdayButtons(days) {
  const daySet = new Set(Array.isArray(days) ? days : []);
  document.querySelectorAll(".weekday-button").forEach(btn => {
    const d = Number(btn.dataset.day);
    btn.setAttribute("aria-pressed", String(daySet.has(d)));
  });
}

// ── Form submit ────────────────────────────────────────────────────────────

function clearAddFormError() {
  const error = document.querySelector("#addFormError");
  if (error) { error.textContent = ""; error.hidden = true; }
  els.form.querySelectorAll("[aria-invalid='true']").forEach(control => control.removeAttribute("aria-invalid"));
}

function showAddFormError(message, control = null) {
  const error = document.querySelector("#addFormError");
  if (error) { error.textContent = message; error.hidden = false; }
  if (control) {
    control.setAttribute("aria-invalid", "true");
    control.focus();
  }
}

function validateAddForm(values) {
  const title = els.form.elements.title;
  const dateTrigger = document.querySelector("#dateTrigger");
  const startTrigger = document.querySelector("#startTimeTrigger");
  const endTrigger = document.querySelector("#endTimeTrigger");
  const categoryTrigger = document.querySelector("#categoryTrigger");
  const frequencyTrigger = document.querySelector("#recurrenceFrequencyTrigger");
  const type = values.type;
  if (!values.title.trim()) return { message: "Enter a title.", control: title };
  if (!values.date || !scheduleValidateDate(values.date)) return { message: "Select a date.", control: dateTrigger };
  if (!values.category || !saGetAvailableCategories().includes(values.category)) return { message: "Select a category.", control: categoryTrigger };
  if (!(["activity", "task", "routine"].includes(type))) return { message: "Select an item type.", control: document.querySelector("#typeTrigger") };
  if (type === "activity") {
    if (!values.start || !scheduleValidateTime(values.start)) return { message: "Select a start time.", control: startTrigger };
    if (!values.end || !scheduleValidateTime(values.end)) return { message: "Select an end time.", control: endTrigger };
    if (values.end <= values.start) return { message: "End time must be later than start time.", control: endTrigger };
  }
  if (type === "routine" && !values.recurrenceFrequency) return { message: "Select a frequency.", control: frequencyTrigger };
  if (type !== "task" && values.recurrenceFrequency) {
    if (!["daily", "weekly", "monthly"].includes(values.recurrenceFrequency)) return { message: "Select a valid frequency.", control: frequencyTrigger };
    const interval = Number(values.recurrenceInterval);
    if (!Number.isInteger(interval) || interval < 1 || interval > 365) return { message: "Enter a valid recurrence interval.", control: els.form.elements.recurrenceInterval };
    if (values.recurrenceFrequency === "weekly" && !values.days.length) return { message: "Select at least one weekday.", control: document.querySelector(".weekday-button") };
  }
  return null;
}

els.form.addEventListener("submit", async event => {
  event.preventDefault();
  if (addWriteInProgress) return;
  try {
  closeAllPopovers();
  clearAddFormError();
  // Custom controls use native fields as their source of truth. Synchronize
  // displays and weekday buttons before constructing the one submit payload.
  window.customSelectType?.sync(false);
  window.customSelectFrequency?.sync(false);
  window.customSelectCategory?.sync(false);
  const selectedDays = Array.from(document.querySelectorAll(".weekday-button[aria-pressed='true']"))
    .map(button => Number(button.dataset.day));
  const data = new FormData(els.form);
  const recurrenceFrequency = String(data.get("recurrenceFrequency") || "");
  let recurrence = null;
  if (recurrenceFrequency && data.get("type") !== "task") {
    recurrence = {
      frequency: recurrenceFrequency,
      interval: Number(data.get("recurrenceInterval")) || 1,
      days: selectedDays
    };
  }
  const values = {
    title: String(data.get("title") || ""), date: String(data.get("date") || ""), type: String(data.get("type") || ""),
    start: data.get("type") === "task" ? "" : String(data.get("start") || ""),
    end: data.get("type") === "task" ? "" : String(data.get("end") || ""),
    category: String(data.get("category") || ""), notes: String(data.get("notes") || ""),
    recurrenceFrequency, recurrenceInterval: String(data.get("recurrenceInterval") || "1"), days: selectedDays
  };
  const invalid = validateAddForm(values);
  if (invalid) { showAddFormError(invalid.message, invalid.control); return; }
  const updates = {
    title: values.title.trim(), date: values.date, type: values.type,
    start: values.start, end: values.end, category: values.category,
    notes: values.notes.trim(),
    recurrence,
    schedulePending: false
  };
  const candidate = { ...(editingItemId ? items.find(item => item.id === editingItemId) : {}), ...updates, id: editingItemId || "__new_add_item__", status: editingItemId ? (items.find(item => item.id === editingItemId)?.status || "upcoming") : "upcoming" };
  const conflict = candidate.date && candidate.start && candidate.end
    ? saDetectConflictsForDate(candidate.date, [...items.filter(item => item.id !== editingItemId), candidate]).find(item => item.firstItemId === candidate.id || item.secondItemId === candidate.id)
    : null;
  const conflictKey = conflict ? `${candidate.date}|${candidate.start}|${candidate.end}|${conflict.pairKey}` : "";
  if (conflict && conflictKey !== addConflictConfirmed) {
    addConflictConfirmed = conflictKey;
    const otherTitle = conflict.firstItemId === candidate.id ? conflict.secondTitle : conflict.firstTitle;
    showAddFormError(`Schedule conflict: ${candidate.title} overlaps with ${otherTitle} from ${formatTime(conflict.overlapStart)} to ${formatTime(conflict.overlapEnd)}. Revise the time or select Save anyway.`);
    document.querySelector("#saveItemButton").textContent = "Save anyway";
    return;
  }
  const saveButton = document.querySelector("#saveItemButton");
  addWriteInProgress = true;
  saveButton.disabled = true;
  saveButton.setAttribute("aria-busy", "true");
  saveButton.textContent = "Saving…";
  document.querySelector("#closeAddButton").disabled = true;
  let result;
  try {
    result = editingItemId
      ? await saUpdateItem(editingItemId, updates)
      : await saCreateItem({ ...updates, status: "upcoming", postponed: 0 });
  } catch {
    console.error(editingItemId ? "schedule_update_failed" : "schedule_create_failed");
    result = { success: false };
  } finally {
    addWriteInProgress = false;
    saveButton.removeAttribute("aria-busy");
    document.querySelector("#closeAddButton").disabled = false;
  }
  if (!result?.success) {
    saveButton.disabled = false;
    saveButton.textContent = addConflictConfirmed ? "Save anyway" : (editingItemId ? "Save changes" : "Save item");
    showAddFormError("The item could not be saved. Try again.");
    return;
  }
  if (result.item && typeof window.refreshAssistantScheduleItem === "function") {
    window.refreshAssistantScheduleItem(result.item, editingItemId ? "updated" : "created");
  }
  if (!editingItemId && result.item) await window.completeGuidedAddFromForm?.(result.item);
  els.form.reset();
  editingItemId = null;
  addConflictConfirmed = "";
  els.form.date.value = localDateString(new Date());
  updateDateDisplay(els.form.date.value);
  els.form.elements.type.value = "activity";
  els.recurrenceFrequency.value = "";
  els.form.elements.recurrenceInterval.value = "1";
  window.customSelectType?.sync(false);
  window.customSelectFrequency?.sync(false);
  window.customSelectCategory?.sync(false);
  updateTimeDisplay("start", "");
  updateTimeDisplay("end", "");
  updateWeekdayButtons([]);
  clearAddFormError();
  updateFieldVisibility("activity");
  els.dialog.close();
  } catch {
    console.error("[schedule-save] add_validation_exception");
    addWriteInProgress = false;
    const saveButton = document.querySelector("#saveItemButton");
    saveButton.disabled = false;
    saveButton.removeAttribute("aria-busy");
    saveButton.textContent = editingItemId ? "Save changes" : "Save item";
    document.querySelector("#closeAddButton").disabled = false;
    showAddFormError("The item could not be saved. Try again.");
  }
});

els.form.addEventListener("input", () => {
  clearAddFormError();
  addConflictConfirmed = "";
  const button = document.querySelector("#saveItemButton");
  if (button && !addWriteInProgress) button.textContent = editingItemId ? "Save changes" : "Save item";
});
els.form.addEventListener("change", () => {
  clearAddFormError();
  addConflictConfirmed = "";
  const button = document.querySelector("#saveItemButton");
  if (button && !addWriteInProgress) button.textContent = editingItemId ? "Save changes" : "Save item";
});

// ── Date picker ────────────────────────────────────────────────────────────

let datePickerState = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: "" };

function openDatePicker() {
  const trigger = document.querySelector("#dateTrigger");
  const panel = document.querySelector("#datePopover");
  const hidden = document.querySelector("#dateHidden");
  datePickerState.selected = hidden.value || "";
  const now = new Date();
  if (!datePickerState.selected) {
    datePickerState.year = now.getFullYear();
    datePickerState.month = now.getMonth();
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(datePickerState.selected);
    if (m) { datePickerState.year = Number(m[1]); datePickerState.month = Number(m[2]) - 1; }
  }
  renderDateGrid();
  openPopoverAt({ trigger, panel, close: closeDatePicker });
  positionPanel(panel, trigger);
  trigger.setAttribute("aria-expanded", "true");
}

function closeDatePicker() {
  const panel = document.querySelector("#datePopover");
  const trigger = document.querySelector("#dateTrigger");
  panel.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  if (openPopover && openPopover.panel === panel) openPopover = null;
}

function renderDateGrid() {
  const year = datePickerState.year;
  const month = datePickerState.month;
  document.querySelector("#dateMonthYear").textContent = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(year, month, 1));
  const daysContainer = document.querySelector("#dateDays");
  daysContainer.replaceChildren();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  const prevDays = new Date(year, month, 0).getDate();
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevDays - i;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "date-day other-month";
    btn.textContent = d;
    const pm = month === 0 ? 11 : month - 1;
    const py = month === 0 ? year - 1 : year;
    btn.dataset.date = `${py}-${String(pm + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    btn.addEventListener("click", () => { datePickerState.year = py; datePickerState.month = pm; renderDateGrid(); });
    daysContainer.appendChild(btn);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "date-day";
    btn.textContent = d;
    const dateStr = `${year}-${String(month + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    btn.dataset.date = dateStr;
    if (dateStr === datePickerState.selected) btn.classList.add("is-selected");
    if (dateStr === todayStr) btn.classList.add("is-today");
    btn.addEventListener("click", () => selectDate(dateStr));
    daysContainer.appendChild(btn);
  }
  const totalCells = 42;
  const nextStart = daysInMonth + firstDay;
  for (let d = 1; nextStart + d - 1 < totalCells; d++) {
    const nm = month === 11 ? 0 : month + 1;
    const ny = month === 11 ? year + 1 : year;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "date-day other-month";
    btn.textContent = d;
    btn.dataset.date = `${ny}-${String(nm + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    btn.addEventListener("click", () => { datePickerState.year = ny; datePickerState.month = nm; renderDateGrid(); });
    daysContainer.appendChild(btn);
  }
}

function selectDate(dateStr) {
  datePickerState.selected = dateStr;
  const hidden = document.querySelector("#dateHidden");
  hidden.value = dateStr;
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
  updateDateDisplay(dateStr);
  renderDateGrid();
  closeDatePicker();
}

document.querySelector("#datePrevMonth").addEventListener("click", () => {
  datePickerState.month--;
  if (datePickerState.month < 0) { datePickerState.month = 11; datePickerState.year--; }
  renderDateGrid();
});
document.querySelector("#dateNextMonth").addEventListener("click", () => {
  datePickerState.month++;
  if (datePickerState.month > 11) { datePickerState.month = 0; datePickerState.year++; }
  renderDateGrid();
});
document.querySelector("#dateToday").addEventListener("click", () => {
  const now = new Date();
  const todayStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  selectDate(todayStr);
});
document.querySelector("#dateClear").addEventListener("click", () => {
  const hidden = document.querySelector("#dateHidden");
  hidden.value = "";
  updateDateDisplay("");
  closeDatePicker();
});
document.querySelector("#closeDatePopover").addEventListener("click", closeDatePicker);
document.querySelector("#dateTrigger").addEventListener("click", openDatePicker);

// ── Time picker (shared) ───────────────────────────────────────────────────

let timePickerState = { field: "", hour: 1, minute: 0, ampm: "AM" };

function openTimePicker(field) {
  const trigger = document.querySelector(`#${field}TimeTrigger`);
  const panel = document.querySelector(`#${field}TimePopover`);
  const hidden = document.querySelector(`#${field}Hidden`);
  timePickerState.field = field;
  const current = hidden.value || "";
  if (current) {
    const m = /^(\d{2}):(\d{2})/.exec(current);
    if (m) {
      let h = Number(m[1]); const min = Number(m[2]);
      timePickerState.ampm = h >= 12 ? "PM" : "AM";
      timePickerState.hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      timePickerState.minute = min;
    }
  } else {
    timePickerState.hour = 1; timePickerState.minute = 0; timePickerState.ampm = "AM";
  }
  renderTimePicker();
  openPopoverAt({ trigger, panel, close: () => closeTimePicker(field) });
  positionPanel(panel, trigger);
  trigger.setAttribute("aria-expanded", "true");
}

function closeTimePicker(field) {
  const panel = document.querySelector(`#${field}TimePopover`);
  const trigger = document.querySelector(`#${field}TimeTrigger`);
  panel.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  if (openPopover && openPopover.panel === panel) openPopover = null;
}

function renderTimePicker() {
  const { hour, minute, ampm } = timePickerState;
  document.querySelectorAll("#startHourScroll .time-hour, #endHourScroll .time-hour").forEach(btn => {
    btn.classList.toggle("is-selected", Number(btn.dataset.value) === hour);
  });
  document.querySelectorAll("#startMinuteScroll .time-minute, #endMinuteScroll .time-minute").forEach(btn => {
    btn.classList.toggle("is-selected", btn.dataset.value === String(minute).padStart(2, "0"));
  });
  document.querySelectorAll("#startAmPmScroll .time-ampm, #endAmPmScroll .time-ampm").forEach(btn => {
    btn.classList.toggle("is-selected", btn.dataset.value === ampm);
  });
}

function setTimeValue(type, value) {
  if (type === "hour") timePickerState.hour = Number(value);
  else if (type === "minute") timePickerState.minute = Number(value);
  else if (type === "ampm") timePickerState.ampm = value;
  renderTimePicker();
}

function confirmTimePicker() {
  const { field, hour, minute, ampm } = timePickerState;
  const h24 = ampm === "PM" ? (hour === 12 ? 12 : hour + 12) : (hour === 12 ? 0 : hour);
  const timeStr = `${String(h24).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
  const hidden = document.querySelector(`#${field}Hidden`);
  hidden.value = timeStr;
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
  updateTimeDisplay(field, timeStr);
  closeTimePicker(field);
}

function clearTimePicker(field) {
  const hidden = document.querySelector(`#${field}Hidden`);
  hidden.value = "";
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
  updateTimeDisplay(field, "");
  const clearBtn = document.querySelector(`#${field}TimeClear`);
  if (clearBtn) clearBtn.hidden = true;
  closeTimePicker(field);
}

for (const field of ["start", "end"]) {
  document.querySelectorAll(`#${field}HourScroll .time-hour`).forEach(btn => {
    btn.addEventListener("click", () => setTimeValue("hour", btn.dataset.value));
  });
  document.querySelectorAll(`#${field}MinuteScroll .time-minute`).forEach(btn => {
    btn.addEventListener("click", () => setTimeValue("minute", btn.dataset.value));
  });
  document.querySelectorAll(`#${field}AmPmScroll .time-ampm`).forEach(btn => {
    btn.addEventListener("click", () => setTimeValue("ampm", btn.dataset.value));
  });
  document.querySelector(`#${field}TimeConfirm`).addEventListener("click", () => confirmTimePicker());
  document.querySelector(`#${field}TimeClear`).addEventListener("click", () => clearTimePicker(field));
  document.querySelector(`#${field}TimeTrigger`).addEventListener("click", () => openTimePicker(field));
  document.querySelector(`#close${field.charAt(0).toUpperCase() + field.slice(1)}TimePopover`).addEventListener("click", () => closeTimePicker(field));
}

document.querySelector("#startTimeClear").hidden = true;
document.querySelector("#endTimeClear").hidden = true;

// ── Weekday selector ───────────────────────────────────────────────────────

document.querySelectorAll(".weekday-button").forEach(btn => {
  btn.addEventListener("click", () => {
    const pressed = btn.getAttribute("aria-pressed") === "true";
    btn.setAttribute("aria-pressed", String(!pressed));
    clearAddFormError();
    addConflictConfirmed = "";
    document.querySelector("#saveItemButton").textContent = editingItemId ? "Save changes" : "Save item";
  });
});

// ── Frequency change ───────────────────────────────────────────────────────

if (window.customSelectFrequency) {
  const origChoose = window.customSelectFrequency.choose.bind(window.customSelectFrequency);
  window.customSelectFrequency.choose = (index) => {
    origChoose(index);
    const freq = document.querySelector("#recurrenceFrequency").value;
    updateFrequencyVisibility(freq, els.type.value === "task");
  };
}

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
