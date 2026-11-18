import { Store, titleOf, snippetOf, stats, TRASH_DAYS, DAY } from './store.js';
import { render as renderMd, toggleTask, esc } from './md.js';

// ---------- setup ----------

function safeStorage() {
  try {
    const k = '__scratchpad_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}
const storage = safeStorage();
const store = new Store({ storage });
const UI_KEY = 'scratchpad:ui';
const THEME_KEY = 'scratchpad:theme';

const $ = (sel, el = document) => el.querySelector(sel);
const editor = $('#editor');
const preview = $('#preview');
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);

let ui = loadUi(); // { current, mode, view }
let query = '';
let pending = null; // debounce timer for saving the editor
let lastSaved = 0;

function loadUi() {
  const d = { current: null, mode: 'write', view: 'note' };
  try {
    return { ...d, ...JSON.parse(storage?.getItem(UI_KEY) || '{}') };
  } catch {
    return d;
  }
}
function saveUi() {
  try {
    storage?.setItem(UI_KEY, JSON.stringify({ current: ui.current, mode: ui.mode }));
  } catch {}
}

// ---------- helpers ----------

const I = {
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v6"/></svg>',
  pinOn: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 4H6l4-4z" fill="currentColor"/><path d="M12 14v6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></svg>',
};

function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
}
function agoLong(t) {
  const a = ago(t);
  if (a === 'now') return 'just now';
  return /\d[mhd]$/.test(a) ? `${a} ago` : `on ${a}`;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function highlight(text, terms) {
  let html = esc(text);
  for (const t of terms) {
    if (!t) continue;
    const re = new RegExp(`(${esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}

function download(name, text, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function fileSlug(note) {
  return (titleOf(note.body) || 'note').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'note';
}
const stamp = () => new Date().toISOString().slice(0, 10);

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback for browsers without async clipboard permission
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
function copyFeedback(text, btn) {
  copyText(text).then((ok) => {
    if (!ok) return toast('Couldn’t copy. Your browser blocked clipboard access.', { error: true });
    const preview = text.replace(/\s+/g, ' ').trim();
    toast(`Copied: ${preview.length > 60 ? preview.slice(0, 59) + '…' : preview || '(blank)'}`, { timeout: 1800 });
    if (btn) {
      btn.classList.add('copied');
      const prev = btn.innerHTML;
      btn.innerHTML = I.check;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = prev;
      }, 1200);
    }
  });
}

// ---------- toasts ----------

function toast(message, { action, error = false, timeout = 5000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.append(Object.assign(document.createElement('span'), { textContent: message }));
  if (action) {
    const b = Object.assign(document.createElement('button'), { textContent: action.label, type: 'button' });
    b.onclick = () => {
      action.run();
      el.remove();
    };
    el.append(b);
  }
  const host = $('#toasts');
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(() => el.remove(), timeout);
}
function fail(err) {
  console.error(err);
  toast(err?.message || String(err), { error: true, timeout: 8000 });
}
function attempt(fn) {
  try {
    return fn();
  } catch (err) {
    fail(err);
  }
}

// ---------- confirm dialog ----------

let askResolve = null;
function confirmBox({ title, message = '', ok = 'OK', danger = false }) {
  const d = $('#ask-dialog');
  $('#ask-title').textContent = title;
  $('#ask-message').textContent = message;
  $('#ask-message').hidden = !message;
  const okBtn = $('#ask-ok');
  okBtn.textContent = ok;
  okBtn.classList.toggle('danger', danger);
  d.showModal();
  okBtn.focus();
  return new Promise((r) => (askResolve = r));
}
$('#ask-form').addEventListener('submit', () => askResolve?.(true));
$('#ask-dialog').addEventListener('close', () => {
  askResolve?.(false);
  askResolve = null;
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) e.target.closest('dialog')?.close();
});

// ---------- current note & saving ----------

const current = () => (ui.current && store.get(ui.current)) || null;

function flush() {
  if (!pending) return;
  clearTimeout(pending);
  pending = null;
  const n = current();
  if (n && !n.deletedAt && editor.value !== n.body) {
    attempt(() => store.update(n.id, editor.value));
    lastSaved = Date.now();
  }
}
function scheduleSave() {
  clearTimeout(pending);
  pending = setTimeout(flush, 300);
}

function open(id, { focus = false } = {}) {
  flush();
  const prev = ui.current;
  ui.current = id;
  ui.view = 'note';
  if (prev && prev !== id) store.pruneEmpty(id);
  saveUi();
  loadEditor();
  render();
  closeSidebar();
  if (focus) focusEditor();
  history.replaceState(null, '', id ? `#${id}` : location.pathname + location.search);
}

function loadEditor() {
  const n = current();
  editor.value = n ? n.body : '';
  editor.scrollTop = 0;
  $('#read-pane').scrollTop = 0;
  renderPreview();
}

function focusEditor({ end = true } = {}) {
  if (ui.mode === 'read') setMode('write');
  editor.focus();
  if (end) editor.setSelectionRange(editor.value.length, editor.value.length);
}

function newNote(body = '') {
  flush();
  const cur = current();
  if (!body && cur && !cur.deletedAt && !cur.body.trim()) {
    // the current note is already blank: just use it
    ui.view = 'note';
    render();
    closeSidebar();
    focusEditor();
    return cur;
  }
  if (query) clearSearch();
  const n = attempt(() => store.create(body));
  if (n) open(n.id, { focus: true });
  return n;
}

// ---------- rendering ----------

let previewQueued = false;
function paintPreview() {
  previewQueued = false;
  if (ui.mode === 'write') return;
  const src = editor.value;
  preview.innerHTML = src.trim() ? renderMd(src) : '<p class="md-empty">Nothing here yet. Switch to Write, or paste anywhere to add.</p>';
}
// immediate by default; typing in split mode batches into one paint per frame
function renderPreview({ throttle = false } = {}) {
  if (!throttle) return paintPreview();
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => previewQueued && paintPreview());
}

function setMode(mode) {
  ui.mode = mode;
  saveUi();
  renderMode();
  renderPreview();
}
const narrow = matchMedia('(max-width: 900px)');
function renderMode() {
  // split needs room: on narrow screens it shows as Write
  const shown = ui.mode === 'split' && narrow.matches ? 'write' : ui.mode;
  $('#panes').className = `panes mode-${shown}`;
  for (const b of document.querySelectorAll('[data-action="mode"]')) b.classList.toggle('active', b.dataset.mode === shown);
}
narrow.addEventListener('change', () => {
  renderMode();
  renderPreview();
});

function render() {
  const n = current();
  const inTrash = ui.view === 'trash';

  // note list
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const notes = store.search(query);
  const item = (note) => {
    const title = titleOf(note.body);
    let snippet = snippetOf(note.body);
    if (terms.length && !terms.every((t) => (title + ' ' + snippet).toLowerCase().includes(t))) {
      // show the matching line instead of the generic snippet
      const line = note.body.split('\n').find((l) => terms.some((t) => l.toLowerCase().includes(t)));
      if (line) snippet = line.trim().slice(0, 140);
    }
    const active = !inTrash && n && note.id === n.id;
    return `<li><button class="note-item${active ? ' active' : ''}" data-action="open" data-id="${note.id}"${active ? ' aria-current="true"' : ''}>
      <div class="note-line"><span class="note-title${title ? '' : ' untitled'}">${title ? highlight(title, terms) : 'Untitled'}</span><span class="note-time">${note.pinned ? '<span title="Pinned">📌</span> ' : ''}${ago(note.updated)}</span></div>
      <div class="note-snippet">${highlight(snippet, terms)}</div></button></li>`;
  };
  const pinned = notes.filter((x) => x.pinned);
  const rest = notes.filter((x) => !x.pinned);
  let html = '';
  if (pinned.length) html += `<li class="list-section">Pinned</li>${pinned.map(item).join('')}`;
  if (rest.length) html += `${pinned.length ? '<li class="list-section">Notes</li>' : ''}${rest.map(item).join('')}`;
  if (!notes.length) html = `<li class="sidebar-empty">${query ? 'No notes match.' : 'No notes yet.'}</li>`;
  $('#note-list').innerHTML = html;

  // trash nav
  const trashed = store.trashed();
  $('#trash-count').textContent = trashed.length || '';
  $('#trash-nav').classList.toggle('active', inTrash);

  // main
  $('#editor-view').hidden = inTrash;
  $('#trash-view').hidden = !inTrash;
  $('#note-tools').hidden = inTrash || !n;
  if (inTrash) renderTrash(trashed);
  editor.disabled = !n;

  if (n) {
    const pb = $('#pin-btn');
    pb.innerHTML = n.pinned ? I.pinOn : I.pin;
    pb.classList.toggle('on', n.pinned);
    pb.title = n.pinned ? 'Unpin (pinned notes are never auto-cleared)' : 'Pin to the top, and keep from auto-clear';
    pb.setAttribute('aria-label', n.pinned ? 'Unpin' : 'Pin');
  }
  renderMeta();

  // footer
  const count = store.active().length;
  const bytes = store.bytes;
  $('#storage-meter').textContent = storage
    ? `${plural(count, 'note')} · ${bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB'} in local storage`
    : '⚠ Local storage unavailable: notes won’t be saved';
  document.title = n && !inTrash && titleOf(n.body) ? `${titleOf(n.body)} · Scratchpad` : 'Scratchpad';
}

function renderMeta() {
  const n = current();
  const meta = $('#meta');
  if (ui.view === 'trash' || !n) {
    meta.textContent = '';
    return;
  }
  const s = stats(editor.value);
  const parts = [`Edited ${agoLong(n.updated)}`, plural(s.words, 'word'), plural(s.chars, 'char')];
  const days = store.state.settings.expireDays;
  if (days && !n.pinned) parts.push(`auto-clears ${new Date(n.updated + days * DAY).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
  meta.textContent = parts.join(' · ');
}

function renderTrash(trashed) {
  const rows = trashed
    .map((n) => {
      const title = titleOf(n.body);
      const left = Math.max(0, Math.ceil((n.deletedAt + TRASH_DAYS * DAY - Date.now()) / DAY));
      return `<li class="trash-row">
        <div class="note-main">
          <div class="note-line"><span class="note-title${title ? '' : ' untitled'}">${title ? esc(title) : 'Untitled'}</span></div>
          <div class="note-snippet">${esc(snippetOf(n.body))}</div>
          <div class="note-time">Deleted ${agoLong(n.deletedAt)} · gone in ${plural(left, 'day')}</div>
        </div>
        <div class="row-actions">
          <button class="btn small" data-action="restore" data-id="${n.id}">Restore</button>
          <button class="btn small subtle danger" data-action="purge" data-id="${n.id}">Delete now</button>
        </div>
      </li>`;
    })
    .join('');
  $('#trash-view').innerHTML = `<div class="trash-inner">
    <div class="trash-head"><h1>Trash</h1>${trashed.length ? '<button class="btn danger subtle" data-action="empty-trash">Empty trash</button>' : ''}</div>
    <p class="trash-sub">Deleted notes stay here for ${TRASH_DAYS} days, then disappear for good.</p>
    ${trashed.length ? `<ul class="trash-list">${rows}</ul>` : '<p class="empty-hint">The trash is empty.</p>'}
  </div>`;
}

// ---------- sidebar (mobile) ----------

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
}

// ---------- search ----------

const search = $('#search');
search.addEventListener('input', () => {
  query = search.value.trim();
  render();
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    clearSearch();
    search.blur();
  } else if (e.key === 'Enter') {
    const first = store.search(query)[0];
    if (first) {
      open(first.id);
      selectMatch();
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    $('#note-list .note-item')?.focus();
  }
});
function clearSearch() {
  search.value = '';
  query = '';
  render();
}
function selectMatch() {
  const term = query.toLowerCase().split(/\s+/).filter(Boolean)[0];
  if (!term) return;
  const at = editor.value.toLowerCase().indexOf(term);
  if (at < 0) return;
  if (ui.mode === 'read') setMode('write');
  editor.focus();
  editor.setSelectionRange(at, at + term.length);
  // scroll the match into view: measure with a mirror of the text before it
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
  const line = editor.value.slice(0, at).split('\n').length;
  editor.scrollTop = Math.max(0, (line - 4) * lineHeight);
}

// ---------- actions ----------

const actions = {
  'new-note'() {
    newNote();
  },
  open(el) {
    const q = query;
    open(el.dataset.id);
    if (q) selectMatch();
  },
  mode(el) {
    setMode(el.dataset.mode);
    if (ui.mode !== 'read') editor.focus();
  },
  pin() {
    const n = current();
    if (!n) return;
    flush();
    attempt(() => store.setPinned(n.id, !n.pinned));
    toast(n.pinned ? 'Pinned. It stays at the top and is never auto-cleared.' : 'Unpinned', { timeout: 2200 });
  },
  'copy-note'(el) {
    copyFeedback(editor.value, el);
  },
  'download-note'() {
    const n = current();
    if (!n) return;
    flush();
    download(`${fileSlug(n)}.md`, n.body.endsWith('\n') ? n.body : n.body + '\n');
  },
  'trash-note'() {
    const n = current();
    if (!n) return;
    flush();
    if (!n.body.trim()) {
      store.purge(n.id);
      openNext();
      return;
    }
    const next = neighbour(n.id);
    attempt(() => store.trash(n.id));
    toast(`Moved “${titleOf(n.body) || 'Untitled'}” to the trash`, {
      action: {
        label: 'Undo',
        run: () => {
          store.restore(n.id);
          open(n.id);
        },
      },
    });
    if (next) open(next.id);
    else openNext();
  },
  'open-trash'() {
    flush();
    store.pruneEmpty();
    ui.view = 'trash';
    render();
    closeSidebar();
  },
  restore(el) {
    attempt(() => store.restore(el.dataset.id));
    toast('Restored', { action: { label: 'Open', run: () => open(el.dataset.id) }, timeout: 3000 });
  },
  async purge(el) {
    const n = store.get(el.dataset.id);
    if (!n) return;
    if (await confirmBox({ title: 'Delete this note now?', message: `“${titleOf(n.body) || 'Untitled'}” will be gone for good.`, ok: 'Delete', danger: true }))
      store.purge(n.id);
  },
  async 'empty-trash'() {
    const count = store.trashed().length;
    if (await confirmBox({ title: 'Empty the trash?', message: `${plural(count, 'note')} will be deleted for good.`, ok: 'Empty trash', danger: true })) {
      store.emptyTrash();
      toast('Trash emptied', { timeout: 2000 });
    }
  },
  'toggle-sidebar'() {
    document.body.classList.toggle('sidebar-open');
  },
  'open-io'() {
    $('#expire-select').value = String(store.state.settings.expireDays);
    $('#io-dialog').showModal();
  },
  'open-help'() {
    $('#help-dialog').showModal();
  },
  'export-json'() {
    flush();
    download(`scratchpad-backup-${stamp()}.json`, store.exportJson(), 'application/json');
  },
  'export-md'() {
    flush();
    const notes = store.active();
    if (!notes.length) return toast('There are no notes to export.');
    const md = notes.map((n) => n.body.trim()).join('\n\n---\n\n') + '\n';
    download(`scratchpad-${stamp()}.md`, md);
  },
  async wipe() {
    if (
      await confirmBox({
        title: 'Erase all notes?',
        message: 'Every note, including the trash, is deleted from this browser. This can’t be undone. Export a backup first if you might want them.',
        ok: 'Erase everything',
        danger: true,
      })
    ) {
      store.wipe();
      $('#io-dialog').close();
      open(null);
      toast('All notes erased');
    }
  },
  'cycle-theme'() {
    const next = { system: 'light', light: 'dark', dark: 'system' }[getTheme()];
    setTheme(next);
    toast(`Theme: ${THEMES[next].label}`, { timeout: 1500 });
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    e.preventDefault();
    Promise.resolve(fn(el, e)).catch(fail);
  }
});

function neighbour(id) {
  const list = store.search(query);
  const i = list.findIndex((n) => n.id === id);
  return list[i + 1] || list[i - 1] || null;
}
function openNext() {
  const first = store.active()[0];
  if (first) open(first.id);
  else {
    const n = attempt(() => store.create(''));
    open(n?.id ?? null);
  }
}

// ---------- preview interactions: copy & tasks ----------

preview.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn');
  if (btn) {
    // copy the text as shown; shift-click copies the markdown source
    const block = btn.closest('[data-copy]');
    const shown = block.classList.contains('code-block') ? block.dataset.copy : visibleText(block);
    copyFeedback(e.shiftKey ? block.dataset.copy : shown, btn);
    return;
  }
  const code = e.target.closest('code.copy');
  if (code && !window.getSelection()?.toString()) {
    copyFeedback(code.textContent);
    return;
  }
});
function visibleText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.copy-btn, input, ul, ol').forEach((x) => x.remove());
  clone.querySelectorAll('br').forEach((x) => x.replaceWith('\n'));
  return clone.textContent.trim();
}

preview.addEventListener('change', (e) => {
  const box = e.target.closest('input[type="checkbox"][data-line]');
  if (!box) return;
  const n = current();
  if (!n) return;
  const scroll = $('#read-pane').scrollTop;
  editor.value = toggleTask(editor.value, +box.dataset.line);
  scheduleSave();
  flush();
  renderPreview();
  requestAnimationFrame(() => ($('#read-pane').scrollTop = scroll));
});

// keep the preview roughly in step with the editor in split mode
editor.addEventListener('scroll', () => {
  if (ui.mode !== 'split') return;
  const max = editor.scrollHeight - editor.clientHeight;
  const pane = $('#read-pane');
  pane.scrollTop = max > 0 ? (editor.scrollTop / max) * (pane.scrollHeight - pane.clientHeight) : 0;
});

// ---------- editor behaviour ----------

editor.addEventListener('input', () => {
  scheduleSave();
  if (ui.mode === 'split') renderPreview({ throttle: true });
  renderMeta();
});
editor.addEventListener('blur', flush);

// insertText keeps the browser's native undo stack intact
function insert(text, selStart, selEnd) {
  if (selStart != null) editor.setSelectionRange(selStart, selEnd ?? selStart);
  if (!document.execCommand('insertText', false, text)) {
    editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input'));
  }
}
// delete a range, then put the caret where it was (Chrome misplaces it before a trailing newline)
function remove(from, to) {
  insert('', from, to);
  editor.setSelectionRange(from, from);
}

function lineBounds(pos) {
  const v = editor.value;
  const start = v.lastIndexOf('\n', pos - 1) + 1;
  let end = v.indexOf('\n', pos);
  if (end < 0) end = v.length;
  return { start, end };
}

function wrap(before, after = before) {
  const { selectionStart: s, selectionEnd: e, value: v } = editor;
  const sel = v.slice(s, e);
  if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
    insert(sel.slice(before.length, sel.length - after.length));
    editor.setSelectionRange(s, e - before.length - after.length);
    return;
  }
  insert(before + sel + after);
  editor.setSelectionRange(s + before.length, s + before.length + sel.length);
}

function indentLines(outdent) {
  const { selectionStart: s, selectionEnd: e, value: v } = editor;
  const start = v.lastIndexOf('\n', s - 1) + 1;
  const endLine = lineBounds(e > s && v[e - 1] === '\n' ? e - 1 : e).end;
  const block = v.slice(start, endLine);
  const lines = block.split('\n');
  let firstDelta = 0;
  const changed = lines.map((l, i) => {
    if (outdent) {
      const m = l.match(/^( {1,2}|\t)/);
      const d = m ? m[0].length : 0;
      if (i === 0) firstDelta = -d;
      return l.slice(d);
    }
    if (i === 0) firstDelta = 2;
    return '  ' + l;
  });
  const out = changed.join('\n');
  insert(out, start, endLine);
  if (s === e) editor.setSelectionRange(Math.max(start, s + firstDelta), Math.max(start, s + firstDelta));
  else editor.setSelectionRange(Math.max(start, s + firstDelta), start + out.length);
}

editor.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  const { selectionStart: s, selectionEnd: end, value: v } = editor;

  if (e.key === 'Tab' && !mod(e) && !e.altKey) {
    e.preventDefault();
    const { start } = lineBounds(s);
    const onItem = /^\s*([-*+]|\d+[.)])\s/.test(v.slice(start));
    if (s !== end || e.shiftKey || onItem) indentLines(e.shiftKey);
    else insert('  ');
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey && !mod(e) && !e.altKey && s === end) {
    const { start } = lineBounds(s);
    const line = v.slice(start, s);
    const m = line.match(/^(\s*(?:>\s?)*)(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/);
    if (m) {
      const rest = v.slice(s, lineBounds(s).end);
      if (line.length === m[0].length && !rest.trim()) {
        // empty item: end the list
        e.preventDefault();
        remove(start, s);
        return;
      }
      e.preventDefault();
      const marker = m[4] ? `${+m[4] + 1}${m[5]}` : m[3];
      insert(`\n${m[1]}${m[2]}${marker}${m[6]}${m[7] ? '[ ] ' : ''}`);
      return;
    }
    const q = line.match(/^(\s*>\s?)+/);
    if (q) {
      e.preventDefault();
      if (line.trim() === '>') remove(start, s);
      else insert(`\n${q[0]}`);
      return;
    }
  }

  if (mod(e) && !e.altKey && !e.shiftKey) {
    const k = e.key.toLowerCase();
    if (k === 'b') {
      e.preventDefault();
      wrap('**');
    } else if (k === 'i') {
      e.preventDefault();
      wrap('_');
    } else if (k === 'k') {
      e.preventDefault();
      const sel = v.slice(s, end);
      if (/^\s*https?:\/\/\S+\s*$/.test(sel)) {
        insert(`[](${sel.trim()})`);
        editor.setSelectionRange(s + 1, s + 1);
      } else {
        insert(`[${sel}](https://)`);
        editor.setSelectionRange(s + sel.length + 3, s + sel.length + 11);
      }
    }
  }

  if (e.key === 'Escape') {
    flush();
    editor.blur();
  }
});

