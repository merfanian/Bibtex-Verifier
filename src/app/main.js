// Entry point: wires the UI modules together.
import { updateAuthorPills } from "./authors.js";
import { $ } from "./dom.js";
import { initFieldActions } from "./field-actions.js";
import { initFilters } from "./filters.js";
import { initInput } from "./input.js";
import { initOnboarding } from "./onboarding.js";
import { initPreview, updatePreview } from "./preview.js";
import { initSettings } from "./settings.js";
import { startVerificationFromContent } from "./verify.js";

function initTheme() {
  const root = document.documentElement;
  const applyTheme = (theme) => {
    root.setAttribute("data-theme", theme);
    localStorage.setItem("bv-theme", theme);
  };
  applyTheme(localStorage.getItem("bv-theme") ||
    (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  $("#theme-toggle").addEventListener("click", () => {
    applyTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });
}

// On narrow screens the hero overview collapses behind an "About this tool" toggle.
function initHeroOverview() {
  const mq = window.matchMedia("(max-width: 640px)");
  const toggle = $("#hero-overview-toggle");
  const panel = $("#hero-overview");
  const label = $("#hero-overview-toggle-label");
  const STORAGE_KEY = "bv-hero-overview-expanded";

  function sync() {
    const expanded = !mq.matches || sessionStorage.getItem(STORAGE_KEY) === "1";
    panel.hidden = !expanded;
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.classList.toggle("is-expanded", expanded);
    label.textContent = mq.matches && expanded ? "Hide overview" : "About this tool";
  }

  toggle.addEventListener("click", () => {
    if (!mq.matches) return;
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    sessionStorage.setItem(STORAGE_KEY, expanded ? "0" : "1");
    sync();
  });
  mq.addEventListener("change", sync);
  sync();
}

initTheme();
initHeroOverview();
initPreview();
initFieldActions();
initFilters();
initSettings({
  onChange: updatePreview,
  onMaxAuthorsChange: () => {
    updateAuthorPills();
    updatePreview();
  },
});
initInput({ onContent: startVerificationFromContent });
initOnboarding({ onVerifySample: startVerificationFromContent });
