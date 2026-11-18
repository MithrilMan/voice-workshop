/**
 * Songs on the page: the parts are made in workers, a few at a time, then
 * put together over a room, played through the voice, and saved as WAV.
 */
import { arrange, downmix, type Performance, type Placed, type Stereo, type MixOptions } from '../../dsp/music/mix';
import { encodeWavStereo } from '../../dsp/util/wav';
import type { MusicRequest, MusicReply } from './music.worker';
import type { Melody } from '../../dsp/music/transcribe';
import type { Imitation } from '../../dsp/music/imitate';
import type { VoiceDesign } from '../../dsp/voice/design';
import { voice } from './voice';

export type { MusicRequest };

export interface PartOutcome { performance: Performance | null; warnings: string[]; error?: string; notes?: MusicReply['notes']; syllables?: MusicReply['syllables'] }

/** how many parts are made at once */
const POOL = Math.max(1, Math.min(4, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1));

/**
 * Makes the parts, each in a worker (several at once); `onPart` hears of each
 * one as it is ready. stop() ends them all; the parts not made are null.
 */
export function makeParts(reqs: readonly MusicRequest[], onPart?: (i: number, o: PartOutcome) => void): { done: Promise<PartOutcome[]>; stop: () => void } {
  const out: PartOutcome[] = reqs.map(() => ({ performance: null, warnings: [] }));
  const live = new Set<Worker>();
  let next = 0, left = reqs.length, stopped = false;
  let finish: (o: PartOutcome[]) => void = () => {};
  const done = new Promise<PartOutcome[]>((res) => { finish = res; });
  const end = (i: number, o: PartOutcome) => {
    out[i] = o;
    onPart?.(i, o);
    if (--left === 0) finish(out);
  };
  const start = () => {
    if (stopped || next >= reqs.length) return;
    const i = next++;
    const w = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
    live.add(w);
    const close = () => { w.terminate(); live.delete(w); start(); };
    w.onmessage = (e: MessageEvent<MusicReply>) => {
      const m = e.data;
      close();
      if (m.ok && m.samples) end(i, { performance: { samples: m.samples, fs: m.fs!, beat0: m.beat0!, duration: m.samples.length / m.fs! }, warnings: m.warnings ?? [], notes: m.notes, syllables: m.syllables });
      else end(i, { performance: null, warnings: [], error: m.reason ?? 'failed' });
    };
    w.onerror = (e) => { close(); end(i, { performance: null, warnings: [], error: e.message || 'failed' }); };
    w.postMessage(reqs[i]);
  };
  if (!reqs.length) finish(out);
  for (let k = 0; k < POOL; k++) start();
  return {
    done,
    stop: () => {
      stopped = true;
      for (const w of live) w.terminate();
      live.clear();
      finish(out);
    },
  };
}

/** the rate the parts are made at: the voice's own, so that they play as they are */
export const musicRate = (): number => voice.sampleRate;

export function arrangeParts(parts: readonly Placed[], opts: MixOptions & { tempo?: number }): Stereo {
  return arrange(parts, opts);
}

/** Plays a mix (both sides as one: the voice has one channel). */
export function playMix(s: Stereo, label: string): Promise<unknown> {
  return voice.playSamples(downmix(s), label);
}

export function stopPlaying(): void { voice.stop(); }

/** wakes the sound on a click, before the parts are made (a browser lets it start only on a gesture) */
export function wakeSound(): void { void voice.ensureAudio(); }

/** The melody of a recording (see melodyOf), found in a worker. */
export function findMelody(r: { samples: Float32Array; fs: number }): Promise<Melody> {
  return new Promise((res, rej) => {
    const w = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<MusicReply>) => { w.terminate(); if (e.data.ok && e.data.melody) res(e.data.melody); else rej(new Error(e.data.reason ?? 'failed')); };
    w.onerror = (e) => { w.terminate(); rej(new Error(e.message || 'failed')); };
    w.postMessage({ kind: 'melody', samples: r.samples, fs: r.fs });
  });
}

/**
 * The sound of a voice's mouth nearest a recording (see imitate), found in
 * a worker; `onProgress` hears how far the search is. stop() ends it.
 */
export function imitateSound(voice: VoiceDesign, r: { samples: Float32Array; fs: number }, onProgress: (done: number, total: number, best: string) => void): { done: Promise<Imitation>; stop: () => void } {
  const w = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
  let fail: (e: Error) => void = () => {};
  const done = new Promise<Imitation>((res, rej) => {
    fail = rej;
    w.onmessage = (e: MessageEvent<MusicReply>) => {
      const m = e.data;
      if (m.ok && m.progress) { onProgress(m.progress.done, m.progress.total, m.progress.best); return; }
      w.terminate();
      if (m.ok && m.imitation) res(m.imitation); else rej(new Error(m.reason ?? 'failed'));
    };
    w.onerror = (e) => { w.terminate(); rej(new Error(e.message || 'failed')); };
  });
  w.postMessage({ kind: 'imitate', voice, samples: r.samples, fs: r.fs });
  return { done, stop: () => { w.terminate(); fail(new Error('stopped')); } };
}

export { recordMicrophone, decodeRecording, playRecording, type Recording } from './fitter';

/** Saves a mix as a stereo WAV file. */
export function saveWav(s: Stereo, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([encodeWavStereo(s.left, s.right, s.fs).buffer as ArrayBuffer], { type: 'audio/wav' }));
  a.download = `${name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'song'}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
