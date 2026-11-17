import { RHO, MU } from '../constants';
import { rootThroughZero } from '../aero/aero';

/**
 * The folds given as two areas, not as a flow.
 *
 * A kinematic model after Titze (1984, 1989) as extended by Birkholz, Drechsel
 * & Stone (2019, eq. 1-4): each edge of the folds, the lower and the upper, is a
 * rest shape open at the back (a triangle from the vocal processes to the front
 * commissure) plus a half-sine along the length that swings in time, the upper
 * edge late by a phase lag. The area of an edge is what is left open along the
 * length, plus the chink between the cartilages:
 *   L = L0 sqrt(f0 / fnat),  T = T0 L0 / L
 *   x_i(y, t) = xrest_i (1 - y / L) + xmax sin(pi y / L) sin(beta_i(t))
 *   xmax = c rel sqrt(Ptrans) L0 / L        (1 mm at 800 Pa, rest length)
 *   A_i = 2 integral of max(x_i, 0) dy + Achink
 * So the folds shut along their length like a zip; how much of them shuts, and
 * for how long, comes from the swing (pressure, pitch) against the rest
 * opening, and nothing draws the flow: it is solved at every sample from the
 * pressures under and over the folds and the two tubes they load, as for the
 * two-mass folds.
 */
export interface FoldAreaParams {
  /** rest half-width at the vocal processes, lower and upper edge, cm */
  gapLow: number; gapHigh: number;
  /** phase lag of the upper edge, rad */
  lag: number;
  /** skew of the area pulse, -1..1 (0: opening and closing take the same time; more: a slower opening, a faster closing) */
  skew: number;
  /** every second pulse smaller by half of this, 0..1 */
  alternate: number;
  /** length and thickness of the vibrating folds (cm) at the pitch they belong to (Hz) */
  length: number; depth: number; pitch: number;
  /** scale of the swing (1: 1 mm at 800 Pa) */
  swing: number;
}

export const DEFAULT_FOLD_AREAS: Readonly<FoldAreaParams> = Object.freeze({
  gapLow: 0.06, gapHigh: 0.06, lag: (50 * Math.PI) / 180, skew: 0.2, alternate: 0.05, length: 1.2, depth: 0.4, pitch: 200, swing: 1,
});

const N = 24;
const SIN_Y = Float64Array.from({ length: N }, (_, k) => Math.sin((Math.PI * (k + 0.5)) / N));
const REST_Y = Float64Array.from({ length: N }, (_, k) => 1 - (k + 0.5) / N);
/** swing per root of the pressure across the folds: 0.1 cm at 8000 dyn/cm^2 */
const C_SWING = 0.1 / Math.sqrt(8000);

/** the phase bent so that opening and closing take unequal shares of a period (two periods long: 0..4 pi) */
function bend(alpha: number, s: number): number {
  const h = Math.PI / 2;
  const a = [0, (1 + s) * h, Math.PI + (1 - s) * h, 2 * Math.PI + (1 + s) * h, 3 * Math.PI + (1 - s) * h, 4 * Math.PI];
  const b = [0, h, 3 * h, 5 * h, 7 * h, 8 * h];
  for (let i = 0; i < 5; i++) if (alpha <= a[i + 1]) return b[i] + ((b[i + 1] - b[i]) * (alpha - a[i])) / Math.max(a[i + 1] - a[i], 1e-9);
  return b[5];
}

export class FoldAreas {
  params: FoldAreaParams = { ...DEFAULT_FOLD_AREAS };
  /** areas of the lower and upper edge and the smaller of them, cm^2 (the chink included) */
  a1 = 0; a2 = 0; amin = 0;
  length = 1.2; thickness = 0.4; swing = 0;
  /** flow between the folds, beside them, and the steady part of the latter, cm^3/s */
  flow = 0; leak = 0; still = 0;

