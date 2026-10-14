var items = loadItems();

// View state: the month being displayed and the selected date (YYYY-MM-DD)
let calendarCursor = new Date();
let selectedDate = localDateString(new Date());

const categoryColors = Object.fromEntries((window.cloudCategories || []).map(category => [category.name, /^#[0-9a-f]{6}$/i.test(category.color || "") ? category.color : "#2563EB"]));

const els = {
  todayView: document.querySelector("#todayView"), calendarView: document.querySelector("#calendarView"), assistantView: document.querySelector("#assistantView"), progressView: document.querySelector("#progressView"),
  date: document.querySelector("#todayDate"), calendarDate: document.querySelector("#calendarDate"),
  list: document.querySelector("#scheduleList"), count: document.querySelector("#scheduleCount"),
  now: document.querySelector("#nowCard"), conflict: document.querySelector("#conflictNotice"),
  completed: document.querySelector("#completedCount"), remaining: document.querySelector("#remainingCount"),
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
  return dateItems.find(item => item.status === "in-progress") || dateItems.find(item => item.status === "overdue") || dateItems.find(item => item.status !== "completed");
}

// Overlapping timed activities within a single date
function detectConflict(dateItems) {
  const timed = dateItems.filter(i => i.start && i.end && i.status !== "completed").sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < timed.length - 1; i++) {
    if (timed[i + 1].start < timed[i].end) return [timed[i], timed[i + 1]];
  }
  return null;
}

function scheduleItemNode(item) {
  const article = document.createElement("article");
  article.className = "schedule-item";
  const dot = document.createElement("span");
  dot.className = "category-dot";
  dot.style.setProperty("--category-color", categoryColors[item.category] || "#2563EB");
  const content = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = item.title;
  const detail = document.createElement("p");
  detail.textContent = `${itemTime(item)} · ${item.category}`;
  content.append(title, detail);
  const status = document.createElement("span");
  status.className = `item-status status-${String(item.status || "upcoming").replace(/[^a-z-]/gi, "")}`;
  status.textContent = String(item.status || "upcoming").replaceAll("-", " ");
  article.append(dot, content, status);
  return article;
}

function renderAttention(dateItems) {
  const attention = getAttentionItem(dateItems);
  if (!attention) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nothing needs attention right now.";
    els.now.replaceChildren(empty);
    return;
  }
  const article = document.createElement("article");
  article.className = "attention-item";
  const status = document.createElement("span");
  status.className = "status";
  status.textContent = String(attention.status || "upcoming").replaceAll("-", " ");
  const title = document.createElement("h3");
  title.textContent = attention.title;
  const time = document.createElement("p");
  time.textContent = itemTime(attention);
  const reason = document.createElement("p");
  reason.className = "reason";
  reason.textContent = attention.status === "in-progress" ? "Currently scheduled" : attention.postponed ? `Postponed ${attention.postponed} time${attention.postponed > 1 ? "s" : ""}` : "Next item needing attention";
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
  article.append(status, title, time, reason, actions);
  els.now.replaceChildren(article);
}

function renderSchedule(dateItems, listEl, conflictEl, emptyText) {
  if (dateItems.length) listEl.replaceChildren(...dateItems.map(scheduleItemNode));
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
    const dots = dateItems.slice(0, 3).map(item => `<span class="day-dot" style="--category-color:${categoryColors[item.category] || "#2563EB"}"></span>`).join("");
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
  els.date.textContent = formatDateLabel(today);
  els.calendarDate.textContent = els.date.textContent;

  const todayItems = items.filter(item => item.date === today);
  const completed = todayItems.filter(item => item.status === "completed").length;
  els.completed.textContent = completed;
  els.remaining.textContent = todayItems.length - completed;
  els.count.textContent = `${todayItems.length} items`;

  renderAttention(todayItems);
  renderSchedule(todayItems, els.list, els.conflict, "No items planned for today.");
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
