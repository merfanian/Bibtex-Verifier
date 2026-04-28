/*
 * BibLib — pure logic functions for BibTeX Verifier.
 * Works as a browser global (window.BibLib) and as a Node.js module.
 */
(function (exports) {
  "use strict";

  // ─── Configuration ───────────────────────────────────────────────────
  const TITLE_MATCH_THRESHOLD = 85;
  const MIN_TITLE_SIM = 70;
  const COMPARED_FIELDS = [
    "author", "year", "journal", "booktitle",
    "volume", "number", "pages", "doi", "publisher",
  ];

  // ─── LaTeX helpers ───────────────────────────────────────────────────
  const LATEX_ACCENT_MAP = {
    "\\'a":"á", "\\'e":"é", "\\'i":"í", "\\'o":"ó", "\\'u":"ú",
    "\\`a":"à", "\\`e":"è", "\\`i":"ì", "\\`o":"ò", "\\`u":"ù",
    '\\"a':"ä", '\\"e':"ë", '\\"i':"ï", '\\"o':"ö", '\\"u':"ü",
    "\\~n":"ñ", "\\~a":"ã", "\\~o":"õ",
    "\\^a":"â", "\\^e":"ê", "\\^i":"î", "\\^o":"ô", "\\^u":"û",
    "\\c{c}":"ç", "\\c c":"ç", "{\\ss}":"ß",
  };

  function stripLatex(text) {
    if (!text) return "";
    for (const [latex, ch] of Object.entries(LATEX_ACCENT_MAP))
      text = text.replaceAll(latex, ch);
    text = text.replace(/\\[a-zA-Z]+\s*/g, "");
    text = text.replace(/[{}]/g, "");
    return text.replace(/\s+/g, " ").trim();
  }

  function normalizeTitle(title) {
    return stripLatex(title).toLowerCase().trim();
  }

  // ─── BibTeX parser / serializer ──────────────────────────────────────
  function skipWhitespace(str, i) {
    while (i < str.length && /\s/.test(str[i])) i++;
    return i;
  }

  /** Append missing `}` so nested `{...}` recover from typos like `{{Foo},` before next field. */
  function balanceClosingBraces(s) {
    let net = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "{") net++;
      else if (s[i] === "}") net--;
    }
    let out = s;
    while (net > 0) {
      out += "}";
      net--;
    }
    return out;
  }

  /**
   * Parse `{...}` with nested-brace awareness. If the user omits the closing `}` before `,`
   * and the next token looks like another field (`title =`), treat the comma as the field
   * separator and repair inner braces (common with `{{GitHub},` typos).
   */
  function extractBracedFieldValue(str, start) {
    if (str[start] !== "{") return { value: "", next: start };
    let i = start + 1;
    let depth = 1;
    while (i < str.length && depth > 0) {
      const c = str[i];
      if (c === "{") {
        depth++;
        i++;
      } else if (c === "}") {
        depth--;
        i++;
        if (depth === 0) {
          const inner = str.slice(start + 1, i - 1);
          let next = skipWhitespace(str, i);
          if (str[next] === ",") next = skipWhitespace(str, next + 1);
          return { value: inner, next };
        }
      } else if (depth === 1 && c === ",") {
        const tail = str.slice(i + 1);
        if (/^\s*(?:\r?\n\s*)?\w+\s*=/.test(tail)) {
          const inner = str.slice(start + 1, i);
          return {
            value: balanceClosingBraces(inner),
            next: skipWhitespace(str, i + 1),
          };
        }
        i++;
      } else {
        i++;
      }
    }
    const inner = str.slice(start + 1);
    return { value: balanceClosingBraces(inner), next: str.length };
  }

  function extractQuotedFieldValue(str, start) {
    if (str[start] !== '"') return { value: "", next: start };
    let i = start + 1;
    let buf = "";
    while (i < str.length) {
      const c = str[i];
      if (c === "\\" && i + 1 < str.length) {
        buf += str[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        let next = skipWhitespace(str, i);
        if (str[next] === ",") next = skipWhitespace(str, next + 1);
        return { value: buf, next };
      }
      buf += c;
      i++;
    }
    return { value: buf, next: str.length };
  }

  function extractNumberFieldValue(str, start) {
    const m = /^(\d+)/.exec(str.slice(start));
    if (!m) return { value: "", next: start };
    let next = start + m[1].length;
    next = skipWhitespace(str, next);
    if (str[next] === ",") next = skipWhitespace(str, next + 1);
    return { value: m[1], next };
  }

  function parseEntryFields(body) {
    const fields = {};
    let i = skipWhitespace(body, 0);
    while (i < body.length) {
      const nameMatch = /^(\w+)\s*=\s*/.exec(body.slice(i));
      if (!nameMatch) break;
      const key = nameMatch[1].toLowerCase();
      i += nameMatch[0].length;
      i = skipWhitespace(body, i);
      if (i >= body.length) break;

      let ext;
      if (body[i] === "{") ext = extractBracedFieldValue(body, i);
      else if (body[i] === '"') ext = extractQuotedFieldValue(body, i);
      else if (/\d/.test(body[i])) ext = extractNumberFieldValue(body, i);
      else break;

      fields[key] = ext.value.replace(/\s*\n\s*/g, " ").trim();
      i = ext.next;
      i = skipWhitespace(body, i);
    }
    return fields;
  }

  function parseBib(content) {
    const entries = [];
    const re = /@(\w+)\s*\{([^,]*),([^@]*)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const entryType = m[1].toLowerCase();
      if (entryType === "string" || entryType === "preamble" || entryType === "comment")
        continue;
      const id = m[2].trim();
      let body = m[3];
      body = body.replace(/\}\s*$/, "").trim();
      const entry = { ENTRYTYPE: entryType, ID: id };
      Object.assign(entry, parseEntryFields(body));
      entries.push(entry);
    }
    return entries;
  }

  function entriesToBib(entries) {
    const lines = [];
    for (const entry of entries) {
      const type = entry.ENTRYTYPE || "misc";
      const id = entry.ID || "unknown";
      lines.push(`@${type}{${id},`);
      for (const [k, v] of Object.entries(entry)) {
        if (k === "ENTRYTYPE" || k === "ID" || k.startsWith("_")) continue;
        lines.push(`  ${k} = {${v}},`);
      }
      lines.push("}\n");
    }
    return lines.join("\n");
  }

  // ─── Fuzzy matching ──────────────────────────────────────────────────
  function tokenSortRatio(a, b) {
    if (typeof fuzzball !== "undefined") return fuzzball.token_sort_ratio(a, b);
    a = a.toLowerCase(); b = b.toLowerCase();
    if (a === b) return 100;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 100;
    let matches = 0;
    for (let i = 0; i < shorter.length; i++)
      if (longer.includes(shorter[i])) matches++;
    return Math.round((matches / longer.length) * 100);
  }

  function titleSimilarity(a, b) {
    return tokenSortRatio(a.toLowerCase().trim(), b.toLowerCase().trim());
  }

  // ─── Normalization helpers ───────────────────────────────────────────
  function normalizeText(text) {
    if (!text) return "";
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim().replace(/\s+/g, " ");
  }

  function normalizeAuthorSet(authorStr) {
    if (!authorStr) return new Set();
    const norm = normalizeText(authorStr);
    const parts = norm.split(/\s+and\s+/);
    const names = new Set();
    for (let a of parts) {
      a = a.trim();
      if (!a) continue;
      if (a.includes(",")) names.add(a.split(",")[0].trim());
      else { const t = a.split(/\s+/); names.add(t[t.length - 1]); }
    }
    return names;
  }

  function normalizePages(p) { return p.trim().replace(/\s*-+\s*/g, "-"); }

  // ─── Field comparison ────────────────────────────────────────────────
  function compareAuthors(a, b) {
    const sa = normalizeAuthorSet(a), sb = normalizeAuthorSet(b);
    if (!sa.size && !sb.size) return 100;
    if (!sa.size || !sb.size) return 0;
    let inter = 0;
    for (const n of sa) if (sb.has(n)) inter++;
    return (inter / Math.max(sa.size, sb.size)) * 100;
  }

  function compareField(field, a, b) {
    const na = normalizeText(a), nb = normalizeText(b);
    if (!na && !nb) return 100;
    if (!na || !nb) return 0;
    if (field === "year" || field === "doi") return na === nb ? 100 : 0;
    if (field === "author") return compareAuthors(a, b);
    if (field === "pages") return normalizePages(na) === normalizePages(nb) ? 100 : tokenSortRatio(na, nb);
    return tokenSortRatio(na, nb);
  }

  function compareEntry(original, found) {
    const origTitle = original.title || "";
    const foundTitle = found.title || "";
    const titleScore = tokenSortRatio(normalizeTitle(origTitle), normalizeTitle(foundTitle));

    if (titleScore < TITLE_MATCH_THRESHOLD) {
      return { status: "needs_review", title_score: titleScore, field_diffs: [], suggested: found };
    }

    const foundJournal = found.journal || "";
    if (original.booktitle && !original.journal && foundJournal)
      found.booktitle = foundJournal;

    const fieldDiffs = [], enrichments = [];
    let hasDifference = false;

    for (const field of COMPARED_FIELDS) {
      const origVal = original[field] || "";
      const foundVal = found[field] || "";
      if (!origVal && !foundVal) continue;

      if (!origVal.trim() && foundVal.trim()) {
        enrichments.push({ field, original: origVal, found: foundVal, score: 0 });
        continue;
      }
      if (origVal.trim() && !foundVal.trim()) continue;

      const score = compareField(field, origVal, foundVal);
      if (score < 100) {
        hasDifference = true;
        fieldDiffs.push({ field, original: origVal, found: foundVal, score: Math.round(score * 10) / 10 });
      }
    }

    const allDiffs = fieldDiffs.concat(enrichments);
    const status = hasDifference ? "updated" : "verified";
    const suggested = {};
    if (hasDifference || enrichments.length)
      for (const d of allDiffs) if (d.found) suggested[d.field] = d.found;

    return { status, title_score: Math.round(titleScore * 10) / 10, field_diffs: allDiffs, suggested };
  }

  /**
   * When compareEntry returns needs_review (title below threshold), field_diffs is empty.
   * Build a full diff against the closest `found` record so the UI can show suggestions
   * and per-field accept / revert actions.
   */
  function fieldDiffsForNeedsReview(original, found) {
    if (!found) return [];
    const merged = { ...found };
    const foundJournal = merged.journal || "";
    if (original.booktitle && !original.journal && foundJournal)
      merged.booktitle = foundJournal;

    const origTitle = original.title || "";
    const foundTitle = merged.title || "";
    const titleScore = tokenSortRatio(normalizeTitle(origTitle), normalizeTitle(foundTitle));
    const fieldDiffs = [];
    const enrichments = [];

    if (origTitle.trim() || foundTitle.trim()) {
      fieldDiffs.push({
        field: "title",
        original: origTitle,
        found: foundTitle,
        score: Math.round(titleScore * 10) / 10,
      });
    }

    for (const field of COMPARED_FIELDS) {
      const origVal = original[field] || "";
      const foundVal = merged[field] || "";
      if (!origVal && !foundVal) continue;

      if (!origVal.trim() && foundVal.trim()) {
        enrichments.push({ field, original: origVal, found: foundVal, score: 0 });
        continue;
      }
      if (origVal.trim() && !foundVal.trim()) continue;

      const score = compareField(field, origVal, foundVal);
      if (score < 100) {
        fieldDiffs.push({
          field,
          original: origVal,
          found: foundVal,
          score: Math.round(score * 10) / 10,
        });
      }
    }

    return fieldDiffs.concat(enrichments);
  }

  // ─── API response converters ─────────────────────────────────────────
  function crossrefToStandard(item) {
    const authors = (item.author || []).map(a => {
      const f = a.family || "", g = a.given || "";
      return f ? `${f}, ${g}`.replace(/, $/, "") : "";
    }).filter(Boolean);

    const dp = item["published-print"] || item["published-online"] || {};
    const year = dp["date-parts"]?.[0]?.[0]?.toString() || "";
    const container = item["container-title"] || [];

    return {
      title: (item.title || [""])[0],
      author: authors.join(" and "),
      year,
      journal: container[0] || "",
      volume: item.volume || "",
      number: item.issue || "",
      pages: item.page || "",
      doi: item.DOI || "",
      publisher: item.publisher || "",
      url: item.URL || "",
      _source: "crossref",
    };
  }

  function ssToStandard(paper) {
    const authors = (paper.authors || []).map(a => {
      const name = a.name || "";
      const parts = name.split(/\s+/);
      if (parts.length >= 2) return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
      return name;
    }).filter(Boolean);

    const ext = paper.externalIds || {};
    const pv = paper.publicationVenue;
    const venue = (pv && typeof pv === "object" ? pv.name : null) || paper.venue || "";

    return {
      title: paper.title || "",
      author: authors.join(" and "),
      year: (paper.year || "").toString(),
      journal: venue,
      volume: "", number: "", pages: "",
      doi: ext.DOI || "",
      publisher: "",
      url: ext.DOI ? `https://doi.org/${ext.DOI}` : "",
      _source: "semantic_scholar",
    };
  }

  // ─── Paper matching helpers ──────────────────────────────────────────
  function extractLastNames(authorStr) {
    if (!authorStr) return new Set();
    const names = new Set();
    for (let part of authorStr.split(/\s+and\s+/i)) {
      part = part.trim();
      if (!part) continue;
      if (part.includes(",")) names.add(part.split(",")[0].trim().toLowerCase());
      else { const t = part.split(/\s+/); names.add(t[t.length - 1].toLowerCase()); }
    }
    return names;
  }

  function isSamePaper(a, b) {
    if (titleSimilarity(a.title || "", b.title || "") < 85) return false;
    if (a.year && b.year && a.year !== b.year) return false;
    const aa = extractLastNames(a.author), ba = extractLastNames(b.author);
    if (aa.size && ba.size) {
      let inter = 0; for (const n of aa) if (ba.has(n)) inter++;
      if (inter / Math.max(aa.size, ba.size) < 0.3) return false;
    }
    return true;
  }

  function mergeMetadata(primary, secondary) {
    const merged = { ...primary };
    for (const [k, v] of Object.entries(secondary)) {
      if (k.startsWith("_")) continue;
      if (!merged[k] && v) merged[k] = v;
    }
    merged._source = `${primary._source || ""}+${secondary._source || ""}`;
    return merged;
  }

  function bestMatch(candidates, queryTitle) {
    let best = null, bestScore = 0;
    for (const c of candidates) {
      const s = titleSimilarity(queryTitle, c.title || "");
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best && bestScore >= MIN_TITLE_SIM ? best : null;
  }

  // ─── Venue abbreviation ──────────────────────────────────────────────
  const VENUE_ABBREVIATIONS = {
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

  function abbreviateVenue(name) {
    if (!name) return name;
    const key = name.toLowerCase().replace(/[^a-z0-9\s&,]/g, "").trim();
    for (const [full, abbr] of Object.entries(VENUE_ABBREVIATIONS)) {
      if (key.includes(full)) return abbr;
    }
    return name;
  }

  function expandVenue(name) {
    if (!name) return name;
    const upper = name.toUpperCase().trim();
    for (const [full, abbr] of Object.entries(VENUE_ABBREVIATIONS)) {
      if (upper === abbr.toUpperCase()) {
        return full.replace(/\b\w/g, c => c.toUpperCase());
      }
    }
    return name;
  }

  // ─── Public API ──────────────────────────────────────────────────────
  exports.TITLE_MATCH_THRESHOLD = TITLE_MATCH_THRESHOLD;
  exports.MIN_TITLE_SIM = MIN_TITLE_SIM;
  exports.COMPARED_FIELDS = COMPARED_FIELDS;
  exports.VENUE_ABBREVIATIONS = VENUE_ABBREVIATIONS;

  exports.stripLatex = stripLatex;
  exports.normalizeTitle = normalizeTitle;
  exports.parseBib = parseBib;
  exports.entriesToBib = entriesToBib;
  exports.tokenSortRatio = tokenSortRatio;
  exports.titleSimilarity = titleSimilarity;
  exports.normalizeText = normalizeText;
  exports.normalizeAuthorSet = normalizeAuthorSet;
  exports.normalizePages = normalizePages;
  exports.compareAuthors = compareAuthors;
  exports.compareField = compareField;
  exports.compareEntry = compareEntry;
  exports.fieldDiffsForNeedsReview = fieldDiffsForNeedsReview;
  exports.crossrefToStandard = crossrefToStandard;
  exports.ssToStandard = ssToStandard;
  exports.extractLastNames = extractLastNames;
  exports.isSamePaper = isSamePaper;
  exports.mergeMetadata = mergeMetadata;
  exports.bestMatch = bestMatch;
  exports.abbreviateVenue = abbreviateVenue;
  exports.expandVenue = expandVenue;

})(typeof module !== "undefined" && module.exports ? module.exports : (window.BibLib = {}));
