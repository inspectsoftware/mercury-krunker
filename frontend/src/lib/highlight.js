// A small CSS highlighter for the code editors: CSS text in, HTML out (spans with mc-hl-* classes).
// The output's text is exactly the input's, so the highlighted copy lines up under the textarea.

export const escapeHtml = (text) => text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

const span = (kind, text) => (/\S/.test(text) ? `<span class="mc-hl-${kind}">${escapeHtml(text)}</span>` : text);

// At-rules whose block holds rules (selectors), not declarations.
const GROUPING = /^\s*@(media|supports|container|layer|document|scope|starting-style)\b/i;

/** A selector or at-rule prelude: at-keywords in their own color. */
function prelude(text) {
  return text.split(/(@[\w-]+)/).map((part) => span(part.startsWith("@") ? "at" : "sel", part)).join("");
}

/** A declaration value: colors, numbers with units and !important stand out. */
function value(text) {
  return text
    .split(/(#[0-9a-fA-F]{3,8}\b|!\s*important\b|(?<![\w-])-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?)/)
    .map((part, i) => {
      if (i % 2 === 0) return span("val", part);
      if (part.startsWith("#")) return span("color", part);
      if (part.startsWith("!")) return span("imp", part);
      return span("num", part);
    })
    .join("");
}

export function highlightCss(text) {
  let out = "";
  const stack = [];
  let mode = "sel"; // "sel": selectors/preludes, "prop": a declaration's name, "val": its value
  let pending = ""; // the prelude since the last { } or ;
  const re = /\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|[{};:]|[^{};:"'/]+|\//g;
  for (const [tok] of text.matchAll(re)) {
    if (tok.startsWith("/*")) out += span("com", tok);
    else if (tok[0] === '"' || tok[0] === "'") {
      out += span("str", tok);
      if (mode === "sel") pending += tok;
    } else if (tok === "{") {
      stack.push(mode);
      mode = mode === "sel" && GROUPING.test(pending) ? "sel" : "prop";
      pending = "";
      out += span("punc", tok);
    } else if (tok === "}") {
      mode = stack.pop() ?? "sel";
      if (mode === "val") mode = "prop";
      pending = "";
      out += span("punc", tok);
    } else if (tok === ";") {
      if (mode === "val") mode = "prop";
      pending = "";
      out += span("punc", tok);
    } else if (tok === ":") {
      if (mode === "prop") {
        mode = "val";
        out += span("punc", tok);
      } else out += span(mode === "sel" ? "sel" : "val", tok);
    } else if (mode === "sel") {
      pending += tok;
      out += prelude(tok);
    } else if (mode === "prop") out += span("prop", tok);
    else out += value(tok);
  }
  return out;
}
