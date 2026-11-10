#!/usr/bin/env node
// Build src/data/venues.json — conference names and acronyms mapped to dblp
// venue series — from the dblp XML dump (CC0, https://dblp.org/xml/).
//
//   curl -O https://dblp.org/xml/dblp.xml.gz -O https://dblp.org/xml/dblp.dtd
//   node scripts/build-venues.mjs dblp.xml.gz dblp.dtd [out.json]
//
// The index only states positive identity: a key is kept only when it points
// to exactly one series, so the app can trust "same series" and "different
// series" alike. Workshops, Findings, companion volumes, … get their own
// series so they never match the main conference.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { venueNameKey, venueQualifier, venueTokens } from "../src/lib/severity.js";

const [, , xmlPath, dtdPath, outArg] = process.argv;
if (!xmlPath || !dtdPath) {
  console.error("usage: node scripts/build-venues.mjs dblp.xml.gz dblp.dtd [out.json]");
  process.exit(1);
}
const outPath = outArg || new URL("../src/data/venues.json", import.meta.url).pathname;

// Named entities (&uuml; …) are defined in the DTD as numeric references.
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
for (const m of fs.readFileSync(dtdPath, "utf8").matchAll(/<!ENTITY\s+(\w+)\s+"&#(\d+);"\s*>/g))
  entities[m[1]] = String.fromCodePoint(Number(m[2]));
const decode = (s) => s
  .replace(/<[^>]+>/g, "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(\w+);/g, (m, n) => entities[n] ?? m);

// Minimum uses before a booktitle counts as an acronym of its series (filters typos).
const MIN_ACRONYM_USES = 3;
// Share of an acronym's uses its main series must have for the acronym to be kept.
const DOMINANT_SHARE = 0.95;

const nameSeries = new Map();     // name key -> Set(series)
const acronymUses = new Map();    // acronym key -> Map(series -> count)

function add(map, key, series) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(series);
}

const acronymEntries = new Map(); // "acronym\tstream\tqualifier" -> uses
const nameEntries = [];           // [proceedings title, stream, qualifier]
const streamsWithMain = new Set();

const seriesOf = (stream, qualifier) => qualifier ? `${stream}#${qualifier}` : stream;

// "ICDE", "SIGMOD Conference", "ACL (1)", "ICDE Workshops" -> acronym key, or null.
function acronymKey(booktitle) {
  const q = venueQualifier(booktitle);
  const cleaned = booktitle
    .replace(/\(\s*\d+\s*\)/g, " ")
    .replace(/\b(Conference|Workshops?|Findings|Companion|Adjunct|Demos?|Posters?)\b/gi, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .trim();
  // Only single acronym-like tokens: "ICDE", "NeurIPS", "SoCG", "EDBT".
  if (!/^[A-Za-z][A-Za-z0-9&-]*$/.test(cleaned) || !/[A-Z].*[A-Z]/.test(cleaned)) return null;
  const k = cleaned.toLowerCase().replace(/[^a-z0-9&]/g, "");
  if (k.length < 2) return null;
  return q ? `${k}#${q}` : k;
}

// Name variants a proceedings title yields: the whole title, each side of a
// colon ("FAT* '20: Conference on Fairness, Accountability, and Transparency,
// Barcelona, …"), and each comma-prefix of those (the name ends somewhere
// before the place and date). Short prefixes are too generic to keep.
function nameVariants(title) {
  const out = new Set([title]);
  for (const part of title.split(/:\s+/)) {
    const segs = part.split(",");
    for (let k = 1; k <= segs.length; k++) out.add(segs.slice(0, k).join(","));
  }
  return [...out].filter(v => venueTokens(v).words.length >= 3 || v === title);
}

function addName(title, series) {
  for (const v of nameVariants(title)) {
    // Both key forms the app looks up: with sorted organizers, and words only.
    add(nameSeries, venueNameKey(v), series);
    add(nameSeries, venueTokens(v).words.join(" "), series);
  }
}

let rec = null, records = 0;
const input = fs.createReadStream(xmlPath).pipe(zlib.createGunzip());
const lines = readline.createInterface({ input, crlfDelay: Infinity });

for await (const line of lines) {
  const open = line.match(/<(proceedings|inproceedings)\s[^>]*key="(conf\/[^"]+)"/);
  if (open) rec = { type: open[1], key: open[2], title: null, booktitle: null };
  if (!rec) continue;
  const t = line.match(/<title>(.*)<\/title>/);
  if (t && rec.title === null) rec.title = decode(t[1]);
  const b = line.match(/<booktitle>(.*)<\/booktitle>/);
  if (b && rec.booktitle === null) rec.booktitle = decode(b[1]);
  if (!line.includes(`</${rec.type}>`)) continue;

  const stream = rec.key.split("/").slice(0, 2).join("/");
  const bq = venueQualifier(rec.booktitle || "");
  if (rec.booktitle) {
    const ak = acronymKey(rec.booktitle);
    if (ak) {
      const k = `${ak}\t${stream}\t${bq || ""}`;
      acronymEntries.set(k, (acronymEntries.get(k) || 0) + 1);
    }
  }
  if (rec.type === "proceedings" && rec.title) {
    // A proceedings title may carry the qualifier ("…Data Engineering Workshops").
    const q = bq || venueQualifier(rec.title.split(",")[0]);
    nameEntries.push([rec.title, stream, q]);
    if (!q) streamsWithMain.add(stream);
  }
  rec = null;
  if (++records % 500000 === 0) console.error(`${records} records…`);
}

