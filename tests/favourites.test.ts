import { describe, it, expect } from 'vitest';
import { Favourites, parseFavourites, serializeFavourites, FAV_KEY, type StorageLike } from '../src/projects/favourites';
import { filterProjects, CATALOG, PROJECT_IDS } from '../src/projects/catalog';

class Mem implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}
const known = ['a', 'b', 'c', 'd'];

describe('favourites', () => {
  it('toggle on/off and has()', () => {
    const f = new Favourites(new Mem(), known);
    expect(f.toggle('a')).toBe(true);
    expect(f.has('a')).toBe(true);
    expect(f.toggle('a')).toBe(false);
    expect(f.has('a')).toBe(false);
    expect(f.size).toBe(0);
  });

  it('persists across instances (round-trip under the versioned key)', () => {
    const s = new Mem();
    const f = new Favourites(s, known);
    f.toggle('b'); f.toggle('c');
    expect(JSON.parse(s.getItem(FAV_KEY)!)).toEqual({ v: 1, ids: ['c', 'b'] });
    expect(new Favourites(s, known).list()).toEqual(['c', 'b']);
  });

  it('orders newest star first; re-starring moves to the front', () => {
    const f = new Favourites(new Mem(), known);
    f.toggle('a'); f.toggle('b'); f.toggle('c');
    expect(f.list()).toEqual(['c', 'b', 'a']);
    f.toggle('a'); f.toggle('a');
    expect(f.list()).toEqual(['a', 'c', 'b']);
  });

  it('handles corrupted, wrong-shape and missing storage', () => {
    for (const raw of ['{not json', '42', 'null', '"a"', '{"v":1,"ids":"a"}', '{}', '[1,2,{"x":1}]', '']) {
      expect(parseFavourites(raw, known), raw).toEqual([]);
      const s = new Mem(); s.setItem(FAV_KEY, raw);
      const f = new Favourites(s, known);
      expect(f.list(), raw).toEqual([]);
      f.toggle('a');
      expect(new Favourites(s, known).list()).toEqual(['a']); // repaired on write
    }
    expect(new Favourites(null, known).toggle('a')).toBe(true); // no storage at all: memory only
  });

  it('survives storage that throws (private mode / quota)', () => {
    const bad: StorageLike = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); } };
    const f = new Favourites(bad, known);
    expect(f.list()).toEqual([]);
    expect(f.toggle('b')).toBe(true);
    expect(f.list()).toEqual(['b']);
  });

  it('prunes unknown ids and duplicates, and rewrites the cleaned list', () => {
    const s = new Mem();
    s.setItem(FAV_KEY, JSON.stringify({ v: 1, ids: ['b', 'gone', 'b', 'a', 7, 'x'.repeat(100)] }));
    const f = new Favourites(s, known);
    expect(f.list()).toEqual(['b', 'a']);
    expect(s.getItem(FAV_KEY)).toBe(serializeFavourites(['b', 'a']));
    expect(f.toggle('gone')).toBe(false);
    expect(f.list()).toEqual(['b', 'a']);
    expect(parseFavourites('["a","b"]', known)).toEqual(['a', 'b']); // legacy bare array accepted
  });

  it('works with the real catalog: favourites filter keeps star order and respects grade', () => {
    const f = new Favourites(new Mem(), PROJECT_IDS);
    f.toggle('gear-set'); f.toggle('cookie-cutter'); f.toggle('name-keychain');
    expect(filterProjects(CATALOG, { favourites: f.list() }).map((p) => p.id)).toEqual(['name-keychain', 'cookie-cutter', 'gear-set']);
    expect(filterProjects(CATALOG, { favourites: f.list(), grade: 'K-2' }).map((p) => p.id)).toEqual(['name-keychain', 'cookie-cutter']);
    expect(filterProjects(CATALOG, { grade: '9-12', subject: 'Geography' }).map((p) => p.id)).toEqual(['topo-map']);
  });
});