// ---------- global keys ----------

const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();

  if (mod(e) && !e.altKey && !e.shiftKey && k === 's') {
    e.preventDefault();
    clearTimeout(pending);
    pending = 1;
    flush();
    toast('Saved. Notes save automatically as you type.', { timeout: 1800 });
    return;
  }
  if (mod(e) && !e.altKey && !e.shiftKey && k === 'e') {
    e.preventDefault();
    if (ui.view !== 'note') return;
    if (ui.mode === 'read') {
      setMode('write');
      editor.focus();
    } else {
      flush();
      setMode('read');
      editor.blur();
    }
    return;
  }
  if (e.altKey && !mod(e) && e.code === 'KeyN') {
    e.preventDefault();
    newNote();
    return;
  }

  if (typing(e.target) || mod(e) || e.altKey) return;
  if (e.key === '/') {
    e.preventDefault();
    document.body.classList.add('sidebar-open');
    search.focus();
    search.select();
  } else if (k === 'n') {
    e.preventDefault();
    newNote();
  } else if (k === 'j' || k === 'k') {
    const list = store.search(query);
    const i = list.findIndex((n) => n.id === ui.current);
    const next = list[Math.min(list.length - 1, Math.max(0, i + (k === 'j' ? 1 : -1)))];
    if (next) open(next.id);
  } else if (e.key === 'Enter' && ui.view === 'note' && e.target === document.body) {
    e.preventDefault();
    focusEditor();
  } else if (e.key === 'Escape') {
    if (query) clearSearch();
    closeSidebar();
  }
});

