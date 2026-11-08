import { describe, it, expect, beforeAll, vi } from 'vitest';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { cloneVoice } from '../src/dsp/voice/design';

/** a browser window with a storage that can be read back, and the address of a page opened with a voice link */
const store = new Map<string, string>();
const replaced: string[] = [];
const fakeWindow = {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  location: { hash: '#voice=v1.abc', pathname: '/', search: '?mode=voices' },
  history: { replaceState: (_s: unknown, _t: string, url: string) => { replaced.push(url); fakeWindow.location.hash = ''; } },
};

let library: typeof import('../src/ui/library').library;

beforeAll(async () => {
  store.set('voice-workshop.voices', JSON.stringify([{ ...cloneVoice(), id: 'kept', name: 'Kept' }, { format: 'something else' }, 42]));
  vi.stubGlobal('window', fakeWindow);
  ({ library } = await import('../src/ui/library'));
});

describe('the library of voices', () => {
  it('reads the voices kept in the browser and drops what is not a voice', () => {
    expect(library.get().voices.map((v) => v.name)).toEqual(['Kept']);
  });

  it('saves a starting voice as a new voice of yours, first in the list, and keeps it in the storage', () => {
    let calls = 0;
    const off = library.subscribe(() => calls++);
    const s = library.save(builtinVoice('deep')!.design);
    off();
    expect(calls).toBe(1);
    expect(s.id).not.toBe('builtin-deep');
    expect(library.get().voices.map((v) => v.id)).toEqual([s.id, 'kept']);
    expect(JSON.parse(store.get('voice-workshop.voices')!)[0].id).toBe(s.id);
    // saved again: replaced in place and moved first, not added twice
    library.save({ ...s, name: 'Mine' });
    library.save(library.get().voices.find((v) => v.id === 'kept')!);
    expect(library.get().voices.map((v) => v.name)).toEqual(['Kept', 'Mine']);
  });

  it('duplicates under a new name and removes', () => {
    const kept = library.get().voices.find((v) => v.id === 'kept')!;
    const copy = library.duplicate(kept, 'Kept (2)');
    expect(copy.id).not.toBe('kept');
    expect(library.has(copy.id)).toBe(true);
    library.remove(copy.id);
    expect(library.has(copy.id)).toBe(false);
  });

  it('a voice received with a link waits until it is saved, then the link leaves the address', () => {
    const v = { ...cloneVoice(builtinVoice('child')!.design), id: 'from-a-friend', name: 'Friend' };
    library.setIncoming(v);
    expect(library.get().incoming?.id).toBe('from-a-friend');
    expect(replaced).toEqual([]);
    library.save(v);
    expect(library.get().incoming).toBeNull();
    expect(library.has('from-a-friend')).toBe(true);
    expect(replaced).toEqual(['/?mode=voices']);
  });
});
