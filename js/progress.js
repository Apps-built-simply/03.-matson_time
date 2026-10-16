/* Progress page — factual schedule summary. No scoring or judgment.
   Routes: Today | This week. Completion = completed / planned × 100 with
   cancelled items excluded from planned. All dates are built from local
   calendar components (Africa/Kampala, UTC+3, no DST) — never via UTC
   conversion, so week boundaries stay Monday–Sunday without day shifts. */

const PROGRESS_VIEW_KEY = "matson-time-progress-view-v1";

const progressEls = {
  view: document.querySelector("#progressView"),
  todayRoute: document.querySelector("#progressTodayRoute"),
  weekRoute: document.querySelector("#progressWeekRoute"),
  todayButton: document.querySelector("#progressTodayButton"),
  weekButton: document.querySelector("#progressWeekButton"),
  error: document.querySelector("#progressError"),
  retryButton: document.querySelector("#progressRetryButton"),
  todayHeadline: document.querySelector("#progressTodayHeadline"),
  todayPercent: document.querySelector("#progressTodayPercent"),
  todayLine: document.querySelector("#progressTodayLine"),
  todayBreakdown: document.querySelector("#progressTodayBreakdown"),
  todayStats: document.querySelector("#progressTodayStats"),
  weekSelectorButton: document.querySelector("#weekSelectorButton"),
  weekSelectorLabel: document.querySelector("#weekSelectorLabel"),
  weekPopup: document.querySelector("#weekSelectorPopup"),
  weekPopupMonth: document.querySelector("#weekPopupMonth"),
  weekPrevMonth: document.querySelector("#weekPrevMonth"),
  weekNextMonth: document.querySelector("#weekNextMonth"),
  weekOptions: document.querySelector("#weekOptionsList"),
  weekRange: document.querySelector("#weekRange"),
  weekHeadline: document.querySelector("#progressWeekHeadline"),
  weekPercent: document.querySelector("#progressWeekPercent"),
  weekLine: document.querySelector("#progressWeekLine"),
  weekBreakdown: document.querySelector("#progressWeekBreakdown"),
  weekStats: document.querySelector("#progressWeekStats"),
  routineGrid: document.querySelector("#routineGrid"),
  routineGridEmpty: document.querySelector("#routineGridEmpty"),
  dayList: document.querySelector("#progressDayList")
};

const progressShortDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const progressMonthName = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });

// Session-scoped preference: "today" | "week" ("daily"/"weekly" are legacy values)
let progressRoute = loadProgressRoute();
// Selected week inside This week: the Monday of the week plus the month used to number it
let selectedWeekMonday;
let selectedWeekMonth;
// Month currently browsed inside the week selector popup
let popupMonth;
// Temporary Progress UI state (never persisted): expanded Day-by-day rows and
// the last week rendered, used to collapse rows when the selected week changes
let progressExpandedDays = new Set();
let progressRenderedWeekKey = null;

function loadProgressRoute() {
  try {
    const stored = sessionStorage.getItem(PROGRESS_VIEW_KEY);
    return stored === "week" || stored === "weekly" ? "week" : "today";
  } catch { return "today"; }
}

function saveProgressRoute() {
  try { sessionStorage.setItem(PROGRESS_VIEW_KEY, progressRoute); } catch { /* storage may be unavailable */ }
}
// Local-date helpers — every date is constructed from calendar components, never UTC
function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d;
}

function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

// Monday-to-Sunday weeks intersecting the given local month, in order
function weeksIntersectingMonth(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const weeks = [];
  let monday = startOfWeek(first);
  while (monday <= last) {
    weeks.push({ monday: new Date(monday), sunday: addDays(monday, 6) });
    monday = addDays(monday, 7);
  }
  return weeks;
}

// Index of a week within a month's intersecting weeks, or -1 when absent
function weekIndexOf(monday, monthContext) {
  const key = localDateString(monday);
  return weeksIntersectingMonth(monthContext.year, monthContext.month)
    .findIndex(week => localDateString(week.monday) === key);
}

function initSelectedWeek() {
  const today = new Date();
  selectedWeekMonday = startOfWeek(today);
  selectedWeekMonth = { year: today.getFullYear(), month: today.getMonth() };
  popupMonth = { ...selectedWeekMonth };
}

