import "./helpers/setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adoptsByDefault, applyPublishedPreference, buildResult, classifyDiff, maxSeverity, normalizeDoi, parseAuthors, sameVenue, SEVERITY,
} from "../src/lib/index.js";

const sev = (field, original, found, entry = {}, record = {}) =>
  classifyDiff({ field, original, found }, entry, record).severity;

describe("classifyDiff: authors", () => {
  it("name formatting is minor", () => {
    assert.equal(sev("author", "Jagadish, HV and Asudeh, Abolfazl", "H. V. Jagadish and Abolfazl Asudeh"), SEVERITY.MINOR);
  });

  it("accents and LaTeX escapes are minor", () => {
    assert.equal(sev("author", "M{\\\"u}ller, Klaus", "Klaus Müller"), SEVERITY.MINOR);
  });

  it("'and others' prefix of the full list is minor", () => {
    assert.equal(sev("author", "Vaswani, Ashish and others", "Ashish Vaswani and Noam Shazeer and Niki Parmar"), SEVERITY.MINOR);
  });

  it("missing authors without 'others' is major", () => {
    assert.equal(sev("author", "Vaswani, Ashish", "Ashish Vaswani and Noam Shazeer"), SEVERITY.MAJOR);
  });

  it("an author not in the record is major", () => {
    assert.equal(sev("author", "Vaswani, Ashish and Smith, John", "Ashish Vaswani and Noam Shazeer"), SEVERITY.MAJOR);
  });

  it("no authors in common is major", () => {
    const r = classifyDiff({ field: "author", original: "Mood, Alexander", found: "Theobald, C. and Larson, H." });
    assert.equal(r.severity, SEVERITY.MAJOR);
    assert.match(r.reason, /no author in common/);
  });

  it("LaTeX dotless i, apostrophes, suffixes and Turkish ı are minor", () => {
    assert.equal(sev("author", "D{\\'\\i}az, Mark and Sar{\\i}, Leda", "Diaz, Mark and Sari, Leda and Extra, Person"), SEVERITY.MAJOR);
    assert.equal(sev("author", "D{\\'\\i}az, Mark and Sar{\\i}, Leda and others", "Diaz, Mark and Sari, Leda and Extra, Person"), SEVERITY.MINOR);
    assert.equal(sev("author", "Blodgett, Su Lin and Daum{\\'e} III, Hal", "Blodgett, Su Lin and Daum'e, Hal"), SEVERITY.MINOR);
    assert.equal(sev("author", "Kiciman, Emre", "Kıcıman, Emre"), SEVERITY.MINOR);
    assert.equal(sev("author", "Massey Jr, Frank J", "Massey, Frank J."), SEVERITY.MINOR);
    assert.equal(sev("author", "Bernard Chazelle and Robert L. (Scot) Drysdale III and D. T. Lee",
      "Chazelle, B. and Drysdale, R. L. Scot and Lee, D."), SEVERITY.MINOR);
  });

  it("later authors reordered keeps yours; a different first author is major", () => {
    const later = classifyDiff({ field: "author",
      original: "Manzini, Thomas and Lim, Yao Chong and Tsvetkov, Yulia and Black, Alan W",
      found: "Manzini, Thomas and Chong, Lim-Yao and Black, A. and Tsvetkov, Yulia" });
    assert.equal(later.severity, SEVERITY.MINOR);
    assert.equal(later.prefer, "original");
    assert.equal(sev("author", "Doe, Jane and Smith, John", "John Smith and Jane Doe"), SEVERITY.MAJOR);
  });

  it("compound surnames match on their last word", () => {
    assert.equal(sev("author", "van der Maaten, Laurens", "Laurens van der Maaten"), SEVERITY.MINOR);
  });

  it("parseAuthors detects truncation", () => {
    const p = parseAuthors("A, B and others");
    assert.equal(p.people.length, 1);
    assert.equal(p.truncated, true);
  });
});

