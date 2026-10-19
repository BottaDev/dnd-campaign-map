// ── Taller del Cronista ─────────────────────────────────────────────────────
// The DM's editor inside the chronicle: sessions, events, quests, characters and places as forms; the map editor on
// the real map; the local draft (IndexedDB, or memory) with backups, validation, conflicts, import and export.
// A UI module — React elements through h() — that index.html's Component creates only when #/taller or the map
// editor opens (window.ChronicleTaller.create(app, deps)). Every data rule lives in js/chronicle-editor.js (pure,
// tested in Node); a record's preview is the public page's own view-model fed by the draft.
//
// Nothing here publishes anything: the work stays in this browser until it is exported as a package that someone
// incorporates into the repository (tools/apply-draft.js or GitHub). There is no password because there is nothing
// to protect: whoever opens the Taller edits only their own local copy, never the published chronicle.
(function (root) {
  "use strict";

  const isNum = v => typeof v === "number" && isFinite(v);
  const arr = v => (Array.isArray(v) ? v : []);
  const str = v => (v == null ? "" : String(v));
  const nonEmpty = v => typeof v === "string" && v.trim() !== "";
  const cls = (...xs) => xs.filter(Boolean).join(" ");
  const stop = e => e.stopPropagation();
  const enc = s => encodeURIComponent(s);
  const pad2 = n => String(n).padStart(2, "0");
  const stamp = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const short = (s, n) => { const x = str(s).replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1).trimEnd() + "…" : x; };

  // The Taller's sections (each a route) and where a record's form belongs.
  const TABS = [
    { id: "home", icon: "quill" }, { id: "sessions", icon: "sessions" }, { id: "events", icon: "chronicle" },
    { id: "quests", icon: "quests" }, { id: "characters", icon: "characters" }, { id: "places", icon: "places" },
    { id: "map", icon: "map" }, { id: "draft", icon: "download" },
  ];
  const TAB_OF = { session: "sessions", event: "events", quest: "quests", character: "characters", place: "places", npc: "characters" };
  const FORM_KINDS = { session: 1, event: 1, quest: 1, character: 1, place: 1 };
  const BADGE = { new: "tone-done", modified: "tone-active", deleted: "tone-failed" };
  const SETTLE = 300;           // ms after the last keystroke before the preview and the checks catch up
  const SAVE_DELAY = 400;       // ms after the last change before the draft is written to this browser
  const NPC_CATEGORIES = ["person", "deity", "creature", "faction"];

  function create(app, deps) {
    const E = root.ChronicleEditor, React = root.React;
    const { h, M, I18N, ICONS, EVENT_ICONS, STATUS_ICONS, PLACE_ICONS, routeHash, isMapEdit } = deps;
    const t = (k, p) => app.t(k, p);
    const ico = k => ICONS[k] || null;
    const render = () => app._tlRender();
    const say = msg => app._say(msg);

    // ── State ───────────────────────────────────────────────────────────────
    const S = {
      loaded: false, store: null, storeKind: "", storeError: "", persisted: null, persistAsked: false,
      draft: null, settled: null, savedRev: "none", save: "loading", saveError: "", savedAt: null, pendingSave: false,
      saveTimer: 0, settleTimer: 0, flashTimer: 0, otherTab: false, fresh: null, freshNote: "", refreshing: null, bc: null, memo: {},
      ui: { textLang: app.state.lang === "en" ? "en" : "es", q: {}, evSession: "", evWhere: "all", touched: new Set(), showAll: false,
        dialog: null, dialogReturn: null, preview: false, previewHidden: false, flash: null, lastExport: null, exporting: false,
        backups: null, focusNext: null, focusHead: false, pickQ: {} },
      mx: { pending: {}, precision: {}, drag: null, down: null, query: "", session: "", filter: "all", listKind: "event", sheetMin: false, choice: null, returnTo: null, rafPending: null },
    };

    // ── Published data, the draft and what is derived from it ──────────────
    const memo = (key, deps2, fn) => {
      const c = S.memo[key];
      if (c && c.deps.length === deps2.length && c.deps.every((d, i) => d === deps2[i])) return c.val;
      const val = fn(); S.memo[key] = { deps: deps2, val }; return val;
    };
    const content0 = () => (app._content && app._content[E.LOCALE]) || null;
    const appBase = () => memo("appBase", [app.raw, content0()], () => ({ raw: app.raw, content: content0() || {} }));
    // The published data the draft is measured against: the page's own copy, or a fresher one fetched for the export.
    const pub = () => S.fresh || appBase();
    const applied = () => memo("applied", [S.settled, pub()], () => E.applyDraft(pub(), S.settled));
    const model = lang => { const L = lang || app.state.lang; return memo("model:" + L, [S.settled, pub()], () => M.build(applied().raw, {
      locale: L, t: app._translator(L), translations: { [E.LOCALE]: applied().content }, searchTs: I18N.LOCALES.map(l => app._translator(l.code)) })); };
    const portraits = () => memo("assets", [pub()], () => [...new Set([...arr(pub().raw.characters), ...arr(pub().raw.npcs)].map(p => p && p.sealImg).filter(Boolean))]);
    const checks = () => memo("checks", [S.settled, pub()], () => E.validate(pub(), S.settled, { assets: portraits() }));
    const conflicts = () => memo("conflicts", [S.settled, pub()], () => E.conflicts(pub(), S.settled));
    const summary = () => memo("summary", [S.draft], () => E.summarize(S.draft));
    const rec = (kind, id) => E.currentPair(S.draft, pub(), kind, id);
    const status = (kind, id) => E.statusOf(S.draft, kind, id);
    const isPc = id => arr(pub().raw.characters).some(p => p && p.id === id);
    const personKind = id => (isPc(id) ? "character" : "npc");
    const routeKind = kind => (kind === "npc" ? "character" : kind);
    const formHref = (kind, id) => `#/taller/${routeKind(kind)}/${enc(id)}`;
    const tabHref = tab => (tab === "home" ? "#/taller" : `#/taller/tab/${tab}`);

    // Every change goes through here: the draft in memory at once, this browser shortly after; while typing, the
    // preview and the checks follow once the typing pauses (the fields themselves always show what was typed).
    function commit(next, opts) {
      if (!next || next === S.draft) return;
      S.draft = next;
      scheduleSave();
      clearTimeout(S.settleTimer);
      if (opts && opts.typing) S.settleTimer = setTimeout(() => { S.settled = S.draft; render(); }, SETTLE);
      else S.settled = S.draft;
      render();
    }
    const put = (kind, id, pair, typing) => commit(E.putRecord(S.draft, pub(), kind, id, pair), { typing });

    // ── Saving in this browser ──────────────────────────────────────────────
    function scheduleSave() {
      S.pendingSave = true;
      if (S.save !== "memory" && S.save !== "conflict") S.save = "saving";
      clearTimeout(S.saveTimer);
      S.saveTimer = setTimeout(flush, SAVE_DELAY);
    }
    // One save at a time: each waits for the one before it, so it is checked against the revision that one stored.
    function flush() {
      clearTimeout(S.saveTimer);
      S.chain = (S.chain || Promise.resolve()).then(saveNow, saveNow);
      return S.chain;
    }
    async function saveNow() {
      if (!S.pendingSave || !S.store || S.save === "conflict") return;
      S.pendingSave = false;
      const d = S.draft;
      try {
        const res = await S.store.save(d, S.savedRev);
        if (!res.ok) { S.save = "conflict"; S.pendingSave = true; S.otherTab = true; render(); return; }
        S.savedRev = { id: d.id, rev: d.rev }; S.savedAt = new Date();
        S.save = S.storeKind === "memory" ? "memory" : "saved"; S.saveError = "";
        try { if (S.bc) S.bc.postMessage({ type: "saved", id: d.id, rev: d.rev }); } catch (e) { /* another tab is optional */ }
        askPersistence();
      } catch (e) {
        S.save = "error"; S.saveError = String((e && e.message) || e); S.pendingSave = true;
      }
      render();
    }
    // Ask the browser to keep this site's data under storage pressure (best effort; the page says what it got).
    function askPersistence() {
      if (S.persistAsked || S.storeKind !== "indexeddb") return;
      S.persistAsked = true;
      try {
        const st = navigator.storage;
        if (st && st.persist) st.persisted().then(p => (p ? true : st.persist())).then(v => { S.persisted = !!v; render(); }).catch(() => {});
      } catch (e) { /* not available */ }
    }
    const backup = reason => (S.store && S.draft ? S.store.backup(S.draft, reason).then(() => loadBackups()).catch(() => {}) : Promise.resolve());
    function loadBackups() {
      if (!S.store) return Promise.resolve();
      return S.store.backups().then(list => { S.ui.backups = list; render(); }).catch(() => { S.ui.backups = []; render(); });
    }
    function replaceDraft(d, msg) {
      S.draft = d; S.settled = d; S.ui.showAll = false;
      scheduleSave(); render();
      if (msg) flash(msg, "ok");
    }
    // Changes the published data already holds (the export was incorporated) leave the draft, after a backup,
    // with a word to the DM — instead of reading as conflicts with identical values.
    function settlePublished() {
      if (!S.draft) return;
      const done = E.publishedChanges(pub(), S.draft);
      if (!done.length) return;
      backup("published");
      replaceDraft(E.dropPublished(pub(), S.draft), t("taller.publishedDone", { count: done.length }));
    }

    async function init() {
      let idb = null;
      try { idb = root.indexedDB || null; } catch (e) { idb = null; }
      S.store = await E.createStore({ indexedDB: idb });
      S.storeKind = S.store.kind; S.storeError = S.store.error || "";
      let stored = null;
      try { stored = await S.store.load(); } catch (e) { S.storeError = String((e && e.message) || e); }
      let d = null;
      if (stored) {
        const parsed = E.parseDraft(JSON.stringify(stored));
        if (parsed.error) { try { await S.store.backup(stored, "unreadable"); } catch (e) { /* kept as it was */ } flash(t("taller.unreadable"), "warn"); }
        else d = parsed.draft;
      }
      S.draft = d || E.emptyDraft(pub());
      S.settled = S.draft;
      S.savedRev = stored ? { id: stored.id, rev: stored.rev } : "none";
      S.save = S.storeKind === "memory" ? "memory" : "saved";
      if (d && E.summarize(d).total) S.store.backup(d, "open").catch(() => {});
      try {
        S.bc = new BroadcastChannel("chronicle-taller");
        S.bc.onmessage = ev => { const m = ev.data || {}; if (m.type === "saved" && S.draft && !(m.id === S.draft.id && m.rev === S.draft.rev)) { S.otherTab = true; render(); } };
      } catch (e) { S.bc = null; }
      try { if (navigator.storage && navigator.storage.persisted) S.persisted = await navigator.storage.persisted(); } catch (e) { /* unknown */ }
      S.loaded = true;
      const r = app.state.route;
      if (isMapEdit(r) && r.id && app.state.isMobile) S.mx.sheetMin = true;       // a direct link to the editor on a phone
      render();
      settlePublished();
      if (r.section === "taller" && r.kind === "tab" && r.id === "draft") { refreshPublished(); loadBackups(); }
      if (isMapEdit(r) && app._vpEl) app._syncMap(null, true);
    }

    // ── Messages ────────────────────────────────────────────────────────────
    function flash(text, level) {
      S.ui.flash = { text, level: level || "ok" };
      say(text);
      clearTimeout(S.flashTimer);
      S.flashTimer = setTimeout(() => { S.ui.flash = null; render(); }, 7000);
      render();
    }
    const langName = l => t(l === "en" ? "taller.langEn" : "taller.langEs");
    const kindName = kind => t(`taller.kind.${routeKind(kind)}`);
    const kindLow = kind => t(`taller.kindLow.${routeKind(kind)}`);

    // Names for records, references and issues — the draft as it will read, in the interface's language.
    function nameOf(kind, id) {
      const m = model();
      if (kind === "session") { const s = m.sessionByNo.get(Number(id)); return t("common.session", { n: id }) + (s && s.title ? ` — ${s.title}` : ""); }
      if (kind === "event") { const e = m.eventById.get(id); if (e) return e.title; }
      if (kind === "quest") { const q = m.questById.get(id); if (q) return q.title; }
      if (kind === "place") { const p = m.placeById.get(id); if (p) return p.name; }
      if (kind === "character" || kind === "npc" || kind === "person") { const p = m.personById.get(id); if (p) return p.name; }
      if (kind === "route") { const p = m.personById.get(id); return t("taller.routeOf", { name: p ? p.name : id }); }
      const ch = S.draft && S.draft.changes[kind] && S.draft.changes[kind][id];
      const en = ch && ch.base && ch.base.en;
      return (en && (en.title || en.name)) || id;
    }

    // ── Validation messages ─────────────────────────────────────────────────
    const FIELD_KEYS = { "ig.start": "igStart", "ig.end": "igEnd", "ig.rest": "igRest", "recap.summary": "recapSummary", "recap.highlights": "highlights", xp: "position", yp: "position" };
    function fieldLabel(kind, field) {
      if (!field) return "";
      const parts = String(field).split("."), named = parts.filter(p => !/^\d+$/.test(p));
      let key = FIELD_KEYS[named.join(".")] || named[named.length - 1];
      if (/Plots$/.test(named[0])) key = named[1] === "questId" ? "plotQuest" : named[1] === "name" ? "plotName" : named[1] || "plots";
      if (named[0] === "relations") key = "relations";
      if (kind === "quest" && key === "characterIds") key = "questCharacters";
      return t(`taller.f.${key}`);
    }
    function issueText(i) {
      if (i.code === "model") return i.params.msg;
      const p = { ...i.params, field: fieldLabel(i.kind, i.field) };
      if (p.refs) p.refs = p.refs.map(r => `${kindName(r.kind === "route" ? "character" : r.kind)} «${nameOf(r.kind, r.id)}»`).join(", ");
      if (p.ref) p.ref = nameOf(p.what === "person" || p.what === "faction" ? "person" : p.what === "npc" ? "person" : p.what, p.ref) || p.ref;
      if (p.what) p.what = t(`taller.what.${p.what}`);
      return t(`taller.v.${i.code}`, p);
    }
    const issuesOf = (kind, id) => checks().issues.filter(i => i.kind === kind && i.id === String(id));
    function shownIssues(kind, id, field) {
      return issuesOf(kind, id).filter(i => i.field === field && (i.code !== "required" || S.ui.showAll || S.ui.touched.has(`${kind}:${id}:${field}`)));
    }

    // ── Form controls ───────────────────────────────────────────────────────
    const fid = (ctx, path, lang) => ["tl", ctx.kind, ctx.id, ...path, lang].filter(x => x != null && x !== "").join("-").replace(/[^A-Za-z0-9_-]/g, "_");
    const focusRef = el => { if (el && S.ui.focusNext && el.id === S.ui.focusNext) { S.ui.focusNext = null; requestAnimationFrame(() => el.focus({ preventScroll: false })); } };
    const touch = (ctx, field) => () => { const k = `${ctx.kind}:${ctx.id}:${field}`; if (!S.ui.touched.has(k)) { S.ui.touched.add(k); render(); } };
    function errorLines(errs, id) {
      return errs.map((e, i) => h("p", { key: "e" + i, id: i === 0 ? id + "-e" : undefined, className: cls("cc-tl-err", e.level !== "error" && "cc-tl-warnmsg") }, ico("warn"), h("span", null, issueText(e))));
    }
    function describe(id, hint, errs) { return [hint ? id + "-h" : "", errs.length ? id + "-e" : ""].filter(Boolean).join(" ") || undefined; }
    function wrap(o, control) {
      return h("div", { className: cls("cc-tl-field", o.wide && "wide", o.errs && o.errs.some(e => e.level === "error") && "has-err"), key: o.key },
        h("label", { className: "cc-tl-label", htmlFor: o.id }, o.label,
          o.required ? h("span", { className: "cc-tl-req" }, t("taller.required")) : null,
          o.langTag ? h("span", { className: "cc-tl-lang" }, o.langTag) : null),
        control,
        o.hint ? h("p", { className: "cc-tl-hint", id: o.id + "-h" }, o.hint) : null,
        o.other || null,
        ...errorLines(o.errs || [], o.id));
    }
    function group(o, body) {
      return h("fieldset", { className: cls("cc-tl-field", o.wide !== false && "wide"), key: o.key, style: { border: 0, padding: 0, minWidth: 0 } },
        h("legend", { className: "cc-tl-label", style: { padding: 0, marginBottom: 6 } }, o.label, o.langTag ? h("span", { className: "cc-tl-lang" }, " " + o.langTag) : null),
        body,
        o.hint ? h("p", { className: "cc-tl-hint" }, o.hint) : null,
        ...errorLines(o.errs || [], o.id || "g"));
    }
    // A text, translated (the language chosen above the form) or plain (ids, dates written as text, numbers as text).
    function textField(ctx, path, o) {
      o = o || {};
      const lang = o.plain ? "en" : S.ui.textLang, other = lang === "en" ? "es" : "en";
      const id = fid(ctx, path, o.plain ? "" : lang), field = path.join(".");
      const value = E.textAt(ctx.pair, path, lang), otherVal = o.plain ? "" : E.textAt(ctx.pair, path, other);
      const errs = shownIssues(ctx.kind, ctx.id, field);
      const onChange = e => {
        const v = e.target.value, cur = rec(ctx.kind, ctx.id);
        put(ctx.kind, ctx.id, o.plain ? E.withField(cur, path, v) : E.withText(cur, path, lang, v), true);
      };
      const props = { id, ref: focusRef, className: cls("cc-input", o.area && "cc-tl-area", o.area && o.short && "short"), value, onChange, onBlur: touch(ctx, field),
        placeholder: o.placeholder, autoComplete: "off", spellCheck: o.plain ? false : undefined, lang: o.plain ? undefined : lang === "es" ? "es-AR" : "en",
        "aria-invalid": errs.some(x => x.level === "error") ? "true" : undefined, "aria-describedby": describe(id, o.hint, errs) };
      const control = o.area ? h("textarea", { ...props, rows: o.short ? 2 : 4 }) : h("input", { ...props, type: "text" });
      const otherLine = o.plain ? null : otherVal ? h("p", { className: "cc-tl-other", lang: other === "es" ? "es-AR" : "en" }, h("b", null, langName(other) + ": "), short(otherVal, 160))
        : value && o.noteMissing !== false ? h("p", { className: "cc-tl-other" }, t(other === "en" ? "taller.noEnglishYet" : "taller.noSpanishYet")) : null;
      return wrap({ id, key: o.key || id, label: o.label, required: o.required, langTag: o.plain ? null : langName(lang), hint: o.hint, other: otherLine, errs, wide: o.wide }, control);
    }
    function numberField(ctx, path, o) {
      const id = fid(ctx, path), field = path.join("."), v = E.getIn(ctx.pair.en, path);
      const errs = shownIssues(ctx.kind, ctx.id, field);
      const onChange = e => {
        const raw = e.target.value;
        const n = raw === "" ? undefined : o.integer ? parseInt(raw, 10) : parseFloat(raw);
        put(ctx.kind, ctx.id, E.withField(rec(ctx.kind, ctx.id), path, n === undefined || isNaN(n) ? undefined : n), true);
      };
      return wrap({ id, key: id, label: o.label, hint: o.hint, errs, wide: o.wide },
        h("input", { id, ref: focusRef, className: "cc-input", type: "number", inputMode: o.integer ? "numeric" : "decimal", min: o.min, max: o.max, step: o.step || (o.integer ? 1 : "any"),
          value: isNum(v) ? String(v) : "", onChange, onBlur: touch(ctx, field), "aria-describedby": describe(id, o.hint, errs), "aria-invalid": errs.length ? "true" : undefined }));
    }
    function dateField(ctx, path, o) {
      const id = fid(ctx, path), field = path.join("."), v = str(E.getIn(ctx.pair.en, path));
      const errs = shownIssues(ctx.kind, ctx.id, field);
      return wrap({ id, key: id, label: o.label, required: o.required, hint: o.hint, errs },
        h("input", { id, ref: focusRef, className: "cc-input cc-date", type: "date", lang: app.t.meta.htmlLang, value: v, onBlur: touch(ctx, field),
          onChange: e => put(ctx.kind, ctx.id, E.withField(rec(ctx.kind, ctx.id), path, e.target.value || undefined)),
          "aria-describedby": describe(id, o.hint, errs), "aria-invalid": errs.some(x => x.level === "error") ? "true" : undefined }));
    }
    const option = (o, i) => h("option", { key: `${o.value}|${i}`, value: o.value, disabled: o.disabled }, o.label);
    function selectField(ctx, path, o) {
      const id = fid(ctx, path), field = o.field || path.join("."), v = E.getIn(ctx.pair.en, path);
      const errs = shownIssues(ctx.kind, ctx.id, field);
      const onChange = o.onChange || (e => { const x = e.target.value; put(ctx.kind, ctx.id, E.withField(rec(ctx.kind, ctx.id), path, x === "" ? undefined : o.number ? Number(x) : x)); });
      const opts = [...(o.empty != null ? [{ value: "", label: o.empty }] : []), ...o.options];
      if (v != null && v !== "" && !opts.some(x => String(x.value) === String(v))) opts.push({ value: v, label: String(v) });
      return wrap({ id, key: id, label: o.label, required: o.required, hint: o.hint, errs, wide: o.wide },
        h("span", { className: "cc-selwrap" }, h("select", { id, ref: focusRef, className: "cc-select", value: v == null ? "" : String(v), onChange,
          "aria-describedby": describe(id, o.hint, errs), "aria-invalid": errs.some(x => x.level === "error") ? "true" : undefined }, opts.map(option))));
    }
    // Toggles for a short list (party members, sessions, factions): pressed = chosen; the stored order is kept.
    function chipsField(ctx, path, o) {
      const sel = arr(E.getIn(ctx.pair.en, path)), field = path.join("."), errs = shownIssues(ctx.kind, ctx.id, field);
      const toggle = v => {
        const cur = arr(E.getIn(rec(ctx.kind, ctx.id).en, path));
        let next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v];
        if (o.sort) next = next.slice().sort((a, b) => a - b);
        put(ctx.kind, ctx.id, E.withField(rec(ctx.kind, ctx.id), path, next));
      };
      return group({ key: fid(ctx, path), id: fid(ctx, path), label: o.label, hint: o.hint, errs },
        o.options.length ? h("div", { className: "cc-tl-chips" }, o.options.map(op => h("button", { key: String(op.value), type: "button",
          className: cls("cc-pcchip", sel.includes(op.value) && "is-on", !op.seal && "plain"), "aria-pressed": sel.includes(op.value) ? "true" : "false", onClick: () => toggle(op.value) },
          op.seal || null, op.icon || null, op.label))) : h("p", { className: "cc-tl-hint" }, o.none || t("taller.nothingToChoose")));
    }
    // A long list to choose from (people, quests, events): a filter and checkboxes, the chosen ones first.
    function pickList(key, o) {
      const q = M.fold(S.ui.pickQ[key] || ""), toks = q.split(" ").filter(Boolean);
      const chosen = o.options.filter(op => o.isOn(op.value)), rest = o.options.filter(op => !o.isOn(op.value) && (!toks.length || toks.every(tk => M.fold(op.label + " " + (op.meta || "")).includes(tk))));
      const shownRest = rest.slice(0, o.limit || 60);
      return h("div", { className: "cc-tl-pick" },
        o.options.length > 8 ? h("div", { className: "cc-search" }, h("span", { className: "cc-search-ico" }, ico("search")),
          h("input", { className: "cc-input", type: "search", value: S.ui.pickQ[key] || "", placeholder: o.filterLabel || t("taller.filterList"), "aria-label": `${o.label} — ${t("taller.filterList")}`,
            onChange: e => { S.ui.pickQ[key] = e.target.value; render(); }, autoComplete: "off" })) : null,
        h("div", { className: "cc-tl-picklist cc-scroll", role: "group", "aria-label": o.label },
          [...chosen, ...shownRest].map(op => h("label", { key: String(op.value), className: "cc-tl-check" },
            h("input", { type: "checkbox", checked: o.isOn(op.value), onChange: () => o.toggle(op.value) }),
            h("span", null, op.label), op.meta ? h("small", null, op.meta) : null)),
          !chosen.length && !shownRest.length ? h("p", { className: "cc-tl-hint", style: { padding: "6px 8px" } }, t("taller.noMatches")) : null,
          rest.length > shownRest.length ? h("p", { className: "cc-tl-hint", style: { padding: "6px 8px" } }, t("taller.moreMatches", { count: rest.length - shownRest.length })) : null));
    }
    function pickField(ctx, path, o) {
      const field = path.join("."), errs = shownIssues(ctx.kind, ctx.id, field);
      const cur = () => arr(E.getIn(rec(ctx.kind, ctx.id).en, path));
      return group({ key: fid(ctx, path), id: fid(ctx, path), label: o.label, hint: o.hint, errs },
        pickList(fid(ctx, path), { label: o.label, options: o.options, filterLabel: o.filterLabel, isOn: v => arr(E.getIn(ctx.pair.en, path)).includes(v),
          toggle: v => { const c = cur(); put(ctx.kind, ctx.id, E.withField(rec(ctx.kind, ctx.id), path, c.includes(v) ? c.filter(x => x !== v) : [...c, v])); } }));
    }
    const iconBtn = (label, icon, onClick, props) => h("button", { type: "button", className: "cc-iconbtn sm", title: label, "aria-label": label, onClick, ...(props || {}) }, typeof icon === "string" && ICONS[icon] ? ico(icon) : icon);
    // Buttons that move or remove an item of a list (both languages move together).
    function itemButtons(ctx, path, i, n, what) {
      const move = d => () => put(ctx.kind, ctx.id, E.withList(rec(ctx.kind, ctx.id), path, "move", i, d));
      return h("div", { className: "cc-tl-item-x" },
        iconBtn(t("taller.moveUp", { what }), "↑", move(-1), { disabled: i === 0 }),
        iconBtn(t("taller.moveDown", { what }), "↓", move(1), { disabled: i === n - 1 }),
        iconBtn(t("taller.removeItem", { what }), "trash", () => put(ctx.kind, ctx.id, E.withList(rec(ctx.kind, ctx.id), path, "remove", i))));
    }
    // A list of texts in both languages, edited in the language chosen above the form.
    function listField(ctx, path, o) {
      const lang = S.ui.textLang, other = lang === "en" ? "es" : "en";
      const items = arr(E.getIn(ctx.pair.en, path)), esl = E.esList(ctx.pair, path), field = path.join(".");
      const at = (l, i) => (l === "en" ? str(items[i]) : esl ? str(esl[i]) : "");
      const what = o.item || t("taller.item");
      const add = () => { const p = E.withList(rec(ctx.kind, ctx.id), path, "add"); S.ui.focusNext = fid(ctx, [...path, items.length], lang); put(ctx.kind, ctx.id, p); };
      return group({ key: fid(ctx, path), id: fid(ctx, path), label: o.label, langTag: langName(lang), hint: o.hint, errs: shownIssues(ctx.kind, ctx.id, field) },
        h("div", { className: "cc-tl-items" },
          items.map((x, i) => {
            const id = fid(ctx, [...path, i], lang), ov = at(other, i);
            const props = { id, ref: focusRef, className: cls("cc-input", o.area && "cc-tl-area short"), value: at(lang, i), lang: lang === "es" ? "es-AR" : "en", "aria-label": `${what} ${i + 1} (${langName(lang)})`,
              onChange: e => put(ctx.kind, ctx.id, E.withText(rec(ctx.kind, ctx.id), [...path, i], lang, e.target.value), true) };
            return h("div", { key: i, className: "cc-tl-item" },
              h("div", { className: "cc-tl-field" }, o.area ? h("textarea", { ...props, rows: 2 }) : h("input", { ...props, type: "text", autoComplete: "off" }),
                ov ? h("p", { className: "cc-tl-other" }, h("b", null, langName(other) + ": "), short(ov, 140)) : null),
              itemButtons(ctx, path, i, items.length, what));
          }),
          h("button", { type: "button", className: "cc-btn ghost cc-tl-add", onClick: add }, ico("plus"), o.addLabel || t("taller.addItem"))));
    }
    // Places as a tree in a select: indented by depth; `exclude` (a place and what lies inside it) cannot be chosen.
    function placeOptions(exclude) {
      const m = model(), idx = M.placeIndex(m, { cmp: (a, b) => a.name.localeCompare(b.name, app.state.lang) });
      return M.placeOrder(m, idx).map(id => { const p = m.placeById.get(id); return { value: id, label: `${" ".repeat(p.depth)}${p.name} · ${p.kindLabel}`, disabled: !!exclude && exclude.has(id) }; });
    }
    const peopleOptions = filter => model().people.filter(p => !filter || filter(p)).map(p => ({ value: p.id, label: p.name, meta: p.kind === "pc" ? t("taller.partyMember") : p.categoryLabel }));
    const questOptions = () => model().quests.map(q => ({ value: q.id, label: q.title, meta: q.statusLabel }));
    const sessionOptions = () => model().sessions.slice().sort((a, b) => b.no - a.no).map(s => ({ value: s.no, label: t("common.session", { n: s.no }) + (s.title ? ` — ${s.title}` : "") }));
    const pcChips = () => model().pcs.map(p => ({ value: p.id, label: p.name, seal: h("span", { className: app.sealCls(p), style: p.sealImg ? { backgroundImage: `url("${p.sealImg}")` } : undefined }, app.mono(p)) }));

    // ── Map positions in the forms ──────────────────────────────────────────
    const pointOf = en => (en && isNum(en.xp) && isNum(en.yp) ? { xp: en.xp, yp: en.yp } : null);
    const fmtPoint = p => `X ${p.xp.toFixed(2)} · Y ${p.yp.toFixed(2)}`;
    function planarPlace(id) { const p = model().placeById.get(id); return !!(p && p.isPlanar); }
    function suggestionText(s) {
      if (!s || !s.source) return "";
      const place = nameOf("place", s.placeId);
      if (s.source === "place") return t(s.precision === "exact" ? "taller.sug.placeExact" : "taller.sug.placeApprox", { place });
      if (s.source === "events") return t("taller.sug.events", { place, count: s.count });
      if (s.source === "inside") return t("taller.sug.inside", { place, count: s.count });
      return t("taller.sug.parent", { place });
    }
    const precisionBadge = p => h("span", { className: cls("cc-mx-src", p === "exact" ? "is-exact" : "is-approx") }, t(p === "exact" ? "taller.precExact" : "taller.precApprox"));
    function copyText(text) {
      const done = () => flash(t("mx.copied", { text }), "ok");
      try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); return; } } catch (e) { /* fall back */ }
      fallbackCopy(text, done);
    }
    function fallbackCopy(text, done) {
      const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { flash(t("mx.copyFailed", { text }), "warn"); }
      ta.remove();
    }
    function locate(kind, id) {
      S.mx.returnTo = { key: `${kind}:${id}`, hash: location.hash };
      app.navigate(kind === "place" ? `#/map/editplace/${enc(id)}` : `#/map/edit/${enc(id)}`);
    }
    function positionBlock(ctx) {
      const en = ctx.pair.en || {}, cur = pointOf(en), pubEn = E.publishedPair(pub(), ctx.kind, ctx.id).en, pubPt = pointOf(pubEn);
      const changed = !!cur !== !!pubPt || (cur && pubPt && (cur.xp !== pubPt.xp || cur.yp !== pubPt.yp));
      const planar = ctx.kind === "place" ? planarPlace(ctx.id) : !!en.locationId && planarPlace(en.locationId);
      const sug = ctx.kind === "event" ? E.suggestPosition(model(), { locationId: en.locationId, excludeEventId: ctx.id })
        : (s => (s.source === "place" ? null : s))(E.suggestPosition(model(), { locationId: ctx.id }));
      const pending = S.mx.pending[`${ctx.kind}:${ctx.id}`];
      const setPoint = (p, precision) => {
        let pair = E.withField(E.withField(rec(ctx.kind, ctx.id), ["xp"], p ? p.xp : undefined), ["yp"], p ? p.yp : undefined);
        if (ctx.kind === "place") pair = E.withField(pair, ["mapPrecision"], p ? precision || (pair.en && pair.en.mapPrecision) || "approximate" : undefined);
        put(ctx.kind, ctx.id, pair);
      };
      const errs = [...shownIssues(ctx.kind, ctx.id, "xp"), ...shownIssues(ctx.kind, ctx.id, "mapPrecision")];
      const useSug = sug && sug.source && (!cur || Math.abs(cur.xp - sug.point.xp) + Math.abs(cur.yp - sug.point.yp) > 0.05);
      return group({ key: "pos", id: fid(ctx, ["pos"]), label: t("taller.f.position"), errs,
        hint: ctx.kind === "place" ? t("taller.placePosHint") : t("taller.eventPosHint") },
        h("div", null,
          h("p", { className: "cc-mx-pos" },
            cur ? h("b", { className: "cc-tl-coord" }, fmtPoint(cur)) : h("span", null, t("taller.noPosition")),
            cur && ctx.kind === "place" ? precisionBadge(en.mapPrecision) : null,
            cur || pubPt ? h("span", { className: "cc-mx-src" }, t(changed ? "taller.posDraft" : "taller.posPublished")) : null,
            pending ? h("span", { className: "cc-mx-src is-pending" }, t("taller.posPending")) : null),
          planar && (ctx.kind === "place" || !cur) ? h("p", { className: "cc-tl-hint" }, t(ctx.kind === "place" ? "taller.planarPlace" : "taller.planarEvent")) : null,
          useSug && !planar ? h("div", { className: "cc-mx-sug" }, h("p", null, suggestionText(sug), " ", precisionBadge(sug.precision), " ", h("span", { className: "cc-tl-coord" }, `(${fmtPoint(sug.point)})`)),
            h("button", { type: "button", className: "cc-btn ghost", onClick: () => { setPoint(sug.point, sug.precision); flash(t("taller.sugUsed"), "ok"); } }, ico("target"), t(cur ? "taller.useSugInstead" : "taller.useSug"))) : null,
          !sug || !sug.source ? (en.locationId || ctx.kind === "place") && !planar && !cur ? h("p", { className: "cc-tl-hint" }, t("taller.sug.none")) : null : null,
          h("div", { className: "cc-tl-actions" },
            planar && ctx.kind === "place" ? null : h("button", { type: "button", className: "cc-btn", onClick: () => locate(ctx.kind, ctx.id) }, ico("crosshair"), t(cur ? "taller.adjustOnMap" : "taller.placeOnMap")),
            cur ? h("button", { type: "button", className: "cc-btn ghost", onClick: () => copyText(E.coordsText(cur)) }, ico("copy"), t("mx.copy")) : null,
            changed && pubPt ? h("button", { type: "button", className: "cc-btn ghost", onClick: () => setPoint(pubPt, pubEn.mapPrecision) }, ico("undo"), t("mx.revertPublished")) : null,
            cur ? h("button", { type: "button", className: "cc-btn ghost is-danger", onClick: () => confirm({ title: t("taller.removePosQ"), body: [t("taller.removePosD", { name: nameOf(ctx.kind, ctx.id) })],
              confirmLabel: t("mx.remove"), danger: true, onConfirm: () => setPoint(null) }) }, ico("trash"), t("mx.remove")) : null),
          ctx.kind === "place" && cur ? selectField(ctx, ["mapPrecision"], { label: t("taller.f.mapPrecision"), options: [{ value: "exact", label: t("taller.precExact") }, { value: "approximate", label: t("taller.precApprox") }], hint: t("taller.precHint") }) : null));
    }

    // ── Dialogs ─────────────────────────────────────────────────────────────
    function openDialog(dg) { S.ui.dialogReturn = document.activeElement; S.ui.dialog = dg; render(); }
    function closeDialog() {
      const back = S.ui.dialogReturn; S.ui.dialog = null; S.ui.dialogReturn = null; render();
      if (back && back.isConnected && back.focus) requestAnimationFrame(() => back.focus({ preventScroll: true }));
    }
    const confirm = o => openDialog({ type: "confirm", ...o });
    const dialogFocus = el => { if (el && !el.dataset.focused) { el.dataset.focused = "1"; requestAnimationFrame(() => el.focus({ preventScroll: true })); } };
    function trapTab(e) {
      const dlg = document.querySelector('[data-dialog="taller"]'); if (!dlg) return;
      const all = [...dlg.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
      if (!all.length) return;
      const first = all[0], last = all[all.length - 1], cur = document.activeElement;
      if (!dlg.contains(cur)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    }
    function renderDialog() {
      const dg = S.ui.dialog; if (!dg) return null;
      const body = dg.type === "confirm" ? confirmBody(dg) : dg.type === "new" ? newBody(dg) : dg.type === "import" ? importBody(dg) : null;
      return h("div", { className: "cc-overlay", onClick: closeDialog, key: "dlg" },
        h("div", { className: "cc-modal cc-tl-dialog cc-scroll", role: "dialog", "aria-modal": "true", "aria-labelledby": "cc-tl-dlg-h", "data-dialog": "taller", onClick: stop },
          h("h2", { id: "cc-tl-dlg-h", tabIndex: -1, ref: dg.type === "new" ? undefined : dialogFocus }, dg.title), body));
    }
    function confirmBody(dg) {
      return h(React.Fragment, null,
        ...arr(dg.body).map((p, i) => (Array.isArray(p) ? h("ul", { key: i }, p.map((x, j) => h("li", { key: j }, x))) : h("p", { key: i }, p))),
        h("div", { className: "cc-tl-actions end" },
          h("button", { type: "button", className: "cc-btn ghost", onClick: closeDialog }, dg.cancelLabel || t("common.cancel")),
          dg.onConfirm ? h("button", { type: "button", className: cls("cc-btn", dg.danger && "is-danger"), onClick: () => { const f = dg.onConfirm; closeDialog(); f(); } }, dg.confirmLabel || t("taller.confirm")) : null));
    }

    // ── New records ─────────────────────────────────────────────────────────
    // A short dialog asks for what makes the record (its title or name, its session) — the id follows the
    // repository's conventions from it — then the full form opens with the cursor in its first empty field.
    function startNew(kind, preset) {
      const m = model(), latest = M.latestSession(m);
      const f = { title: "", type: "", kind: "", parentId: "", category: "person", status: "active", date: today(),
        no: E.nextSessionNo(pub(), S.draft), session: preset && preset.session || (S.ui.evSession ? Number(S.ui.evSession) : latest ? latest.no : 1), error: "" };
      openDialog({ type: "new", kind, f, title: t(`taller.new.${kind}`) });
    }
    function newBody(dg) {
      const f = dg.f, kind = dg.kind, lang = S.ui.textLang;
      const set = (k, v) => { f[k] = v; f.error = ""; render(); };
      const inp = (k, label, props) => h("div", { className: "cc-tl-field", key: k }, h("label", { className: "cc-tl-label", htmlFor: `tl-new-${k}` }, label),
        h("input", { id: `tl-new-${k}`, className: "cc-input", value: f[k], onChange: e => set(k, e.target.value), autoComplete: "off", ...(props || {}) }));
      const sel = (k, label, options) => h("div", { className: "cc-tl-field", key: k }, h("label", { className: "cc-tl-label", htmlFor: `tl-new-${k}` }, label),
        h("span", { className: "cc-selwrap" }, h("select", { id: `tl-new-${k}`, className: "cc-select", value: String(f[k]), onChange: e => set(k, e.target.value) }, options.map(option))));
      const nameLabel = t(kind === "session" || kind === "event" || kind === "quest" ? "taller.f.title" : "taller.f.name") + ` (${langName(lang)})`;
      const first = h("input", { id: "tl-new-title", className: "cc-input", value: f.title, onChange: e => set("title", e.target.value), autoComplete: "off", lang: lang === "es" ? "es-AR" : "en",
        ref: el => { if (el && !el.dataset.focused) { el.dataset.focused = "1"; requestAnimationFrame(() => el.focus()); } } });
      const fields = [];
      if (kind === "session") fields.push(inp("no", t("taller.f.no"), { type: "number", min: 1, step: 1, inputMode: "numeric" }));
      if (kind === "event") fields.push(sel("session", t("taller.f.session"), sessionOptions()));
      fields.push(h("div", { className: "cc-tl-field", key: "title" }, h("label", { className: "cc-tl-label", htmlFor: "tl-new-title" }, nameLabel), first));
      if (kind === "session") fields.push(inp("date", t("taller.f.playedOn"), { type: "date" }));
      if (kind === "event") fields.push(sel("type", t("taller.f.type"), [{ value: "", label: t("taller.chooseLater") }, ...Object.keys(M.EVENT_TYPES).filter(k => k !== "other").map(k => ({ value: k, label: t(`eventType.${k}`) }))]));
      if (kind === "quest") fields.push(sel("status", t("taller.f.status"), Object.keys(M.QUEST_STATUS).map(k => ({ value: k, label: t(`questStatus.${k}`) }))));
      if (kind === "place") {
        fields.push(sel("kind", t("taller.f.kind"), [{ value: "", label: t("taller.chooseLater") }, ...Object.keys(M.PLACE_KINDS).map(k => ({ value: k, label: t(`placeKind.${k}`) }))]));
        fields.push(sel("parentId", t("taller.f.parentId"), [{ value: "", label: t("taller.topLevel") }, ...placeOptions(null)]));
      }
      if (kind === "npc") fields.push(sel("category", t("taller.f.category"), NPC_CATEGORIES.map(k => ({ value: k, label: t(`personCategoryOne.${k}`) }))));
      return h("form", { onSubmit: e => { e.preventDefault(); createRecord(dg); }, noValidate: true },
        h("p", { className: "cc-tl-hint", style: { marginTop: 0 } }, t(`taller.new.${kind}Hint`)),
        ...fields,
        f.error ? h("p", { className: "cc-tl-err", role: "alert" }, ico("warn"), h("span", null, f.error)) : null,
        h("div", { className: "cc-tl-actions end" },
          h("button", { type: "button", className: "cc-btn ghost", onClick: closeDialog }, t("common.cancel")),
          h("button", { type: "submit", className: "cc-btn" }, ico("plus"), t("taller.create"))));
    }
    function createRecord(dg) {
      const f = dg.f, kind = dg.kind, lang = S.ui.textLang, title = f.title.trim();
      const txt = (key, value) => ({ en: lang === "en" && value ? { [key]: value } : {}, es: lang === "es" && value ? { [key]: value } : null });
      if (kind !== "event" && kind !== "session" && !title) { f.error = t("taller.v.required", { field: t(kind === "quest" ? "taller.f.title" : "taller.f.name") }); return render(); }
      let id, pair;
      if (kind === "session") {
        const no = Number(f.no);
        if (!Number.isInteger(no) || no < 1) { f.error = t("taller.v.sessionNumber"); return render(); }
        if (E.sessionNumbers(pub(), S.draft).includes(no) || E.publishedPair(pub(), "session", no).en) { f.error = t("taller.v.sessionTaken", { n: no }); return render(); }
        if (f.date && !E.validDate(f.date)) { f.error = t("taller.v.date", { field: t("taller.f.playedOn") }); return render(); }
        const tx = txt("title", title);
        id = String(no); pair = { en: { ...tx.en, playedOn: f.date || undefined }, es: tx.es };
      } else if (kind === "event") {
        const no = Number(f.session), m = model(), s = m.sessionByNo.get(no);
        const days = s ? s.eventIds.map(x => m.eventById.get(x).campaignDay).filter(isNum) : [];
        id = E.nextEventId(pub(), S.draft, no);
        const tx = txt("title", title);
        pair = { en: { id, session: no, campaignDay: days.length ? days[days.length - 1] : undefined, type: f.type || undefined, ...tx.en }, es: tx.es };
      } else {
        id = E.newRecordId(pub(), S.draft, kind, title);
        const key = kind === "quest" ? "title" : "name", tx = txt(key, title);
        if (kind === "quest") pair = { en: { id, ...tx.en, status: f.status || "active" }, es: tx.es };
        if (kind === "place") pair = { en: { id, ...tx.en, kind: f.kind || undefined, parentId: f.parentId || undefined }, es: tx.es };
        if (kind === "npc") pair = { en: { id, ...tx.en, category: f.category || "person" }, es: tx.es };
      }
      closeDialog();
      put(kind, id, pair);
      S.ui.focusNext = kind === "session" || kind === "event" ? (title ? null : `tl-${kind}-${id}-title-${lang}`) : null;
      S.ui.focusHead = !S.ui.focusNext;
      app.navigate(formHref(kind, id));
      flash(t("taller.created"), "ok");
    }

    // ── Deleting, reverting ─────────────────────────────────────────────────
    function askRevert(kind, id) {
      const st = status(kind, id);
      confirm({ title: t(st === "new" ? "taller.discardNewQ" : "taller.revertQ"), body: [t(st === "new" ? "taller.discardNewD" : "taller.revertD", { name: nameOf(kind, id) })],
        confirmLabel: t(st === "new" ? "taller.discardNew" : "taller.revert"), danger: true,
        onConfirm: () => { commit(E.revertRecord(S.draft, kind, id)); if (st === "new") app.navigate(tabHref(TAB_OF[kind])); flash(t("taller.reverted"), "ok"); } });
    }
    function askDelete(kind, id) {
      const refs = E.referencesTo(applied().raw, kind, id), name = nameOf(kind, id);
      const listed = refs.map(r => `${kindName(r.kind === "route" ? "character" : r.kind)} «${nameOf(r.kind, r.id)}»`);
      const unlink = kind === "event" && refs.every(r => r.kind === "event" || r.kind === "session");
      if (refs.length && !unlink) return confirm({ title: t("taller.cantDeleteQ"), body: [t("taller.cantDeleteD", { name }), listed], cancelLabel: t("taller.understood") });
      confirm({ title: t("taller.deleteQ", { what: kindLow(kind) }), body: [t(refs.length ? "taller.deleteRefsD" : "taller.deleteD", { name }), ...(refs.length ? [listed] : [])],
        confirmLabel: t(refs.length ? "taller.deleteAndUnlink" : "taller.delete"), danger: true,
        onConfirm: () => {
          let d = S.draft;
          refs.forEach(r => {
            const k = r.kind === "session" ? "session" : "event", p = E.currentPair(d, pub(), k, r.id);
            if (!p) return;
            const next = k === "event" ? E.withField(p, ["relatedEventIds"], arr(p.en.relatedEventIds).filter(x => x !== id))
              : E.withField(p, ["recap", "highlights"], arr(p.en.recap && p.en.recap.highlights).filter(x => x !== id));
            d = E.putRecord(d, pub(), k, r.id, next);
          });
          d = E.deleteRecord(d, pub(), kind, id);
          commit(d);
          app.navigate(tabHref(TAB_OF[kind]));
          flash(t("taller.deleted", { name }), "ok");
        } });
    }

    // ── Page ────────────────────────────────────────────────────────────────
    function renderPage() {
      const r = app.state.route;
      if (!S.loaded) return h("div", { className: "cc-page cc-tl" }, h("p", { className: "cc-loading", role: "status" }, t("taller.opening")));
      const tab = r.kind === "tab" ? (TABS.some(x => x.id === r.id) ? r.id : "home") : r.kind ? TAB_OF[r.kind] : "home";
      const body = r.kind && r.kind !== "tab" ? recordForm(r.kind, r.id) : tabBody(tab);
      return h("div", { className: "cc-page cc-tl" },
        tab === "home" && !(r.kind && r.kind !== "tab") ? h("div", { className: "cc-sechead", key: "head" },
          h("p", { className: "cc-kicker" }, t("app.docTitle")), h("h1", { className: "cc-sec-h", tabIndex: -1, ref: headRef }, t("taller.title")),
          h("p", { className: "cc-sec-sub" }, t("taller.sub")), h("div", { className: "cc-orn", "aria-hidden": "true" }, h("i"), h("i"), h("i")))
          : h("h1", { className: "cc-kicker", key: "kick", style: { textAlign: "center", margin: "4px 0 12px" } }, h("a", { href: "#/taller" }, t("taller.title"))),
        statusBar(),
        tabsNav(tab),
        notices(),
        body,
        renderDialog());
    }
    const headRef = el => { if (el && S.ui.focusHead) { S.ui.focusHead = false; requestAnimationFrame(() => el.focus({ preventScroll: true })); } };
    function statusBar() {
      const sum = summary(), v = checks(), cf = conflicts(), pend = Object.keys(S.mx.pending).length;
      const saveMsg = { saving: ["quill", t("taller.save.saving")], saved: ["check", S.savedAt ? t("taller.save.savedAt", { time: S.savedAt.toLocaleTimeString(app.t.meta.htmlLang, { hour: "2-digit", minute: "2-digit" }) }) : t("taller.save.saved")],
        error: ["warn", t("taller.save.error", { error: S.saveError })], conflict: ["warn", t("taller.save.conflict")], memory: ["warn", t("taller.save.memory")], loading: ["quill", t("taller.opening")] }[S.save] || ["check", ""];
      return h("div", { className: "cc-tl-bar", key: "bar" },
        h("span", { className: "cc-tl-save" }, ico("quill"), sum.total ? t("taller.draftCount", { count: sum.total }) : t("taller.draftEmpty")),
        h("span", { className: cls("cc-tl-save", `is-${S.save}`) }, ico(saveMsg[0]), saveMsg[1]),
        sum.total && !cf.length ? h("span", { className: "cc-tl-save" }, v.errors.length ? t("taller.errorsCount", { count: v.errors.length }) : t("taller.readyToExport")) : null,
        cf.length ? h("span", { className: "cc-tl-save is-error" }, ico("warn"), t("taller.conflictsCount", { count: cf.length })) : null,
        pend ? h("span", { className: "cc-tl-save is-memory" }, ico("crosshair"), t("taller.pendingMoves", { count: pend })) : null,
        h("span", { className: "cc-flex" }),
        h("a", { className: "cc-linkbtn", href: tabHref("draft") }, t("taller.reviewExport")));
    }
    // The current section stays in view in the phones' scrolling strip of sections (scrolled once per section, the page never moves).
    const activeTabRef = el => {
      const nav = el && el.parentElement, href = el && el.getAttribute("href");
      if (!nav || S.ui.scrolledTab === href) return;
      S.ui.scrolledTab = href;
      if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, el.offsetLeft - nav.clientWidth / 2 + el.offsetWidth / 2);
    };
    function tabsNav(cur) {
      const sum = summary();
      const count = { sessions: sum.byKind.session, events: sum.byKind.event, quests: sum.byKind.quest, characters: { added: sum.byKind.npc.added + sum.byKind.character.added, modified: sum.byKind.npc.modified + sum.byKind.character.modified, deleted: sum.byKind.npc.deleted + sum.byKind.character.deleted }, places: sum.byKind.place };
      return h("nav", { className: "cc-tl-tabs", "aria-label": t("taller.tabsAria"), key: "tabs" }, TABS.map(tb => {
        const c = count[tb.id], n = c ? c.added + c.modified + c.deleted : tb.id === "draft" ? sum.total : 0;
        return h("a", { key: tb.id, className: "cc-tl-tab", href: tabHref(tb.id), "aria-current": tb.id === cur ? "page" : undefined, ref: tb.id === cur ? activeTabRef : undefined }, ico(tb.icon), t(`taller.tab.${tb.id}`),
          n ? h("span", { className: "cc-count", "aria-label": t("taller.tabChanges", { count: n }) }, String(n)) : null);
      }));
    }
    function notices() {
      const out = [];
      if (S.ui.flash) out.push(h("div", { key: "flash", className: cls("cc-tl-note", `is-${S.ui.flash.level}`) }, ico(S.ui.flash.level === "ok" ? "check" : "warn"), h("p", null, S.ui.flash.text)));
      if (S.storeKind === "memory") out.push(h("div", { key: "mem", className: "cc-tl-note is-warn" }, ico("warn"), h("div", null, h("p", null, h("strong", null, t("taller.memoryT"))), h("p", null, t("taller.memoryD")),
        h("div", { className: "cc-tl-actions" }, h("button", { type: "button", className: "cc-btn ghost", onClick: downloadDraft }, ico("download"), t("taller.downloadDraft"))))));
      if (S.otherTab) out.push(h("div", { key: "tab", className: "cc-tl-note is-error" }, ico("warn"), h("div", null, h("p", null, h("strong", null, t("taller.otherTabT"))), h("p", null, t("taller.otherTabD")),
        h("div", { className: "cc-tl-actions" },
          h("button", { type: "button", className: "cc-btn ghost", onClick: reloadStored }, ico("undo"), t("taller.loadStored")),
          h("button", { type: "button", className: "cc-btn ghost is-danger", onClick: keepThisTab }, t("taller.keepThis"))))));
      if (!content0()) out.push(h("div", { key: "content", className: "cc-tl-note is-error" }, ico("warn"), h("p", null, t("taller.noContent"))));
      const cf = conflicts();
      if (cf.length && !(app.state.route.kind === "tab" && app.state.route.id === "draft")) out.push(h("div", { key: "cf", className: "cc-tl-note is-warn" }, ico("warn"), h("p", null, t("taller.conflictsNote", { count: cf.length }), " ", h("a", { className: "cc-a", href: tabHref("draft") }, t("taller.reviewConflicts")))));
      return out.length ? h("div", { key: "notices" }, out) : null;
    }
    async function reloadStored() {
      try {
        const d = await S.store.load();
        const parsed = d ? E.parseDraft(JSON.stringify(d)) : { draft: E.emptyDraft(pub()) };
        if (parsed.error) return flash(t("taller.unreadable"), "warn");
        S.savedRev = d ? { id: d.id, rev: d.rev } : "none"; S.otherTab = false; S.pendingSave = false; S.save = S.storeKind === "memory" ? "memory" : "saved";
        S.draft = parsed.draft; S.settled = parsed.draft; render(); flash(t("taller.storedLoaded"), "ok");
      } catch (e) { flash(t("taller.save.error", { error: String((e && e.message) || e) }), "warn"); }
    }
    async function keepThisTab() {
      try { const stored = await S.store.load(); if (stored) await S.store.backup(stored, "other-tab"); } catch (e) { /* the backup is best effort */ }
      S.savedRev = null; S.otherTab = false; S.save = "saving"; S.pendingSave = true; await flush(); S.savedRev = { id: S.draft.id, rev: S.draft.rev }; render();
    }

    // ── Sections ────────────────────────────────────────────────────────────
    function tabBody(tab) {
      if (tab === "sessions") return sessionsTab();
      if (tab === "events") return eventsTab();
      if (tab === "quests") return questsTab();
      if (tab === "characters") return charactersTab();
      if (tab === "places") return placesTab();
      if (tab === "map") return mapTab();
      if (tab === "draft") return draftTab();
      return homeTab();
    }
    const qa = (href, onClick, icon, title, sub) => h(href ? "a" : "button", { key: title, className: "cc-qa-i", href, onClick, type: href ? undefined : "button" }, ico(icon),
      h("span", { className: "cc-qa-b" }, h("span", { className: "cc-qa-t" }, title), h("span", { className: "cc-qa-s" }, sub)));
    function homeTab() {
      const sum = summary(), recent = [...sum.added, ...sum.modified, ...sum.deleted].sort((a, b) => str(b.at).localeCompare(str(a.at))).slice(0, 6);
      const step = !sum.total ? 0 : conflicts().length || !checks().ok ? 3 : S.ui.lastExport ? 5 : 4;
      return h("div", { key: "home" },
        h("p", { className: "cc-tl-sub" }, t("taller.intro")),
        h("div", { className: "cc-tl-note is-warn" }, ico("warn"), h("div", null, h("p", null, h("strong", null, t("taller.localT"))), h("p", null, t("taller.localD")),
          S.persisted === true ? h("p", null, t("taller.persisted")) : null,
          h("div", { className: "cc-tl-actions" }, h("button", { type: "button", className: "cc-btn ghost", onClick: downloadDraft }, ico("download"), t("taller.downloadDraft"))))),
        h("h2", { className: "cc-h2" }, t("taller.quickH")),
        h("div", { className: "cc-tl-quick" },
          qa(null, () => startNew("session"), "sessions", t("taller.new.session"), t("taller.qa.session")),
          qa(null, () => startNew("event"), "chronicle", t("taller.new.event"), t("taller.qa.event")),
          qa(null, () => startNew("quest"), "quests", t("taller.new.quest"), t("taller.qa.quest")),
          qa("#/map/edit", null, "crosshair", t("taller.qa.mapT"), t("taller.qa.map")),
          qa(tabHref("draft"), null, "download", t("taller.reviewExport"), t("taller.qa.export"))),
        recent.length ? h(React.Fragment, null, h("h2", { className: "cc-h2" }, t("taller.recentH")),
          h("div", { className: "cc-tl-rows" }, recent.map(it => changeRow(it)))) : null,
        h("h2", { className: "cc-h2" }, t("taller.flowH")),
        h("ol", { className: "cc-tl-flow" }, [1, 2, 3, 4, 5, 6, 7, 8].map(n => h("li", { key: n, className: n - 1 === step ? "is-here" : undefined }, t(`taller.flow.s${n}`)))),
        h("p", { className: "cc-tl-hint", style: { marginTop: 12 } }, t("taller.flowNote")),
        h("h2", { className: "cc-h2" }, t("taller.aboutH")),
        h("p", { className: "cc-tl-hint" }, t("taller.noPassword")));
    }
    const statusBadge = st => (BADGE[st] ? h("span", { className: `cc-badge ${BADGE[st]}` }, t(`taller.status.${st}`)) : null);
    function changeRow(it) {
      const st = status(it.kind, it.id);
      return h("div", { key: `${it.kind}:${it.id}`, className: cls("cc-tl-row", st === "deleted" && "is-deleted") },
        h("div", { className: "cc-tl-row-b" }, st === "deleted" ? h("span", { className: "cc-tl-row-t" }, nameOf(it.kind, it.id)) : h("a", { className: "cc-tl-row-t", href: formHref(it.kind, it.id) }, nameOf(it.kind, it.id)),
          h("span", { className: "cc-tl-row-m" }, kindName(it.kind))),
        statusBadge(st),
        h("button", { type: "button", className: "cc-linkbtn", onClick: () => askRevert(it.kind, it.id) }, t(st === "new" ? "taller.discardNew" : "taller.revert")));
    }
    // A section's search box (component state only, like the public sections' searches).
    function searchBox(key, label) {
      return h("div", { className: "cc-search" }, h("span", { className: "cc-search-ico" }, ico("search")),
        h("input", { className: "cc-input", type: "search", value: S.ui.q[key] || "", placeholder: label, "aria-label": label, autoComplete: "off", enterKeyHint: "search",
          onChange: e => { S.ui.q[key] = e.target.value; render(); } }));
    }
    const words = key => M.fold(S.ui.q[key] || "").split(" ").filter(Boolean);
    const matches = (key, text) => { const w = words(key); return !w.length || w.every(x => M.fold(text).includes(x)); };
    function deletedRows(kinds) {
      const rows = [];
      kinds.forEach(k => Object.entries(S.draft.changes[k] || {}).forEach(([id, ch]) => { if (ch.op === "delete") rows.push(changeRow({ kind: k, id })); }));
      return rows.length ? h(React.Fragment, null, h("h2", { className: "cc-h2" }, t("taller.deletedH")), h("div", { className: "cc-tl-rows" }, rows)) : null;
    }
    function sessionsTab() {
      const m = model(), list = m.sessions.slice().sort((a, b) => b.no - a.no).filter(s => matches("sessions", `${s.no} ${s.title} ${s.titleEn}`));
      return h("div", { key: "sessions" },
        h("div", { className: "cc-tl-tools" }, searchBox("sessions", t("taller.searchSessions")), h("button", { type: "button", className: "cc-btn", onClick: () => startNew("session") }, ico("plus"), t("taller.new.session"))),
        h("p", { className: "cc-tl-count" }, t("taller.countSessions", { count: list.length })),
        list.length ? h("div", { className: "cc-tl-rows" }, list.map(s => h("a", { key: s.no, className: "cc-tl-row", href: formHref("session", s.no) },
          h("span", { className: "cc-tl-row-n" }, String(s.no)),
          h("span", { className: "cc-tl-row-b" }, h("span", { className: "cc-tl-row-t" }, s.title || t("common.session", { n: s.no })),
            h("span", { className: "cc-tl-row-m" }, [s.playedLabel ? t("common.played", { date: s.playedLabel }) : t("session.dateNotRecorded"), t("common.events", { count: s.eventIds.length })].join(" · "))),
          s.isStub ? h("span", { className: "cc-badge tone-pending" }, t("taller.noLog")) : null,
          statusBadge(status("session", s.no))))) : h("p", { className: "cc-tl-empty" }, t("taller.noneFound")),
        deletedRows(["session"]));
    }
    function eventRow(ev, extra) {
      const st = status("event", ev.id), pend = S.mx.pending[`event:${ev.id}`];
      return h("a", { key: ev.id, className: "cc-tl-row", href: formHref("event", ev.id) },
        h("span", { className: `cc-evico ${app.evFamily(ev)}` }, app.evIcon(ev)),
        h("span", { className: "cc-tl-row-b" }, h("span", { className: "cc-tl-row-t" }, ev.title),
          h("span", { className: "cc-tl-row-m" }, [t("common.session", { n: ev.session }), ev.campaignDay != null ? app.dayText(ev) : "", ev.locationId ? (model().placeById.get(ev.locationId) || {}).name : ""].filter(Boolean).join(" · "))),
        h("span", { className: cls("cc-mx-dot", pend ? "pending" : ev.hasCoords && "has") }, ico(ev.hasCoords || pend ? "pin" : "warn"), t(pend ? "taller.posPending" : ev.hasCoords ? "taller.placed" : "taller.unplaced")),
        statusBadge(st), extra || null);
    }
    function eventsTab() {
      const m = model(), f = { text: S.ui.q.events || "", session: S.ui.evSession || "" };
      const list = M.filterEvents(m, f).filter(e => S.ui.evWhere === "all" || (S.ui.evWhere === "without" ? !e.hasCoords : e.hasCoords)).slice().reverse();
      return h("div", { key: "events" },
        h("div", { className: "cc-tl-tools" }, searchBox("events", t("taller.searchEvents")),
          h("span", { className: "cc-selwrap" }, h("select", { className: "cc-select", value: S.ui.evSession, "aria-label": t("taller.f.session"), onChange: e => { S.ui.evSession = e.target.value; render(); } },
            [{ value: "", label: t("mx.allSessions") }, ...sessionOptions()].map(option))),
          h("span", { className: "cc-selwrap" }, h("select", { className: "cc-select", value: S.ui.evWhere, "aria-label": t("taller.f.position"), onChange: e => { S.ui.evWhere = e.target.value; render(); } },
            [{ value: "all", label: t("mx.filterAll") }, { value: "without", label: t("mx.filterWithout") }, { value: "with", label: t("mx.filterWith") }].map(option))),
          h("button", { type: "button", className: "cc-btn", onClick: () => startNew("event") }, ico("plus"), t("taller.new.event"))),
        h("p", { className: "cc-tl-count" }, t("taller.countEvents", { count: list.length, total: m.events.length })),
        list.length ? h("div", { className: "cc-tl-rows" }, list.map(ev => eventRow(ev))) : h("p", { className: "cc-tl-empty" }, t("taller.noneFound")),
        deletedRows(["event"]));
    }
    function questsTab() {
      const m = model(), list = m.quests.filter(q => matches("quests", `${q.title} ${q.titleEn} ${q.statusLabel}`)).sort((a, b) => a.statusOrder - b.statusOrder || (b.lastSession || 0) - (a.lastSession || 0));
      return h("div", { key: "quests" },
        h("div", { className: "cc-tl-tools" }, searchBox("quests", t("taller.searchQuests")), h("button", { type: "button", className: "cc-btn", onClick: () => startNew("quest") }, ico("plus"), t("taller.new.quest"))),
        h("p", { className: "cc-tl-count" }, t("taller.countQuests", { count: list.length })),
        list.length ? h("div", { className: "cc-tl-rows" }, list.map(q => h("a", { key: q.id, className: "cc-tl-row", href: formHref("quest", q.id) },
          h("span", { className: "cc-tl-row-b" }, h("span", { className: "cc-tl-row-t" }, q.title),
            h("span", { className: "cc-tl-row-m" }, q.sessionNos.length ? q.sessionNos.map(n => t("common.sessionShort", { n })).join(" · ") : t("quest.notLinked"))),
          h("span", { className: `cc-badge tone-${q.statusTone}` }, app.statusIcon(q.statusTone), q.statusLabel),
          statusBadge(status("quest", q.id))))) : h("p", { className: "cc-tl-empty" }, t("taller.noneFound")),
        deletedRows(["quest"]));
    }
    function charactersTab() {
      const m = model(), list = m.people.filter(p => matches("characters", `${p.name} ${p.nameEn} ${p.aliases.join(" ")} ${p.categoryLabel} ${p.role}`));
      const groups = Object.keys(M.PERSON_CATEGORIES).map(cat => ({ cat, people: list.filter(p => p.category === cat) })).filter(g => g.people.length);
      return h("div", { key: "characters" },
        h("div", { className: "cc-tl-tools" }, searchBox("characters", t("taller.searchCharacters")), h("button", { type: "button", className: "cc-btn", onClick: () => startNew("npc") }, ico("plus"), t("taller.new.npc"))),
        h("p", { className: "cc-tl-count" }, t("taller.countPeople", { count: list.length })),
        groups.length ? groups.map(g => h(React.Fragment, { key: g.cat }, h("h2", { className: "cc-h2" }, t(`personCategory.${g.cat}`)),
          h("div", { className: "cc-tl-rows" }, g.people.map(p => h("a", { key: p.id, className: "cc-tl-row", href: formHref(p.kind === "pc" ? "character" : "npc", p.id) },
            h("span", { className: app.sealCls(p), style: p.sealImg ? { backgroundImage: `url("${p.sealImg}")` } : undefined }, app.mono(p)),
            h("span", { className: "cc-tl-row-b" }, h("span", { className: "cc-tl-row-t" }, p.name), h("span", { className: "cc-tl-row-m" }, p.role || p.categoryLabel)),
            statusBadge(status(p.kind === "pc" ? "character" : "npc", p.id))))))) : h("p", { className: "cc-tl-empty" }, t("taller.noneFound")),
        deletedRows(["npc", "character"]));
    }
    function placesTab() {
      const m = model(), idx = M.placeIndex(m, { cmp: (a, b) => a.name.localeCompare(b.name, app.state.lang) });
      const list = M.placeOrder(m, idx).map(id => m.placeById.get(id)).filter(p => matches("places", `${p.name} ${p.nameEn} ${p.aliases.join(" ")} ${p.kindLabel}`));
      const searching = words("places").length > 0;
      return h("div", { key: "places" },
        h("div", { className: "cc-tl-tools" }, searchBox("places", t("taller.searchPlaces")), h("button", { type: "button", className: "cc-btn", onClick: () => startNew("place") }, ico("plus"), t("taller.new.place"))),
        h("p", { className: "cc-tl-count" }, t("taller.countPlaces", { count: list.length })),
        list.length ? h("div", { className: "cc-tl-rows" }, list.map(p => h("a", { key: p.id, className: cls("cc-tl-row", !searching && `d${Math.min(4, p.depth)}`), href: formHref("place", p.id) },
          h("span", { className: cls("cc-chip-ico", p.isPlanar && "is-planar") }, app.placeIcon(p)),
          h("span", { className: "cc-tl-row-b" }, h("span", { className: "cc-tl-row-t" }, p.name), h("span", { className: "cc-tl-row-m" }, [p.kindLabel, p.ref ? t(p.ref.precision === "exact" ? "taller.ownPosExact" : "taller.ownPosApprox") : ""].filter(Boolean).join(" · "))),
          statusBadge(status("place", p.id))))) : h("p", { className: "cc-tl-empty" }, t("taller.noneFound")),
        deletedRows(["place"]));
    }
    function mapTab() {
      const m = model(), without = m.events.filter(e => !e.hasCoords && !(e.locationId && planarPlace(e.locationId)));
      const placesNoRef = m.places.filter(p => !p.ref && !p.isPlanar), withRef = m.places.filter(p => p.ref);
      const pending = Object.keys(S.mx.pending);
      const goList = (kind, id) => () => { S.mx.returnTo = { key: `${kind}:${id}`, hash: tabHref("map") }; app.navigate(kind === "place" ? `#/map/editplace/${enc(id)}` : `#/map/edit/${enc(id)}`); };
      return h("div", { key: "map" },
        h("p", { className: "cc-tl-sub" }, t("taller.mapIntro")),
        h("div", { className: "cc-tl-actions" }, h("a", { className: "cc-btn", href: "#/map/edit" }, ico("crosshair"), t("taller.qa.mapT"))),
        pending.length ? h("div", { className: "cc-tl-note is-warn" }, ico("warn"), h("p", null, t("taller.pendingMovesD", { count: pending.length }))) : null,
        h("h2", { className: "cc-h2" }, t("taller.unplacedH"), h("span", { className: "n" }, String(without.length))),
        without.length ? h("div", { className: "cc-tl-rows" }, without.slice().reverse().map(ev => eventRow(ev, h("button", { type: "button", className: "cc-btn ghost", onClick: e => { e.preventDefault(); goList("event", ev.id)(); } }, ico("crosshair"), t("taller.placeOnMap")))))
          : h("p", { className: "cc-tl-empty" }, t("taller.allPlaced")),
        h("h2", { className: "cc-h2" }, t("taller.placesPosH")),
        h("p", { className: "cc-tl-hint" }, t("taller.placesPosD", { with: withRef.length, without: placesNoRef.length })),
        h("div", { className: "cc-tl-rows" }, placesNoRef.slice(0, 40).map(p => h("div", { key: p.id, className: "cc-tl-row" },
          h("span", { className: "cc-chip-ico" }, app.placeIcon(p)),
          h("span", { className: "cc-tl-row-b" }, h("a", { className: "cc-tl-row-t", href: formHref("place", p.id) }, p.name), h("span", { className: "cc-tl-row-m" }, p.kindLabel)),
          h("button", { type: "button", className: "cc-btn ghost", onClick: goList("place", p.id) }, ico("crosshair"), t("taller.placeOnMap"))))),
        h("p", { className: "cc-tl-hint", style: { marginTop: 14 } }, t("taller.routesNote")));
    }

    // ── Record forms ────────────────────────────────────────────────────────
    function langBar() {
      return h("div", { className: "cc-tl-langbar", key: "lang" }, h("span", null, t("taller.textLang")),
        h("div", { className: "cc-seg", role: "group", "aria-label": t("taller.textLang") }, ["es", "en"].map(l => h("button", { key: l, type: "button", className: S.ui.textLang === l ? "is-on" : "", "aria-pressed": S.ui.textLang === l ? "true" : "false",
          lang: l === "es" ? "es-AR" : "en", onClick: () => { S.ui.textLang = l; render(); } }, langName(l)))),
        h("span", { className: "cc-tl-hint", style: { flex: "1 1 260px" } }, t("taller.textLangHint")));
    }
    function recordForm(kind, id) {
      const k = kind === "character" ? personKind(id) : kind;
      const pair = rec(k, id), st = status(k, id), back = TAB_OF[k];
      const crumb = h("a", { className: "cc-tl-crumb", href: tabHref(back), key: "crumb" }, ico("back"), t(`taller.tab.${back}`));
      if (!pair) return h("div", { key: `${k}:${id}` }, crumb,
        h("div", { className: "cc-tl-note is-warn" }, ico("warn"), h("div", null, h("p", null, t(st === "deleted" ? "taller.isDeleted" : "taller.notFound", { name: nameOf(k, id) })),
          st === "deleted" ? h("div", { className: "cc-tl-actions" }, h("button", { type: "button", className: "cc-btn ghost", onClick: () => commit(E.revertRecord(S.draft, k, id)) }, ico("undo"), t("taller.undoDelete"))) : null)));
      const ctx = { kind: k, id: String(id), pair };
      const title = (k === "session" ? E.textAt(pair, ["title"], S.ui.textLang) || E.textAt(pair, ["title"], S.ui.textLang === "en" ? "es" : "en") || t("common.session", { n: id })
        : E.textAt(pair, [k === "quest" || k === "event" ? "title" : "name"], S.ui.textLang) || E.textAt(pair, [k === "quest" || k === "event" ? "title" : "name"], S.ui.textLang === "en" ? "es" : "en")) || t("taller.untitled");
      const wide = app.state.isWide;
      const errCount = issuesOf(k, id).filter(i => i.level === "error").length;
      const body = k === "session" ? sessionFields(ctx) : k === "event" ? eventFields(ctx) : k === "quest" ? questFields(ctx) : k === "place" ? placeFields(ctx) : personFields(ctx);
      return h("div", { className: "cc-tl-form", key: `${k}:${id}` },
        crumb,
        h("div", { className: "cc-tl-h" }, h("h2", { tabIndex: -1, ref: headRef }, (k === "session" ? `${t("common.session", { n: id })} · ` : "") + (k === "session" && !E.textAt(pair, ["title"], "en") && !E.textAt(pair, ["title"], "es") ? t("taller.untitled") : title)),
          statusBadge(st), errCount ? h("span", { className: "cc-badge tone-failed" }, ico("warn"), t("taller.errorsCount", { count: errCount })) : null),
        h("p", { className: "cc-tl-sub" }, t(`taller.formSub.${routeKind(k)}`)),
        h("div", { className: "cc-tl-actions" },
          wide ? h("button", { type: "button", className: "cc-btn ghost", "aria-pressed": S.ui.previewHidden ? "false" : "true", onClick: () => { S.ui.previewHidden = !S.ui.previewHidden; render(); app.reflow(); } }, ico("chronicle"), t(S.ui.previewHidden ? "taller.showPreview" : "taller.hidePreview"))
            : h("button", { type: "button", className: "cc-btn ghost", onClick: () => { S.ui.preview = true; render(); } }, ico("chronicle"), t("taller.preview.open")),
          st === "new" || st === "modified" ? h("button", { type: "button", className: "cc-btn ghost", onClick: () => askRevert(k, id) }, ico("undo"), t(st === "new" ? "taller.discardNew" : "taller.revert")) : null),
        langBar(),
        ...body,
        dangerZone(ctx, st));
    }
    function dangerZone(ctx, st) {
      const k = ctx.kind;
      return h("details", { className: "cc-disc", key: "adv" },
        h("summary", null, ico("edit"), t("taller.advanced")),
        h("div", { className: "cc-disc-b" },
          h("p", { className: "cc-tl-hint" }, t("taller.idNote"), " ", h("span", { className: "cc-tl-mono" }, k === "session" ? `sessions.json › "${ctx.id}"` : ctx.id)),
          k === "event" ? numberField(ctx, ["order"], { label: t("taller.f.order"), integer: true, min: 1, hint: t("taller.orderHint") }) : null,
          k === "character" ? h("p", { className: "cc-tl-hint" }, t("taller.pcNoDelete")) : h("div", { className: "cc-tl-actions" },
            h("button", { type: "button", className: "cc-btn ghost is-danger", onClick: () => askDelete(k, ctx.id) }, ico("trash"), t("taller.deleteWhat", { what: kindLow(k) })))));
    }
    const secH = (key, text, extra) => h("h2", { className: "cc-h2", key }, text, extra || null);

    function eventFields(ctx) {
      const en = ctx.pair.en || {}, m = model(), st = status("event", ctx.id);
      const onSession = e => {
        const no = Number(e.target.value);
        let d = E.putRecord(S.draft, pub(), "event", ctx.id, E.withField(rec("event", ctx.id), ["session"], no));
        if (st === "new" && /^s\d+_\d+$/.test(ctx.id) && !ctx.id.startsWith(`s${no}_`)) {
          const nid = E.nextEventId(pub(), d, no);
          d = E.renameNew(d, "event", ctx.id, nid);
          commit(d); app.navigate(formHref("event", nid), { replace: true });
        } else commit(d);
      };
      const suggestLabel = () => {
        const day = en.campaignDay, place = en.locationId;
        const pEn = place && model("en").placeById.get(place), pEs = place && model("es-AR").placeById.get(place);
        let p = rec("event", ctx.id);
        p = E.withText(p, ["igLabel"], "en", [day != null ? `Day ${day}` : "", pEn ? pEn.name : ""].filter(Boolean).join(" · "));
        p = E.withText(p, ["igLabel"], "es", [day != null ? `Día ${day}` : "", pEs ? pEs.name : ""].filter(Boolean).join(" · "));
        put("event", ctx.id, p);
      };
      const typeOpts = Object.keys(M.EVENT_TYPES).filter(k => k !== "other").map(k => ({ value: k, label: t(`eventType.${k}`) }));
      const evOpts = m.events.filter(e => e.id !== ctx.id).slice().reverse().map(e => ({ value: e.id, label: e.title, meta: `${t("common.session", { n: e.session })}${e.campaignDay != null ? " · " + app.dayText(e) : ""}` }));
      return [
        secH("s1", t("taller.sec.essential")),
        h("div", { className: "cc-tl-grid", key: "g1" },
          selectField(ctx, ["session"], { label: t("taller.f.session"), required: true, options: sessionOptions(), onChange: onSession, hint: st === "new" ? t("taller.sessionIdHint") : undefined }),
          selectField(ctx, ["type"], { label: t("taller.f.type"), empty: t("taller.chooseLater"), options: typeOpts }),
          numberField(ctx, ["campaignDay"], { label: t("taller.f.campaignDay"), integer: true, min: 0, hint: t("taller.dayHint") }),
          textField(ctx, ["igDate"], { label: t("taller.f.igDate"), plain: true, placeholder: t("taller.igDatePh"), hint: t("taller.igDateHint") })),
        textField(ctx, ["title"], { label: t("taller.f.title"), required: true, wide: true }),
        textField(ctx, ["summary"], { label: t("taller.f.summary"), required: true, area: true, wide: true, hint: t("taller.summaryHint") }),
        textField(ctx, ["igLabel"], { label: t("taller.f.igLabel"), wide: true, hint: t("taller.igLabelHint") }),
        h("div", { className: "cc-tl-actions", key: "lbl", style: { marginTop: -6 } }, h("button", { type: "button", className: "cc-btn ghost", onClick: suggestLabel }, ico("edit"), t("taller.suggestLabel"))),
        secH("s2", t("taller.sec.where")),
        selectField(ctx, ["locationId"], { label: t("taller.f.locationId"), empty: t("taller.noPlace"), options: placeOptions(null), wide: true, hint: t("taller.placeHint") }),
        positionBlock(ctx),
        secH("s3", t("taller.sec.who")),
        chipsField(ctx, ["characterIds"], { label: t("taller.f.characterIds"), options: pcChips() }),
        pickField(ctx, ["npcIds"], { label: t("taller.f.npcIds"), options: peopleOptions(p => p.kind === "npc"), hint: t("taller.npcHint") }),
        secH("s4", t("taller.sec.links")),
        pickField(ctx, ["questIds"], { label: t("taller.f.questIds"), options: questOptions() }),
        questSessionFix(ctx),
        pickField(ctx, ["relatedEventIds"], { label: t("taller.f.relatedEventIds"), options: evOpts, hint: t("taller.relatedHint") }),
        secH("s5", t("taller.sec.depth")),
        h("p", { className: "cc-tl-hint", key: "dh" }, t("taller.depthHint")),
        textField(ctx, ["description"], { label: t("taller.f.description"), area: true, wide: true }),
        listField(ctx, ["consequences"], { label: t("taller.f.consequences"), area: true, item: t("taller.f.consequence"), addLabel: t("taller.addConsequence") }),
        listField(ctx, ["unresolved"], { label: t("taller.f.unresolved"), area: true, item: t("taller.f.unresolvedOne"), addLabel: t("taller.addUnresolved") }),
      ];
    }
    // An event linking a quest whose sessions do not list the event's session: one tap adds it.
    function questSessionFix(ctx) {
      const w = issuesOf(ctx.kind, ctx.id).filter(i => i.code === "questSession");
      if (!w.length) return null;
      return h("div", { className: "cc-tl-note is-warn", key: "qfix" }, ico("warn"), h("div", null, ...w.map((i, n) => h("p", { key: n }, issueText(i), " ",
        h("button", { type: "button", className: "cc-linkbtn", onClick: () => { const q = rec("quest", i.params.ref); put("quest", i.params.ref, E.withField(q, ["sessions"], [...arr(q.en.sessions), i.params.n].sort((a, b) => a - b))); } }, t("taller.addSessionToQuest", { n: i.params.n }))))));
    }

    function sessionFields(ctx) {
      const en = ctx.pair.en || {}, m = model(), no = Number(ctx.id), st = status("session", no), s = m.sessionByNo.get(no);
      const evs = s ? s.eventIds.map(x => m.eventById.get(x)) : [];
      const moveEvent = (i, dir) => {
        const ids = evs.map(e => e.id), j = i + dir;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        let d = S.draft;
        ids.forEach((eid, n) => { const p = E.currentPair(d, pub(), "event", eid); if (p && p.en.order !== n + 1) d = E.putRecord(d, pub(), "event", eid, E.withField(p, ["order"], n + 1)); });
        commit(d);
      };
      const addEvent = () => {
        const id = E.nextEventId(pub(), S.draft, no), days = evs.map(e => e.campaignDay).filter(isNum);
        put("event", id, { en: { id, session: no, campaignDay: days.length ? days[days.length - 1] : undefined }, es: null });
        S.ui.focusNext = `tl-event-${id}-title-${S.ui.textLang}`;
        app.navigate(formHref("event", id));
      };
      const renumber = e => {
        const n = Number(e.target.value);
        if (!Number.isInteger(n) || n < 1 || n === no) return;
        if (E.sessionNumbers(pub(), S.draft).includes(n)) return flash(t("taller.v.sessionTaken", { n }), "warn");
        commit(E.renameSession(pub(), S.draft, no, n)); app.navigate(formHref("session", n), { replace: true });
      };
      const hl = arr(en.recap && en.recap.highlights);
      return [
        secH("s1", t("taller.sec.session")),
        h("div", { className: "cc-tl-grid", key: "g1" },
          st === "new" ? h("div", { className: "cc-tl-field", key: "no" }, h("label", { className: "cc-tl-label", htmlFor: "tl-session-no" }, t("taller.f.no")),
            h("input", { id: "tl-session-no", className: "cc-input", type: "number", min: 1, step: 1, inputMode: "numeric", defaultValue: no, onBlur: renumber, onKeyDown: e => { if (e.key === "Enter") renumber(e); } }),
            h("p", { className: "cc-tl-hint" }, t("taller.renumberHint"))) : null,
          dateField(ctx, ["playedOn"], { label: t("taller.f.playedOn"), required: true, hint: t("taller.playedHint") })),
        textField(ctx, ["title"], { label: t("taller.f.title"), required: true, wide: true }),
        secH("s2", t("taller.sec.span")),
        textField(ctx, ["startedHere"], { label: t("taller.f.startedHere"), area: true, short: true, wide: true }),
        textField(ctx, ["endedHere"], { label: t("taller.f.endedHere"), area: true, short: true, wide: true }),
        h("div", { className: "cc-tl-grid", key: "g2" },
          textField(ctx, ["ig", "start"], { label: t("taller.f.igStart"), placeholder: t("taller.igClockPh") }),
          textField(ctx, ["ig", "end"], { label: t("taller.f.igEnd") }),
          textField(ctx, ["ig", "rest"], { label: t("taller.f.igRest") })),
        secH("s3", t("taller.sec.sessionEvents"), h("span", { className: "n" }, String(evs.length))),
        evs.length ? h("div", { className: "cc-tl-rows", key: "evs" }, evs.map((ev, i) => h("div", { key: ev.id, className: "cc-tl-row" },
          h("span", { className: `cc-evico ${app.evFamily(ev)}` }, app.evIcon(ev)),
          h("span", { className: "cc-tl-row-b" }, h("a", { className: "cc-tl-row-t", href: formHref("event", ev.id) }, ev.title), h("span", { className: "cc-tl-row-m" }, [ev.typeLabel, ev.campaignDay != null ? app.dayText(ev) : ""].filter(Boolean).join(" · "))),
          statusBadge(status("event", ev.id)),
          h("div", { className: "cc-tl-item-x" },
            iconBtn(t("taller.moveUp", { what: ev.title }), "↑", () => moveEvent(i, -1), { disabled: i === 0 || evs[i - 1].campaignDay !== ev.campaignDay, title: i > 0 && evs[i - 1].campaignDay !== ev.campaignDay ? t("taller.otherDay") : t("taller.moveUp", { what: ev.title }) }),
            iconBtn(t("taller.moveDown", { what: ev.title }), "↓", () => moveEvent(i, 1), { disabled: i === evs.length - 1 || evs[i + 1].campaignDay !== ev.campaignDay }))))) : h("p", { className: "cc-tl-empty", key: "noev" }, t("session.noEvents")),
        h("div", { className: "cc-tl-actions", key: "addev" }, h("button", { type: "button", className: "cc-btn", onClick: addEvent }, ico("plus"), t("taller.addEventHere"))),
        secH("s4", t("taller.f.plots")),
        plotList(ctx, "activePlots"),
        secH("s5", t("taller.f.completedPlots")),
        plotList(ctx, "completedPlots"),
        secH("s6", t("taller.sec.effects")),
        listField(ctx, ["effects"], { label: t("taller.f.effects"), item: t("taller.f.effect"), addLabel: t("taller.addEffect") }),
        secH("s7", t("taller.sec.recap")),
        h("p", { className: "cc-tl-hint", key: "rh" }, t("taller.recapHint")),
        textField(ctx, ["recap", "summary"], { label: t("taller.f.recapSummary"), area: true, wide: true }),
        group({ key: "hl", id: "tl-hl", label: t("taller.f.highlights"), hint: t("taller.highlightsHint"), errs: shownIssues("session", ctx.id, "recap.highlights") },
          pickList(`hl-${ctx.id}`, { label: t("taller.f.highlights"), options: evs.map(e => ({ value: e.id, label: e.title, meta: hl.includes(e.id) ? `#${hl.indexOf(e.id) + 1}` : "" })), isOn: v => hl.includes(v),
            toggle: v => { const p = rec("session", ctx.id), cur = arr(p.en.recap && p.en.recap.highlights); put("session", ctx.id, E.withField(p, ["recap", "highlights"], cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v])); } })),
      ];
    }
    // A session's threads: name, its quest, where it stood, the who's-who (linked by exact name) and notes.
    function plotList(ctx, pk) {
      const plots = arr((ctx.pair.en || {})[pk]), qopts = [{ value: "", label: t("taller.noQuest") }, ...questOptions()];
      const lang = S.ui.textLang;
      const moveTo = (i, to) => {
        let p = rec(ctx.kind, ctx.id);
        const item = { ...(p.en[pk][i] || {}) }, esL = E.esList(p, [pk]), esItem = esL ? esL[i] : null;
        if (to === "completedPlots" && !nonEmpty(item.closed)) item.closed = "Closed this session";
        if (to === "activePlots") delete item.closed;
        p = E.withList(p, [pk], "remove", i);
        p = E.withList(p, [to], "add", null, item);
        const at = arr(p.en[to]).length - 1, tr = { ...(esItem || {}) };
        if (to === "completedPlots" && !nonEmpty(tr.closed)) tr.closed = "Cerrado en esta sesión";
        if (to === "activePlots") delete tr.closed;
        if (Object.keys(tr).length) p = E.withText(p, [to, at], "es", tr);
        put(ctx.kind, ctx.id, p);
        flash(t(to === "completedPlots" ? "taller.plotClosed" : "taller.plotReopened"), "ok");
      };
      return h("div", { className: "cc-tl-items", key: pk },
        plots.map((pl, i) => {
          const path = [pk, i], npcs = arr(pl && pl.npcs);
          return h("div", { key: i, className: cls("cc-tl-item cc-tl-plot", pk === "completedPlots" && "done") },
            h("div", { style: { minWidth: 0 } },
              textField(ctx, [...path, "name"], { label: t("taller.f.plotName"), key: "n" }),
              selectField(ctx, [...path, "questId"], { label: t("taller.f.plotQuest"), options: qopts, field: `${pk}.${i}.questId` }),
              textField(ctx, [...path, "qt"], { label: t("taller.f.plotQt"), area: true, short: true, key: "q" }),
              pk === "completedPlots" ? textField(ctx, [...path, "closed"], { label: t("taller.f.plotClosed"), key: "c", placeholder: lang === "es" ? "Cerrado en esta sesión" : "Closed this session" }) : null,
              group({ key: "npcs", id: fid(ctx, [...path, "npcs"]), label: t("taller.f.plotNpcs"), langTag: langName(lang), hint: t("taller.npcsHint") },
                h("div", { className: "cc-tl-items" },
                  npcs.map((n, j) => h("div", { key: j, className: "cc-tl-item" },
                    h("div", { className: "cc-tl-grid" },
                      whoName(ctx, [...path, "npcs", j]),
                      textField(ctx, [...path, "npcs", j, "race"], { label: t("taller.f.npcRace"), key: "r", noteMissing: false }),
                      textField(ctx, [...path, "npcs", j, "role"], { label: t("taller.f.npcRole"), key: "o", noteMissing: false }),
                      textField(ctx, [...path, "npcs", j, "region"], { label: t("taller.f.npcRegion"), key: "g", noteMissing: false })),
                    itemButtons(ctx, [...path, "npcs"], j, npcs.length, t("taller.f.npcEntry")))),
                  h("button", { type: "button", className: "cc-btn ghost cc-tl-add", onClick: () => put(ctx.kind, ctx.id, E.withList(rec(ctx.kind, ctx.id), [...path, "npcs"], "add", null, {})) }, ico("plus"), t("taller.addNpc")))),
              listField(ctx, [...path, "notes"], { label: t("taller.f.notes"), item: t("taller.f.note"), addLabel: t("taller.addNote") }),
              h("button", { type: "button", className: "cc-btn ghost", onClick: () => moveTo(i, pk === "activePlots" ? "completedPlots" : "activePlots") }, ico(pk === "activePlots" ? "check" : "undo"), t(pk === "activePlots" ? "taller.closePlot" : "taller.reopenPlot"))),
            itemButtons(ctx, [pk], i, plots.length, t("taller.f.plot")));
        }),
        h("button", { type: "button", className: "cc-btn ghost cc-tl-add", onClick: () => put(ctx.kind, ctx.id, E.withList(rec(ctx.kind, ctx.id), [pk], "add", null, pk === "completedPlots" ? { closed: "Closed this session" } : {})) }, ico("plus"), t(pk === "activePlots" ? "taller.addPlot" : "taller.addClosedPlot")));
    }
    // A who's-who name links to a person or place only by its exact English name or alias: choosing one from the
    // list writes that name (and its Spanish one); anything else stays free text (an item, someone unrecorded).
    function whoName(ctx, path) {
      const m = model(), en = model("en"), es = model("es-AR");
      const cur = E.textAt(ctx.pair, [...path, "name"], "en"), ref = cur ? m.resolveName(cur) : null;
      const opts = [{ value: "", label: t("taller.whoFree") }, ...m.people.map(p => ({ value: `person:${p.id}`, label: p.name })), ...m.places.map(p => ({ value: `place:${p.id}`, label: `${p.name} · ${p.kindLabel}` }))];
      const choose = e => {
        const v = e.target.value; if (!v) return;
        const [type, id] = v.split(":"), byEn = type === "person" ? en.personById.get(id) : en.placeById.get(id), byEs = type === "person" ? es.personById.get(id) : es.placeById.get(id);
        let p = rec(ctx.kind, ctx.id);
        p = E.withText(p, [...path, "name"], "en", byEn ? byEn.nameEn : "");
        if (byEs && byEs.name !== byEn.nameEn) p = E.withText(p, [...path, "name"], "es", byEs.name);
        put(ctx.kind, ctx.id, p);
      };
      return h("div", { className: "cc-tl-field", key: "who" },
        textField(ctx, [...path, "name"], { label: t("taller.f.npcName"), key: "nm", noteMissing: false }),
        h("span", { className: "cc-selwrap" }, h("select", { className: "cc-select", value: ref ? `${ref.type}:${ref.id}` : "", onChange: choose, "aria-label": t("taller.whoPick") }, opts.map(option))),
        h("p", { className: "cc-tl-hint" }, ref ? t("taller.whoLinked", { name: nameOf(ref.type === "person" ? "person" : "place", ref.id) }) : cur ? t("taller.whoUnlinked") : t("taller.whoHint")));
    }

    function questFields(ctx) {
      const m = model(), q = m.questById.get(ctx.id), en = ctx.pair.en || {};
      const linked = q ? q.eventIds.map(x => m.eventById.get(x)) : [];
      const giverOpts = peopleOptions().map(o => ({ value: o.value, label: o.label }));
      // Choosing who gave it also writes their name as the quest's giver text (both languages); clearing it keeps the text.
      const onGiver = e => {
        const id = e.target.value, pe = id && model("en").personById.get(id), ps = id && model("es-AR").personById.get(id);
        let next = E.withField(rec("quest", ctx.id), ["giverId"], id || undefined);
        if (pe) { next = E.withText(next, ["giver"], "en", pe.nameEn); next = E.withText(next, ["giver"], "es", ps && ps.name !== pe.nameEn ? ps.name : ""); }
        put("quest", ctx.id, next);
      };
      const toggleEvent = eid => {
        const p = rec("event", eid); if (!p) return;
        const cur = arr(p.en.questIds);
        put("event", eid, E.withField(p, ["questIds"], cur.includes(ctx.id) ? cur.filter(x => x !== ctx.id) : [...cur, ctx.id]));
      };
      return [
        secH("s1", t("taller.sec.quest")),
        textField(ctx, ["title"], { label: t("taller.f.title"), required: true, wide: true }),
        h("div", { className: "cc-tl-grid", key: "g1" },
          selectField(ctx, ["status"], { label: t("taller.f.status"), required: true, options: Object.keys(M.QUEST_STATUS).map(k => ({ value: k, label: t(`questStatus.${k}`) })) }),
          selectField(ctx, ["giverId"], { label: t("taller.f.giverId"), empty: t("taller.noGiver"), options: giverOpts, hint: t("taller.giverHint"), onChange: onGiver })),
        en.giverId ? null : textField(ctx, ["giver"], { label: t("taller.f.giver"), wide: true, hint: t("taller.giverTextHint") }),
        textField(ctx, ["summary"], { label: t("taller.f.summary"), area: true, wide: true, hint: t("taller.questSummaryHint") }),
        listField(ctx, ["objectives"], { label: t("taller.f.objectives"), item: t("taller.f.objective"), addLabel: t("taller.addObjective") }),
        secH("s2", t("taller.sec.questLinks")),
        chipsField(ctx, ["sessions"], { label: t("taller.f.sessions"), sort: true, options: m.sessions.map(s => ({ value: s.no, label: t("common.sessionShort", { n: s.no }) })), hint: t("taller.questSessionsHint") }),
        chipsField(ctx, ["characterIds"], { label: t("taller.f.questCharacters"), options: pcChips() }),
        group({ key: "evs", id: "tl-q-evs", label: t("taller.f.questEvents"), hint: t("taller.questEventsHint") },
          pickList(`qev-${ctx.id}`, { label: t("taller.f.questEvents"), options: m.events.slice().reverse().map(e => ({ value: e.id, label: e.title, meta: t("common.session", { n: e.session }) })),
            isOn: eid => linked.some(e => e.id === eid), toggle: toggleEvent })),
        q && q.placeIds.length ? group({ key: "pl", id: "tl-q-pl", label: t("taller.f.questPlaces"), hint: t("taller.questPlacesHint") },
          h("div", { className: "cc-tl-chips" }, q.placeIds.map(pid => { const p = m.placeById.get(pid); return h("span", { key: pid, className: "cc-pcchip plain" }, app.placeIcon(p), p.name); }))) : null,
      ];
    }
    function placeFields(ctx) {
      const m = model(), p = m.placeById.get(ctx.id);
      const below = new Set([ctx.id, ...(p ? m.places.filter(x => x.ancestorIds.includes(ctx.id)).map(x => x.id) : [])]);
      const evs = p ? p.allEventIds.map(x => m.eventById.get(x)) : [];
      return [
        secH("s1", t("taller.sec.place")),
        textField(ctx, ["name"], { label: t("taller.f.name"), required: true, wide: true }),
        listField(ctx, ["aliases"], { label: t("taller.f.aliases"), item: t("taller.f.alias"), addLabel: t("taller.addAlias"), hint: t("taller.aliasHint") }),
        h("div", { className: "cc-tl-grid", key: "g1" },
          selectField(ctx, ["kind"], { label: t("taller.f.kind"), empty: t("taller.chooseLater"), options: Object.keys(M.PLACE_KINDS).map(k => ({ value: k, label: t(`placeKind.${k}`) })) }),
          selectField(ctx, ["parentId"], { label: t("taller.f.parentId"), empty: t("taller.topLevel"), options: placeOptions(below), hint: t("taller.parentHint") })),
        secH("s2", t("taller.sec.where")),
        positionBlock(ctx),
        evs.length ? secH("s3", t("place.happened"), h("span", { className: "n" }, String(evs.length))) : null,
        evs.length ? h("div", { className: "cc-tl-rows", key: "evs" }, evs.map(ev => eventRow(ev))) : null,
      ];
    }
    function personFields(ctx) {
      const k = ctx.kind, m = model(), en = ctx.pair.en || {};
      const factions = m.people.filter(p => p.category === "faction" && p.id !== ctx.id).map(p => ({ value: p.id, label: p.name }));
      const rels = arr(en.relations);
      const peopleOpts = [{ value: "", label: t("taller.choosePerson") }, ...m.people.filter(p => p.id !== ctx.id).map(p => ({ value: p.id, label: p.name }))];
      const fields = [secH("s1", t(k === "character" ? "taller.sec.pc" : "taller.sec.npc")),
        textField(ctx, ["name"], { label: t("taller.f.name"), required: true, wide: true, hint: t("taller.nameHint") }),
        listField(ctx, ["aliases"], { label: t("taller.f.aliases"), item: t("taller.f.alias"), addLabel: t("taller.addAlias"), hint: t("taller.aliasHint") })];
      if (k === "npc") fields.push(h("div", { className: "cc-tl-grid", key: "g1" },
        selectField(ctx, ["category"], { label: t("taller.f.category"), options: NPC_CATEGORIES.map(c => ({ value: c, label: t(`personCategoryOne.${c}`) })) }),
        textField(ctx, ["race"], { label: t("taller.f.race"), noteMissing: false })));
      fields.push(textField(ctx, ["role"], { label: t("taller.f.role"), wide: true, noteMissing: false, hint: k === "character" ? t("taller.pcRoleHint") : undefined }));
      if (k === "character") {
        const pics = portraits().map(s => ({ value: s, label: s.replace(/^assets\//, "") }));
        fields.push(h("div", { className: "cc-tl-grid", key: "g2" },
          h("div", { className: "cc-tl-field", key: "color" }, h("label", { className: "cc-tl-label", htmlFor: "tl-pc-color" }, t("taller.f.color")),
            h("input", { id: "tl-pc-color", type: "color", className: "cc-input", style: { padding: 4, height: 46 }, value: /^#[0-9a-f]{6}$/i.test(str(en.color)) ? en.color : "#cfa650",
              onChange: e => put(k, ctx.id, E.withField(rec(k, ctx.id), ["color"], e.target.value.toUpperCase()), true) }),
            h("p", { className: "cc-tl-hint" }, t("taller.colorHint"))),
          selectField(ctx, ["sealImg"], { label: t("taller.f.sealImg"), empty: t("taller.noPortrait"), options: pics, hint: t("taller.portraitHint") })));
      } else fields.push(chipsField(ctx, ["factionIds"], { label: t("taller.f.factionIds"), options: factions, none: t("taller.noFactions") }));
      fields.push(secH("s2", t("taller.f.relations")),
        h("p", { className: "cc-tl-hint", key: "rh" }, t("taller.relationsHint")),
        h("div", { className: "cc-tl-items", key: "rels" },
          rels.map((r, i) => h("div", { key: i, className: "cc-tl-item" },
            h("div", { className: "cc-tl-grid" },
              selectField(ctx, ["relations", i, "id"], { label: t("taller.f.relPerson"), options: peopleOpts.slice(1), empty: peopleOpts[0].label, field: `relations.${i}` }),
              textField(ctx, ["relations", i, "label"], { label: t("taller.f.relLabel"), key: "l", noteMissing: false }),
              textField(ctx, ["relations", i, "reverseLabel"], { label: t("taller.f.relReverse"), key: "r", noteMissing: false })),
            itemButtons(ctx, ["relations"], i, rels.length, t("taller.f.relation")))),
          h("button", { type: "button", className: "cc-btn ghost cc-tl-add", onClick: () => put(k, ctx.id, E.withList(rec(k, ctx.id), ["relations"], "add", null, {})) }, ico("plus"), t("taller.addRelation"))));
      return fields;
    }

    // ── Draft, validation, conflicts, export, import ────────────────────────
    function draftTab() {
      const sum = summary(), v = checks(), cf = conflicts();
      const items = [...sum.added, ...sum.modified, ...sum.deleted].sort((a, b) => a.kind.localeCompare(b.kind) || str(b.at).localeCompare(str(a.at)));
      const canExport = sum.total > 0 && v.ok && !cf.length && !S.ui.exporting && !!content0();
      return h("div", { key: "draft" },
        h("p", { className: "cc-tl-sub" }, t("taller.draftIntro")),
        S.freshNote ? h("div", { className: "cc-tl-note is-warn" }, ico("warn"), h("p", null, S.freshNote)) : null,
        h("h2", { className: "cc-h2" }, t("taller.changesH"), h("span", { className: "n" }, String(sum.total))),
        items.length ? h("div", { className: "cc-tl-rows" }, items.map(changeRow)) : h("p", { className: "cc-tl-empty" }, t("taller.noChanges")),
        cf.length ? h(React.Fragment, null, h("h2", { className: "cc-h2" }, t("taller.conflictsH"), h("span", { className: "n" }, String(cf.length))),
          h("p", { className: "cc-tl-hint" }, t("taller.conflictsD")), cf.map(conflictCard)) : null,
        h("h2", { className: "cc-h2" }, t("taller.checkH")),
        !sum.total ? h("p", { className: "cc-tl-hint" }, t("taller.checkNothing"))
          : v.errors.length ? h(React.Fragment, null, h("div", { className: "cc-tl-note is-error" }, ico("warn"), h("p", null, t("taller.checkErrors", { count: v.errors.length }))), issueList(v.errors, false))
            : h("div", { className: "cc-tl-note is-ok" }, ico("check"), h("p", null, t("taller.checkOk"))),
        v.warnings.length && sum.total ? h(React.Fragment, null, h("p", { className: "cc-tl-hint" }, t("taller.checkWarnings", { count: v.warnings.length })), issueList(v.warnings, true)) : null,
        sum.total && v.errors.length ? h("div", { className: "cc-tl-actions" }, h("button", { type: "button", className: "cc-btn ghost", onClick: () => { S.ui.showAll = true; render(); } }, t("taller.showAllErrors"))) : null,
        h("h2", { className: "cc-h2" }, t("taller.exportH")),
        h("div", { className: "cc-tl-note" }, ico("download"), h("div", null, h("p", null, t("taller.exportD")), h("p", null, h("strong", null, t("taller.notPublished"))))),
        h("div", { className: "cc-tl-actions" },
          h("button", { type: "button", className: "cc-btn", disabled: !canExport, onClick: exportPackage }, ico("download"), t(S.ui.exporting ? "taller.exporting" : "taller.exportZip")),
          h("button", { type: "button", className: "cc-btn ghost", onClick: downloadDraft, disabled: !sum.total }, ico("download"), t("taller.downloadDraft"))),
        !canExport && sum.total && !S.ui.exporting ? h("p", { className: "cc-tl-hint" }, t(cf.length ? "taller.exportBlockedConflicts" : !content0() ? "taller.noContent" : "taller.exportBlockedErrors")) : null,
        S.ui.lastExport ? h("div", { className: "cc-tl-note is-ok", role: "status" }, ico("check"), h("div", null, h("p", null, h("strong", null, t("taller.exportedT"))),
          h("p", null, t("taller.exportedD", { name: S.ui.lastExport.name, count: S.ui.lastExport.files.length })),
          h("ul", { style: { margin: "6px 0 0", paddingLeft: 18 } }, S.ui.lastExport.files.map(f => h("li", { key: f }, h("span", { className: "cc-tl-mono" }, f)))),
          h("p", null, t("taller.exportedNext")))) : null,
        sum.total && v.ok && !cf.length ? h("details", { className: "cc-disc" }, h("summary", null, ico("download"), t("taller.looseFiles")),
          h("div", { className: "cc-disc-b" }, h("p", { className: "cc-tl-hint" }, t("taller.looseFilesD")),
            h("div", { className: "cc-tl-actions" }, memo("loose", [S.settled, pub()], () => E.exportFiles(pub(), S.settled)).map(f => h("button", { key: f.path, type: "button", className: "cc-btn ghost", onClick: () => download(f.text, f.path.split("/").pop(), "application/json") }, ico("download"), f.path))))) : null,
        h("h2", { className: "cc-h2" }, t("taller.importH")),
        h("p", { className: "cc-tl-hint" }, t("taller.importD")),
        h("ul", { className: "cc-tl-hint", style: { margin: "4px 0 10px", paddingLeft: 18 } }, ["importDraft", "importData", "importRestore"].map(k => h("li", { key: k }, t(`taller.${k}`)))),
        h("div", { className: "cc-tl-field" }, h("label", { className: "cc-tl-label", htmlFor: "tl-import" }, t("taller.importFile")),
          h("input", { id: "tl-import", className: "cc-tl-file", type: "file", accept: ".json,.zip,application/json,application/zip", onChange: e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importFile(f); } })),
        h("h2", { className: "cc-h2" }, t("taller.backupsH")),
        h("p", { className: "cc-tl-hint" }, t("taller.backupsD")),
        S.ui.backups == null ? h("p", { className: "cc-tl-hint" }, t("taller.loadingBackups")) : S.ui.backups.length ? h("ul", { className: "cc-tl-backups" }, S.ui.backups.map(b => h("li", { key: b.id },
          h("span", null, `${new Date(b.at).toLocaleString(app.t.meta.htmlLang, { dateStyle: "medium", timeStyle: "short" })} · ${t(`taller.backupReason.${b.reason}`) || b.reason} · ${t("taller.draftCount", { count: b.count || 0 })}`),
          h("button", { type: "button", className: "cc-btn ghost", onClick: () => askRestore(b) }, ico("undo"), t("taller.restore"))))) : h("p", { className: "cc-tl-hint" }, t("taller.noBackups")),
        h("h2", { className: "cc-h2" }, t("taller.discardH")),
        h("p", { className: "cc-tl-hint" }, t("taller.discardD")),
        h("div", { className: "cc-tl-actions" }, h("button", { type: "button", className: "cc-btn ghost is-danger", disabled: !sum.total, onClick: askDiscardAll }, ico("trash"), t("taller.discardAll"))));
    }
    function issueList(list, warn) {
      return h("ul", { className: cls("cc-tl-issues", warn && "warn") }, list.map((i, n) => h("li", { key: n }, ico("warn"),
        h("span", null, i.kind ? h(React.Fragment, null, h("a", { href: formHref(i.kind, i.id) }, `${kindName(i.kind)} «${nameOf(i.kind, i.id)}»`), i.field ? ` · ${fieldLabel(i.kind, i.field)}` : "", ": ") : null, issueText(i)))));
    }
    function conflictCard(c) {
      const resolve = how => () => { if (how !== "merge") backup("conflict"); commit(E.resolveConflict(pub(), S.draft, c.kind, c.id, how)); flash(t("taller.conflictResolved"), "ok"); };
      const val = v => (v === undefined ? "—" : typeof v === "string" ? short(v, 120) : short(JSON.stringify(v), 120));
      const rename = () => { const nid = E.uniqueId(c.id, E.idsInUse(pub(), S.draft, c.kind)); commit(E.renameNew(S.draft, c.kind, c.id, nid)); flash(t("taller.renamed", { id: nid }), "ok"); };
      return h("div", { key: `${c.kind}:${c.id}`, className: "cc-tl-conflict" },
        h("p", { style: { margin: "0 0 6px", fontFamily: "var(--font-ui)", fontSize: 15 } }, h("strong", null, `${kindName(c.kind)} «${nameOf(c.kind, c.id)}»`), " — ", t(`taller.conflict.${c.type}`)),
        c.fields.length ? h("table", { className: "cc-tl-diff" }, h("thead", null, h("tr", null, ["field", "base", "mine", "published"].map(k => h("th", { key: k, scope: "col" }, t(`taller.diff.${k}`))))),
          h("tbody", null, c.fields.map((f, n) => h("tr", { key: n, className: f.clash ? "is-clash" : undefined }, h("td", null, `${fieldLabel(c.kind, f.field) || f.field}${f.lang === "es" ? ` (${langName("es")})` : ""}`), h("td", null, val(f.base)), h("td", null, val(f.mine)), h("td", null, val(f.published)))))) : null,
        h("div", { className: "cc-tl-actions" },
          c.mergeable ? h("button", { type: "button", className: "cc-btn", onClick: resolve("merge") }, t("taller.mergeBoth")) : null,
          c.type === "taken" ? h("button", { type: "button", className: "cc-btn", onClick: rename }, t("taller.renameMine")) : null,
          h("button", { type: "button", className: cls("cc-btn", c.mergeable || c.type === "taken" ? "ghost" : ""), onClick: resolve("mine") }, t("taller.keepMine")),
          h("button", { type: "button", className: "cc-btn ghost", onClick: resolve("published") }, t("taller.takePublished"))));
    }
    function download(data, name, type) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: type || "application/octet-stream" });
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    function downloadDraft() {
      const name = `taller-borrador-${stamp(new Date())}.json`;
      download(E.draftToText(S.draft), name, "application/json");
      flash(t("taller.draftDownloaded", { name }), "ok");
    }
    // The published data as it is now (fetched again past every cache): the export is written over it, so records
    // published since the page opened are kept, and a conflict is caught before anything is downloaded.
    async function fetchPublished() {
      let offline = false;
      const get = async (path, optional) => {
        const res = await fetch(path, { cache: "no-store" });
        if (res.headers && res.headers.get("x-chronicle-offline") === "1") offline = true;
        if (!res.ok) { if (optional && res.status === 404) return null; throw new Error(`${path}: HTTP ${res.status}`); }
        return res.json();
      };
      const names = ["characters", "routes", "events", "sessions", "quests", "npcs", "locations", "lore"];
      const vals = await Promise.all(names.map(n => get(`data/${n}.json`, n === "lore")));
      const raw = {}; names.forEach((n, i) => { raw[n] = vals[i]; });
      const content = await get(E.CONTENT_PATH, false);
      return { base: { raw, content }, offline };
    }
    function refreshPublished() {
      if (!S.loaded) return Promise.resolve(null);
      if (!S.refreshing) S.refreshing = readPublished().finally(() => { S.refreshing = null; });
      return S.refreshing;
    }
    async function readPublished() {
      try {
        const { base: fresh, offline } = await fetchPublished();
        const same = E.canonical(E.fingerprint(fresh)) === E.canonical(E.fingerprint(pub()));
        if (!same) { S.fresh = fresh; S.memo = {}; settlePublished(); }
        S.freshNote = offline ? t("taller.freshOffline") : !same ? t("taller.freshChanged") : "";
        render();
        return { offline };
      } catch (e) { S.freshNote = t("taller.freshFailed", { error: String((e && e.message) || e) }); render(); return null; }
    }
    async function exportPackage() {
      if (S.ui.exporting) return;
      S.ui.exporting = true; render();
      try {
        await flush();
        const fresh = await refreshPublished();
        if (!fresh) return flash(t("taller.exportNoBase"), "warn");
        S.settled = S.draft;
        if (conflicts().length) return flash(t("taller.exportBlockedConflicts"), "warn");
        const v = checks();
        if (!v.ok) { S.ui.showAll = true; return flash(t("taller.exportBlockedErrors"), "warn"); }
        const files = E.exportFiles(pub(), S.draft);
        if (!files.length) return flash(t("taller.nothingToExport"), "warn");
        const now = new Date(), name = `cronica-cambios-${stamp(now)}.zip`;
        const draftOut = { ...S.draft, base: { files: E.fingerprint(pub()), at: now.toISOString() } };
        const entries = [{ name: "LEEME.txt", data: readme(now, files, fresh.offline) }, { name: "cambios.json", data: E.draftToText(draftOut) }, ...files.map(f => ({ name: f.path, data: f.text }))];
        download(new Blob([E.zip(entries, now)], { type: "application/zip" }), name);
        S.ui.lastExport = { name, at: now, files: entries.map(e => e.name) };
        flash(t("taller.exportedT"), "ok");
      } catch (e) {
        flash(t("taller.exportFailed", { error: String((e && e.message) || e) }), "warn");
      } finally { S.ui.exporting = false; render(); }
    }
    // What the package says about itself (in the interface's language): what it holds, that nothing is published
    // yet, the changes, and the two ways to incorporate it.
    function readme(now, files, offline) {
      const sum = summary(), line = it => `  ${it.group} ${kindName(it.kind)} «${nameOf(it.kind, it.id)}»`;
      const changes = [...sum.added.map(x => ({ ...x, group: "+" })), ...sum.modified.map(x => ({ ...x, group: "~" })), ...sum.deleted.map(x => ({ ...x, group: "−" }))].map(line);
      return [t("taller.readme.title"), `${t("taller.readme.when", { date: now.toLocaleString(app.t.meta.htmlLang) })} · ${S.draft.id}`, t("taller.readme.notPublished"), "",
        t("taller.readme.contents"), `  LEEME.txt — ${t("taller.readme.leeme")}`, `  cambios.json — ${t("taller.readme.cambios")}`,
        ...files.map(f => `  ${f.path} — ${t("taller.readme.file")}`), offline ? `  ${t("taller.readme.offline")}` : "", "",
        t("taller.readme.changes", { count: sum.total }), ...changes, "",
        t("taller.readme.howH"), `  ${t("taller.readme.howA")}`, "    node tools/apply-draft.js cambios.json --check", "    node tools/apply-draft.js cambios.json", "    npm test",
        `  ${t("taller.readme.howB")}`, `  ${t("taller.readme.howEnd")}`, ""].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
    }
    function askDiscardAll() {
      confirm({ title: t("taller.discardAllQ"), body: [t("taller.discardAllD", { count: summary().total })], confirmLabel: t("taller.discardAll"), danger: true,
        onConfirm: async () => { await backup("discard"); S.mx.pending = {}; replaceDraft(E.emptyDraft(pub()), t("taller.discarded")); } });
    }
    function askRestore(b) {
      confirm({ title: t("taller.restoreQ"), body: [t("taller.restoreD", { date: new Date(b.at).toLocaleString(app.t.meta.htmlLang) })], confirmLabel: t("taller.restore"),
        onConfirm: async () => {
          const d = await S.store.getBackup(b.id); if (!d) return flash(t("taller.unreadable"), "warn");
          const parsed = E.parseDraft(JSON.stringify(d)); if (parsed.error) return flash(t("taller.unreadable"), "warn");
          await backup("restore"); replaceDraft({ ...parsed.draft, id: S.draft.id, rev: S.draft.rev + 1 }, t("taller.restored"));
        } });
    }
    const inflater = () => (typeof DecompressionStream === "function" ? async data => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()) : null);
    async function importFile(file) {
      if (!file) return;
      try {
        if (file.size > 8 * 1024 * 1024) return flash(t("taller.import.tooLarge"), "warn");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let text;
        if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
          const entries = await E.unzip(bytes, { inflateRaw: inflater() });
          const entry = entries.find(x => /(^|\/)cambios\.json$/.test(x.name));
          if (!entry) return flash(t("taller.import.zipNoDraft"), "warn");
          text = new TextDecoder().decode(entry.data);
        } else text = new TextDecoder().decode(bytes);
        const parsed = E.parseDraft(text);
        if (!parsed.error) return askDraftImport(parsed, file.name);
        if (parsed.error === "notDraft") {
          let v; try { v = E.sanitize(JSON.parse(text.replace(/^﻿/, "")), 0); } catch (e) { return flash(t("taller.import.notJson"), "warn"); }
          const res = E.changesFromFile(pub(), S.draft, file.name, v);
          if (res.ok) return askDataImport(res, file.name);
          return flash(t("taller.import.unknown", { name: file.name }), "warn");
        }
        flash(t(`taller.import.${parsed.error}`), "warn");
      } catch (e) { flash(t("taller.import.failed", { error: String((e && e.message) || e) }), "warn"); }
    }
    function askDraftImport(parsed, name) {
      const incoming = parsed.draft, inSum = E.summarize(incoming), mine = summary().total;
      const merged = E.mergeDrafts(S.draft, incoming);
      const body = [t("taller.import.draftD", { name, count: inSum.total }), ...(parsed.skipped.length ? [t("taller.import.skipped", { count: parsed.skipped.length })] : [])];
      if (!mine) return confirm({ title: t("taller.import.draftT"), body, confirmLabel: t("taller.import.load"),
        onConfirm: () => replaceDraft({ ...incoming, id: S.draft.id, rev: S.draft.rev + 1 }, t("taller.import.done", { count: inSum.total })) });
      openDialog({ type: "import", title: t("taller.import.draftT"), body: [...body, t("taller.import.choose", { count: mine }), ...(merged.replaced.length ? [t("taller.import.replaces", { count: merged.replaced.length }), merged.replaced.map(r => `${kindName(r.kind)} «${nameOf(r.kind, r.id)}»`)] : [])],
        actions: [
          { label: t("taller.import.merge"), primary: true, run: async () => { await backup("import-merge"); replaceDraft(merged.draft, t("taller.import.merged", { count: inSum.total })); } },
          { label: t("taller.import.replace"), danger: true, run: async () => { await backup("import-replace"); replaceDraft({ ...incoming, id: S.draft.id, rev: S.draft.rev + 1 }, t("taller.import.done", { count: inSum.total })); } },
        ] });
    }
    function askDataImport(res, name) {
      if (!res.changes.length) return flash(t("taller.import.noDiff", { name }), "ok");
      const already = res.changes.filter(c => S.draft.changes[c.kind] && S.draft.changes[c.kind][c.id]);
      openDialog({ type: "import", title: t("taller.import.dataT"), body: [t("taller.import.dataD", { name, count: res.changes.length }),
        res.changes.slice(0, 12).map(c => `${c.isNew ? "+" : "~"} ${kindName(c.kind)} «${(c.pair.en && (c.pair.en.title || c.pair.en.name)) || c.id}»`),
        ...(already.length ? [t("taller.import.replaces", { count: already.length })] : []), t("taller.import.noDeletes")],
        actions: [{ label: t("taller.import.add"), primary: true, run: async () => {
          await backup("import-data");
          let d = S.draft; res.changes.forEach(c => { d = E.putRecord(d, pub(), c.kind, c.id, c.pair); });
          commit(d); flash(t("taller.import.merged", { count: res.changes.length }), "ok");
        } }] });
    }
    function importBody(dg) {
      return h(React.Fragment, null,
        ...arr(dg.body).map((p, i) => (Array.isArray(p) ? h("ul", { key: i }, p.map((x, j) => h("li", { key: j }, x))) : h("p", { key: i }, p))),
        h("div", { className: "cc-tl-actions end" }, h("button", { type: "button", className: "cc-btn ghost", onClick: closeDialog }, t("common.cancel")),
          ...dg.actions.map((a, i) => h("button", { key: i, type: "button", className: cls("cc-btn", !a.primary && "ghost", a.danger && "is-danger"), onClick: () => { closeDialog(); a.run(); } }, a.label))));
    }

    // ── The preview (the reading pane, fed by the draft) ────────────────────
    const closePreview = () => { if (app.state.isWide) S.ui.previewHidden = true; else S.ui.preview = false; render(); app.reflow(); };
    const inert = e => {
      const el = e.target && e.target.closest && e.target.closest("a,button");
      if (!el || el.closest(".cc-docbar")) return;
      e.preventDefault(); e.stopPropagation();
      flash(t("taller.preview.inert"), "ok");
    };
    function preview() {
      const r = app.state.route;
      if (!S.loaded || !r.kind || !(r.kind in FORM_KINDS)) return null;
      if (app.state.isWide ? S.ui.previewHidden : !S.ui.preview) return null;
      return memo("preview", [S.settled, pub(), app.state.lang, app.state.isWide, routeHash(r)], () => previewNow(r));
    }
    function previewNow(r) {
      const m = model(), k = r.kind === "character" ? personKind(r.id) : r.kind, kindKey = k === "npc" ? "character" : k;
      const common = { open: true, preview: true, kindLabel: t("taller.preview.kind", { kind: t(`kinds.${kindKey}`) }), previewNote: t("taller.preview.note"),
        onBack: closePreview, onClose: closePreview, homeHref: "#/taller", mapHref: null, hasPrevNext: false, onCapture: inert };
      const saved = app.model; app.model = m;
      let out = null;
      try {
        if (k === "event") { const ev = m.eventById.get(r.id); if (ev) out = [{ ...common, event: true }, app._eventVm(ev)]; }
        else if (k === "session") { const s = m.sessionByNo.get(Number(r.id)); if (s) out = [{ ...common, session: true }, app._sessionVm(s)]; }
        else if (k === "quest") { const q = m.questById.get(r.id); if (q) out = [{ ...common, quest: true }, app._questVm(q)]; }
        else if (k === "place") { const p = m.placeById.get(r.id); if (p) out = [{ ...common, place: true, lore: app._loreVm(p, "place") }, app._placeVm(p)]; }
        else { const p = m.personById.get(r.id); if (p) out = [{ ...common, character: true, kindLabel: t("taller.preview.kind", { kind: p.kind === "pc" ? t("kinds.partyMember") : p.categoryLabel }), lore: app._loreVm(p, "character") }, app._personVm(p)]; }
      } finally { app.model = saved; }
      return out || [{ ...common, notFound: true }, {}];
    }

    // ── The map editor ──────────────────────────────────────────────────────
    function mxTarget() {
      const r = app.state.route;
      if (!isMapEdit(r) || !r.id || !S.loaded) return null;
      const kind = r.kind === "editplace" ? "place" : "event", pair = rec(kind, r.id), key = `${kind}:${r.id}`;
      return pair ? { kind, id: String(r.id), key, pair } : { kind, id: String(r.id), key, missing: true };
    }
    const mxDraftPoint = tg => pointOf(tg.pair.en);
    const mxPoint = tg => S.mx.pending[tg.key] || mxDraftPoint(tg);
    function mxSuggestion(tg) {
      const s = tg.kind === "event" ? E.suggestPosition(model(), { locationId: (tg.pair.en || {}).locationId, excludeEventId: tg.id }) : E.suggestPosition(model(), { locationId: tg.id });
      return s && s.source && !(tg.kind === "place" && s.source === "place") ? s : null;
    }
    function worldRect() { const w = app._vpEl && app._vpEl.querySelector("[data-world]"); return w ? w.getBoundingClientRect() : null; }
    function placeAt(tg, cx, cy) {
      const r = worldRect(); if (!r) return null;
      const p = E.clientToPercent(cx, cy, r); if (!p) return null;
      S.mx.pending[tg.key] = { xp: p.xp, yp: p.yp };
      if (tg.kind === "place" && !S.mx.precision[tg.key]) S.mx.precision[tg.key] = "exact";
      return p;
    }
    let sayTimer = 0;
    function announce(tg) {
      const p = mxPoint(tg); if (!p) return;
      clearTimeout(sayTimer);
      sayTimer = setTimeout(() => say(t("mx.movedTo", { name: nameOf(tg.kind, tg.id), x: p.xp.toFixed(2), y: p.yp.toFixed(2) })), 250);
    }
    function nudge(tg, dx, dy, mult) {
      const r = worldRect(), st = E.pixelStep(r ? r.width : 1000), cur = mxPoint(tg) || (mxSuggestion(tg) || {}).point;
      if (!cur) return;
      S.mx.pending[tg.key] = E.nudge(cur, dx * st.x * mult, dy * st.y * mult);
      render(); announce(tg);
    }
    function confirmMove(tg) {
      const p = S.mx.pending[tg.key]; if (!p) return;
      let pair = E.withField(E.withField(rec(tg.kind, tg.id), ["xp"], p.xp), ["yp"], p.yp);
      if (tg.kind === "place") pair = E.withField(pair, ["mapPrecision"], S.mx.precision[tg.key] || (pair.en && pair.en.mapPrecision) || "exact");
      delete S.mx.pending[tg.key]; delete S.mx.precision[tg.key];
      commit(E.putRecord(S.draft, pub(), tg.kind, tg.id, pair));
      say(t("mx.confirmed", { name: nameOf(tg.kind, tg.id) }));
      flash(t("mx.savedDraft", { name: nameOf(tg.kind, tg.id) }), "ok");
      leaveTarget(tg);
    }
    function cancelMove(tg) {
      const had = !!S.mx.pending[tg.key];
      delete S.mx.pending[tg.key]; delete S.mx.precision[tg.key];
      if (had) say(t("mx.cancelled"));
      leaveTarget(tg);
    }
    // After confirming or cancelling: back to the form it came from, else to the editor's list.
    function leaveTarget(tg) {
      const ret = S.mx.returnTo;
      if (ret && ret.key === tg.key) { S.mx.returnTo = null; app.navigate(ret.hash); }
      else { render(); app.navigate("#/map/edit", { replace: true }); }
    }
    function goEdit(kind, id) {
      S.mx.choice = null;
      app.navigate(kind === "place" ? `#/map/editplace/${enc(id)}` : `#/map/edit/${enc(id)}`, { replace: isMapEdit(app.state.route) });
    }
    function mapEvents() {
      const tg = mxTarget(), m = model();
      return memo("mxEvents", [S.settled, pub(), app.state.lang, tg && tg.kind === "event" ? tg.id : ""], () => m.events.filter(e => e.hasCoords && !(tg && tg.kind === "event" && e.id === tg.id)));
    }
    function mapFocus() {
      const tg = mxTarget(); if (!tg || tg.missing) return null;
      const p = mxPoint(tg) || (mxSuggestion(tg) || {}).point;
      return p ? { xp: p.xp, yp: p.yp } : null;
    }
    function mapHint() {
      const tg = mxTarget();
      if (!tg || tg.missing) return t("mx.hintPick");
      if (tg.kind === "place" && planarPlace(tg.id)) return t("mx.hintPlanar");
      return t(app.state.isMobile ? "mx.hintTap" : "mx.hintClick");
    }
    const exitHref = () => (S.mx.returnTo ? S.mx.returnTo.hash : tabHref("map"));
    function mapPointerDown(e) { S.mx.down = { x: e.clientX, y: e.clientY }; }
    function mapClick(e) {
      const tg = mxTarget(); if (!tg || tg.missing) return;
      if (e.target && e.target.closest && e.target.closest(".cc-marker,.cc-editpin,[data-nopan],[data-nodrag]")) return;
      const d = S.mx.down; S.mx.down = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;          // that was a drag of the map, not a tap
      if (tg.kind === "place" && planarPlace(tg.id)) return;
      if (placeAt(tg, e.clientX, e.clientY)) { render(); announce(tg); }
    }
    function pickFromMap(ids) {
      if (ids.length === 1) return goEdit("event", ids[0]);
      S.mx.choice = ids; S.mx.sheetMin = false; render();
    }
    function mapLayer(view) {
      const tg = mxTarget(); if (!tg || tg.missing) return null;
      const inv = app.viewport.MAX / view.scale, cur = mxPoint(tg), orig = mxDraftPoint(tg), sug = !cur ? mxSuggestion(tg) : null;
      const size = app.state.isMobile ? 40 : 34, name = nameOf(tg.kind, tg.id), kids = [];
      const at = (p, extra) => ({ left: `${p.xp}%`, top: `${p.yp}%`, transform: `translate(-50%,-50%) scale(${inv.toFixed(4)})${extra || ""}` });
      if (orig && cur && (orig.xp !== cur.xp || orig.yp !== cur.yp)) {
        kids.push(h("svg", { key: "line", className: "cc-editline", viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" },
          h("line", { x1: orig.xp, y1: orig.yp, x2: cur.xp, y2: cur.yp, stroke: "#cfa650", strokeWidth: 2, strokeDasharray: "4 4", vectorEffect: "non-scaling-stroke" })));
        kids.push(h("span", { key: "ghost", className: "cc-editghost", style: at(orig), "aria-hidden": "true" }));
      }
      if (sug && sug.point) {
        kids.push(h("span", { key: "sug", className: "cc-editsug", style: at(sug.point), "aria-hidden": "true" }));
        kids.push(h("span", { key: "sugcap", className: "cc-editcap", style: { ...at(sug.point), transform: `translate(-50%,${(26 * inv).toFixed(2)}px) scale(${inv.toFixed(4)})`, transformOrigin: "50% 0" }, "aria-hidden": "true" }, t("mx.suggestionCap")));
      }
      if (cur) {
        const drag = S.mx.drag && S.mx.drag.key === tg.key;
        kids.push(h("button", { key: "pin", type: "button", className: cls("cc-editpin is-sel", drag && "is-drag"), "data-nodrag": "1",
          style: { ...at(cur, " rotate(-45deg)"), width: size, height: size },
          "aria-label": t("mx.markerAria", { name, x: cur.xp.toFixed(2), y: cur.yp.toFixed(2) }), "aria-describedby": "cc-mx-keys",
          onMouseDown: stop, onClick: stop,
          onPointerDown: e => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { /* capture is a nicety */ }
            S.mx.drag = { key: tg.key, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
            e.currentTarget.focus({ preventScroll: true }); render();
          },
          onPointerMove: e => {
            const d = S.mx.drag; if (!d || d.pointer !== e.pointerId) return;
            e.preventDefault();
            if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 2) return;
            d.moved = true;
            S.mx.rafPending = { x: e.clientX, y: e.clientY };
            if (!S.mx.raf) S.mx.raf = requestAnimationFrame(() => { S.mx.raf = 0; const q = S.mx.rafPending; if (q && S.mx.drag) { placeAt(tg, q.x, q.y); render(); } });
          },
          onPointerUp: e => {
            const d = S.mx.drag; if (!d || d.pointer !== e.pointerId) return;
            S.mx.drag = null;
            if (d.moved) { placeAt(tg, e.clientX, e.clientY); announce(tg); }
            render();
          },
          onPointerCancel: () => { S.mx.drag = null; render(); },
          onKeyDown: e => {
            const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
            if (dir) { e.preventDefault(); e.stopPropagation(); nudge(tg, dir[0], dir[1], e.shiftKey ? 10 : 1); }
            else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && S.mx.pending[tg.key]) { e.preventDefault(); confirmMove(tg); }
          } },
          h("span", { className: "cc-editpin-c", style: { transform: "rotate(45deg)" } })));
        kids.push(h("span", { key: "cap", className: "cc-editcap", style: { ...at(cur), transform: `translate(-50%,${((size * 0.75 + 8) * inv).toFixed(2)}px) scale(${inv.toFixed(4)})`, transformOrigin: "50% 0" }, "aria-hidden": "true" }, name));
      }
      return h(React.Fragment, null, ...kids);
    }
    function mapPanel() {
      const wide = app.state.isWide, tg = mxTarget(), loading = !S.loaded;
      const head = h("div", { className: "cc-mx-h", key: "h" },
        h("h2", { tabIndex: -1 }, t("mx.title")),
        !wide && tg && !tg.missing ? iconBtn(t(S.mx.sheetMin ? "mx.expand" : "mx.collapse"), S.mx.sheetMin ? "▴" : "▾", () => { S.mx.sheetMin = !S.mx.sheetMin; render(); }) : null,
        h("a", { className: "cc-iconbtn sm", href: exitHref(), title: t("mx.exit"), "aria-label": t("mx.exit") }, "✕"));
      const body = loading ? h("p", { className: "cc-tl-hint", key: "l" }, t("taller.opening"))
        : tg ? (tg.missing ? missingCard(tg) : !wide && S.mx.sheetMin ? miniBar(tg) : targetCard(tg)) : S.mx.choice ? choiceList() : mxList();
      if (wide) return h("div", { className: "cc-mx is-aside" }, head, flashLine(), body);
      return h("div", { className: cls("cc-mx cc-mx-sheet", S.mx.sheetMin && tg && "is-min"), "data-nopan": "1", onMouseDown: stop, role: "region", "aria-label": t("mx.title") },
        S.mx.sheetMin && tg && !tg.missing ? null : head, S.mx.sheetMin ? null : flashLine(), body);
    }
    const flashLine = () => (S.ui.flash ? h("p", { className: cls("cc-tl-hint"), role: "status", key: "f", style: { color: S.ui.flash.level === "ok" ? "var(--st-done)" : "var(--st-pending)", margin: "0 0 8px" } }, S.ui.flash.text) : null);
    function missingCard(tg) {
      return h("div", { key: "miss" }, h("p", { className: "cc-tl-hint" }, t("mx.missing", { id: tg.id })), h("a", { className: "cc-btn ghost", href: "#/map/edit" }, ico("back"), t("mx.backToList")));
    }
    function targetMeta(tg) {
      const m = model();
      if (tg.kind === "event") { const ev = m.eventById.get(tg.id); return ev ? [t("common.session", { n: ev.session }), ev.campaignDay != null ? app.dayText(ev) : "", ev.locationId ? (m.placeById.get(ev.locationId) || {}).name : ""].filter(Boolean).join(" · ") : ""; }
      const p = m.placeById.get(tg.id); return p ? [p.kindLabel, ...p.ancestorIds.slice(0, 2).map(a => m.placeById.get(a).name)].join(" · ") : "";
    }
    function miniBar(tg) {
      const cur = mxPoint(tg), pending = !!S.mx.pending[tg.key], sug = !cur ? mxSuggestion(tg) : null;
      return h("div", { className: "cc-mx-mini", key: "mini" },
        h("div", { className: "cc-mx-mini-b" }, h("p", { className: "cc-mx-t" }, nameOf(tg.kind, tg.id)), h("p", { className: "cc-mx-m cc-tl-coord", role: "status" }, cur ? fmtPoint(cur) : t("taller.noPosition"))),
        sug ? h("button", { type: "button", className: "cc-btn ghost", onClick: () => { S.mx.pending[tg.key] = { ...sug.point }; if (tg.kind === "place") S.mx.precision[tg.key] = sug.precision; render(); announce(tg); } }, ico("target"), t("mx.suggestionCap")) : null,
        h("button", { type: "button", className: "cc-btn ghost", onClick: () => cancelMove(tg) }, t("common.cancel")),
        h("button", { type: "button", className: "cc-btn", disabled: !pending, onClick: () => confirmMove(tg) }, t("mx.confirm")),
        iconBtn(t("mx.expand"), "▴", () => { S.mx.sheetMin = false; render(); }));
    }
    function targetCard(tg) {
      const cur = mxPoint(tg), orig = mxDraftPoint(tg), pending = !!S.mx.pending[tg.key], planar = tg.kind === "place" ? planarPlace(tg.id) : false;
      const pubPt = pointOf(E.publishedPair(pub(), tg.kind, tg.id).en), sug = mxSuggestion(tg);
      const placeRef = tg.kind === "event" && sug && sug.source === "place" ? sug : null;
      const state = pending ? ["is-pending", t("taller.posPending")] : orig ? (pubPt && orig.xp === pubPt.xp && orig.yp === pubPt.yp ? ["", t("taller.posPublished")] : ["", t("taller.posDraft")]) : ["", t("taller.noPosition")];
      // While a field is being typed in it shows what was typed ("4", "42.", …), not the stored value, so every key lands;
      // leaving it shows the stored value (two decimals, clamped to the map).
      const typed = axis => (S.mx.typing && S.mx.typing.key === tg.key && S.mx.typing.axis === axis ? S.mx.typing.text : cur ? (axis === "x" ? cur.xp : cur.yp).toFixed(2) : "");
      const setXY = (axis, v) => {
        const n = parseFloat(String(v).replace(",", "."));
        if (!isNum(n)) return;
        const base0 = cur || (sug && sug.point) || { xp: 50, yp: 50 };
        S.mx.pending[tg.key] = E.point(axis === "x" ? n : base0.xp, axis === "y" ? n : base0.yp);
        render(); announce(tg);
      };
      const useSug = s => { S.mx.pending[tg.key] = { ...s.point }; if (tg.kind === "place") S.mx.precision[tg.key] = s.precision; render(); announce(tg); };
      const center = () => { const p = cur || (sug && sug.point); if (p) app.zoomTo(p, Math.max(app.state.view.scale, 2.4)); };
      const placeCenter = () => {
        const vp = app._vpEl; if (!vp) return;
        const r = vp.getBoundingClientRect();
        if (placeAt(tg, r.left + r.width / 2, r.top + r.height / 2)) { render(); announce(tg); }
      };
      const precision = S.mx.precision[tg.key] || (tg.pair.en && tg.pair.en.mapPrecision) || "exact";
      return h("div", { key: "card" },
        h("p", { className: "cc-mx-t" }, nameOf(tg.kind, tg.id)),
        h("p", { className: "cc-mx-m" }, [kindName(tg.kind), targetMeta(tg)].filter(Boolean).join(" · ")),
        planar ? h("p", { className: "cc-tl-hint" }, t("taller.planarPlace")) : null,
        h("p", { className: "cc-mx-pos" }, cur ? h("b", { className: "cc-tl-coord" }, fmtPoint(cur)) : null, h("span", { className: cls("cc-mx-src", state[0]) }, state[1])),
        !cur && sug ? h("div", { className: "cc-mx-sug" }, h("p", null, suggestionText(sug), " ", precisionBadge(sug.precision)),
          h("button", { type: "button", className: "cc-btn ghost", onClick: () => useSug(sug) }, ico("target"), t("taller.useSug"))) : null,
        !cur && !sug && !planar ? h("p", { className: "cc-tl-hint" }, t(tg.kind === "event" && !(tg.pair.en || {}).locationId ? "mx.noPlaceYet" : "taller.sug.none")) : null,
        cur && placeRef && (Math.abs(placeRef.point.xp - cur.xp) + Math.abs(placeRef.point.yp - cur.yp) > 0.05) ? h("div", { className: "cc-mx-sug" }, h("p", null, suggestionText(placeRef), " ", precisionBadge(placeRef.precision)),
          h("button", { type: "button", className: "cc-btn ghost", onClick: () => useSug(placeRef) }, ico("target"), t("taller.useSugInstead"))) : null,
        planar ? null : h("div", { className: "cc-mx-xy" },
          ["x", "y"].map(axis => h("div", { className: "cc-tl-field", key: axis, style: { margin: 0 } }, h("label", { className: "cc-tl-label", htmlFor: `cc-mx-${axis}` }, t(`mx.${axis}`)),
            // Text with a decimal keypad, not type=number: a number field follows the page's locale and would drop the "."
            // of "42.5" in Spanish; here both "42.5" and "42,5" work.
            h("input", { id: `cc-mx-${axis}`, className: "cc-input", type: "text", inputMode: "decimal", autoComplete: "off", spellCheck: false, value: typed(axis),
              placeholder: "0–100", onChange: e => { S.mx.typing = { key: tg.key, axis, text: e.target.value }; setXY(axis, e.target.value); },
              onBlur: () => { if (S.mx.typing && S.mx.typing.axis === axis) { S.mx.typing = null; render(); } } })))),
        planar ? null : h("div", { className: "cc-mx-adjust" },
          h("div", { className: "cc-mx-dpad", role: "group", "aria-label": t("mx.nudgeAria") },
            iconBtn(t("mx.up"), "↑", () => nudge(tg, 0, -1, 1), { className: "cc-iconbtn sm up", disabled: !cur && !sug }),
            iconBtn(t("mx.left"), "←", () => nudge(tg, -1, 0, 1), { className: "cc-iconbtn sm left", disabled: !cur && !sug }),
            h("span", { className: "mid", "aria-hidden": "true" }, ico("crosshair")),
            iconBtn(t("mx.right"), "→", () => nudge(tg, 1, 0, 1), { className: "cc-iconbtn sm right", disabled: !cur && !sug }),
            iconBtn(t("mx.down"), "↓", () => nudge(tg, 0, 1, 1), { className: "cc-iconbtn sm down", disabled: !cur && !sug })),
          h("p", { className: "cc-mx-help", id: "cc-mx-keys" }, t(app.state.isMobile ? "mx.keysTouch" : "mx.keys"))),
        planar ? null : h("div", { className: "cc-mx-tools" },
          h("button", { type: "button", className: "cc-btn ghost", onClick: placeCenter }, ico("crosshair"), t("mx.placeCenter")),
          cur ? h("button", { type: "button", className: "cc-btn ghost", onClick: center }, ico("target"), t("mx.center")) : null,
          cur ? h("button", { type: "button", className: "cc-btn ghost", onClick: () => copyText(E.coordsText(cur)) }, ico("copy"), t("mx.copy")) : null,
          pending ? h("button", { type: "button", className: "cc-btn ghost", onClick: () => { delete S.mx.pending[tg.key]; delete S.mx.precision[tg.key]; render(); say(t("mx.resetDone")); } }, ico("undo"), t("mx.reset")) : null),
        tg.kind === "place" && !planar ? h("div", { className: "cc-tl-field" }, h("label", { className: "cc-tl-label", htmlFor: "cc-mx-prec" }, t("taller.f.mapPrecision")),
          h("span", { className: "cc-selwrap" }, h("select", { id: "cc-mx-prec", className: "cc-select", value: precision, onChange: e => { S.mx.precision[tg.key] = e.target.value; if (!S.mx.pending[tg.key] && cur) S.mx.pending[tg.key] = { ...cur }; render(); } },
            [{ value: "exact", label: t("taller.precExact") }, { value: "approximate", label: t("taller.precApprox") }].map(option))),
          h("p", { className: "cc-tl-hint" }, t("taller.placePosHint"))) : null,
        h("div", { className: "cc-mx-foot" },
          h("button", { type: "button", className: "cc-btn ghost", onClick: () => cancelMove(tg) }, t(pending ? "common.cancel" : "mx.backToList")),
          h("button", { type: "button", className: "cc-btn", disabled: !pending, onClick: () => confirmMove(tg) }, ico("check"), t("mx.confirm"))),
        h("p", { className: "cc-tl-hint", style: { marginTop: 8 } }, t("mx.confirmNote")));
    }
    function choiceList() {
      const m = model();
      return h("div", { key: "choice" }, h("p", { className: "cc-tl-hint" }, t("mx.choiceT", { count: S.mx.choice.length })),
        h("div", { className: "cc-mx-list" }, S.mx.choice.map(id => { const ev = m.eventById.get(id); return ev ? mxItem("event", ev.id, ev.title, `${t("common.session", { n: ev.session })}${ev.campaignDay != null ? " · " + app.dayText(ev) : ""}`, h("span", { className: `cc-evico sm ${app.evFamily(ev)}` }, app.evIcon(ev)), ev.hasCoords) : null; })),
        h("button", { type: "button", className: "cc-btn ghost", onClick: () => { S.mx.choice = null; render(); } }, ico("back"), t("mx.backToList")));
    }
    function mxItem(kind, id, title, meta, icon, has) {
      const pend = S.mx.pending[`${kind}:${id}`];
      return h("button", { key: id, type: "button", className: "cc-mx-item", onClick: () => goEdit(kind, id) }, icon,
        h("span", { className: "cc-mx-item-b" }, h("span", { className: "cc-mx-item-t" }, title), h("span", { className: "cc-mx-item-m" }, meta)),
        h("span", { className: cls("cc-mx-dot", pend ? "pending" : has && "has") }, ico(pend || has ? "pin" : "warn"), t(pend ? "taller.posPending" : has ? "taller.placed" : "taller.unplaced")));
    }
    function mxList() {
      const m = model(), mx = S.mx, sum = summary();
      const w = M.fold(mx.query).split(" ").filter(Boolean), ok = text => !w.length || w.every(x => M.fold(text).includes(x));
      let items;
      if (mx.listKind === "event") {
        items = m.events.filter(e => (!mx.session || String(e.session) === String(mx.session)) && ok(`${e.title} ${e.titleEn} ${e.placeLabel}`)
          && (mx.filter === "all" || (mx.filter === "without" ? !e.hasCoords : e.hasCoords))).slice().reverse()
          .map(e => mxItem("event", e.id, e.title, `${t("common.session", { n: e.session })}${e.campaignDay != null ? " · " + app.dayText(e) : ""}${e.locationId ? " · " + (m.placeById.get(e.locationId) || {}).name : ""}`, h("span", { className: `cc-evico sm ${app.evFamily(e)}` }, app.evIcon(e)), e.hasCoords));
      } else {
        items = m.places.filter(p => !p.isPlanar && ok(`${p.name} ${p.nameEn} ${p.kindLabel}`) && (mx.filter === "all" || (mx.filter === "without" ? !p.ref : !!p.ref)))
          .map(p => mxItem("place", p.id, p.name, p.kindLabel, h("span", { className: "cc-chip-ico" }, app.placeIcon(p)), !!p.ref));
      }
      const total = mx.listKind === "event" ? m.events.length : m.places.filter(p => !p.isPlanar).length;
      return h("div", { key: "list" },
        h("p", { className: "cc-tl-hint", style: { marginTop: 0 } }, t("mx.intro")),
        h("div", { className: "cc-seg cc-mx-seg", role: "group", "aria-label": t("mx.listAria") }, ["event", "place"].map(k => h("button", { key: k, type: "button", className: mx.listKind === k ? "is-on" : "", "aria-pressed": mx.listKind === k ? "true" : "false",
          onClick: () => { mx.listKind = k; render(); } }, t(k === "event" ? "mx.listEvents" : "mx.listPlaces")))),
        h("div", { className: "cc-search", style: { marginBottom: 8 } }, h("span", { className: "cc-search-ico" }, ico("search")),
          h("input", { className: "cc-input", type: "search", value: mx.query, placeholder: t(mx.listKind === "event" ? "taller.searchEvents" : "taller.searchPlaces"), "aria-label": t(mx.listKind === "event" ? "taller.searchEvents" : "taller.searchPlaces"),
            onChange: e => { mx.query = e.target.value; render(); }, autoComplete: "off" })),
        mx.listKind === "event" ? h("span", { className: "cc-selwrap", style: { marginBottom: 8 } }, h("select", { className: "cc-select", value: mx.session, "aria-label": t("taller.f.session"), onChange: e => { mx.session = e.target.value; render(); } },
          [{ value: "", label: t("mx.allSessions") }, ...sessionOptions()].map(option))) : null,
        h("div", { className: "cc-seg", role: "group", "aria-label": t("taller.f.position"), style: { display: "flex", margin: "0 0 6px" } }, ["all", "without", "with"].map(f => h("button", { key: f, type: "button", style: { flex: 1, justifyContent: "center" },
          className: mx.filter === f ? "is-on" : "", "aria-pressed": mx.filter === f ? "true" : "false", onClick: () => { mx.filter = f; render(); } }, t(f === "all" ? "mx.filterAll" : f === "without" ? "mx.filterWithout" : "mx.filterWith")))),
        h("p", { className: "cc-tl-count", role: "status" }, t("mx.count", { count: items.length, total })),
        items.length ? h("div", { className: "cc-mx-list" }, items) : h("p", { className: "cc-tl-empty" }, t("taller.noneFound")),
        h("p", { className: "cc-tl-hint" }, t("taller.draftCount", { count: sum.total }), " · ", h("a", { className: "cc-a", href: tabHref("draft") }, t("taller.reviewExport"))));
    }

    // ── Integration with the page ───────────────────────────────────────────
    function onRoute(prev, r) {
      const changed = !prev || routeHash(prev) !== routeHash(r);
      if (r.section === "taller" && changed) {
        S.ui.preview = false;
        if (prev && prev.section === "taller" && !S.ui.focusNext) S.ui.focusHead = true;
        if (app._mainEl && prev && prev.section === "taller") app._mainEl.scrollTop = 0;
        if (r.kind === "tab" && r.id === "draft") { refreshPublished(); loadBackups(); }
      }
      // On phones the sheet starts compact once something is chosen: the map stays free to tap.
      if (isMapEdit(r) && changed) { S.mx.choice = null; S.mx.drag = null; S.mx.sheetMin = !!r.id && app.state.isMobile; }
      render();
    }
    function handleKey(e, typing) {
      const r = app.state.route;
      if (S.ui.dialog) {
        if (e.key === "Escape") { e.preventDefault(); closeDialog(); return true; }
        if (e.key === "Tab") { trapTab(e); return true; }
        return false;
      }
      if (e.key !== "Escape") return false;
      if (isMapEdit(r)) {
        const tg = mxTarget();
        if (tg && !tg.missing && S.mx.pending[tg.key]) { e.preventDefault(); cancelMove(tg); return true; }
        if (S.mx.choice) { S.mx.choice = null; render(); return true; }
        if (tg) { e.preventDefault(); app.navigate("#/map/edit", { replace: true }); return true; }
        e.preventDefault(); app.navigate(exitHref()); return true;
      }
      if (r.section === "taller") {
        if (!app.state.isWide && S.ui.preview) { e.preventDefault(); closePreview(); return true; }
        return !typing;                                       // a form is never closed by Esc (nothing is lost, but nothing surprises)
      }
      return false;
    }
    const isDirty = () => !!S.draft && (S.pendingSave || S.save === "error" || S.save === "saving" || S.save === "conflict" || Object.keys(S.mx.pending).length > 0
      || (S.storeKind === "memory" && summary().total > 0));
    function dispose() {
      clearTimeout(S.saveTimer); clearTimeout(S.settleTimer); clearTimeout(S.flashTimer); clearTimeout(sayTimer);
      if (S.pendingSave) flush();
      try { if (S.bc) S.bc.close(); } catch (e) { /* closing is best effort */ }
    }

    init().catch(err => { S.loaded = true; S.storeError = String((err && err.message) || err); S.draft = S.draft || E.emptyDraft(pub()); S.settled = S.draft; S.save = "error"; S.saveError = S.storeError; render(); });
    return { render: renderPage, preview, mapEvents, mapLayer, mapPanel, mapClick, mapPointerDown, pickFromMap, mapFocus, mapHint, exitHref, onRoute, handleKey, isDirty, dispose,
      // for the browser tests (read-only views of the state)
      _debug: () => ({ draft: S.draft, pending: { ...S.mx.pending }, save: S.save, storeKind: S.storeKind, savedRev: S.savedRev }) };
  }

  root.ChronicleTaller = { create };
})(typeof self !== "undefined" ? self : this);
