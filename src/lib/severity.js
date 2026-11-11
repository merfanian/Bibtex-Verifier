// Triage field differences: which ones are cosmetic (formatting, venue
// spelled differently, preprint year) and which ones need the user's eyes
// (different authors, conflicting DOI, a different venue, …).
import { stripLatex } from "./latex.js";
import { VENUE_ABBREVIATIONS } from "./venues.js";

export const SEVERITY = {
  MINOR: "minor",        // same information, written differently
  ENRICHMENT: "enrichment", // a field only the database has
  MAJOR: "major",        // the values disagree; the user should look
};

const RANK = { minor: 0, enrichment: 1, major: 2 };

// ─── Shared normalization ────────────────────────────────────────────
// LaTeX letters and accent commands stripLatex doesn't cover: `{\'\i}`, `{\i}`, `\o`, `\_`.
const LATEX_LETTERS = { i: "i", j: "j", o: "o", O: "o", l: "l", L: "l", ss: "ss", ae: "ae", AE: "ae", oe: "oe", aa: "a" };

const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function fold(s) {
  const pre = String(s ?? "")
    // CrossRef titles arrive HTML-escaped ("Data &amp; Knowledge Engineering").
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => HTML_ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\\([`'"^~=.]|[uvHc](?![a-zA-Z]))\s*/g, "")  // accent commands: keep the letter
    .replace(/\\(ss|ae|AE|oe|aa|[ijoOlL])(?![a-zA-Z])\s*/g, (_, l) => LATEX_LETTERS[l])
    .replace(/\\([_&%$#])/g, "$1")
    .replace(/['’`]/g, "");                                // O'Brien, Daum'e
  return stripLatex(pre)
    // Letters NFD doesn't decompose: Turkish ı, Polish ł, Nordic ø, đ.
    .replace(/ı/g, "i").replace(/[łŁ]/g, "l").replace(/[øØ]/g, "o").replace(/[đĐ]/g, "d")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Lowercase, accent- and LaTeX-free, punctuation collapsed to single spaces. */
export function looseText(s) {
  return fold(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const minor = (reason) => ({ severity: SEVERITY.MINOR, reason });
const major = (reason) => ({ severity: SEVERITY.MAJOR, reason });
// Not worth a review, but the database is the likelier one to be wrong: keep the user's value.
const keepYours = (reason) => ({ severity: SEVERITY.MINOR, reason, prefer: "original" });

// ─── Authors ─────────────────────────────────────────────────────────
const ETAL_RE = /^(others|et al\.?)$/i;
export const NO_COMMON_AUTHORS = "no author in common with the database record";
export const PUBLISHED_VERSION = "published version available";
export const VENUE_UNCONFIRMED_PREPRINT = "venue not confirmed (database only has the preprint)";
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/** Split a BibTeX author string into `{ last, tokens }` per person. */
export function parseAuthors(authorStr) {
  const people = [];
  let truncated = false;
  for (let part of String(authorStr ?? "").split(/\s+and\s+/i)) {
    part = part.trim();
    if (!part) continue;
    if (ETAL_RE.test(part.replace(/[{}]/g, ""))) { truncated = true; continue; }
    let last, first;
    if (part.includes(",")) {
      // "Last, First" or BibTeX's three-part "Last, Jr, First" (the middle part is the suffix).
      const pieces = part.split(",");
      last = pieces[0];
      first = pieces.length >= 3 ? pieces.slice(2).join(",") : pieces[1];
    } else {
      const t = part.split(/\s+/);
      while (t.length > 1 && NAME_SUFFIXES.has(looseText(t[t.length - 1]))) t.pop();
      last = t[t.length - 1];
      first = t.slice(0, -1).join(" ");
    }
    const lastTokens = looseText(last).split(" ").filter(w => w && !NAME_SUFFIXES.has(w));
    const firstTokens = looseText(first).split(" ").filter(w => w && !NAME_SUFFIXES.has(w));
    people.push({
      // Compound surnames ("van der Maaten") compare on their final word.
      last: lastTokens[lastTokens.length - 1] || "",
      tokens: new Set([...lastTokens, ...firstTokens]),
      given: givenNames(first),
    });
  }
  return { people, truncated };
}

// Same person if either side's surname appears among the other's name
// words — tolerates "Last, First" vs "First Last" and swapped name order.
function samePerson(a, b) {
  if (!a.last || !b.last) return false;
  if (a.last === b.last) return initialsCompatible(a, b);
  // Swapped name order ("Lim, Yao Chong" vs "Chong, Lim-Yao"): every name word must match.
  return b.tokens.has(a.last) && a.tokens.has(b.last) &&
    [...a.tokens].every(t => b.tokens.has(t) || [...b.tokens].some(u => u[0] === t[0]));
}

/**
 * Given names as `{ words, initialOnly }`: `words` are lowercase given names,
 * and `initialOnly[i]` marks those written as an initial ("J.", "A C", "HV"
 * which is two initials). Suffixes ("Jr.") are dropped.
 */
function givenNames(first) {
  const words = [], initialOnly = [];
  const raw = String(first ?? "").replace(/[{}]/g, "");
  for (const tok of raw.split(/\s+/).filter(Boolean)) {
    const plain = looseText(tok).replace(/ /g, "");
    if (!plain || NAME_SUFFIXES.has(plain)) continue;
    const letters = tok.replace(/[^\p{L}]/gu, "");
    // "H.V.", "HV", "AC", "W-L", "J.-P.": dotted, hyphenated or all-capital
    // short tokens are initials, one per letter.
    const pieces = tok.split(/[.\-‐–]+/).filter(Boolean);
    if (/^(\p{Lu}\.)+\p{Lu}?\.?$/u.test(tok) || (/^\p{Lu}{2,3}$/u.test(letters) && letters === tok) ||
        (pieces.length > 1 && pieces.every(p => /^\p{Lu}$/u.test(p)))) {
      for (const ch of plain) { words.push(ch); initialOnly.push(true); }
      continue;
    }
    // "Wen-Yue" stays one given name ("wenyue"), matching "Wenyue".
    words.push(plain);
    initialOnly.push(plain.length === 1);
  }
  return { words, initialOnly };
}

// Same surname is not enough: "Zhang, Wei" is not "Zhang, Yongfeng", and
// "Smith, John" is not "Smith, James". The first given name must agree: by
// initial when either side abbreviates it, in full when both spell it out.
function initialsCompatible(a, b) {
  const ga = a.given, gb = b.given;
  if (!ga.words.length || !gb.words.length) return true;
  const [x, y] = [ga.words[0], gb.words[0]];
  if (ga.initialOnly[0] || gb.initialOnly[0]) return x[0] === y[0];
  if (x === y) return true;
  // Databases often shorten given names ("Kai" for "Kaichao", "Xiao" for
  // "Xiao-Jun", "Harri" for "Harrison"); a shared prefix of 3+ letters is the
  // same name, while "John"/"James" or "Yuanzhi"/"Yuan-Fang" are not.
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && long.startsWith(short);
}

/**
 * True when two author lists name the same people in the same order (name
 * formatting aside). A list ending in "and others" agrees with any list it is
 * a prefix of.
 */
export function authorListsAgree(a, b) {
  const pa = parseAuthors(a), pb = parseAuthors(b);
  if (!pa.people.length && !pb.people.length) return true;
  const n = Math.min(pa.people.length, pb.people.length);
  if (pa.people.length !== pb.people.length) {
    const shorter = pa.people.length < pb.people.length ? pa : pb;
    if (!shorter.truncated) return false;
  }
  for (let i = 0; i < n; i++) if (!samePerson(pa.people[i], pb.people[i])) return false;
  return true;
}

function classifyAuthors(orig, found) {
  const o = parseAuthors(orig), f = parseAuthors(found);
  if (!o.people.length || !f.people.length) return major("authors differ");

  // Match greedily in order; unmatched people on either side are real differences.
  const used = new Set();
  let matched = 0, inOrder = true, lastIdx = -1;
  for (const p of o.people) {
    const j = f.people.findIndex((q, k) => !used.has(k) && samePerson(p, q));
    if (j === -1) continue;
    used.add(j); matched++;
    if (j < lastIdx) inOrder = false;
    lastIdx = j;
  }
  const missingFromYours = f.people.length - matched;
  const notInRecord = o.people.length - matched;

  if (notInRecord > 0)
    return major(notInRecord === o.people.length
      ? NO_COMMON_AUTHORS
      : `${notInRecord} of your authors ${notInRecord === 1 ? "is" : "are"} not in the database record`);
  if (missingFromYours > 0 && !o.truncated)
    return major(`${missingFromYours} author${missingFromYours === 1 ? "" : "s"} missing from your entry`);
  // "…and others" is formatting only if your authors are the start of the full list.
  if (o.truncated && !o.people.every((p, i) => f.people[i] && samePerson(p, f.people[i])))
    return major("your authors aren't the first authors of the database record");
  // A different first author changes how the paper is cited; a reshuffle
  // further down is more often the database's mistake than the user's.
  if (!inOrder) return samePerson(o.people[0], f.people[0])
    ? keepYours("later authors in a different order")
    : major("different first author");
  return minor(missingFromYours ? "full author list (yours is truncated)" : "name formatting");
}

// ─── Venues ──────────────────────────────────────────────────────────
// Matching is deliberately strict: a fabricated venue must never pass as
// "written differently". Two names are the same venue only on positive
// evidence (dblp, exact core name, full abbreviation, or an acronym that
// accounts for every content word); anything else is a different venue.

const VENUE_STOPWORDS = new Set(["of", "the", "on", "and", "in", "for", "at", "a", "an", "to", "its"]);
// Words that never distinguish one venue from another.
const VENUE_FILLER = new Set([
  "proceedings", "proc", "annual", "international", "intl", "conference", "conf", "symposium", "symp",
  "papers", "volume", "vol", "part", "long", "short", "main", "track", "edition", "meeting",
]);
// Organizers: may be missing on one side, but two different ones conflict.
const VENUE_ORGS = new Set(["ieee", "acm", "cvf", "usenix", "siam", "ifip", "ifaai", "springer", "sigplan", "sigops", "sigarch"]);
// Organizer acronyms that say nothing about which venue it is.
const ORG_ACRONYMS = new Set([...VENUE_ORGS, "lncs", "ccis", "ceur", "lipics", "pmlr", "ws"]);

const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d/i;

/**
 * The name part of a venue. In dblp-style proceedings titles
 * ("…Computational Geometry, Waterloo, Ontario, Canada, June 8-10, 1987")
 * everything after the first comma is edition, place and date.
 */
function venueMain(v) {
  let s = String(v ?? "").replace(/\((print|online|electronic|e-?only)\)/gi, " ");
  // "…Conference on Big Data (Big Data)": the parenthetical only repeats the name.
  const paren = s.match(/\(([^()]+)\)\s*$/);
  if (paren && looseText(s.slice(0, paren.index)).includes(looseText(paren[1]))) s = s.slice(0, paren.index);
  // Cut at the first comma-segment carrying a year or date ("…, ACL 2020, Online,
  // July 5-10, 2020"); segments before it are part of the name ("AI, Ethics, and Society").
  const parts = s.split(",");
  const dated = parts.findIndex((p, i) => i > 0 && (/\b(19|20)\d{2}\b/.test(p) || MONTH_RE.test(p)));
  return dated > 0 ? parts.slice(0, dated).join(",") : s;
}

const QUALIFIERS = [
  [/\bworkshops?\b/, "workshop"],
  [/\bfindings\b/, "findings"],
  [/\bcompanion\b/, "companion"],
  [/\badjunct\b/, "adjunct"],
  [/\b(demos?|demonstrations?)\b/, "demo"],
  [/\bposters?\b/, "poster"],
  [/\bdoctoral\b/, "doctoral"],
  [/\btutorials?\b/, "tutorial"],
  [/\bstudent\b/, "student"],
  [/\bextended abstracts\b/, "abstracts"],
];

/**
 * Satellite-event qualifier of a venue ("workshop", "findings", "companion",
 * …) or null. A workshop or Findings volume is a different venue from the
 * main conference even when dblp files them under the same series.
 */
export function venueQualifier(v) {
  const raw = String(v ?? "").replace(/[{}]/g, "").replace(/[\s,.;:)]*((19|20)\d{2})?[\s,.;:)]*$/, "");
  // A conference's satellite workshops ("ICDE Workshops", "…Conference on Data
  // Mining Workshop") differ from a standalone workshop ("Workshop on …").
  if (/\bworkshops\b/i.test(raw) || /\b(conference|symposium)\b.*\bworkshop$/i.test(raw))
    return "workshops";
  const acrWorkshop = raw.match(/^\s*([A-Z][A-Za-z]*[A-Z][A-Za-z]*)\s+workshop$/i);
  if (acrWorkshop && venueIndex?.acronyms[`${acrWorkshop[1].toLowerCase()}#workshops`] !== undefined)
    return "workshops";
  const t = looseText(v);
  for (const [re, q] of QUALIFIERS) if (re.test(t)) return q;
  return null;
}

/** Content words of a venue name, without years, ordinals, numbers, filler and stopwords. */
export function venueTokens(v) {
  const words = looseText(venueMain(v))
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b\d+(st|nd|rd|th)\b/g, " ")
    .replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\w+teenth|\w+tieth|hundredth|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g, " ")
    .split(" ")
    .filter(w => w && !VENUE_STOPWORDS.has(w) && !VENUE_FILLER.has(w) && !/^\d+$/.test(w) && !/^[ivx]+$/.test(w));
  // A full name's declared acronym ("…Data Engineering (ICDE)") is compared as
  // an acronym, not as a word of the name. Capitals inside a name ("The VLDB
  // Journal") stay words.
  const acr = new Set([...declaredAcronyms(v)].filter(a => a.length >= 2));
  let named = words.filter(w => !acr.has(w) && !VENUE_ORGS.has(w));
  if (!named.length) named = words.filter(w => !VENUE_ORGS.has(w));
  const alias = VENUE_RENAMES[named.join(" ")];
  return {
    words: alias ? alias.split(" ") : named,
    orgs: new Set(words.filter(w => VENUE_ORGS.has(w))),
  };
}

