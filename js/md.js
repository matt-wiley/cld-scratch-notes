// A small, dependency-free markdown renderer tuned for scratch notes.
// Pure and DOM-free so it runs under Node for tests.
//
// Differences from strict CommonMark, on purpose:
// - single newlines inside a paragraph are kept as line breaks (notes are line-oriented),
//   and each line is its own copy target
// - an unindented line after a list ends the list (no lazy continuation)
// - paragraph lines, list items and code blocks carry their raw source in data-copy,
//   so the app can offer one-click copy of each
// - task-list checkboxes carry data-line (0-based source line) so they can be toggled

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const COPY_BTN =
  '<button class="copy-btn" type="button" tabindex="-1" title="Copy" aria-label="Copy"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></svg></button>';

function safeUrl(u) {
  const t = u.trim();
  if (/^(https?:|mailto:)/i.test(t)) return t;
  if (/^(#|\/(?!\/)|\.\.?\/)/.test(t)) return t;
  if (/^www\./i.test(t)) return 'https://' + t;
  return null;
}

const link = (href, html) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;

// ---------- inline ----------

export function inline(src) {
  const slots = [];
  const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = String(src);

  // code spans first: their content is literal
  s = s.replace(/``(.+?)``|`([^`\n]+)`/g, (m, a, b) => {
    const code = (a ?? b).replace(/^ (.*) $/, '$1');
    return hold(`<code class="copy" title="Click to copy">${esc(code)}</code>`);
  });
  // [text](url)
  s = s.replace(/\[([^\]\n]+)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g, (m, text, url) => {
    const href = safeUrl(url);
    return href ? hold(link(href, inline(text))) : m;
  });
  // <https://autolink>
  s = s.replace(/<((?:https?:\/\/|mailto:)[^\s>]+)>/gi, (m, url) => hold(link(url, esc(url))));
  // bare URLs
  s = s.replace(/\b(?:https?:\/\/|www\.)[^\s<]*[^\s<.,:;"'!?)\]}*_~]/gi, (url) => hold(link(safeUrl(url), esc(url))));

  s = esc(s)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');

  while (/\u0000\d+\u0000/.test(s)) s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => slots[+i]);
  return s;
}

// ---------- blocks ----------

const RE = {
  fence: /^\s{0,3}(`{3,}|~{3,})\s*([^`\s]*)/,
  heading: /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/,
  hr: /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/,
  quote: /^\s{0,3}>\s?/,
  item: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/,
  emptyItem: /^(\s*)([-*+]|\d{1,9}[.)])\s*$/,
  tableSep: /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
};
const blank = (l) => !l.trim();
const indentOf = (l) => l.replace(/\t/g, '    ').match(/^ */)[0].length;
const startsBlock = (l) => RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || RE.item.test(l);

export function render(src) {
  return blocks(String(src ?? '').replace(/\r\n?/g, '\n').split('\n'), 0);
}

function blocks(lines, offset) {
  let out = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      i++;
      continue;
    }

    let m;
    if ((m = line.match(RE.fence))) {
      const fence = m[1];
      const lang = m[2];
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or end)
      const code = body.join('\n');
      out += `<div class="code-block" data-copy="${esc(code)}">${COPY_BTN}${lang ? `<span class="code-lang">${esc(lang)}</span>` : ''}<pre><code>${esc(code)}</code></pre></div>`;
      continue;
    }
    if ((m = line.match(RE.heading))) {
      const n = m[1].length;
      out += `<h${n}>${inline(m[2])}</h${n}>`;
      i++;
      continue;
    }
    if (RE.hr.test(line)) {
      out += '<hr>';
      i++;
      continue;
    }
    if (RE.quote.test(line)) {
      const start = i;
      const inner = [];
      while (i < lines.length && RE.quote.test(lines[i])) inner.push(lines[i++].replace(RE.quote, ''));
      out += `<blockquote>${blocks(inner, offset + start)}</blockquote>`;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const rows = [lines[i]];
      i += 2;
      while (i < lines.length && !blank(lines[i]) && lines[i].includes('|')) rows.push(lines[i++]);
      out += table(rows);
      continue;
    }
    if (RE.item.test(line)) {
      const start = i;
      const chunk = [];
      const base = indentOf(line);
      while (i < lines.length) {
        const l = lines[i];
        if (blank(l)) {
          // a blank line continues the list only if more list follows
          let j = i + 1;
          while (j < lines.length && blank(lines[j])) j++;
          if (j < lines.length && (RE.item.test(lines[j]) || indentOf(lines[j]) > base) && indentOf(lines[j]) >= base) {
            for (; i < j; i++) chunk.push(lines[i]);
            continue;
          }
          break;
        }
        if (RE.item.test(l) || RE.emptyItem.test(l) || indentOf(l) > base) {
          chunk.push(l);
          i++;
          continue;
        }
        // no lazy continuation: in a line-oriented scratch pad, an unindented line ends the list
        break;
      }
      out += list(chunk, offset + start);
      continue;
    }

    // paragraph
    const para = [];
    while (i < lines.length && !blank(lines[i]) && (para.length === 0 || !startsBlock(lines[i]))) para.push(lines[i++]);
    // one copy target per line: notes are usually one string per line
    out += `<p>${para.map((l) => `<span class="line" data-copy="${esc(l.trim())}">${inline(l.trim())}${COPY_BTN}</span>`).join('')}</p>`;
  }
  return out;
}

function splitRow(row) {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
  return r.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function table(rows) {
  const [head, ...body] = rows.map(splitRow);
  const th = head.map((c) => `<th>${inline(c)}</th>`).join('');
  const tb = body.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

function list(chunk, offset) {
  // flatten into items; non-item lines are continuations of the previous item
  const items = [];
  chunk.forEach((l, k) => {
    const m = l.match(RE.item) || l.match(RE.emptyItem);
    if (m && (items.length === 0 || RE.item.test(l) || RE.emptyItem.test(l))) {
      const marker = m[2];
      items.push({
        indent: indentOf(l),
        ordered: /\d/.test(marker),
        num: parseInt(marker, 10),
        lines: [m[3] ?? ''],
        line: offset + k,
      });
    } else if (items.length) {
      items[items.length - 1].lines.push(l.trim());
    }
  });
  let out = '';
  const cur = { i: 0 };
  while (cur.i < items.length) out += build(items, cur, items[cur.i].indent);
  return out;
}

function build(items, cur, base) {
  const first = items[cur.i];
  const ordered = first.ordered;
  let html = ordered ? `<ol${first.num !== 1 && !Number.isNaN(first.num) ? ` start="${first.num}"` : ''}>` : '<ul>';
  // switching between bullets and numbers at the same level starts a new list
  while (cur.i < items.length && items[cur.i].indent >= base && !(items[cur.i].indent === base && items[cur.i].ordered !== ordered)) {
    const it = items[cur.i++];
    let children = '';
    if (cur.i < items.length && items[cur.i].indent > it.indent) children = build(items, cur, items[cur.i].indent);
    html += item(it) + children + '</li>';
  }
  return html + (ordered ? '</ol>' : '</ul>');
}

function item(it) {
  while (it.lines.length > 1 && blank(it.lines[it.lines.length - 1])) it.lines.pop();
  let text = it.lines.join('\n');
  const task = text.match(/^\[([ xX])\](?:\s+|$)([\s\S]*)$/);
  if (task) text = task[2];
  const raw = text.trim();
  const body = raw
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => inline(l.trim())).join('<br>'))
    .join('<br><br>');
  const box = task
    ? `<input type="checkbox" data-line="${it.line}"${task[1] !== ' ' ? ' checked' : ''} aria-label="Done">`
    : '';
  const cls = task ? ` class="task${task[1] !== ' ' ? ' done' : ''}"` : '';
  return `<li${cls}><div class="item" data-copy="${esc(raw)}">${box}<span class="item-text">${body}</span>${COPY_BTN}</div>`;
}

// Toggle the task checkbox on a given 0-based source line. Returns the new source.
export function toggleTask(src, lineNo) {
  const lines = String(src).split('\n');
  const l = lines[lineNo];
  if (l == null) return src;
  lines[lineNo] = l.replace(/^(\s*(?:>\s?)*\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\]/, (m, pre, c) => `${pre}[${c === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
}
