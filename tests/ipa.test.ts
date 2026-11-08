import { describe, it, expect } from 'vitest';
import { readIpa, segmentOf } from '../src/dsp/speech/ipaReader';
import { phonemeFor, constrictionOf, chartPhonemes, notesForIpa } from '../src/dsp/speech/derive';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { IPA_CONSONANTS, IPA_VOWELS } from '../src/dsp/speech/ipa';
import { computeGeometry } from '../src/dsp/tract/geometry';
import { sectionsFromGeometry } from '../src/dsp/tract/areaFunction';
import { formants } from '../src/dsp/tract/acoustics';
import { DEFAULT_ANATOMY, DEFAULT_ARTICULATORS, DEFAULT_TEETH } from '../src/dsp/tract/types';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { note } from './helpers';

const fs = 48000;
const syms = (s: string) => readIpa(s).phones.map((p) => p.ipa);
const posture = (sym: string) => ({ ...DEFAULT_ARTICULATORS, ...PHONEMES['ə'].art, ...phonemeFor(sym)!.art });
const fmt = (sym: string) => formants(sectionsFromGeometry(computeGeometry(posture(sym), DEFAULT_ANATOMY, DEFAULT_TEETH)), {}, 4500).map((f) => f.f);
const where = (sym: string) => constrictionOf(phonemeFor(sym)!.art);

describe('reading IPA', () => {
  it('keeps diacritics and modifier letters with their symbol, whatever the Unicode composition', () => {
    expect(syms('r̝a tʰa ã')).toEqual(['r̝', 'a', 'tʰ', 'a', 'ã']);
    // a + combining tilde and the precomposed ã are the same sound
    expect(syms('ã')).toEqual(syms('ã'));
    // ç is a letter of its own, not c with a cedilla
    expect(syms('çi')).toEqual(['ç', 'i']);
    expect(syms('ɡaʧ')).toEqual(['g', 'a', 'tʃ']);
    expect(syms('t͡ɬa')).toEqual(['t͡ɬ', 'a']);
    expect(segmentOf('kʷʰ')).toEqual({ base: 'k', mods: ['labialized', 'aspirated'] });
  });

  it('reads stress, length, syllable breaks and prenasalized stops', () => {
    const p = readIpa('ˈak.sa ˈkaːˑ ᵐba').phones;
    expect(p[0].stress).toBe(true);
    expect(p.find((q) => q.ipa === 's')!.sylStart).toBe(true);
    expect(p[5].long).toBe(true);
    expect(p[5].halfLong).toBe(true);
    expect(p[6]).toMatchObject({ ipa: 'm', prenasal: true });
    expect(p[7].ipa).toBe('b');
  });

  it('reads tones as letters, numbers and diacritics, on the vowel of their syllable', () => {
    expect(readIpa('ma˥˩').phones[1].tone).toEqual([5, 1]);
    expect(readIpa('maŋ˧˥').phones[1].tone).toEqual([3, 5]);
    expect(readIpa('ma⁵¹').phones[1].tone).toEqual([5, 1]);
    expect(readIpa('ma214').phones[1].tone).toEqual([2, 1, 4]);
    expect(readIpa('má').phones[1].tone).toEqual([4]);
    expect(readIpa('mǎ').phones[1].tone).toEqual([1, 5]);
    expect(readIpa('a ꜜbá').phones[2].toneStep).toBe(-1);
    // a tone on a consonant makes it syllabic (Yoruba ń)
    const n = readIpa('ń').phones[0];
    expect(n.tone).toEqual([4]);
    expect(phonemeFor(n.ipa)!.syllabic).toBe(true);
  });

  it('reports what it cannot read instead of dropping it in silence', () => {
    const r = readIpa('aQa%');
    expect(r.phones.map((p) => p.ipa)).toEqual(['a', 'a']);
    expect(r.notes.map((n) => n.symbol)).toEqual(['Q', '%']);
  });
});

