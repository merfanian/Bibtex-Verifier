import { normalizeTitle } from "./latex.js";
import { cleanEntryNotes } from "./notes.js";

export function truncateAuthors(authorStr, max) {
  if (!authorStr || max <= 0) return authorStr;
  const authors = authorStr.split(/\s+and\s+/i);
  if (authors.length <= max) return authorStr;
  return authors.slice(0, max).join(" and ") + " and others";
}

const isPreprintVenue = (venue) =>
  venue.includes("arxiv") || venue.includes("preprint") || venue.includes("corr");

function applyFieldEdits(entry, edits) {
  const out = { ...entry };
  for (const [field, fe] of Object.entries(edits || {})) {
    if (!fe) continue;
    if (fe.action === "found" || fe.action === "custom") {
      if (fe.value) out[field] = fe.value;
    } else if (fe.action === "remove") {
      delete out[field];
    }
  }
  return out;
}

function dedupKey(entry, dedupBy) {
  if (dedupBy === "doi") return (entry.doi || "").toLowerCase().trim();
  if (dedupBy === "id") return (entry.ID || "").toLowerCase().trim();
  return normalizeTitle(entry.title || "");
}

/**
 * Build the entries to export from the parsed entries processed so far
 * (`results[i]` belongs to `entries[i]`), the user's per-field choices, and
 * the download settings.
 *
 * `fieldEdits[i][field]` is `{ action: "original" | "found" | "custom" | "remove", value }`.
 * `settings` is `{ removeDuplicates, dedupBy, removeNotFound, cleanNotes, maxAuthors, preferPublished }`.
 */
export function buildExportEntries(entries, results, fieldEdits, settings) {
  const s = settings;
  let final = entries.slice(0, results.length).map((entry, i) => {
    const r = results[i];
    if (!r) return { ...entry };
    if (s.removeNotFound && r.status === "not_found") return null;

    const out = applyFieldEdits(entry, fieldEdits[i]);

    if (s.maxAuthors > 0 && out.author && r.status !== "not_found") {
      out.author = truncateAuthors(out.author, s.maxAuthors);
    }

    if (s.preferPublished && r.suggested) {
      const venue = (out.journal || out.booktitle || "").toLowerCase();
      const foundVenue = r.suggested.journal || r.suggested.booktitle || "";
      if (isPreprintVenue(venue) && foundVenue && !isPreprintVenue(foundVenue.toLowerCase())) {
        if (out.journal) out.journal = foundVenue;
        else if (out.booktitle) out.booktitle = foundVenue;
      }
    }
    return s.cleanNotes ? cleanEntryNotes(out) : out;
  }).filter(Boolean);

  if (s.removeDuplicates) {
    const seen = new Set();
    final = final.filter(entry => {
      const key = dedupKey(entry, s.dedupBy);
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return final;
}
