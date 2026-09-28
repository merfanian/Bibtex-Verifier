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
      if (/^\s*(?:\r?\n\s*)?\w+\s*=/.test(tail)) {
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

function parseEntryFields(body) {
  const fields = {};
  let i = skipWhitespace(body, 0);
  while (i < body.length) {
    const nameMatch = /^(\w+)\s*=\s*/.exec(body.slice(i));
    if (!nameMatch) break;
    const key = nameMatch[1].toLowerCase();
    i += nameMatch[0].length;
    i = skipWhitespace(body, i);
    if (i >= body.length) break;

    let ext;
    if (body[i] === "{") ext = extractBracedFieldValue(body, i);
    else if (body[i] === '"') ext = extractQuotedFieldValue(body, i);
    else if (/\d/.test(body[i])) ext = extractNumberFieldValue(body, i);
    else break;

    fields[key] = ext.value.replace(/\s*\n\s*/g, " ").trim();
    i = ext.next;
    i = skipWhitespace(body, i);
  }
  return fields;
}

export function parseBib(content) {
  const entries = [];
  // Bodies run from one `@type{key,` header to the next, not to the first `@`:
  // values legitimately contain `@` (emails, URLs) and must not end the entry.
  const headerRe = /@(\w+)\s*\{([^,]*),/g;
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
  for (let h = 0; h < headers.length; h++) {
    const hdr = headers[h];
    if (hdr.type === "string" || hdr.type === "preamble" || hdr.type === "comment")
      continue;
    const bodyEnd = h + 1 < headers.length ? headers[h + 1].headerStart : content.length;
    let body = content.slice(hdr.bodyStart, bodyEnd);
    body = body.replace(/\}\s*$/, "").trim();
    const entry = { ENTRYTYPE: hdr.type, ID: hdr.id };
    Object.assign(entry, parseEntryFields(body));
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
      lines.push(`  ${k} = {${v}},`);
    }
    lines.push("}\n");
  }
  return lines.join("\n");
}
