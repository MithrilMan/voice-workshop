/**
 * How a voice says its sentences, measured through their text: the pitch,
 * the length and the level of each sound of a sentence, read off a
 * recording at the times of its sounds or off a plan of this simulator, and
 * from them a few figures of the speaker's delivery (how high the accented
 * vowels stand over their neighbours, how the pitch runs down a phrase and
 * where it ends before a full stop, a question mark and a comma, how much
 * longer a stressed and a last vowel are, how long the pauses). The same
 * figures are taken from a voice of the simulator saying the same
 * sentences by its rules, and the fields of its melody and rhythm are moved
 * until the two agree (`fitDelivery`): what the recording does on each
 * sentence is not copied, the habits behind it are.
 *
 * The plan is enough to measure a voice of the simulator (no sound has to
 * be made), so a fit takes seconds. What the figures do not hold stays out:
 * which words a speaker leans on, and anything that is not a field yet.
 */
import type { Phone } from '../speech/g2p';
import type { Score } from '../engine/params';
import { phonemeFor } from '../speech/derive';
import { Analysis, centre } from './copy';
import { VoiceDesign, cloneVoice, withField, fieldValue, VOICE_FIELDS } from './design';

/** how a phrase ends: before a comma, a full stop, a question to answer yes or no, a question with a question word */
export type Edge = 'comma' | 'stop' | 'question' | 'wh';

/** one sound of a sentence, as it was said */
export interface Sound {
  ipa: string;
  /** the nucleus of a syllable */
  vowel: boolean;
  /** carries the stress of its word */
  stress: boolean;
  /** in a content word (the planner puts its accents on the stressed vowels of these) */
  content: boolean;
  /** which word of the sentence it is in */
  word: number;
  /** which phrase of the sentence it is in, and how that phrase ends */
  phrase: number;
  edge: Edge;
  /** the last vowel of its phrase */
  last: boolean;
  t0: number;
  t1: number;
  /** semitones above 1 Hz, NaN where no pitch was found */
  pitch: number;
  /** dB, NaN where it was not measured (a plan has no level) */
  level: number;
  /** the silence after it, s */
  pause: number;
}

export type Saying = Sound[];

/** where the pitch and the level of a stretch of time are read */
export interface Track {
  pitch(t0: number, t1: number): number;
  level(t0: number, t1: number): number;
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : NaN; };
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), i = q * (s.length - 1), k = Math.floor(i);
  return s[k] + (i - k) * ((s[Math.min(s.length - 1, k + 1)]) - s[k]);
};
const st = (hz: number): number => 12 * Math.log2(hz);

/** a recording (or a saying of ours) as it sounds: `shift` is how much later than the given times its sounds are heard */
export function heard(a: Analysis, shift = 0): Track {
  const inside = (t0: number, t1: number): number[] => {
    const ks: number[] = [];
    for (let k = 0; k < a.level.length; k++) { const t = centre(k) - shift; if (t >= t0 && t <= t1) ks.push(k); }
    return ks;
  };
  return {
    pitch: (t0, t1) => {
      const f = inside(t0, t1).map((k) => a.f0[k]).filter((v) => v > 0);
      return f.length >= (t1 - t0 >= 0.05 ? 2 : 1) ? st(median(f)) : NaN;
    },
    level: (t0, t1) => { const l = inside(t0, t1).map((k) => a.level[k]); return l.length ? median(l) : NaN; },
  };
}

/** a plan of the simulator: the pitch it asks of the folds */
export function planned(sc: Score): Track {
  return {
    pitch: (t0, t1) => {
      const f = sc.frames.filter((fr) => fr.t >= t0 && fr.t <= t1 && fr.f0 > 0).map((fr) => fr.f0);
      return f.length ? st(median(f)) : NaN;
    },
    level: () => NaN,
  };
}

/**
 * The sounds of a sentence, from its phones (which mark the stresses, the
 * words and the punctuation), the time of each sound (one entry for each
 * phone that is a sound, in order; '_' entries are pauses and are skipped)
 * and a track.
 */
