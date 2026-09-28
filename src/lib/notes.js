// Reference managers (Zotero, Mendeley, Scopus exports, …) dump bookkeeping
// into `note` / `annote` that then shows up in the compiled bibliography.
// Keys match case-insensitively; `_` also matches LaTeX-escaped `\_`, and a
// space matches any run of whitespace.
export const NOTE_JUNK_KEYS = [
  "read_status_date",
  "read_status",
  "citation key",
  "kerkocite.itemalsoknownas",
  "zscc",
  "mag id",
  "tex.ids",
  "export date",
  "cited by",
  "cited references",
  "correspondence address",
  "art. no",
  "coden",
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NOTE_JUNK_KEY_RE = new RegExp(
  "(?:^|(?<=[\\s;,]))(?:" +
    NOTE_JUNK_KEYS.map(k => escapeRegExp(k).replace(/_/g, "\\\\?_").replace(/ /g, "\\s+")).join("|") +
    ")\\s*:",
  "gi"
);

/**
 * Strip reference-manager bookkeeping (`Read_Status: Read`, `ZSCC: 0`, …)
 * from a note, keeping user prose. A junk value ends at the next junk key,
 * newline, or end of note — the parser may have collapsed newlines to spaces.
 */
export function cleanNote(note) {
  if (!note) return "";
  const text = String(note);
  NOTE_JUNK_KEY_RE.lastIndex = 0;
  const starts = [];
  let m;
  while ((m = NOTE_JUNK_KEY_RE.exec(text)) !== null) starts.push(m.index);
  if (!starts.length) return text.trim();

  let kept = "";
  let cursor = 0;
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    if (start < cursor) continue;
    const limit = i + 1 < starts.length ? starts[i + 1] : text.length;
    const nl = text.indexOf("\n", start);
    const end = nl !== -1 && nl < limit ? nl : limit;
    kept += text.slice(cursor, start);
    cursor = end;
  }
  kept += text.slice(cursor);
  return kept.replace(/[\s;,]+/g, " ").trim().replace(/^[;,]+|[;,]+$/g, "").trim();
}

/** Copy of an entry with note-like fields cleaned; fields left empty are dropped. */
export function cleanEntryNotes(entry) {
  const out = { ...entry };
  for (const field of ["note", "annote"]) {
    if (!(field in out)) continue;
    const cleaned = cleanNote(out[field]);
    if (cleaned) out[field] = cleaned;
    else delete out[field];
  }
  return out;
}