// arrow keys move through the note list
$('#note-list').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...document.querySelectorAll('#note-list .note-item')];
  const i = items.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  if (e.key === 'ArrowUp' && i === 0) return search.focus();
  items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
});

// ---------- quick capture: paste anywhere ----------

document.addEventListener('paste', (e) => {
  if (typing(e.target) || document.querySelector('dialog[open]')) return;
  const text = e.clipboardData?.getData('text/plain');
  if (!text || !text.trim()) return;
  e.preventDefault();
  flush();
  let n = current();
  if (!n || n.deletedAt || ui.view === 'trash') {
    n = attempt(() => store.create(''));
    if (!n) return;
    open(n.id);
  }
  const before = n.body;
  const updated = attempt(() => store.append(n.id, text));
  if (!updated) return;
  ui.view = 'note';
  loadEditor();
  render();
  editor.scrollTop = editor.scrollHeight;
  $('#read-pane').scrollTop = $('#read-pane').scrollHeight;
  toast(`Added to “${titleOf(updated.body) || 'Untitled'}”`, {
    action: {
      label: 'Undo',
      run: () => {
        store.update(n.id, before);
        if (ui.current === n.id) loadEditor();
      },
    },
  });
});

// ---------- import: file picker and drag-and-drop ----------

async function importFiles(files) {
  flush();
  const replace = $('#import-replace').checked;
  let added = 0;
  let lastId = null;
  for (const f of files) {
    const text = await f.text();
    if (/\.json$/i.test(f.name) || f.type === 'application/json') {
      if (replace && !(await confirmBox({ title: 'Replace everything?', message: `Your current notes will be replaced by the contents of ${f.name}.`, ok: 'Replace', danger: true })))
        continue;
      added += store.importJson(text, { replace });
    } else {
      const n = store.create(text.replace(/\r\n?/g, '\n').replace(/\s+$/, ''));
      lastId = n.id;
      added++;
    }
  }
  $('#import-replace').checked = false;
  if (lastId) open(lastId);
  else {
    if (!current()) ui.current = store.active()[0]?.id ?? null;
    loadEditor();
    render();
  }
  toast(added ? `Imported ${plural(added, 'note')}` : 'Nothing new to import');
}
$('#import-file').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) importFiles(files).catch(fail).finally(() => $('#io-dialog').close());
});

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('is-dragging-file');
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('is-dragging-file');
  }
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('is-dragging-file');
  const files = [...e.dataTransfer.files].filter((f) => /\.(md|markdown|txt|json)$/i.test(f.name) || /^text\//.test(f.type));
  if (files.length) importFiles(files).catch(fail);
  else toast('Drop .md, .txt or .json files to import them.', { error: true });
});

