/**
 * Your voices, kept in this browser (localStorage), and a voice that came
 * with a link and is waiting to be saved. Everything works without storage
 * (a private window): the library then lives as long as the page.
 */
import { useSyncExternalStore } from 'react';
import { VoiceDesign, cloneVoice, newVoiceId, sanitizeVoice } from '../dsp/voice/design';

const KEY = 'voice-workshop.voices';

interface LibraryState {
  voices: VoiceDesign[];
  /** a voice opened from a #voice= link, not saved yet */
  incoming: VoiceDesign | null;
}

function load(): VoiceDesign[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.map(sanitizeVoice).filter((v): v is VoiceDesign => !!v) : [];
  } catch { return []; }
}

let state: LibraryState = { voices: typeof window === 'undefined' ? [] : load(), incoming: null };
const listeners = new Set<() => void>();

function write(next: Partial<LibraryState>): void {
  // the link has done its job once its voice is saved or dismissed: a reload should not offer it again
  if (state.incoming && next.incoming === null) {
    try {
      if (window.location.hash.startsWith('#voice=')) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch { /* no window, no history */ }
  }
  state = { ...state, ...next };
  if (next.voices) { try { window.localStorage.setItem(KEY, JSON.stringify(state.voices)); } catch { /* storage blocked */ } }
  for (const l of listeners) l();
}

export const library = {
  get: (): LibraryState => state,
  subscribe(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); },
  /** Saves a voice (replacing the one with its id), first in the list; a built-in voice or the reference one is saved as a new voice. */
  save(d: VoiceDesign): VoiceDesign {
    const v = cloneVoice(d);
    if (v.id === 'reference' || v.id.startsWith('builtin-')) v.id = newVoiceId();
    write({ voices: [v, ...state.voices.filter((x) => x.id !== v.id)], incoming: state.incoming?.id === d.id ? null : state.incoming });
    return v;
  },
  remove(id: string): void { write({ voices: state.voices.filter((x) => x.id !== id) }); },
  /** A copy with a new id and the name given. */
  duplicate(d: VoiceDesign, name: string): VoiceDesign {
    const v = cloneVoice(d);
    v.id = newVoiceId();
    v.name = name.slice(0, 60);
    return library.save(v);
  },
  has: (id: string): boolean => state.voices.some((x) => x.id === id),
  setIncoming(d: VoiceDesign | null): void { write({ incoming: d }); },
};

export function useLibrary(): LibraryState {
  return useSyncExternalStore(library.subscribe, library.get, library.get);
}
