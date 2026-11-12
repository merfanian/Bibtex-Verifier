// Saved-session format: a run's entries, results and the user's choices, so a
// long verification survives a page reload.
export const SESSION_VERSION = 1;

/** Plain object to store. `settings` is the settings snapshot the results were built with. */
export function packSession({ parsedEntries, results, fieldEdits, noticesChecked }, settings, savedAt = Date.now()) {
  return { version: SESSION_VERSION, savedAt, settings, noticesChecked: !!noticesChecked, parsedEntries, results, fieldEdits };
}

/**
 * Validate stored text. Returns `{ parsedEntries, results, fieldEdits, settings,
 * savedAt, complete }`, or null when it is missing, from another version or
 * malformed. `complete` is false when entries still await a lookup or the
 * retraction check has not succeeded yet.
 */
export function unpackSession(raw) {
  let data;
  try { data = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
  if (!data || data.version !== SESSION_VERSION) return null;
  const { parsedEntries, results, fieldEdits, settings, savedAt } = data;
  if (!Array.isArray(parsedEntries) || !parsedEntries.length || !Array.isArray(results)) return null;
  if (results.length > parsedEntries.length) return null;
  if (!parsedEntries.every(e => e && typeof e === "object")) return null;
  // Keep the leading run of well-formed results; anything after is looked up again.
  let n = 0;
  while (n < results.length && results[n] && results[n].index === n &&
         typeof results[n].status === "string" && Array.isArray(results[n].field_diffs)) n++;
  if (!n) return null;
  const kept = results.slice(0, n);
  return {
    parsedEntries,
    results: kept,
    // Choices for entries that will be looked up again are dropped with their results.
    fieldEdits: Object.fromEntries(Object.entries(fieldEdits && typeof fieldEdits === "object" ? fieldEdits : {})
      .filter(([i]) => Number(i) < n)),
    settings: settings && typeof settings === "object" ? settings : {},
    savedAt: Number(savedAt) || 0,
    complete: n === parsedEntries.length && !kept.some(r => r.pending) && data.noticesChecked === true,
  };
}
