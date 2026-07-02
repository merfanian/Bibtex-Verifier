(() => {
  "use strict";

  const B = window.BibLib;

  // ─── Configuration ───────────────────────────────────────────────────
  const CROSSREF_API = "https://api.crossref.org/works";
  const SS_MATCH = "https://api.semanticscholar.org/graph/v1/paper/search/match";
  const SS_SEARCH = "https://api.semanticscholar.org/graph/v1/paper/search";
  const SS_FIELDS = "title,authors,year,venue,publicationVenue,externalIds";
  const OPENALEX_API = "https://api.openalex.org/works";
  const OPENALEX_FIELDS = "title,display_name,publication_year,doi,authorships,primary_location,biblio,id";
  const MAX_RETRIES = 4;
  const RETRY_BASE_MS = 1500;

  // ─── Adaptive rate controller ──────────────────────────────────────
  // One independent bucket per source: current delay, its clamps, the last
  // request time, and a run of consecutive successes used to speed back up.
  const rateBuckets = {
    ss: { delay: 500, min: 300, max: 3000, last: 0, ok: 0 },
    cr: { delay: 100, min: 50,  max: 2000, last: 0, ok: 0 },
    oa: { delay: 100, min: 50,  max: 2000, last: 0, ok: 0 },
  };

  function rateBackoff(source) {
    const b = rateBuckets[source] || rateBuckets.cr;
    b.delay = Math.min(b.delay * 1.3, b.max);
    b.ok = 0;
  }

  function rateSuccess(source) {
    const b = rateBuckets[source] || rateBuckets.cr;
    b.ok++;
    if (b.ok >= 2) {
      b.delay = Math.max(b.delay * 0.85, b.min);
      b.ok = 0;
    }
  }

  // ─── Network ─────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fetchJSON(url, params, { retries = MAX_RETRIES, is404Ok = false } = {}) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

    const source = url.includes("semanticscholar.org") ? "ss"
      : url.includes("openalex.org") ? "oa"
      : "cr";
    const bucket = rateBuckets[source];
    const elapsed = Date.now() - bucket.last;
    if (elapsed < bucket.delay) await sleep(bucket.delay - elapsed);
    bucket.last = Date.now();

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

  async function searchOpenAlex(title) {
    // Title-only query keeps the "only titles leave your machine" guarantee —
    // no `mailto`, so nothing personally identifying is sent.
    const data = await fetchJSON(OPENALEX_API, {
      search: title, per_page: "5", select: OPENALEX_FIELDS,
    });
    return (data?.results || []).map(B.openAlexToStandard);
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

    const oaCandidates = await searchOpenAlex(title);
    const oaMatch = B.bestMatch(oaCandidates, title);
    if (oaMatch) return oaMatch;

    const ssCandidates = await searchSSSearch(title);
    return B.bestMatch(ssCandidates, title);
  }

  // ─── Theme ─────────────────────────────────────────────────────────
  const root = document.documentElement;
  const themeToggle = document.getElementById("theme-toggle");

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    localStorage.setItem("bv-theme", theme);
  }

  const savedTheme = localStorage.getItem("bv-theme") ||
    (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  applyTheme(savedTheme);

  themeToggle.addEventListener("click", () => {
    applyTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  // ─── UI State ──────────────────────────────────────────────────────
  let parsedEntries = [];
  let results = [];
  let decisions = {};
  let fieldEdits = {};
  let activeFilter = "all";
  let activeSearch = "";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  let onboardingOverlayEl = null;

  function closeOnboarding() {
    if (onboardingOverlayEl?._currentStepOnLeave) {
      onboardingOverlayEl._currentStepOnLeave();
      onboardingOverlayEl._currentStepOnLeave = null;
    }
    if (onboardingOverlayEl) {
      const fn = onboardingOverlayEl._kbdEsc;
      if (fn) document.removeEventListener("keydown", fn);
      const bd = onboardingOverlayEl._onboardingBackdrop;
      onboardingOverlayEl.remove();
      if (bd) bd.remove();
      onboardingOverlayEl = null;
    }
    document.body.removeAttribute("data-onboarding-stage");
    document.querySelectorAll(".onboarding-target").forEach(el => el.classList.remove("onboarding-target"));
    $("#floating-bar")?.classList.remove("onboarding-target-bar");
  }

  let onboardingResumeAfterCurrentRun = false;
  let pendingOnboardingResumeClick = false;

  const uploadZone = $(".upload-zone");
  const fileInput = $("#file-input");
  const resultsSection = $(".results-section");
  const entryList = $(".entry-list");
  const floatingBar = $("#floating-bar");
  const barProgress = $("#bar-progress");
  const barProgressFill = $(".bar-progress-fill");
  const barProgressText = $(".bar-progress-text");
  const btnDownload = $("#btn-download");
  const mainColumns = $("#main-columns");
  const colPreview = $("#col-preview");
  const previewPanelEl = $("#preview-panel");
  const btnPreviewToggle = $("#btn-preview-toggle");
  const previewShowHandle = $("#preview-show-handle");
  const previewCode = $("#preview-code");
  const previewPlaceholder = $(".preview-placeholder");

  function syncPreviewPanelCollapsed() {
    if (!previewPanelEl || !btnPreviewToggle) return;
    const collapsed = sessionStorage.getItem("bv-preview-collapsed") === "1";
    previewPanelEl.classList.toggle("is-collapsed", collapsed);
    mainColumns?.classList.toggle("preview-collapsed", collapsed);
    btnPreviewToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btnPreviewToggle.title = collapsed ? "Expand Live BibTeX preview" : "Collapse Live BibTeX preview";
    const lbl = btnPreviewToggle.querySelector(".btn-preview-toggle-text");
    if (lbl) lbl.textContent = collapsed ? "Show" : "Hide";
    if (previewShowHandle) {
      const hasResults = colPreview?.classList.contains("visible");
      previewShowHandle.classList.toggle("visible", collapsed && !!hasResults);
      previewShowHandle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  }

  btnPreviewToggle?.addEventListener("click", () => {
    const willCollapse = !previewPanelEl.classList.contains("is-collapsed");
    sessionStorage.setItem("bv-preview-collapsed", willCollapse ? "1" : "0");
    syncPreviewPanelCollapsed();
  });
  previewShowHandle?.addEventListener("click", () => {
    sessionStorage.setItem("bv-preview-collapsed", "0");
    syncPreviewPanelCollapsed();
  });
  syncPreviewPanelCollapsed();

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
    onboardingResumeAfterCurrentRun =
      pendingOnboardingResumeClick ||
      document.body.dataset.onboardingStage === "verify" ||
      document.body.dataset.onboardingStage === "verify-final";
    pendingOnboardingResumeClick = false;
    delete document.body.dataset.onboardingStage;

    closeOnboarding();
    results = [];
    decisions = {};
    fieldEdits = {};
    activeFilter = "all";
    activeSearch = "";
    const searchInputEl = document.getElementById("entry-search-input");
    if (searchInputEl) searchInputEl.value = "";
    document.querySelector(".entry-search")?.classList.remove("has-query");
    entryList.innerHTML = "";
    document.getElementById("entry-empty")?.classList.remove("visible");
    rateBuckets.ss.delay = 500; rateBuckets.ss.ok = 0;
    rateBuckets.cr.delay = 100; rateBuckets.cr.ok = 0;
    rateBuckets.oa.delay = 100; rateBuckets.oa.ok = 0;
    $$(".info-section").forEach(s => s.style.display = "none");
    resultsSection.style.display = "none";

    barProgress.classList.add("active");
    barProgress.classList.remove("fade-out");
    barProgressFill.style.width = "0%";
    barProgressFill.classList.remove("done");
    barProgressText.textContent = statusMsg;
    btnDownload.classList.add("hidden");
    btnDownload.classList.remove("fade-in");
    floatingBar.classList.add("visible");

    mainColumns.classList.add("two-col");
    colPreview.classList.add("visible");
    previewPlaceholder.style.display = "flex";
    previewCode.style.display = "none";
    previewCode.textContent = "";
    syncPreviewPanelCollapsed();

    parsedEntries = B.parseBib(content);

    if (!parsedEntries.length) {
      alert("No BibTeX entries found. Make sure the content contains valid @type{key, ...} entries.");
      floatingBar.classList.remove("visible");
      onboardingResumeAfterCurrentRun = false;
      return;
    }

    resultsSection.style.display = "block";
    barProgressText.textContent = `Verifying 0 / ${parsedEntries.length} entries...`;
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
      barProgressFill.style.width = pct + "%";
      barProgressText.textContent = `Verifying ${i + 1} / ${total}: ${title.slice(0, 50)}…`;

      if (!title.trim()) {
        const r = buildResult(entry, i, "not_found", 0, [], {}, null);
        results.push(r);
        renderEntryCard(r);
        updateSummary();
        updatePreview();
        continue;
      }

      const cleanTitle = B.stripLatex(title);
      let found = null;
      // Tour shortcut: the fabricated sample entry has a unique marker. Skip the
      // real network lookup so the onboarding flow doesn't stall on a guaranteed
      // miss; pause briefly so the "not found" status still feels deliberate.
      const isTourFakeEntry = /QZX999/i.test(cleanTitle);
      if (isTourFakeEntry) {
        await sleep(500);
      } else {
        try { found = await lookupPaper(cleanTitle); } catch (err) { console.warn("Lookup failed:", err); }
      }

      if (!found) {
        const r = buildResult(entry, i, "not_found", 0, [], {}, null);
        results.push(r);
        renderEntryCard(r);
      } else {
        const cmp = B.compareEntry(entry, found);
        let fieldDiffs = cmp.field_diffs;
        if (cmp.status === "needs_review" && found)
          fieldDiffs = B.fieldDiffsForNeedsReview(entry, found);
        const r = buildResult(entry, i, cmp.status, cmp.title_score, fieldDiffs, cmp.suggested, found);
        results.push(r);
        renderEntryCard(r);
      }

      updateSummary();
      updateAuthorPills();
      updatePreview();
    }

    barProgressFill.classList.add("done");
    barProgressText.textContent = `Done — ${total} entries verified`;
    const resumeOnboardingAfterResults = onboardingResumeAfterCurrentRun;
    onboardingResumeAfterCurrentRun = false;
    setTimeout(() => {
      barProgress.classList.add("fade-out");
      setTimeout(() => {
        barProgress.classList.remove("active", "fade-out");
        btnDownload.classList.remove("hidden");
        btnDownload.classList.add("fade-in");
        if (resumeOnboardingAfterResults)
          setTimeout(() => openOnboardingPostVerifyTour(), 450);
      }, 350);
    }, 800);
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

  function cardMatchesFilter(card) {
    if (activeFilter === "all") return true;
    if (activeFilter === "duplicate") return card.dataset.duplicate === "true";
    return card.dataset.status === activeFilter;
  }

  function cardMatchesSearch(card) {
    if (!activeSearch) return true;
    const hay = card.dataset.searchHay || "";
    const tokens = activeSearch.split(/\s+/).filter(Boolean);
    return tokens.every(tok => {
      if (tok.startsWith("title:")) {
        const sub = tok.slice(6);
        return hay.includes(sub);
      }
      if (tok.startsWith("id:") || tok.startsWith("key:")) {
        const sub = tok.slice(tok.indexOf(":") + 1);
        return hay.split(" ", 1)[0].includes(sub);
      }
      return hay.includes(tok);
    });
  }

  function applyCardVisibility(card) {
    const visible = cardMatchesFilter(card) && cardMatchesSearch(card);
    card.classList.toggle("hidden", !visible);
  }

  function updateEntryEmptyState() {
    const empty = $("#entry-empty");
    if (!empty) return;
    const cards = $$(".entry-card");
    if (!cards.length) { empty.classList.remove("visible"); return; }
    const anyVisible = [...cards].some(c => !c.classList.contains("hidden"));
    empty.classList.toggle("visible", !anyVisible);
  }

  function applyAllCardVisibility() {
    $$(".entry-card").forEach(applyCardVisibility);
    updateEntryEmptyState();
  }

  function renderEntryCard(r) {
    const card = document.createElement("div");
    card.className = `entry-card status-${r.status}`;
    card.dataset.status = r.status;
    card.dataset.index = r.index;
    if (r.duplicate_of) card.dataset.duplicate = "true";

    const idx = r.index;
    if (!fieldEdits[idx]) fieldEdits[idx] = {};
    const entry = parsedEntries[idx];

    let diffHTML = "";
    const hasDiffs = r.field_diffs?.length > 0;
    /* Show Suggested column whenever status implies adoptable API/enrichment diffs (includes
       verified+enrichments-only from compareEntry, not only updated/needs_review). */
    const hasSuggestion =
      r.status === "updated" ||
      r.status === "needs_review" ||
      (r.status === "verified" && hasDiffs);

    if (hasDiffs) {
      const rows = r.field_diffs.map(d => {
        const isEnrichment = !(d.original || "").trim();
        // Enrichments (original empty) should default to "found" so the suggested
        // value is reflected in the preview without requiring a click. For real
        // diffs, "updated" status auto-adopts; verified/needs_review keeps original.
        const defaultAction = (isEnrichment || r.status === "updated") ? "found" : "original";

        if (!fieldEdits[idx][d.field]) {
          fieldEdits[idx][d.field] = {
            action: defaultAction,
            value: d.found || "",
          };
        }
        const fe = fieldEdits[idx][d.field];
        const currentAction = fe.action;

        const suggestionText = currentAction === "custom" ? (fe.value || "") : (d.found || "");
        const origAttr = encodeURIComponent(d.original || "");
        const foundAttr = encodeURIComponent(d.found || "");

        // Apply author truncation for display (suggested only)
        const maxA = parseInt(optMaxAuthors.value) || 0;
        const displaySuggestion = (d.field === "author" && maxA > 0 && currentAction !== "custom") ? truncateAuthors(suggestionText, maxA) : suggestionText;
        const authorMatchHidden = (d.field === "author" && maxA > 0 && displaySuggestion.trim() === (d.original || "").trim());

        return `<tr class="diff-row${authorMatchHidden ? " author-match-hidden" : ""}" data-entry="${idx}" data-field="${esc(d.field)}" data-action="${currentAction}"
          data-enrichment="${isEnrichment ? "1" : ""}"
          data-found-val="${foundAttr}"
          data-original-val="${origAttr}">
          <td class="field-name"><span class="field-name-pill">${esc(d.field)}</span></td>
          <td class="val-col val-col-original">
            ${!isEnrichment ? `<button class="choice-pill pill-original ${currentAction === "original" ? "active" : ""}"
                    data-entry="${idx}" data-field="${esc(d.field)}" data-action="original" data-val="${esc(d.original || "")}"
                    title="Keep your value">${esc(d.original)}</button>` : '<span class="empty-val">\u2014</span>'}
          </td>
          <td class="val-col val-col-suggested">
            ${hasSuggestion ? `<span class="choice-pill pill-suggested ${currentAction === "found" || currentAction === "custom" ? "active" : ""} ${currentAction === "remove" ? "removed" : ""}"
                    contenteditable="${currentAction === "remove" ? "false" : "true"}"
                    spellcheck="false"
                    data-entry="${idx}" data-field="${esc(d.field)}" data-action="found" data-val="${esc(d.found || "")}"
                    title="Use suggested value (click to select, edit to customize)">${esc(displaySuggestion)}</span>` : ""}
          </td>
          <td class="field-actions-mini">
            <button class="fa-btn-x ${currentAction === "remove" ? "active" : ""}" title="${isEnrichment ? "Don\u2019t add" : "Remove field"}"
                    data-entry="${idx}" data-field="${esc(d.field)}" data-action="remove" data-val="">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </td>
        </tr>`;
      }).join("");

      diffHTML = `<table class="diff-table">
        <tr><th>Field</th><th>Your Value</th><th>Suggested</th><th></th></tr>
        ${rows}
      </table>`;
    }

    const EDITABLE_FIELDS = ["title", ...B.COMPARED_FIELDS];
    const diffFieldsSet = new Set((r.field_diffs || []).map(d => d.field));
    const extraFields = EDITABLE_FIELDS.filter(f => !diffFieldsSet.has(f) && (entry[f] || "").trim());

    if (extraFields.length) {
      const extraRows = extraFields.map(f => {
        const val = entry[f] || "";
        if (!fieldEdits[idx][f]) {
          fieldEdits[idx][f] = { action: "original", value: val };
        }
        const fe = fieldEdits[idx][f];
        const currentAction = fe.action;

        return `<tr class="diff-row field-row-plain" data-entry="${idx}" data-field="${esc(f)}" data-action="${currentAction}">
          <td class="field-name"><span class="field-name-pill">${esc(f)}</span></td>
          <td class="val-col" colspan="2">
            <span class="choice-pill pill-value ${currentAction === "remove" ? "removed" : "active"}"
                  contenteditable="${currentAction === "remove" ? "false" : "true"}" spellcheck="false"
                  data-entry="${idx}" data-field="${esc(f)}">${esc(currentAction === "remove" ? "" : fe.value)}</span>
          </td>
          <td class="field-actions-mini">
            <button class="fa-btn-x ${currentAction === "remove" ? "active" : ""}" title="Remove field"
                    data-entry="${idx}" data-field="${esc(f)}" data-action="remove" data-val="">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </td>
        </tr>`;
      }).join("");

      const fieldsLabel = hasDiffs ? "Other fields" : "Fields";
      const collapsed = true;
      diffHTML += `<div class="fields-toggle-wrap${collapsed ? " collapsed" : ""}">
        <button class="fields-toggle-btn" type="button">
          <svg class="fields-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          ${fieldsLabel} (${extraFields.length})
        </button>
        <table class="diff-table fields-table">
          <tr><th>Field</th><th colspan="2">Value</th><th></th></tr>
          ${extraRows}
        </table>
      </div>`;
    }

    let duplicateHTML = "";
    if (r.duplicate_of)
      duplicateHTML = `<div class="duplicate-row">Duplicate of <strong>${esc(r.duplicate_of)}</strong></div>`;

    let reviewHintHTML = "";
    if (r.status === "needs_review" && r.found_title) {
      reviewHintHTML = `<div class="review-hint">The closest database record may not be the paper you meant
        (<strong>${esc(String(r.title_score))}%</strong> title similarity to
        <strong class="review-hint-match">${esc(r.found_title)}</strong>).
        Review the suggestions below and use the checkmark on each row to adopt a value, or keep your original text.</div>`;
    }

    let notFoundHintHTML = "";
    if (r.status === "not_found") {
      const hasTitle = (r.title || "").trim();
      notFoundHintHTML = `<div class="not-found-hint">${hasTitle
        ? "No matching publication was found in CrossRef or Semantic Scholar for this title. Try fixing typos or adding missing words, then re-run verification, or check the reference manually."
        : "This entry has no title, so it cannot be looked up automatically. Add a title in your .bib file or verify the entry by hand."}</div>`;
    }

    let actionsHTML = "";
    const hasEditable = Object.keys(fieldEdits[idx]).length > 0;
    if (hasEditable && hasSuggestion && hasDiffs) {
      const allFound = r.field_diffs.every(d => (fieldEdits[idx][d.field] || {}).action === "found");
      const allOriginal = r.field_diffs.every(d => (fieldEdits[idx][d.field] || {}).action === "original");
      actionsHTML = `<div class="entry-actions">
        <button class="seg-btn btn-accept-all ${allFound ? "active-accept" : ""}" data-entry="${idx}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Accept all
        </button>
        <button class="seg-btn btn-revert-all ${allOriginal ? "active-revert" : ""}" data-entry="${idx}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/></svg>
          Keep original
        </button>
      </div>`;
    }

    const jumpBtn = `<button class="btn-jump-preview" type="button" data-entry-id="${esc(r.entry_id)}" title="Scroll to this entry in the live preview">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;

    const searchQuery = encodeURIComponent(B.stripLatex(r.title || ""));
    const searchLinks = (r.title || "").trim() ? `<div class="search-links">
      <a class="search-link" href="https://scholar.google.com/scholar?q=${searchQuery}" target="_blank" rel="noopener" title="Google Scholar">
        <img src="https://scholar.google.com/favicon.ico" width="14" height="14" alt="Scholar">
      </a>
      <a class="search-link" href="https://www.google.com/search?q=${searchQuery}" target="_blank" rel="noopener" title="Google">
        <img src="https://www.google.com/favicon.ico" width="14" height="14" alt="Google">
      </a>
      <a class="search-link" href="https://www.semanticscholar.org/search?q=${searchQuery}" target="_blank" rel="noopener" title="Semantic Scholar">
        <img src="https://www.semanticscholar.org/favicon.ico" width="14" height="14" alt="S2">
      </a>
      <a class="search-link search-link-crossref" href="https://search.crossref.org/?q=${searchQuery}&from_ui=yes" target="_blank" rel="noopener" title="CrossRef">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="search-link-svg">
          <rect width="24" height="24" rx="4" fill="#f89838"/>
          <path fill="#fff" fill-rule="evenodd" d="M7 8h10v2H7V8zm0 4h10v2H7v-2zm0 4h7v2H7v-2z"/>
        </svg>
      </a>
      <a class="search-link" href="https://dblp.org/search?q=${searchQuery}" target="_blank" rel="noopener" title="DBLP">
        <img src="https://dblp.org/img/dblp.icon.192x192.png" width="14" height="14" alt="DBLP">
      </a>
    </div>` : "";

    card.innerHTML = `<div class="entry-header">
      <div class="entry-header-text">
        <div class="entry-title">${esc(r.title || "(no title)")}</div>
        <div class="entry-meta">${esc(r.entry_id)} &middot; ${esc(r.entry_type)}</div>
      </div>
      <div class="entry-header-aside">
        ${jumpBtn}
        <div class="entry-tags">
          ${r.duplicate_of ? '<span class="status-tag tag-duplicate">Duplicate</span>' : ""}
          <span class="status-tag tag-${r.status}">${statusLabel(r.status)}</span>
        </div>
      </div>
    </div>${duplicateHTML}${reviewHintHTML}${notFoundHintHTML}${diffHTML}${actionsHTML}${searchLinks}`;

    // Cache normalized search haystack so search filtering stays cheap.
    card.dataset.searchHay = `${(r.entry_id || "").toLowerCase()} ${B.stripLatex(r.title || "").toLowerCase()}`;

    applyCardVisibility(card);
    entryList.appendChild(card);
    updateEntryEmptyState();
  }

  // ─── Fields table toggle ─────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".fields-toggle-btn");
    if (!btn) return;
    btn.closest(".fields-toggle-wrap").classList.toggle("collapsed");
  });

  // ─── Jump to preview ─────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-jump-preview");
    if (!btn) return;
    const entryId = btn.dataset.entryId;
    const target = previewCode.querySelector(`.diff-line[data-entry-id="${entryId}"]`);
    if (!target) return;

    const previewBody = previewCode.closest(".preview-body");
    previewBody.scrollTo({
      top: target.offsetTop - previewBody.offsetTop - 40,
      behavior: "smooth",
    });

    const toHighlight = [];
    let node = target;
    while (node) {
      toHighlight.push(node);
      const next = node.nextElementSibling;
      if (!next || next.dataset.entryId) break;
      node = next;
    }

    previewCode.querySelectorAll(".highlight-flash").forEach(el =>
      el.classList.remove("highlight-flash"));
    void previewCode.offsetWidth;
    toHighlight.forEach(el => el.classList.add("highlight-flash"));
  });

  // ─── Autoscroll preview ──────────────────────────────────────────
  let autoScrollEnabled = true;
  const btnAutoScroll = $("#btn-autoscroll");

  btnAutoScroll.addEventListener("click", () => {
    autoScrollEnabled = !autoScrollEnabled;
    btnAutoScroll.classList.toggle("active", autoScrollEnabled);
  });

  function getVisibleEntryCard() {
    const cards = $$(".entry-card:not(.hidden)");
    const viewMid = window.innerHeight / 2;
    let best = null;
    let bestDist = Infinity;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const cardMid = rect.top + rect.height / 2;
      const dist = Math.abs(cardMid - viewMid);
      if (dist < bestDist) {
        bestDist = dist;
        best = card;
      }
    }
    return best;
  }

  let scrollTicking = false;
  window.addEventListener("scroll", () => {
    if (!autoScrollEnabled || !scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(() => {
        scrollTicking = false;
        if (!autoScrollEnabled) return;
        const card = getVisibleEntryCard();
        if (!card) return;
        const entryId = card.querySelector(".btn-jump-preview")?.dataset?.entryId;
        if (!entryId) return;
        const target = previewCode.querySelector(`.diff-line[data-entry-id="${entryId}"]`);
        if (!target) return;

        const previewBody = previewCode.closest(".preview-body");
        const bodyHeight = previewBody.clientHeight;
        previewBody.scrollTo({
          top: target.offsetTop - previewBody.offsetTop - bodyHeight / 2 + 20,
          behavior: "smooth",
        });
      });
    }
  });

  // ─── Helpers for row visual state ────────────────────────────────
  function flashRow(row) {
    row.classList.remove("flash");
    void row.offsetWidth;
    row.classList.add("flash");
  }

  function syncRowState(row, action) {
    row.dataset.action = action;
    flashRow(row);
  }

  function syncBulkBtns(card, idx) {
    const diffRows = card.querySelectorAll(".diff-row:not(.field-row-plain)");
    if (!diffRows.length) return;
    const allFound = [...diffRows].every(r => r.dataset.action === "found");
    const allOriginal = [...diffRows].every(r => r.dataset.action === "original");
    const acceptBtn = card.querySelector(".btn-accept-all");
    const revertBtn = card.querySelector(".btn-revert-all");
    if (acceptBtn) acceptBtn.classList.toggle("active-accept", allFound);
    if (revertBtn) revertBtn.classList.toggle("active-revert", allOriginal);
  }

  // ─── Per-field action handlers ────────────────────────────────────
  document.addEventListener("click", (e) => {
    // Handle pill-original click (select original value)
    const origPill = e.target.closest(".pill-original");
    if (origPill) {
      const idx = parseInt(origPill.dataset.entry);
      const field = origPill.dataset.field;
      const val = origPill.dataset.val;
      const row = origPill.closest(".diff-row");

      if (!fieldEdits[idx]) fieldEdits[idx] = {};
      fieldEdits[idx][field] = { action: "original", value: val };

      row.querySelectorAll(".pill-original").forEach(p => p.classList.add("active"));
      row.querySelectorAll(".pill-suggested").forEach(p => p.classList.remove("active"));
      row.querySelectorAll(".fa-btn-x").forEach(b => b.classList.remove("active"));

      const sugPill = row.querySelector(".pill-suggested");
      if (sugPill) {
        sugPill.contentEditable = "false";
        sugPill.classList.remove("removed");
      }

      syncRowState(row, "original");
      syncBulkBtns(row.closest(".entry-card"), idx);
      updatePreview();
      return;
    }

    // Handle pill-suggested click (select suggested value) — only respond to click, not during editing
    const sugPill = e.target.closest(".pill-suggested");
    if (sugPill && !sugPill.classList.contains("active")) {
      const idx = parseInt(sugPill.dataset.entry);
      const field = sugPill.dataset.field;
      const val = sugPill.dataset.val;
      const row = sugPill.closest(".diff-row");

      if (!fieldEdits[idx]) fieldEdits[idx] = {};
      fieldEdits[idx][field] = { action: "found", value: val };

      row.querySelectorAll(".pill-original").forEach(p => p.classList.remove("active"));
      sugPill.classList.add("active");
      sugPill.classList.remove("removed");
      sugPill.contentEditable = "true";
      row.querySelectorAll(".fa-btn-x").forEach(b => b.classList.remove("active"));

      syncRowState(row, "found");
      syncBulkBtns(row.closest(".entry-card"), idx);
      updatePreview();
      return;
    }

    // Handle × button click (toggle remove field)
    const xBtn = e.target.closest(".fa-btn-x");
    if (xBtn) {
      const idx = parseInt(xBtn.dataset.entry);
      const field = xBtn.dataset.field;
      const row = xBtn.closest(".diff-row");
      const isEnc = row.dataset.enrichment === "1";
      const foundVal = decodeURIComponent(row.getAttribute("data-found-val") || "");
      const origVal = decodeURIComponent(row.getAttribute("data-original-val") || "");

      if (!fieldEdits[idx]) fieldEdits[idx] = {};

      // If already removed, undo back to the default action
      if (row.dataset.action === "remove") {
        const r = results[idx];
        const defaultAction = (r && r.status === "updated") ? "found" : "original";
        const origVal = decodeURIComponent(row.getAttribute("data-original-val") || "");

        // Handle pill-value (plain field rows)
        const valPill = row.querySelector(".pill-value");
        if (valPill) {
          const restoreVal = origVal || fieldEdits[idx]?.[field]?._savedValue || "";
          fieldEdits[idx][field] = { action: "original", value: restoreVal };
          valPill.textContent = restoreVal;
          valPill.classList.add("active");
          valPill.classList.remove("removed");
          valPill.contentEditable = "true";
          xBtn.classList.remove("active");
          syncRowState(row, "original");
        } else if (defaultAction === "found" || isEnc) {
          fieldEdits[idx][field] = { action: "found", value: foundVal };
          const sug = row.querySelector(".pill-suggested");
          if (sug) {
            sug.classList.add("active");
            sug.classList.remove("removed");
            sug.contentEditable = "true";
            sug.textContent = foundVal;
          }
          row.querySelectorAll(".pill-original").forEach(p => p.classList.remove("active"));
          xBtn.classList.remove("active");
          syncRowState(row, "found");
        } else {
          fieldEdits[idx][field] = { action: "original", value: origVal };
          row.querySelectorAll(".pill-original").forEach(p => p.classList.add("active"));
          const sug = row.querySelector(".pill-suggested");
          if (sug) {
            sug.classList.remove("active");
            sug.classList.remove("removed");
            sug.contentEditable = "false";
          }
          xBtn.classList.remove("active");
          syncRowState(row, "original");
        }
      } else {
        // Remove the field
        // Save current value for undo
        if (fieldEdits[idx][field]) {
          fieldEdits[idx][field]._savedValue = fieldEdits[idx][field].value;
        }
        fieldEdits[idx][field] = { action: "remove", value: "", _savedValue: fieldEdits[idx][field]?._savedValue || "" };
        row.querySelectorAll(".pill-original").forEach(p => p.classList.remove("active"));
        const sug = row.querySelector(".pill-suggested");
        if (sug) {
          sug.classList.remove("active");
          sug.classList.add("removed");
          sug.contentEditable = "false";
        }
        const valPill = row.querySelector(".pill-value");
        if (valPill) {
          valPill.classList.remove("active");
          valPill.classList.add("removed");
          valPill.contentEditable = "false";
        }
        xBtn.classList.add("active");
        syncRowState(row, "remove");
      }
      syncBulkBtns(row.closest(".entry-card"), idx);
      updatePreview();
      return;
    }

    // Handle old-style fa-btn (for "other fields" section)
    const btn = e.target.closest(".fa-btn");
    if (!btn) return;
    const idx = parseInt(btn.dataset.entry);
    const field = btn.dataset.field;
    const action = btn.dataset.action;
    const val = btn.dataset.val;

    const row = btn.closest(".diff-row");
    const isEnc = row.dataset.enrichment === "1";
    const foundVal = decodeURIComponent(row.getAttribute("data-found-val") || "");
    const origVal = decodeURIComponent(row.getAttribute("data-original-val") || "");

    if (!fieldEdits[idx]) fieldEdits[idx] = {};
    if (action === "original")
      fieldEdits[idx][field] = { action: "original", value: isEnc ? foundVal : val };
    else if (action === "found")
      fieldEdits[idx][field] = { action: "found", value: val };
    else
      fieldEdits[idx][field] = { action: "remove", value: "" };

    row.querySelectorAll(".fa-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const span = row.querySelector(".found-text");
    if (span) {
      if (action === "found") {
        span.textContent = foundVal;
        span.contentEditable = "true";
      } else if (action === "original") {
        span.textContent = foundVal;
        span.contentEditable = "false";
      } else {
        span.contentEditable = "false";
      }
      span.classList.toggle("removed", action === "remove");
    }

    syncRowState(row, action);
    syncBulkBtns(row.closest(".entry-card"), idx);
    updatePreview();
  });

  document.addEventListener("input", (e) => {
    const span = e.target.closest(".found-text[contenteditable], .pill-suggested[contenteditable], .pill-value[contenteditable]");
    if (!span) return;
    const idx = parseInt(span.dataset.entry);
    const field = span.dataset.field;
    if (!fieldEdits[idx]) fieldEdits[idx] = {};
    fieldEdits[idx][field] = { action: "custom", value: span.textContent.trim() };

    const row = span.closest(".diff-row");
    row.querySelectorAll(".fa-btn").forEach(b => b.classList.remove("active"));
    // For pill UI: mark suggested as active, original as inactive
    row.querySelectorAll(".pill-original").forEach(p => p.classList.remove("active"));
    if (span.classList.contains("pill-suggested")) span.classList.add("active");
    syncRowState(row, "custom");
    syncBulkBtns(row.closest(".entry-card"), idx);
    updatePreview();
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-accept-all, .btn-revert-all");
    if (!btn) return;
    const idx = parseInt(btn.dataset.entry);
    const isAccept = btn.classList.contains("btn-accept-all");
    const card = btn.closest(".entry-card");

    card.querySelectorAll(".diff-row:not(.field-row-plain)").forEach(row => {
      const field = row.dataset.field;
      const target = isAccept ? "found" : "original";
      const isEnc = row.dataset.enrichment === "1";
      const foundVal = decodeURIComponent(row.getAttribute("data-found-val") || "");

      // New pill-based UI
      const origPill = row.querySelector(".pill-original");
      const sugPill = row.querySelector(".pill-suggested");

      if (origPill || sugPill) {
        if (!fieldEdits[idx]) fieldEdits[idx] = {};

        if (isAccept) {
          // Accept suggested
          if (sugPill) {
            const val = sugPill.dataset.val;
            fieldEdits[idx][field] = { action: "found", value: val };
            if (origPill) origPill.classList.remove("active");
            sugPill.classList.add("active");
            sugPill.classList.remove("removed");
            sugPill.contentEditable = "true";
            sugPill.textContent = foundVal;
          }
        } else {
          // Keep original
          if (origPill) {
            fieldEdits[idx][field] = { action: "original", value: origPill.dataset.val };
            origPill.classList.add("active");
            if (sugPill) {
              sugPill.classList.remove("active");
              sugPill.classList.remove("removed");
              sugPill.contentEditable = "false";
            }
          } else if (isEnc && sugPill) {
            // Enrichment row: no original pill
            fieldEdits[idx][field] = { action: "original", value: foundVal };
            sugPill.classList.remove("active");
            sugPill.classList.remove("removed");
            sugPill.contentEditable = "false";
            sugPill.textContent = foundVal;
          }
        }

        row.querySelectorAll(".fa-btn-x").forEach(b => b.classList.remove("active"));
        syncRowState(row, target);
      } else {
        // Fallback for old-style rows
        const targetBtn = row.querySelector(`.fa-btn[data-action="${target}"]`);

        if (targetBtn) {
          const val = targetBtn.dataset.val;
          if (!fieldEdits[idx]) fieldEdits[idx] = {};
          fieldEdits[idx][field] = { action: target, value: val };

          row.querySelectorAll(".fa-btn").forEach(b => b.classList.remove("active"));
          targetBtn.classList.add("active");

          const span = row.querySelector(".found-text");
          if (span) {
            span.textContent = foundVal;
            span.classList.remove("removed");
            span.contentEditable = target === "found" ? "true" : "false";
          }

          syncRowState(row, target);
        } else if (!isAccept && isEnc) {
          if (!fieldEdits[idx]) fieldEdits[idx] = {};
          fieldEdits[idx][field] = { action: "original", value: foundVal };

          row.querySelectorAll(".fa-btn").forEach(b => b.classList.remove("active"));

          const span = row.querySelector(".found-text");
          if (span) {
            span.textContent = foundVal;
            span.classList.remove("removed");
            span.contentEditable = "false";
          }

          syncRowState(row, "original");
        }
      }
    });
    syncBulkBtns(card, idx);
    updatePreview();
  });

  function updateSummary() {
    const c = { verified: 0, updated: 0, needs_review: 0, not_found: 0 };
    let dupes = 0;
    results.forEach(r => {
      c[r.status] = (c[r.status] || 0) + 1;
      if (r.duplicate_of) dupes++;
    });
    $(".badge-verified .summary-count").textContent = c.verified;
    $(".badge-updated .summary-count").textContent = c.updated;
    $(".badge-review .summary-count").textContent = c.needs_review;
    $(".badge-notfound .summary-count").textContent = c.not_found;
    $(".badge-duplicates .summary-count").textContent = dupes;
    $$(".summary-badge").forEach(b => b.classList.add("active"));
  }

  // ─── Author truncation ────────────────────────────────────────────
  function truncateAuthors(authorStr, max) {
    if (!authorStr || max <= 0) return authorStr;
    // BibTeX authors are separated by " and "
    const authors = authorStr.split(/\s+and\s+/i);
    if (authors.length <= max) return authorStr;
    return authors.slice(0, max).join(" and ") + " and others";
  }

  function updateAuthorPills() {
    const max = parseInt(optMaxAuthors.value) || 0;

    // Update existing API author diff rows
    $$('.diff-row[data-field="author"]:not([data-injected])').forEach(row => {
      const foundVal = decodeURIComponent(row.getAttribute("data-found-val") || "");
      const origVal = decodeURIComponent(row.getAttribute("data-original-val") || "");
      const sugPill = row.querySelector(".pill-suggested");
      if (sugPill && row.dataset.action !== "custom") {
        const truncated = max > 0 ? truncateAuthors(foundVal, max) : foundVal;
        sugPill.textContent = truncated;
        if (truncated.trim() === origVal.trim()) {
          row.classList.add("author-match-hidden");
        } else {
          row.classList.remove("author-match-hidden");
        }
      }
    });

    // Remove any previously injected rows
    $$('.diff-row[data-injected]').forEach(row => {
      const card = row.closest(".entry-card");
      const idx = parseInt(row.dataset.entry);
      row.remove();
      // Clean up empty diff tables
      if (card) {
        const diffTable = card.querySelector(".diff-table:not(.fields-table)");
        if (diffTable && diffTable.querySelectorAll(".diff-row").length === 0) {
          diffTable.remove();
        }
        // Unhide plain author row
        const plainRow = card.querySelector('.field-row-plain[data-field="author"]');
        if (plainRow) plainRow.classList.remove("author-match-hidden");
      }
      // Clean up fieldEdits injected entry
      if (fieldEdits[idx]?.author?._injected) {
        delete fieldEdits[idx].author;
      }
    });

    // For entries WITHOUT an existing author diff row, inject if truncation differs
    if (max > 0) {
      $$(".entry-card").forEach(card => {
        const idx = parseInt(card.dataset.index);
        const entry = parsedEntries[idx];
        const res = results[idx];
        if (!entry || !entry.author) return;
        /* No lookup match — don't inject truncation as if it were an API suggestion row */
        if (res && res.status === "not_found") return;

        const existingRow = card.querySelector('.diff-row[data-field="author"]:not(.field-row-plain)');
        if (existingRow) return; // Already has an API diff row

        const authorCount = entry.author.split(/\s+and\s+/i).length;
        if (authorCount <= max) return;

        const truncated = truncateAuthors(entry.author, max);
        if (truncated.trim() === entry.author.trim()) return;

        // Set fieldEdits for this entry
        if (!fieldEdits[idx]) fieldEdits[idx] = {};
        fieldEdits[idx].author = { action: "found", value: truncated, _injected: true };

        // Find or create the diff table
        let diffTable = card.querySelector(".diff-table:not(.fields-table)");
        if (!diffTable) {
          const tableHTML = `<table class="diff-table"><tr><th>Field</th><th>Your Value</th><th>Suggested</th><th></th></tr></table>`;
          const insertAfter = card.querySelector(".review-hint") || card.querySelector(".not-found-hint") || card.querySelector(".entry-header");
          insertAfter.insertAdjacentHTML("afterend", tableHTML);
          diffTable = card.querySelector(".diff-table:not(.fields-table)");
        }

        const origAttr = encodeURIComponent(entry.author);
        const foundAttr = encodeURIComponent(truncated);
        const rowHTML = `<tr class="diff-row" data-entry="${idx}" data-field="author" data-action="found"
          data-enrichment="" data-injected="1"
          data-found-val="${foundAttr}"
          data-original-val="${origAttr}">
          <td class="field-name"><span class="field-name-pill">author</span></td>
          <td class="val-col val-col-original">
            <button class="choice-pill pill-original"
                    data-entry="${idx}" data-field="author" data-action="original" data-val="${esc(entry.author)}"
                    title="Keep your value">${esc(entry.author)}</button>
          </td>
          <td class="val-col val-col-suggested">
            <span class="choice-pill pill-suggested active"
                    contenteditable="true" spellcheck="false"
                    data-entry="${idx}" data-field="author" data-action="found" data-val="${esc(truncated)}"
                    title="Use suggested value (click to select, edit to customize)">${esc(truncated)}</span>
          </td>
          <td class="field-actions-mini">
            <button class="fa-btn-x" title="Remove field"
                    data-entry="${idx}" data-field="author" data-action="remove" data-val="">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </td>
        </tr>`;
        const headerRow = diffTable.querySelector("tr");
        headerRow.insertAdjacentHTML("afterend", rowHTML);

        // Also hide the author from "Other fields" if it exists there
        const plainAuthorRow = card.querySelector('.field-row-plain[data-field="author"]');
        if (plainAuthorRow) plainAuthorRow.classList.add("author-match-hidden");
      });
    } else {
      // max is 0 (All) — unhide any hidden plain author rows
      $$('.field-row-plain[data-field="author"].author-match-hidden').forEach(row => {
        row.classList.remove("author-match-hidden");
      });
    }

    // Update card statuses
    updateCardStatuses();
  }

  function updateCardStatuses() {
    $$(".entry-card").forEach(card => {
      const idx = parseInt(card.dataset.index);
      const r = results[idx];
      if (!r) return;
      const origStatus = r.status;

      // Store original status on the card if not already saved
      if (!card.dataset.origStatus) card.dataset.origStatus = origStatus;
      const savedStatus = card.dataset.origStatus;

      // Check all non-plain diff rows (including injected ones)
      const diffRows = card.querySelectorAll(".diff-row:not(.field-row-plain)");
      const hasVisibleDiffs = diffRows.length > 0 && ![...diffRows].every(row => row.classList.contains("author-match-hidden"));
      const hasInjectedRows = card.querySelector('.diff-row[data-injected]') !== null;

      let effectiveStatus;
      if (hasInjectedRows && hasVisibleDiffs && savedStatus === "verified") {
        // Was verified but now has injected author truncation suggestion
        effectiveStatus = "updated";
      } else if (!hasVisibleDiffs && (savedStatus === "updated" || savedStatus === "needs_review")) {
        // All diffs hidden — promote to verified
        effectiveStatus = "verified";
      } else {
        effectiveStatus = savedStatus;
      }

      // Update card visuals
      card.dataset.status = effectiveStatus;
      card.className = card.className.replace(/status-\S+/, `status-${effectiveStatus}`);
      const tag = card.querySelector(".status-tag:not(.tag-duplicate)");
      if (tag) {
        tag.className = `status-tag tag-${effectiveStatus}`;
        tag.textContent = statusLabel(effectiveStatus);
      }

      // Hide/show the diff table and actions
      const diffTable = card.querySelector(".diff-table:not(.fields-table)");
      if (diffTable) diffTable.style.display = !hasVisibleDiffs && !hasInjectedRows ? "none" : "";
      const actions = card.querySelector(".entry-actions");
      if (actions) actions.style.display = !hasVisibleDiffs ? "none" : "";
    });

    // Recount summary
    updateDynamicSummary();
  }

  function updateDynamicSummary() {
    const c = { verified: 0, updated: 0, needs_review: 0, not_found: 0 };
    let dupes = 0;
    $$(".entry-card").forEach(card => {
      const status = card.dataset.status;
      c[status] = (c[status] || 0) + 1;
      if (card.dataset.duplicate === "true") dupes++;
    });
    $(".badge-verified .summary-count").textContent = c.verified;
    $(".badge-updated .summary-count").textContent = c.updated;
    $(".badge-review .summary-count").textContent = c.needs_review;
    $(".badge-notfound .summary-count").textContent = c.not_found;
    $(".badge-duplicates .summary-count").textContent = dupes;
  }

  // ─── Live preview ────────────────────────────────────────────────
  function buildPreviewBib() {
    const s = getSettings();
    const count = results.length;
    let final = parsedEntries.slice(0, count).map((entry, i) => {
      const r = results[i];
      if (!r) return { ...entry };
      if (s.removeNotFound && r.status === "not_found") return null;

      const out = { ...entry };
      const edits = fieldEdits[i] || {};
      for (const [field, fe] of Object.entries(edits)) {
        if (!fe) continue;
        if (fe.action === "found" || fe.action === "custom") {
          if (fe.value) out[field] = fe.value;
        } else if (fe.action === "remove") {
          delete out[field];
        }
      }

      if (s.maxAuthors > 0 && out.author && r.status !== "not_found") {
        out.author = truncateAuthors(out.author, s.maxAuthors);
      }

      if (s.preferPublished) {
        const venue = (out.journal || out.booktitle || "").toLowerCase();
        if (venue.includes("arxiv") || venue.includes("preprint") || venue.includes("corr")) {
          const res = results[i];
          if (res && res.suggested) {
            const foundVenue = res.suggested.journal || res.suggested.booktitle || "";
            const fvLower = foundVenue.toLowerCase();
            if (foundVenue && !fvLower.includes("arxiv") && !fvLower.includes("preprint") && !fvLower.includes("corr")) {
              if (out.journal) out.journal = foundVenue;
              else if (out.booktitle) out.booktitle = foundVenue;
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
        if (s.dedupBy === "doi") key = (entry.doi || "").toLowerCase().trim();
        else if (s.dedupBy === "id") key = (entry.ID || "").toLowerCase().trim();
        else key = B.normalizeTitle(entry.title || "");
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return B.entriesToBib(final);
  }

  let currentPreviewBib = "";

  function diffLines(oldLines, newLines) {
    const m = oldLines.length, n = newLines.length;
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);

    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.push({ type: "ctx", text: newLines[j - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.push({ type: "add", text: newLines[j - 1] });
        j--;
      } else {
        result.push({ type: "del", text: oldLines[i - 1] });
        i--;
      }
    }
    return result.reverse();
  }

  function buildOriginalBib() {
    return B.entriesToBib(parsedEntries.slice(0, results.length));
  }

  function renderDiff(oldBib, newBib) {
    const oldLines = oldBib.split("\n");
    const newLines = newBib.split("\n");
    const ops = diffLines(oldLines, newLines);
    const hasChanges = ops.some(o => o.type !== "ctx");

    if (!hasChanges) {
      return ops.map(o => {
        const entryMatch = o.text.match(/^@\w+\{(.+),\s*$/);
        const idAttr = entryMatch ? ` data-entry-id="${esc(entryMatch[1])}"` : "";
        return `<span class="diff-line diff-ctx"${idAttr}>${esc(o.text)}</span>`;
      }).join("");
    }

    return ops.map(o => {
      const cls = o.type === "add" ? "diff-add" : o.type === "del" ? "diff-del" : "diff-ctx";
      const entryMatch = o.text.match(/^@\w+\{(.+),\s*$/);
      const idAttr = entryMatch ? ` data-entry-id="${esc(entryMatch[1])}"` : "";
      return `<span class="diff-line ${cls}"${idAttr}>${esc(o.text)}</span>`;
    }).join("");
  }

  function updatePreview() {
    if (!parsedEntries.length) return;
    currentPreviewBib = buildPreviewBib();
    const origBib = buildOriginalBib();
    previewPlaceholder.style.display = "none";
    previewCode.style.display = "block";
    previewCode.innerHTML = renderDiff(origBib, currentPreviewBib);
  }

  const btnCopy = $("#btn-copy-preview");
  btnCopy.addEventListener("click", () => {
    if (!currentPreviewBib) return;
    navigator.clipboard.writeText(currentPreviewBib).then(() => {
      btnCopy.classList.add("copied");
      const origHTML = btnCopy.innerHTML;
      btnCopy.innerHTML = origHTML.replace("Copy", "Copied!");
      setTimeout(() => {
        btnCopy.classList.remove("copied");
        btnCopy.innerHTML = origHTML;
      }, 1500);
    });
  });

  // ─── Filtering ────────────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const badge = e.target.closest(".summary-badge");
    if (!badge) return;
    const filter = badge.dataset.filter;
    activeFilter = activeFilter === filter ? "all" : filter;
    $$(".summary-badge").forEach(b =>
      b.classList.toggle("active", activeFilter === "all" || b.dataset.filter === activeFilter));
    applyAllCardVisibility();
  });

  // ─── Entry search ────────────────────────────────────────────────
  const entrySearchWrap = $(".entry-search");
  const entrySearchInput = $("#entry-search-input");
  const entrySearchClear = $("#entry-search-clear");

  function setSearch(value) {
    activeSearch = (value || "").trim().toLowerCase();
    entrySearchWrap?.classList.toggle("has-query", !!activeSearch);
    applyAllCardVisibility();
  }

  entrySearchInput?.addEventListener("input", (e) => setSearch(e.target.value));
  entrySearchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      entrySearchInput.value = "";
      setSearch("");
      entrySearchInput.blur();
    }
  });
  entrySearchClear?.addEventListener("click", () => {
    if (!entrySearchInput) return;
    entrySearchInput.value = "";
    setSearch("");
    entrySearchInput.focus();
  });

  // Global "/" hotkey to focus search, unless the user is already typing somewhere.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (!entrySearchInput || entrySearchInput.offsetParent === null) return;
    e.preventDefault();
    entrySearchInput.focus();
    entrySearchInput.select();
  });

  // ─── Settings popover ────────────────────────────────────────────
  const settingsToggle = $("#settings-toggle");
  const settingsPopover = $("#settings-popover");
  const optRemoveDuplicates = $("#opt-remove-duplicates");
  const optRemoveNotFound = $("#opt-remove-notfound");
  const optMaxAuthors = $("#opt-max-authors");
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
    updatePreview();
  });

  [optRemoveNotFound, optPreferPublished].forEach(el =>
    el.addEventListener("change", updatePreview));
  optMaxAuthors.addEventListener("change", () => {
    updateAuthorPills();
    updatePreview();
  });
  $$('input[name="dedup-criteria"]').forEach(el =>
    el.addEventListener("change", updatePreview));

  function getSettings() {
    return {
      removeDuplicates: optRemoveDuplicates.checked,
      dedupBy: (document.querySelector('input[name="dedup-criteria"]:checked') || {}).value || "title",
      removeNotFound: optRemoveNotFound.checked,
      maxAuthors: parseInt(optMaxAuthors.value) || 0,
      preferPublished: optPreferPublished.checked,
    };
  }

  // ─── Download ─────────────────────────────────────────────────────
  btnDownload.addEventListener("click", () => {
    const bibContent = currentPreviewBib || buildPreviewBib();
    const blob = new Blob([bibContent], { type: "application/x-bibtex" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "verified_refs.bib";
    a.click();
    URL.revokeObjectURL(url);
  });

  // ─── First-visit onboarding tour ───────────────────────────────────
  const ONBOARDING_STORAGE = "bv-onboarding-dismissed";
  const ONBOARDING_VER_KEY = "bv-onboarding-version";
  const ONBOARDING_VER = "3";

  const ONBOARDING_SAMPLE_BIB = `@article{tour_attention2017,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and others},
  journal = {Wrong Venue Placeholder},
  year = {2017},
}

@article{tour_fabricated2099,
  title = {Totally Fabricated Paper Title QZX999},
  author = {Nobody, N.},
  journal = {Journal of Nonexistence},
  year = {2099},
}`;

  function shouldAutoShowOnboarding() {
    if (localStorage.getItem(ONBOARDING_VER_KEY) !== ONBOARDING_VER)
      return true;
    return !localStorage.getItem(ONBOARDING_STORAGE);
  }

  function markOnboardingComplete() {
    localStorage.setItem(ONBOARDING_STORAGE, "1");
    localStorage.setItem(ONBOARDING_VER_KEY, ONBOARDING_VER);
  }

  function switchToPasteTab() {
    inputTabs.forEach(t => t.classList.toggle("active", t.dataset.tab === "paste"));
    tabPanels.forEach(p => p.classList.toggle("active", p.id === "tab-paste"));
  }

  const introOnboardingSteps = [
    {
      title: "Welcome",
      body: "BibTeX Verifier checks each entry against CrossRef and Semantic Scholar — wrong metadata, missing DOIs, duplicates, and citations that don’t exist online (including AI hallucinations). Your file stays in the browser.",
      target: null,
    },
    {
      title: "Add your bibliography",
      body: "Upload a <strong>.bib</strong> file or switch to <strong>Paste BibTeX</strong> and paste from Overleaf or anywhere else.",
      target: ".input-tabs",
    },
    {
      title: "Sample loaded",
      body: "We’ve switched to the paste tab and inserted a tiny <strong>two-entry sample</strong>: one famous paper with intentional wrong venue text, and one fake title so you can see how mismatches look.",
      target: "#bib-paste",
      onEnter: () => {
        switchToPasteTab();
        bibPaste.value = ONBOARDING_SAMPLE_BIB;
        bibPaste.focus({ preventScroll: true });
      },
    },
    {
      title: "Run verification",
      body: "Click <strong>Verify pasted BibTeX</strong> when you’re ready. The app queries CrossRef and Semantic Scholar (a short wait per entry). <strong>When it finishes, the tour continues</strong> and walks through both sample results — updated vs not found — plus settings.",
      target: "#btn-verify-paste",
    },
    {
      title: "Start with the sample",
      body: "Use <strong>Verify sample &amp; explore</strong> below to run the demo (same as the real verify button). Or close the tour and paste your own .bib anytime.",
      target: "#btn-verify-paste",
      final: true,
    },
  ];

  function mountOnboardingTour(steps, variant = "intro") {
    closeOnboarding();

    let stepIndex = 0;
    let lastRenderedStepIndex = -1;
    const isIntro = variant === "intro";
    const finalActionsDual = isIntro;

    const backdrop = document.createElement("div");
    backdrop.className = "onboarding-backdrop onboarding-backdrop-fixed";
    backdrop.setAttribute("data-dismiss", "1");

    const panelLayer = document.createElement("div");
    panelLayer.className = "onboarding-panel-layer";
    panelLayer.setAttribute("role", "dialog");
    panelLayer.setAttribute("aria-modal", "true");
    panelLayer.setAttribute("aria-labelledby", "onboarding-title");
    panelLayer._onboardingBackdrop = backdrop;

    const finalBlock = finalActionsDual
      ? `<div class="onboarding-actions onboarding-actions-final hidden">
          <button type="button" class="btn-onboarding secondary" data-action="finish">Close tour</button>
          <button type="button" class="btn-onboarding primary" data-action="verify-sample">Verify sample &amp; explore</button>
        </div>`
      : `<div class="onboarding-actions onboarding-actions-final hidden">
          <button type="button" class="btn-onboarding primary" data-action="finish">Got it</button>
        </div>`;
    panelLayer.innerHTML = `
      <div class="onboarding-panel glass">
        <div class="onboarding-meta">
          <span class="onboarding-step-label"></span>
          <div class="onboarding-dots"></div>
        </div>
        <h2 id="onboarding-title" class="onboarding-title"></h2>
        <div class="onboarding-body"></div>
        <div class="onboarding-actions onboarding-actions-main">
          <button type="button" class="btn-onboarding ghost" data-action="skip">Skip tour</button>
          <button type="button" class="btn-onboarding primary" data-action="next">Next</button>
        </div>
        ${finalBlock}
      </div>`;
    document.body.appendChild(backdrop);
    document.body.appendChild(panelLayer);
    onboardingOverlayEl = panelLayer;

    const titleEl = panelLayer.querySelector(".onboarding-title");
    const bodyEl = panelLayer.querySelector(".onboarding-body");
    const stepLabel = panelLayer.querySelector(".onboarding-step-label");
    const dotsWrap = panelLayer.querySelector(".onboarding-dots");
    const actionsMain = panelLayer.querySelector(".onboarding-actions-main");

    dotsWrap.innerHTML = steps.map((_, i) =>
      `<span class="onboarding-dot${i === 0 ? " active" : ""}" data-i="${i}"></span>`
    ).join("");

    function updateHighlight(selector, step = {}) {
      document.querySelectorAll(".onboarding-target").forEach(el => el.classList.remove("onboarding-target"));
      floatingBar?.classList.remove("onboarding-target-bar");

      panelLayer.classList.toggle("onboarding-panel-top", !!step.panelTop);

      if (!selector) return;
      const el = document.querySelector(selector);
      if (floatingBar && el && floatingBar.contains(el))
        floatingBar.classList.add("onboarding-target-bar");
      if (el) {
        el.classList.add("onboarding-target");
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }

    function renderStep() {
      if (lastRenderedStepIndex >= 0) {
        const prev = steps[lastRenderedStepIndex];
        if (prev?.onLeave) prev.onLeave();
      }
      lastRenderedStepIndex = stepIndex;

      const step = steps[stepIndex];
      panelLayer._currentStepOnLeave = step.onLeave || null;

      if (isIntro) {
        if (stepIndex <= 2) document.body.removeAttribute("data-onboarding-stage");
        else if (stepIndex === 3) document.body.dataset.onboardingStage = "verify";
        else if (step.final) document.body.dataset.onboardingStage = "verify-final";
      }

      if (step.onEnter) step.onEnter();

      titleEl.textContent = step.title;
      bodyEl.innerHTML = step.body;
      stepLabel.textContent = `Step ${stepIndex + 1} of ${steps.length}`;

      dotsWrap.querySelectorAll(".onboarding-dot").forEach((d, i) => {
        d.classList.toggle("active", i === stepIndex);
      });

      const isFinal = !!step.final;
      actionsMain.classList.toggle("hidden", isFinal);
      panelLayer.querySelector(".onboarding-actions-final").classList.toggle("hidden", !isFinal);

      updateHighlight(step.target, step);

      const nextBtn = panelLayer.querySelector(".onboarding-actions-main [data-action=\"next\"]");
      if (nextBtn) nextBtn.textContent = "Next";
    }

    backdrop.addEventListener("click", () => {
      markOnboardingComplete();
      closeOnboarding();
    });

    panelLayer.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const act = btn.dataset.action;
      if (act === "skip") {
        markOnboardingComplete();
        closeOnboarding();
        return;
      }
      if (act === "next") {
        stepIndex++;
        if (stepIndex >= steps.length) {
          markOnboardingComplete();
          closeOnboarding();
        } else renderStep();
        return;
      }
      if (act === "finish") {
        markOnboardingComplete();
        closeOnboarding();
        return;
      }
      if (act === "verify-sample" && finalActionsDual) {
        pendingOnboardingResumeClick = true;
        closeOnboarding();
        const txt = bibPaste.value.trim() || ONBOARDING_SAMPLE_BIB;
        if (!bibPaste.value.trim()) bibPaste.value = ONBOARDING_SAMPLE_BIB;
        switchToPasteTab();
        startVerificationFromContent(txt, "Parsing pasted content...");
      }
    });

    function onEsc(ev) {
      if (ev.key !== "Escape" || !onboardingOverlayEl) return;
      markOnboardingComplete();
      closeOnboarding();
    }
    panelLayer._kbdEsc = onEsc;
    document.addEventListener("keydown", onEsc);

    renderStep();
  }

  function openOnboardingPostVerifyTour() {
    const postSteps = [
      {
        title: "Summary filters",
        body: "These <strong>badges</strong> count results by status — verified, updated, needs review, not found. Click one to filter the list below.",
        target: ".summary-bar",
        panelTop: true,
      },
      {
        title: "First entry — metadata updated",
        body: "This row matched a real paper. The sample used a <strong>wrong journal</strong> on purpose — suggested venue, DOI, and other fields come from CrossRef / Semantic Scholar. Each line compares your text to the suggestion; accept or revert per field.",
        target: ".entry-list .entry-card:nth-child(1)",
        panelTop: true,
      },
      {
        title: "Fake entry — not found",
        body: "This title is <strong>made up</strong>. Nothing credible matched online, so it’s labeled <strong>Not found</strong> — what you’d see for hallucinated or mistaken references.",
        target: ".entry-list .entry-card:nth-child(2)",
        panelTop: true,
      },
      {
        title: "Settings",
        body: "Use the <strong>gear</strong> in the bottom bar (above the dimmed area) to open settings: download options (for example removing not-found rows), author limits, and more. Try toggles here; press <strong>Next</strong> when you’re done exploring.",
        target: "#settings-toggle",
        panelTop: true,
        onEnter: () => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              settingsPopover.classList.add("open");
              settingsToggle.classList.add("active");
            });
          });
        },
        onLeave: () => {
          settingsPopover.classList.remove("open");
          settingsToggle.classList.remove("active");
        },
      },
      {
        title: "Bottom bar & download",
        body: "The <strong>floating bar</strong> stays here for settings and <strong>download verified BibTeX</strong> when you’re ready. Replace the sample with your own bibliography anytime.",
        target: "#floating-bar",
        panelTop: true,
        final: true,
      },
    ];
    mountOnboardingTour(postSteps, "postResults");
  }

  function openOnboardingTour({ force = false } = {}) {
    if (!force && onboardingOverlayEl) return;
    mountOnboardingTour(introOnboardingSteps, "intro");
  }

  $("#btn-start-tour")?.addEventListener("click", () => openOnboardingTour({ force: true }));
  $("#footer-start-tour")?.addEventListener("click", () => openOnboardingTour({ force: true }));

  if (shouldAutoShowOnboarding())
    setTimeout(() => openOnboardingTour({ force: false }), 500);

  const heroOverviewMq = window.matchMedia("(max-width: 640px)");
  const heroOverviewToggle = $("#hero-overview-toggle");
  const heroOverviewPanel = $("#hero-overview");
  const heroOverviewLabel = $("#hero-overview-toggle-label");

  function syncHeroOverview() {
    if (!heroOverviewToggle || !heroOverviewPanel || !heroOverviewLabel) return;
    if (!heroOverviewMq.matches) {
      heroOverviewPanel.hidden = false;
      heroOverviewToggle.setAttribute("aria-expanded", "true");
      heroOverviewToggle.classList.add("is-expanded");
      heroOverviewLabel.textContent = "About this tool";
      return;
    }
    const expanded = sessionStorage.getItem("bv-hero-overview-expanded") === "1";
    heroOverviewPanel.hidden = !expanded;
    heroOverviewToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    heroOverviewToggle.classList.toggle("is-expanded", expanded);
    heroOverviewLabel.textContent = expanded ? "Hide overview" : "About this tool";
  }

  heroOverviewToggle?.addEventListener("click", () => {
    if (!heroOverviewMq.matches) return;
    const curExpanded = heroOverviewToggle.getAttribute("aria-expanded") === "true";
    sessionStorage.setItem("bv-hero-overview-expanded", curExpanded ? "0" : "1");
    syncHeroOverview();
  });

  heroOverviewMq.addEventListener("change", syncHeroOverview);
  syncHeroOverview();

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }
})();
