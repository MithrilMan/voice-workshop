import { describe, it, expect } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { VoiceDesign, withField } from '../src/dsp/voice/design';
import { phonemeFor } from '../src/dsp/speech/derive';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { analyse, clock } from '../src/dsp/voice/copy';
import { sayingOf, planned, heard, deliveryOf, deliveryDistance, gapBetween, fitDelivery, Saying } from '../src/dsp/voice/delivery';
import { note } from './helpers';

const FS = 16000;
const TEXTS = [
  'la luna piena sale sopra il mare.',
  'il gatto dorme sul divano, e il cane lo guarda.',
  'vuoi venire con noi domani?',
  'ho comprato il pane, il latte e la frutta.',
  'dove hai messo le chiavi della macchina?',
  'domani partiamo presto, se non piove.',
];
const OTHER = [
  'la nave lascia il porto di sera.',
  'hai visto il film di ieri?',
  'se vuoi, ti porto un libro nuovo.',
];
const LONG = [
  'la casa di mio nonno in montagna è molto grande e piena di vecchi libri.',
  'il treno che parte da milano alle sette arriva a roma prima di mezzogiorno.',
  'i ragazzi della scuola hanno preparato una festa per la fine del mese.',
];
const man = builtinVoice('man')!.design;
const set = (d: VoiceDesign, fields: Record<string, number>) => Object.entries(fields).reduce((v, [path, x]) => withField(v, path, x), d);
const say = (d: VoiceDesign, texts: string[]): Saying[] => texts.map((t) => {
  const phones = textToPhones(t, 'it'), u = utterance(d, phones, 'it');
  return sayingOf(phones, u.score.phones, planned(u.score));
});

