// ─── Fuzzy matching ──────────────────────────────────────────────────
// The browser loads fuzzball as a global; the fallback mirrors its default
// token_sort_ratio so scores stay the same if the CDN script fails to load.

function sortedTokens(s) {
  return String(s ?? "")
    .replace(/[^\p{L}\p{N}]/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

// Levenshtein distance with substitution cost 2, as used by fuzzball's ratio.
function indelDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 2),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export function fallbackTokenSortRatio(a, b) {
  a = sortedTokens(a);
  b = sortedTokens(b);
  if (!a || !b) return 0;
  const lensum = a.length + b.length;
  return Math.round((100 * (lensum - indelDistance(a, b))) / lensum);
}

export function tokenSortRatio(a, b) {
  const fz = globalThis.fuzzball;
  return fz ? fz.token_sort_ratio(a, b) : fallbackTokenSortRatio(a, b);
}

export function titleSimilarity(a, b) {
  return tokenSortRatio(a.toLowerCase().trim(), b.toLowerCase().trim());
}

// ─── Normalization helpers ───────────────────────────────────────────
export function normalizeText(text) {
  if (!text) return "";
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/\s+/g, " ");
}

export function normalizeAuthorSet(authorStr) {
  if (!authorStr) return new Set();
  const norm = normalizeText(authorStr);
  const parts = norm.split(/\s+and\s+/);
  const names = new Set();
  for (let a of parts) {
    a = a.trim();
    if (!a) continue;
    if (a.includes(",")) names.add(a.split(",")[0].trim());
    else { const t = a.split(/\s+/); names.add(t[t.length - 1]); }
  }
  return names;
}

export function normalizePages(p) { return p.trim().replace(/\s*-+\s*/g, "-"); }

export function extractLastNames(authorStr) {
  if (!authorStr) return new Set();
  const names = new Set();
  for (let part of authorStr.split(/\s+and\s+/i)) {
    part = part.trim();
    if (!part) continue;
    if (part.includes(",")) names.add(part.split(",")[0].trim().toLowerCase());
    else { const t = part.split(/\s+/); names.add(t[t.length - 1].toLowerCase()); }
  }
  return names;
}