  /**
   * The two areas at `periods` (0..2: the phase of the lower edge, counted over two periods).
   * `rel` scales the swing (voicing, shimmer), `open` scales the rest opening (a glottis held shut: 0).
   */
  shape(periods: number, f0: number, ptrans: number, rel: number, open: number, chink: number): void {
    const p = this.params;
    const L = p.length * Math.sqrt(Math.max(f0, 20) / p.pitch);
    this.length = L; this.thickness = (p.depth * p.length) / L;
    const xmax = C_SWING * p.swing * Math.max(0, rel) * Math.sqrt(Math.max(0, ptrans)) * (p.length / L);
    this.swing = xmax;
    const two = 4 * Math.PI;
    for (let e = 0; e < 2; e++) {
      let al = periods * 2 * Math.PI - (e ? p.lag : 0);
      al = ((al % two) + two) % two;
      const be = bend(al, p.skew);
      const s = Math.sin(be);
      const d = be <= 1.5 * Math.PI || be >= 3.5 * Math.PI ? xmax * s : xmax * ((1 - p.alternate / 2) * (s + 1) - 1);
      const rest = (e ? p.gapHigh : p.gapLow) * open;
      let sum = 0;
      for (let k = 0; k < N; k++) { const x = rest * REST_Y[k] + d * SIN_Y[k]; if (x > 0) sum += x; }
      const area = (2 * L * sum) / N + chink;
      if (e) this.a2 = area; else this.a1 = area;
    }
    this.amin = Math.min(this.a1, this.a2);
  }

  /**
   * The flow through the areas set by `shape`, under the pressures of the aerodynamics (ps below, po above)
   * and the waves of the two tubes (pMinus from the tract, pSub from below), which it loads with z and zSub.
   * The tubes carry the sound alone, so they are loaded with the flow less its steady part (`uMean` for the
   * folds; for the opening beside them what it passes under ps - po). Same equation as the two-mass folds.
   */
  step(ps: number, po: number, pMinus: number, z: number, uMean: number, pSub = 0, zSub = 0, bypass = 0): number {
    const amin = this.amin, l = this.length;
    const zz = z + zSub;
    const still = bypass > 1e-6 ? bypass * Math.sqrt(2 / RHO) * rootThroughZero(ps - po, bypass) : 0;
    this.still = still;
    const ref = uMean + still;
    const drive = ps + 2 * pSub - po - 2 * pMinus + zz * ref;
    let u = 0, leak = 0;
    const a = amin > 1e-6 ? RHO / (2 * amin * amin) : 0;
    const w = amin / l;
    const rv = amin > 1e-6 ? Math.min((12 * MU * this.thickness) / (l * w * w * w), 1e6) : 0;
    if (bypass <= 1e-6) {
      if (amin > 1e-6) {
        const b = zz + rv;
        if (drive > 0) u = (2 * drive) / (b + Math.sqrt(b * b + 4 * a * drive));
        else u = -(2 * -drive) / (b + Math.sqrt(b * b - 4 * a * drive));
      }
    } else {
      // the folds and the opening beside them share one drop: solved for its root s by a few Newton steps
      const d = Math.abs(drive), kb = bypass * Math.sqrt(2 / RHO);
      const at = RHO / (2 * (Math.max(amin, 0) + bypass) ** 2);
      let s = Math.sqrt(at) * ((2 * d) / (zz + Math.sqrt(zz * zz + 4 * at * d)));
      let uf = 0;
      for (let it = 0; it < 3; it++) {
        let duf = 0;
        if (amin > 1e-6) {
          const D = Math.sqrt(rv * rv + 4 * a * s * s);
          uf = (2 * s * s) / (rv + D);
          duf = (4 * s) / (rv + D) - (8 * a * s * s * s) / (D * (rv + D) * (rv + D) + 1e-30);
        }
        const F = s * s + zz * (kb * s + uf) - d;
        s = Math.max(0, s - F / (2 * s + zz * (kb + duf) + 1e-12));
      }
      if (amin > 1e-6) uf = (2 * s * s) / (rv + Math.sqrt(rv * rv + 4 * a * s * s)); else uf = 0;
      const sg = drive < 0 ? -1 : 1;
      u = sg * uf;
      leak = sg * kb * s;
    }
    this.flow = u; this.leak = leak;
    return u + leak;
  }
}
