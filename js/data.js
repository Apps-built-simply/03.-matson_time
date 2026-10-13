/* Temporary development data. Replace with online storage in the agreed build stage. */
const MATSON_STORAGE_KEY = "matson-time-items-v1";

const starterItems = [
  { id: crypto.randomUUID(), title: "Studio Session", type: "activity", start: "14:00", end: "16:00", category: "Music", notes: "", status: "in-progress", postponed: 0 },
  { id: crypto.randomUUID(), title: "Call Raymond", type: "activity", start: "17:00", end: "17:30", category: "Meetings", notes: "", status: "upcoming", postponed: 0 },
  { id: crypto.randomUUID(), title: "Review playlist", type: "task", start: "", end: "", category: "Music", notes: "", status: "upcoming", postponed: 0 },
  { id: crypto.randomUUID(), title: "Gym", type: "routine", start: "19:00", end: "20:00", category: "Health", notes: "", status: "upcoming", postponed: 0 }
];

function loadItems() {
  const saved = localStorage.getItem(MATSON_STORAGE_KEY);
  if (!saved) {
    localStorage.setItem(MATSON_STORAGE_KEY, JSON.stringify(starterItems));
    return starterItems;
  }
  try { return JSON.parse(saved); } catch { return starterItems; }
}

function saveItems(items) {
  localStorage.setItem(MATSON_STORAGE_KEY, JSON.stringify(items));
}
