import { describe, it, expect } from 'vitest';
import { parseIpaDict, normalizeIpa, g2pWord, byteTokens, phonemize, resolve, setDictionary, G2PNet, tokenize } from '../src/dsp/speech/phonemizer';
import { speechLanguage, SPEECH_LANGUAGES } from '../src/dsp/speech/languages';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { note } from './helpers';

/** A network that spells out a fixed answer for each input, one byte per step, then the end token. */
function scripted(answers: Record<string, string>): G2PNet & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async next(input, output) {
      const text = new TextDecoder().decode(Uint8Array.from(input.map((t) => t - 3)));
      if (output.length === 1) asked.push(text);
      const want = [...new TextEncoder().encode(answers[text] ?? '')].map((b) => b + 3).concat(1);
      const scores = new Float32Array(259);
      scores[want[output.length - 1] ?? 1] = 1;
      return scores;
    },
  };
}

describe('phonemizer: text and language to IPA', () => {
  it('reads the ipa-dict format: the first pronunciation of each word', () => {
    const d = parseIpaDict('bonjour\t/bɔ̃ʒuʁ/\nest\t/ɛ/, /ɛst/\n\nbad line\nÇa\t/sa/\n');
    expect(d.get('bonjour')).toBe('bɔ̃ʒuʁ');
    expect(d.get('est')).toBe('ɛ');
    expect(d.get('ça')).toBe('sa');
    expect(d.size).toBe(3);
  });

  it('normalizes what the sources write: colons, tone-accent digits, syllable spaces, the fixes of a language', () => {
    expect(normalizeIpa('tsʰa:m˩˧')).toBe('tsʰaːm˩˧');
    expect(normalizeIpa('²blˈeːknar')).toBe('blˈeːknar');
    expect(normalizeIpa('joʊ˥˥ ʐoʊ˧˥')).toBe('joʊ˥˥.ʐoʊ˧˥');
    expect(normalizeIpa('zɐt͡ɕis⁽ʲ⁾lʲət')).toBe('zɐt͡ɕisʲlʲət');
    expect(normalizeIpa('ˈʃpɾaxə', speechLanguage('de'))).toBe('ˈʃpʁaxə');
  });

  it('runs the model greedily on bytes, with the language prefix, until the end token', async () => {
    expect(byteTokens('a')).toEqual([100]);
    const net = scripted({ '<fra>: bonjour': 'bɔ̃ʒuʁ' });
    expect(await g2pWord(net, 'fra', 'bonjour')).toBe('bɔ̃ʒuʁ');
    expect(net.asked).toEqual(['<fra>: bonjour']);
  });

  it('splits words and punctuation for each script: spaces, Chinese, the Greek question mark', () => {
    expect(tokenize('Bonjour, ça va ?', 'fr')).toEqual([{ word: 'bonjour' }, { pause: 'short' }, { word: 'ça' }, { word: 'va' }, { pause: 'long', question: true }]);
    expect(tokenize('j’ai', 'fr')).toEqual([{ word: "j'ai" }]);
    expect(tokenize('τι κάνεις;', 'el').at(-1)).toEqual({ pause: 'long', question: true });
    expect(tokenize('我有3个', 'zh').some((t) => t.number === '3')).toBe(true);
  });

  it('a dictionary language: words from the dictionary, the rest from the model, said as written', async () => {
    setDictionary('fr_FR', parseIpaDict('bonjour\t/bɔ̃ʒuʁ/\ncomment\t/kɔmɑ̃/\nça\t/sa/\nva\t/va/\n'));
    const before = phonemize('Bonjour, comment ça va, Mireille ?', 'fr');
    expect(before.missing).toEqual(['mireille']);
    expect(before.dictionaryWords).toBe(4);
    const net = scripted({ '<fra>: mireille': 'miʁɛj' });
    await resolve('Bonjour, comment ça va, Mireille ?', 'fr', { dictionary: async () => { throw new Error('not needed'); }, model: async () => net });
    const r = phonemize('Bonjour, comment ça va, Mireille ?', 'fr');
    expect(r.missing).toEqual([]);
    expect(r.modelWords).toEqual(['mireille']);
    const ph = r.phones;
    expect(ph.every((p) => p.literal)).toBe(true);
    expect(ph.filter((p) => p.wordStart).length).toBe(5);
    // French stress falls on the last syllable of the word
    const bonjour = ph.slice(0, ph.findIndex((p) => p.wordEnd) + 1);
    expect(bonjour.filter((p) => p.stress).map((p) => p.ipa)).toEqual(['u']);
    expect(ph.find((p) => p.pause === 'short')?.ipa).toBe('ʁ');
    expect(ph[ph.length - 1].question).toBe(true);
    // the same through the panel's entry point, and into a score
    expect(textToPhones('Bonjour, comment ça va, Mireille ?', 'fr').map((p) => p.ipa).join('')).toBe(ph.map((p) => p.ipa).join(''));
    const score = buildScore(ph, { lang: 'fr' });
    note('phonemizer', `French: ${ph.map((p) => (p.stress ? 'ˈ' : '') + p.ipa + (p.wordEnd ? ' ' : '')).join('')}, ${score.duration.toFixed(2)} s`);
    expect(score.duration).toBeGreaterThan(1);
  });

  it('a language written without spaces: the longest dictionary words, the model for what is left', async () => {
    setDictionary('zh_hans', parseIpaDict('你好\t/ni˨˩˦ xɑʊ˨˩˦/\n世界\t/ʂɻ̩˥˩ tɕjɛ˥˩/\n'));
    const net = scripted({ '<zho-s>: 呢': 'nɤ' });
    await resolve('你好世界呢', 'zh', { dictionary: async () => '', model: async () => net });
    const r = phonemize('你好世界呢', 'zh');
    expect(r.missing).toEqual([]);
    expect(net.asked).toEqual(['<zho-s>: 呢']);
    // tones are read, and no stress is added to a tone language
    expect(r.phones.filter((p) => p.tone).length).toBeGreaterThanOrEqual(4);
    expect(r.phones.some((p) => p.stress)).toBe(false);
  });

  it('a language without a dictionary goes to the model whole, and numbers are reported, not read', async () => {
    const net = scripted({ '<pol>: dzień': 'd͡ʑɛɲ', '<pol>: dobry': 'dɔbrɨ' });
    await resolve('Dzień dobry 7', 'pl', { dictionary: async () => '', model: async () => net });
    const r = phonemize('Dzień dobry 7', 'pl');
    expect(r.modelWords).toEqual(['dzień', 'dobry']);
    expect(r.numbers).toEqual(['7']);
    // Polish stress: the penultimate syllable
    const dobry = r.phones.slice(r.phones.findIndex((p, i) => i > 0 && p.wordStart));
    expect(dobry.find((p) => p.stress)?.ipa).toBe('ɔ');
  });

  it('every language has a unique code and a model prefix of the trained set', () => {
    const codes = SPEECH_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const l of SPEECH_LANGUAGES) expect(l.model).toMatch(/^[a-z]{3}(-[a-z]+)?$/);
  });
});
