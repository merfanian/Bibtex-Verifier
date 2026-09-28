// Upload / paste input tabs.
import { $, $$ } from "./dom.js";

const inputTabs = $$(".input-tab");
const tabPanels = $$(".tab-panel");
const uploadZone = $(".upload-zone");
const fileInput = $("#file-input");
const btnVerifyPaste = $("#btn-verify-paste");

export const bibPaste = $("#bib-paste");

export function switchToPasteTab() {
  inputTabs.forEach(t => t.classList.toggle("active", t.dataset.tab === "paste"));
  tabPanels.forEach(p => p.classList.toggle("active", p.id === "tab-paste"));
}

/**
 * @param {{ onContent: (content: string, statusMsg: string) => void }} handlers
 */
export function initInput({ onContent }) {
  inputTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      inputTabs.forEach(t => t.classList.remove("active"));
      tabPanels.forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      $(`#tab-${tab.dataset.tab}`).classList.add("active");
    });
  });

  async function handleFile(file) {
    if (!file.name.endsWith(".bib")) { alert("Please upload a .bib file."); return; }
    onContent(await file.text(), "Reading file...");
  }

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

  btnVerifyPaste.addEventListener("click", () => {
    const content = bibPaste.value.trim();
    if (!content) { alert("Please paste your BibTeX content first."); return; }
    onContent(content, "Parsing pasted content...");
  });
}
