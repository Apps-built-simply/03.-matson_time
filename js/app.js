let items = loadItems();

const categoryColors = {
  Music: "#8B5CF6", Health: "#EC4899", Personal: "#14B8A6", Meetings: "#F97316", Travel: "#6366F1"
};

const els = {
  date: document.querySelector("#todayDate"), list: document.querySelector("#scheduleList"), count: document.querySelector("#scheduleCount"),
  now: document.querySelector("#nowCard"), conflict: document.querySelector("#conflictNotice"), completed: document.querySelector("#completedCount"),
  remaining: document.querySelector("#remainingCount"), percent: document.querySelector("#progressPercent"), ring: document.querySelector("#progressRing"),
  dialog: document.querySelector("#addDialog"), form: document.querySelector("#addForm"), type: document.querySelector("#itemType"), timeFields: document.querySelector("#timeFields")
};

function formatTime(value) {
  if (!value) return "Anytime today";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour, minute));
}

function itemTime(item) {
  return item.start ? `${formatTime(item.start)}${item.end ? ` – ${formatTime(item.end)}` : ""}` : "Anytime today";
}

function getAttentionItem() {
  return items.find(item => item.status === "in-progress") || items.find(item => item.status === "overdue") || items.find(item => item.status !== "completed");
}

function detectConflict() {
  const timed = items.filter(i => i.start && i.end && i.status !== "completed").sort((a,b) => a.start.localeCompare(b.start));
  for (let i = 0; i < timed.length - 1; i++) {
    if (timed[i + 1].start < timed[i].end) return [timed[i], timed[i + 1]];
  }
  return null;
}

function render() {
  els.date.textContent = new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const completed = items.filter(i => i.status === "completed").length;
  const remaining = items.length - completed;
  const percentage = items.length ? Math.round((completed / items.length) * 100) : 0;
  els.completed.textContent = completed; els.remaining.textContent = remaining; els.percent.textContent = `${percentage}%`;
  els.ring.style.setProperty("--progress", `${percentage * 3.6}deg`);
  els.count.textContent = `${items.length} items`;

  const attention = getAttentionItem();
  els.now.innerHTML = attention ? `<article class="now-card"><span class="status">${attention.status.replace("-", " ")}</span><h3>${attention.title}</h3><p>${itemTime(attention)}</p><p class="reason">${attention.status === "in-progress" ? "Currently scheduled" : attention.postponed ? `Postponed ${attention.postponed} time${attention.postponed > 1 ? "s" : ""}` : "Next item needing attention"}</p><div class="actions"><button class="primary-button" data-action="complete" data-id="${attention.id}">I'm done</button><button class="secondary-button" data-action="postpone" data-id="${attention.id}">Postpone 15 min</button></div></article>` : `<div class="empty-state">Nothing needs attention right now.</div>`;

  els.list.innerHTML = items.length ? items.map(item => `<article class="schedule-item"><span class="category-dot" style="--category-color:${categoryColors[item.category] || '#2563EB'}"></span><div><h3>${item.title}</h3><p>${itemTime(item)} · ${item.category}</p></div><span class="item-status">${item.status.replace("-", " ")}</span></article>`).join("") : `<div class="empty-state">No items planned for today.</div>`;

  const conflict = detectConflict();
  els.conflict.innerHTML = conflict ? `<div class="conflict"><strong>Schedule conflict:</strong> ${conflict[0].title} overlaps with ${conflict[1].title}.</div>` : "";
}

function completeItem(id) {
  items = items.map(i => i.id === id ? { ...i, status: "completed" } : i); saveItems(items); render();
}

function postponeItem(id) {
  items = items.map(i => i.id === id ? { ...i, status: "postponed", postponed: (i.postponed || 0) + 1 } : i); saveItems(items); render();
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "complete") completeItem(button.dataset.id);
  if (button.dataset.action === "postpone") postponeItem(button.dataset.id);
});

document.querySelector("#openAddButton").addEventListener("click", () => els.dialog.showModal());
document.querySelector("#closeAddButton").addEventListener("click", () => els.dialog.close());
els.type.addEventListener("change", () => { els.timeFields.hidden = els.type.value === "task"; });
els.form.addEventListener("submit", event => {
  event.preventDefault();
  const data = new FormData(els.form);
  items.push({ id: crypto.randomUUID(), title: data.get("title").trim(), type: data.get("type"), start: data.get("start"), end: data.get("end"), category: data.get("category"), notes: data.get("notes").trim(), status: "upcoming", postponed: 0 });
  saveItems(items); els.form.reset(); els.timeFields.hidden = false; els.dialog.close(); render();
});

render();