export function sayingOf(phones: Phone[], times: { ipa: string; t0: number; t1: number }[], track: Track): Saying {
  const kept = phones.filter((p) => phonemeFor(p.ipa));
  const at = times.filter((p) => p.ipa !== '_');
  if (at.length !== kept.length) throw new Error(`sayingOf: ${kept.length} sounds, ${at.length} times`);
  const out: Saying = [];
  let phrase = 0, from = 0, word = -1;
  const close = (to: number, p: Phone | undefined) => {
    const edge: Edge = p?.question ? (p.whQuestion ? 'wh' : 'question') : p?.pause === 'short' ? 'comma' : 'stop';
    let lastV = -1;
    for (let j = from; j < to; j++) { out[j].edge = edge; if (out[j].vowel) lastV = j; }
    if (lastV >= 0) out[lastV].last = true;
    phrase++; from = to;
  };
  kept.forEach((p, k) => {
    const ph = phonemeFor(p.ipa)!, t = at[k];
    const vowel = (ph.manner === 'vowel' && !ph.nonSyllabic) || !!ph.syllabic;
    const gap = k + 1 < at.length ? at[k + 1].t0 - t.t1 : 0;
    if (p.wordStart || k === 0) word++;
    out.push({
      ipa: p.ipa, vowel, stress: !!p.stress, content: !p.func, word, phrase, edge: 'stop', last: false,
      t0: t.t0, t1: t.t1, pitch: vowel ? track.pitch(t.t0, t.t1) : NaN, level: vowel ? track.level(t.t0, t.t1) : NaN,
      pause: gap > 1e-3 ? gap : 0,
    });
    if (p.pause) close(k + 1, p);
  });
  if (from < out.length) close(out.length, undefined);
  return out;
}

/** the figures of a delivery; NaN where the sentences do not show one (no question among them, say) */
export interface Delivery {
  /** median pitch of the vowels, Hz */
  pitch: number;
  /** how far apart the vowels are in pitch: from the 10th to the 90th percentile, st */
  range: number;
  /** the low vowels (10th percentile) under the median, st */
  low: number;
  /** an accented vowel over the unaccented vowels next to it in its phrase, st */
  accent: number;
  /** from a vowel to the next one of its phrase, rms, st: how much the melody moves */
  step: number;
  /** the highest vowel of a phrase over the median of its vowels, st */
  top: number;
  /** how the pitch of the vowels runs through a phrase, its last vowel left out, st/s */
  slope: number;
  /** where the melody stands late in a long phrase: its vowels more than 1.5 s after its start against the earlier ones (the last one left out), st */
  late: number;
  /** the last vowel of a phrase against the median of the others: before a full stop (or a question with a question word), st */
  endStop: number;
  /** ... before the question mark of a question to answer yes or no, st */
  endQuestion: number;
  /** ... before a comma, st */
  endComma: number;
  /** sounds a second, the pauses left out */
  rate: number;
  /** a stressed vowel against an unstressed one, in length (last vowels of phrases left out) */
  stressLength: number;
  /** the last vowel of a phrase against the others with the same stress, in length */
  lastLength: number;
  /** the stressed vowel of the last word of a phrase, where it is not its last vowel, against the other stressed vowels, in length */
  lastStressLength: number;
  /** the pause at a comma, s (0 where the speaker makes none) */
  pauseComma: number;
  /** the pause between sentences, s */
  pauseStop: number;
  /** a stressed vowel over an unstressed one, dB */
  stressLevel: number;
  /** the last vowel of a phrase against the median of the others, dB */
  endLevel: number;
}

/** from here on a phrase is late, s after its start: where one arc of a melody has spent most of its height */
const LATE = 1.5;
const accented = (s: Sound) => s.vowel && s.stress && s.content;