// Period summaries built from the shared schedule store (items is global in app.js)
const progressKnownStatuses = new Set(["upcoming", "in-progress", "overdue", "completed", "missed", "cancelled", "postponed", "awaiting-check-in"]);

function summarize(dateItems) {
  const list = (Array.isArray(dateItems) ? dateItems : []).map(item => ({
    status: item && progressKnownStatuses.has(item.status) ? item.status : "upcoming"
  }));
  const completed = list.filter(entry => entry.status === "completed").length;
  const missed = list.filter(entry => entry.status === "missed").length;
  const postponed = list.filter(entry => entry.status === "postponed").length;
  const awaiting = list.filter(entry => entry.status === "awaiting-check-in").length;
  const cancelled = list.filter(entry => entry.status === "cancelled").length;
  // Cancelled items are excluded from total planned
  const planned = list.length - cancelled;
  // Remaining = upcoming, in-progress, overdue, postponed
  const remaining = list.filter(entry => ["upcoming", "in-progress", "overdue", "postponed"].includes(entry.status)).length;
  return { planned, completed, remaining, postponed, missed, awaiting, cancelled, percent: safePercent(completed, planned) };
}

// completed / total planned × 100 — null when there is nothing planned
function safePercent(completed, total) {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return null;
  const ratio = completed / total;
  if (!Number.isFinite(ratio)) return null;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}
function renderSummaryBlock(headlineEl, percentEl, lineEl, summary, emptyText) {
  const fill = lineEl.querySelector("span");
  if (summary.planned <= 0 || summary.percent === null) {
    headlineEl.textContent = emptyText;
    percentEl.hidden = true;
    lineEl.hidden = true;
    lineEl.setAttribute("aria-valuenow", "0");
    if (fill) fill.style.width = "0%";
    return;
  }
  headlineEl.textContent = `${summary.completed} of ${summary.planned} completed`;
  percentEl.hidden = false;
  percentEl.textContent = `${summary.percent}% complete`;
  lineEl.hidden = false;
  lineEl.setAttribute("aria-valuenow", String(summary.percent));
  if (fill) fill.style.width = `${summary.percent}%`;
}

// Compact status rows — only relevant or non-zero statuses, never one card per count
function renderStats(listEl, sectionEl, summary) {
  const rows = [];
  if (summary.planned > 0) {
    rows.push(["Completed", summary.completed, "completed"]);
    rows.push(["Remaining", summary.remaining, ""]);
  }
  if (summary.postponed > 0) rows.push(["Postponed", summary.postponed, "postponed"]);
  if (summary.missed > 0) rows.push(["Missed", summary.missed, "missed"]);
  if (summary.awaiting > 0) rows.push(["Awaiting check-in", summary.awaiting, "awaiting"]);
  if (summary.cancelled > 0) rows.push(["Cancelled", summary.cancelled, "cancelled"]);
  listEl.replaceChildren(...rows.map(([label, value, colorClass]) => {
    const row = document.createElement("li");
    const name = document.createElement("span");
    name.className = "stat-label";
    name.textContent = label;
    const count = document.createElement("span");
    count.className = colorClass ? `stat-value ${colorClass}` : "stat-value";
    count.textContent = String(value);
    row.append(name, count);
    return row;
  }));
  sectionEl.hidden = rows.length === 0;
}

function itemsInPeriod(startStr, endStr) {
  return items.filter(item => item && !item.schedulePending && item.date && item.date >= startStr && item.date <= endStr);
}

// Today route
function renderTodayRoute() {
  const today = localDateString(new Date());
  const summary = summarize(itemsInPeriod(today, today));
  renderSummaryBlock(progressEls.todayHeadline, progressEls.todayPercent, progressEls.todayLine, summary, "Nothing was planned for today.");
  renderStats(progressEls.todayStats, progressEls.todayBreakdown, summary);
}

