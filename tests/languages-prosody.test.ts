import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { prosodyOf, pronunciationOf, PLAIN_PRONUNCIATION, SPEECH_LANGUAGES } from '../src/dsp/speech/languages';
import type { Score } from '../src/dsp/engine/params';
import { note } from './helpers';

/** the same transcription read as a language of the phonemizer (as written, with that language's prosody) */
const read = (ipa: string, lang: string) => buildScore(textToPhones(`[${ipa}]`, lang), { lang, f0: 120, natural: { micro: false } });
const vowels = (sc: Score) => sc.phones.filter((p) => 'aeiou'.includes(p.ipa[0]));
/** F0 at the middle of a phone, Hz */
const f0Mid = (sc: Score, p: { t0: number; t1: number }) => sc.frames[Math.round((0.5 * (p.t0 + p.t1)) / 0.005)].f0;

describe('each language with its own prosody', () => {
  it('every language of the phonemizer has a profile; Italian and English keep their own rules', () => {
    for (const l of SPEECH_LANGUAGES) expect(prosodyOf(l.code), l.code).toBeDefined();
    expect(prosodyOf('it')).toBeUndefined();
    expect(prosodyOf('en')).toBeUndefined();
    expect(prosodyOf('de')!.rhythm).toBe('stress');
    expect(prosodyOf('es')!.rhythm).toBe('syllable');
    expect(prosodyOf('ja')!.rhythm).toBe('mora');
  });

  it('a stress-timed language squeezes its unstressed vowels, a syllable-timed one keeps them even', () => {
    const ipa = 'ba.ˈna.na.ta.ˈla.ma.ka';
    const ratio = (lang: string) => {
      const sc = read(ipa, lang);
      const v = vowels(sc), d = (p: { t0: number; t1: number }) => p.t1 - p.t0;
      const stressed = [v[1], v[4]], weak = [v[0], v[2], v[3], v[5]];
      return (weak.reduce((s, p) => s + d(p), 0) / weak.length) / (stressed.reduce((s, p) => s + d(p), 0) / stressed.length);
    };
    const de = ratio('de'), es = ratio('es'), ja = ratio('ja');
    note('rhythm', `unstressed / stressed vowel: German ${de.toFixed(2)}, Spanish ${es.toFixed(2)}, Japanese ${ja.toFixed(2)}`);
    expect(de).toBeLessThan(0.55);
    expect(es).toBeGreaterThan(0.7);
    // morae: no stress in the length at all
    expect(ja).toBeGreaterThan(0.95);
  });

  it('a mora-timed language makes a long vowel two short ones', () => {
    const len = (lang: string) => {
      const sc = read('ko.koː.ko', lang);
      const v = vowels(sc);
      return (v[1].t1 - v[1].t0) / (v[0].t1 - v[0].t0);
    };
    note('mora', `long / short vowel: Japanese ${len('ja').toFixed(2)}, Spanish ${len('es').toFixed(2)}`);
    expect(len('ja')).toBeGreaterThan(len('es') * 1.1);
  });

  it('French accents the end of the phrase, not every word', () => {
    const ipa = 'ˈla.ma ˈpa.ta ˈma.la ˈta.pa';
    /** the highest pitch over a word (a late peak may spill onto the syllable after it), Hz */
    const top = (lang: string, word: number) => {
      const sc = read(ipa, lang);
      const v = vowels(sc);
      let m = 0;
      for (const f of sc.frames) if (f.t >= v[2 * word].t0 && f.t <= v[2 * word + 1].t1 + 0.05) m = Math.max(m, f.f0);
      return m;
    };
    const first = 12 * Math.log2(top('es', 0) / top('fr', 0)), last = 12 * Math.log2(top('fr', 3) / top('fr', 2));
    note('phrase accent', `first word: Spanish ${first.toFixed(1)} st above French; French last word ${last.toFixed(1)} st above the one before`);
    // the same words, the same voice: Spanish accents its first word, French does not
    expect(first).toBeGreaterThan(2);
    // French accents the last one
    expect(last).toBeGreaterThan(0.5);
  });

  it('a Hungarian or Greek yes/no question rises on its last stress and falls after it; a Spanish one rises to the end', () => {
    const shape = (lang: string) => {
      const sc = read('ˈla.ma.ta ˈpa.la.ma?', lang);
      const v = vowels(sc), last = v[v.length - 1], nucleus = v[v.length - 3];
      return { peak: f0Mid(sc, nucleus), end: sc.frames[Math.round((last.t1 - 0.01) / 0.005)].f0 };
    };
    const es = shape('es'), hu = shape('hu'), el = shape('el');
    note('questions', `nucleus → end: Spanish ${es.peak.toFixed(0)} → ${es.end.toFixed(0)} Hz, Hungarian ${hu.peak.toFixed(0)} → ${hu.end.toFixed(0)} Hz, Greek ${el.peak.toFixed(0)} → ${el.end.toFixed(0)} Hz`);
    expect(es.end).toBeGreaterThan(es.peak * 1.15);
    for (const q of [hu, el]) {
      expect(q.end).toBeLessThan(q.peak * 0.9);
      expect(q.peak).toBeGreaterThan(es.peak);
    }
  });
});

describe('the pronunciation of a language is data', () => {
  it('English aspirates and lets the tip go slowly, Italian does neither; a language without an entry is said as Italian', () => {
    const en = pronunciationOf('en'), italian = pronunciationOf('it');
    expect(en).toMatchObject({ timing: 'english', aspirated: true, fricatedTip: true, earlyNasal: true, earlyPeak: true });
    expect(en.initialVoicedStop).toBeGreaterThan(italian.initialVoicedStop);
    expect(italian).toEqual({ ...PLAIN_PRONUNCIATION, timing: 'italian' });
    expect(pronunciationOf('xx')).toEqual(italian);
  });

  it('a stop is aspirated because its language says so: the folds are apart after the release of an English /t/, not of an Italian one', () => {
    const apartAfter = (lang: string) => {
      const sc = buildScore(textToPhones('/ˈtata/', lang), { lang, f0: 120, natural: { micro: false } });
      const t = sc.phones.find((p) => p.ipa === 't')!;
      return Math.max(...sc.frames.filter((fr) => fr.t >= t.t1 - 0.03 && fr.t <= t.t1 + 0.01).map((fr) => fr.abduction));
    };
    note('pronunciation', `folds apart around the release of /t/: English ${apartAfter('en').toFixed(2)}, Italian ${apartAfter('it').toFixed(2)}`);
    expect(apartAfter('en')).toBeGreaterThan(apartAfter('it') + 0.1);
  });

  it('no rule of the sequencer names a language', () => {
    const src = readFileSync('src/dsp/speech/sequencer.ts', 'utf8');
    expect(src).not.toMatch(/lang\s*[!=]==|[!=]==\s*'(en|it)'/);
  });
});
