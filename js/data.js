/* Temporary development data. Replace with online storage in the agreed build stage. */
const MATSON_STORAGE_KEY = "matson-time-items-v1";

// YYYY-MM-DD built from local time — avoids the day shift toISOString() can cause
function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = localDateString(new Date());

const starterItems = [
  { id: crypto.randomUUID(), title: "Studio Session", type: "activity", date: today, start: "14:00", end: "16:00", category: "Music", notes: "", status: "in-progress", postponed: 0 },
  { id: crypto.randomUUID(), title: "Call Raymond", type: "activity", date: today, start: "17:00", end: "17:30", category: "Meetings", notes: "", status: "upcoming", postponed: 0 },
  { id: crypto.randomUUID(), title: "Review playlist", type: "task", date: today, start: "", end: "", category: "Music", notes: "", status: "upcoming", postponed: 0 },
  { id: crypto.randomUUID(), title: "Gym", type: "routine", date: today, start: "19:00", end: "20:00", category: "Health", notes: "", status: "upcoming", postponed: 0 }
];

function loadItems() {
  const saved = localStorage.getItem(MATSON_STORAGE_KEY);
  if (!saved) {
    localStorage.setItem(MATSON_STORAGE_KEY, JSON.stringify(starterItems));
    return starterItems;
  }
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return starterItems;
    // Migrate items saved before dates existed
    return parsed.map(item => (item && item.date) ? item : { ...item, date: today });
  } catch { return starterItems; }
}

function saveItems(items) {
  localStorage.setItem(MATSON_STORAGE_KEY, JSON.stringify(items));
}
