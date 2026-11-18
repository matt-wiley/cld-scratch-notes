// Data model for Scratchpad. Pure and DOM-free so it runs under Node for tests.
//
// state = {
//   version: 1,
//   notes: [{ id, body, created, updated, pinned, deletedAt }],
//   settings: { expireDays }   // 0 = keep forever
// }

export const DAY = 24 * 60 * 60 * 1000;
export const TRASH_DAYS = 7;
export const EXPIRY_CHOICES = [0, 1, 7, 30];
export const STORAGE_KEY = 'scratchpad:data';

export function uid() {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

const MARKUP = /^\s*(?:#{1,6}\s+|>\s*|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)*/;
const NOT_TITLE = /^\s*(```|~~~|([-*_])(\s*\2){2,}\s*$|\|?\s*:?-+:?\s*\|)/;

function plain(line) {
  return line
    .replace(MARKUP, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .trim();
}

/** The first meaningful line of a note, without markdown syntax. */
export function titleOf(body) {
  for (const line of String(body ?? '').split('\n')) {
    if (NOT_TITLE.test(line)) continue;
    const t = plain(line);
    if (t) return t.length > 80 ? t.slice(0, 79) + '…' : t;
  }
  return '';
}

/** A one-line preview of what comes after the title. */
export function snippetOf(body, max = 120) {
  const lines = String(body ?? '').split('\n');
  let seenTitle = false;
  const parts = [];
  for (const line of lines) {
    if (NOT_TITLE.test(line)) continue;
    const t = plain(line);
    if (!t) continue;
    if (!seenTitle) {
      seenTitle = true;
      continue;
    }
    parts.push(t);
    if (parts.join(' ').length > max) break;
  }
  const s = parts.join(' · ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function stats(body) {
  const text = String(body ?? '');
  const words = (text.match(/\S+/g) || []).length;
  const lines = text ? text.split('\n').length : 0;
  return { chars: text.length, words, lines };
}

function defaults() {
  return { version: 1, notes: [], settings: { expireDays: 0 } };
}

function normalizeNote(n, now) {
  if (!n || typeof n !== 'object') return null;
  const body = typeof n.body === 'string' ? n.body : '';
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return {
    id: typeof n.id === 'string' && n.id ? n.id : uid(),
    body,
    created: num(n.created, now),
    updated: num(n.updated, num(n.created, now)),
    pinned: !!n.pinned,
    deletedAt: Number.isFinite(n.deletedAt) ? n.deletedAt : null,
  };
}

export function normalize(raw, now = Date.now()) {
  const s = defaults();
  if (!raw || typeof raw !== 'object') return s;
  const seen = new Set();
  for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
    const note = normalizeNote(n, now);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    s.notes.push(note);
  }
  const e = raw.settings?.expireDays;
  if (EXPIRY_CHOICES.includes(e)) s.settings.expireDays = e;
  return s;
}

export class Store {
  constructor({ storage = null, key = STORAGE_KEY, now = () => Date.now() } = {}) {
    this.storage = storage;
    this.key = key;
    this.now = now;
    this.listeners = new Set();
    this.state = this.read();
  }

  read() {
    try {
      const raw = this.storage?.getItem(this.key);
      return raw ? normalize(JSON.parse(raw), this.now()) : defaults();
    } catch {
      return defaults();
    }
  }

  /** Re-read from storage (another tab changed it). */
  reload() {
    this.state = this.read();
    this.emit();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn(this);
  }

  commit() {
    if (this.storage) {
      try {
        this.storage.setItem(this.key, JSON.stringify(this.state));
      } catch (err) {
        this.emit();
        throw new Error('Local storage is full or unavailable, so the last change was not saved. Export a backup and delete some notes.');
      }
    }
    this.emit();
  }

  get bytes() {
    return (this.storage?.getItem(this.key) || '').length;
  }

  // ---------- queries ----------

  get(id) {
    return this.state.notes.find((n) => n.id === id) || null;
  }

  /** Live notes: pinned first, then most recently edited. */
  active() {
    return this.state.notes
      .filter((n) => !n.deletedAt)
      .sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  }

  trashed() {
    return this.state.notes.filter((n) => n.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  }

  search(query) {
    const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const notes = this.active();
    if (!terms.length) return notes;
    return notes.filter((n) => {
      const hay = n.body.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  // ---------- mutations ----------

  create(body = '') {
    const t = this.now();
    const note = { id: uid(), body: String(body), created: t, updated: t, pinned: false, deletedAt: null };
    this.state.notes.unshift(note);
    this.commit();
    return note;
  }

  update(id, body) {
    const n = this.get(id);
    if (!n || n.body === body) return n;
    n.body = String(body);
    n.updated = this.now();
    this.commit();
    return n;
  }

  /** Add text to the end of a note on its own line. */
  append(id, text) {
    const n = this.get(id);
    if (!n) return null;
    const add = String(text).replace(/\s+$/, '');
    const base = n.body.replace(/\s+$/, '');
    return this.update(id, base ? `${base}\n${add}` : add);
  }

  setPinned(id, pinned) {
    const n = this.get(id);
    if (!n) return;
    n.pinned = !!pinned;
    this.commit();
  }

  trash(id) {
    const n = this.get(id);
    if (!n || n.deletedAt) return;
    n.deletedAt = this.now();
    this.commit();
  }

  restore(id) {
    const n = this.get(id);
    if (!n || !n.deletedAt) return;
    n.deletedAt = null;
    this.commit();
  }

  purge(id) {
    const before = this.state.notes.length;
    this.state.notes = this.state.notes.filter((n) => n.id !== id);
    if (this.state.notes.length !== before) this.commit();
  }

  emptyTrash() {
    const before = this.state.notes.length;
    this.state.notes = this.state.notes.filter((n) => !n.deletedAt);
    if (this.state.notes.length !== before) this.commit();
    return before - this.state.notes.length;
  }

  /** Drop unpinned live notes with no content (except `keepId`). Not undoable: they were empty. */
  pruneEmpty(keepId = null) {
    const before = this.state.notes.length;
    this.state.notes = this.state.notes.filter((n) => n.id === keepId || n.deletedAt || n.pinned || n.body.trim());
    if (this.state.notes.length !== before) this.commit();
  }

  /**
   * Housekeeping: move unpinned notes untouched for `expireDays` to the trash,
   * and permanently delete notes that have been in the trash for TRASH_DAYS.
   */
  sweep(keepId = null) {
    const t = this.now();
    let expired = 0;
    let purged = 0;
    const days = this.state.settings.expireDays;
    for (const n of this.state.notes) {
      if (days && !n.deletedAt && !n.pinned && n.id !== keepId && t - n.updated >= days * DAY) {
        n.deletedAt = t;
        expired++;
      }
    }
    const keep = this.state.notes.filter((n) => !(n.deletedAt && t - n.deletedAt >= TRASH_DAYS * DAY));
    purged = this.state.notes.length - keep.length;
    this.state.notes = keep;
    if (expired || purged) this.commit();
    return { expired, purged };
  }

  setExpireDays(days) {
    if (!EXPIRY_CHOICES.includes(days)) throw new Error(`Unsupported expiry: ${days}`);
    this.state.settings.expireDays = days;
    this.commit();
  }

  // ---------- import / export ----------

  exportJson() {
    return JSON.stringify({ app: 'scratchpad', exported: new Date(this.now()).toISOString(), ...this.state }, null, 2);
  }

  /** Merge a JSON backup. Same id: the newer edit wins. Returns the number of notes added or updated. */
  importJson(text, { replace = false } = {}) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('That file isn’t valid JSON.');
    }
    if (!data || !Array.isArray(data.notes)) throw new Error('That JSON isn’t a Scratchpad backup (no "notes" list).');
    const incoming = normalize(data, this.now());
    if (replace) {
      this.state = incoming;
      this.commit();
      return incoming.notes.length;
    }
    let changed = 0;
    for (const n of incoming.notes) {
      const mine = this.get(n.id);
      if (!mine) {
        this.state.notes.push(n);
        changed++;
      } else if (n.updated > mine.updated) {
        Object.assign(mine, n);
        changed++;
      }
    }
    if (changed) this.commit();
    return changed;
  }

  wipe() {
    this.state = defaults();
    this.commit();
  }
}
