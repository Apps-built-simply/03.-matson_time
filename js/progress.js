/* Progress page — factual schedule summary. No scoring or judgment. */

const PROGRESS_VIEW_KEY = "matson-time-progress-view-v1";

const progressEls = {
  view: document.querySelector("#progressView"),
  date: document.querySelector("#progressDate"),
  weekly: document.querySelector("#weeklyButton"),
  daily: document.querySelector("#dailyButton"),
  periodLabel: document.querySelector("#periodLabel"),
  empty: document.querySelector("#progressEmpty"),
  emptyText: document.querySelector("#progressEmptyText"),
  main: document.querySelector("#progressMain"),
  headline: document.querySelector("#progressHeadline"),
  percent: document.querySelector("#progressPercent"),
  line: document.querySelector("#progressLine"),
  lineFill: document.querySelector("#progressLineFill"),
  statCompleted: document.querySelector("#statCompleted"),
  statMissed: document.querySelector("#statMissed"),
  statRemaining: document.querySelector("#statRemaining"),
  statAwaiting: document.querySelector("#statAwaiting"),
  statPostponed: document.querySelector("#statPostponed"),
  routineSection: document.querySelector("#routineSection"),
  routineTotal: document.querySelector("#routineTotal"),
  routineCompleted: document.querySelector("#routineCompleted"),
  routineMissed: document.querySelector("#routineMissed"),
  routineRemaining: document.querySelector("#routineRemaining"),
  routinePercent: document.querySelector("#routinePercent"),
  weekBreakdown: document.querySelector("#weekBreakdown"),
  dayList: document.querySelector("#dayList")
};

// Session-scoped preference: "daily" | "weekly"
let progressView = loadProgressView();

function loadProgressView() {
  try {
    return sessionStorage.getItem(PROGRESS_VIEW_KEY) === "weekly" ? "weekly" : "daily";
  } catch { return "daily"; }
}

function saveProgressView() {
  try { sessionStorage.setItem(PROGRESS_VIEW_KEY, progressView); } catch { /* storage may be unavailable */ }
}

function setAria(el, name, value) {
  el.setAttribute(name, value);
}

// Period summaries built from the shared schedule store (items is global in app.js)

function summarize(dateItems) {
  const planned = dateItems.filter(item => item.status !== "cancelled");
  const completed = planned.filter(item => item.status === "completed").length;
  const missed = planned.filter(item => item.status === "missed").length;
  const postponed = planned.filter(item => item.status === "postponed").length;
  const awaiting = planned.filter(item => item.status === "awaiting-check-in").length;
  // Remaining = planned minus completed and missed (cancelled already excluded)
  const remaining = planned.length - completed - missed;
  const routines = planned.filter(item => item.type === "routine");
  const routineCompleted = routines.filter(item => item.status === "completed").length;
  const routineMissed = routines.filter(item => item.status === "missed").length;
  const percent = planned.length ? Math.round((completed / planned.length) * 100) : 0;
  const routinePercent = routines.length ? Math.round((routineCompleted / routines.length) * 100) : 0;
  return {
    planned: planned.length, completed, missed, remaining, awaiting, postponed,
    routines: routines.length, routineCompleted, routineMissed,
    routineRemaining: routines.length - routineCompleted - routineMissed, routinePercent
  };
}

function setStat(el, value, colorClass) {
  el.textContent = String(value);
  el.className = "stat-value " + (colorClass || "");
}

function renderMainSummary(summary) {
  progressEls.headline.textContent = `${summary.completed} of ${summary.planned} completed`;
  progressEls.percent.textContent = `${summary.percent}% complete`;
  setAria(progressEls.line, "aria-valuenow", summary.percent);
  progressEls.lineFill.style.width = summary.percent + "%";
}

function renderBreakdown(summary) {
  setStat(progressEls.statCompleted, summary.completed, "completed");
  setStat(progressEls.statMissed, summary.missed, "missed");
  setStat(progressEls.statRemaining, summary.remaining);
  setStat(progressEls.statAwaiting, summary.awaiting, "awaiting");
  setStat(progressEls.statPostponed, summary.postponed, "postponed");
}