describe("classifyDiff: venues", () => {
  it("year, ordinal, organizer and acronym noise is minor", () => {
    assert.equal(sev("booktitle", "2019 IEEE 35th International Conference on Data Engineering (ICDE)",
      "IEEE International Conference on Data Engineering"), SEVERITY.MINOR);
  });

  it("acronym vs full name is minor", () => {
    assert.equal(sev("booktitle", "NeurIPS", "Advances in Neural Information Processing Systems"), SEVERITY.MINOR);
    assert.equal(sev("booktitle", "ICDE", "International Conference on Data Engineering"), SEVERITY.MINOR);
  });

  it("acronyms are matched against the full name", () => {
    for (const [short, full] of [
      ["{EDBT}", "International Conference on Extending Database Technology"],
      ["ICDE", "IEEE International Conference on Data Engineering"],
      ["AIES", "AAAI/ACM Conference on AI, Ethics, and Society"],
      ["SIGKDD", "Knowledge Discovery and Data Mining"],
      ["SIGMOD", "Proceedings of the 2021 International Conference on Management of Data"],
      ["AISTATS", "International Conference on Artificial Intelligence and Statistics"],
      ["PVLDB", "Proceedings of the VLDB Endowment"],
      ["Communications of the ACM", "CACM"],
      ["3rd Workshop on Gender Bias in Natural Language Processing", "GEBNLP"],
      ["Proceedings of the Third Annual Symposium on Computational Geometry", "SCG '87"],
    ]) assert.equal(sev("booktitle", short, full), SEVERITY.MINOR, `${short} ~ ${full}`);
  });

  it("fabricated venue variants are never minor", () => {
    for (const [real, fake] of [
      ["2019 IEEE 35th International Conference on Data Engineering (ICDE)", "2019 IEEE 35th International Conference on Data Engineering (ICDM)"],
      ["Data Mining and Knowledge Discovery", "Database Mining and Knowledge Discovery"],
      ["Frontiers in Big Data", "Frontiers in Big Database"],
      ["The VLDB Journal", "The VLDB Transactions"],
      ["ICASSP 2022 - 2022 IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP)",
        "ICASSP 2022-2022 IEEE International Conference on Acoustics, Speech and Signal Analysis (ICASSP)"],
      ["ICDE", "ICDE Workshops"],
      ["Proceedings of the 58th Annual Meeting of the Association for Computational Linguistics",
        "Findings of the Association for Computational Linguistics"],
      ["Knowledge Discovery and Data Mining", "Pacific-Asia Conference on Knowledge Discovery and Data Mining"],
      ["IEEE Transactions on Knowledge and Data Engineering", "IEEE Trans. Knowl. Discov. Data"],
      ["IEEE International Conference on Data Engineering", "International Conference on Knowledge and Data Engineering"],
      ["Workshop on Algorithms and Data Structures", "WADS Workshops"],
      ["Journal of Machine Learning Research", "Machine Learning"],
      ["IEEE Transactions on Visualization and Computer Graphics", "ACM Transactions on Visualization and Computer Graphics"],
    ]) assert.equal(sev("booktitle", fake, real), SEVERITY.MAJOR, `${fake} vs ${real}`);
  });

  it("acronyms don't match unrelated venues", () => {
    assert.equal(sev("booktitle", "ICML", "International Conference on Learning Representations"), SEVERITY.MAJOR);
    assert.equal(sev("booktitle", "ICML", "Advances in Neural Information Processing Systems"), SEVERITY.MAJOR);
    assert.equal(sev("booktitle", "Proceedings of The ACM Collective Intelligence Conference",
      "International Conference on Climate Informatics"), SEVERITY.MAJOR);
  });

  it("a book series can't confirm your venue: review", () => {
    assert.equal(sev("booktitle", "International Conference on Artificial Neural Networks", "Lecture Notes in Computer Science"), SEVERITY.MAJOR);
  });

  it("ISO-style abbreviation is minor", () => {
    // A brand abbreviation ("WIREs") isn't provable from the words alone; it's
    // reviewed rather than risk passing off a different journal.
    assert.equal(sev("journal", "Wiley Interdisciplinary Reviews: Data Mining and Knowledge Discovery",
      "WIREs Data Mining Knowl. Discov."), SEVERITY.MAJOR);
    assert.equal(sev("journal", "Multimed. Tools Appl", "Multimedia Tools and Applications"), SEVERITY.MINOR);
    assert.equal(sev("journal", "Proc. VLDB Endow.", "Proceedings of the VLDB Endowment"), SEVERITY.MINOR);
  });

  it("a genuinely different venue is major", () => {
    assert.equal(sev("journal", "Wrong Venue Placeholder", "Neural Information Processing Systems"), SEVERITY.MAJOR);
    assert.equal(sev("booktitle", "ICML", "Advances in Neural Information Processing Systems"), SEVERITY.MAJOR);
  });

  it("arXiv cited but published version found is major", () => {
    const r = classifyDiff({ field: "journal", original: "arXiv preprint arXiv:2402.01071", found: "Proceedings of the VLDB Endowment" });
    assert.equal(r.severity, SEVERITY.MAJOR);
    assert.match(r.reason, /published version/);
  });

  it("a published venue the database only knows as a preprint is reviewed", () => {
    // Claiming a venue for an arXiv-only paper is a classic fabrication.
    const r = classifyDiff({ field: "journal", original: "SIGMOD", found: "arXiv.org" });
    assert.equal(r.severity, SEVERITY.MAJOR);
    assert.match(r.reason, /not confirmed/);
  });

  it("sameVenue is symmetric for abbreviations", () => {
    assert.ok(sameVenue("Proceedings of the VLDB Endowment", "Proc. VLDB Endow."));
  });
});