export function deliveryOf(sayings: Saying[]): Delivery {
  const vowels = sayings.flat().filter((s) => s.vowel);
  const pitched = vowels.filter((s) => Number.isFinite(s.pitch)).map((s) => s.pitch);
  const mid = median(pitched);
  // accents: over the nearest unaccented vowels of the phrase, on either side (not the last one, which carries how the phrase ends)
  const acc: number[] = [], steps: number[] = [], tops: number[] = [], late: number[] = [];
  // the run of the pitch through a phrase: one slope for all, each phrase about its own mean
  let sxy = 0, sxx = 0;
  const ends: Record<Edge, number[]> = { stop: [], wh: [], question: [], comma: [] };
  const endLevel: number[] = [];
  const pauseComma: number[] = [], pauseStop: number[] = [];
  for (const say of sayings) {
    const phrases = Math.max(-1, ...say.map((s) => s.phrase)) + 1;
    for (let p = 0; p < phrases; p++) {
      const all = say.filter((s) => s.phrase === p);
      const v = all.filter((s) => s.vowel && Number.isFinite(s.pitch));
      const body = v.filter((s) => !s.last);
      for (let i = 1; i < v.length; i++) steps.push((v[i].pitch - v[i - 1].pitch) ** 2);
      if (v.length >= 4) tops.push(Math.max(...v.map((s) => s.pitch)) - median(v.map((s) => s.pitch)));
      body.forEach((s, i) => {
        if (!accented(s)) return;
        const near: number[] = [];
        for (let j = i - 1; j >= 0; j--) if (!accented(body[j])) { near.push(body[j].pitch); break; }
        for (let j = i + 1; j < body.length; j++) if (!accented(body[j])) { near.push(body[j].pitch); break; }
        if (near.length) acc.push(s.pitch - mean(near));
      });
      if (body.length >= 3) {
        const tm = mean(body.map((s) => 0.5 * (s.t0 + s.t1))), pm = mean(body.map((s) => s.pitch));
        for (const s of body) { const dt = 0.5 * (s.t0 + s.t1) - tm; sxy += dt * (s.pitch - pm); sxx += dt * dt; }
      }
      const isLate = (s: Sound) => 0.5 * (s.t0 + s.t1) - all[0].t0 > LATE;
      const early = body.filter((s) => !isLate(s)), rest = body.filter(isLate);
      if (early.length >= 2 && rest.length >= 2) late.push(mean(rest.map((s) => s.pitch)) - mean(early.map((s) => s.pitch)));
      const lastV = v.find((s) => s.last);
      if (lastV && body.length >= 2) ends[lastV.edge].push(lastV.pitch - median(body.map((s) => s.pitch)));
      const lv = all.filter((s) => s.vowel && Number.isFinite(s.level));
      const ll = lv.find((s) => s.last), lb = lv.filter((s) => !s.last);
      if (ll && lb.length >= 2) endLevel.push(ll.level - median(lb.map((s) => s.level)));
      if (p < phrases - 1 && all.length) (all[0].edge === 'comma' ? pauseComma : pauseStop).push(all[all.length - 1].pause);
    }
  }
  const sounds = sayings.flat();
  const seconds = sounds.reduce((a, s) => a + (s.t1 - s.t0), 0);
  const ln = (s: Sound) => Math.log(Math.max(1e-3, s.t1 - s.t0));
  const inner = vowels.filter((s) => !s.last);
  const lenOf = (stress: boolean) => mean(inner.filter((s) => s.stress === stress).map(ln));
  const lastLn = vowels.filter((s) => s.last).map((s) => ln(s) - lenOf(s.stress)).filter(Number.isFinite);
  // the stress of the last word of each phrase, and the stressed vowels that are neither that nor the last of their phrase
  const tail = new Set<Sound>();
  for (const say of sayings) for (const l of say.filter((s) => s.last)) {
    const w = say.filter((s) => s.vowel && s.phrase === l.phrase && s.word === l.word && s.stress && !s.last).pop();
    if (w) tail.add(w);
  }
  const plainStress = mean(inner.filter((s) => s.stress && !tail.has(s)).map(ln));
  const lev = vowels.filter((s) => Number.isFinite(s.level));
  return {
    pitch: Number.isFinite(mid) ? 2 ** (mid / 12) : NaN,
    range: quantile(pitched, 0.9) - quantile(pitched, 0.1),
    low: mid - quantile(pitched, 0.1),
    accent: mean(acc),
    step: Math.sqrt(mean(steps)),
    top: mean(tops),
    slope: sxx > 0 ? sxy / sxx : NaN,
    late: mean(late),
    endStop: mean([...ends.stop, ...ends.wh]),
    endQuestion: mean(ends.question),
    endComma: mean(ends.comma),
    rate: seconds > 0 ? sounds.length / seconds : NaN,
    stressLength: Math.exp(lenOf(true) - lenOf(false)),
    lastLength: Math.exp(mean(lastLn)),
    lastStressLength: Math.exp(mean([...tail].map(ln)) - plainStress),
    pauseComma: mean(pauseComma),
    pauseStop: mean(pauseStop),
    stressLevel: mean(lev.filter((s) => s.stress).map((s) => s.level)) - mean(lev.filter((s) => !s.stress).map((s) => s.level)),
    endLevel: mean(endLevel),
  };
}

