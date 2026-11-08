import { describe, it, expect } from 'vitest';
import { readIpa } from '../src/dsp/speech/ipaReader';
import { phonemeFor, notesForIpa } from '../src/dsp/speech/derive';
import { normalizeIpa } from '../src/dsp/speech/phonemizer';
import { SPEECH_LANGUAGES } from '../src/dsp/speech/languages';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';

const lang = (code: string) => SPEECH_LANGUAGES.find((l) => l.code === code)!;
/** what the reader leaves out of a transcription as a source writes it for a language */
const notes = (ipa: string, code?: string) => {
  const s = normalizeIpa(ipa, code ? lang(code) : undefined);
  return { s, notes: [...readIpa(s).notes, ...notesForIpa(s)] };
};

/**
 * Transcriptions as the pronunciation sources write them (the neural model's
 * training lexicons and ipa-dict), one or two per symbol that once went
 * unread: every one is now read whole.
 */
const SAMPLES: [string, string][] = [
  ['sv', 'f9rb}:ds%i:vraren'], ['sv', 'tu0rbUjEtmU%tu:ren`as'], ['sv', 'kvalIte:tsa*Uk%Su:nen`a'],
  ['am', 'dˈəmak`'], ['et', 'prˈes^s^is'], ['mi', 'fˌakaˈu"te'], ['uz', 'kˌʊt͡Slæɾˈyny'], ['sw', 'Aɾimaθaja'],
  ['da', 'tˢyˀ'], ['da', 'sɒˀɒð'], ['vi', 'hwiən˧ˀ˥hwăk˨ˀ˩'], ['ko', 'pɛ̝ks͈ʌ̹ʝja̠ŋ'], ['ja', 'sɯᵝɕi'],
  ['eu', 's̺agar'], ['eu', 's̻oro'], ['km', 'kǝ'],
];

describe('transcriptions of the world’s languages, read whole', () => {
  it('every sample is read without a symbol skipped or ignored', () => {
    for (const [code, ipa] of SAMPLES) {
      const r = notes(ipa, code);
      expect(r.notes.filter((n) => n.kind !== 'approximate'), `${code} ${ipa} -> ${r.s}`).toEqual([]);
    }
  });

  it('the model’s Swedish SAMPA becomes IPA, and the dictionary’s tone digits still go', () => {
    expect(normalizeIpa('f9rb}:ds%i:vraren', lang('sv'))).toBe('fœrbʉːdsˌiːvraren');
    expect(normalizeIpa('kvalIte:tsa*Uk%Su:nen`a', lang('sv'))).toBe('kvalɪteːtsaʊkˌɧuːneɳa');
    // ipa-dict writes Swedish in IPA with the word accents as digits: nothing to map
    expect(normalizeIpa('²ˈanːa', lang('sv'))).toBe('ˈanːa');
  });

  it('each new mark changes the sound it is on', () => {
    // an Amharic ejective, an Estonian palatalized s, a Danish affricated t and its stød
    expect(phonemeFor(readIpa(normalizeIpa('dˈəmak`', lang('am'))).phones.at(-1)!.ipa)!.airstream).toBe('ejective');
    expect(readIpa(normalizeIpa('prˈes^s^is', lang('et'))).phones.map((p) => p.ipa)).toContain('sʲ');
    const da = readIpa(normalizeIpa('tˢyˀ', lang('da'))).phones;
    expect(phonemeFor(da[0].ipa)!.manner).toBe('affricate');
    expect(phonemeFor(da[1].ipa)!.phonation).toBe('creaky');
    // a Vietnamese glottalized tone creaks on its vowel and keeps its contour
    const vi = readIpa('hwiən˧ˀ˥').phones.find((p) => p.tone)!;
    expect(vi.tone).toEqual([3, 5]);
    expect(phonemeFor(vi.ipa)!.phonation).toBe('creaky');
    // the Korean tense s: no breath, a narrow glottis, the larynx up
    const s = phonemeFor('s͈')!;
    expect(s.fortis).toBe(true);
    expect(s.abduction).toBeLessThanOrEqual(0.2);
    expect(s.art.larynx).toBeGreaterThan(0.3);
    // Japanese compressed u: rounded, not protruded
    const u = phonemeFor('ɯᵝ')!;
    expect(u.art.lipRound!).toBeGreaterThan(0.5);
    expect(u.art.lipProtrude!).toBeLessThan(0);
    // Basque apical and laminal s: the tip back or forward
    expect(phonemeFor('s̺')!.art.tipX!).toBeLessThan(phonemeFor('s')!.art.tipX!);
    expect(phonemeFor('s̻')!.art.tipX!).toBeGreaterThan(phonemeFor('s')!.art.tipX!);
    expect(phonemeFor('ǝ')!.ipa).toBe('ǝ');
    expect(phonemeFor('ǝ')!.art).toEqual(phonemeFor('ə')!.art);
  });

  it('a Korean tense consonant holds its closure longer and raises the pitch after it', () => {
    const say = (ipa: string) => buildScore(textToPhones(`[${ipa}]`, 'ko'), { lang: 'ko', f0: 120 });
    const lax = say('ˈsa.da'), tense = say('ˈs͈a.da');
    const cons = (sc: ReturnType<typeof say>) => sc.phones[0].t1 - sc.phones[0].t0;
    const pitch = (sc: ReturnType<typeof say>) => { const v = sc.phones[1]; return sc.frames[Math.round((v.t0 + 0.02) / 0.005)].f0; };
    expect(cons(tense)).toBeGreaterThan(cons(lax) * 1.2);
    expect(12 * Math.log2(pitch(tense) / pitch(lax))).toBeGreaterThan(1.5);
  });
});
