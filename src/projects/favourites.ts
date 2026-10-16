// Favourite projects: just a list of project ids in localStorage under a versioned key.
// No accounts, no personal data. Tolerates missing/corrupted storage and unknown ids.

export const FAV_KEY = 'printpath.favourites.v1';
const MAX = 200;

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** Parse whatever is stored. Accepts {v:1, ids:[...]} (current) or a bare array; anything else -> []. */
export function parseFavourites(raw: string | null | undefined, known?: readonly string[]): string[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  const arr = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { ids?: unknown }).ids) ? (data as { ids: unknown[] }).ids : [];
  const knownSet = known ? new Set(known) : null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v !== 'string' || !v || v.length > 64 || seen.has(v)) continue;
    if (knownSet && !knownSet.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= MAX) break;
  }
  return out;
}

export const serializeFavourites = (ids: readonly string[]) => JSON.stringify({ v: 1, ids });

/** Newest star first. Storage errors (private mode, quota, disabled) fall back to memory only. */
export class Favourites {
  private ids: string[];
  constructor(private storage: StorageLike | null, private known?: readonly string[]) {
    let raw: string | null = null;
    try { raw = storage?.getItem(FAV_KEY) ?? null; } catch { raw = null; }
    this.ids = parseFavourites(raw, known);
    if (raw !== null && raw !== serializeFavourites(this.ids)) this.save(); // rewrite pruned/repaired data
  }
  list(): string[] { return [...this.ids]; }
  has(id: string): boolean { return this.ids.includes(id); }
  get size(): number { return this.ids.length; }
  /** Returns the new state (true = now a favourite). Unknown ids are ignored. */
  toggle(id: string): boolean {
    if (this.known && !this.known.includes(id)) return false;
    if (this.has(id)) this.ids = this.ids.filter((x) => x !== id);
    else this.ids = [id, ...this.ids].slice(0, MAX);
    this.save();
    return this.has(id);
  }
  private save() {
    try { this.storage?.setItem(FAV_KEY, serializeFavourites(this.ids)); } catch { /* memory only */ }
  }
}

/** localStorage if usable, else null (e.g. disabled or sandboxed). */
export function browserStorage(): StorageLike | null {
  try { const s = window.localStorage; const k = '__pp_probe'; s.setItem(k, '1'); s.removeItem(k); return s; } catch { return null; }
}