describe('every IPA symbol from rules', () => {
  it('makes every symbol of the chart, and keeps the fitted phonemes as they are', () => {
    const all = [...Object.keys(IPA_CONSONANTS), ...Object.keys(IPA_VOWELS)];
    expect(chartPhonemes().length).toBe(all.length);
    for (const s of ['s', 'ʃ', 'l', 'r', 'i', 'u', 'k']) expect(phonemeFor(s)).toBe(PHONEMES[s]);
  });

  it('puts each place where it belongs, from the lips back to the epiglottis', () => {
    const stops = ['p', 't', 'ʈ', 'c', 'k', 'q', 'ʡ'];
    const fricatives = ['ɸ', 'ɕ', 'ʂ', 'ç', 'x', 'χ', 'ħ'];
    const at = (l: string[]) => l.map((s) => where(s).fromLips);
    note('places', `stops ${stops.map((s, i) => `${s} ${at(stops)[i].toFixed(1)}`).join(', ')} cm from the lips; fricatives ${fricatives.map((s, i) => `${s} ${at(fricatives)[i].toFixed(1)}`).join(', ')}`);
    for (const l of [stops, fricatives]) {
      const x = at(l);
      for (let i = 1; i < x.length; i++) expect(x[i]).toBeGreaterThan(x[i - 1]);
    }
  });

  it('gives each manner its degree: closed, about 0.1 cm² for a hiss, about 0.3 cm² for an approximant', () => {
    for (const s of ['ʈ', 'c', 'q', 'ʡ', 'ɱ', 'ɳ']) expect(where(s).area).toBeLessThan(0.004);
    for (const s of ['ɸ', 'β', 'ʂ', 'ɕ', 'ç', 'x', 'χ', 'ħ', 'ɬ']) {
      expect(where(s).area).toBeGreaterThan(0.06);
      expect(where(s).area).toBeLessThan(0.14);
    }
    for (const s of ['ʋ', 'ɻ', 'ɰ', 'ɭ']) {
      expect(where(s).area).toBeGreaterThan(0.25);
      expect(where(s).area).toBeLessThan(0.4);
    }
  });

  it('makes the vowels of the whole chart in the order their formants have in real speech', () => {
    const [i, y, u, e, ø, o, ɛ, œ, ɯ, ɨ] = ['i', 'y', 'u', 'e', 'ø', 'o', 'ɛ', 'œ', 'ɯ', 'ɨ'].map(fmt);
    note('derived vowels', `y ${y.slice(0, 3).map((f) => f.toFixed(0)).join('/')}, ø ${ø.slice(0, 3).map((f) => f.toFixed(0)).join('/')}, œ ${œ.slice(0, 3).map((f) => f.toFixed(0)).join('/')}, ɯ ${ɯ.slice(0, 3).map((f) => f.toFixed(0)).join('/')}, ɨ ${ɨ.slice(0, 3).map((f) => f.toFixed(0)).join('/')} Hz`);
    // rounding lowers F2 and F3 of a front vowel; unrounding raises F2 of a back one
    expect(y[1]).toBeLessThan(i[1]); expect(y[1]).toBeGreaterThan(u[1] + 400); expect(y[2]).toBeLessThan(i[2]);
    expect(ø[1]).toBeLessThan(e[1]); expect(ø[1]).toBeGreaterThan(o[1] + 300);
    expect(œ[1]).toBeLessThan(ɛ[1]);
    expect(ɯ[1]).toBeGreaterThan(u[1] + 300);
    expect(ɨ[1]).toBeLessThan(i[1]); expect(ɨ[1]).toBeGreaterThan(u[1]);
    // the front rounded series opens in F1
    expect(y[0]).toBeLessThan(ø[0]); expect(ø[0]).toBeLessThan(œ[0]);
  });

  it('applies the diacritics to the sound', () => {
    expect(phonemeFor('ã')!.art.velum).toBeGreaterThan(0.2);
    expect(phonemeFor('tʰ')!.aspirated).toBe(true);
    expect(phonemeFor('kʷ')!.art.lipRound).toBe(1);
    expect(phonemeFor('tʲ')!.art.tongueX).toBeGreaterThan(0.8);
    expect(phonemeFor('i̥')!.voiced).toBe(false);
    expect(phonemeFor('n̩')!.syllabic).toBe(true);
    expect(phonemeFor('bʱ')!.phonation).toBe('breathy');
    expect(phonemeFor('pʼ')!.airstream).toBe('ejective');
    // dental is closer to the lips than alveolar
    expect(where('t̪').fromLips).toBeLessThan(where('t').fromLips - 0.8);
    // a lowered fricative is an approximant (Spanish β̞ ð̞), a raised trill hisses (Czech ř)
    expect(phonemeFor('β̞')!.manner).toBe('approximant');
    expect(where('r̝').area).toBeLessThan(where('r').area);
    expect(phonemeFor('r̝')!.abduction).toBeGreaterThanOrEqual(0.12);
    // pharyngealization lowers F2 (Arabic emphatics) and leaves the pharynx open
    expect(fmt('tˤ')[1]).toBeLessThan(fmt('t')[1] - 300);
    expect(where('tˤ').fromLips).toBeLessThan(6);
  });

  it('ties two symbols into one sound: affricates, double articulations, diphthongs', () => {
    expect(phonemeFor('t͡ɬ')).toMatchObject({ manner: 'affricate', parts: ['t', 'ɬ'] });
    expect(phonemeFor('a͡ɪ')!.offglide).toBe('ɪ');
    const kp = phonemeFor('k͡p')!;
    const g = computeGeometry({ ...DEFAULT_ARTICULATORS, ...kp.art }, DEFAULT_ANATOMY, DEFAULT_TEETH);
    const closed = g.hits.slice(0, g.lastRay + 1).map((h, j) => ({ closed: h.area < 0.004, fromLips: g.length - g.s[j] })).filter((h) => h.closed);
    expect(closed.some((h) => h.fromLips < 1.5)).toBe(true);
    expect(closed.some((h) => h.fromLips > 8)).toBe(true);
  });
});