// This week route
function renderWeekRoute() {
  const monday = selectedWeekMonday;
  const sunday = addDays(monday, 6);
  const weekKey = localDateString(monday);
  if (progressRenderedWeekKey !== weekKey) {
    // A newly selected week starts with every day row collapsed
    progressExpandedDays.clear();
    progressRenderedWeekKey = weekKey;
  }
  let context = selectedWeekMonth;
  let index = weekIndexOf(monday, context);
  if (index < 0) {
    context = { year: monday.getFullYear(), month: monday.getMonth() };
    selectedWeekMonth = context;
    index = Math.max(0, weekIndexOf(monday, context));
  }
  progressEls.weekSelectorLabel.textContent = `Week ${index + 1} of ${progressMonthName.format(new Date(context.year, context.month, 1))}`;
  progressEls.weekRange.textContent = `${progressShortDate.format(monday)} – ${progressShortDate.format(sunday)}, ${sunday.getFullYear()}`;

  const summary = summarize(itemsInPeriod(localDateString(monday), localDateString(sunday)));
  renderSummaryBlock(progressEls.weekHeadline, progressEls.weekPercent, progressEls.weekLine, summary, "No items were planned for this week.");
  renderStats(progressEls.weekStats, progressEls.weekBreakdown, summary);
  renderProgressRoutineGrid(monday);
  renderProgressDayList(monday);
}
// --- This week content: routine completion grid + expandable day-by-day rows ---

const progressShortDayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const progressFullDayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
// Static, trusted SVG markup only — no user-controlled content ever passes through innerHTML
const progressCheckIcon = '<svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const progressEmptySquareIcon = '<svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>';
const progressAccordionIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="accordion-plus" d="M12 5v14M5 12h14"/><path class="accordion-minus" d="M5 12h14"/></svg>';

// Whole calendar days between two local dates (UTC is applied to year/month/day
// components only, purely for day arithmetic — never for time-zone conversion)
function progressLocalDayDiff(from, to) {
  const fromMs = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toMs = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toMs - fromMs) / 86400000);
}

function progressIsAligned(diff, step) {
  return ((diff % step) + step) % step === 0;
}

// Does a routine series produce an occurrence on dayDate?
// The item's date is the series anchor (start). Optional recurrence.startDate /
// recurrence.endDate bound the range when the data provides them. The anchor
// date itself is always a concrete occurrence. All comparisons are local
// calendar dates — no UTC conversion, so no day can shift.
function progressRoutineOccursOn(item, dayDate) {
  const anchorStr = typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : "";
  if (!anchorStr) return false; // unknown-date (postponed) routines are never placed on a day
  const anchor = parseLocalDate(anchorStr);
  const dayStr = localDateString(dayDate);
  const recurrence = item.recurrence && typeof item.recurrence === "object" ? item.recurrence : null;
  const startStr = recurrence && typeof recurrence.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(recurrence.startDate)
    ? recurrence.startDate : anchorStr;
  const endStr = recurrence && typeof recurrence.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(recurrence.endDate)
    ? recurrence.endDate : "";
  if (dayStr < startStr) return false;
  if (endStr && dayStr > endStr) return false;
  if (dayStr === anchorStr) return true;
  if (!recurrence || !recurrence.frequency) return false;
  const step = Number.isInteger(recurrence.interval) && recurrence.interval > 0 ? recurrence.interval : 1;
  if (recurrence.frequency === "daily") {
    return progressIsAligned(progressLocalDayDiff(anchor, dayDate), step);
  }
  if (recurrence.frequency === "weekly") {
    const days = Array.isArray(recurrence.days) && recurrence.days.length ? recurrence.days : [anchor.getDay()];
    if (!days.includes(dayDate.getDay())) return false;
    const weeks = Math.round(progressLocalDayDiff(startOfWeek(anchor), startOfWeek(dayDate)) / 7);
    return progressIsAligned(weeks, step);
  }
  if (recurrence.frequency === "monthly") {
    if (dayDate.getDate() !== anchor.getDate()) return false;
    const months = (dayDate.getFullYear() - anchor.getFullYear()) * 12 + (dayDate.getMonth() - anchor.getMonth());
    return progressIsAligned(months, step);
  }
  return false;
}

