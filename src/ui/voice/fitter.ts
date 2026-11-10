/**
 * A recording turned into a voice: the file is decoded here, played back
 * through the voice controller, and fitted in a worker (fit.worker.ts).
 */
import type { VoiceDesign } from '../../dsp/voice/design';
import type { Material, Measure } from '../../dsp/voice/fit';
import type { FitRequest } from './fit.worker';
import { voice } from './voice';

type Bi = { it: string; en: string };

export interface Recording { samples: Float32Array; fs: number; seconds: number; name: string }

export interface FitStatus { stage: string; evaluations: number; budget: number; distance: number }

export interface FitOutcome {
  design: VoiceDesign;
  /** the measures of the recording, of the voice it started from and of the fitted one (none when stopped) */
  measures: Measure[];
  startDistance: number;
  distance: number;
  evaluations: number;
  stopped: boolean;
}

/**
 * Records from the microphone, with the browser's echo cancelling, noise
 * suppression and gain control off (they change a voice's spectrum).
 */
export async function recordMicrophone(): Promise<{ stop: () => Promise<Recording> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const rec = new MediaRecorder(stream);
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  rec.start();
  return {
    stop: () => new Promise<Recording>((res, rej) => {
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        decodeRecording(new File(parts, 'microphone', { type: rec.mimeType })).then(res, rej);
      };
      rec.stop();
    }),
  };
}

/** a sound file (any format the browser reads) as mono samples at the voice's rate, its loudest peak at -6 dBFS */
export async function decodeRecording(file: File): Promise<Recording> {
  const fs = voice.sampleRate;
  const audio = await new OfflineAudioContext(1, 1, fs).decodeAudioData(await file.arrayBuffer());
  const n = audio.length, ch = audio.numberOfChannels, samples = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) samples[i] += d[i] / ch; }
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < n; i++) samples[i] *= 0.5 / peak;
  return { samples, fs: audio.sampleRate, seconds: n / audio.sampleRate, name: file.name.replace(/\.[^.]+$/, '') };
}

export function playRecording(r: Recording, label: Bi): Promise<unknown> {
  return voice.playSamples(r.samples, label);
}

/** Starts fitting a voice to a recording; stop() keeps the best voice found so far. */
export function startFit(r: Recording, material: Material[], sameText: boolean, effort: number, onStatus: (s: FitStatus) => void): { done: Promise<FitOutcome>; stop: () => void } {
  const worker = new Worker(new URL('./fit.worker.ts', import.meta.url), { type: 'module' });
  let last: { design: VoiceDesign; distance: number; startDistance: number; evaluations: number } | null = null;
  let finish: (o: FitOutcome) => void = () => {};
  let fail: (e: Error) => void = () => {};
  const done = new Promise<FitOutcome>((res, rej) => { finish = res; fail = rej; });
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'progress') {
      last = { design: m.design, distance: m.distance, startDistance: last?.startDistance ?? m.distance, evaluations: m.evaluations };
      onStatus({ stage: m.stage, evaluations: m.evaluations, budget: m.budget, distance: m.distance });
    } else if (m.type === 'done') {
      worker.terminate();
      finish({ design: m.design, measures: m.measures, startDistance: m.startDistance, distance: m.distance, evaluations: m.evaluations, stopped: false });
    } else if (m.type === 'error') {
      worker.terminate();
      fail(new Error(m.reason));
    }
  };
  worker.onerror = (e) => { worker.terminate(); fail(new Error(e.message)); };
  const req: FitRequest = { samples: r.samples, fs: r.fs, material, sameText, effort };
  worker.postMessage(req);
  return {
    done,
    stop: () => {
      worker.terminate();
      if (last) finish({ ...last, measures: [], stopped: true });
      else fail(new Error('stopped'));
    },
  };
}