/** plays a [phonetic] transcription through the engine, giving the telemetry of each control block */
function play(text: string) {
  const score = buildScore(textToPhones(text, 'it'), { lang: 'it' });
  const e = new VoiceEngine(fs, defaultParams());
  e.snapArticulators(); e.snapPressure(); e.playScore(score);
  const buf = new Float32Array(48);
  const tel: { t: number; area: number; wall: number; voicing: number }[] = [];
  for (let time = 0; time < score.duration; time += 48 / fs) {
    e.process(buf, 48);
    const x = e.telemetry();
    tel.push({ t: time, area: x.constrictionArea, wall: x.levels.wall + x.levels.obstacle, voicing: x.voicingAmp });
  }
  return { score, tel };
}

function closures(text: string, ipa: string): number {
  const { score, tel } = play(text);
  const ph = score.phones.find((q) => q.ipa === ipa)!;
  let n = 0, closed = false;
  for (const x of tel) {
    if (x.t < ph.t0 - 0.02 || x.t > ph.t1 + 0.02) continue;
    const c = x.area < 0.01;
    if (c && !closed) n++;
    closed = c;
  }
  return n;
}

describe('derived sounds in speech', () => {
  it('a raised trill hisses between its contacts (Czech ř), a plain one does not', () => {
    const hiss = (text: string, ipa: string) => {
      const { score, tel } = play(text);
      const ph = score.phones.find((q) => q.ipa === ipa)!;
      const xs = tel.filter((x) => x.t > ph.t0 && x.t < ph.t1);
      return xs.reduce((s, x) => s + x.wall, 0) / xs.length;
    };
    const r = hiss('[ˈara]', 'r'), ř = hiss('[ˈar̝a]', 'r̝');
    note('Czech ř', `turbulence during the trill: /r/ ${r.toExponential(2)}, /r̝/ ${ř.toExponential(2)} (${(20 * Math.log10(ř / Math.max(r, 1e-12))).toFixed(1)} dB more)`);
    expect(ř).toBeGreaterThan(3 * r);
  });

  it('the lips and the dorsum trill as the tip does', () => {
    const lips = closures('[ˈaʙa]', 'ʙ'), uvula = closures('[ˈaʀa]', 'ʀ'), tip = closures('[ˈara]', 'r');
    note('trills', `closures: bilabial ʙ ${lips}, uvular ʀ ${uvula}, alveolar r ${tip}`);
    expect(lips).toBeGreaterThanOrEqual(2);
    expect(uvula).toBeGreaterThanOrEqual(2);
  });

  it('aspirates a stop only where the transcription says so, longer further back', () => {
    const vot = (text: string, ipa: string) => {
      const { score, tel } = play(text);
      const ph = score.phones.find((q) => q.ipa === ipa)!;
      let closed = false, release = -1;
      for (const x of tel) {
        if (x.t > ph.t0 && x.area < 0.005) closed = true;
        if (closed && release < 0 && x.area > 0.02) release = x.t;
        if (release > 0 && x.voicing > 0.5) return x.t - release;
      }
      return NaN;
    };
    const p = vot('[aˈpa]', 'p'), ph = vot('[aˈpʰa]', 'pʰ'), kh = vot('[aˈkʰa]', 'kʰ');
    note('written aspiration', `VOT [p] ${(p * 1000).toFixed(0)} ms, [pʰ] ${(ph * 1000).toFixed(0)} ms, [kʰ] ${(kh * 1000).toFixed(0)} ms`);
    expect(p).toBeLessThan(0.03);
    expect(ph).toBeGreaterThan(0.04);
    expect(kh).toBeGreaterThan(ph);
    // English rules do not touch a [phonetic] transcription
    const s = buildScore(textToPhones('[aˈpa]', 'en'), { lang: 'en' });
    expect(s.phones.some((q) => q.ipa === 'p')).toBe(true);
    expect(buildScore(textToPhones('[aˈpa]', 'en'), { lang: 'en' }).duration).toBeCloseTo(buildScore(textToPhones('[aˈpa]', 'it'), { lang: 'it' }).duration, 6);
  });

  it('murmurs after a breathy-voiced stop and holds the glottis shut through an ejective', () => {
    const s = buildScore(textToPhones('[ˈabʱa]', 'it'));
    const b = s.phones.find((q) => q.ipa === 'bʱ')!;
    const after = s.frames.filter((f) => f.t > b.t1 && f.t < b.t1 + 0.05);
    expect(Math.max(...after.map((f) => f.abduction))).toBeGreaterThan(0.2);
    const e = buildScore(textToPhones('[ˈapʼa]', 'it'));
    const pe = e.phones.find((q) => q.ipa === 'pʼ')!;
    expect(e.frames.filter((f) => f.t > pe.t0 + 0.02 && f.t < pe.t1).every((f) => (f.gate ?? 1) === 0)).toBe(true);
  });

  it('a prenasalized stop starts with a short nasal', () => {
    const s = buildScore(textToPhones('[ˈaᵐba]', 'it'));
    const m = s.phones.find((q) => q.ipa === 'm')!;
    expect(m.t1 - m.t0).toBeLessThan(0.05);
  });
});