function renderRoutines(summary) {
  const hasRoutines = summary.routines > 0;
  progressEls.routineSection.hidden = !hasRoutines;
  if (!hasRoutines) return;
  progressEls.routineTotal.textContent = String(summary.routines);
  progressEls.routineCompleted.textContent = String(summary.routineCompleted);
  progressEls.routineMissed.textContent = String(summary.routineMissed);
  progressEls.routineRemaining.textContent = String(summary.routineRemaining);
  progressEls.routinePercent.textContent = `${summary.routinePercent}% of routines completed`;
}

function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d;
}

function formatWeekRange(start, end) {
  const s = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(start);
  const e = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(end);
  return `${s} – ${e}`;
}

function itemsOn(dateStr) {
  return items.filter(item => item.date === dateStr);
}

// Daily / Weekly rendering
function renderDaily() {
  const today = localDateString(new Date());
  progressEls.date.textContent = formatDateLabel(today);
  progressEls.periodLabel.textContent = formatDateLabel(today);
  const summary = summarize(itemsOn(today));
  const hasData = summary.planned > 0;
  progressEls.empty.hidden = hasData;
  progressEls.main.hidden = !hasData;
  progressEls.emptyText.textContent = "No items were planned for today.";
  if (!hasData) {
    progressEls.lineFill.style.width = "0%";
    return;
  }
  renderMainSummary(summary);
  progressEls.lineFill.style.width = summary.percent + "%";
  renderRoutines(summary);
  progressEls.weekBreakdown.hidden = true;
}

function renderWeekly() {
  const today = parseLocalDate(localDateString(new Date()));
  const monday = startOfWeek(today);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  progressEls.date.textContent = formatDateLabel(localDateString(monday));
  progressEls.periodLabel.textContent = formatWeekRange(monday, sunday);

  const weekItems = items.filter(item => item.date && item.date >= localDateString(monday) && item.date <= localDateString(sunday));
  const summary = summarize(weekItems);
  const hasData = summary.planned > 0;

  progressEls.empty.hidden = hasData;
  progressEls.main.hidden = !hasData;
  progressEls.emptyText.textContent = "No items were planned for this week.";

  if (hasData) renderMainSummary(summary);
  else progressEls.lineFill.style.width = "0%";
  renderBreakdown(summary);
  renderRoutines(summary);
  progressEls.weekBreakdown.hidden = !hasData;
  renderDayList(monday, summary, hasData);
}

function renderDayList(monday, summary, hasData) {
  progressEls.dayList.replaceChildren();
  if (!hasData) return;
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    const dateStr = localDateString(day);
    const daySummary = summarize(itemsOn(dateStr));
    const row = document.createElement("li");
    const info = document.createElement("div");
    info.className = "day-info";
    const name = document.createElement("span");
    name.className = "day-name";
    name.textContent = names[i];
    const date = document.createElement("span");
    date.className = "day-date";
    date.textContent = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(day);
    info.append(name, date);
    const counts = document.createElement("span");
    counts.className = "day-counts";
    counts.textContent = `${daySummary.planned} of ${daySummary.planned} · ${daySummary.completed}·${daySummary.missed}·${daySummary.remaining}`;
    row.append(info, counts);
    progressEls.dayList.appendChild(row);
  }
}

function renderProgress() {
  if (progressEls.view.hidden) return;
  progressEls.date.textContent = formatDateLabel(localDateString(new Date()));
  if (progressView === "daily") renderDaily();
  else renderWeekly();
}

// Daily / Weekly switch
function switchProgressView(view) {
  progressView = view;
  saveProgressView();
  const isDaily = view === "daily";
  progressEls.daily.classList.toggle("active", isDaily);
  progressEls.daily.setAttribute("aria-pressed", isDaily);
  progressEls.weekly.classList.toggle("active", !isDaily);
  progressEls.weekly.setAttribute("aria-pressed", !isDaily);
  renderProgress();
}

// Assistant page rendering & controls
progressEls.daily.addEventListener("click", () => switchProgressView("daily"));
progressEls.weekly.addEventListener("click", () => switchProgressView("weekly"));

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

renderProgress();
