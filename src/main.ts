import './base.css';
import './style.css';
import { h, toast, copyText, loadJSON, saveJSON, uid, langToggle, downloadBlob } from './ui';
import { dicts, type Lang, type Dict } from './i18n';

interface Note { id: string; text: string; pinned: boolean; created: number; updated: number }
interface State { notes: Note[]; lastId: string | null; lang: Lang; startup: 'last' | 'new' }

const KEY = 'satto-memo:v1';
const st: State = loadJSON<State>(KEY, { notes: [], lastId: null, lang: 'ja', startup: 'last' });
let t: Dict = dicts[st.lang];
const save = () => saveJSON(KEY, st);

const app = document.getElementById('app')!;
let view: 'edit' | 'list' = 'edit';
let current: Note | null = null;
let query = '';

const ICON = {
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6zM12 14v7"/></svg>',
  pinOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6z"/><path d="M12 14v7" fill="none"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
};
const icon = (k: keyof typeof ICON) => { const s = h('span', { class: 'ic' }); s.innerHTML = ICON[k]; return s; };

function setLang(l: Lang) { st.lang = l; t = dicts[l]; document.documentElement.lang = l; document.title = t.app; save(); render(); }

function newNote(): Note {
  const n = Date.now();
  return { id: uid(), text: '', pinned: false, created: n, updated: n };
}
/** Drop the current note if it is empty (never persist blank notes). */
function discardIfEmpty() {
  if (current && !current.text.trim()) {
    st.notes = st.notes.filter((n) => n.id !== current!.id);
    if (st.lastId === current.id) st.lastId = null;
    save();
  }
}
function openNote(n: Note | null, push = true) {
  discardIfEmpty();
  current = n ?? newNote();
  view = 'edit';
  if (push) history.pushState({ v: 'edit' }, '');
  render();
}
function goList() {
  flush();
  discardIfEmpty();
  view = 'list';
  render();
}
window.addEventListener('popstate', (e) => {
  const v = (e.state && e.state.v) || 'list';
  if (v === 'list') goList();
  else if (view !== 'edit') openNote(current, false);
});

