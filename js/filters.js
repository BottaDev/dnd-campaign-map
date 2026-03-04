function normalizeStr(s) {
  return (s ?? "").toString().toLowerCase().trim();
}

function parseDateOrNull(yyyyMMdd) {
  if (!yyyyMMdd) return null;
  const d = new Date(yyyyMMdd + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getAllTags(events) {
  const set = new Set();
  events.forEach(e => (e.tags ?? []).forEach(t => set.add(t)));
  return Array.from(set).sort((a,b) => a.localeCompare(b));
}

export function getFilterState() {
  const text = normalizeStr(document.getElementById("filterText").value);
  const characterId = document.getElementById("filterCharacter").value;
  const tag = document.getElementById("filterTag").value;
  const from = parseDateOrNull(document.getElementById("filterFrom").value);
  const to = parseDateOrNull(document.getElementById("filterTo").value);

  const sessionMinRaw = document.getElementById("filterSessionMin").value;
  const sessionMaxRaw = document.getElementById("filterSessionMax").value;

  const sessionMin = sessionMinRaw ? parseInt(sessionMinRaw, 10) : null;
  const sessionMax = sessionMaxRaw ? parseInt(sessionMaxRaw, 10) : null;

  return { text, characterId, tag, from, to, sessionMin, sessionMax };
}

export function eventPassesFilters(ev, fs) {
  if (fs.text) {
    const hay = normalizeStr(ev.title) + " " + normalizeStr(ev.summary);
    if (!hay.includes(fs.text)) return false;
  }

  if (fs.characterId) {
    const ids = ev.characterIds ?? [];
    if (!ids.includes(fs.characterId)) return false;
  }

  if (fs.tag) {
    const tags = ev.tags ?? [];
    if (!tags.includes(fs.tag)) return false;
  }

  const evDate = parseDateOrNull(ev.date);
  if (fs.from && evDate && evDate < fs.from) return false;
  if (fs.to && evDate && evDate > fs.to) return false;

  if (fs.sessionMin != null && (ev.session ?? 0) < fs.sessionMin) return false;
  if (fs.sessionMax != null && (ev.session ?? 0) > fs.sessionMax) return false;

  return true;
}

export function getFilteredEvents(events) {
  const fs = getFilterState();
  return [...events]
    .filter(ev => eventPassesFilters(ev, fs))
    .sort((a,b) => a.date.localeCompare(b.date));
}