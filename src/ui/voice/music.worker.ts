/**
 * A part of a song made away from the page: a voice sings its notes (the
 * words already turned into phones on the page, where the dictionaries
 * are), or beatboxes its pattern. The samples come back as they are.
 */
import { sing, beatbox, type Song, type BeatTrack, type BeatOptions, type SungNote, type SungSyllable } from '../../library';
import type { VoiceDesign } from '../../dsp/voice/design';

export type MusicRequest =
  | { kind: 'sing'; voice: VoiceDesign; song: Song; fs: number; seed?: number }
  | { kind: 'beat'; voice: VoiceDesign; tracks: BeatTrack[]; opts: BeatOptions };

export interface MusicReply {
  ok: boolean;
  reason?: string;
  samples?: Float32Array;
  fs?: number;
  beat0?: number;
  warnings?: string[];
  /** a song's notes and syllables as sung */
  notes?: SungNote[];
  syllables?: SungSyllable[];
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<MusicRequest>) => void) | null; postMessage(m: unknown, transfer?: Transferable[]): void };

ctx.onmessage = (e) => {
  const r = e.data;
  try {
    let reply: MusicReply;
    if (r.kind === 'sing') {
      const p = sing(r.voice, r.song, { fs: r.fs, seed: r.seed });
      reply = { ok: true, samples: p.samples, fs: p.fs, beat0: p.beat0, warnings: p.warnings, notes: p.notes, syllables: p.syllables };
    } else {
      const p = beatbox(r.voice, r.tracks, r.opts);
      reply = { ok: true, samples: p.samples, fs: p.fs, beat0: p.beat0, warnings: [] };
    }
    ctx.postMessage(reply, [reply.samples!.buffer]);
  } catch (err) {
    ctx.postMessage({ ok: false, reason: err instanceof Error ? err.message : String(err) } satisfies MusicReply);
  }
};
