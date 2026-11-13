import "./helpers/setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { renderMarkdownLite } from "../src/lib/index.js";

describe("renderMarkdownLite", () => {
  it("renders headings, lists, paragraphs and inline styles", () => {
    const html = renderMarkdownLite("# Title\n\nIntro line\nwrapped.\n\n## 2026-11-12\n### Added\n- **Bold** and `code`\n- A [link](https://example.org/x)\n  continued\n");
    assert.equal(html, [
      "<p>Intro line wrapped.</p>",
      "<h3>2026-11-12</h3>",
      "<h4>Added</h4>",
      '<ul><li><strong>Bold</strong> and <code>code</code></li><li>A <a href="https://example.org/x" target="_blank" rel="noopener">link</a> continued</li></ul>',
    ].join("\n"));
  });

  it("escapes HTML and refuses non-http links", () => {
    const html = renderMarkdownLite('- <img src=x onerror=alert(1)> & "q"\n- [bad](javascript:alert(1))');
    assert.ok(!html.includes("<img"));
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;"));
    assert.ok(!html.includes("<a "));
    assert.equal(renderMarkdownLite(""), "");
  });

  it("renders the shipped changelog with a dated entry first", () => {
    const html = renderMarkdownLite(fs.readFileSync(new URL("../src/CHANGELOG.md", import.meta.url), "utf8"));
    assert.match(html.split("\n").find(l => l.startsWith("<h3>")), /^<h3>\d{4}-\d{2}-\d{2}<\/h3>$/);
    assert.ok(!/[*`]{1,2}[^<]*[*`]{1,2}/.test(html.replace(/<code>.*?<\/code>/g, "")), "no unrendered markup left");
  });
});
