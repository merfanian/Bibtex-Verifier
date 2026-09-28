import "./helpers/setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crossrefToStandard, isPreprint, openAlexToStandard, ssToStandard } from "../src/lib/index.js";

describe("crossrefToStandard", () => {
  it("converts CrossRef response to standard format", () => {
    const result = crossrefToStandard({
      title: ["Attention Is All You Need"],
      author: [{ family: "Vaswani", given: "Ashish" }],
      "published-print": { "date-parts": [[2017]] },
      "container-title": ["NeurIPS"],
      DOI: "10.5555/3295222.3295349",
      volume: "30",
      page: "5998-6008",
    });
    assert.equal(result.title, "Attention Is All You Need");
    assert.equal(result.author, "Vaswani, Ashish");
    assert.equal(result.year, "2017");
    assert.equal(result.doi, "10.5555/3295222.3295349");
    assert.equal(result._source, "crossref");
  });

  it("handles missing fields gracefully", () => {
    const result = crossrefToStandard({});
    assert.equal(result.title, "");
    assert.equal(result.author, "");
    assert.equal(result.year, "");
  });
});

describe("ssToStandard", () => {
  it("converts Semantic Scholar response to standard format", () => {
    const result = ssToStandard({
      title: "BERT",
      authors: [{ name: "Jacob Devlin" }, { name: "Ming-Wei Chang" }],
      year: 2019,
      venue: "NAACL",
      externalIds: { DOI: "10.18653/v1/N19-1423" },
    });
    assert.equal(result.title, "BERT");
    assert.equal(result.author, "Devlin, Jacob and Chang, Ming-Wei");
    assert.equal(result.year, "2019");
    assert.equal(result.journal, "NAACL");
    assert.equal(result._source, "semantic_scholar");
  });

  it("prefers publicationVenue.name over venue string", () => {
    const result = ssToStandard({
      title: "Test", authors: [], year: 2023, venue: "short",
      publicationVenue: { name: "Full Venue Name" }, externalIds: {},
    });
    assert.equal(result.journal, "Full Venue Name");
  });

  it("falls back to arXiv venue for preprint-only records", () => {
    const result = ssToStandard({
      title: "A Preprint", year: 2020, authors: [{ name: "Alice Smith" }],
      externalIds: { ArXiv: "2001.00001" },
    });
    assert.equal(result.journal, "arXiv");
    assert.equal(isPreprint(result), true);
  });
});

describe("openAlexToStandard", () => {
  it("converts OpenAlex response to standard format", () => {
    const result = openAlexToStandard({
      title: "Attention Is All You Need",
      publication_year: 2017,
      doi: "https://doi.org/10.5555/3295222.3295349",
      authorships: [
        { author: { display_name: "Ashish Vaswani" } },
        { author: { display_name: "Noam Shazeer" } },
      ],
      primary_location: { source: { display_name: "NeurIPS", host_organization_name: "MIT Press" } },
      biblio: { volume: "30", issue: "1", first_page: "5998", last_page: "6008" },
    });
    assert.equal(result.title, "Attention Is All You Need");
    assert.equal(result.author, "Vaswani, Ashish and Shazeer, Noam");
    assert.equal(result.year, "2017");
    assert.equal(result.journal, "NeurIPS");
    assert.equal(result.volume, "30");
    assert.equal(result.number, "1");
    assert.equal(result.pages, "5998-6008");
    assert.equal(result.doi, "10.5555/3295222.3295349", "DOI URL prefix should be stripped");
    assert.equal(result.publisher, "MIT Press");
    assert.equal(result._source, "openalex");
  });

  it("falls back to display_name and handles missing fields", () => {
    const result = openAlexToStandard({ display_name: "A Title", id: "https://openalex.org/W1" });
    assert.equal(result.title, "A Title");
    assert.equal(result.author, "");
    assert.equal(result.year, "");
    assert.equal(result.doi, "");
    assert.equal(result.url, "https://openalex.org/W1");
  });
});
