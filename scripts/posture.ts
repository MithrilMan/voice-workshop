/**
 * Narrowest passage of postures given on the command line, for exploring new
 * places of articulation: each argument is a JSON object of articulators laid
 * over schwa (or over a phoneme: {"from":"k","tongueX":-1}).
 *   npx tsx scripts/posture.ts '{"tongueX":-1.2,"tongueY":1.2}' '{"from":"r","tipY":1.4}'
 *   npx tsx scripts/posture.ts '{"from":"k","sweep":"tongueY","lo":0.6,"hi":1.6,"n":6}'
 * Prints the minimum area above the glottis region, where it is (cm from the
 * glottis and from the lips) and the area rule there, the first three
 * formants of the posture, plus the time per geometry.
 */
import { computeGeometry } from '../src/dsp/tract/geometry';
import { sectionsFromGeometry } from '../src/dsp/tract/areaFunction';
import { formants } from '../src/dsp/tract/acoustics';
import { DEFAULT_ANATOMY, DEFAULT_ARTICULATORS, DEFAULT_TEETH, Articulators } from '../src/dsp/tract/types';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { phonemeFor } from '../src/dsp/speech/derive';

export function narrowest(a: Articulators): { area: number; s: number; fromLips: number; rule: string; f: string } {
  const g = computeGeometry(a, DEFAULT_ANATOMY, DEFAULT_TEETH);
  let m = Infinity, ms = 0, rule = '';
  for (let i = 0; i <= g.lastRay; i++) {
    if (g.s[i] < 2.6) continue;
    if (g.hits[i].area < m) { m = g.hits[i].area; ms = g.s[i]; rule = g.hits[i].rule; }
  }
  if (g.slit.area < m) { m = g.slit.area; ms = g.teethPos; rule = 'slit'; }
  const f = formants(sectionsFromGeometry(g), {}, 4000).slice(0, 3).map((x) => x.f.toFixed(0)).join('/');
  return { area: m, s: ms, fromLips: g.length - ms, rule, f };
}

// {"sweep":"tipY","lo":1,"hi":2.2,"n":7, ...posture} prints one line per value
for (const arg of process.argv.slice(2)) {
  const o = JSON.parse(arg) as Partial<Articulators> & { from?: string; sweep?: keyof Articulators; lo?: number; hi?: number; n?: number };
  // a fitted phoneme, or any IPA symbol made from rules
  const from = o.from ? phonemeFor(o.from)?.art ?? {} : {};
  const { sweep, lo = 0, hi = 1, n = 6 } = o;
  delete o.from; delete o.sweep; delete o.lo; delete o.hi; delete o.n;
  const a: Articulators = { ...DEFAULT_ARTICULATORS, ...PHONEMES['ə'].art, ...from, ...o };
  console.log(arg);
  const values = sweep ? Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / Math.max(1, n - 1)) : [NaN];
  for (const x of values) {
    const t0 = performance.now();
    const r = narrowest(sweep ? { ...a, [sweep]: x } : a);
    const ms = performance.now() - t0;
    console.log(`  ${sweep ? `${sweep}=${x.toFixed(2)}  ` : ''}min ${r.area.toFixed(3)} cm2 at ${r.s.toFixed(1)} cm (${r.fromLips.toFixed(1)} from lips, ${r.rule})  F ${r.f}  ${ms.toFixed(2)} ms`);
  }
}
