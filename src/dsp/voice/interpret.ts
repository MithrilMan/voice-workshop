import type { Score, ScoreFrame } from '../engine/params';
import { phonemeFor } from '../speech/derive';
import { DeliveryModel, DeliveryNet, Heard } from '../speech/deliveryNet';
import type { Phone } from '../speech/g2p';
import { buildScore, ScoreOptions } from '../speech/sequencer';
import { VOICE_V1_BASE, speechOptions } from './design';

/** the points of a sound the delivery is read and given at */
const PTS = [0.2, 0.5, 0.8] as const;
/** a pause is made after a sound where the speaker's would last this long or more (s) */
const PAUSE_FROM = 0.08;

// ------------------------------------------------------------- the models

const MODELS = new Map<string, DeliveryNet>();
let loading: Promise<void> | null = null;

/** Makes a learnt delivery model the one for its languages (null: forget them all). */
export function setDeliveryModel(model: DeliveryModel | null): void {
  if (!model) { MODELS.clear(); return; }
  const net = new DeliveryNet(model);
  for (const l of model.languages) MODELS.set(l, net);
}

/** The learnt delivery model of a language, if one is loaded. */
export const deliveryModel = (lang: string): DeliveryNet | null => MODELS.get(lang) ?? null;

/** Loads the delivery model in the browser (once; it comes with the site). */
export function loadDeliveryModel(url = 'delivery/it.json'): Promise<void> {
  if (MODELS.size) return Promise.resolve();
  loading ??= (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`delivery model: HTTP ${res.status}`);
    setDeliveryModel(await res.json() as DeliveryModel);
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

// ------------------------------------------------------------- reading

function at(frames: ScoreFrame[], t: number, get: (f: ScoreFrame) => number): number {
  let lo = 0, hi = frames.length - 1;
  if (t <= frames[0].t) return get(frames[0]);
  if (t >= frames[hi].t) return get(frames[hi]);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (frames[m].t <= t) lo = m; else hi = m; }
  const a = frames[lo], b = frames[hi], u = (t - a.t) / Math.max(1e-9, b.t - a.t);
  return get(a) + (get(b) - get(a)) * u;
}

/** the sounds of a score (no pauses), and the pause after each */
function sounds(sc: Score): { t0: number; t1: number; pause: number }[] {
  const out: { t0: number; t1: number; pause: number }[] = [];
  for (const p of sc.phones) {
    if (p.ipa === '_') { if (out.length) out[out.length - 1].pause += p.t1 - p.t0; continue; }
    out.push({ t0: p.t0, t1: p.t1, pause: 0 });
  }
  return out;
}

/**
 * What a delivery model reads of a sentence: its sounds as our default rules say them (the reference voice's way of
 * speaking, whatever the voice that will say it), with the phones they come from. Null if they do not line up.
 */
export function heardOf(phones: Phone[], lang: string): { heard: Heard[]; kept: number[] } | null {
  const kept = phones.map((p, i) => (phonemeFor(p.ipa) ? i : -1)).filter((i) => i >= 0);
  const sc = buildScore(phones, speechOptions(VOICE_V1_BASE, lang));
  const own = sounds(sc);
  if (own.length !== kept.length) return null;
  const f0 = VOICE_V1_BASE.speaking.f0;
  const heard = kept.map((i, j): Heard => {
    const o = own[j];
    const st = PTS.map((q) => 12 * Math.log2(Math.max(40, at(sc.frames, o.t0 + q * (o.t1 - o.t0), (f) => f.f0)) / f0)) as [number, number, number];
    return { phone: phones[i], dur: o.t1 - o.t0, pause: o.pause, st };
  });
  return { heard, kept };
}

// ------------------------------------------------------------- saying

