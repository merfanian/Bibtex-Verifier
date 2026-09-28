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
