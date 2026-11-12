// Checks that need no network: identifiers an entry carries, problems in the
// file itself, and which unmatched entries the databases could not have had.
import { normalizeTitle } from "./latex.js";
import { normalizeDoi } from "./severity.js";

const DOI_RE = /^10\.\d{4,9}\/\S+$/;
// New-style "2302.09419" (optionally versioned) and old-style "cs/0112017".
const ARXIV_NEW = /(?<![\d.])(\d{4}\.\d{4,5})(v\d+)?(?![\d.])/;
const ARXIV_OLD = /\b([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?\b/;

function arxivIdIn(text, { needsMarker }) {
  const t = String(text || "");
  if (needsMarker && !/arxiv/i.test(t)) return "";
  const m = t.match(ARXIV_NEW) || (/arxiv/i.test(t) ? t.match(ARXIV_OLD) : null);
  return m ? m[1] : "";
}

/**
 * The DOI and arXiv ID an entry states, normalized, or "" for each. An arXiv
 * DOI (10.48550/arXiv.…) counts as the arXiv ID, not as a DOI.
 */
export function entryIdentifiers(entry) {
  let doi = normalizeDoi(entry.doi || "");
  if (!doi) {
    const m = String(entry.url || "").match(/doi\.org\/(10\.\d{4,9}\/[^\s?#]+)/i);
    if (m) doi = normalizeDoi(m[1]);
  }
  if (!DOI_RE.test(doi)) doi = "";

  let arxiv = "";
  const arxivDoi = doi.match(/^10\.48550\/arxiv\.(.+)$/);
  if (arxivDoi) { arxiv = arxivDoi[1].replace(/v\d+$/, ""); doi = ""; }
  // `eprint` is an arXiv ID when the entry says so or the value looks like one.
  const prefix = `${entry.archiveprefix || ""} ${entry.eprinttype || ""}`;
  if (!arxiv && entry.eprint && (/arxiv/i.test(prefix) || !prefix.trim()))
    arxiv = arxivIdIn(`arXiv:${entry.eprint}`, { needsMarker: false });
  for (const f of ["journal", "url", "note", "howpublished", "booktitle"])
    if (!arxiv) arxiv = arxivIdIn(entry[f], { needsMarker: true });
  return { doi, arxiv };
}

// Entry types the bibliographic databases rarely hold.
const UNINDEXED_TYPES = new Set([
  "phdthesis", "mastersthesis", "thesis", "techreport", "report", "manual",
  "unpublished", "patent", "standard", "software", "dataset", "booklet",
]);
const WEB_TYPES = new Set(["misc", "online", "electronic", "www", "webpage"]);

/**
 * True when an unmatched entry is a kind of source the databases don't cover
 * (a web page, thesis, report, software…), so "not found" says nothing about
 * it. Anything that claims a venue, a DOI or an arXiv ID is a paper the
 * databases should know, and stays "not found".
 */
export function isUncheckable(entry) {
  const type = (entry.ENTRYTYPE || "").toLowerCase();
  const { doi, arxiv } = entryIdentifiers(entry);
  if (doi || arxiv) return false;
  if ((entry.journal || "").trim() || (entry.booktitle || "").trim()) return false;
  const text = ["howpublished", "note", "publisher", "eprint", "archiveprefix", "url"]
    .map(f => entry[f] || "").join(" ");
  if (/arxiv|preprint|doi\.org/i.test(text)) return false;
  if (UNINDEXED_TYPES.has(type)) return true;
  return WEB_TYPES.has(type) && !!((entry.url || "").trim() || (entry.howpublished || "").trim());
}

const NEEDS_AUTHOR_AND_YEAR = new Set([
  "article", "inproceedings", "conference", "incollection", "inbook", "book",
]);

/**
 * Problems in the file itself, per entry: `issues[i]` is a list of
 * `{ code, field?, message }` for `entries[i]`.
 */
export function lintEntries(entries) {
  // A key shared by copies of one paper is a plain duplicate (reported as
  // such); shared by different papers, a citation resolves to the wrong one.
  const keyTitles = new Map();
  for (const e of entries) {
    const k = (e.ID || "").trim().toLowerCase();
    if (!k) continue;
    if (!keyTitles.has(k)) keyTitles.set(k, new Set());
    keyTitles.get(k).add(normalizeTitle(e.title || ""));
  }
  return entries.map((e) => {
    const issues = [];
    const key = (e.ID || "").trim();
    const type = (e.ENTRYTYPE || "").toLowerCase();
    const has = (...fields) => fields.some(f => (e[f] || "").trim());

    if (!key) issues.push({ code: "missing_key", message: "This entry has no citation key, so it can't be cited." });
    else if (keyTitles.get(key.toLowerCase()).size > 1) issues.push({
      code: "duplicate_key",
      message: `The citation key "${key}" is also used by a different paper in this file; BibTeX reports an error and keeps only one of them.`,
    });

    if (e._unparsed) issues.push({
      code: "unparsed",
      message: `Part of this entry couldn't be read (near "${e._unparsed}"); the fields after that point are missing from the download.`,
    });

    if (NEEDS_AUTHOR_AND_YEAR.has(type)) {
      if (!has("author", "editor"))
        issues.push({ code: "missing_field", field: "author", message: "No author (or editor)." });
      if (!has("year", "date"))
        issues.push({ code: "missing_field", field: "year", message: "No year." });
    }

    const doi = normalizeDoi(e.doi || "");
    if (doi && !DOI_RE.test(doi)) issues.push({
      code: "bad_doi", field: "doi",
      message: `"${e.doi}" isn't a valid DOI (a DOI looks like 10.1234/abc).`,
    });
    return issues;
  });
}

const RETRACTION_TYPES = new Set(["retraction", "withdrawal", "removal"]);

/**
 * Reduce CrossRef's `updated-by` list (Retraction Watch data) to the notice
 * that matters: `{ kind: "retracted" | "concern", doi }`, or null. Corrections
 * and errata are not reported.
 */
export function editorialNotice(updatedBy) {
  const updates = (updatedBy || []).map(u => ({
    type: String(u?.type || "").toLowerCase().replace(/[^a-z]+/g, "_"), doi: u?.DOI || "",
  }));
  const retraction = updates.find(u => RETRACTION_TYPES.has(u.type));
  if (retraction) return { kind: "retracted", doi: retraction.doi };
  const concern = updates.find(u => u.type === "expression_of_concern");
  return concern ? { kind: "concern", doi: concern.doi } : null;
}

/** DOIs worth asking CrossRef about: valid, CrossRef-style, safe in a filter. */
export function checkableDois(dois) {
  return [...new Set((dois || []).map(normalizeDoi))]
    .filter(d => DOI_RE.test(d) && !d.includes(",") && !d.startsWith("10.48550/"));
}
