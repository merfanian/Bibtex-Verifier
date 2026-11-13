// The star count on the header's GitHub button. It is asked for at most once
// every few hours; without an answer the button simply shows no number.
const REPO_API = "https://api.github.com/repos/merfanian/Bibtex-Verifier";
const CACHE_KEY = "bv-stars";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** 144 -> "144", 1234 -> "1.2k", 12345 -> "12k" */
export function formatStars(n) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)) + "k";
}

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return c && Number.isInteger(c.n) && Number.isFinite(c.t) ? c : null;
  } catch { return null; }
}

export async function initStars() {
  const link = document.querySelector("#github-star-btn");
  const count = document.querySelector("#star-count");
  const value = document.querySelector("#star-count-value");
  const show = (n) => {
    value.textContent = formatStars(n);
    count.hidden = false;
    link.setAttribute("aria-label", `Star BibTeX Verifier on GitHub (${n} stars)`);
  };

  const cached = readCache();
  if (cached) show(cached.n);
  if (cached && Date.now() - cached.t < MAX_AGE_MS) return;
  try {
    const resp = await fetch(REPO_API);
    if (!resp.ok) return;
    const n = (await resp.json()).stargazers_count;
    if (!Number.isInteger(n)) return;
    show(n);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ n, t: Date.now() })); } catch { /* storage blocked */ }
  } catch { /* offline or rate-limited: keep whatever is shown */ }
}
