var items = loadItems();

// View state: the month being displayed and the selected date (YYYY-MM-DD)
let calendarCursor = new Date();
let selectedDate = localDateString(new Date());

const categoryColors = Object.fromEntries((window.cloudCategories || []).map(category => [category.name, /^#[0-9a-f]{6}$/i.test(category.color || "") ? category.color : "#2563EB"]));
function getCategoryColor(categoryName) { return categoryColors[categoryName] || "#2563EB"; }

const els = {
  todayView: document.querySelector("#todayView"), calendarView: document.querySelector("#calendarView"), assistantView: document.querySelector("#assistantView"), progressView: document.querySelector("#progressView"),
  calendarDate: document.querySelector("#calendarDate"), todayMain: document.querySelector("#todayMain"), emptyDay: document.querySelector("#emptyDayState"), emptyAdd: document.querySelector("#emptyAddButton"), attentionSection: document.querySelector("#attentionSection"), todayScheduleSection: document.querySelector("#todayScheduleSection"), dailyProgress: document.querySelector("#dailyProgress"),
  list: document.querySelector("#scheduleList"), count: document.querySelector("#scheduleCount"),
  now: document.querySelector("#nowCard"), conflict: document.querySelector("#conflictNotice"),
  monthYear: document.querySelector("#monthYear"), calendarGrid: document.querySelector("#calendarGrid"),
  selectedTitle: document.querySelector("#selectedDateTitle"), selectedCount: document.querySelector("#selectedCount"),
  selectedSchedule: document.querySelector("#selectedSchedule"), selectedConflict: document.querySelector("#selectedConflict"),
  dialog: document.querySelector("#addDialog"), form: document.querySelector("#addForm"),
  type: document.querySelector("#itemType"), timeFields: document.querySelector("#timeFields"),
  navToday: document.querySelector("#navToday"), navCalendar: document.querySelector("#navCalendar"), navAssistant: document.querySelector("#navAssistant"), navProgress: document.querySelector("#navProgress"), navAdd: document.querySelector("#navAddButton"),
  prevMonth: document.querySelector("#prevMonthButton"), nextMonth: document.querySelector("#nextMonthButton")
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
  return new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parseLocalDate(value));
}

function formatTime(value) {
  if (!value) return "Anytime today";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour, minute));
}

function itemTime(item) {
  return item.start ? `${formatTime(item.start)}${item.end ? ` – ${formatTime(item.end)}` : ""}` : "Anytime today";
}

function getAttentionItem(dateItems) {
  const activeItems = dateItems.filter(item => !["completed", "cancelled"].includes(item.status));
  return activeItems.find(item => item.status === "in-progress") || activeItems.find(item => item.status === "overdue") || activeItems[0] || null;
}

// Overlapping timed activities within a single date
function detectConflict(dateItems) {
  const timed = dateItems.filter(i => i.start && i.end && i.status !== "completed").sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < timed.length - 1; i++) {
    if (timed[i + 1].start < timed[i].end) return [timed[i], timed[i + 1]];
  }
  return null;
}

function getTodayCategoryColor(category) {
  const colors = {
    Health: "#C77F9F",
    Meetings: "#C98A5D",
    Music: "#A18ACB",
    Personal: "#68AAA0",
    Travel: "#8294C9"
  };
  return colors[category] || "#68AAA0";
}

function scheduleItemNode(item, todayStyle = false) {
  const article = document.createElement("article");
  article.className = "schedule-item";
  const categoryMarker = todayStyle ? null : document.createElement("span");
  if (categoryMarker) {
    categoryMarker.className = "category-dot";
    categoryMarker.style.setProperty("--category-color", getCategoryColor(item.category));
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
    const separator = document.createElement("span");
    separator.className = "schedule-separator";
    separator.textContent = " · ";
    const category = document.createElement("span");
    const categoryName = item.category || "Personal";
    category.className = "schedule-category";
    category.textContent = categoryName;
      category.style.color = getTodayCategoryColor(categoryName);
    detail.append(time, separator, category);
  } else {
    detail.textContent = `${itemTime(item)} · ${item.category}`;
  }

  content.append(title, detail);
  const status = document.createElement("span");
  status.className = `item-status status-${String(item.status || "upcoming").replace(/[^a-z-]/gi, "")}`;
  status.textContent = todayStyle ? readableStatus(item.status) : String(item.status || "upcoming").replaceAll("-", " ");
  if (categoryMarker) article.append(categoryMarker);
  article.append(content, status);
  return article;
}

