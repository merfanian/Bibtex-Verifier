// Field names may carry hyphens, dots and colons ("date-added", "bdsk-url-1").
const FIELD_NAME = "[A-Za-z][\\w.:+-]*";
const FIELD_START_RE = new RegExp(`^(${FIELD_NAME})\\s*=\\s*`);
const NEXT_FIELD_RE = new RegExp(`^\\s*(?:\\r?\\n\\s*)?${FIELD_NAME}\\s*=`);

function skipWhitespace(str, i) {
  while (i < str.length && /\s/.test(str[i])) i++;
  return i;
}

/** Append missing `}` so nested `{...}` recover from typos like `{{Foo},` before next field. */
function balanceClosingBraces(s) {
  let net = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") net++;
    else if (s[i] === "}") net--;
  }
  let out = s;
  while (net > 0) {
    out += "}";
    net--;
  }
  return out;
}

/**
 * Parse `{...}` with nested-brace awareness. If the user omits the closing `}` before `,`
 * and the next token looks like another field (`title =`), treat the comma as the field
 * separator and repair inner braces (common with `{{GitHub},` typos).
 */
function extractBracedFieldValue(str, start) {
  if (str[start] !== "{") return { value: "", next: start };
  let i = start + 1;
  let depth = 1;
  while (i < str.length && depth > 0) {
    const c = str[i];
    if (c === "{") {
      depth++;
      i++;
    } else if (c === "}") {
      depth--;
      i++;
      if (depth === 0) {
        const inner = str.slice(start + 1, i - 1);
        let next = skipWhitespace(str, i);
        if (str[next] === ",") next = skipWhitespace(str, next + 1);
        return { value: inner, next };
      }
    } else if (depth === 1 && c === ",") {
      const tail = str.slice(i + 1);
      if (NEXT_FIELD_RE.test(tail)) {
        const inner = str.slice(start + 1, i);
        return {
          value: balanceClosingBraces(inner),
          next: skipWhitespace(str, i + 1),
        };
      }
      i++;
    } else {
      i++;
    }
  }
  const inner = str.slice(start + 1);
  return { value: balanceClosingBraces(inner), next: str.length };
}

function extractQuotedFieldValue(str, start) {
  if (str[start] !== '"') return { value: "", next: start };
  let i = start + 1;
  let buf = "";
  while (i < str.length) {
    const c = str[i];
    if (c === "\\" && i + 1 < str.length) {
      buf += str[i + 1];
      i += 2;
      continue;
    }
    if (c === '"') {
      i++;
      let next = skipWhitespace(str, i);
      if (str[next] === ",") next = skipWhitespace(str, next + 1);
      return { value: buf, next };
    }
    buf += c;
    i++;
  }
  return { value: buf, next: str.length };
}

function extractNumberFieldValue(str, start) {
  const m = /^(\d+)/.exec(str.slice(start));
  if (!m) return { value: "", next: start };
  let next = start + m[1].length;
  next = skipWhitespace(str, next);
  if (str[next] === ",") next = skipWhitespace(str, next + 1);
  return { value: m[1], next };
}

// A bare word is a @string macro or a month ("month = may"). A macro defined
// in the file is replaced by its text; any other bare word is written back
// without braces as long as its value is unchanged.
function extractBareFieldValue(str, start) {
  const m = /^[A-Za-z][\w.:+-]*/.exec(str.slice(start));
  if (!m) return null;
  let next = skipWhitespace(str, start + m[0].length);
  if (str[next] === "#") return null;  // concatenation isn't supported
  if (str[next] === ",") next = skipWhitespace(str, next + 1);
  return { value: m[0], next };
}

function parseEntryFields(body, macros = new Map()) {
  const fields = {};
  const bare = {};
  let i = skipWhitespace(body, 0);
  while (i < body.length) {
    const nameMatch = FIELD_START_RE.exec(body.slice(i));
    if (!nameMatch) break;
    const key = nameMatch[1].toLowerCase();
    const fieldStart = i;
    i += nameMatch[0].length;
    i = skipWhitespace(body, i);
    if (i >= body.length) break;

    let ext;
    if (body[i] === "{") ext = extractBracedFieldValue(body, i);
    else if (body[i] === '"') ext = extractQuotedFieldValue(body, i);
    else if (/\d/.test(body[i])) ext = extractNumberFieldValue(body, i);
    else {
      ext = extractBareFieldValue(body, i);
      if (!ext) { i = fieldStart; break; }
      const text = macros.get(ext.value.toLowerCase());
      if (text !== undefined) ext.value = text;
      else bare[key] = ext.value;
    }

    fields[key] = ext.value.replace(/\s*\n\s*/g, " ").trim();
    i = ext.next;
    i = skipWhitespace(body, i);
  }
  if (Object.keys(bare).length) fields._bare = bare;
  // Anything left before the entry's closing brace was not understood.
  const rest = body.slice(i).replace(/^[\s,]+/, "");
  if (rest && !rest.startsWith("}")) fields._unparsed = rest.slice(0, 40).replace(/\s+/g, " ").trim();
  return fields;
}

export function parseBib(content) {
  const entries = [];
  // Bodies run from one `@type{key,` header to the next, not to the first `@`:
  // values legitimately contain `@` (emails, URLs) and must not end the entry.
  // A key has no braces or "@", so "@string{a = "b"}" before an entry can't swallow its header.
  const headerRe = /@(\w+)\s*\{([^,{}@]*),/g;
  const headers = [];
  let m;
  while ((m = headerRe.exec(content)) !== null) {
    headers.push({
      type: m[1].toLowerCase(),
      id: m[2].trim(),
      headerStart: m.index,
      bodyStart: headerRe.lastIndex,
    });
  }
  // @string{jmlr = "Journal of Machine Learning Research"} definitions.
  const macros = new Map();
  const stringRe = new RegExp(`@string\\s*[{(]\\s*(${FIELD_NAME})\\s*=\\s*(?:\\{([^{}]*)\\}|"([^"]*)")`, "gi");
  for (const s of content.matchAll(stringRe)) macros.set(s[1].toLowerCase(), (s[2] ?? s[3]).trim());

  for (let h = 0; h < headers.length; h++) {
    const hdr = headers[h];
    if (hdr.type === "string" || hdr.type === "preamble" || hdr.type === "comment")
      continue;
    const bodyEnd = h + 1 < headers.length ? headers[h + 1].headerStart : content.length;
    let body = content.slice(hdr.bodyStart, bodyEnd);
    body = body.replace(/\}\s*$/, "").trim();
    const entry = { ENTRYTYPE: hdr.type, ID: hdr.id };
    Object.assign(entry, parseEntryFields(body, macros));
    entries.push(entry);
  }
  return entries;
}

export function entriesToBib(entries) {
  const lines = [];
  for (const entry of entries) {
    const type = entry.ENTRYTYPE || "misc";
    const id = entry.ID || "unknown";
    lines.push(`@${type}{${id},`);
    for (const [k, v] of Object.entries(entry)) {
      if (k === "ENTRYTYPE" || k === "ID" || k.startsWith("_")) continue;
      const isBare = entry._bare?.[k] === v;
      lines.push(isBare ? `  ${k} = ${v},` : `  ${k} = {${v}},`);
    }
    lines.push("}\n");
  }
  return lines.join("\n");
}
