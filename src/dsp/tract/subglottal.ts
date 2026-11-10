import { AreaFunction } from './areaFunction';
import { formants, resolveOptions, transferAt } from './acoustics';

/**
 * The airways below the glottis: the trachea and the first bronchi.
 *
 * They are a tube too, with resonances of its own. Seen from the glottis it
 * is closed at the top (the folds) and open at the bottom, where the airways
 * have divided into so many that their total section opens out: the
 * resonances measured through the skin of the neck of young men are at 554,
 * 1327 and 2179 Hz on average, and a uniform tube closed at the glottis and
 * open at its lower end describes them (Lulich et al. 2012). While the
 * glottis is shut the voice does not know they are there. Open, in a breathy
 * voice, in a whisper, in an aspirated consonant, the two tubes are joined
 * through it: the source drives both, the waves of the mouth leak down, and
 * the spectrum takes the dips and the extra peaks of the tube below.
 *
 * The tube is the trachea (1.8 cm wide, 12 cm long) and three generations of
 * bronchi, each airway dividing into a larger and a smaller one, with the
 * diameters and lengths of Florens, Sapoval & Filoche (2011, Table 1). For
 * plane waves the airways of one generation are one tube with the sum of
 * their sections and of their walls. It ends after the third generation,
 * 19.5 cm below the glottis, in an open end (the radiation of a piston of
 * its section): where the measured resonances put the end of the tube, not
 * where the airways end. Its walls yield as those of the tract above do
 * (the same mass, resistance and stiffness per unit area), which lifts the
 * first resonance from 469 to 520 Hz.
 *
 * The engine does not run this tube section by section, as it runs the
 * tract: it keeps what the glottis sees of it, the pressure the tube
 * answers with under the folds to the flow that leaves it. That answer is a
 * sum of resonances, each a peak of the impedance at the closed end; their
 * frequencies, widths and heights are read off the frequency-domain model of
 * the tube, once.
 */

/** the trachea of an adult (cm) */
const TRACHEA = { diameter: 1.8, length: 12 };
/**
 * The bronchi, generation by generation: the diameter of the larger and of
 * the smaller daughter against their parent's, and the length of an airway
 * against its diameter (Florens, Sapoval & Filoche 2011, Table 1,
 * generations 1 to 3).
 */
const BRONCHI = [
  { major: 0.87, minor: 0.69, length: 3.07 },
  { major: 0.80, minor: 0.67, length: 1.75 },
  { major: 0.83, minor: 0.67, length: 1.43 },
];

/** the airways of one generation as one tube: its length (cm), the sum of their sections (cm^2) and of their perimeters (cm) */
export interface Airways { length: number; area: number; perimeter: number; tubes: number }

/** The trachea and the generations of bronchi below it, for a speaker of the given size. */
export function subglottalAirways(scale = 1): Airways[] {
  let d = [TRACHEA.diameter * scale];
  const out: Airways[] = [{ length: TRACHEA.length * scale, area: (Math.PI * d[0] * d[0]) / 4, perimeter: Math.PI * d[0], tubes: 1 }];
  for (const g of BRONCHI) {
    const next: number[] = [];
    for (const x of d) next.push(x * g.major, x * g.minor);
    d = next;
    let area = 0, perimeter = 0, len = 0;
    for (const x of d) {
      const a = (Math.PI * x * x) / 4;
      area += a; perimeter += Math.PI * x;
      // the wider airways carry more of the wave
      len += a * g.length * x;
    }
    out.push({ length: len / area, area, perimeter, tubes: d.length });
  }
  return out;
}

/** how many sections of length dx the airways take */
function sectionsOf(airways: Airways[], dx: number): number {
  let length = 0;
  for (const a of airways) length += a.length;
  return Math.max(4, Math.round(length / dx));
}

/** the generation that section i (of length dx) lies in */
function airwayAt(airways: Airways[], x: number): Airways {
  let from = 0;
  for (const a of airways) {
    if (x < from + a.length) return a;
    from += a.length;
  }
  return airways[airways.length - 1];
}

/**
 * The airways as an area function for the frequency-domain model, from the
 * glottis (its closed end) down to their open end (its "lips").
 */
