// Minimum title similarity for a lookup hit to count as the same paper.
export const TITLE_MATCH_THRESHOLD = 85;
// Minimum title similarity for a search candidate to be considered at all.
export const MIN_TITLE_SIM = 70;

export const COMPARED_FIELDS = [
  "author", "year", "journal", "booktitle",
  "volume", "number", "pages", "doi", "publisher",
];
