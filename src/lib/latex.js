const LATEX_ACCENT_MAP = {
  "\\'a":"á", "\\'e":"é", "\\'i":"í", "\\'o":"ó", "\\'u":"ú",
  "\\`a":"à", "\\`e":"è", "\\`i":"ì", "\\`o":"ò", "\\`u":"ù",
  '\\"a':"ä", '\\"e':"ë", '\\"i':"ï", '\\"o':"ö", '\\"u':"ü",
  "\\~n":"ñ", "\\~a":"ã", "\\~o":"õ",
  "\\^a":"â", "\\^e":"ê", "\\^i":"î", "\\^o":"ô", "\\^u":"û",
  "\\c{c}":"ç", "\\c c":"ç", "{\\ss}":"ß",
};

export function stripLatex(text) {
  if (!text) return "";
  for (const [latex, ch] of Object.entries(LATEX_ACCENT_MAP))
    text = text.replaceAll(latex, ch);
  text = text.replace(/\\[a-zA-Z]+\s*/g, "");
  text = text.replace(/[{}]/g, "");
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeTitle(title) {
  return stripLatex(title).toLowerCase().trim();
}

/**
 * Split a BibTeX author field into names on the "and"s that separate people.
 * An "and" inside braces belongs to a name: "{Research and Development Group}".
 */
export function splitAuthors(authorStr) {
  const s = String(authorStr ?? "");
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(s[i])) {
      const m = /^\s+and\s+/i.exec(s.slice(i));
      if (m) { parts.push(s.slice(start, i)); i += m[0].length - 1; start = i + 1; }
    }
  }
  parts.push(s.slice(start));
  return parts;
}
