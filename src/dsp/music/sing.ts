/**
 * Singing: a voice says the words of a song on its notes. The planner of
 * speech makes the gestures (every consonant and vowel as in speech, with
 * the voice's own habits); singing only tells it how long each sound lasts
 * and takes over the pitch and the lungs.
 *
 * As singers do, the vowel of each syllable starts on its beat and holds
 * the note; the consonants before it come just before the beat, taken from
 * the end of the note before (in a legato line the consonants that end a
 * word go with the next syllable). Before a rest the consonants that end
 * the word close the note, and those of the next word come out of the
 * rest; a rest long enough is a breath. A syllable held over several notes
 * (a melisma) moves its pitch on the beats.
 *
 * The pitch glides from note to note in a few tens of milliseconds (at the
 * start of the consonants of a new syllable, so that they are sung on the
 * new note; on the beat inside a melisma), and a held note takes on a
 * vibrato after a moment (5.5-6.5 Hz, a third to half a semitone either
 * way: Sundberg 1987, Prame 1994). A narrow mouth holds air back and the
 * folds slow down a little under it (the engine's law of the pressure
 * behind them): a singer hears it and corrects, and so does `fix`, from a
 * first take measured by `sungPitch`.
 * The lungs push steadily through a phrase, a little more for higher notes
 * (the pressure a fold needs grows with its pitch: Titze 1989), and as
 * hard as each note's velocity asks.
 */
import type { Phone } from '../speech/g2p';
import { defaultParams, EngineParams, Score, ScoreFrame } from '../engine/params';
import { phonemeFor } from '../speech/derive';
import { buildScore, ScoreOptions } from '../speech/sequencer';
import { VoiceDesign, applyDesign, speechOptions } from '../voice/design';
import { Note, midiHz } from './notes';
import { yin } from '../analysis/pitch';

/**
 * The notes of a take with the pitch they were meant to have when a pitch
 * was given as it is (`contour`, t from the first beat at `beat0`): the
 * median of the given pitch over the steady part of each vowel, so that
 * the ear corrects toward the singer's own pitch and not the piano's.
 */
export function meantNotes(notes: readonly SungNote[], contour: readonly { t: number; f0: number }[], beat0: number, transpose = 0): SungNote[] {
  return notes.map((n) => {
    const L = n.v1 - n.v0, a = n.v0 + 0.25 * L - beat0, b = n.v1 - 0.15 * L - beat0;
    const m = contour.filter((c) => c.t >= a && c.t <= b && c.f0 > 0).map((c) => 69 + 12 * Math.log2(c.f0 / 440) + transpose).sort((x, y) => x - y);
    return m.length ? { ...n, midi: m[m.length >> 1] } : n;
  });
}

/**
 * How far each note of a take is from its pitch, cents (NaN where it
 * cannot be told): the median of the pitch over the steady part of its
 * vowel (from a quarter in to 15 % before its end), where the pitch is
 * clear.
 */
export function sungPitch(samples: Float32Array, fs: number, notes: readonly SungNote[]): number[] {
  const win = Math.round(0.04 * fs), hop = Math.round(0.005 * fs);
  return notes.map((n) => {
    const L = n.v1 - n.v0;
    if (L < 0.08) return NaN;
    const hz = midiHz(n.midi), a = Math.round((n.v0 + 0.25 * L) * fs - win / 2), b = Math.round((n.v1 - 0.15 * L) * fs - win / 2);
    const c: number[] = [];
    for (let i = Math.max(0, a); i <= b && i + win <= samples.length; i += hop) {
      const r = yin(samples.subarray(i, i + win), fs, hz * 0.7, hz * 1.4);
      if (r.confidence > 0.6 && r.f0 > 0) c.push(1200 * Math.log2(r.f0 / hz));
    }
    if (c.length < 3) return NaN;
    c.sort((x, y) => x - y);
    return c[Math.floor(c.length / 2)];
  });
}

