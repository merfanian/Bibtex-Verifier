// Shared UI state for the current verification run.
export const state = {
  // Entries parsed from the user's .bib, in file order.
  parsedEntries: [],
  // results[i] is the lookup result for parsedEntries[i]; filled in order.
  results: [],
  // fieldEdits[i][field] = { action: "original" | "found" | "custom" | "remove", value }
  fieldEdits: {},
  // "attention" (default: entries needing a decision), "all", a status, or "duplicate".
  activeFilter: "attention",
  activeSearch: "",
  // Whether this run is saved to the browser for a later visit (not the tour's sample).
  persist: false,
  // Whether the retraction check has succeeded for this run.
  noticesChecked: false,
};

export function resetRunState() {
  state.parsedEntries = [];
  state.results = [];
  state.fieldEdits = {};
  state.noticesChecked = false;
}
