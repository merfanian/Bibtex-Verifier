// Keyboard review: move between the visible entries and decide each one
// without the mouse. k / j (or the arrow keys, once a card is selected) go to
// the next / previous entry, a accepts all suggestions, o keeps the original.
import { $, $$ } from "./dom.js";

const ACTIVE = "kb-active";

const visibleCards = () => [...$$(".entry-card:not(.hidden)")];

function setActive(card, { scroll = true } = {}) {
  $$(`.entry-card.${ACTIVE}`).forEach(c => c.classList.remove(ACTIVE));
  if (!card) return;
  card.classList.add(ACTIVE);
  if (scroll) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function move(step) {
  const cards = visibleCards();
  if (!cards.length) return;
  const i = cards.findIndex(c => c.classList.contains(ACTIVE));
  // With nothing selected yet, "next" starts at the first card and "previous" at the last.
  const next = i === -1 ? (step > 0 ? 0 : cards.length - 1)
    : Math.min(cards.length - 1, Math.max(0, i + step));
  setActive(cards[next]);
}

function decide(selector) {
  const card = visibleCards().find(c => c.classList.contains(ACTIVE));
  card?.querySelector(selector)?.click();
}

const isTyping = (t) =>
  !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

export function initKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (document.body.dataset.onboardingStage) return;  // the tour owns the keyboard
    if ($("dialog[open]")) return;
    if ($(".results-section").offsetParent === null) return;
    const actions = {
      k: () => move(1),
      j: () => move(-1),
      a: () => decide(".btn-accept-all"),
      o: () => decide(".btn-revert-all"),
    };
    // Arrows move too, but only once a card is selected (by a click or k / j);
    // before that they keep scrolling the page.
    if ($(`.entry-card.${ACTIVE}:not(.hidden)`)) {
      actions.ArrowDown = actions.ArrowRight = actions.k;
      actions.ArrowUp = actions.ArrowLeft = actions.j;
    }
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  });

  // A card the user clicks becomes the one the keys act on.
  document.addEventListener("click", (e) => {
    const card = e.target.closest?.(".entry-card");
    if (card) setActive(card, { scroll: false });
  });
}
