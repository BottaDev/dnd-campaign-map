export function createMap({ mapElId, imageUrl, width, height }) {
  const map = L.map(mapElId, {
    crs: L.CRS.Simple,
    minZoom: -4,
    maxZoom: 2,
    zoomSnap: 0.25,
  });

  const bounds = [[0, 0], [height, width]];
  L.imageOverlay(imageUrl, bounds).addTo(map);
  map.fitBounds(bounds);

  // Lock panning to the image bounds
  map.setMaxBounds(bounds);
  map.options.maxBoundsViscosity = 1.0;

  // Layers
  const eventsLayer = L.layerGroup().addTo(map);

  return { map, bounds, eventsLayer };
}

export function enableCoordDebug(map) {
  map.on("click", (e) => {
    console.log("Map click:", { y: Math.round(e.latlng.lat), x: Math.round(e.latlng.lng) });
  });
}