export function subglottalAreaFunction(dx: number, scale = 1): AreaFunction {
  const airways = subglottalAirways(scale);
  const n = sectionsOf(airways, dx);
  const areas = new Float64Array(n), shape = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = airwayAt(airways, (i + 0.5) * dx);
    areas[i] = a.area;
    shape[i] = a.perimeter / (2 * Math.sqrt(Math.PI * a.area));
  }
  return { areas, length: n * dx, dx, teethIndex: n - 3, lipsIndex: n - 2, shape, soft: shape.slice() };
}

/** a resonance of the airways seen from the glottis: its frequency and width (Hz) and the height of the impedance there (dyn s/cm^5) */
export interface SubglottalMode { f: number; bw: number; r: number }

/** the resonances heard: above this the airways are left as they were, a plain pressure (Hz) */
const MODES_BELOW = 4000;
let adult: SubglottalMode[] | null = null;

/**
 * The resonances of the airways below the glottis, for a speaker of the
 * given size: the peaks of the impedance their tube shows at its closed end.
 * All its lengths go with the size, so the frequencies and the widths go
 * with its inverse, and the impedance with the inverse of the sections.
 */
export function subglottalModes(scale = 1): SubglottalMode[] {
  if (!adult) {
    const af = subglottalAreaFunction(0.2);
    const o = resolveOptions(af, { piriform: false });
    const prof = { p: new Float64Array(af.areas.length + 1), u: new Float64Array(af.areas.length + 1) };
    adult = formants(af, { piriform: false }, MODES_BELOW, 10).map((m) => {
      transferAt(af, m.f, o, prof);
      return { f: m.f, bw: m.bw, r: prof.p[0] / prof.u[0] };
    });
  }
  return adult.map((m) => ({ f: m.f / scale, bw: m.bw / scale, r: m.r / (scale * scale) }));
}

const MAX_MODES = 8;

/**
 * The airways below the glottis as the folds meet them: for a flow U that
 * leaves them upwards through the glottis, the pressure under the folds
 * (above the lungs' own) is
 *   p = 2 a - z U
 * where z U is what the resonances answer at once and 2 a what they hold
 * from the flows before. Each resonance is a band-pass of the flow (a mass,
 * a spring and a loss in parallel) with the peak, the width and the height
 * of its mode. The same two numbers a tube would give at its end (its
 * characteristic impedance and twice the wave arriving), so the glottis
 * joins this to the tract as it would join a second waveguide.
 */
export class SubglottalTract {
  /** what the airways answer at once, per unit of flow (dyn s/cm^5) */
  z = 0;
  /** half the pressure held under the folds from the flows before */
  up = 0;
  private modes: SubglottalMode[] = [];
  private g = new Float64Array(MAX_MODES);
  private a1 = new Float64Array(MAX_MODES);
  private a2 = new Float64Array(MAX_MODES);
  private s1 = new Float64Array(MAX_MODES);
  private s2 = new Float64Array(MAX_MODES);
  private count = 0;
  private fs = 0;
  private scale = 0;

  reset(): void { this.s1.fill(0); this.s2.fill(0); this.up = 0; }

  /** The resonances at the rate fs, for a speaker of the given size. */
  configure(fs: number, scale: number): void {
    if (fs === this.fs && scale === this.scale) return;
    if (scale !== this.scale) this.modes = subglottalModes(scale);
    this.fs = fs; this.scale = scale;
    this.count = Math.min(MAX_MODES, this.modes.length);
    let z = 0;
    for (let k = 0; k < this.count; k++) {
      const m = this.modes[k];
      const w = (2 * Math.PI * m.f) / fs;
      const alpha = (Math.sin(w) * m.bw) / (2 * m.f);
      this.g[k] = (m.r * alpha) / (1 + alpha);
      this.a1[k] = (-2 * Math.cos(w)) / (1 + alpha);
      this.a2[k] = (1 - alpha) / (1 + alpha);
      z += this.g[k];
    }
    this.z = z;
  }

  /** One sample: `down` is `up` less the answer to the flow that left (see Waveguide.step). */
  step(down: number): void {
    if (this.z <= 0) return;
    // the flow into the airways
    const x = (down - this.up) / this.z;
    const g = this.g, a1 = this.a1, a2 = this.a2, s1 = this.s1, s2 = this.s2;
    let held = 0;
    for (let k = 0; k < this.count; k++) {
      const y = g[k] * x + s1[k];
      s1[k] = s2[k] - a1[k] * y;
      s2[k] = -g[k] * x - a2[k] * y;
      held += s1[k];
    }
    this.up = 0.5 * held;
  }
}