// Curated renames of the same venue (core words -> canonical core words).
const VENUE_RENAMES = {
  "advances neural information processing systems": "neural information processing systems",
  "web": "world wide web",
  "world wide web web": "world wide web",
};

const orgsCompatible = (a, b) =>
  !a.size || !b.size || [...a].every(o => b.has(o)) || [...b].every(o => a.has(o));

const isPreprintVenue = (v) => /\b(arxiv|corr|preprint|biorxiv|medrxiv|ssrn)\b/.test(looseText(v))
  || looseText(v).includes("computing research repository");

// Different acronyms databases use for the same venue.
const ACRONYM_SYNONYMS = [
  ["socg", "scg"],            // Symposium on Computational Geometry
  ["neurips", "nips"],
  ["pvldb", "vldb"],
  ["kdd", "sigkdd"],
  ["cacm", "commacm"],
];

/** Explicit acronyms a venue is written with: "EDBT", "SIGMOD '19", "(ICDE)", "EthNLP@EACL". */
function explicitAcronyms(v) {
  const out = new Set();
  // "EthNLP@EACL", "DEEM@SIGMOD": the workshop is the venue, the part after "@" its host.
  const raw = String(v ?? "").replace(/[{}]/g, "").replace(/@\s*[A-Za-z][\w-]*/g, "");
  for (const m of raw.matchAll(/\b([A-Z][A-Za-z]*[A-Z][A-Za-z]*)\b/g)) {
    const t = m[1].toLowerCase();
    if (t.length >= 2 && !ORG_ACRONYMS.has(t)) out.add(t);
  }
  for (const group of ACRONYM_SYNONYMS)
    if (group.some(a => out.has(a))) group.forEach(a => out.add(a));
  return out;
}