describe('dental consonants', () => {
  it('close with the tip on the back of the upper incisors, in front of the alveolars, with no note', () => {
    const alveolar = constrictionOf(phonemeFor('t')!.art).fromLips;
    for (const s of ['t̪', 'd̪', 'n̪']) {
      const c = constrictionOf(phonemeFor(s)!.art);
      expect(notesForIpa(s), s).toEqual([]);
      expect(c.area, s).toBeLessThan(0.004);
      expect(c.fromLips, s).toBeLessThan(alveolar - 1.5);
    }
    // the dental click stays laminal, its blade up to the ridge
    expect(notesForIpa('ǀ')).toEqual([]);
  });
});

describe('Czech ř', () => {
  /** the contacts of a trill, and its open phases between the first and the last contact: widest passage and mean hiss */
  const phases = (text: string, ipa: string) => {
    const { score, tel } = play(text);
    const ph = score.phones.find((q) => q.ipa === ipa)!;
    const xs = tel.filter((x) => x.t >= ph.t0 && x.t <= ph.t1);
    const shut = xs.map((x) => x.area < 0.004);
    const first = shut.indexOf(true), last = shut.lastIndexOf(true);
    const open = xs.slice(first, last + 1).filter((x) => x.area >= 0.004);
    return {
      contacts: closures(text, ipa),
      widest: open.reduce((m, x) => Math.max(m, x.area), 0),
      hiss: open.length ? open.reduce((s, x) => s + x.wall, 0) / open.length : 0,
    };
  };

  it('is laminal, with the body of the tongue raised behind the blade', () => {
    const r = phonemeFor('r')!, ř = phonemeFor('r̝')!;
    expect(ř.art.tongueY!).toBeGreaterThan(0.8);
    expect(constrictionOf(ř.art).fromLips).toBeLessThan(constrictionOf(r.art).fromLips);
    expect(ř.flick?.open).toBeGreaterThan(0);
  });

  it('trills with one to a few contacts, and between them opens only into a narrow channel that hisses', () => {
    const r = phases('[ˈreka]', 'r'), ř = phases('[ˈr̝eka]', 'r̝'), tři = phases('[ˈtr̝̊i]', 'r̝̊');
    note('Czech ř', `contacts: ř in [ˈr̝eka] ${ř.contacts}, r̝̊ in [ˈtr̝̊i] ${tři.contacts}, r in [ˈreka] ${r.contacts}; widest open phase ř ${ř.widest.toFixed(2)} cm² against r ${r.widest.toFixed(2)}; hiss of the open phases ${(20 * Math.log10(ř.hiss / Math.max(r.hiss, 1e-12))).toFixed(1)} dB above r`);
    for (const x of [ř, tři]) {
      expect(x.contacts).toBeGreaterThanOrEqual(1);
      expect(x.contacts).toBeLessThanOrEqual(4);
      // a fricative's channel, not an approximant's (0.3 cm²)
      expect(x.widest).toBeLessThan(0.2);
    }
    expect(ř.contacts).toBeGreaterThanOrEqual(2);
    expect(ř.hiss).toBeGreaterThan(3 * r.hiss);
  });
});