$('#expire-select').addEventListener('change', (e) => {
  attempt(() => store.setExpireDays(+e.target.value));
  const { expired } = store.sweep(ui.current);
  if (expired) toast(`Moved ${plural(expired, 'old note')} to the trash`);
});

// ---------- store changes & other tabs ----------

store.subscribe(() => render());

window.addEventListener('storage', (e) => {
  if (e.key === store.key) {
    store.reload();
    const n = current();
    if (!n || n.deletedAt) {
      if (ui.view === 'note') openNext();
      return;
    }
    // take the other tab's text unless we have unsaved typing of our own
    if (!pending && editor.value !== n.body) {
      const { selectionStart: s, selectionEnd: en } = editor;
      const focused = document.activeElement === editor;
      editor.value = n.body;
      if (focused) editor.setSelectionRange(Math.min(s, n.body.length), Math.min(en, n.body.length));
      renderPreview();
    }
  } else if (e.key === THEME_KEY) {
    if (e.newValue === 'light' || e.newValue === 'dark') document.documentElement.dataset.theme = e.newValue;
    else delete document.documentElement.dataset.theme;
    renderThemeButton();
  }
});

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id && id !== ui.current && store.get(id) && !store.get(id).deletedAt) open(id);
});

window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flush();
  else housekeeping();
});