function readableStatus(status) {
  const value = String(status || "upcoming").replaceAll("-", " ");
  if (value === "in progress") return "In progress";
  if (value === "awaiting check in") return "Awaiting check-in";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderAttention(dateItems) {
  const attention = getAttentionItem(dateItems);
  if (!attention) {
    const empty = document.createElement("div");
    empty.className = "attention-empty";
    empty.textContent = "Nothing needs attention right now.";
    els.now.replaceChildren(empty);
    return;
  }
  const article = document.createElement("article");
  article.className = "attention-item";
  const illustration = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  illustration.setAttribute("class", "attention-illustration");
  illustration.setAttribute("viewBox", "0 0 240 180");
  illustration.setAttribute("aria-hidden", "true");
  illustration.setAttribute("focusable", "false");
  illustration.innerHTML = '<circle cx="151" cy="91" r="70" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="151" cy="91" r="4" fill="currentColor"/><path d="M151 48v43l28 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><rect x="19" y="31" width="60" height="13" rx="6.5" fill="currentColor"/><rect x="7" y="57" width="88" height="13" rx="6.5" fill="currentColor"/><rect x="34" y="83" width="45" height="13" rx="6.5" fill="currentColor"/>';
  const title = document.createElement("h3");
  title.textContent = attention.title;
  const time = document.createElement("p");
  time.textContent = itemTime(attention);
  const actions = document.createElement("div");
  actions.className = "actions";
  for (const [action, label, className] of [["complete", "Done", "primary-button"], ["postpone", "Postpone", "secondary-button"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.action = action;
    button.dataset.id = attention.id;
    button.textContent = label;
    actions.appendChild(button);
  }
  article.append(illustration, title, time, actions);
  els.now.replaceChildren(article);
}

function renderSchedule(dateItems, listEl, conflictEl, emptyText, todayStyle = false) {
  if (dateItems.length) listEl.replaceChildren(...dateItems.map(item => scheduleItemNode(item, todayStyle)));
  else {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    listEl.replaceChildren(empty);
  }
  const conflict = detectConflict(dateItems);
  if (!conflict) { conflictEl.replaceChildren(); return; }
  const notice = document.createElement("div");
  notice.className = "conflict";
  const label = document.createElement("strong");
  label.textContent = "Schedule conflict: ";
  notice.append(label, document.createTextNode(`${conflict[0].title} overlaps with ${conflict[1].title}.`));
  conflictEl.replaceChildren(notice);
}

// Timed activities first (by start time), then untimed activities, tasks, then routines
function sortForDate(dateItems) {
  const rank = item => item.type === "activity" ? (item.start ? 0 : 1) : item.type === "task" ? 2 : 3;
  return [...dateItems].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.start.localeCompare(b.start) : 0));
}

function sortTodayItems(dateItems) {
  return [...dateItems].sort((a, b) => {
    const aTimed = Boolean(a.start), bTimed = Boolean(b.start);
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    return aTimed ? a.start.localeCompare(b.start) : 0;
  });
}

function renderCalendar(today) {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  els.monthYear.textContent = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(calendarCursor);

  const itemsByDate = new Map();
  for (const item of items) {
    if (!item.date) continue;
    if (!itemsByDate.has(item.date)) itemsByDate.set(item.date, []);
    itemsByDate.get(item.date).push(item);
  }

  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0 … Sunday = 6
  const cells = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => `<span class="calendar-weekday">${day}</span>`);

  // Six weeks cover every month layout; adjacent-month dates roll over via Date overflow
  for (let index = 0; index < 42; index++) {
    const date = new Date(year, month, index - firstWeekday + 1);
    const dateStr = localDateString(date);
    const dateItems = itemsByDate.get(dateStr) || [];
    const dots = dateItems.slice(0, 3).map(item => `<span class="day-dot" style="--category-color:${getCategoryColor(item.category)}"></span>`).join("");
    const classes = ["calendar-day", date.getMonth() !== month ? "other-month" : "", dateStr === today ? "today" : "", dateStr === selectedDate ? "selected" : ""].filter(Boolean).join(" ");
    cells.push(`<button type="button" class="${classes}" data-date="${dateStr}" aria-label="${formatDateLabel(dateStr)}${dateItems.length ? `, ${dateItems.length} item${dateItems.length > 1 ? "s" : ""}` : ""}"><span class="day-number">${date.getDate()}</span><span class="day-dots" aria-hidden="true">${dots}</span></button>`);
  }

  els.calendarGrid.innerHTML = cells.join("");
}

function renderSelectedDate() {
  const dateItems = items.filter(item => item.date === selectedDate);
  els.selectedTitle.textContent = formatDateLabel(selectedDate);
  els.selectedCount.textContent = `${dateItems.length} item${dateItems.length === 1 ? "" : "s"}`;
  renderSchedule(sortForDate(dateItems), els.selectedSchedule, els.selectedConflict, "No items planned for this date.");
}

function render() {
  const today = localDateString(new Date());
  els.calendarDate.textContent = formatDateLabel(today);

  const todayItems = items.filter(item => item.date === today);
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
    renderAttention(todayItems);
    renderSchedule(sortTodayItems(todayItems), els.list, els.conflict, "No items planned for today.", true);
  } else {
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

async function postponeItem(id) {
  const result = await saPostponeItem(id);
  if (!result.success) {
    alert(`Could not postpone item: ${result.error}`);
  }
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

els.calendarGrid.addEventListener("click", event => {
  const day = event.target.closest(".calendar-day");
  if (!day) return;
  selectedDate = day.dataset.date;
  const date = parseLocalDate(selectedDate);
  calendarCursor = new Date(date.getFullYear(), date.getMonth(), 1); // adjacent-month dates navigate to their month
  render();
});

document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "complete") completeItem(button.dataset.id);
  if (button.dataset.action === "postpone") postponeItem(button.dataset.id);
});

function openAddDialog() {
  els.form.date.value = localDateString(new Date());
  els.dialog.showModal();
}

document.querySelector("#closeAddButton").addEventListener("click", () => els.dialog.close());
els.type.addEventListener("change", () => { els.timeFields.hidden = els.type.value === "task"; });
els.form.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(els.form);
  const newItem = {
    title: data.get("title").trim(),
    date: data.get("date"),
    type: data.get("type"),
    start: data.get("start"),
    end: data.get("end"),
    category: data.get("category"),
    notes: data.get("notes").trim(),
    status: "upcoming",
    postponed: 0
  };
  const result = await saCreateItem(newItem);
  if (!result.success) {
    alert(`Could not save item: ${result.error}`);
    return;
  }
  els.form.reset();
  els.form.date.value = localDateString(new Date());
  els.timeFields.hidden = false;
  els.dialog.close();
  render();
});

render();