describe("classifyDiff: other fields", () => {
  it("year off by one is minor, by many is major", () => {
    assert.equal(sev("year", "2012", "2013"), SEVERITY.MINOR);
    assert.equal(sev("year", "2010", "1993"), SEVERITY.MAJOR);
  });

  it("citing a preprint up to 2 years before publication is minor; other gaps are major", () => {
    const citesArxiv = { journal: "arXiv preprint arXiv:1234.5678" };
    assert.equal(sev("year", "2019", "2021", citesArxiv), SEVERITY.MINOR);
    assert.equal(sev("year", "2018", "2021", citesArxiv), SEVERITY.MAJOR);
    assert.equal(sev("year", "2021", "2019", {}, { journal: "arXiv" }), SEVERITY.MAJOR);
  });

  it("DOI formatting is minor, a different DOI is major", () => {
    assert.equal(sev("doi", "https://doi.org/10.1145/ABC", "10.1145/abc"), SEVERITY.MINOR);
    assert.equal(sev("doi", "10.1145/abc", "10.1145/xyz"), SEVERITY.MAJOR);
    assert.equal(normalizeDoi("doi: 10.1/X"), "10.1/x");
  });

  it("page formatting and partial ranges are minor", () => {
    assert.equal(sev("pages", "554--565", "554-565"), SEVERITY.MINOR);
    assert.equal(sev("pages", "554", "554-565"), SEVERITY.MINOR);
    assert.equal(sev("pages", "2345-56", "2345-2356"), SEVERITY.MINOR);
    assert.equal(sev("pages", "5-10", "200-210"), SEVERITY.MAJOR);
    assert.equal(sev("pages", "772--773", "3344-3353"), SEVERITY.MAJOR);
  });

  it("article-relative and slightly shifted page ranges are minor", () => {
    assert.equal(sev("pages", "1--24", "1283-1306"), SEVERITY.MINOR);
    assert.equal(sev("pages", "4401--4410", "4396-4405"), SEVERITY.MINOR);
    assert.equal(sev("pages", "1--14", "6146-6150"), SEVERITY.MAJOR);
  });

  it("volume/number with extra parts is minor", () => {
    assert.equal(sev("number", "1", "1-4"), SEVERITY.MINOR);
    assert.equal(sev("volume", "5 2", "5"), SEVERITY.MINOR);
    assert.equal(sev("volume", "13", "65"), SEVERITY.MAJOR);
    assert.equal(sev("number", "03", "3"), SEVERITY.MINOR);
  });

  it("acronym synonyms match", () => {
    assert.equal(sev("booktitle", "SOCG", "SCG '85"), SEVERITY.MINOR);
    assert.equal(sev("booktitle", "NIPS", "NeurIPS"), SEVERITY.MINOR);
  });

  it("DOI LaTeX escapes are minor", () => {
    assert.equal(sev("doi", "10.1007/3-540-44842-X\\_81", "10.1007/3-540-44842-X_81"), SEVERITY.MINOR);
  });

  it("publisher aliases are minor", () => {
    assert.equal(sev("publisher", "ACM", "Association for Computing Machinery"), SEVERITY.MINOR);
    assert.equal(sev("publisher", "Taylor \\& Francis", "Informa UK Limited"), SEVERITY.MINOR);
    assert.equal(sev("publisher", "Springer Science \\& Business Media", "Springer Nature"), SEVERITY.MINOR);
  });

  it("a different publisher keeps yours without a review", () => {
    const r = classifyDiff({ field: "publisher", original: "Frontiers", found: "Elsevier BV" });
    assert.equal(r.severity, SEVERITY.MINOR);
    assert.equal(r.prefer, "original");
    const result = { status: "updated" };
    assert.equal(adoptsByDefault(result, { field: "publisher", original: "Frontiers", ...r }), false);
  });

  it("a missing field is an enrichment", () => {
    assert.equal(sev("doi", "", "10.1/x"), SEVERITY.ENRICHMENT);
  });

  it("maxSeverity picks the worst", () => {
    assert.equal(maxSeverity([{ severity: "minor" }, { severity: "major" }]), "major");
    assert.equal(maxSeverity([]), null);
  });
});