// A qualifier splits off its own series only where the dblp series also holds
// the main event; a workshop with its own series (conf/gebnlp) stays whole.
const finalSeries = (stream, q) => seriesOf(stream, q && streamsWithMain.has(stream) ? q : null);
for (const [k, n] of acronymEntries) {
  const [ak, stream, q] = k.split("\t");
  const s = finalSeries(stream, q || null);
  if (!acronymUses.has(ak)) acronymUses.set(ak, new Map());
  const m = acronymUses.get(ak);
  m.set(s, (m.get(s) || 0) + n);
}
for (const [title, stream, q] of nameEntries) addName(title, finalSeries(stream, q));

// Keep only unambiguous keys, and number the series to keep the file small.
const seriesIds = new Map();
const idOf = (s) => {
  if (!seriesIds.has(s)) seriesIds.set(s, seriesIds.size);
  return seriesIds.get(s);
};
const names = {}, acronyms = {};
let ambiguousNames = 0, ambiguousAcronyms = 0;
for (const [key, set] of nameSeries) {
  if (key.split(" ").length < 2) continue;  // one-word names are too generic to identify a venue
  if (set.size === 1) names[key] = idOf([...set][0]);
  else ambiguousNames++;
}
for (const key of (process.env.VENUE_DEBUG || "").split(",").filter(Boolean))
  console.error("debug", key, JSON.stringify([...(acronymUses.get(key) || [])]));
for (const [key, uses] of acronymUses) {
  // One series must account for nearly all uses; a few stray papers in another
  // series ("ICML" once in conf/imcl) are dblp typos, a real split (ITCS) is ambiguous.
  const total = [...uses.values()].reduce((a, b) => a + b, 0);
  const [top, n] = [...uses].sort((x, y) => y[1] - x[1])[0];
  if (n >= MIN_ACRONYM_USES && n / total >= DOMINANT_SHARE) acronyms[key] = idOf(top);
  else if (n >= MIN_ACRONYM_USES) ambiguousAcronyms++;
}

const out = {
  source: "dblp (CC0 1.0), https://dblp.org/xml/",
  built: new Date().toISOString().slice(0, 10),
  series: [...seriesIds.keys()],
  names,
  acronyms,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));
console.error(`records: ${records}; series: ${out.series.length}; names: ${Object.keys(names).length} ` +
  `(ambiguous dropped: ${ambiguousNames}); acronyms: ${Object.keys(acronyms).length} ` +
  `(ambiguous dropped: ${ambiguousAcronyms}); ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB -> ${outPath}`);
