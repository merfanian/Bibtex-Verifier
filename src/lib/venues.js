export const VENUE_ABBREVIATIONS = {
  "advances in neural information processing systems": "NeurIPS",
  "neural information processing systems": "NeurIPS",
  "international conference on machine learning": "ICML",
  "international conference on learning representations": "ICLR",
  "association for computational linguistics": "ACL",
  "conference on empirical methods in natural language processing": "EMNLP",
  "north american chapter of the association for computational linguistics": "NAACL",
  "ieee conference on computer vision and pattern recognition": "CVPR",
  "computer vision and pattern recognition": "CVPR",
  "ieee international conference on computer vision": "ICCV",
  "international conference on computer vision": "ICCV",
  "european conference on computer vision": "ECCV",
  "aaai conference on artificial intelligence": "AAAI",
  "international joint conference on artificial intelligence": "IJCAI",
  "acm sigkdd international conference on knowledge discovery and data mining": "KDD",
  "international conference on very large data bases": "VLDB",
  "very large data bases": "VLDB",
  "acm sigmod international conference on management of data": "SIGMOD",
  "ieee transactions on pattern analysis and machine intelligence": "TPAMI",
  "journal of machine learning research": "JMLR",
  "artificial intelligence": "AI",
  "transactions on graphics": "TOG",
  "acm computing surveys": "CSUR",
  "ieee transactions on neural networks and learning systems": "TNNLS",
  "ieee transactions on image processing": "TIP",
  "ieee transactions on signal processing": "TSP",
  "nature machine intelligence": "Nat. Mach. Intell.",
  "international conference on acoustics, speech and signal processing": "ICASSP",
  "acm conference on human factors in computing systems": "CHI",
  "usenix security symposium": "USENIX Security",
  "ieee symposium on security and privacy": "IEEE S&P",
  "acm conference on computer and communications security": "CCS",
  "international world wide web conference": "WWW",
};

export function abbreviateVenue(name) {
  if (!name) return name;
  const key = name.toLowerCase().replace(/[^a-z0-9\s&,]/g, "").trim();
  for (const [full, abbr] of Object.entries(VENUE_ABBREVIATIONS)) {
    if (key.includes(full)) return abbr;
  }
  return name;
}

export function expandVenue(name) {
  if (!name) return name;
  const upper = name.toUpperCase().trim();
  for (const [full, abbr] of Object.entries(VENUE_ABBREVIATIONS)) {
    if (upper === abbr.toUpperCase()) {
      return full.replace(/\b\w/g, c => c.toUpperCase());
    }
  }
  return name;
}
