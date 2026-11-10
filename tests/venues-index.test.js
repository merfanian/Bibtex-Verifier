import "./helpers/setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { sameVenue, setVenueIndex, venueSeries } from "../src/lib/index.js";

// node --test runs each file in its own process, so the index stays local to this file.
const index = JSON.parse(fs.readFileSync(new URL("../src/data/venues.json", import.meta.url), "utf8"));
setVenueIndex(index);
const series = (v) => [...venueSeries(v)].map(i => index.series[i]);

describe("dblp venue index", () => {
  it("is CC0 dblp data with unambiguous keys", () => {
    assert.match(index.source, /dblp/);
    assert.ok(Object.keys(index.acronyms).length > 1000);
    assert.ok(Object.keys(index.names).length > 1000);
  });

  it("resolves acronyms and full names to the same series", () => {
    assert.deepEqual(series("ICDE"), ["conf/icde"]);
    assert.deepEqual(series("IEEE International Conference on Data Engineering"), ["conf/icde"]);
    assert.deepEqual(series("NIPS"), series("NeurIPS"));
    assert.deepEqual(series("SoCG"), series("SCG"));
  });

  it("keeps satellite volumes apart from the main conference", () => {
    assert.notDeepEqual(series("ICDE Workshops"), series("ICDE"));
    assert.equal(sameVenue("ICDE Workshops", "ICDE"), false);
  });

  it("matches real variants", () => {
    assert.ok(sameVenue("SIGMOD Conference", "SIGMOD"));
    assert.ok(sameVenue("ICDE", "2019 IEEE 35th International Conference on Data Engineering (ICDE)"));
    assert.ok(sameVenue("Proceedings of the 58th Annual Meeting of the Association for Computational Linguistics, ACL 2020, Online, July 5-10, 2020",
      "Proceedings of the 58th Annual Meeting of the Association for Computational Linguistics"));
    assert.ok(sameVenue("FAccT", "FAT"));
  });

  it("separates different venues", () => {
    assert.equal(sameVenue("ICML", "ICLR"), false);
    assert.equal(sameVenue("SIGMOD", "PODS"), false);
    assert.equal(sameVenue("ICDE", "International Conference on Data Mining"), false);
    assert.equal(sameVenue("2019 IEEE 35th International Conference on Data Engineering (ICDM)",
      "IEEE International Conference on Data Engineering"), false);
  });
});
