// ── Chronicle i18n ──────────────────────────────────────────────────────────
// Centralized translation for the interface. Dictionaries live in locales/<code>.js
// (one file per language, loaded by plain <script> tags so the very first paint —
// the loading and error messages — is already translated) and register themselves
// here. Narrative content translations are separate: data/i18n/<code>.json, applied
// by ChronicleModel.build().
//
//   const t = ChronicleI18n.createTranslator("es-AR");
//   t("nav.quests")                        → "Misiones"
//   t("chronicle.resultsAll", {count: 3})  → "3 acontecimientos"   (plural forms: one/other)
//
// Missing keys fall back to English; tests/ checks that every locale has every key.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChronicleI18n = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LOCALES = [
    { code: "es-AR", short: "ES", name: "Español", htmlLang: "es-AR" },
    { code: "en",    short: "EN", name: "English", htmlLang: "en" },
  ];
  const DEFAULT_LOCALE = "es-AR";
  const FALLBACK_LOCALE = "en";
  const STORAGE_KEY = "chronicle-lang";
  const dicts = {};

  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  const isLocale = code => LOCALES.some(l => l.code === code);
  const get = (o, path) => String(path).split(".").reduce((a, k) => (isObj(a) ? a[k] : undefined), o);

  function register(code, dict) { dicts[code] = dict; return dict; }
  // A dictionary loaded later (locales/taller.<code>.js, only when the Taller opens): merged into the registered
  // one in place, so translators created before it find its keys (they read their dictionaries by reference).
  function extend(code, dict) {
    const target = dicts[code] || (dicts[code] = {});
    const deep = (to, from) => Object.keys(from || {}).forEach(k => {
      const v = from[k];
      if (isObj(v) && !isPlural(v) && isObj(to[k]) && !isPlural(to[k])) deep(to[k], v); else to[k] = v;
    });
    deep(target, dict);
    return target;
  }
  function resolveLocale(stored) { return isLocale(stored) ? stored : DEFAULT_LOCALE; }

  // Saved preference → locale (default es-AR). Storage failures are non-fatal.
  function loadLocale(storage) {
    try { return resolveLocale(storage && storage.getItem(STORAGE_KEY)); } catch (e) { return DEFAULT_LOCALE; }
  }
  function saveLocale(storage, code) {
    try { if (storage && isLocale(code)) storage.setItem(STORAGE_KEY, code); } catch (e) {}
  }

  // Deep merge: `over` wins, missing/empty values come from `base` (used for the template dictionary).
  function merge(base, over) {
    if (!isObj(base)) return over === undefined || over === "" ? base : over;
    const out = { ...base };
    Object.keys(over || {}).forEach(k => {
      const v = over[k];
      if (v === undefined || v === "") return;
      out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
    });
    return out;
  }

  // Plural forms: an object whose keys are only CLDR categories (so a vocabulary with an
  // "other" entry, like eventType.other, is not mistaken for one).
  const PLURAL_KEYS = ["zero", "one", "two", "few", "many", "other"];
  const isPlural = v => isObj(v) && typeof v.other === "string" && Object.keys(v).every(k => PLURAL_KEYS.includes(k));

  function createTranslator(locale, opts) {
    const d = (opts && opts.dicts) || dicts;
    const code = isLocale(locale) || d[locale] ? locale : DEFAULT_LOCALE;
    const primary = d[code] || {}, fallback = d[FALLBACK_LOCALE] || {};
    const rules = typeof Intl !== "undefined" && Intl.PluralRules ? new Intl.PluralRules(code) : null;
    const missing = new Set();
    function pick(key) {
      const v = get(primary, key);
      if (v !== undefined && v !== "") return v;
      const fb = get(fallback, key);
      if (fb === undefined && !missing.has(key)) { missing.add(key); if (typeof console !== "undefined") console.warn(`[i18n] missing key "${key}"`); }
      return fb;
    }
    function t(key, params) {
      let v = pick(key);
      if (v == null) return "";
      if (isPlural(v)) {
        const n = params && typeof params.count === "number" ? params.count : 0;
        const cat = rules ? rules.select(n) : (n === 1 ? "one" : "other");
        v = typeof v[cat] === "string" ? v[cat] : v.other;
      }
      if (typeof v !== "string") return v;           // arrays (month names) are returned as-is
      return params ? v.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m)) : v;
    }
    t.locale = code;
    t.dict = merge(fallback, primary);               // nested strings for {{ t.x.y }} in the template
    t.meta = LOCALES.find(l => l.code === code) || { code, short: code, name: code, htmlLang: code };
    return t;
  }

  // All dotted keys of a dictionary (tests use this to compare locales).
  function keysOf(dict, prefix) {
    return Object.keys(dict || {}).flatMap(k => {
      const v = dict[k], p = prefix ? `${prefix}.${k}` : k;
      return isObj(v) && !isPlural(v) ? keysOf(v, p) : [p];
    });
  }

  return { LOCALES, DEFAULT_LOCALE, FALLBACK_LOCALE, STORAGE_KEY, dicts, register, extend, createTranslator,
    resolveLocale, loadLocale, saveLocale, isLocale, keysOf, merge, get };
});
