(() => {
  "use strict";

  // ─── Configuration ───────────────────────────────────────────────────
  const CROSSREF_API = "https://api.crossref.org/works";
  const SS_MATCH = "https://api.semanticscholar.org/graph/v1/paper/search/match";
  const SS_SEARCH = "https://api.semanticscholar.org/graph/v1/paper/search";
  const SS_FIELDS = "title,authors,year,venue,publicationVenue,externalIds";
  const MIN_TITLE_SIM = 70;
  const TITLE_MATCH_THRESHOLD = 85;
  const COMPARED_FIELDS = [
    "author", "year", "journal", "booktitle",
    "volume", "number", "pages", "doi", "publisher",
  ];
  const MAX_RETRIES = 4;
  const RETRY_BASE_MS = 2000;

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

  // ─── BibTeX parser / serializer (no library needed for basics) ──────
  function parseBib(content) {
    const entries = [];
    const re = /@(\w+)\s*\{([^,]*),([^@]*)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const entryType = m[1].toLowerCase();
      if (entryType === "string" || entryType === "preamble" || entryType === "comment")
        continue;
      const id = m[2].trim();
      const body = m[3];
      const entry = { ENTRYTYPE: entryType, ID: id };
      const fieldRe = /(\w+)\s*=\s*(?:\{([^]*?)\}|"([^]*?)"|(\d+))\s*[,}]/g;
      let fm;
      while ((fm = fieldRe.exec(body)) !== null) {
        const key = fm[1].toLowerCase();
        const val = (fm[2] ?? fm[3] ?? fm[4] ?? "").replace(/\s*\n\s*/g, " ").trim();
        entry[key] = val;
      }
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

  // ─── Fuzzy matching (uses fuzzball loaded via UMD) ──────────────────
  function tokenSortRatio(a, b) {
    if (typeof fuzzball !== "undefined") return fuzzball.token_sort_ratio(a, b);
    // Minimal fallback if fuzzball somehow didn't load
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

  // ─── Normalization helpers ──────────────────────────────────────────
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

  // ─── Field comparison ──────────────────────────────────────────────
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

  // ─── API helpers ───────────────────────────────────────────────────
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

  // ─── Adaptive rate controller ──────────────────────────────────────
  const rateState = {
    ssDelay: 500,
    crDelay: 100,
    ssMin: 300,   ssMax: 10000,
    crMin: 50,    crMax: 5000,
    lastSSTime: 0,
    lastCRTime: 0,
    ssConsecutiveOk: 0,
    crConsecutiveOk: 0,
  };

  function rateBackoff(source) {
    if (source === "ss") {
      rateState.ssDelay = Math.min(rateState.ssDelay * 2, rateState.ssMax);
      rateState.ssConsecutiveOk = 0;
      console.log(`[rate] SS backoff → ${rateState.ssDelay}ms`);
    } else {
      rateState.crDelay = Math.min(rateState.crDelay * 2, rateState.crMax);
      rateState.crConsecutiveOk = 0;
      console.log(`[rate] CR backoff → ${rateState.crDelay}ms`);
    }
  }

  function rateSuccess(source) {
    if (source === "ss") {
      rateState.ssConsecutiveOk++;
      if (rateState.ssConsecutiveOk >= 3) {
        rateState.ssDelay = Math.max(rateState.ssDelay * 0.75, rateState.ssMin);
        rateState.ssConsecutiveOk = 0;
        console.log(`[rate] SS speed-up → ${Math.round(rateState.ssDelay)}ms`);
      }
    } else {
      rateState.crConsecutiveOk++;
      if (rateState.crConsecutiveOk >= 3) {
        rateState.crDelay = Math.max(rateState.crDelay * 0.75, rateState.crMin);
        rateState.crConsecutiveOk = 0;
        console.log(`[rate] CR speed-up → ${Math.round(rateState.crDelay)}ms`);
      }
    }
  }

  function getRateInfo() {
    return `SS: ${Math.round(rateState.ssDelay)}ms · CR: ${Math.round(rateState.crDelay)}ms`;
  }

  async function fetchJSON(url, params, { retries = MAX_RETRIES, is404Ok = false } = {}) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

    const isSS = url.includes("semanticscholar.org");
    const source = isSS ? "ss" : "cr";
    const delay = isSS ? rateState.ssDelay : rateState.crDelay;
    const lastKey = isSS ? "lastSSTime" : "lastCRTime";
    const elapsed = Date.now() - rateState[lastKey];
    if (elapsed < delay) await sleep(delay - elapsed);
    rateState[lastKey] = Date.now();

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(u.toString());
        if (resp.ok) {
          rateSuccess(source);
          return resp.json();
        }
        if (resp.status === 404 && is404Ok) return null;
        if (resp.status === 429) {
          rateBackoff(source);
          if (attempt < retries) {
            const wait = RETRY_BASE_MS * Math.pow(2, attempt);
            console.warn(`Rate limited (429) on attempt ${attempt + 1}, retrying in ${wait}ms...`);
            await sleep(wait);
            continue;
          }
        }
        return null;
      } catch (err) {
        rateBackoff(source);
        if (attempt < retries) {
          const wait = RETRY_BASE_MS * Math.pow(2, attempt);
          console.warn(`Request failed (${err.message}), retrying in ${wait}ms...`);
          await sleep(wait);
          continue;
        }
        console.warn(`Request failed after ${retries + 1} attempts:`, err.message);
        return null;
      }
    }
    return null;
  }

  async function searchSSMatch(title) {
    const data = await fetchJSON(SS_MATCH, { query: title, fields: SS_FIELDS }, { is404Ok: true });
    if (!data?.data?.[0]) return null;
    return ssToStandard(data.data[0]);
  }

  async function searchSSSearch(title) {
    const data = await fetchJSON(SS_SEARCH, { query: title, limit: "5", fields: SS_FIELDS });
    return (data?.data || []).map(ssToStandard);
  }

  async function searchCrossref(title) {
    const data = await fetchJSON(CROSSREF_API, {
      "query.title": title, rows: "5",
      select: "title,author,published-print,published-online,container-title,volume,issue,page,DOI,publisher,URL,type",
    });
    return (data?.message?.items || []).map(crossrefToStandard);
  }

  function bestMatch(candidates, queryTitle) {
    let best = null, bestScore = 0;
    for (const c of candidates) {
      const s = titleSimilarity(queryTitle, c.title || "");
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best && bestScore >= MIN_TITLE_SIM ? best : null;
  }

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

  async function lookupPaper(title) {
    const ssMatch = await searchSSMatch(title);
    if (ssMatch && titleSimilarity(title, ssMatch.title || "") >= MIN_TITLE_SIM) {
      const crCandidates = await searchCrossref(title);
      const crMatch = bestMatch(crCandidates, title);
      if (crMatch && isSamePaper(ssMatch, crMatch))
        return mergeMetadata(ssMatch, crMatch);
      return ssMatch;
    }

    const crCandidates = await searchCrossref(title);
    const crMatch = bestMatch(crCandidates, title);
    if (crMatch) return crMatch;

    const ssCandidates = await searchSSSearch(title);
    return bestMatch(ssCandidates, title);
  }

  // ─── Sleep helper ──────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ─── UI State ──────────────────────────────────────────────────────
  let parsedEntries = [];
  let results = [];
  let decisions = {};
  let activeFilter = "all";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const uploadZone = $(".upload-zone");
  const fileInput = $("#file-input");
  const progressSection = $(".progress-section");
  const progressFill = $(".progress-bar-fill");
  const progressText = $(".progress-text");
  const resultsSection = $(".results-section");
  const entryList = $(".entry-list");
  const downloadBar = $(".download-bar");

  // ─── Tab switching ─────────────────────────────────────────────────
  const inputTabs = $$(".input-tab");
  const tabPanels = $$(".tab-panel");

  inputTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      inputTabs.forEach(t => t.classList.remove("active"));
      tabPanels.forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      $(`#tab-${tab.dataset.tab}`).classList.add("active");
    });
  });

  // ─── Upload handling ──────────────────────────────────────────────
  uploadZone.addEventListener("click", () => fileInput.click());

  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("dragover");
  });

  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("dragover");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  async function handleFile(file) {
    if (!file.name.endsWith(".bib")) { alert("Please upload a .bib file."); return; }
    const content = await file.text();
    startVerificationFromContent(content, "Reading file...");
  }

  // ─── Paste handling ───────────────────────────────────────────────
  const bibPaste = $("#bib-paste");
  const btnVerifyPaste = $("#btn-verify-paste");

  btnVerifyPaste.addEventListener("click", () => {
    const content = bibPaste.value.trim();
    if (!content) { alert("Please paste your BibTeX content first."); return; }
    startVerificationFromContent(content, "Parsing pasted content...");
  });

  function startVerificationFromContent(content, statusMsg) {
    results = [];
    decisions = {};
    activeFilter = "all";
    entryList.innerHTML = "";
    rateState.ssDelay = 500;
    rateState.crDelay = 100;
    rateState.ssConsecutiveOk = 0;
    rateState.crConsecutiveOk = 0;
    downloadBar.style.display = "none";
    resultsSection.style.display = "none";
    progressSection.style.display = "block";
    progressFill.style.width = "0%";
    progressText.textContent = statusMsg;

    parsedEntries = parseBib(content);

    if (!parsedEntries.length) {
      alert("No BibTeX entries found. Make sure the content contains valid @type{key, ...} entries.");
      progressSection.style.display = "none";
      return;
    }

    resultsSection.style.display = "block";
    progressText.textContent = `Verifying 0 / ${parsedEntries.length} entries...`;
    runVerification();
  }

  async function runVerification() {
    const total = parsedEntries.length;
    const seenTitles = new Map();

    for (let i = 0; i < total; i++) {
      const entry = parsedEntries[i];
      const title = entry.title || "";
      const entryId = entry.ID || `entry_${i}`;

      const normKey = normalizeTitle(title);
      if (normKey && seenTitles.has(normKey)) {
        entry._duplicateOf = seenTitles.get(normKey);
      } else if (normKey) {
        seenTitles.set(normKey, entryId);
      }

      const pct = Math.round(((i + 1) / total) * 100);
      progressFill.style.width = pct + "%";
      progressText.textContent = `Verifying ${i + 1} / ${total}: ${title.slice(0, 60)}  [${getRateInfo()}]`;

      if (!title.trim()) {
        const r = buildResult(entry, i, "not_found", 0, [], {}, null);
        results.push(r);
        renderEntryCard(r);
        updateSummary();
        continue;
      }

      const cleanTitle = stripLatex(title);
      let found = null;
      try { found = await lookupPaper(cleanTitle); } catch (err) { console.warn("Lookup failed:", err); }

      if (!found) {
        const r = buildResult(entry, i, "not_found", 0, [], {}, null);
        results.push(r);
        renderEntryCard(r);
      } else {
        const cmp = compareEntry(entry, found);
        const r = buildResult(entry, i, cmp.status, cmp.title_score, cmp.field_diffs, cmp.suggested, found);
        results.push(r);
        renderEntryCard(r);
      }

      updateSummary();
    }

    progressSection.style.display = "none";
    downloadBar.style.display = "block";
  }

  function buildResult(entry, index, status, titleScore, fieldDiffs, suggested, found) {
    return {
      index,
      entry_id: entry.ID || "",
      entry_type: entry.ENTRYTYPE || "",
      title: entry.title || "",
      status,
      title_score: titleScore,
      field_diffs: fieldDiffs,
      suggested,
      found_title: found ? (found.title || "") : "",
      duplicate_of: entry._duplicateOf || null,
    };
  }

  // ─── Rendering ────────────────────────────────────────────────────
  function statusLabel(s) {
    return { verified: "Verified", updated: "Auto-Updated", needs_review: "Needs Review", not_found: "Not Found" }[s] || s;
  }

  function renderEntryCard(r) {
    const card = document.createElement("div");
    card.className = `entry-card status-${r.status}`;
    card.dataset.status = r.status;
    card.dataset.index = r.index;
    if (r.duplicate_of) card.dataset.duplicate = "true";

    let diffHTML = "";
    if (r.field_diffs?.length) {
      diffHTML = `<table class="diff-table">
        <tr><th>Field</th><th>Original</th><th>Found</th><th>Match</th></tr>
        ${r.field_diffs.map(d => `<tr>
          <td class="field-name">${esc(d.field)}</td>
          <td class="old-val">${esc(d.original || "(empty)")}</td>
          <td class="new-val">${esc(d.found || "(empty)")}</td>
          <td class="score-val">${d.score}%</td>
        </tr>`).join("")}
      </table>`;
    }

    let duplicateHTML = "";
    if (r.duplicate_of)
      duplicateHTML = `<div class="duplicate-row">Duplicate of <strong>${esc(r.duplicate_of)}</strong></div>`;

    let foundTitleHTML = "";
    if (r.status === "needs_review" && r.found_title)
      foundTitleHTML = `<div class="found-title-row">Closest match (${r.title_score}%): <strong>${esc(r.found_title)}</strong></div>`;

    let actionsHTML = "";
    if (r.status === "updated" || r.status === "needs_review") {
      const def = r.status === "updated" ? "accept" : "reject";
      decisions[r.index] = decisions[r.index] || def;
      actionsHTML = `<div class="entry-actions">
        <button class="btn btn-accept ${decisions[r.index] === "accept" ? "selected" : ""}"
                onclick="window._decide(${r.index},'accept',this)">Accept Changes</button>
        <button class="btn btn-reject ${decisions[r.index] === "reject" ? "selected" : ""}"
                onclick="window._decide(${r.index},'reject',this)">Keep Original</button>
      </div>`;
    }

    card.innerHTML = `<div class="entry-header">
      <div>
        <div class="entry-title">${esc(r.title || "(no title)")}</div>
        <div class="entry-meta">${esc(r.entry_id)} &middot; ${esc(r.entry_type)}</div>
      </div>
      <div class="entry-tags">
        ${r.duplicate_of ? '<span class="status-tag tag-duplicate">Duplicate</span>' : ""}
        <span class="status-tag tag-${r.status}">${statusLabel(r.status)}</span>
      </div>
    </div>${duplicateHTML}${foundTitleHTML}${diffHTML}${actionsHTML}`;

    if (activeFilter !== "all") {
      if (activeFilter === "duplicate") {
        if (!r.duplicate_of) card.classList.add("hidden");
      } else if (card.dataset.status !== activeFilter) {
        card.classList.add("hidden");
      }
    }

    entryList.appendChild(card);
  }

  window._decide = function (index, decision, btn) {
    decisions[index] = decision;
    const card = btn.closest(".entry-card");
    card.querySelectorAll(".btn-accept, .btn-reject").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
  };

  function updateSummary() {
    const c = { verified: 0, updated: 0, needs_review: 0, not_found: 0 };
    let dupes = 0;
    results.forEach(r => {
      c[r.status] = (c[r.status] || 0) + 1;
      if (r.duplicate_of) dupes++;
    });
    $(".badge-verified").textContent = `Verified: ${c.verified}`;
    $(".badge-updated").textContent = `Auto-Updated: ${c.updated}`;
    $(".badge-review").textContent = `Needs Review: ${c.needs_review}`;
    $(".badge-notfound").textContent = `Not Found: ${c.not_found}`;
    $(".badge-duplicates").textContent = `Duplicates: ${dupes}`;
    $$(".summary-badge").forEach(b => b.classList.add("active"));
  }

  // ─── Filtering ────────────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const badge = e.target.closest(".summary-badge");
    if (!badge) return;
    const filter = badge.dataset.filter;
    activeFilter = activeFilter === filter ? "all" : filter;
    $$(".summary-badge").forEach(b =>
      b.classList.toggle("active", activeFilter === "all" || b.dataset.filter === activeFilter));
    $$(".entry-card").forEach(card => {
      if (activeFilter === "all") { card.classList.remove("hidden"); return; }
      if (activeFilter === "duplicate") {
        card.classList.toggle("hidden", card.dataset.duplicate !== "true");
      } else {
        card.classList.toggle("hidden", card.dataset.status !== activeFilter);
      }
    });
  });

  // ─── Settings panel ──────────────────────────────────────────────
  const settingsPanel = $(".settings-panel");
  const settingsToggle = $("#settings-toggle");
  const optRemoveDuplicates = $("#opt-remove-duplicates");
  const optRemoveNotFound = $("#opt-remove-notfound");
  const optAbbreviateVenue = $("#opt-abbreviate-venue");
  const optPreferPublished = $("#opt-prefer-published");
  const dedupCriteriaWrap = $("#dedup-criteria-wrap");

  settingsToggle.addEventListener("click", () => {
    settingsPanel.classList.toggle("open");
  });

  optRemoveDuplicates.addEventListener("change", () => {
    dedupCriteriaWrap.classList.toggle("visible", optRemoveDuplicates.checked);
  });

  function getSettings() {
    return {
      removeDuplicates: optRemoveDuplicates.checked,
      dedupBy: (document.querySelector('input[name="dedup-criteria"]:checked') || {}).value || "title",
      removeNotFound: optRemoveNotFound.checked,
      abbreviateVenue: optAbbreviateVenue.checked,
      preferPublished: optPreferPublished.checked,
    };
  }

  // ─── Venue abbreviation helpers ───────────────────────────────────
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

  // ─── Download ─────────────────────────────────────────────────────
  $(".btn-download").addEventListener("click", () => {
    const s = getSettings();

    let final = parsedEntries.map((entry, i) => {
      const r = results[i];
      if (!r) return { ...entry };

      if (s.removeNotFound && r.status === "not_found") return null;

      const out = { ...entry };
      const decision = decisions[i] ?? (r.status === "verified" ? "accept" : null);
      if ((r.status === "updated" || r.status === "needs_review") && decision === "accept" && r.suggested) {
        for (const [field, value] of Object.entries(r.suggested))
          if (value) out[field] = value;
      }

      if (s.abbreviateVenue) {
        if (out.journal) out.journal = abbreviateVenue(out.journal);
        if (out.booktitle) out.booktitle = abbreviateVenue(out.booktitle);
      }

      if (s.preferPublished) {
        const venue = (out.journal || out.booktitle || "").toLowerCase();
        if (venue.includes("arxiv") || venue.includes("preprint") || venue.includes("corr")) {
          const res = results[i];
          if (res && res.suggested) {
            const foundVenue = res.suggested.journal || res.suggested.booktitle || "";
            const fvLower = foundVenue.toLowerCase();
            if (foundVenue && !fvLower.includes("arxiv") && !fvLower.includes("preprint") && !fvLower.includes("corr")) {
              if (out.journal) out.journal = s.abbreviateVenue ? abbreviateVenue(foundVenue) : foundVenue;
              else if (out.booktitle) out.booktitle = s.abbreviateVenue ? abbreviateVenue(foundVenue) : foundVenue;
            }
          }
        }
      }

      return out;
    }).filter(Boolean);

    if (s.removeDuplicates) {
      const seen = new Set();
      final = final.filter(entry => {
        let key;
        if (s.dedupBy === "doi") {
          key = (entry.doi || "").toLowerCase().trim();
        } else if (s.dedupBy === "id") {
          key = (entry.ID || "").toLowerCase().trim();
        } else {
          key = normalizeTitle(entry.title || "");
        }
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    const bibContent = entriesToBib(final);
    const blob = new Blob([bibContent], { type: "application/x-bibtex" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "verified_refs.bib";
    a.click();
    URL.revokeObjectURL(url);
  });

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }
})();
