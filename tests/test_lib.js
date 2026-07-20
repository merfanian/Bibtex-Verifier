const assert = require("assert");
// Load the same fuzzy-matching library the browser pulls from unpkg so the
// tests exercise the real `token_sort_ratio`, not lib.js's crude fallback.
// lib.js reads `fuzzball` as a global at call time, so expose it here.
try {
  global.fuzzball = require("fuzzball");
} catch {
  console.warn("⚠ fuzzball not installed — run `npm install`; tests fall back to the approximate matcher.");
}
const lib = require("../docs/lib.js");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── stripLatex ──");

test("removes LaTeX accents", () => {
  assert.strictEqual(lib.stripLatex("\\'a"), "á");
  assert.strictEqual(lib.stripLatex('\\"o'), "ö");
  assert.strictEqual(lib.stripLatex("\\~n"), "ñ");
});

test("removes LaTeX commands", () => {
  assert.strictEqual(lib.stripLatex("\\textbf{bold}"), "bold");
  assert.strictEqual(lib.stripLatex("\\emph{text}"), "text");
});

test("removes braces", () => {
  assert.strictEqual(lib.stripLatex("{Hello} {World}"), "Hello World");
});

test("returns empty for falsy input", () => {
  assert.strictEqual(lib.stripLatex(""), "");
  assert.strictEqual(lib.stripLatex(null), "");
  assert.strictEqual(lib.stripLatex(undefined), "");
});

