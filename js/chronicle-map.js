// ── Chronicle map layers ────────────────────────────────────────────────────
// Pure map geometry for Campaign Chronicle (no DOM, no React): which recorded
// routes to draw for a party selection, how events become pins (one per exact
// coordinate) and how nearby pins merge into zoom-dependent clusters.
// Runs in the browser (window.ChronicleMap) and in Node (tests/).
//
// Two concepts are kept apart on purpose:
//   events — points where something happened (data/events.json xp/yp)
//   routes — recorded journeys between places (data/routes.json); never derived from events.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChronicleMap = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const isNum = v => typeof v === "number" && isFinite(v);
  const validPoint = e => !!e && isNum(e.xp) && isNum(e.yp) && e.xp >= 0 && e.xp <= 100 && e.yp >= 0 && e.yp <= 100;

  // ── Routes ────────────────────────────────────────────────────────────────
  // routeLayers(model, characterIds) → { shared: [...], individual: [...] }
  //   individual: { characterId, points[] }           — a character's own journey (one polyline)
  //   shared:     { leg, memberIds[], points[] }      — one journey travelled together, drawn once
  // A stretch is shared only when two or more *visible* characters carry the same `leg` id on
  // it in routes.json — togetherness is never inferred from coordinates or events. A shared
  // leg is drawn with the waypoints of its first visible member (party order); the others'
  // copies of that stretch are not drawn again. Narrative filters do not enter here at all.
  function routeLayers(model, characterIds) {
    const order = model.pcs.map(p => p.id);
    const visible = order.filter(id => characterIds.includes(id) && model.routeById.has(id));
    const legMembers = new Map();
    visible.forEach(id => model.routeById.get(id).legIds.forEach(leg => {
      if (!legMembers.has(leg)) legMembers.set(leg, []);
      legMembers.get(leg).push(id);
    }));
    const isShared = leg => !!leg && legMembers.get(leg).length >= 2;
    const shared = [], individual = [];
    visible.forEach(id => {
      model.routeById.get(id).segments.forEach(seg => {
        let own = null, sh = null;
        const flushOwn = () => { if (own && own.length > 1) individual.push({ characterId: id, points: own }); own = null; };
        const flushSh  = () => { if (sh && sh.points.length > 1) shared.push(sh); sh = null; };
        for (let i = 1; i < seg.length; i++) {
          const a = seg[i - 1], b = seg[i];
          if (a.leg && a.leg === b.leg && isShared(a.leg)) {
            flushOwn();
            if (legMembers.get(a.leg)[0] !== id) { flushSh(); continue; }   // drawn by its first member
            if (!sh || sh.leg !== a.leg) { flushSh(); sh = { leg: a.leg, memberIds: legMembers.get(a.leg).slice(), points: [a] }; }
            sh.points.push(b);
          } else {
            flushSh();
            if (!own) own = [a];
            own.push(b);
          }
        }
        flushOwn(); flushSh();
      });
    });
    return { shared, individual };
  }

  // ── Pins ──────────────────────────────────────────────────────────────────
  // groupSpots(events) → one spot per exact coordinate, in chronological order of first event.
  // Events without (valid) coordinates are skipped — they simply have no pin.
  function groupSpots(events) {
    const byKey = new Map(), spots = [];
    events.forEach(ev => {
      if (!ev || !ev.hasCoords || !validPoint(ev)) return;
      const key = `${ev.xp},${ev.yp}`;
      let s = byKey.get(key);
      if (!s) { s = { key, xp: ev.xp, yp: ev.yp, events: [] }; byKey.set(key, s); spots.push(s); }
      if (!s.events.includes(ev)) s.events.push(ev);
    });
    spots.forEach(s => s.events.sort((a, b) => (a.chronoIndex ?? 0) - (b.chronoIndex ?? 0)));
    return spots;
  }

  // Screen distance (px) between two map points at a given zoom.
  //   pxX/pxY: screen pixels per 1 % of the map's width/height at scale 1.
  function screenDist(a, b, scale, pxX, pxY) {
    return Math.hypot((a.xp - b.xp) * pxX * scale, (a.yp - b.yp) * pxY * scale);
  }

  // clusterSpots(spots, { scale, pxX, pxY, threshold }) → markers.
  // Agglomerative: while any two markers are closer than `threshold` screen px, the closest
  // pair merges. So no two markers ever overlap on screen at this zoom. A marker with one
  // spot is a plain pin at the spot's exact coordinate; a marker with several spots is a
  // cluster drawn at their centroid (display only — no coordinate is changed). Every event
  // ends up in exactly one marker. Cost is O(n³) in spots, fine for a campaign's few dozen.
  function clusterSpots(spots, opts) {
    const { scale, pxX, pxY, threshold } = opts;
    const cl = spots.map((s, i) => ({ spots: [s], xp: s.xp, yp: s.yp, first: i }));
    for (;;) {
      let best = null;
      for (let i = 0; i < cl.length; i++)
        for (let j = i + 1; j < cl.length; j++) {
          const d = screenDist(cl[i], cl[j], scale, pxX, pxY);
          if (d < threshold && (!best || d < best.d)) best = { i, j, d };
        }
      if (!best) break;
      const a = cl[best.i], b = cl.splice(best.j, 1)[0];
      a.spots = a.spots.concat(b.spots);
      a.first = Math.min(a.first, b.first);
      a.xp = a.spots.reduce((t, s) => t + s.xp, 0) / a.spots.length;
      a.yp = a.spots.reduce((t, s) => t + s.yp, 0) / a.spots.length;
    }
    return cl.sort((a, b) => a.first - b.first).map(c => {
      c.spots.sort((a, b) => spots.indexOf(a) - spots.indexOf(b));
      const evs = c.spots.flatMap(s => s.events).sort((a, b) => (a.chronoIndex ?? 0) - (b.chronoIndex ?? 0));
      const one = c.spots.length === 1;
      return { key: c.spots[0].key, spots: c.spots, events: evs, isCluster: !one,
        xp: one ? c.spots[0].xp : c.xp, yp: one ? c.spots[0].yp : c.yp };
    });
  }

  // How far to zoom to pull a cluster apart: { scale, full }. `full` is true when every spot
  // ends up at least `threshold` px from the others; otherwise `scale` is maxScale and the
  // closest spots stay grouped (the list remains the way in). null when no zoom is left.
  function separationScale(marker, opts) {
    const { scale, pxX, pxY, threshold, maxScale } = opts;
    if (!marker.isCluster || scale >= maxScale * 0.98) return null;
    let min = Infinity;
    for (let i = 0; i < marker.spots.length; i++)
      for (let j = i + 1; j < marker.spots.length; j++)
        min = Math.min(min, screenDist(marker.spots[i], marker.spots[j], 1, pxX, pxY));
    if (!(min > 0)) return null;
    const need = threshold / min;                   // zoom at which the closest pair stops merging
    return need < maxScale ? { scale: Math.min(maxScale, Math.max(need * 1.15, scale * 1.2)), full: true } : { scale: maxScale, full: false };
  }

  // Horizontal shift (screen px) that keeps a popup of `width` centred on `anchorX` inside [margin, viewportW - margin].
  function clampShift(anchorX, width, viewportW, margin) {
    margin = margin == null ? 8 : margin;
    const left = anchorX - width / 2;
    if (width + 2 * margin >= viewportW) return viewportW / 2 - anchorX;
    if (left < margin) return margin - left;
    if (left + width > viewportW - margin) return viewportW - margin - (left + width);
    return 0;
  }

  return { routeLayers, groupSpots, clusterSpots, separationScale, screenDist, clampShift, validPoint };
});