const ACRONYM_TOKEN = /^[A-Z][A-Za-z]*[A-Z][A-Za-z]*$/;
// Words allowed next to acronyms in an acronym-only venue ("SIGMOD Conference", "ICDE Workshops").
const ACRONYM_COMPANIONS = /^(conference|conf|workshops?|proceedings|proc|findings|companion|of|the)$/i;

/** True when a venue is written as acronyms only ("ICDE", "SIGMOD '19", "EthNLP@EACL", "ICDE Workshops"). */
function isAcronymOnly(v) {
  const tokens = String(v ?? "").replace(/[{}]/g, "").replace(/['’]?\b(19|20)?\d{2}\b/g, " ")
    .split(/[\s/@:,()*–—-]+/).filter(Boolean);
  return tokens.some(t => ACRONYM_TOKEN.test(t)) &&
    tokens.every(t => ACRONYM_TOKEN.test(t) || ACRONYM_COMPANIONS.test(t));
}

/**
 * Acronyms a venue declares for itself: all of them for an acronym-only
 * venue, else a parenthesized one ("…Data Engineering (ICDE)") or a leading
 * one ("ICASSP 2022 – …", "SIGMOD '21: …").
 */
function declaredAcronyms(v) {
  if (isAcronymOnly(v)) return explicitAcronyms(v);
  const raw = String(v ?? "").replace(/[{}]/g, "");
  const out = new Set();
  for (const m of raw.matchAll(/\(\s*([A-Z][A-Za-z&]*[A-Z][A-Za-z]*)(?:\s*['’]?\s*\d{2,4})?\s*\)/g)) out.add(m[1].toLowerCase());
  const lead = raw.match(/^\s*([A-Z][A-Za-z]*[A-Z][A-Za-z]*)(?=\s*(['’]?\d{2,4}\b|:|[–—-]\s))/);
  if (lead) out.add(lead[1].toLowerCase());
  for (const x of [...out]) if (ORG_ACRONYMS.has(x)) out.delete(x);
  for (const group of ACRONYM_SYNONYMS)
    if (group.some(a => out.has(a))) group.forEach(a => out.add(a));
  return out;
}

// Words written with an abbreviation period ("Endow.", "Mach.").
function periodWords(v) {
  return new Set([...fold(v).matchAll(/([a-z]+)\./g)].map(m => m[1]));
}

// "Multimed. Tools Appl." vs "Multimedia Tools and Applications": each short
// word is a prefix of the corresponding long word, and no long word is
// skipped. A shortened word must carry a period, so "Data Mining" is not an
// abbreviation of "Database Mining". Only in a name already written in
// abbreviated style may the final period be missing ("Multimed. Tools Appl").
function isAbbreviationOf(shortWords, longWords, shortRaw) {
  if (!shortWords.length || shortWords.length !== longWords.length) return false;
  const marked = periodWords(shortRaw);
  const abbreviatedStyle = shortWords.some((w, i) => marked.has(w) && w !== longWords[i]);
  return shortWords.every((w, i) => {
    if (w === longWords[i]) return true;
    if (!longWords[i].startsWith(w)) return false;
    return marked.has(w) || (abbreviatedStyle && i === shortWords.length - 1 && w.length >= 3);
  });
}

/**
 * Whether acronym `acr` stands for the venue `name`: its letters appear in
 * order, and every content word of the name contributes its first letter
 * ("EDBT" = Extending DataBase Technology, "AISTATS", "SIGMOD" = Management Of Data).
 * Requiring every word rules out "KDD" for PAKDD or "ICML" for ICMLA.
 */
export function acronymMatches(acr, name) {
  const { words } = venueTokens(name);
  if (!words.length) return false;
  // Stopwords ("of" in SIGMOD) and organizers ("ACM" in CACM) may be used but aren't required;
  // neither is "workshop" (GEBNLP = Workshop on GEnder Bias in NLP).
  const all = looseText(venueMain(name)).replace(/\b(19|20)\d{2}\b/g, " ").split(" ")
    .filter(w => w && !/^\d/.test(w));
  const inner = explicitAcronyms(name);
  const required = new Set(words.filter(w => w !== "workshop" && w !== "workshops" && !inner.has(w)));
  const tryAcr = (a) => {
    if (a.length < 3) return false;
    // Each word may contribute a prefix of itself (at least its first letter
    // when required). Search over (letter index, word index).
    const memo = new Map();
    const go = (i, w) => {
      if (i === a.length) return all.slice(w).every(x => !required.has(x));
      if (w === all.length) return false;
      const key = i * 1000 + w;
      if (memo.has(key)) return memo.get(key);
      let ok = false;
      const word = all[w];
      // Skip an optional word.
      if (!required.has(word) && go(i, w + 1)) ok = true;
      // Use a prefix of this word: word[0..k] with letters matched in order.
      for (let k = 0, j = i; !ok && k < word.length && j < a.length; k++) {
        if (word[k] !== a[j]) { if (k === 0) break; continue; }
        j++;
        if (go(j, w + 1)) ok = true;
      }
      memo.set(key, ok);
      return ok;
    };
    return go(0, 0);
  };
  return tryAcr(acr) || (acr.startsWith("sig") && tryAcr(acr.slice(3)));
}

// ─── dblp venue index (optional) ─────────────────────────────────────
// Built offline from the dblp dump (scripts/build-venues.mjs); maps venue
// names and acronyms to dblp venue series. Ambiguous keys are excluded.
let venueIndex = null;

/** Install the dblp venue index: `{ names: {key: id}, acronyms: {key: id} }`. */
export function setVenueIndex(index) { venueIndex = index; }

/** Normalized key under which the index stores a full venue name. */
export function venueNameKey(v) {
  const { words, orgs } = venueTokens(v);
  return [...[...orgs].sort(), ...words].join(" ");
}

/** dblp series ids a venue string resolves to (empty when unknown). */
export function venueSeries(v) {
  const { byName, byAcronym } = resolveVenue(v);
  return new Set([...byName, ...byAcronym]);
}

// dblp series a venue resolves to by its name and by its declared acronyms, separately.
function resolveVenue(v) {
  const byName = new Set(), byAcronym = new Set();
  if (!venueIndex) return { byName, byAcronym };
  const { words } = venueTokens(v);
  for (const key of [venueNameKey(v), words.join(" ")]) {
    const id = venueIndex.names[key];
    if (id !== undefined) byName.add(id);
  }
  const q = venueQualifier(v);
  for (const acr of declaredAcronyms(v)) {
    const id = venueIndex.acronyms[q ? `${acr}#${q}` : acr];
    if (id !== undefined) byAcronym.add(id);
  }
  return { byName, byAcronym };
}

const disjoint = (a, b) => ![...a].some(x => b.has(x));

/**
 * Whether two venue strings name the same venue. Only positive evidence
 * counts: dblp, exact core names, full abbreviations, and acronyms that cover
 * the whole name. Anything undecided is a different venue.
 */
export function sameVenue(a, b) {
  // A workshop, Findings or companion volume is not the main conference. A
  // standalone workshop ("3rd Workshop on Gender Bias in NLP") may still be
  // named by its own acronym ("GeBNLP").
  const qa = venueQualifier(a), qb = venueQualifier(b);
  if (qa !== qb && !standaloneWorkshopPair(a, b) && !standaloneWorkshopPair(b, a)) return false;

  const ta = venueTokens(a), tb = venueTokens(b);
  // "ACM … Data Engineering" is not "IEEE … Data Engineering", whatever the index says.
  if (!orgsCompatible(ta.orgs, tb.orgs)) return false;

  const aOnly = isAcronymOnly(a), bOnly = isAcronymOnly(b);
  const ra = resolveVenue(a), rb = resolveVenue(b);
  // "…Data Engineering (ICDM)": the name and its own acronym are different
  // venues. A declared acronym must fit its name — via dblp, or by covering it.
  if (!selfConsistent(a, aOnly, ra) || !selfConsistent(b, bOnly, rb)) return false;
  // dblp decides when both sides resolve: by acronym for acronym-only venues,
  // by name for spelled-out ones (a right acronym can't vouch for a wrong name).
  const sa = aOnly ? ra.byAcronym : ra.byName, sb = bOnly ? rb.byAcronym : rb.byName;
  if (sa.size === 1 && sb.size === 1) return [...sa][0] === [...sb][0];
  if (sa.size && sb.size && disjoint(sa, sb)) return false;

  // Declared acronyms must agree with the other side: "…(ICDE)" ≠ "…(ICDM)",
  // and "…Data Engineering (ICDM)" ≠ "Conference on Data Engineering".
  const la = [...declaredAcronyms(a)].filter(x => x.length >= 3);
  const lb = [...declaredAcronyms(b)].filter(x => x.length >= 3);
  if (la.length && lb.length && !la.some(x => lb.includes(x))) return false;
  if (!aOnly && la.length && !lb.length && !la.some(x => acronymMatches(x, b) || abbreviationTableMatch(x, b))) return false;
  if (!bOnly && lb.length && !la.length && !lb.some(x => acronymMatches(x, a) || abbreviationTableMatch(x, a))) return false;

  // Both written as acronyms: they must share one.
  if (aOnly && bOnly) return la.some(x => lb.includes(x)) || [...explicitAcronyms(a)].some(x => explicitAcronyms(b).has(x));
  // Acronym vs full name: the acronym must cover every content word.
  if (aOnly) return [...explicitAcronyms(a)].some(x => acronymMatches(x, b) || abbreviationTableMatch(x, b));
  if (bOnly) return [...explicitAcronyms(b)].some(x => acronymMatches(x, a) || abbreviationTableMatch(x, a));
  // Two spelled-out names must say the same thing.
  if (ta.words.length && ta.words.join(" ") === tb.words.join(" ")) return true;
  return isAbbreviationOf(ta.words, tb.words, a) || isAbbreviationOf(tb.words, ta.words, b);
}

function selfConsistent(v, acronymOnly, r) {
  if (acronymOnly) return true;
  const declared = [...declaredAcronyms(v)].filter(x => x.length >= 3);
  if (!declared.length) return true;
  if (r.byName.size && r.byAcronym.size) return !disjoint(r.byName, r.byAcronym);
  return declared.some(x => acronymMatches(x, v) || abbreviationTableMatch(x, v)) ||
    (r.byAcronym.size > 0 && r.byName.size === 0 && !venueTokens(v).words.length);
}

// `w` names a standalone workshop ("Workshop on …") and `acr` is acronym-only.
function standaloneWorkshopPair(w, acr) {
  // "ICDE Workshop" vs "ICDE" must not pass when the index is unavailable.
  return venueQualifier(w) === "workshop" && !isAcronymOnly(w) &&
    venueQualifier(acr) === null && isAcronymOnly(acr);
}

// The curated abbreviation table, matched on the exact core name.
function abbreviationTableMatch(acr, name) {
  // Compare lowercase text so a name's own acronym ("VLDB") stays a word on both sides.
  const key = venueTokens(looseText(venueMain(name))).words.join(" ");
  for (const [full, abbr] of Object.entries(VENUE_ABBREVIATIONS)) {
    if (looseText(abbr).replace(/ /g, "") !== acr) continue;
    if (venueTokens(full).words.join(" ") === key) return true;
  }
  return false;
}

// Proceedings series a database may report instead of the conference itself.
const BOOK_SERIES_RE = /^(lecture notes in (computer science|artificial intelligence|bioinformatics|networks and systems)|communications in computer and information science|advances in intelligent systems and computing|lecture notes of the institute for computer sciences.*|ifip advances in information and communication technology|studies in computational intelligence|ceur workshop proceedings|lncs|ccis)$/;

function classifyVenue(orig, found) {
  if (looseText(orig) === looseText(found)) return minor("formatting");
  const op = isPreprintVenue(orig), fp = isPreprintVenue(found);
  if (op && fp) return minor("preprint server written differently");
  if (op && !fp) return major(PUBLISHED_VERSION);
  // The database can't confirm your venue: a published venue claimed for an
  // arXiv-only paper is a classic fabrication, so it's reviewed, never passed.
  if (!op && fp) return major(VENUE_UNCONFIRMED_PREPRINT);
  if (BOOK_SERIES_RE.test(looseText(found))) return major("venue not confirmed (database only gives the book series)");
  return sameVenue(orig, found) ? minor("venue name written differently") : major("different venue");
}

// ─── Publisher ───────────────────────────────────────────────────────
const PUBLISHER_ALIASES = [
  ["acm", "association for computing machinery"],
  ["ieee", "institute of electrical and electronics engineers"],
  ["siam", "society for industrial and applied mathematics"],
  ["aaai", "association for the advancement of artificial intelligence"],
  ["pmlr", "proceedings of machine learning research", "mlresearchpress", "ml research press"],
  // PVLDB is published by the VLDB Endowment and distributed through the ACM DL.
  ["acm", "vldb endowment", "vldb"],
  ["mit press", "the mit press"],
  ["taylor francis", "informa uk", "informa", "crc press", "routledge"],
  ["springer", "springer nature", "springerlink", "palgrave macmillan", "palgrave", "birkhauser", "apress"],
  ["oxford university", "oup"],
  ["cambridge university", "cup"],
  ["elsevier", "academic press", "north holland", "pergamon"],
  ["wiley", "john wiley sons", "wiley blackwell"],
];
const PUBLISHER_NOISE = new Set([
  "inc", "ltd", "llc", "co", "bv", "gmbh", "ag", "plc", "publishing", "publishers", "publisher",
  "press", "the", "and", "of", "media", "nature", "science", "business", "international",
  "group", "verlag", "berlin", "heidelberg", "new", "york", "london", "company", "usa",
]);

function publisherCore(p) {
  let t = looseText(p);
  for (const group of PUBLISHER_ALIASES)
    for (const alias of group.slice(1)) t = t.replace(new RegExp(`\\b${alias}\\b`, "g"), group[0]);
  return t.split(" ").filter(w => w && !PUBLISHER_NOISE.has(w));
}

function classifyPublisher(orig, found) {
  const a = publisherCore(orig), b = publisherCore(found);
  if (!a.length || !b.length || a[0] === b[0] || a.some(w => b.includes(w)))
    return minor("publisher name written differently");
  // Databases often name a distributor or aggregator (Elsevier, HeinOnline)
  // instead of the publisher, and a publisher never makes a citation wrong.
  return keepYours("different publisher");
}

// ─── Small fields ────────────────────────────────────────────────────
export function normalizeDoi(d) {
  return String(d ?? "").trim().toLowerCase()
    .replace(/\\([_&%$#])/g, "$1")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
}

function classifyDoi(orig, found) {
  const a = normalizeDoi(orig), b = normalizeDoi(found);
  if (a === b) return minor("formatting");
  const ap = a.startsWith("10.48550/arxiv"), bp = b.startsWith("10.48550/arxiv");
  if (ap && !bp) return major(PUBLISHED_VERSION);
  // Never trade your published DOI for the arXiv one; and it can't be confirmed either.
  if (!ap && bp) return major("DOI not confirmed (database only has the preprint)");
  return major("conflicting DOI");
}

function pageRange(p) {
  const t = String(p ?? "").toLowerCase().replace(/^pp?\.?\s*/, "").replace(/[–—]/g, "-");
  const m = t.match(/^\s*([a-z]?\d+)\s*(?:-+\s*([a-z]?\d+))?\s*$/);
  return m ? { start: m[1], end: m[2] || null } : null;
}

function classifyPages(orig, found) {
  const a = pageRange(orig), b = pageRange(found);
  if (!a || !b) return looseText(orig) === looseText(found) ? minor("formatting") : major("different pages");
  if (a.start === b.start && a.end === b.end) return minor("formatting");
  // "1" vs "1-12": one side gives only the first page (or an article number).
  if (a.start === b.start && (!a.end || !b.end)) return minor("page range vs. first page");
  // "2345-56" vs "2345-2356": abbreviated end page.
  if (a.start === b.start && a.end && b.end &&
      (b.end.endsWith(a.end) || a.end.endsWith(b.end))) return minor("abbreviated page range");

  const len = (r) => r.end && /^\d+$/.test(r.start) && /^\d+$/.test(r.end) ? Number(r.end) - Number(r.start) + 1 : null;
  const la = len(a), lb = len(b);
  if (la && lb) {
    // Yours "1--24" vs "1283-1306": numbered within the article instead of the
    // volume. Only your range may start at 1; a database "1-8" can't vouch for yours.
    if (a.start === "1" && Math.abs(la - lb) <= Math.max(1, 0.25 * Math.max(la, lb)))
      return minor("article-relative page numbers");
    // "4401--4410" vs "4396-4405": same length, shifted by a few pages (e.g. open-access vs. IEEE print).
    if (Math.abs(la - lb) <= 1 && Math.abs(Number(a.start) - Number(b.start)) <= 10)
      return minor("page numbers shifted slightly");
  }
  return major("different pages");
}

function classifyNumberLike(field, orig, found) {
  const clean = (s) => looseText(s).replace(/^(vol|volume|no|number|issue)\s*/, "").replace(/\b0+(\d)/g, "$1");
  const a = clean(orig), b = clean(found);
  if (a === b) return minor("formatting");
  // "1" vs "1-4" (combined issue), "5 2" vs "5" (volume with issue appended).
  const first = (s) => s.split(" ")[0];
  if (first(a) === first(b)) return minor(`${field} written differently`);
  return major(`different ${field}`);
}

function classifyYear(orig, found, original, record) {
  const oy = parseInt(orig, 10), fy = parseInt(found, 10);
  if (!Number.isFinite(oy) || !Number.isFinite(fy)) return major("different year");
  const gap = Math.abs(oy - fy);
  if (gap === 0) return minor("formatting");
  // Online-first vs. issue year, or preprint vs. publication year.
  if (gap === 1) return minor("online vs. print year");
  // You cite the preprint (its earlier year); the database has the published version.
  const citesPreprint = isPreprintVenue(original.journal || original.booktitle || "");
  if (citesPreprint && oy < fy && gap <= 2) return minor("preprint vs. publication year");
  return major(`year differs by ${gap}`);
}

function classifyTitle(orig, found) {
  if (looseText(orig) === looseText(found)) return minor("capitalization or punctuation");
  return major("different title");
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Classify one field diff (`{ field, original, found }`) of `original` vs the
 * database `record`. Returns `{ severity, reason }`.
 */
export function classifyDiff(diff, original = {}, record = {}) {
  const o = diff.original || "", f = diff.found || "";
  if (!o.trim()) return { severity: SEVERITY.ENRICHMENT, reason: "missing from your entry" };
  switch (diff.field) {
    case "author": return classifyAuthors(o, f);
    case "journal":
    case "booktitle": return classifyVenue(o, f);
    case "publisher": return classifyPublisher(o, f);
    case "doi": return classifyDoi(o, f);
    case "pages": return classifyPages(o, f);
    case "year": return classifyYear(o, f, original, record);
    case "title": return classifyTitle(o, f);
    case "volume":
    case "number": return classifyNumberLike(diff.field, o, f);
    default: return looseText(o) === looseText(f) ? minor("formatting") : major(`different ${diff.field}`);
  }
}

/** Annotate each diff with `severity` and `reason`; returns a new array. */
export function classifyDiffs(diffs, original, record) {
  return (diffs || []).map(d => ({ ...d, ...classifyDiff(d, original, record) }));
}

/** Highest severity among diffs, or null when there are none. */
export function maxSeverity(diffs) {
  let best = null;
  for (const d of diffs || [])
    if (d.severity && (best === null || RANK[d.severity] > RANK[best])) best = d.severity;
  return best;
}