test("handles combined LaTeX", () => {
  const input = "Ren\\'{e} {D}escartes";
  const result = lib.stripLatex(input);
  assert.ok(result.includes("Descartes"), `Expected Descartes in "${result}"`);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── normalizeTitle ──");

test("lowercases and strips LaTeX", () => {
  assert.strictEqual(lib.normalizeTitle("{Attention} Is All You Need"), "attention is all you need");
});

test("handles empty string", () => {
  assert.strictEqual(lib.normalizeTitle(""), "");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── parseBib ──");

test("parses a single article entry", () => {
  const bib = `@article{vaswani2017,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish},
  year = {2017},
}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].ENTRYTYPE, "article");
  assert.strictEqual(entries[0].ID, "vaswani2017");
  assert.strictEqual(entries[0].title, "Attention Is All You Need");
  assert.strictEqual(entries[0].author, "Vaswani, Ashish");
  assert.strictEqual(entries[0].year, "2017");
});

test("parses multiple entries", () => {
  const bib = `@article{a, title={Paper A}, year={2020}}
@inproceedings{b, title={Paper B}, year={2021}}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].ID, "a");
  assert.strictEqual(entries[1].ID, "b");
  assert.strictEqual(entries[1].ENTRYTYPE, "inproceedings");
});

test("skips @string and @comment entries", () => {
  const bib = `@string{foo = {bar}}

@comment{This is a comment, with commas}

@article{real, title={Real Entry}, year={2023}}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].ID, "real");
});

test("handles double-quoted field values", () => {
  const bib = `@article{test, title="Quoted Title", year={2023}}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries[0].title, "Quoted Title");
});

test("handles numeric field values", () => {
  const bib = `@article{test, title={Test}, year=2023}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries[0].year, "2023");
});

test("returns empty array for invalid input", () => {
  assert.deepStrictEqual(lib.parseBib("not bibtex"), []);
  assert.deepStrictEqual(lib.parseBib(""), []);
});

test("parses misc with missing closing braces before next field (double-brace typos)", () => {
  const bib = `@misc{github_copilot_2025,
  author = {{GitHub},
  title = {{GitHub Copilot},
  howpublished = {\\url{https://github.com/features/copilot},
  year = {2025},
  note = {Accessed: 2025-06-01},
}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].author, "{GitHub}");
  assert.strictEqual(entries[0].title, "{GitHub Copilot}");
  assert.ok(entries[0].howpublished.includes("github.com/features/copilot"));
  assert.strictEqual(entries[0].year, "2025");
});

test("keeps fields after an '@' inside a value (email in note)", () => {
  const bib = `@article{k1,
  title = {A study of foo},
  note = {contact author at foo@bar.edu},
  year = {2020},
}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].note, "contact author at foo@bar.edu");
  assert.strictEqual(entries[0].year, "2020");
});

test("does not split one entry into two on an '@' in a value", () => {
  const bib = `@article{k1,
  title = {First},
  url = {https://example.com/@handle/post},
  year = {2020},
}
@article{k2,
  title = {Second},
  year = {2021},
}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].ID, "k1");
  assert.strictEqual(entries[0].url, "https://example.com/@handle/post");
  assert.strictEqual(entries[0].year, "2020");
  assert.strictEqual(entries[1].ID, "k2");
  assert.strictEqual(entries[1].year, "2021");
});

test("parses misc Cursor-style malformed braces", () => {
  const bib = `@misc{cursor_2025,
  author = {{Anysphere},
  title = {{Cursor: The AI Code Editor},
  howpublished = {\\url{https://www.cursor.com},
  year = {2025},
}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].author, "{Anysphere}");
  assert.strictEqual(entries[0].title, "{Cursor: The AI Code Editor}");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── entriesToBib ──");

test("serializes entries back to BibTeX", () => {
  const entries = [{ ENTRYTYPE: "article", ID: "test2023", title: "My Paper", year: "2023" }];
  const bib = lib.entriesToBib(entries);
  assert.ok(bib.includes("@article{test2023,"));
  assert.ok(bib.includes("title = {My Paper}"));
  assert.ok(bib.includes("year = {2023}"));
});

test("skips internal fields starting with _", () => {
  const entries = [{ ENTRYTYPE: "article", ID: "x", title: "T", _source: "crossref" }];
  const bib = lib.entriesToBib(entries);
  assert.ok(!bib.includes("_source"));
});

test("round-trips parse → serialize", () => {
  const original = `@inproceedings{bert2019,
  title = {BERT: Pre-training of Deep Bidirectional Transformers},
  author = {Devlin, Jacob},
  year = {2019},
}`;
  const entries = lib.parseBib(original);
  const serialized = lib.entriesToBib(entries);
  const reparsed = lib.parseBib(serialized);
  assert.strictEqual(reparsed.length, 1);
  assert.strictEqual(reparsed[0].title, entries[0].title);
  assert.strictEqual(reparsed[0].author, entries[0].author);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── titleSimilarity ──");

test("identical titles score 100", () => {
  assert.strictEqual(lib.titleSimilarity("Attention Is All You Need", "Attention Is All You Need"), 100);
});

test("case-insensitive comparison", () => {
  assert.strictEqual(lib.titleSimilarity("attention is all you need", "ATTENTION IS ALL YOU NEED"), 100);
});

test("completely different titles score low", () => {
  const score = lib.titleSimilarity("Attention Is All You Need", "Quantum Chromodynamics at Finite Baryon Density");
  assert.ok(score < 75, `Expected < 75, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── normalizeText ──");

test("removes diacritics and lowercases", () => {
  assert.strictEqual(lib.normalizeText("René Descartes"), "rene descartes");
});

test("collapses whitespace", () => {
  assert.strictEqual(lib.normalizeText("  hello   world  "), "hello world");
});

test("returns empty for falsy input", () => {
  assert.strictEqual(lib.normalizeText(""), "");
  assert.strictEqual(lib.normalizeText(null), "");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── normalizeAuthorSet ──");

test("extracts last names from 'Last, First' format", () => {
  const names = lib.normalizeAuthorSet("Vaswani, Ashish and Shazeer, Noam");
  assert.ok(names.has("vaswani"));
  assert.ok(names.has("shazeer"));
  assert.strictEqual(names.size, 2);
});

test("extracts last names from 'First Last' format", () => {
  const names = lib.normalizeAuthorSet("Ashish Vaswani and Noam Shazeer");
  assert.ok(names.has("vaswani"));
  assert.ok(names.has("shazeer"));
});

test("returns empty set for empty input", () => {
  assert.strictEqual(lib.normalizeAuthorSet("").size, 0);
  assert.strictEqual(lib.normalizeAuthorSet(null).size, 0);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── normalizePages ──");

test("normalizes different dash styles", () => {
  assert.strictEqual(lib.normalizePages("1--10"), "1-10");
  assert.strictEqual(lib.normalizePages("1 - 10"), "1-10");
  assert.strictEqual(lib.normalizePages("1---10"), "1-10");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── compareAuthors ──");

test("identical authors score 100", () => {
  assert.strictEqual(lib.compareAuthors("Vaswani, Ashish", "Vaswani, Ashish"), 100);
});

test("same last names, different format still match", () => {
  const score = lib.compareAuthors("Vaswani, Ashish and Shazeer, Noam", "Ashish Vaswani and Noam Shazeer");
  assert.strictEqual(score, 100);
});

test("no overlap scores 0", () => {
  assert.strictEqual(lib.compareAuthors("Smith, John", "Doe, Jane"), 0);
});

test("both empty scores 100", () => {
  assert.strictEqual(lib.compareAuthors("", ""), 100);
});

test("one empty scores 0", () => {
  assert.strictEqual(lib.compareAuthors("Smith, John", ""), 0);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── compareField ──");

test("year comparison is exact", () => {
  assert.strictEqual(lib.compareField("year", "2023", "2023"), 100);
  assert.strictEqual(lib.compareField("year", "2023", "2024"), 0);
});

test("doi comparison is exact and case-insensitive", () => {
  assert.strictEqual(lib.compareField("doi", "10.1234/abc", "10.1234/ABC"), 100);
});

test("pages with different dashes match", () => {
  assert.strictEqual(lib.compareField("pages", "1--10", "1-10"), 100);
});

test("both empty returns 100", () => {
  assert.strictEqual(lib.compareField("journal", "", ""), 100);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── compareEntry ──");

test("verified when all fields match", () => {
  const orig = { title: "Attention Is All You Need", author: "Vaswani, Ashish", year: "2017" };
  const found = { title: "Attention Is All You Need", author: "Vaswani, Ashish", year: "2017" };
  const result = lib.compareEntry(orig, found);
  assert.strictEqual(result.status, "verified");
});

test("updated when fields differ", () => {
  const orig = { title: "Attention Is All You Need", year: "2017" };
  const found = { title: "Attention Is All You Need", year: "2018" };
  const result = lib.compareEntry(orig, found);
  assert.strictEqual(result.status, "updated");
  assert.ok(result.field_diffs.some(d => d.field === "year"));
});

test("needs_review when titles differ significantly", () => {
  const orig = { title: "Attention Is All You Need" };
  const found = { title: "On the Origin of Species" };
  const result = lib.compareEntry(orig, found);
  assert.strictEqual(result.status, "needs_review");
});

test("enrichments mark entry as updated", () => {
  const orig = { title: "Test Paper", year: "2023" };
  const found = { title: "Test Paper", year: "2023", doi: "10.1234/test" };
  const result = lib.compareEntry(orig, found);
  assert.strictEqual(result.status, "updated");
  assert.ok(result.field_diffs.some(d => d.field === "doi"), "should report doi enrichment");
});

test("does not suggest the older year when found is a preprint", () => {
  // User has the published venue year (2021); the arXiv record is from 2020.
  const orig = { title: "Great Paper", year: "2021", journal: "NeurIPS" };
  const found = { title: "Great Paper", year: "2020", journal: "arXiv" };
  const result = lib.compareEntry(orig, found);
  assert.ok(!result.field_diffs.some(d => d.field === "year"),
    "should not flag the preprint's earlier year");
});

test("still flags a genuine year mismatch for non-preprint records", () => {
  const orig = { title: "Great Paper", year: "2021", journal: "NeurIPS" };
  const found = { title: "Great Paper", year: "2019", journal: "NeurIPS" };
  const result = lib.compareEntry(orig, found);
  assert.ok(result.field_diffs.some(d => d.field === "year"),
    "non-preprint year mismatch should still be reported");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── fieldDiffsForNeedsReview ──");

test("returns empty array when found is null", () => {
  assert.deepStrictEqual(lib.fieldDiffsForNeedsReview({ title: "X" }, null), []);
});

test("includes title and differing fields for a weak title match", () => {
  const orig = {
    title: "My Completely Different Title",
    author: "Smith, Alice",
    year: "2020",
  };
  const found = {
    title: "Attention Is All You Need",
    author: "Vaswani, Ashish",
    year: "2017",
    journal: "NeurIPS",
  };
  const diffs = lib.fieldDiffsForNeedsReview(orig, found);
  assert.ok(diffs.some(d => d.field === "title"));
  assert.ok(diffs.some(d => d.field === "author"));
  assert.ok(diffs.some(d => d.field === "year"));
  assert.ok(diffs.some(d => d.field === "journal"));
});

test("includes enrichment fields from found", () => {
  const orig = { title: "Different Title Here", year: "2023" };
  const found = { title: "Another Title", year: "2023", doi: "10.1000/182" };
  const diffs = lib.fieldDiffsForNeedsReview(orig, found);
  assert.ok(diffs.some(d => d.field === "doi" && d.score === 0), "doi should be enrichment");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── crossrefToStandard ──");

test("converts CrossRef response to standard format", () => {
  const item = {
    title: ["Attention Is All You Need"],
    author: [{ family: "Vaswani", given: "Ashish" }],
    "published-print": { "date-parts": [[2017]] },
    "container-title": ["NeurIPS"],
    DOI: "10.5555/3295222.3295349",
    volume: "30",
    page: "5998-6008",
  };
  const result = lib.crossrefToStandard(item);
  assert.strictEqual(result.title, "Attention Is All You Need");
  assert.strictEqual(result.author, "Vaswani, Ashish");
  assert.strictEqual(result.year, "2017");
  assert.strictEqual(result.doi, "10.5555/3295222.3295349");
  assert.strictEqual(result._source, "crossref");
});

test("handles missing fields gracefully", () => {
  const result = lib.crossrefToStandard({});
  assert.strictEqual(result.title, "");
  assert.strictEqual(result.author, "");
  assert.strictEqual(result.year, "");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── ssToStandard ──");

test("converts Semantic Scholar response to standard format", () => {
  const paper = {
    title: "BERT",
    authors: [{ name: "Jacob Devlin" }, { name: "Ming-Wei Chang" }],
    year: 2019,
    venue: "NAACL",
    externalIds: { DOI: "10.18653/v1/N19-1423" },
  };
  const result = lib.ssToStandard(paper);
  assert.strictEqual(result.title, "BERT");
  assert.strictEqual(result.author, "Devlin, Jacob and Chang, Ming-Wei");
  assert.strictEqual(result.year, "2019");
  assert.strictEqual(result.journal, "NAACL");
  assert.strictEqual(result._source, "semantic_scholar");
});

test("prefers publicationVenue.name over venue string", () => {
  const paper = {
    title: "Test",
    authors: [],
    year: 2023,
    venue: "short",
    publicationVenue: { name: "Full Venue Name" },
    externalIds: {},
  };
  const result = lib.ssToStandard(paper);
  assert.strictEqual(result.journal, "Full Venue Name");
});

test("falls back to arXiv venue for preprint-only records", () => {
  const paper = {
    title: "A Preprint",
    year: 2020,
    authors: [{ name: "Alice Smith" }],
    externalIds: { ArXiv: "2001.00001" },
  };
  const result = lib.ssToStandard(paper);
  assert.strictEqual(result.journal, "arXiv");
  assert.strictEqual(lib.isPreprint(result), true);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── openAlexToStandard ──");

test("converts OpenAlex response to standard format", () => {
  const work = {
    title: "Attention Is All You Need",
    publication_year: 2017,
    doi: "https://doi.org/10.5555/3295222.3295349",
    authorships: [
      { author: { display_name: "Ashish Vaswani" } },
      { author: { display_name: "Noam Shazeer" } },
    ],
    primary_location: { source: { display_name: "NeurIPS", host_organization_name: "MIT Press" } },
    biblio: { volume: "30", issue: "1", first_page: "5998", last_page: "6008" },
  };
  const result = lib.openAlexToStandard(work);
  assert.strictEqual(result.title, "Attention Is All You Need");
  assert.strictEqual(result.author, "Vaswani, Ashish and Shazeer, Noam");
  assert.strictEqual(result.year, "2017");
  assert.strictEqual(result.journal, "NeurIPS");
  assert.strictEqual(result.volume, "30");
  assert.strictEqual(result.number, "1");
  assert.strictEqual(result.pages, "5998-6008");
  assert.strictEqual(result.doi, "10.5555/3295222.3295349", "DOI URL prefix should be stripped");
  assert.strictEqual(result.publisher, "MIT Press");
  assert.strictEqual(result._source, "openalex");
});

test("falls back to display_name and handles missing fields", () => {
  const result = lib.openAlexToStandard({ display_name: "A Title", id: "https://openalex.org/W1" });
  assert.strictEqual(result.title, "A Title");
  assert.strictEqual(result.author, "");
  assert.strictEqual(result.year, "");
  assert.strictEqual(result.doi, "");
  assert.strictEqual(result.url, "https://openalex.org/W1");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── extractLastNames ──");

test("extracts from 'Last, First and Last, First' format", () => {
  const names = lib.extractLastNames("Vaswani, Ashish and Shazeer, Noam");
  assert.ok(names.has("vaswani"));
  assert.ok(names.has("shazeer"));
});

test("extracts from 'First Last' format", () => {
  const names = lib.extractLastNames("Ashish Vaswani");
  assert.ok(names.has("vaswani"));
});

test("returns empty set for empty input", () => {
  assert.strictEqual(lib.extractLastNames("").size, 0);
  assert.strictEqual(lib.extractLastNames(null).size, 0);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── isSamePaper ──");

test("same paper returns true", () => {
  const a = { title: "Attention Is All You Need", year: "2017", author: "Vaswani, Ashish" };
  const b = { title: "Attention Is All You Need", year: "2017", author: "Vaswani, Ashish" };
  assert.strictEqual(lib.isSamePaper(a, b), true);
});

test("different titles returns false", () => {
  const a = { title: "Paper A" };
  const b = { title: "Completely Different Paper" };
  assert.strictEqual(lib.isSamePaper(a, b), false);
});

test("different years returns false", () => {
  const a = { title: "Attention Is All You Need", year: "2017" };
  const b = { title: "Attention Is All You Need", year: "2020" };
  assert.strictEqual(lib.isSamePaper(a, b), false);
});

test("treats preprint and published years within tolerance as the same paper", () => {
  const preprint = { title: "Attention Is All You Need", year: "2016", author: "Vaswani, Ashish" };
  const published = { title: "Attention Is All You Need", year: "2017", author: "Vaswani, Ashish" };
  assert.strictEqual(lib.isSamePaper(preprint, published), true);
});

// ════════════════════════════════════════════════════════════════
console.log("\n── isPreprint ──");

test("detects arXiv by venue, DOI, and URL", () => {
  assert.strictEqual(lib.isPreprint({ journal: "arXiv" }), true);
  assert.strictEqual(lib.isPreprint({ journal: "arXiv.org" }), true);
  assert.strictEqual(lib.isPreprint({ doi: "10.48550/arXiv.1706.03762" }), true);
  assert.strictEqual(lib.isPreprint({ url: "https://arxiv.org/abs/1706.03762" }), true);
  assert.strictEqual(lib.isPreprint({ journal: "CoRR" }), true);
});

test("does not flag published venues as preprints", () => {
  assert.strictEqual(lib.isPreprint({ journal: "NeurIPS", doi: "10.5555/x" }), false);
  assert.strictEqual(lib.isPreprint({}), false);
  assert.strictEqual(lib.isPreprint(null), false);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── mergeMetadata ──");

test("primary fields take precedence", () => {
  const primary = { title: "A", year: "2020", _source: "ss" };
  const secondary = { title: "B", year: "2021", doi: "10.1234", _source: "cr" };
  const merged = lib.mergeMetadata(primary, secondary);
  assert.strictEqual(merged.title, "A");
  assert.strictEqual(merged.year, "2020");
  assert.strictEqual(merged.doi, "10.1234");
  assert.strictEqual(merged._source, "ss+cr");
});

test("fills empty fields from secondary", () => {
  const primary = { title: "A", _source: "ss" };
  const secondary = { doi: "10.1234", volume: "5", _source: "cr" };
  const merged = lib.mergeMetadata(primary, secondary);
  assert.strictEqual(merged.doi, "10.1234");
  assert.strictEqual(merged.volume, "5");
});

test("published record wins bibliographic fields over a preprint primary", () => {
  const preprint = { title: "A", year: "2020", journal: "arXiv", _source: "semantic_scholar" };
  const published = { title: "A", year: "2021", journal: "NeurIPS", doi: "10.1/x", _source: "crossref" };
  const merged = lib.mergeMetadata(preprint, published);
  assert.strictEqual(merged.year, "2021", "published year should win");
  assert.strictEqual(merged.journal, "NeurIPS", "published venue should win");
  assert.strictEqual(merged.doi, "10.1/x");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── bestMatch ──");

test("returns best matching candidate above threshold", () => {
  const candidates = [
    { title: "Completely Wrong" },
    { title: "Attention Is All You Need" },
  ];
  const result = lib.bestMatch(candidates, "Attention Is All You Need");
  assert.strictEqual(result.title, "Attention Is All You Need");
});

test("returns null when no candidate meets threshold", () => {
  const candidates = [{ title: "Quantum Chromodynamics at Finite Baryon Density" }];
  const result = lib.bestMatch(candidates, "Attention Is All You Need");
  assert.strictEqual(result, null);
});

test("returns null for empty candidates", () => {
  assert.strictEqual(lib.bestMatch([], "test"), null);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── abbreviateVenue ──");

test("abbreviates known venues", () => {
  assert.strictEqual(lib.abbreviateVenue("Advances in Neural Information Processing Systems"), "NeurIPS");
  assert.strictEqual(lib.abbreviateVenue("International Conference on Machine Learning"), "ICML");
  assert.strictEqual(lib.abbreviateVenue("IEEE Conference on Computer Vision and Pattern Recognition"), "CVPR");
});

test("returns original for unknown venues", () => {
  assert.strictEqual(lib.abbreviateVenue("Some Unknown Workshop"), "Some Unknown Workshop");
});

test("handles null/empty gracefully", () => {
  assert.strictEqual(lib.abbreviateVenue(""), "");
  assert.strictEqual(lib.abbreviateVenue(null), null);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── expandVenue ──");

test("expands known abbreviations", () => {
  const result = lib.expandVenue("NeurIPS");
  assert.ok(result.toLowerCase().includes("neural information processing"), `Got: ${result}`);
});

test("returns original for unknown abbreviations", () => {
  assert.strictEqual(lib.expandVenue("XYZCONF"), "XYZCONF");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── Constants ──");

test("TITLE_MATCH_THRESHOLD is reasonable", () => {
  assert.ok(lib.TITLE_MATCH_THRESHOLD >= 70 && lib.TITLE_MATCH_THRESHOLD <= 100);
});

test("MIN_TITLE_SIM is reasonable", () => {
  assert.ok(lib.MIN_TITLE_SIM >= 50 && lib.MIN_TITLE_SIM <= 90);
});

test("COMPARED_FIELDS contains expected fields", () => {
  assert.ok(lib.COMPARED_FIELDS.includes("author"));
  assert.ok(lib.COMPARED_FIELDS.includes("year"));
  assert.ok(lib.COMPARED_FIELDS.includes("doi"));
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── entryMatchesQuery ──");

test("empty / whitespace query matches everything", () => {
  const e = { title: "Foo", ID: "bar" };
  assert.strictEqual(lib.entryMatchesQuery(e, ""), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "   "), true);
  assert.strictEqual(lib.entryMatchesQuery(e, null), true);
});

test("case-insensitive substring match on title and key", () => {
  const e = { title: "Attention Is All You Need", ID: "vaswani2017attention" };
  assert.strictEqual(lib.entryMatchesQuery(e, "attention"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "VASWANI"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "transformer"), false);
});

test("AND-of-tokens: every token must match somewhere", () => {
  const e = { title: "Attention Is All You Need", ID: "vaswani2017attention" };
  assert.strictEqual(lib.entryMatchesQuery(e, "attention vaswani"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "attention nope"), false);
});

test("field-qualified tokens scope the match", () => {
  const e = { title: "Compositional Generation", ID: "liu2022work" };
  assert.strictEqual(lib.entryMatchesQuery(e, "title:compositional"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "title:liu"), false);
  assert.strictEqual(lib.entryMatchesQuery(e, "id:liu2022"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "key:liu2022"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "id:compositional"), false);
});

test("uses entry_id (result shape) when ID is absent", () => {
  const r = { title: "Foo", entry_id: "smith2020foo" };
  assert.strictEqual(lib.entryMatchesQuery(r, "smith"), true);
});

test("strips LaTeX from title before matching", () => {
  const e = { title: "{Caf\\'e} Studies", ID: "x" };
  assert.strictEqual(lib.entryMatchesQuery(e, "café"), true);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n══════════════════════════════════");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════\n");

process.exit(failed > 0 ? 1 : 0);