/**
 * A sentence said with a learnt delivery: the timing, the pauses, the melody
 * and the swell of the loudness of a recorded speaker (`speaker`, one the
 * model learnt), with everything else of the voice's speech options (its
 * habits, its head, its seed). The pitch is put on the voice's own (its usual
 * f0 is the speaker's median) and the pace divided by the voice's rate. The
 * gestures are planned whole for the new timing, refined three times until
 * every sound lasts what the model says. `range` widens (>1) or narrows the
 * melody around the usual pitch. Null where the sounds do not line up with the
 * model's.
 */
export function interpretScore(phones: Phone[], opts: ScoreOptions, net: DeliveryNet, speaker: string, range = 1): Score | null {
  const lang = opts.lang ?? 'it';
  const read = heardOf(phones, lang);
  if (!read) return null;
  const { heard, kept } = read;
  const said = net.say(heard, speaker);
  const K = kept.length, rate = Math.max(0.3, opts.rate ?? 1);
  // pauses where the speaker makes them
  const ours = phones.map((p) => ({ ...p }));
  for (let j = 0; j < K - 1; j++) {
    const i = kept[j], p = ours[i];
    if (said[j].pause >= PAUSE_FROM) ours[i] = { ...p, pause: p.pause ?? 'short', wordEnd: true };
    else if (p.pause) { const q = { ...p }; delete q.pause; ours[i] = q; }
  }
  const pauses: number[] = [];
  for (let j = 0; j < K - 1; j++) if (ours[kept[j]].pause) pauses.push(Math.max(0.01, said[j].pause / rate));
  const want = said.map((s) => s.dur / rate);
  const stretch = want.map(() => 1);
  const plan = () => buildScore(ours, { ...opts, timing: { stretch: [...stretch], pauses } });
  let sc = plan();
  for (let round = 0; round < 3; round++) {
    const now = sounds(sc);
    if (now.length !== K) return null;
    now.forEach((p, j) => { if (p.t1 > p.t0) stretch[j] *= want[j] / (p.t1 - p.t0); });
    sc = plan();
  }
  // the melody and the swell: the points of every sound, joined by straight lines (the pitch in semitones)
  const now = sounds(sc), pts: { t: number; st: number; sw: number }[] = [];
  now.forEach((p, j) => PTS.forEach((q, n) => pts.push({ t: p.t0 + q * (p.t1 - p.t0), st: range * said[j].st[n], sw: said[j].swell[n] })));
  const curve = (t: number, k: 'st' | 'sw') => {
    if (t <= pts[0].t) return pts[0][k];
    for (let n = 1; n < pts.length; n++) if (t <= pts[n].t) { const v = (t - pts[n - 1].t) / Math.max(1e-9, pts[n].t - pts[n - 1].t); return pts[n - 1][k] + (pts[n][k] - pts[n - 1][k]) * v; }
    return pts[pts.length - 1][k];
  };
  const f0 = opts.f0 ?? VOICE_V1_BASE.speaking.f0;
  return { ...sc, frames: sc.frames.map((f) => ({ ...f, f0: f0 * 2 ** (curve(f.t, 'st') / 12), ps: f.ps > 0 ? f.ps * Math.exp(curve(f.t, 'sw')) : f.ps })) };
}

/** Whether a sentence in this language, by a voice with this way of saying, is said with a learnt delivery. */
export function learntFor(delivery: string, lang: string): boolean {
  const net = delivery !== 'rules' ? deliveryModel(lang) : null;
  return !!net && net.model.speakers.includes(delivery);
}

/**
 * The score of a sentence by a voice's speech options, with the learnt delivery it names (`way.delivery`: 'rules', or
 * a speaker of a loaded model) where there is one for the language; the voice's own rules otherwise, and always for a
 * sentence given its timing (a copy of a recording).
 */
export function planSpeech(phones: Phone[], opts: ScoreOptions, way: { delivery: string; range?: number }): Score {
  const lang = opts.lang ?? '';
  const learnt = !opts.timing && learntFor(way.delivery, lang);
  return (learnt ? interpretScore(phones, opts, deliveryModel(lang)!, way.delivery, way.range ?? 1) : null) ?? buildScore(phones, opts);
}