let saveTimer = 0;
let dirty = false;
function flush() {
  if (!dirty || !current) return;
  clearTimeout(saveTimer);
  dirty = false;
  const c = current;
  const existing = st.notes.find((n) => n.id === c.id);
  if (c.text.trim()) {
    c.updated = Date.now();
    if (!existing) st.notes.push(c);
    st.lastId = c.id;
  }
  save();
  const s = document.getElementById('savestate');
  if (s) s.textContent = t.saved;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('pagehide', flush);

function titleOf(n: Note) {
  const line = n.text.split('\n').find((l) => l.trim());
  return line ? line.trim() : t.untitled;
}
function previewOf(n: Note) {
  const lines = n.text.split('\n').filter((l) => l.trim());
  return lines.slice(1).join(' ').slice(0, 120);
}
function fmtDate(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  const loc = st.lang === 'ja' ? 'ja-JP' : 'en-US';
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(loc, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
}

function deleteNote(n: Note) {
  const idx = st.notes.findIndex((x) => x.id === n.id);
  if (idx >= 0) st.notes.splice(idx, 1);
  if (st.lastId === n.id) st.lastId = null;
  save();
  toast(t.deleted, {
    label: t.undo,
    run: () => {
      if (!st.notes.some((x) => x.id === n.id)) st.notes.splice(Math.max(0, idx), 0, n);
      save();
      render();
    },
  });
}

async function shareNote(n: Note) {
  if (!n.text.trim()) return;
  if (navigator.share) {
    try { await navigator.share({ text: n.text }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  toast((await copyText(n.text)) ? t.copied : t.copyFail);
}

function renderEditor() {
  const c = current!;
  const ta = h('textarea', { class: 'editor', placeholder: t.placeholder, spellcheck: 'false', 'aria-label': t.placeholder });
  ta.value = c.text;
  const status = h('span', { id: 'savestate', class: 'muted small' }, c.text ? t.saved : '');
  const count = h('span', { class: 'muted small' }, t.chars([...c.text].length));
  const pinBtn = h('button', { class: 'icon-btn', 'aria-label': c.pinned ? t.unpin : t.pin, title: c.pinned ? t.unpin : t.pin, 'aria-pressed': String(c.pinned) }, icon(c.pinned ? 'pinOn' : 'pin'));
  pinBtn.addEventListener('click', () => {
    c.pinned = !c.pinned;
    if (c.text.trim()) { dirty = true; flush(); }
    pinBtn.replaceChildren(icon(c.pinned ? 'pinOn' : 'pin'));
    pinBtn.setAttribute('aria-pressed', String(c.pinned));
    pinBtn.setAttribute('aria-label', c.pinned ? t.unpin : t.pin);
  });
  ta.addEventListener('input', () => {
    c.text = ta.value;
    dirty = true;
    status.textContent = t.saving;
    count.textContent = t.chars([...c.text].length);
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flush, 400);
  });
  const n = st.notes.length;
  app.replaceChildren(
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn list-btn', 'aria-label': t.notes, title: t.notes, onclick: () => history.state?.v === 'edit' ? history.back() : (history.replaceState({ v: 'list' }, ''), goList()) },
        icon('list'), n ? h('span', { class: 'badge' }, String(n > 99 ? '99+' : n)) : null),
      h('h1', {}, t.app),
      langToggle(st.lang, setLang),
      h('button', { class: 'icon-btn', 'aria-label': t.newNote, title: t.newNote, onclick: () => { flush(); discardIfEmpty(); current = newNote(); render(); } }, icon('plus')),
    ),
    h('main', { class: 'edit-main' }, ta),
    h('footer', { class: 'edit-bar' },
      h('div', { class: 'grow status' }, status, count),
      pinBtn,
      h('button', { class: 'icon-btn', 'aria-label': t.copy, title: t.copy, onclick: async () => { if (c.text) toast((await copyText(c.text)) ? t.copied : t.copyFail); } }, icon('copy')),
      h('button', { class: 'icon-btn', 'aria-label': t.share, title: t.share, onclick: () => shareNote(c) }, icon('share')),
      h('button', { class: 'icon-btn', 'aria-label': t.del, title: t.del, onclick: () => {
        const snapshot = { ...c };
        dirty = false;
        if (st.notes.some((x) => x.id === c.id)) deleteNote(snapshot);
        current = newNote();
        render();
      } }, icon('trash')),
    ),
  );
  if (!c.text) setTimeout(() => ta.focus(), 50);
}

function noteItem(n: Note) {
  return h('li', { class: 'note' },
    h('button', { class: 'note-main', onclick: () => openNote(n) },
      h('div', { class: 'note-title' }, titleOf(n)),
      h('div', { class: 'note-sub' }, h('span', { class: 'note-date' }, fmtDate(n.updated)), ' ', previewOf(n)),
    ),
    h('button', { class: 'icon-btn' + (n.pinned ? ' on' : ''), 'aria-label': n.pinned ? t.unpin : t.pin, 'aria-pressed': String(n.pinned), onclick: () => { n.pinned = !n.pinned; save(); renderList(); } }, icon(n.pinned ? 'pinOn' : 'pin')),
    h('button', { class: 'icon-btn', 'aria-label': t.del, onclick: () => { deleteNote(n); renderList(); } }, icon('trash')),
  );
}

function renderListBody(box: HTMLElement) {
  const q = query.trim().toLowerCase();
  const list = st.notes
    .filter((n) => !q || n.text.toLowerCase().includes(q))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
  box.replaceChildren();
  if (!list.length) { box.append(h('p', { class: 'empty' }, q ? t.noMatch : t.empty)); return; }
  const pinned = list.filter((n) => n.pinned);
  const rest = list.filter((n) => !n.pinned);
  if (pinned.length) box.append(h('h2', { class: 'sec' }, t.pinned), h('ul', { class: 'notes' }, ...pinned.map(noteItem)));
  if (rest.length) box.append(pinned.length ? h('h2', { class: 'sec' }, t.others) : '', h('ul', { class: 'notes' }, ...rest.map(noteItem)));
}

function exportJSON() {
  const data = { app: 'satto-memo', version: 1, exported: new Date().toISOString(), notes: st.notes };
  const d = new Date();
  const name = `satto-memo-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
}
function importJSON() {
  const inp = h('input', { type: 'file', accept: 'application/json,.json' });
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const arr: unknown[] = Array.isArray(data) ? data : data.notes;
      if (!Array.isArray(arr)) throw new Error('bad');
      let count = 0;
      for (const raw of arr) {
        const r = raw as Partial<Note>;
        if (typeof r.text !== 'string') continue;
        const note: Note = {
          id: typeof r.id === 'string' ? r.id : uid(),
          text: r.text,
          pinned: !!r.pinned,
          created: Number(r.created) || Date.now(),
          updated: Number(r.updated) || Date.now(),
        };
        const ex = st.notes.find((n) => n.id === note.id);
        if (ex) { if (note.updated > ex.updated) Object.assign(ex, note); } else st.notes.push(note);
        count++;
      }
      save();
      toast(t.imported(count));
      renderList();
    } catch {
      toast(t.importFail);
    }
  });
  inp.click();
}

function renderList() {
  const box = h('div', { class: 'list-box' });
  const search = h('input', { class: 'input search', type: 'search', placeholder: t.search, 'aria-label': t.search, value: query });
  search.addEventListener('input', () => { query = search.value; renderListBody(box); });
  renderListBody(box);
  app.replaceChildren(
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': t.back, onclick: () => openNote(null) }, icon('back')),
      h('h1', {}, `${t.notes}`, h('span', { class: 'count' }, t.count(st.notes.length))),
      langToggle(st.lang, setLang),
    ),
    h('main', {},
      search,
      box,
      h('section', { class: 'card settings' },
        h('div', { class: 'set-row' },
          h('span', { class: 'set-label' }, t.startup),
          h('div', { class: 'seg' },
            h('button', { 'aria-pressed': String(st.startup === 'last'), onclick: () => { st.startup = 'last'; save(); renderList(); } }, t.startLast),
            h('button', { 'aria-pressed': String(st.startup === 'new'), onclick: () => { st.startup = 'new'; save(); renderList(); } }, t.startNew),
          ),
        ),
        h('div', { class: 'set-row' },
          h('span', { class: 'set-label' }, t.backup),
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: exportJSON, disabled: !st.notes.length }, t.exportJson),
            h('button', { class: 'btn', onclick: importJSON }, t.importJson),
          ),
        ),
      ),
      h('p', { class: 'foot' }, t.privacy),
    ),
    h('button', { class: 'fab', 'aria-label': t.newNote, onclick: () => openNote(null) }, icon('plus')),
  );
}

function render() {
  if (view === 'edit') renderEditor();
  else renderList();
}

// boot: list is the base history entry, the editor is pushed on top so Android "back" goes to the list.
document.documentElement.lang = st.lang;
document.title = t.app;
history.replaceState({ v: 'list' }, '');
const last = st.startup === 'last' ? st.notes.find((n) => n.id === st.lastId) ?? null : null;
current = last ?? newNote();
history.pushState({ v: 'edit' }, '');
render();
