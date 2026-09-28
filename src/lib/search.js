import { stripLatex } from "./latex.js";

/**
 * Case-insensitive AND-of-tokens substring match against an entry's title and
 * BibTeX key (`ID`, or `entry_id` on result objects). Empty queries match.
 * Tokens may be scoped with `title:` or `id:` / `key:`.
 */
export function entryMatchesQuery(entry, query) {
  if (!query) return true;
  const q = String(query).trim().toLowerCase();
  if (!q) return true;
  const title = stripLatex(entry.title || "").toLowerCase();
  const id = (entry.entry_id || entry.ID || "").toLowerCase();
  const haystack = `${id} ${title}`;
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every(tok => {
    if (tok.startsWith("title:")) return title.includes(tok.slice(6));
    if (tok.startsWith("id:") || tok.startsWith("key:"))
      return id.includes(tok.slice(tok.indexOf(":") + 1));
    return haystack.includes(tok);
  });
}
