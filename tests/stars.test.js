import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatStars } from "../src/app/stars.js";

describe("formatStars", () => {
  it("shortens thousands", () => {
    assert.equal(formatStars(0), "0");
    assert.equal(formatStars(144), "144");
    assert.equal(formatStars(999), "999");
    assert.equal(formatStars(1000), "1k");
    assert.equal(formatStars(1234), "1.2k");
    assert.equal(formatStars(9960), "10k");
    assert.equal(formatStars(12345), "12k");
  });
});
