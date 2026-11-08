import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { phonemeFor } from '../src/dsp/speech/derive';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { IPA_CONSONANTS, IPA_VOWELS } from '../src/dsp/speech/ipa';
import { loadEnglishLexicon } from './helpers';

/**
 * Fingerprints of what the speech planner makes today: the score of a few
 * sentences that cover its parts (Italian and English rules, a literal
 * transcription, ejectives and implosives, clicks, tones, trills, murmur and
 * prenasalized stops) and the posture of every sound of the chart. A change
 * that is meant to leave speech as it is (moving constants into a style,
 * adding a voice's habits that default to none) must leave them alone; a
 * change of sound shows up here first, and the snapshot is updated on purpose.
 */
const round = (_k: string, v: unknown) => (typeof v === 'number' ? Number(v.toPrecision(7)) : v);
const hash = (x: unknown) => createHash('sha1').update(JSON.stringify(x, round)).digest('hex').slice(0, 16);

const SENTENCES: [string, string][] = [
  ['la luna e le stelle', 'it'],
  ['ciao, come stai?', 'it'],
  ['piove in città oggi?', 'it'],
  ['la terra è rossa', 'it'],
  ['hello there', 'en'],
  ['is it raining?', 'en'],
  ['[ˈapʼa ˈɓa]', 'it'],
  ['[ǃa ǁa]', 'it'],
  ['[ma˥ ma˩ ma˧˥]', 'it'],
  ['[ˈr̝eka tr̝i]', 'it'],
  ['[ˈabʱa ˈaᵐba]', 'it'],
];

/** the sounds of the chart, the language tables and a few made with diacritics */
const SYMBOLS = [...new Set([
  ...Object.keys(PHONEMES), ...Object.keys(IPA_CONSONANTS), ...Object.keys(IPA_VOWELS),
  't̪', 'd̪', 'n̪', 'r̝', 'r̝̊', 'kʼ', 'ɓ', 'bʱ', 'ã', 'tʰ', 'ɫ', 'sʲ', 'tˤ', 'ʔ',
])];

describe('golden fingerprints of the speech planner', () => {
  beforeAll(() => { loadEnglishLexicon(); });

  it('scores of sentences across the planner', () => {
    const out: Record<string, { duration: number; frames: number; phones: string; score: string }> = {};
    for (const [text, lang] of SENTENCES) {
      const sc = buildScore(textToPhones(text, lang), { lang });
      out[`${lang} ${text}`] = { duration: Number(sc.duration.toPrecision(7)), frames: sc.frames.length, phones: sc.phones.map((p) => p.ipa).join(' '), score: hash(sc) };
    }
    expect(out).toMatchSnapshot();
  });

  it('postures of every sound', () => {
    const out: Record<string, string> = {};
    for (const s of SYMBOLS) {
      const ph = phonemeFor(s);
      if (!ph) continue;
      const { examples: _e, ...rest } = ph as typeof ph & { examples?: string };
      out[s] = hash(rest);
    }
    expect(Object.keys(out).length).toBeGreaterThan(120);
    expect(out).toMatchSnapshot();
  });
});