export interface SingOptions {
  /** beats per minute (100) */
  tempo?: number;
  /** semitones added to every note (0) */
  transpose?: number;
  /** vibrato, semitones either way (0.33; 0 none) */
  vibrato?: number;
  /** vibrato rate, Hz (5.5) */
  vibratoRate?: number;
  /** time the pitch takes from one note to the next, s (0.07) */
  glide?: number;
  /** how hard the lungs push, times the voice's own pressure (1.15) */
  loudness?: number;
  /** silence before the first beat, s (0.4) */
  lead?: number;
  /** the vowel sung when the song has no words ('a') */
  vowel?: string;
  /** a living singer: each seed a slightly different performance */
  seed?: number;
  /**
   * what the singer's ear corrects: semitones added to each sung note (in
   * the order of the notes that are not rests, a syllable split over a note
   * counting once for each part), measured on a first take (see `sungPitch`)
   */
  fix?: number[];
  /**
   * a pitch to sing as it is, in place of the notes' steps (with its own
   * slides and vibrato): Hz every few milliseconds, 0 where there is no
   * voice, t from the first beat (a recording's: see melodyOf), moved by
   * `transpose` like the notes
   */
  contour?: { t: number; f0: number }[];
}

/** a note as sung: its span (s), its pitch, and the span of the vowel that holds it */
export interface SungNote { t0: number; t1: number; midi: number; v0: number; v1: number }

/** a syllable as sung: its vowel, when it starts (on its beat) and ends, and the note (or notes) it holds */
export interface SungSyllable { ipa: string; t0: number; t1: number; midi: number[] }

export interface Sung {
  params: EngineParams;
  score: Score;
  syllables: SungSyllable[];
  /** every note that is not a rest, in order */
  notes: SungNote[];
  /** for every note, the time from which a change of its pitch (`fix`) changes the score, s */
  fixFrom: number[];
  /**
   * the same song with other corrections of the ear (`fix`): only the pitch
   * planned again (the gestures and their times do not depend on it), the
   * same as singScore with that `fix`
   */
  retuned: (fix: readonly number[]) => { params: EngineParams; score: Score };
  /** time of the first beat, s, and length of a beat, s */
  beat0: number;
  beat: number;
  /** what did not fit: more syllables than notes, or more notes than syllables */
  warnings: string[];
}

const FRAME = 0.005;

/** a stretch of the song: a syllable (or part of one) on a note, or a rest */
interface Event { syl: number; midi: number | null; t0: number; t1: number; velocity: number }

/**
 * the nucleus of a syllable: a vowel (not one marked non-syllabic, the i̯ of a diphthong), or a consonant marked
 * syllabic (the n of German "Glocken" [ɡlɔkn̩])
 */
const vowelAt = (ph: Phone[], i: number) =>
  (phonemeFor(ph[i].ipa)?.manner === 'vowel' && !ph[i].ipa.includes('̯')) || ph[i].ipa.includes('̩') || ph[i].ipa.includes('̍');

/** a score moved later (at rest until then) or earlier (its lead in cut) by s seconds */
function shift(sc: Score, s: number): Score {
  const k = Math.round(s / FRAME), d = k * FRAME;
  if (k === 0) return sc;
  if (k > 0) {
    const first = sc.frames[0], lead: ScoreFrame[] = [];
    for (let i = 0; i < k; i++) lead.push({ ...first, t: i * FRAME });
    return { ...sc, frames: [...lead, ...sc.frames.map((f) => ({ ...f, t: f.t + d }))], phones: sc.phones.map((p) => ({ ...p, t0: p.t0 + d, t1: p.t1 + d })), duration: sc.duration + d };
  }
  const c = -k;
  return { ...sc, frames: sc.frames.slice(c).map((f) => ({ ...f, t: f.t + d })), phones: sc.phones.map((p) => ({ ...p, t0: p.t0 + d, t1: p.t1 + d })), duration: sc.duration + d };
}

/**
 * The engine's parameters and the score of a voice singing phones (the
 * words of the song) on notes, with the times of its syllables.
 */