/** two sayings of the same sentences, sound by sound */
export interface Gap {
  /** the vowels' pitch, each voice about its own median: rms of the difference, st, and how the two go together (-1..1) */
  pitch: number;
  together: number;
  /** the sounds' lengths, the overall pace taken out: rms of the difference, as a ratio (0.3: one is 35 % longer or shorter) */
  length: number;
  vowels: number;
  sounds: number;
}

export function gapBetween(a: Saying[], b: Saying[]): Gap {
  const x: number[] = [], y: number[] = [], d: number[] = [];
  a.forEach((say, i) => say.forEach((s, k) => {
    const o = b[i]?.[k];
    if (!o) return;
    d.push(Math.log(Math.max(1e-3, s.t1 - s.t0) / Math.max(1e-3, o.t1 - o.t0)));
    if (s.vowel && Number.isFinite(s.pitch) && Number.isFinite(o.pitch)) { x.push(s.pitch); y.push(o.pitch); }
  }));
  const mx = median(x), my = median(y), ax = mean(x), ay = mean(y), md = mean(d);
  let sxy = 0, sxx = 0, syy = 0, e = 0;
  for (let i = 0; i < x.length; i++) {
    e += (x[i] - mx - (y[i] - my)) ** 2;
    sxy += (x[i] - ax) * (y[i] - ay); sxx += (x[i] - ax) ** 2; syy += (y[i] - ay) ** 2;
  }
  return {
    pitch: x.length ? Math.sqrt(e / x.length) : NaN,
    together: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN,
    length: d.length ? Math.sqrt(d.reduce((s, v) => s + (v - md) ** 2, 0) / d.length) : NaN,
    vowels: x.length,
    sounds: d.length,
  };
}

/** the figures a fit brings together, and the difference that counts as one: st, st/s, a ratio in length (as its logarithm), s */
const TERMS: { key: keyof Delivery; scale: number; log?: boolean }[] = [
  { key: 'range', scale: 1 },
  { key: 'low', scale: 1 },
  { key: 'accent', scale: 0.7 },
  { key: 'step', scale: 0.7 },
  { key: 'top', scale: 1 },
  { key: 'slope', scale: 1 },
  { key: 'late', scale: 1 },
  { key: 'endStop', scale: 1 },
  { key: 'endQuestion', scale: 1.5 },
  { key: 'endComma', scale: 1 },
  { key: 'stressLength', scale: 0.1, log: true },
  { key: 'lastLength', scale: 0.1, log: true },
  { key: 'lastStressLength', scale: 0.1, log: true },
  { key: 'pauseComma', scale: 0.04 },
  { key: 'pauseStop', scale: 0.06 },
];

