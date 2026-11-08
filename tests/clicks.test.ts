import { describe, it, expect } from 'vitest';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { note } from './helpers';

const fs = 48000, F = 48; // 1 ms frames
/** sounds with no burst of their own: a click inside them is an artefact */
const SMOOTH = new Set(['a', 'e', 'ɛ', 'i', 'o', 'ɔ', 'u', 'l', 'm', 'n', 'ɲ', 'ʎ', 'j', 'w']);

describe('no clicks in running speech', () => {
  it('the piriform fossae follow the larynx from one junction to the next without a click', () => {
    const sc = buildScore(textToPhones('la luna e le stelle', 'it'), { lang: 'it' });
    const e = new VoiceEngine(fs, defaultParams());
    e.snapArticulators(); e.snapPressure(); e.playScore(sc);
    const wg = (e as unknown as { wg: { blindAt: Int32Array } }).wg;
    const n = Math.round((sc.duration + 0.1) * fs), out = new Float32Array(n);
    let moves = 0, at = -2;
    for (let i = 0; i < n; i += F) {
      e.process(out.subarray(i, Math.min(n, i + F)), Math.min(F, n - i));
      if (at >= 0 && wg.blindAt[0] >= 0 && wg.blindAt[0] !== at) moves++;
      if (wg.blindAt[0] >= 0) at = wg.blindAt[0];
    }
    // the energy of the second difference (above about 6 kHz) and the level, per ms
    const m = Math.floor(n / F), hf = new Float64Array(m), lvl = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let h = 0, a = 0;
      for (let k = Math.max(2, i * F); k < (i + 1) * F; k++) { const d = out[k] - 2 * out[k - 1] + out[k - 2]; h += d * d; a += out[k] * out[k]; }
      hf[i] = 10 * Math.log10(h / F + 1e-14); lvl[i] = 10 * Math.log10(a / F + 1e-14);
    }
    const peak = Math.max(...lvl);
    let worst = 0, where = '';
    for (let i = 20; i < m - 20; i++) {
      const ph = sc.phones.find((p) => i / 1000 >= p.t0 && i / 1000 < p.t1);
      if (!ph || !SMOOTH.has(ph.ipa) || lvl[i] < peak - 15) continue;
      const around = [...hf.slice(i - 20, i - 3), ...hf.slice(i + 4, i + 21)].sort((x, y) => x - y);
      const rise = hf[i] - around[around.length >> 1];
      if (rise > worst) { worst = rise; where = `${ph.ipa} at ${(i / 1000).toFixed(3)} s`; }
    }
    note('clicks', `"la luna e le stelle": piriform junction moved ${moves} times; loudest transient inside a vowel or sonorant +${worst.toFixed(0)} dB above its surroundings (${where}), was +41 dB when a move zeroed the branch`);
    expect(moves).toBeGreaterThanOrEqual(1);
    expect(worst).toBeLessThan(30);
  });
});