export function singScore(d: Readonly<VoiceDesign>, notesIn: readonly Note[], phonesIn: readonly Phone[], lang: string, o: SingOptions = {}): Sung {
  const spb = 60 / Math.max(20, Math.min(400, o.tempo ?? 100));
  const lead = Math.max(0.15, o.lead ?? 0.4);
  const glide = Math.max(0.01, o.glide ?? 0.07);
  const vib = Math.max(0, o.vibrato ?? 0.4), vibRate = Math.max(1, o.vibratoRate ?? 5.8);
  const notes = notesIn.map((n) => (n.midi === null ? { ...n } : { ...n, midi: n.midi + (o.transpose ?? 0) }));
  const warnings: string[] = [];

  // the words, without the pauses of their punctuation (the rests make the pauses), or a vowel on every note
  const sungNotes = notes.filter((n) => n.midi !== null && !n.tie).length;
  let phones: Phone[] = phonesIn.length
    ? phonesIn.map((p) => { const q = { ...p }; delete q.pause; delete q.question; delete q.whQuestion; return q; })
    : Array.from({ length: Math.max(1, sungNotes) }, () => ({ ipa: o.vowel ?? 'a', wordStart: true, wordEnd: true }));
  const kept = phones.map((p, i) => (phonemeFor(p.ipa) ? i : -1)).filter((i) => i >= 0);
  phones = kept.map((i) => phones[i]);
  const nuclei = phones.map((_, i) => i).filter((i) => vowelAt(phones, i));
  if (!nuclei.length) throw new Error('no vowel to sing');

  // syllables on notes: one syllable to each note that is not a rest or a tie; the rest of the notes
  // go on with the last syllable, and syllables beyond the notes share the last note
  const S = nuclei.length;
  const events: Event[] = [];
  let at = lead, syl = -1;
  const sung = notes.filter((n) => n.midi !== null);
  if (!sung.length) throw new Error('no note to sing');
  for (const n of notes) {
    const len = n.beats * spb, vel = n.velocity ?? 1;
    if (n.midi === null) { events.push({ syl: -1, midi: null, t0: at, t1: at + len, velocity: 1 }); at += len; continue; }
    if (!n.tie && syl < S - 1) syl++;
    else if (!n.tie && syl === S - 1 && !warnings.length) warnings.push(`more notes than syllables: ${sungNotes} notes, ${S} syllables`);
    events.push({ syl: Math.max(0, syl), midi: n.midi, t0: at, t1: at + len, velocity: vel });
    at += len;
  }
  if (syl < S - 1) {
    // the syllables left over share the last sung note
    warnings.push(`more syllables than notes: ${S} syllables, ${sungNotes} notes`);
    const li = events.map((e) => e.midi !== null).lastIndexOf(true), last = events[li];
    const extra = S - 1 - syl, part = (last.t1 - last.t0) / (extra + 1);
    const parts: Event[] = [];
    for (let k = 0; k <= extra; k++) parts.push({ ...last, syl: last.syl + k, t0: last.t0 + k * part, t1: last.t0 + (k + 1) * part });
    events.splice(li, 1, ...parts);
  }
  // each syllable's span: from the start of its first note to the end of its last
  const T = new Array<number>(S).fill(0), E = new Array<number>(S).fill(0);
  for (const e of events) if (e.syl >= 0) { if (!T[e.syl] && !E[e.syl]) T[e.syl] = e.t0; E[e.syl] = e.t1; }

  // the speech planner's own lengths for every sound, as a start
  const opts: ScoreOptions = { ...speechOptions(d, lang), seed: o.seed };
  opts.style = { ...opts.style, endCreak: 0, micro: 0, flutter: 6 };
  const plain = buildScore(phones, opts);
  const own = plain.phones.filter((p) => p.ipa !== '_').map((p) => p.t1 - p.t0);
  if (own.length !== phones.length) throw new Error('the planner did not keep every sound');

  // where the consonants go
  const want = new Array<number>(phones.length).fill(0);
  const pauseAfter: (number | undefined)[] = new Array(phones.length).fill(undefined);
  // a sung consonant is a little shorter than a spoken one, and gives way to the vowel when time is short
  const cons = (i: number) => Math.max(0.03, 0.8 * own[i]);
  const fit = (idx: number[], room: number): number => {
    const sum = idx.reduce((a, i) => a + cons(i), 0), k = sum > room ? room / sum : 1;
    idx.forEach((i) => { want[i] = Math.max(0.02, cons(i) * k); });
    return idx.reduce((a, i) => a + want[i], 0);
  };
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
  const before = new Array<number>(S).fill(0); // consonant time just before each beat
  const after = new Array<number>(S).fill(0); // consonant time at the end of each syllable's note
  for (let j = 0; j <= S; j++) {
    const from = j === 0 ? 0 : nuclei[j - 1] + 1, to = j === S ? phones.length : nuclei[j];
    const cl = range(from, to);
    if (j === 0) { before[0] = fit(cl, Math.min(0.3, lead - 0.05)); continue; }
    const prevLen = E[j - 1] - T[j - 1];
    if (j === S) { after[S - 1] = fit(cl, Math.min(0.3, 0.4 * prevLen)); continue; }
    const gap = T[j] - E[j - 1];
    if (gap < 1e-6) { before[j] = fit(cl, Math.min(0.3, 0.45 * prevLen)); continue; }
    // a rest between: the end of the word closes the note, the next word comes out of the rest
    const w = cl.findIndex((i) => phones[i].wordStart);
    const coda = w >= 0 ? cl.slice(0, w) : phones[nuclei[j]].wordStart ? cl : [];
    const onset = w >= 0 ? cl.slice(w) : phones[nuclei[j]].wordStart ? [] : cl;
    after[j - 1] = fit(coda, Math.min(0.3, 0.4 * prevLen));
    before[j] = fit(onset, Math.min(0.3, 0.8 * gap));
    const last = coda.length ? coda[coda.length - 1] : nuclei[j - 1];
    pauseAfter[last] = Math.max(0.02, gap - before[j]);
  }
  nuclei.forEach((n, j) => {
    const next = j + 1 < S && T[j + 1] - E[j] < 1e-6 ? before[j + 1] : 0;
    want[n] = Math.max(0.05, E[j] - T[j] - after[j] - next);
  });
  const said: Phone[] = phones.map((p, i) => {
    const q = { ...p };
    if (pauseAfter[i] !== undefined) { q.pause = pauseAfter[i]! >= 0.45 ? 'long' : 'short'; q.wordEnd = true; }
    return q;
  });
  const pauses = pauseAfter.filter((x): x is number => x !== undefined);

  // the planner on those lengths, three times (some parts keep their own length)
  const stretch = want.map((w, i) => w / Math.max(0.01, own[i]));
  let sc = buildScore(said, { ...opts, timing: { stretch: [...stretch], pauses } });
  for (let round = 0; round < 3; round++) {
    const now = sc.phones.filter((p) => p.ipa !== '_');
    if (now.length !== want.length) break;
    now.forEach((p, i) => { if (p.t1 > p.t0) stretch[i] *= want[i] / (p.t1 - p.t0); });
    sc = buildScore(said, { ...opts, timing: { stretch: [...stretch], pauses } });
  }
  // the first vowel on the first beat
  const sounds = () => sc.phones.filter((p) => p.ipa !== '_');
  sc = shift(sc, T[0] - sounds()[nuclei[0]].t0);
  const placed = sounds();

  // the pitch: each note from the start of its syllable's own consonants (or from its beat in a melisma), gliding;
  // the end of the word before (or, inside a word, all but the last consonant) keeps the note before
  const onsetOf = (j: number) => {
    const from = nuclei[j - 1] + 1, to = nuclei[j];
    for (let i = from; i < to; i++) if (phones[i].wordStart) return i;
    return phones[to].wordStart ? to : Math.max(from, to - 1);
  };
  // one mark for each sung note (in the order of `fix`): where its pitch starts
  const marks: { t: number; midi: number; e: Event }[] = [];
  let lastSyl = -1;
  for (const e of events) {
    if (e.midi === null) continue;
    const startOfSyl = e.syl !== lastSyl;
    const firstCons = e.syl === 0 ? 0 : onsetOf(e.syl);
    const t = startOfSyl && nuclei[e.syl] > firstCons ? Math.min(e.t0, placed[firstCons].t0) : e.t0;
    marks.push({ t, midi: e.midi, e });
    lastSyl = e.syl;
  }
  // a pitch given as it is: semitones at every point, the gaps without voice bridged in a straight line
  const given = o.contour?.length ? o.contour.map((c) => ({ t: c.t + lead, m: c.f0 > 0 ? 69 + 12 * Math.log2(c.f0 / 440) + (o.transpose ?? 0) : NaN })) : null;
  if (given) {
    const known = given.map((g, i) => (Number.isNaN(g.m) ? -1 : i)).filter((i) => i >= 0);
    if (!known.length) throw new Error('the pitch given has no voice in it');
    let k = 0;
    for (let i = 0; i < given.length; i++) {
      while (k + 1 < known.length && known[k + 1] <= i) k++;
      if (!Number.isNaN(given[i].m)) continue;
      const a = known[k], b = known[Math.min(known.length - 1, k + 1)];
      given[i].m = i <= a || a === b ? given[a].m : given[a].m + ((given[b].m - given[a].m) * (i - a)) / (b - a);
    }
  }
  const givenAt = (t: number) => {
    const g = given!;
    if (t <= g[0].t) return g[0].m;
    if (t >= g[g.length - 1].t) return g[g.length - 1].m;
    let lo = 0, hi = g.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (g[mid].t <= t) lo = mid; else hi = mid; }
    return g[lo].m + ((g[hi].m - g[lo].m) * (t - g[lo].t)) / Math.max(1e-6, g[hi].t - g[lo].t);
  };
  const velocityAt = (t: number) => { const e = events.find((x) => x.midi !== null && t >= x.t0 && t < x.t1); return e ? e.velocity : 1; };
  const voiceMidi = 69 + 12 * Math.log2(d.speaking.f0 / 440);
  const base = d.speaking.ps, loud = o.loudness ?? 1.15;
  const ahead = 3 * 0.012;
  const planned = sc;
  // the pitch on the planned gestures, each note moved by what the singer's ear corrects on it
  const pitched = (fix: readonly number[]) => {
    const at = marks.map((m, k) => ({ ...m, midi: m.midi + (fix[k] ?? 0) }));
    const semis = (t: number) => {
      if (given) {
        // the given pitch, with what the singer's ear corrects on the note sung there
        const k = marks.findIndex((x) => t >= x.e.t0 && t < x.e.t1);
        return givenAt(t) + (k >= 0 ? (fix[k] ?? 0) : 0);
      }
      let k = 0;
      while (k + 1 < at.length && at[k + 1].t <= t) k++;
      let m = at[k].midi;
      // a raised-cosine glide centred on each change
      for (const j of [k, k + 1]) {
        if (j <= 0 || j >= at.length) continue;
        const u = (t - at[j].t) / glide;
        if (u > -0.5 && u < 0.5) { const w = 0.5 - 0.5 * Math.cos(Math.PI * (u + 0.5)); m = at[j - 1].midi + (at[j].midi - at[j - 1].midi) * w; }
      }
      // vibrato, after a moment on a held note
      const mk = at[k], held = t - Math.max(mk.t, mk.e.t0);
      if (vib > 0 && held > 0.15) m += vib * Math.min(1, (held - 0.15) / 0.3) * Math.sin(2 * Math.PI * vibRate * held);
      return m;
    };
    const frames = planned.frames.map((f) => {
      const m = semis(f.t + ahead);
      const lift = Math.min(1.5, 1 + 0.02 * Math.max(0, m - voiceMidi));
      const g = Math.max(0, Math.min(1, f.ps / (0.8 * base)));
      return { ...f, f0: midiHz(m), ps: g * base * loud * lift * velocityAt(f.t), rd: 0, creak: 0 };
    });
    const params = defaultParams();
    applyDesign(params, d);
    params.phonate = true;
    params.source.ps = 0;
    params.source.f0 = midiHz(at[0].midi);
    return { params, score: { ...planned, frames, f0Tau: 0.012, flutter: 6 } as Score };
  };
  const { params, score } = pitched(o.fix ?? []);

  const syllables: SungSyllable[] = nuclei.map((n, j) => ({
    ipa: phones[n].ipa, t0: T[j], t1: E[j],
    midi: events.filter((e) => e.syl === j && e.midi !== null).map((e) => e.midi as number),
  }));
  const asSung: SungNote[] = events.filter((e) => e.midi !== null).map((e) => {
    const v = placed[nuclei[e.syl]];
    return { t0: e.t0, t1: e.t1, midi: e.midi as number, v0: Math.max(e.t0, v.t0), v1: Math.min(e.t1, v.t1) };
  });
  // a note's pitch reaches back to the start of its glide (and of its syllable's consonants), and the frames look ahead
  const fixFrom = marks.map((m) => Math.min(m.t, m.e.t0) - glide / 2 - ahead - 0.01);
  return { params, score, syllables, notes: asSung, fixFrom, retuned: pitched, beat0: lead, beat: spb, warnings };
}