/** how far a delivery is from another: the root of the mean squared difference of the figures both have, each in its own unit */
export function deliveryDistance(ours: Delivery, target: Delivery): number {
  let sum = 0, n = 0;
  for (const t of TERMS) {
    const a = ours[t.key], b = target[t.key];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const d = t.log ? Math.log(Math.max(1e-3, a) / Math.max(1e-3, b)) : a - b;
    sum += (d / t.scale) ** 2; n++;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/**
 * the fields a fit moves, the first step of each, and the figure the
 * sentences have to show for it to be moved (a rise of the questions is not
 * learnt from sentences without one: it would be spent on the other figures)
 */
const KNOBS: [string, number, (keyof Delivery)?, boolean?][] = [
  ['speaking.accent', 2],
  ['speaking.style.phrase', 0.4],
  // (at 0 the habit is off, and a small span is not a small change: from 0 it is tried at its whole first step in every round)
  ['speaking.style.phraseSpan', 2, 'late', true],
  ['speaking.style.finalFall', 1.5, 'endStop'],
  ['speaking.style.questionRise', 2, 'endQuestion'],
  ['speaking.style.continuation', 1.5, 'endComma'],
  ['speaking.style.floor', 1.5],
  ['speaking.style.downstep', 0.05],
  ['speaking.style.finalLengthening', 0.3, 'lastLength'],
  ['speaking.style.lastStressLengthening', 0.2, 'lastStressLength'],
  ['speaking.style.pauseShort', 0.06, 'pauseComma'],
  ['speaking.style.pauseLong', 0.1, 'pauseStop'],
];

export interface DeliveryFit {
  voice: VoiceDesign;
  start: Delivery;
  end: Delivery;
  /** the distance to the target before and after */
  from: number;
  to: number;
  evaluations: number;
  /** the fields the fit may move, before and after; `limit`: it ended at an end of its range, and the figures asked for more */
  fields: { path: string; from: number; to: number; limit: boolean }[];
}

/**
 * The melody and the rhythm of a voice brought to a measured delivery.
 * `measure` says the sentences with a voice and measures it (on its plans:
 * `sayingOf` with `planned`). The pitch and the pace are set outright, the
 * rest by trying each field a step up and a step down while the distance
 * falls, with steps that halve at each round.
 */
export function fitDelivery(target: Delivery, voice: Readonly<VoiceDesign>, measure: (d: VoiceDesign) => Delivery, rounds = 4): DeliveryFit {
  let evaluations = 0;
  const run = (d: VoiceDesign) => { evaluations++; return measure(d); };
  /** the pitch and the pace, which the other figures do not depend on */
  const level = (d: VoiceDesign, m: Delivery): VoiceDesign => {
    let out = d;
    if (Number.isFinite(m.pitch) && Number.isFinite(target.pitch)) out = withField(out, 'speaking.f0', out.speaking.f0 * target.pitch / m.pitch);
    if (Number.isFinite(m.rate) && Number.isFinite(target.rate)) out = withField(out, 'speaking.rate', out.speaking.rate * target.rate / m.rate);
    return out;
  };
  const search = (d0: VoiceDesign, m0: Delivery) => {
    let best = level(d0, m0);
    let now = run(best), cost = deliveryDistance(now, target);
    for (let r = 0; r < rounds; r++) {
      for (const [path, first, needs, off] of KNOBS) {
        if (needs && !Number.isFinite(target[needs])) continue;
        const field = VOICE_FIELDS.find((f) => f.path === path);
        if (!field) continue;
        const step = first / 2 ** r;
        // a field is followed while it helps (up to four steps a round)
        for (let n = 0; n < 4; n++) {
          const v = fieldValue(best, field) as number;
          let moved = false;
          for (const dir of [1, -1]) {
            const d = withField(best, path, v + dir * (off && v === 0 ? first : step));
            if (fieldValue(d, field) === v) continue;
            const m = run(d), c = deliveryDistance(m, target);
            if (c < cost - 1e-3) { best = d; now = m; cost = c; moved = true; break; }
          }
          if (!moved) break;
        }
      }
      const d = level(best, now), m = run(d);
      best = d; now = m; cost = deliveryDistance(m, target);
    }
    return { best, now, cost };
  };
  const start = run(cloneVoice(voice)), from = deliveryDistance(start, target);
  let found = search(cloneVoice(voice), start);
  // a habit that is on or off is not reached a field at a time when the others have to follow it (a melody that starts
  // again asks for other arcs and accents): where the search left it off it is run again with the habit on, and the
  // nearer of the two ends is kept
  for (const [path, first, needs, off] of KNOBS) {
    const field = VOICE_FIELDS.find((f) => f.path === path);
    if (!off || !field || (needs && !Number.isFinite(target[needs])) || fieldValue(found.best, field) !== 0) continue;
    const on = withField(cloneVoice(voice), path, first), other = search(on, run(on));
    if (other.cost < found.cost - 1e-3) found = other;
  }
  const best = found.best, now = found.now, cost = found.cost;
  const fields = ['speaking.f0', 'speaking.rate', ...KNOBS.map(([path]) => path)].flatMap((path) => {
    const f = VOICE_FIELDS.find((x) => x.path === path);
    if (!f) return [];
    const a = fieldValue(voice as VoiceDesign, f) as number, b = fieldValue(best, f) as number;
    return [{ path, from: a, to: b, limit: b !== a && (b === f.min || b === f.max) }];
  });
  return { voice: best, start, end: now, from, to: cost, evaluations, fields };
}
