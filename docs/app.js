(() => {
  "use strict";

  const B = window.BibLib;

  // ─── Configuration ───────────────────────────────────────────────────
  const CROSSREF_API = "https://api.crossref.org/works";
  const SS_MATCH = "https://api.semanticscholar.org/graph/v1/paper/search/match";
  const SS_SEARCH = "https://api.semanticscholar.org/graph/v1/paper/search";
  const SS_FIELDS = "title,authors,year,venue,publicationVenue,externalIds";
  const MAX_RETRIES = 4;
  const RETRY_BASE_MS = 1500;

  // ─── Adaptive rate controller ──────────────────────────────────────
  const rateState = {
    ssDelay: 500,
    crDelay: 100,
    ssMin: 300,   ssMax: 3000,
    crMin: 50,    crMax: 2000,
    lastSSTime: 0,
    lastCRTime: 0,
    ssConsecutiveOk: 0,
    crConsecutiveOk: 0,
  };

  function rateBackoff(source) {
    if (source === "ss") {
      rateState.ssDelay = Math.min(rateState.ssDelay * 1.3, rateState.ssMax);
      rateState.ssConsecutiveOk = 0;
      console.log(`[rate] SS backoff → ${Math.round(rateState.ssDelay)}ms`);
    } else {
      rateState.crDelay = Math.min(rateState.crDelay * 1.3, rateState.crMax);
      rateState.crConsecutiveOk = 0;
      console.log(`[rate] CR backoff → ${Math.round(rateState.crDelay)}ms`);
    }
  }

  function rateSuccess(source) {
    if (source === "ss") {
      rateState.ssConsecutiveOk++;
      if (rateState.ssConsecutiveOk >= 2) {
        rateState.ssDelay = Math.max(rateState.ssDelay * 0.85, rateState.ssMin);
        rateState.ssConsecutiveOk = 0;
        console.log(`[rate] SS speed-up → ${Math.round(rateState.ssDelay)}ms`);
      }
    } else {
      rateState.crConsecutiveOk++;
      if (rateState.crConsecutiveOk >= 2) {
        rateState.crDelay = Math.max(rateState.crDelay * 0.85, rateState.crMin);
        rateState.crConsecutiveOk = 0;
        console.log(`[rate] CR speed-up → ${Math.round(rateState.crDelay)}ms`);
      }
    }
  }

  function getRateInfo() {
    return `SS: ${Math.round(rateState.ssDelay)}ms · CR: ${Math.round(rateState.crDelay)}ms`;
  }

  // ─── Network ─────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // ─── API searches ────────────────────────────────────────────────────
  async function searchSSMatch(title) {
    const data = await fetchJSON(SS_MATCH, { query: title, fields: SS_FIELDS }, { is404Ok: true });
    if (!data?.data?.[0]) return null;
    return B.ssToStandard(data.data[0]);
  }

  async function searchSSSearch(title) {
    const data = await fetchJSON(SS_SEARCH, { query: title, limit: "5", fields: SS_FIELDS });
    return (data?.data || []).map(B.ssToStandard);
  }

  async function searchCrossref(title) {
    const data = await fetchJSON(CROSSREF_API, {
      "query.title": title, rows: "5",
      select: "title,author,published-print,published-online,container-title,volume,issue,page,DOI,publisher,URL,type",
    });
    return (data?.message?.items || []).map(B.crossrefToStandard);
  }

  async function lookupPaper(title) {
    const ssMatch = await searchSSMatch(title);
    if (ssMatch && B.titleSimilarity(title, ssMatch.title || "") >= B.MIN_TITLE_SIM) {
      const crCandidates = await searchCrossref(title);
      const crMatch = B.bestMatch(crCandidates, title);
      if (crMatch && B.isSamePaper(ssMatch, crMatch))
        return B.mergeMetadata(ssMatch, crMatch);
      return ssMatch;
    }

    const crCandidates = await searchCrossref(title);
    const crMatch = B.bestMatch(crCandidates, title);
    if (crMatch) return crMatch;

    const ssCandidates = await searchSSSearch(title);
    return B.bestMatch(ssCandidates, title);
  }

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
    $$(".info-section").forEach(s => s.style.display = "none");
    progressFill.style.width = "0%";
    progressText.textContent = statusMsg;

    parsedEntries = B.parseBib(content);

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

      const normKey = B.normalizeTitle(title);
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

      const cleanTitle = B.stripLatex(title);
      let found = null;
      try { found = await lookupPaper(cleanTitle); } catch (err) { console.warn("Lookup failed:", err); }

      if (!found) {
        const r = buildResult(entry, i, "not_found", 0, [], {}, null);
        results.push(r);
        renderEntryCard(r);
      } else {
        const cmp = B.compareEntry(entry, found);
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

  // ─── Settings popover ────────────────────────────────────────────
  const settingsToggle = $("#settings-toggle");
  const settingsPopover = $("#settings-popover");
  const optRemoveDuplicates = $("#opt-remove-duplicates");
  const optRemoveNotFound = $("#opt-remove-notfound");
  const optAbbreviateVenue = $("#opt-abbreviate-venue");
  const optPreferPublished = $("#opt-prefer-published");
  const dedupCriteriaWrap = $("#dedup-criteria-wrap");

  settingsToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = settingsPopover.classList.toggle("open");
    settingsToggle.classList.toggle("active", isOpen);
  });

  document.addEventListener("click", (e) => {
    if (!settingsPopover.contains(e.target) && e.target !== settingsToggle) {
      settingsPopover.classList.remove("open");
      settingsToggle.classList.remove("active");
    }
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
        if (out.journal) out.journal = B.abbreviateVenue(out.journal);
        if (out.booktitle) out.booktitle = B.abbreviateVenue(out.booktitle);
      }

      if (s.preferPublished) {
        const venue = (out.journal || out.booktitle || "").toLowerCase();
        if (venue.includes("arxiv") || venue.includes("preprint") || venue.includes("corr")) {
          const res = results[i];
          if (res && res.suggested) {
            const foundVenue = res.suggested.journal || res.suggested.booktitle || "";
            const fvLower = foundVenue.toLowerCase();
            if (foundVenue && !fvLower.includes("arxiv") && !fvLower.includes("preprint") && !fvLower.includes("corr")) {
              if (out.journal) out.journal = s.abbreviateVenue ? B.abbreviateVenue(foundVenue) : foundVenue;
              else if (out.booktitle) out.booktitle = s.abbreviateVenue ? B.abbreviateVenue(foundVenue) : foundVenue;
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
          key = B.normalizeTitle(entry.title || "");
        }
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    const bibContent = B.entriesToBib(final);
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
