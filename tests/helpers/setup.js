// The browser loads fuzzball from a CDN as a global; expose the same package
// here so tests exercise the real token_sort_ratio.
try {
  const mod = await import("fuzzball");
  globalThis.fuzzball = mod.default?.token_sort_ratio ? mod.default : mod;
} catch {
  console.warn("⚠ fuzzball not installed — run `npm install`; tests fall back to the built-in matcher.");
}