function housekeeping() {
  const { expired } = store.sweep(ui.current);
  if (expired) toast(`Auto-clear moved ${plural(expired, 'old note')} to the trash`, { action: { label: 'View', run: () => actions['open-trash']() } });
}

// relative times tick over
setInterval(() => {
  if (!document.hidden) render();
}, 60 * 1000);
setInterval(() => {
  if (!document.hidden) housekeeping();
}, 60 * 60 * 1000);

// ---------- theme ----------

const THEMES = {
  system: { label: 'match system', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>' },
  light: { label: 'light', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' },
  dark: { label: 'dark', icon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>' },
};
function getTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'system';
}
function setTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    if (t === 'system') storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, t);
  } catch {}
  renderThemeButton();
}
function renderThemeButton() {
  const t = getTheme();
  const next = { system: 'light', light: 'dark', dark: 'system' }[t];
  const btn = $('#theme-btn');
  btn.innerHTML = THEMES[t].icon;
  btn.title = `Theme: ${THEMES[t].label} (click for ${THEMES[next].label})`;
  btn.setAttribute('aria-label', btn.title);
}

// ---------- welcome note ----------

const WELCOME = `# Welcome to Scratchpad

A place to drop strings you need somewhere else. Everything stays in this browser.

## Capture
- Type here, or **paste anywhere** outside the editor to add a line to this note
- New note: \`n\` or the + button. Empty notes tidy themselves away
- Markdown works: **bold**, _italic_, [links](https://example.com), lists, tables, code

## Copy back out
Switch to **Read** (⌘E). Then:
- Click any \`inline-code\` to copy it
- Hover any line and use its copy button (⇧-click copies the markdown source)
- Code blocks have a copy button too:

\`\`\`bash
git log --oneline -n 20
\`\`\`

## Keep it ephemeral
- [ ] Pin the notes you want to keep (📌 in the toolbar)
- [ ] Turn on auto-clear in *Data & settings* to bin untouched notes after a day, a week or a month
- [x] Deleted notes wait in the trash for 7 days

Delete this note when you're done with it.
`;

// ---------- go ----------

renderThemeButton();
renderMode();
store.sweep(ui.current);
store.pruneEmpty(ui.current);
const fromHash = location.hash.slice(1);
const first = !storage?.getItem(store.key);
if (fromHash && store.get(fromHash) && !store.get(fromHash).deletedAt) ui.current = fromHash;
if (!current() || current().deletedAt) ui.current = store.active()[0]?.id ?? null;
if (!ui.current) {
  const n = attempt(() => store.create(first ? WELCOME : ''));
  ui.current = n?.id ?? null;
  if (first && n) ui.mode = narrow.matches ? 'read' : 'split';
}
open(ui.current);
renderMode();
renderPreview();
if (!storage) toast('Local storage is blocked in this browser, so nothing will be saved.', { error: true, timeout: 15000 });
navigator.storage?.persist?.().catch(() => {});