// One occurrence per routine per day — never duplicated, never a whole-series row
function progressRoutineOccurrencesOn(dateStr) {
  const dayDate = parseLocalDate(dateStr);
  return items.filter(item => item && item.type === "routine" && !item.schedulePending && progressRoutineOccursOn(item, dayDate));
}
function buildProgressRoutineOccurrence(item, dayStr) {
  // Data limitation: the model stores a single shared status for the entire
  // routine series — there is no occurrence-level completion record. Only the
  // anchor occurrence (the item's own date) can truthfully inherit "completed";
  // every other weekday stays unmarked, and a cancelled series never shows as
  // completed because its status is "cancelled", not "completed".
  const anchor = typeof item.date === "string" ? item.date : "";
  const completed = item.status === "completed" && dayStr === anchor;
  const occurrence = document.createElement("div");
  occurrence.className = "routine-occurrence";
  const title = document.createElement("p");
  title.className = "routine-occurrence-title";
  title.textContent = item.title;
  const time = document.createElement("p");
  time.className = "routine-occurrence-time";
  time.textContent = calendarItemTime(item);
  const state = document.createElement("span");
  state.className = completed ? "routine-occurrence-state completed" : "routine-occurrence-state unmarked";
  state.setAttribute("role", "img");
  state.setAttribute("aria-label", completed ? "Completed" : "Not completed");
  state.innerHTML = completed ? progressCheckIcon : progressEmptySquareIcon; // static trusted SVG only
  occurrence.append(title, time, state);
  return occurrence;
}

function buildProgressRoutineBlock(dayDate, index, occurrences) {
  const block = document.createElement("div");
  block.className = "routine-day-block";
  const header = document.createElement("div");
  header.className = "routine-day-block-header";
  const name = document.createElement("span");
  name.className = "routine-day-name";
  name.textContent = progressShortDayNames[index];
  const date = document.createElement("span");
  date.className = "routine-day-date";
  date.textContent = progressShortDate.format(dayDate);
  header.append(name, date);
  block.append(header);
  if (!occurrences.length) {
    const quiet = document.createElement("p");
    quiet.className = "routine-day-empty";
    quiet.textContent = "No routines";
    block.append(quiet);
    return block;
  }
  const list = document.createElement("div");
  list.className = "routine-occurrence-list";
  list.append(...occurrences.map(item => buildProgressRoutineOccurrence(item, localDateString(dayDate))));
  block.append(list);
  return block;
}

// Seven day blocks for the selected Monday-to-Sunday week (never the current week)
function renderProgressRoutineGrid(monday) {
  const grid = progressEls.routineGrid;
  const empty = progressEls.routineGridEmpty;
  const entries = Array.from({ length: 7 }, (_, index) => {
    const dayDate = addDays(monday, index);
    return { dayDate, occurrences: progressRoutineOccurrencesOn(localDateString(dayDate)) };
  });
  const total = entries.reduce((sum, entry) => sum + entry.occurrences.length, 0);
  grid.replaceChildren();
  if (!total) {
    grid.hidden = true;
    empty.hidden = false;
    return;
  }
  grid.hidden = false;
  empty.hidden = true;
  grid.append(...entries.map((entry, index) => buildProgressRoutineBlock(entry.dayDate, index, entry.occurrences)));
}
// Daily summary — safe Progress status rules; never "0 of 0", never malformed text
function progressDayPrimarySummary(summary) {
  if (summary.planned > 0) return `${summary.completed} of ${summary.planned} completed`;
  if (summary.cancelled > 0) return `No active items · ${summary.cancelled} cancelled`;
  return "No items planned";
}

function progressDaySecondarySummary(summary) {
  if (summary.planned <= 0) return "";
  const parts = [];
  if (summary.postponed > 0) parts.push(`${summary.postponed} postponed`);
  if (summary.missed > 0) parts.push(`${summary.missed} missed`);
  if (summary.awaiting > 0) parts.push(`${summary.awaiting} awaiting check-in`);
  // Remaining only adds context when another status is already shown
  if (parts.length > 0 && summary.remaining > 0) parts.push(`${summary.remaining} remaining`);
  if (summary.cancelled > 0) parts.push(`${summary.cancelled} cancelled`);
  return parts.join(" · ");
}