describe('the delivery of a voice', () => {
  it('has figures that follow the fields they stand for', () => {
    const base = deliveryOf(say(man, TEXTS));
    const of = (fields: Record<string, number>) => deliveryOf(say(set(man, fields), TEXTS));
    const accent = of({ 'speaking.accent': man.speaking.accent + 4 });
    const fall = of({ 'speaking.style.finalFall': 6 }), rise = of({ 'speaking.style.questionRise': 3 });
    const comma = of({ 'speaking.style.continuation': 5 }), pause = of({ 'speaking.style.pauseShort': 0.4 });
    const fast = of({ 'speaking.rate': man.speaking.rate * 1.2 }), high = of({ 'speaking.f0': man.speaking.f0 * 1.25 });
    note('delivery figures', `the man on six Italian sentences: pitch ${base.pitch.toFixed(0)} Hz, range ${base.range.toFixed(1)} st, an accented vowel ${base.accent.toFixed(1)} st over its neighbours (${accent.accent.toFixed(1)} with 4 st more of accent), from a vowel to the next ${base.step.toFixed(1)} st rms (${accent.step.toFixed(1)}), the last vowel before a full stop ${base.endStop.toFixed(1)} st (${fall.endStop.toFixed(1)} with a final fall of 6 st), of a yes/no question ${base.endQuestion.toFixed(1)} st (${rise.endQuestion.toFixed(1)} with a rise of 3 st), before a comma ${base.endComma.toFixed(1)} st (${comma.endComma.toFixed(1)} with a continuation of 5 st), the pause at a comma ${base.pauseComma.toFixed(2)} s (${pause.pauseComma.toFixed(2)} at 0.4 s), ${base.rate.toFixed(1)} sounds a second (${fast.rate.toFixed(1)} at 1.2 times the pace)`);
    expect(accent.accent).toBeGreaterThan(base.accent + 1.5);
    expect(accent.step).toBeGreaterThan(base.step + 0.5);
    expect(fall.endStop).toBeLessThan(base.endStop - 0.5);
    expect(rise.endQuestion).toBeLessThan(base.endQuestion - 2);
    expect(comma.endComma).toBeGreaterThan(base.endComma + 0.2);
    // the stress of the last word of a phrase («mare», «guarda», «domani»): half as long again, and only that figure moves
    const tail = of({ 'speaking.style.lastStressLengthening': 0.5 });
    expect(tail.lastStressLength / base.lastStressLength).toBeGreaterThan(1.4);
    expect(tail.lastLength).toBeCloseTo(base.lastLength, 6);
    // an accent that is held keeps the vowel after it up; the last accent of a statement on top stands over the vowel before it
    const heldUp = of({ 'speaking.style.peakDelay': 1 }), top = of({ 'speaking.style.nuclearPeak': 1 });
    expect(heldUp.afterAccent).toBeGreaterThan(base.afterAccent + 1);
    expect(top.lastAccent).toBeGreaterThan(base.lastAccent + 1);
    // a question that rises on its last stress and falls ends low, and so does a comma with a fall
    expect(of({ 'speaking.style.questionRiseFall': 1 }).endQuestion).toBeLessThan(base.endQuestion - 4);
    expect(of({ 'speaking.style.continuation': -4 }).endComma).toBeLessThan(base.endComma - 1);
    expect(pause.pauseComma).toBeGreaterThan(base.pauseComma + 0.1);
    expect(fast.rate / base.rate).toBeGreaterThan(1.12);
    expect(high.pitch / base.pitch).toBeGreaterThan(1.2);
    expect(high.pitch / base.pitch).toBeLessThan(1.3);
  });

  it('brings a voice to the delivery of another, and it holds on other sentences', () => {
    // the "speaker" is the simulator with other habits: what the fit has to find is known
    const speaker = set(man, {
      'speaking.f0': 128, 'speaking.rate': 1.15, 'speaking.accent': 2, 'speaking.style.phrase': 1.6,
      'speaking.style.finalFall': 5, 'speaking.style.questionRise': 4, 'speaking.style.pauseShort': 0.35,
    });
    const target = deliveryOf(say(speaker, TEXTS));
    const fit = fitDelivery(target, man, (d) => deliveryOf(say(d, TEXTS)));
    const theirs = say(speaker, OTHER), before = gapBetween(say(man, OTHER), theirs), after = gapBetween(say(fit.voice, OTHER), theirs);
    const moved = fit.fields.filter((f) => Math.abs(f.to - f.from) > 1e-9).map((f) => `${f.path.slice(f.path.lastIndexOf('.') + 1)} ${f.from.toFixed(2)} -> ${f.to.toFixed(2)}`).join(', ');
    note('delivery fit', `the man brought to the delivery of a speaker with other habits (f0 128, rate 1.15, accent 2, phrase 1.6, final fall 5, question rise 4, comma pause 0.35), six sentences, ${fit.evaluations} plans of them: distance of the figures ${fit.from.toFixed(2)} -> ${fit.to.toFixed(2)}; fields ${moved}; on three other sentences the vowels ${before.pitch.toFixed(2)} -> ${after.pitch.toFixed(2)} st rms from the speaker's (together ${before.together.toFixed(2)} -> ${after.together.toFixed(2)}), the lengths ${before.length.toFixed(2)} -> ${after.length.toFixed(2)}`);
    expect(fit.to).toBeLessThan(0.25 * fit.from);
    expect(Math.abs(fit.voice.speaking.f0 / 128 - 1)).toBeLessThan(0.04);
    expect(Math.abs(fit.voice.speaking.rate / 1.15 - 1)).toBeLessThan(0.04);
    expect(after.pitch).toBeLessThan(0.5 * before.pitch);
    expect(after.together).toBeGreaterThan(before.together);
    expect(deliveryDistance(deliveryOf(say(fit.voice, OTHER)), deliveryOf(theirs))).toBeLessThan(0.5 * deliveryDistance(deliveryOf(say(man, OTHER)), deliveryOf(theirs)));
  });

  it('leaves alone a field whose figure the sentences do not show', () => {
    // no question to answer yes or no among them: their rise cannot be learnt, and is not spent on the other figures
    const plain = TEXTS.filter((s) => !s.endsWith('?'));
    const speaker = set(man, { 'speaking.accent': 2, 'speaking.style.finalFall': 5 });
    const target = deliveryOf(say(speaker, plain));
    expect(Number.isFinite(target.endQuestion)).toBe(false);
    const fit = fitDelivery(target, man, (d) => deliveryOf(say(d, [...plain, TEXTS[2]])), 2);
    const rise = fit.fields.find((f) => f.path === 'speaking.style.questionRise')!;
    expect(rise.to).toBe(rise.from);
    expect(fit.to).toBeLessThan(fit.from);
    // and a field that ends at an end of its range says so
    const far = fitDelivery({ ...target, pauseComma: 0 }, man, (d) => deliveryOf(say(d, plain)), 2);
    expect(far.fields.find((f) => f.path === 'speaking.style.pauseShort')!.limit).toBe(true);
  });

  it('starts the melody again inside a long phrase, where its predicate starts, and the fit finds the habit', () => {
    const again = set(man, { 'speaking.style.phraseSpan': 2 });
    const a = say(man, LONG), b = say(again, LONG);
    const one = deliveryOf(a), two = deliveryOf(b);
    // "la casa di mio nonno in montagna | è molto grande ...": the same up to the break, higher after it
    const k = textToPhones(LONG[0], 'it').filter((p) => phonemeFor(p.ipa)).findIndex((p) => p.verb);
    const lift = a[0].map((s, i) => (s.vowel && !s.last ? b[0][i].pitch - s.pitch : NaN));
    const before = lift.slice(0, k).filter(Number.isFinite), after = lift.slice(k, k + 12).filter(Number.isFinite);
    const mean = (x: number[]) => x.reduce((p, q) => p + q, 0) / x.length;
    note('melody restart', `three long Italian sentences by the man, one arc each and with an arc every 2 s: late in a phrase the vowels stand ${one.late.toFixed(1)} st and ${two.late.toFixed(1)} st against its earlier ones, the pitch runs down ${(-one.slope).toFixed(1)} and ${(-two.slope).toFixed(1)} st/s; in "${LONG[0]}" the ${before.length} vowels before the predicate move by ${Math.max(...before.map(Math.abs)).toFixed(2)} st at most, the ${after.length} after it stand ${mean(after).toFixed(1)} st higher`);
    expect(k).toBeGreaterThan(10);
    expect(Math.max(...before.map(Math.abs))).toBeLessThan(0.3);
    expect(mean(after)).toBeGreaterThan(1);
    expect(two.late).toBeGreaterThan(one.late + 1);
    // a short sentence holds one arc either way
    expect(say(again, [TEXTS[0]])).toEqual(say(man, [TEXTS[0]]));
    // and a voice with one arc a phrase is brought to a speaker who starts again
    const all = [...TEXTS, ...LONG];
    const fit = fitDelivery(deliveryOf(say(again, all)), man, (d) => deliveryOf(say(d, all)));
    const span = fit.fields.find((f) => f.path === 'speaking.style.phraseSpan')!;
    expect(span.from).toBe(0);
    expect(span.to).toBeGreaterThan(1);
    expect(span.to).toBeLessThan(3);
    expect(fit.to).toBeLessThan(0.25 * fit.from);
  });
  it('reads off the sound what the plan holds', () => {
    const phones = textToPhones(TEXTS[1], 'it'), u = utterance(man, phones, 'it');
    const e = new VoiceEngine(FS, u.params);
    e.snapArticulators(); e.playScore(u.score);
    const y = new Float32Array(Math.round((u.score.duration + 0.15) * FS));
    e.process(y, y.length);
    const a = analyse({ samples: y, fs: FS }, true);
    const fromPlan = sayingOf(phones, u.score.phones, planned(u.score)), fromSound = sayingOf(phones, u.score.phones, heard(a, clock(u.score.phones, a)));
    const gap = gapBetween([fromSound], [fromPlan]), p = deliveryOf([fromPlan]), s = deliveryOf([fromSound]);
    note('delivery from the sound', `"${TEXTS[1]}" by the man, its vowels read off the sound against the plan: ${gap.pitch.toFixed(2)} st rms apart over ${gap.vowels} vowels (together ${gap.together.toFixed(2)}); pitch ${s.pitch.toFixed(0)} Hz against ${p.pitch.toFixed(0)}, an accented vowel over its neighbours ${s.accent.toFixed(1)} st against ${p.accent.toFixed(1)}, the last vowel before the full stop ${s.endStop.toFixed(1)} st against ${p.endStop.toFixed(1)}`);
    expect(gap.vowels).toBeGreaterThan(12);
    expect(gap.pitch).toBeLessThan(1);
    expect(gap.together).toBeGreaterThan(0.9);
    expect(Math.abs(s.pitch / p.pitch - 1)).toBeLessThan(0.03);
    expect(Math.abs(s.accent - p.accent)).toBeLessThan(1);
  });
});
