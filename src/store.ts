/**
 * Note storage.
 *
 * Before v2 everything lived in one localStorage key ("satto-memo:v1").
 * localStorage is only ~5 MB and is shared by every app on
 * gutsmcd-cmd.github.io (same origin), and write errors were swallowed.
 *
 * Now notes live in IndexedDB (database "satto-memo", one record per note),
 * which has a far larger quota. On load, any legacy localStorage data is
 * merged in (newer edit wins), verified by reading it back, and only then
 * removed from localStorage. We also ask for persistent storage so the
 * browser does not evict notes under storage pressure.
 */

export interface Note { id: string; text: string; pinned: boolean; created: number; updated: number }
export interface Settings { lastId: string | null; lang: 'ja' | 'en'; startup: 'last' | 'new' }
export interface Loaded extends Settings { notes: Note[]; backend: 'indexeddb' | 'localstorage'; migrated: number }

export const LEGACY_KEY = 'satto-memo:v1';
const FALLBACK_KEY = 'satto-memo:v1'; // used only if IndexedDB is unavailable
const DB_NAME = 'satto-memo';
const DB_VERSION = 1;
const NOTES = 'notes';
const META = 'meta';

const DEFAULTS: Settings = { lastId: null, lang: 'ja', startup: 'last' };

let db: IDBDatabase | null = null;
let backend: 'indexeddb' | 'localstorage' = 'indexeddb';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction error'));
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(NOTES)) d.createObjectStore(NOTES, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => d.close();
      resolve(d);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function cleanNote(raw: unknown): Note | null {
  const r = raw as Partial<Note> | null;
  if (!r || typeof r.text !== 'string' || typeof r.id !== 'string') return null;
  return {
    id: r.id,
    text: r.text,
    pinned: !!r.pinned,
    created: Number(r.created) || Date.now(),
    updated: Number(r.updated) || Date.now(),
  };
}

function readLegacy(): { ok: true; data: (Partial<Settings> & { notes?: unknown[] }) | null } | { ok: false } {
  let raw: string | null;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch { return { ok: true, data: null }; }
  if (!raw) return { ok: true, data: null };
  try { return { ok: true, data: JSON.parse(raw) }; } catch { return { ok: false }; }
}

/** Snapshot of what is known to be on disk, to write only changed notes. */
const savedNotes = new Map<string, Note>();
let savedSettings = '';

/** Move legacy localStorage notes into IndexedDB. Never deletes before a verified write. */
async function migrate(d: IDBDatabase): Promise<number> {
  const legacy = readLegacy();
  if (!legacy.ok) {
    console.warn('[satto-memo] legacy localStorage data is not valid JSON; left untouched');
    return 0;
  }
  if (!legacy.data) return 0;
  const incoming = (Array.isArray(legacy.data.notes) ? legacy.data.notes : []).map(cleanNote).filter((n): n is Note => !!n);

  const tx = d.transaction([NOTES, META], 'readwrite');
  const ns = tx.objectStore(NOTES);
  const ms = tx.objectStore(META);
  const finished = done(tx);
  let written = 0;
  for (const n of incoming) {
    const ex = (await req(ns.get(n.id))) as Note | undefined;
    if (!ex || n.updated >= ex.updated) { ns.put(n); written++; }
  }
  const settings = (await req(ms.get('settings'))) as Settings | undefined;
  if (!settings) {
    ms.put({
      lastId: typeof legacy.data.lastId === 'string' ? legacy.data.lastId : null,
      lang: legacy.data.lang === 'en' ? 'en' : 'ja',
      startup: legacy.data.startup === 'new' ? 'new' : 'last',
    } satisfies Settings, 'settings');
  }
  ms.put({ from: 'localStorage', at: Date.now(), count: incoming.length }, 'migration');
  await finished;

  // Verify every legacy note is now in IndexedDB (same or newer) before removing the legacy copy.
  const vtx = d.transaction(NOTES, 'readonly');
  const vs = vtx.objectStore(NOTES);
  for (const n of incoming) {
    const got = (await req(vs.get(n.id))) as Note | undefined;
    if (!got || (got.updated < n.updated) || (got.updated === n.updated && got.text !== n.text)) {
      throw new Error(`migration verify failed for ${n.id}`);
    }
  }
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
  return written;
}

export async function load(): Promise<Loaded> {
  try {
    db = await openDB();
    backend = 'indexeddb';
  } catch (e) {
    console.warn('[satto-memo] IndexedDB unavailable, using localStorage', e);
    db = null;
    backend = 'localstorage';
  }

  if (!db) {
    const legacy = readLegacy();
    const data = legacy.ok ? legacy.data ?? {} : {};
    const notes = (Array.isArray(data.notes) ? data.notes : []).map(cleanNote).filter((n): n is Note => !!n);
    return { ...DEFAULTS, ...pickSettings(data), notes, backend, migrated: 0 };
  }

  let migrated = 0;
  let legacyFallback: Note[] = [];
  try {
    migrated = await migrate(db);
  } catch (e) {
    console.error('[satto-memo] migration failed; localStorage copy kept', e);
    const legacy = readLegacy();
    if (legacy.ok && legacy.data && Array.isArray(legacy.data.notes)) {
      legacyFallback = legacy.data.notes.map(cleanNote).filter((n): n is Note => !!n);
    }
  }

  const tx = db.transaction([NOTES, META], 'readonly');
  const notes = ((await req(tx.objectStore(NOTES).getAll())) as unknown[]).map(cleanNote).filter((n): n is Note => !!n);
  const settings = (await req(tx.objectStore(META).get('settings'))) as Partial<Settings> | undefined;
  savedNotes.clear();
  for (const n of notes) savedNotes.set(n.id, { ...n });
  const s = { ...DEFAULTS, ...pickSettings(settings ?? {}) };
  savedSettings = JSON.stringify(s);
  // Migration failed: still show the legacy notes (newer edit wins). They are not in
  // savedNotes, so the next successful save writes them to IndexedDB.
  for (const n of legacyFallback) {
    const i = notes.findIndex((x) => x.id === n.id);
    if (i < 0) notes.push(n);
    else if (n.updated > notes[i]!.updated) notes[i] = n;
  }
  return { ...s, notes, backend, migrated };
}

function pickSettings(d: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (typeof d.lastId === 'string' || d.lastId === null) out.lastId = d.lastId;
  if (d.lang === 'ja' || d.lang === 'en') out.lang = d.lang;
  if (d.startup === 'last' || d.startup === 'new') out.startup = d.startup;
  return out;
}

async function writeIDB(notes: Note[], settings: Settings): Promise<void> {
  const d = db!;
  const tx = d.transaction([NOTES, META], 'readwrite');
  const finished = done(tx);
  finished.catch(() => undefined); // handled below; avoid unhandled rejection if we abort early
  const ns = tx.objectStore(NOTES);
  const live = new Set<string>();
  const wrote: Note[] = [];
  const removed: string[] = [];
  const sj = JSON.stringify(settings);
  try {
    for (const n of notes) {
      live.add(n.id);
      const prev = savedNotes.get(n.id);
      if (!prev || prev.text !== n.text || prev.pinned !== n.pinned || prev.updated !== n.updated || prev.created !== n.created) {
        const copy = { ...n };
        ns.put(copy);
        wrote.push(copy);
      }
    }
    for (const id of savedNotes.keys()) if (!live.has(id)) { ns.delete(id); removed.push(id); }
    if (sj !== savedSettings) tx.objectStore(META).put(settings, 'settings');
  } catch (e) {
    try { tx.abort(); } catch { /* already finished */ }
    throw e;
  }
  await finished;
  for (const n of wrote) savedNotes.set(n.id, n);
  for (const id of removed) savedNotes.delete(id);
  savedSettings = sj;
}

function writeLS(notes: Note[], settings: Settings): void {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify({ ...settings, notes }));
}

let chain: Promise<unknown> = Promise.resolve();
let queued: { notes: Note[]; settings: Settings } | null = null;

/**
 * Persist the whole state. Calls are serialised and coalesced (only the
 * newest pending state is written). Resolves on success; rejects with
 * the underlying error (e.g. QuotaExceededError) on failure.
 */
export function persist(notes: Note[], settings: Settings): Promise<void> {
  const first = queued === null;
  queued = { notes: notes.map((n) => ({ ...n })), settings: { ...settings } };
  if (!first) return chain as Promise<void>;
  const run = chain.catch(() => undefined).then(async () => {
    const job = queued!;
    queued = null;
    if (backend === 'indexeddb' && db) await writeIDB(job.notes, job.settings);
    else writeLS(job.notes, job.settings);
  });
  chain = run;
  return run;
}

export function isQuotaError(e: unknown): boolean {
  const n = (e as { name?: string } | null)?.name ?? '';
  return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(String((e as Error)?.message ?? ''));
}

/** Ask the browser not to evict our storage. Returns the resulting state. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export function currentBackend(): 'indexeddb' | 'localstorage' { return backend; }
