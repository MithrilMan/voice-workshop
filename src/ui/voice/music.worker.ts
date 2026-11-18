/**
 * A part of a song made away from the page: a voice sings its notes (the
 * words already turned into phones on the page, where the dictionaries
 * are), or beatboxes its pattern. The samples come back as they are. Also
 * the melody of a recording, found here.
 */
import { sing, singing, beatbox, beatLoop, melodyOf, imitate, type Song, type BeatTrack, type BeatOptions, type BeatLoopOptions, type BeatTakes, type Motion, type Air, type SungNote, type SungSyllable, type Melody, type Imitation } from '../../library';
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
  /** the melody found in a recording */
  melody?: Melody;
  /** the sound of the mouth nearest a recording, and how far the search is */
  imitation?: Imitation;
  progress?: { done: number; total: number; best: string };
}

export type FindRequest =
  | { kind: 'melody'; samples: Float32Array; fs: number }
  | { kind: 'imitate'; voice: VoiceDesign; samples: Float32Array; fs: number };

/** a beat as a loop to play live (see beatLoop); `id` comes back with the reply */
export interface LoopRequest { kind: 'loop'; id: number; voice: VoiceDesign; tracks: BeatTrack[]; opts: BeatLoopOptions }

export interface LoopReply { id: number; ok: boolean; reason?: string; samples?: Float32Array; fs?: number; passes?: number; steps?: number; mouths?: Motion[]; trackMouths?: number[] }

/** a part made in pieces, to be heard as it is made: a song sung piece by piece (see singing), a beat made whole (it takes little) */
export interface StreamRequest { kind: 'stream'; part: MusicRequest }

export type StreamReply =
  | { type: 'info'; fs: number; beat0: number; duration: number; warnings: string[]; notes?: SungNote[]; syllables?: SungSyllable[]; motion?: Omit<Motion, 'frames' | 'air'> }
  // with a song, the frames of its mouth made with the piece
  | { type: 'piece'; samples: Float32Array; frames?: Motion['frames']; air?: (Air | null)[] }
  | { type: 'end' }
  | { type: 'error'; reason: string };

// the sounds already said for loops, kept while the worker lives: by the voice and the rate they were said with
let takes: { key: string; store: BeatTakes } = { key: '', store: new Map() };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<MusicRequest | FindRequest | LoopRequest | StreamRequest>) => void) | null; postMessage(m: unknown, transfer?: Transferable[]): void };

ctx.onmessage = (e) => {
  const r = e.data;
  if (r.kind === 'stream') {
    try {
      const q = r.part;
      if (q.kind === 'sing') {
        const s = singing(q.voice, q.song, { fs: q.fs, seed: q.seed });
        const { hop, start, head } = s.motion;
        ctx.postMessage({ type: 'info', fs: s.fs, beat0: s.beat0, duration: s.duration, warnings: s.warnings, notes: s.notes, syllables: s.syllables, motion: { hop, start, head } } satisfies StreamReply);
        let n = 0;
        for (let p = s.next(0.1); p; p = s.next(0.1)) {
          const frames = s.motion.frames.slice(n), air = s.motion.air!.slice(n);
          n = s.motion.frames.length;
          ctx.postMessage({ type: 'piece', samples: p, frames, air } satisfies StreamReply, [p.buffer]);
        }
      } else {
        const p = beatbox(q.voice, q.tracks, q.opts);
        ctx.postMessage({ type: 'info', fs: p.fs, beat0: p.beat0, duration: p.duration, warnings: [] } satisfies StreamReply);
        ctx.postMessage({ type: 'piece', samples: p.samples } satisfies StreamReply, [p.samples.buffer]);
      }
      ctx.postMessage({ type: 'end' } satisfies StreamReply);
    } catch (err) {
      ctx.postMessage({ type: 'error', reason: err instanceof Error ? err.message : String(err) } satisfies StreamReply);
    }
    return;
  }
  if (r.kind === 'loop') {
    try {
      const key = `${r.opts.fs ?? 48000}|${JSON.stringify(r.voice)}`;
      if (takes.key !== key) takes = { key, store: new Map() };
      const l = beatLoop(r.voice, r.tracks, r.opts, takes.store);
      ctx.postMessage({ id: r.id, ok: true, samples: l.samples, fs: l.fs, passes: l.passes, steps: l.steps, mouths: l.mouths, trackMouths: l.trackMouths } satisfies LoopReply, [l.samples.buffer]);
    } catch (err) {
      ctx.postMessage({ id: r.id, ok: false, reason: err instanceof Error ? err.message : String(err) } satisfies LoopReply);
    }
    return;
  }
  try {
    let reply: MusicReply;
    if (r.kind === 'melody') {
      ctx.postMessage({ ok: true, melody: melodyOf(r.samples, r.fs) } satisfies MusicReply);
      return;
    }
    if (r.kind === 'imitate') {
      let last = 0;
      const imitation = imitate(r.voice, r.samples, r.fs, {
        onProgress: (done, total, best) => { const now = Date.now(); if (now - last > 150) { last = now; ctx.postMessage({ ok: true, progress: { done, total, best } } satisfies MusicReply); } },
      });
      ctx.postMessage({ ok: true, imitation } satisfies MusicReply);
      return;
    }
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