describe("buildResult triage", () => {
  const entry = {
    ID: "k", ENTRYTYPE: "article", title: "A Study of Things",
    author: "Smith, John and Doe, Jane", year: "2020", journal: "IEEE Trans. Pattern Anal. Mach. Intell.",
  };

  it("only cosmetic differences stay auto-updated and adopt suggestions", () => {
    const r = buildResult(entry, 0, {
      title: "A study of things", author: "John Smith and Jane Doe", year: "2021",
      journal: "IEEE Transactions on Pattern Analysis and Machine Intelligence", doi: "10.1/x",
    });
    assert.equal(r.status, "updated");
    assert.equal(r.review_reason, null);
    for (const d of r.field_diffs) assert.equal(adoptsByDefault(r, d), true, d.field);
  });

  it("with applyMinor off, formatting fixes keep the user's text but enrichments still apply", () => {
    const r = buildResult(entry, 0, {
      title: "A study of things", author: "John Smith and Jane Doe", year: "2020",
      journal: "IEEE Transactions on Pattern Analysis and Machine Intelligence", doi: "10.1/x",
    });
    const opts = { applyMinor: false };
    const journal = r.field_diffs.find(d => d.field === "journal");
    assert.equal(journal.severity, SEVERITY.MINOR);
    assert.equal(adoptsByDefault(r, journal, opts), false);
    assert.equal(adoptsByDefault(r, journal), true);
    assert.equal(adoptsByDefault(r, r.field_diffs.find(d => d.field === "doi"), opts), true);
  });

  it("a major difference needs review and keeps the user's value", () => {
    const r = buildResult(entry, 0, {
      title: "A Study of Things", author: "John Smith", year: "2020",
      journal: "IEEE Transactions on Pattern Analysis and Machine Intelligence", doi: "10.1/x",
    });
    assert.equal(r.status, "needs_review");
    assert.equal(r.review_reason, "fields");
    assert.equal(r.field_diffs[0].field, "author");
    // Needs review: nothing is adopted, not even safe additions.
    for (const d of r.field_diffs) assert.equal(adoptsByDefault(r, d), false, d.field);
    assert.equal(r.published_only, false);
  });

  describe("citing a preprint of a published paper", () => {
    const preprint = {
      ID: "c", ENTRYTYPE: "article", title: "Chameleon: Foundation Models for Coverage",
      author: "Erfanian, Mahdi and Jagadish, HV and Asudeh, Abolfazl",
      journal: "arXiv preprint arXiv:2402.01071", year: "2024",
    };
    const published = {
      title: "Chameleon: Foundation Models for Coverage",
      author: "Mahdi Erfanian and H. V. Jagadish and Abolfazl Asudeh",
      journal: "Proceedings of the VLDB Endowment", year: "2024", volume: "17", doi: "10.14778/x",
    };

    it("needs review with every row on the original when preferPublished is off", () => {
      const r = buildResult(preprint, 0, published, null, { preferPublished: false });
      assert.equal(r.status, "needs_review");
      assert.equal(r.published_only, true);
      for (const d of r.field_diffs) assert.equal(adoptsByDefault(r, d), false, d.field);
    });

    it("is auto-updated to the published version when preferPublished is on", () => {
      const r = buildResult(preprint, 0, published, null, { preferPublished: true });
      assert.equal(r.status, "updated");
      for (const d of r.field_diffs) assert.equal(adoptsByDefault(r, d), true, d.field);
    });

    it("applyPublishedPreference flips only published-only results", () => {
      const r = buildResult(preprint, 0, published, null, { preferPublished: false });
      assert.equal(applyPublishedPreference(r, true).status, "updated");
      assert.equal(applyPublishedPreference(applyPublishedPreference(r, true), false).status, "needs_review");
      const other = buildResult(preprint, 0, { ...published, author: "Mahdi Erfanian" }, null, { preferPublished: true });
      assert.equal(other.status, "needs_review");
      assert.equal(other.published_only, false);
    });
  });

  it("same title with no common authors is a different work; nothing is adopted", () => {
    const r = buildResult(entry, 0, { title: "A Study of Things", author: "Roe, Richard", year: "1990", doi: "10.1/y" });
    assert.equal(r.status, "needs_review");
    assert.equal(r.review_reason, "different_work");
    for (const d of r.field_diffs) assert.equal(adoptsByDefault(r, d), false, d.field);
  });

  it("lists fields the database couldn't check", () => {
    const r = buildResult({ ...entry, pages: "1-10", volume: "4" }, 0, {
      title: "A Study of Things", author: "John Smith and Jane Doe", year: "2020",
      journal: "IEEE Transactions on Pattern Analysis and Machine Intelligence",
    });
    assert.deepEqual(r.unchecked, ["volume", "pages"]);
  });

  it("weak title matches keep the existing behavior", () => {
    const r = buildResult(entry, 0, { title: "Something Else Entirely", year: "2021" });
    assert.equal(r.status, "needs_review");
    assert.equal(r.review_reason, "title");
  });
});
