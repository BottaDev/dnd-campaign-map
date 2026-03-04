import { MAP, characters, routes, events } from "../data/data.js";
import { createMap, enableCoordDebug } from "./map.js";
import { getAllTags, getFilteredEvents } from "./filters.js";
import { renderCharacterToggles, fillFilterDropdowns, renderEventsList, wireFilterInputs } from "./ui.js";

const { map, eventsLayer } = createMap({
  mapElId: "map",
  imageUrl: MAP.imageUrl,
  width: MAP.width,
  height: MAP.height,
});

// Optional: coordinate debug
enableCoordDebug(map);

// Character layers
const characterLayers = new Map();

function getCharacter(id) {
  return characters.find(c => c.id === id);
}

function buildCharacterLayer(characterId) {
  const c = getCharacter(characterId);
  const layer = L.layerGroup();

  const route = routes.find(r => r.characterId === characterId);
  if (route && route.points.length >= 2) {
    const latlngs = route.points.map(p => [p.y, p.x]);

    L.polyline(latlngs, {
      color: c.color,
      weight: 3,
      dashArray: "6 8",
      opacity: 0.9,
    }).addTo(layer);

    route.points.forEach(p => {
      const m = L.circleMarker([p.y, p.x], {
        radius: 5,
        color: c.color,
        weight: 2,
        fillOpacity: 0.9
      }).addTo(layer);

      m.bindPopup(`
        <div style="min-width:180px">
          <div style="font-weight:700; margin-bottom:4px">${c.name}</div>
          <div style="font-size:12px; color:#555">
            <div><b>Date:</b> ${p.date}</div>
            <div><b>Note:</b> ${p.label ?? ""}</div>
          </div>
        </div>
      `);
    });
  }

  return layer;
}

function renderCharacters() {
  for (const [, layer] of characterLayers.entries()) map.removeLayer(layer);
  characterLayers.clear();

  characters.forEach(c => {
    const layer = buildCharacterLayer(c.id);
    characterLayers.set(c.id, layer);
    if (c.enabled) layer.addTo(map);
  });
}

// Events markers
function renderEventsMarkers(filteredEvents) {
  eventsLayer.clearLayers();

  filteredEvents.forEach(ev => {
    const m = L.marker([ev.y, ev.x]).addTo(eventsLayer);

    const tagsHtml = (ev.tags ?? []).map(t => `<span class="tag">${t}</span>`).join(" ");
    m.bindPopup(`
      <div style="min-width:240px">
        <div style="font-weight:800; margin-bottom:6px">${ev.title}</div>
        <div style="font-size:12px; color:#555; margin-bottom:8px">
          <div><b>Date:</b> ${ev.date}</div>
          <div><b>Session:</b> #${ev.session}</div>
        </div>
        <div style="font-size:13px; line-height:1.35; margin-bottom:8px">${ev.summary}</div>
        <div>${tagsHtml}</div>
      </div>
    `);

    ev._marker = m;
  });
}

function applyFiltersAndRender() {
  const filtered = getFilteredEvents(events);
  renderEventsMarkers(filtered);
  renderEventsList(filtered, (ev) => {
    map.setView([ev.y, ev.x], Math.max(map.getZoom(), -1));
    if (ev._marker) ev._marker.openPopup();
  });

  // Optional: update count as "filtered / total"
  const rc = document.getElementById("resultsCount");
  rc.textContent = `${filtered.length} / ${events.length} events shown`;
}

// Init
renderCharacters();

renderCharacterToggles(characters, (id, enabled) => {
  const c = getCharacter(id);
  c.enabled = enabled;
  renderCharacters();
});

fillFilterDropdowns(characters, getAllTags(events));
wireFilterInputs(applyFiltersAndRender);

applyFiltersAndRender();