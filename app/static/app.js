(() => {
  "use strict";

  let sessionId = null;
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

  // Upload handling
  uploadZone.addEventListener("click", () => fileInput.click());

  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("dragover");
  });

  uploadZone.addEventListener("dragleave", () => {
    uploadZone.classList.remove("dragover");
  });

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  async function handleFile(file) {
    if (!file.name.endsWith(".bib")) {
      alert("Please upload a .bib file.");
      return;
    }

    results = [];
    decisions = {};
    activeFilter = "all";
    entryList.innerHTML = "";
    downloadBar.style.display = "none";
    resultsSection.style.display = "none";

    progressSection.style.display = "block";
    progressFill.style.width = "0%";
    progressText.textContent = "Uploading...";

    const formData = new FormData();
    formData.append("file", file);

    try {
      const resp = await fetch("/api/upload", { method: "POST", body: formData });
      if (!resp.ok) {
        const err = await resp.json();
        alert(err.detail || "Upload failed");
        progressSection.style.display = "none";
        return;
      }
      const { session_id, entry_count } = await resp.json();
      sessionId = session_id;
      progressText.textContent = `Verifying 0 / ${entry_count} entries...`;
      startVerification(entry_count);
    } catch (err) {
      alert("Upload failed: " + err.message);
      progressSection.style.display = "none";
    }
  }

  function startVerification(total) {
    const evtSource = new EventSource(`/api/verify/${sessionId}`);

    evtSource.addEventListener("progress", (e) => {
      const d = JSON.parse(e.data);
      const pct = Math.round((d.current / d.total) * 100);
      progressFill.style.width = pct + "%";
      progressText.textContent = `Verifying ${d.current} / ${d.total}: ${d.title}`;
    });

    evtSource.addEventListener("entry_result", (e) => {
      const result = JSON.parse(e.data);
      results.push(result);
      renderEntryCard(result);
    });

    evtSource.addEventListener("done", () => {
      evtSource.close();
      progressSection.style.display = "none";
      resultsSection.style.display = "block";
      downloadBar.style.display = "block";
      updateSummary();
    });

    evtSource.onerror = () => {
      evtSource.close();
      progressSection.style.display = "none";
      if (results.length > 0) {
        resultsSection.style.display = "block";
        downloadBar.style.display = "block";
        updateSummary();
      }
    };
  }

  function statusLabel(status) {
    switch (status) {
      case "verified": return "Verified";
      case "updated": return "Auto-Updated";
      case "needs_review": return "Needs Review";
      case "not_found": return "Not Found";
      default: return status;
    }
  }

  function renderEntryCard(r) {
    const card = document.createElement("div");
    card.className = `entry-card status-${r.status}`;
    card.dataset.status = r.status;
    card.dataset.index = r.index;

    let diffHTML = "";
    if (r.field_diffs && r.field_diffs.length > 0) {
      diffHTML = `
        <table class="diff-table">
          <tr><th>Field</th><th>Original</th><th>Found</th><th>Match</th></tr>
          ${r.field_diffs.map((d) => `
            <tr>
              <td class="field-name">${escHtml(d.field)}</td>
              <td class="old-val">${escHtml(d.original || "(empty)")}</td>
              <td class="new-val">${escHtml(d.found || "(empty)")}</td>
              <td class="score-val">${d.score}%</td>
            </tr>
          `).join("")}
        </table>`;
    }

    let foundTitleHTML = "";
    if (r.status === "needs_review" && r.found_title) {
      foundTitleHTML = `
        <div class="found-title-row">
          Closest match (${r.title_score}%): <strong>${escHtml(r.found_title)}</strong>
        </div>`;
    }

    let actionsHTML = "";
    if (r.status === "updated" || r.status === "needs_review") {
      const defaultDecision = r.status === "updated" ? "accept" : "reject";
      decisions[r.index] = decisions[r.index] || defaultDecision;
      actionsHTML = `
        <div class="entry-actions">
          <button class="btn btn-accept ${decisions[r.index] === "accept" ? "selected" : ""}"
                  onclick="window._decide(${r.index}, 'accept', this)">Accept Changes</button>
          <button class="btn btn-reject ${decisions[r.index] === "reject" ? "selected" : ""}"
                  onclick="window._decide(${r.index}, 'reject', this)">Keep Original</button>
        </div>`;
    }

    card.innerHTML = `
      <div class="entry-header">
        <div>
          <div class="entry-title">${escHtml(r.title || "(no title)")}</div>
          <div class="entry-meta">${escHtml(r.entry_id)} &middot; ${escHtml(r.entry_type)}</div>
        </div>
        <span class="status-tag tag-${r.status}">${statusLabel(r.status)}</span>
      </div>
      ${foundTitleHTML}
      ${diffHTML}
      ${actionsHTML}
    `;

    entryList.appendChild(card);
  }

  window._decide = function (index, decision, btn) {
    decisions[index] = decision;
    const card = btn.closest(".entry-card");
    card.querySelectorAll(".btn-accept, .btn-reject").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
  };

  function updateSummary() {
    const counts = { verified: 0, updated: 0, needs_review: 0, not_found: 0 };
    results.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });

    $(".badge-verified").textContent = `Verified: ${counts.verified}`;
    $(".badge-updated").textContent = `Auto-Updated: ${counts.updated}`;
    $(".badge-review").textContent = `Needs Review: ${counts.needs_review}`;
    $(".badge-notfound").textContent = `Not Found: ${counts.not_found}`;

    $$(".summary-badge").forEach((b) => b.classList.add("active"));
  }

  // Filter badges
  document.addEventListener("click", (e) => {
    const badge = e.target.closest(".summary-badge");
    if (!badge) return;

    const filter = badge.dataset.filter;
    if (activeFilter === filter) {
      activeFilter = "all";
    } else {
      activeFilter = filter;
    }

    $$(".summary-badge").forEach((b) => {
      b.classList.toggle("active", activeFilter === "all" || b.dataset.filter === activeFilter);
    });

    $$(".entry-card").forEach((card) => {
      if (activeFilter === "all" || card.dataset.status === activeFilter) {
        card.classList.remove("hidden");
      } else {
        card.classList.add("hidden");
      }
    });
  });

  // Download
  $(".btn-download").addEventListener("click", async () => {
    if (!sessionId) return;

    await fetch(`/api/accept/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions }),
    });

    window.location.href = `/api/download/${sessionId}`;
  });

  function escHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
