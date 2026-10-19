#!/usr/bin/env node
// Incorporates a draft exported from the Taller del Cronista into data/*.json — the safe way to publish the DM's
// work. The draft (cambios.json, inside the exported ZIP) holds only the records the DM touched, each with the
// published version it was edited from, so it is applied to the CURRENT files: records the draft does not touch
// stay exactly as they are now (even if they changed after the export), every file keeps its own JSON layout,
// and a change whose record was modified here meanwhile is reported as a conflict instead of overwriting it.
//
//   node tools/apply-draft.js <cambios.json | package.zip> [--check] [--force] [--data <folder>]
//     --check   report what would change, write nothing
//     --force   apply conflicting changes too (the draft's version wins) — only after reading the report
//     --data    the data folder to update (default: the repository's data/)
//
// Then run `npm test` (or at least `node tools/validate-data.js`) and review the diff before committing.
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Editor = require("../js/chronicle-editor.js");

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const valueOf = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const input = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--data");
const DATA = path.resolve(valueOf("--data") || path.join(__dirname, "..", "data"));
if (!input) { console.error("usage: node tools/apply-draft.js <cambios.json | package.zip> [--check] [--force] [--data <folder>]"); process.exit(1); }

(async () => {
  // The draft: a JSON file, or the exported ZIP (its cambios.json).
  let text;
  const bytes = fs.readFileSync(path.resolve(input));
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = await Editor.unzip(bytes, { inflateRaw: data => zlib.inflateRawSync(data) });
    const entry = entries.find(e => /(^|\/)cambios\.json$/.test(e.name)) || entries.find(e => /\.json$/.test(e.name) && /chronicle-taller-draft/.test(Buffer.from(e.data).toString("utf8")));
    if (!entry) { console.error("The ZIP has no cambios.json (the draft exported by the Taller)."); process.exit(1); }
    text = Buffer.from(entry.data).toString("utf8");
  } else text = bytes.toString("utf8");
  const parsed = Editor.parseDraft(text);
  if (parsed.error) { console.error(`Not a Taller draft (${parsed.error}${parsed.detail ? `: ${parsed.detail}` : ""}).`); process.exit(1); }
  parsed.skipped.forEach(s => console.warn(`  ! skipped malformed change ${s.kind} "${s.id}" (${s.reason})`));
  let draft = parsed.draft;

  // The current published data.
  const read = (rel, fb) => { const f = path.join(DATA, rel); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fb; };
  const raw = { characters: read("characters.json", []), routes: read("routes.json", {}), events: read("events.json", []), sessions: read("sessions.json", {}),
    quests: read("quests.json", []), npcs: read("npcs.json", []), locations: read("locations.json", []), lore: read("lore.json", null) };
  const content = read(path.join("i18n", `${Editor.LOCALE}.json`), {});
  const base = { raw, content };

  const sum = Editor.summarize(draft);
  console.log(`Draft ${draft.id} · ${sum.total} change(s): ${sum.added.length} new, ${sum.modified.length} modified, ${sum.deleted.length} deleted`);
  const changed = Editor.changedFiles(base, draft);
  if (changed.length) console.log(`  · published since the draft started: ${changed.join(", ")} (records the draft does not touch keep their current version)`);
  // Changes the data already holds (this draft, or an earlier export of it, was incorporated): nothing to do.
  const done = Editor.publishedChanges(base, draft);
  if (done.length) {
    console.log(`  · already in the data: ${done.length} change(s) — ${done.slice(0, 6).map(c => `${c.kind} "${c.id}"`).join(", ")}${done.length > 6 ? ", …" : ""}`);
    draft = Editor.dropPublished(base, draft);
  }

  const conflicts = Editor.conflicts(base, draft);
  if (conflicts.length) {
    console.log(`\n${conflicts.length} conflict(s) — these records changed here after the DM started editing them:`);
    conflicts.forEach(c => {
      const fields = c.fields.filter(f => f.byMe || f.upstream).map(f => `${f.lang}.${f.field}${f.clash ? " (both)" : f.byMe ? " (draft)" : " (here)"}`);
      console.log(`  ✗ ${c.kind} "${c.id}": ${c.type === "taken" ? "a new record with this id was published meanwhile" : c.type === "removed" ? "deleted here meanwhile" : fields.join(", ")}`);
    });
    if (!flag("--force")) { console.log("\nNothing written. Resolve them in the Taller (import the draft, then Borrador → Conflictos) or re-run with --force to let the draft win."); process.exit(2); }
    conflicts.forEach(c => { draft = Editor.resolveConflict(base, draft, c.kind, c.id, "mine"); });
    console.log("  --force: the draft's version wins for these records.");
  }

  const v = Editor.validate(base, draft, { assets: assetList() });
  v.errors.forEach(i => console.error(`  ✗ ${describe(i)}`));
  v.warnings.forEach(i => console.warn(`  ! ${describe(i)}`));
  if (!v.ok) { console.error(`\n${v.errors.length} error(s): nothing written. Fix them in the Taller and export again.`); process.exit(1); }

  const files = Editor.exportFiles(base, draft);
  if (!files.length) { console.log("\nNothing to change: the data already holds this draft."); return; }
  files.forEach(f => {
    const rel = f.file === "content" ? path.join("i18n", `${Editor.LOCALE}.json`) : `${f.file}.json`;
    console.log(`  ${flag("--check") ? "would write" : "writes"} ${path.join(path.relative(process.cwd(), DATA) || ".", rel)}`);
    if (!flag("--check")) { fs.mkdirSync(path.dirname(path.join(DATA, rel)), { recursive: true }); fs.writeFileSync(path.join(DATA, rel), f.text); }
  });
  console.log(flag("--check") ? "\nCheck only: nothing written." : "\nDone. Now run `npm test` and review the diff (git diff data/) before committing.");
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });

function assetList() {
  const dir = path.join(__dirname, "..", "assets");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).map(f => `assets/${f}`) : undefined;
}
function describe(i) {
  if (i.code === "model") return i.params.msg;
  const p = Object.entries(i.params || {}).filter(([k]) => k !== "refs").map(([k, x]) => `${k}=${x}`).join(" ");
  const refs = i.params && i.params.refs ? ` ← ${i.params.refs.map(r => `${r.kind} ${r.id}`).join(", ")}` : "";
  return `${i.kind} "${i.id}"${i.field ? ` · ${i.field}` : ""}: ${i.code}${p ? ` (${p})` : ""}${refs}`;
}