// Timed items earliest first (start, then end, then stable id); untimed items after
function progressSortDayItems(dayItems) {
  const isTimed = item => Boolean(item.start && /^\d{2}:\d{2}$/.test(item.start));
  return [...dayItems].sort((a, b) => {
    const aTimed = isTimed(a);
    const bTimed = isTimed(b);
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    if (aTimed && a.start !== b.start) return a.start < b.start ? -1 : 1;
    if (aTimed && (a.end || "") !== (b.end || "")) return (a.end || "") < (b.end || "") ? -1 : 1;
    const aId = String(a.id || "");
    const bId = String(b.id || "");
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
}

function progressStatusPresentation(status) {
  const shared = typeof scheduleStatusPresentation !== "undefined" ? scheduleStatusPresentation : null;
  return (shared && shared[status]) || { label: "Upcoming", className: "upcoming" };
}

function progressBuildExpandedItem(item) {
  // Optional reuse of the existing Calendar event-detail modal (read-only;
  // no Firestore writes). When unavailable, rows stay non-interactive.
  const canOpenDetail = typeof openCalendarEventDetails === "function";
  const row = document.createElement(canOpenDetail ? "button" : "div");
  if (canOpenDetail) {
    row.type = "button";
    row.addEventListener("click", () => openCalendarEventDetails(item.id, row));
  }
  row.className = "day-expanded-item";
  const info = document.createElement("span");
  info.className = "day-expanded-item-info";
  const title = document.createElement("span");
  title.className = "day-expanded-item-title";
  title.textContent = item.title;
  const time = document.createElement("span");
  time.className = "day-expanded-item-time";
  time.textContent = calendarItemTime(item);
  info.append(title, time);
  const status = document.createElement("span");
  const presentation = progressStatusPresentation(item.status);
  status.className = `day-expanded-item-status ${presentation.className}`;
  status.textContent = presentation.label;
  row.append(info, status);
  return row;
}
function progressBuildDayPanel(dateStr) {
  const panel = document.createElement("div");
  panel.className = "day-expanded";
  panel.id = `progress-day-panel-${dateStr}`;
  // Unknown-date postponed items are excluded by itemsInPeriod (date required),
  // so they are never attached to a daily row; cancelled items remain visible here.
  const dayItems = progressSortDayItems(itemsInPeriod(dateStr, dateStr));
  if (!dayItems.length) {
    const quiet = document.createElement("p");
    quiet.className = "day-expanded-empty";
    quiet.textContent = "No items planned";
    panel.append(quiet);
  } else {
    panel.append(...dayItems.map(progressBuildExpandedItem));
  }
  panel.hidden = !progressExpandedDays.has(dateStr);
  return panel;
}

function toggleProgressDayPanel(dateStr, dayName, button) {
  const panel = document.getElementById(`progress-day-panel-${dateStr}`);
  if (!panel) return;
  const willExpand = panel.hidden;
  panel.hidden = !willExpand;
  button.setAttribute("aria-expanded", String(willExpand));
  button.setAttribute("aria-label", `${willExpand ? "Hide" : "Show"} ${dayName} schedule`);
  if (willExpand) progressExpandedDays.add(dateStr);
  else progressExpandedDays.delete(dateStr);
}

function progressBuildDayRow(monday, index) {
  const dayDate = addDays(monday, index);
  const dateStr = localDateString(dayDate);
  const dayName = progressFullDayNames[index];
  const summary = summarize(itemsInPeriod(dateStr, dateStr));
  const row = document.createElement("li");

  const info = document.createElement("div");
  info.className = "day-info";
  const name = document.createElement("span");
  name.className = "day-name";
  name.textContent = dayName;
  const date = document.createElement("span");
  date.className = "day-date";
  date.textContent = progressShortDate.format(dayDate);
  info.append(name, date);

  const summaryBox = document.createElement("div");
  summaryBox.className = "day-summary";
  const primary = document.createElement("span");
  primary.className = summary.planned > 0 ? "day-summary-primary" : "day-summary-primary is-empty";
  primary.textContent = progressDayPrimarySummary(summary);
  summaryBox.append(primary);
  const secondaryText = progressDaySecondarySummary(summary);
  if (secondaryText) {
    const secondary = document.createElement("span");
    secondary.className = "day-summary-secondary";
    secondary.textContent = secondaryText;
    summaryBox.append(secondary);
  }

  const expanded = progressExpandedDays.has(dateStr);
  const panelId = `progress-day-panel-${dateStr}`;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "day-accordion";
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-controls", panelId);
  toggle.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} ${dayName} schedule`);
  toggle.innerHTML = progressAccordionIcon; // static trusted SVG only
  toggle.addEventListener("click", () => toggleProgressDayPanel(dateStr, dayName, toggle));

  row.append(info, summaryBox, toggle, progressBuildDayPanel(dateStr));
  return row;
}

// Monday-to-Sunday rows for the selected week; several rows may stay expanded
function renderProgressDayList(monday) {
  progressEls.dayList.replaceChildren(...Array.from({ length: 7 }, (_, index) => progressBuildDayRow(monday, index)));
}





function renderProgress() {
  if (!progressEls.view || progressEls.view.hidden) return;
  try {
    progressEls.error.hidden = true;
    if (progressRoute === "week") renderWeekRoute();
    else renderTodayRoute();
  } catch (error) {
    console.error("Progress rendering failed", error);
    progressEls.todayRoute.hidden = true;
    progressEls.weekRoute.hidden = true;
    progressEls.error.hidden = false;
  }
}

// Week selector popup
function renderWeekOptions() {
  const { year, month } = popupMonth;
  progressEls.weekPopupMonth.textContent = progressMonthName.format(new Date(year, month, 1));
  const weeks = weeksIntersectingMonth(year, month);
  const selectedKey = localDateString(selectedWeekMonday);
  progressEls.weekOptions.replaceChildren(...weeks.map((week, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "week-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(localDateString(week.monday) === selectedKey));
    const label = document.createElement("span");
    label.className = "week-option-label";
    const number = document.createElement("span");
    number.className = "week-option-week";
    number.textContent = `Week ${index + 1}`;
    const dates = document.createElement("span");
    dates.className = "week-option-dates";
    dates.textContent = `${progressShortDate.format(week.monday)} – ${progressShortDate.format(week.sunday)}`;
    label.append(number, dates);
    option.append(label);
    option.addEventListener("click", () => {
      selectedWeekMonday = week.monday;
      selectedWeekMonth = { year, month };
      closeWeekPopup();
      renderWeekRoute();
      progressEls.weekSelectorButton.focus();
    });
    return option;
  }));
}

function openWeekPopup() {
  popupMonth = { ...selectedWeekMonth };
  renderWeekOptions();
  progressEls.weekPopup.hidden = false;
  progressEls.weekSelectorButton.setAttribute("aria-expanded", "true");
  const selected = progressEls.weekOptions.querySelector('[aria-selected="true"]') || progressEls.weekOptions.firstElementChild;
  if (selected) selected.focus();
}

function closeWeekPopup() {
  progressEls.weekPopup.hidden = true;
  progressEls.weekSelectorButton.setAttribute("aria-expanded", "false");
}

function shiftPopupMonth(delta) {
  const next = new Date(popupMonth.year, popupMonth.month + delta, 1);
  popupMonth = { year: next.getFullYear(), month: next.getMonth() };
  renderWeekOptions();
}

// Today / This week switch
function switchProgressRoute(route) {
  progressRoute = route === "week" ? "week" : "today";
  saveProgressRoute();
  const isToday = progressRoute === "today";
  progressEls.todayButton.classList.toggle("active", isToday);
  progressEls.todayButton.setAttribute("aria-pressed", String(isToday));
  progressEls.weekButton.classList.toggle("active", !isToday);
  progressEls.weekButton.setAttribute("aria-pressed", String(!isToday));
  progressEls.todayRoute.hidden = !isToday;
  progressEls.weekRoute.hidden = isToday;
  if (isToday) closeWeekPopup();
  renderProgress();
}

progressEls.todayButton.addEventListener("click", () => switchProgressRoute("today"));
progressEls.weekButton.addEventListener("click", () => switchProgressRoute("week"));
progressEls.weekSelectorButton.addEventListener("click", () => {
  if (progressEls.weekPopup.hidden) openWeekPopup();
  else closeWeekPopup();
});
progressEls.weekPrevMonth.addEventListener("click", () => shiftPopupMonth(-1));
progressEls.weekNextMonth.addEventListener("click", () => shiftPopupMonth(1));
progressEls.retryButton.addEventListener("click", () => switchProgressRoute(progressRoute));

document.addEventListener("click", event => {
  if (progressEls.weekPopup.hidden) return;
  if (event.target.closest("#weekSelectorButton") || event.target.closest("#weekSelectorPopup")) return;
  closeWeekPopup();
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || progressEls.weekPopup.hidden) return;
  closeWeekPopup();
  progressEls.weekSelectorButton.focus();
});

if (typeof els !== "undefined" && els.navProgress) {
  els.navProgress.addEventListener("click", () => {
    setView("progress");
    renderProgress();
  });
}

// Keep Progress in sync with schedule mutations without rewriting app.js internals
const appRender = render;
render = function () {
  appRender();
  renderProgress();
};

initSelectedWeek();
switchProgressRoute(progressRoute);
