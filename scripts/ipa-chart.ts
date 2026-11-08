/**
 * The IPA chart as the model makes it: for every symbol (or the ones given)
 * the manner, where the narrowest passage is and how wide, the first three
 * formants of the steady posture, and what is approximate.
 *   npx tsx scripts/ipa-chart.ts            the whole chart
 *   npx tsx scripts/ipa-chart.ts ʂ r̝ y kʷ   some symbols, with diacritics
 */
import { computeGeometry } from '../src/dsp/tract/geometry';
import { sectionsFromGeometry } from '../src/dsp/tract/areaFunction';
import { formants } from '../src/dsp/tract/acoustics';
import { DEFAULT_ANATOMY, DEFAULT_ARTICULATORS, DEFAULT_TEETH } from '../src/dsp/tract/types';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { phonemeFor } from '../src/dsp/speech/derive';
import { IPA_CONSONANTS, IPA_VOWELS, ipaName } from '../src/dsp/speech/ipa';

const list = process.argv.slice(2);
const names = list.length ? list : [...Object.keys(IPA_CONSONANTS), ...Object.keys(IPA_VOWELS)];
const t0 = performance.now();
for (const sym of names) {
  const t = performance.now();
  const p = phonemeFor(sym);
  const ms = performance.now() - t;
  if (!p) { console.log(`${sym.padEnd(4)} not IPA`); continue; }
  const a = { ...DEFAULT_ARTICULATORS, ...PHONEMES['ə'].art, ...p.art };
  const g = computeGeometry(a, DEFAULT_ANATOMY, DEFAULT_TEETH);
  let m = Infinity, at = 0;
  for (let i = 0; i <= g.lastRay; i++) if (g.s[i] >= 2.6 && g.hits[i].area < m) { m = g.hits[i].area; at = g.length - g.s[i]; }
  if (g.teethPos > 0 && g.slit.area < m) { m = g.slit.area; at = g.length - g.teethPos; }
  const f = formants(sectionsFromGeometry(g), {}, 4500).slice(0, 3).map((x) => x.f.toFixed(0)).join('/');
  const tag = PHONEMES[sym] ? 'fitted' : 'rules';
  const extra = [p.flick ? `flick ${p.flick.key}→${p.flick.contact}` : '', p.airstream ?? '', p.approx ? `approx:${p.approx}` : '', p.aspirated ? 'aspirated' : '', p.phonation ?? ''].filter(Boolean).join(' ');
  console.log(`${sym.padEnd(4)} ${tag.padEnd(6)} ${p.manner.padEnd(11)} ${p.voiced ? 'v ' : '- '} min ${m.toFixed(3)} at ${at.toFixed(1)} cm from lips  F ${f.padEnd(15)} ${ms.toFixed(0).padStart(3)} ms  ${extra}  (${ipaName(sym) ?? ''})`);
}
console.log(`${names.length} symbols in ${(performance.now() - t0).toFixed(0)} ms`);
