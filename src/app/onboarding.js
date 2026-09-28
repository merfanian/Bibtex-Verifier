// First-visit onboarding tour, and the follow-up tour shown after the sample run.
import { $ } from "./dom.js";
import { bibPaste, switchToPasteTab } from "./input.js";
import { setSettingsOpen } from "./settings.js";

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

const floatingBar = $("#floating-bar");

let onboardingOverlayEl = null;
// Set when the tour's "Verify sample" button starts a run, so the post-verify tour follows.
let pendingResumeClick = false;
let startVerification = () => {};

export function closeOnboarding() {
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
  floatingBar.classList.remove("onboarding-target-bar");
}

/**
 * Call when a verification run starts. Closes any open tour and returns true
 * if the run was started from the tour, so the post-verify tour should follow.
 */
export function beginVerificationRun() {
  const stage = document.body.dataset.onboardingStage;
  const resume = pendingResumeClick || stage === "verify" || stage === "verify-final";
  pendingResumeClick = false;
  closeOnboarding();
  return resume;
}

function shouldAutoShowOnboarding() {
  if (localStorage.getItem(ONBOARDING_VER_KEY) !== ONBOARDING_VER) return true;
  return !localStorage.getItem(ONBOARDING_STORAGE);
}

function markOnboardingComplete() {
  localStorage.setItem(ONBOARDING_STORAGE, "1");
  localStorage.setItem(ONBOARDING_VER_KEY, ONBOARDING_VER);
}

const introOnboardingSteps = [
  {
    title: "Welcome",
    body: "BibTeX Verifier checks each entry against Semantic Scholar and CrossRef (with OpenAlex as a fallback) — wrong metadata, missing DOIs, duplicates, and citations that don’t exist online (including AI hallucinations). Your file stays in the browser.",
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
    body: "Click <strong>Verify pasted BibTeX</strong> when you’re ready. The app queries Semantic Scholar, CrossRef, and OpenAlex (a short wait per entry). <strong>When it finishes, the tour continues</strong> and walks through both sample results — updated vs not found — plus settings.",
    target: "#btn-verify-paste",
  },
  {
    title: "Start with the sample",
    body: "Use <strong>Verify sample &amp; explore</strong> below to run the demo (same as the real verify button). Or close the tour and paste your own .bib anytime.",
    target: "#btn-verify-paste",
    final: true,
  },
];

const postVerifySteps = [
  {
    title: "Summary filters",
    body: "These <strong>badges</strong> count results by status — verified, updated, needs review, not found. Click one to filter the list below.",
    target: ".summary-bar",
    panelTop: true,
  },
  {
    title: "First entry — metadata updated",
    body: "This row matched a real paper. The sample used a <strong>wrong journal</strong> on purpose — suggested venue, DOI, and other fields come from Semantic Scholar / CrossRef / OpenAlex. Each line compares your text to the suggestion; accept or revert per field.",
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
      requestAnimationFrame(() => requestAnimationFrame(() => setSettingsOpen(true)));
    },
    onLeave: () => setSettingsOpen(false),
  },
  {
    title: "Bottom bar & download",
    body: "The <strong>floating bar</strong> stays here for settings and <strong>download verified BibTeX</strong> when you’re ready. Replace the sample with your own bibliography anytime.",
    target: "#floating-bar",
    panelTop: true,
    final: true,
  },
];

function mountOnboardingTour(steps, variant = "intro") {
  closeOnboarding();

  let stepIndex = 0;
  let lastRenderedStepIndex = -1;
  const isIntro = variant === "intro";

  const backdrop = document.createElement("div");
  backdrop.className = "onboarding-backdrop onboarding-backdrop-fixed";
  backdrop.setAttribute("data-dismiss", "1");

  const panelLayer = document.createElement("div");
  panelLayer.className = "onboarding-panel-layer";
  panelLayer.setAttribute("role", "dialog");
  panelLayer.setAttribute("aria-modal", "true");
  panelLayer.setAttribute("aria-labelledby", "onboarding-title");
  panelLayer._onboardingBackdrop = backdrop;

  const finalBlock = isIntro
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
    floatingBar.classList.remove("onboarding-target-bar");

    panelLayer.classList.toggle("onboarding-panel-top", !!step.panelTop);

    if (!selector) return;
    const el = document.querySelector(selector);
    if (el && floatingBar.contains(el)) floatingBar.classList.add("onboarding-target-bar");
    if (el) {
      el.classList.add("onboarding-target");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function renderStep() {
    if (lastRenderedStepIndex >= 0) steps[lastRenderedStepIndex]?.onLeave?.();
    lastRenderedStepIndex = stepIndex;

    const step = steps[stepIndex];
    panelLayer._currentStepOnLeave = step.onLeave || null;

    if (isIntro) {
      if (stepIndex <= 2) document.body.removeAttribute("data-onboarding-stage");
      else if (stepIndex === 3) document.body.dataset.onboardingStage = "verify";
      else if (step.final) document.body.dataset.onboardingStage = "verify-final";
    }

    step.onEnter?.();

    titleEl.textContent = step.title;
    bodyEl.innerHTML = step.body;
    stepLabel.textContent = `Step ${stepIndex + 1} of ${steps.length}`;
    dotsWrap.querySelectorAll(".onboarding-dot").forEach((d, i) => d.classList.toggle("active", i === stepIndex));

    const isFinal = !!step.final;
    actionsMain.classList.toggle("hidden", isFinal);
    panelLayer.querySelector(".onboarding-actions-final").classList.toggle("hidden", !isFinal);

    updateHighlight(step.target, step);
  }

  function dismiss() {
    markOnboardingComplete();
    closeOnboarding();
  }

  backdrop.addEventListener("click", dismiss);

  panelLayer.addEventListener("click", (e) => {
    const act = e.target.closest("button[data-action]")?.dataset.action;
    if (act === "skip" || act === "finish") return dismiss();
    if (act === "next") {
      stepIndex++;
      if (stepIndex >= steps.length) dismiss();
      else renderStep();
      return;
    }
    if (act === "verify-sample" && isIntro) {
      pendingResumeClick = true;
      closeOnboarding();
      if (!bibPaste.value.trim()) bibPaste.value = ONBOARDING_SAMPLE_BIB;
      switchToPasteTab();
      startVerification(bibPaste.value.trim(), "Parsing pasted content...");
    }
  });

  function onEsc(ev) {
    if (ev.key !== "Escape" || !onboardingOverlayEl) return;
    dismiss();
  }
  panelLayer._kbdEsc = onEsc;
  document.addEventListener("keydown", onEsc);

  renderStep();
}

export function openPostVerifyTour() {
  mountOnboardingTour(postVerifySteps, "postResults");
}

function openOnboardingTour({ force = false } = {}) {
  if (!force && onboardingOverlayEl) return;
  mountOnboardingTour(introOnboardingSteps, "intro");
}

/**
 * @param {{ onVerifySample: (content: string, statusMsg: string) => void }} handlers
 */
export function initOnboarding({ onVerifySample }) {
  startVerification = onVerifySample;
  $("#btn-start-tour").addEventListener("click", () => openOnboardingTour({ force: true }));
  $("#footer-start-tour").addEventListener("click", () => openOnboardingTour({ force: true }));
  if (shouldAutoShowOnboarding())
    setTimeout(() => openOnboardingTour({ force: false }), 500);
}
