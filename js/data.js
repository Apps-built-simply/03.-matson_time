// YYYY-MM-DD built from local time — avoids the day shift toISOString() can cause
function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadItems() {
  return Array.isArray(window.initialScheduleItems) ? window.initialScheduleItems.map(item => ({ ...item })) : [];
}
