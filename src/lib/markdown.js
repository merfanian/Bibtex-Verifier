// Renders the small Markdown subset CHANGELOG.md uses to safe HTML: headings,
// bullet lists, paragraphs, **bold**, `code` and [links](https://…).
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Only http(s) links; anything else stays as written.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

/** `# Title` is dropped (the dialog has its own); `##` and `###` become h3 and h4. */
export function renderMarkdownLite(markdown) {
  const out = [];
  let list = [], para = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map(li => `<li>${inline(li)}</li>`).join("")}</ul>`);
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    list = []; para = [];
  };
  for (const raw of String(markdown || "").split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (heading) {
      flush();
      if (heading[1].length > 1) out.push(`<h${heading[1].length + 1}>${inline(heading[2])}</h${heading[1].length + 1}>`);
    } else if (bullet) {
      if (para.length) flush();
      list.push(bullet[1]);
    } else if (!line) {
      flush();
    } else if (list.length && /^\s/.test(raw)) {
      list[list.length - 1] += " " + line;  // wrapped bullet
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return out.join("\n");
}
