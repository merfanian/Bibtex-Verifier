// Shared UI state for the current verification run.
export const state = {
  // Entries parsed from the user's .bib, in file order.
  parsedEntries: [],
  // results[i] is the lookup result for parsedEntries[i]; filled in order.
  results: [],
  // fieldEdits[i][field] = { action: "original" | "found" | "custom" | "remove", value }
  fieldEdits: {},
  activeFilter: "all",
  activeSearch: "",
};

export function resetRunState() {
  state.parsedEntries = [];
  state.results = [];
  state.fieldEdits = {};
}
