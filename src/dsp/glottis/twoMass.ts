import { RHO, MU } from '../constants';
import { rootThroughZero } from '../aero/aero';

/**
 * Self-oscillating two-mass model of the vocal folds, in the asymmetric
 * left/right form of Steinecke & Herzel (1995), itself a simplification of
 * Ishizaka & Flanagan (1972). Each fold has a lower mass (1) and an upper
 * mass (2) coupled by a spring; air pressure in the glottis pushes the lower
 * masses apart when the glottis is convergent, elasticity pulls them back:
 * this is the myoelastic-aerodynamic cycle.
 *
 *   m_i x_i'' + r_i x_i' + k_i x_i + H(-a_i) c_i a_i / (2 l) + k_c (x_i - x_j) = F_i
 *   a_i = a0_i + l (x_i,left + x_i,right)
 *   F_1 = l d_1 P_1,  P_1 = dP (1 - (a_min / a_1)^2) if open, dP if closed above,
 *   F_2 = l d_2 P_2,  P_2 = the pressure above the glottis (the flow separates at the narrowest point)
 *
 * Pitch is set by the tension parameter Q, which scales stiffness up and mass
 * down (k -> Q k, m -> m / Q), so every natural frequency scales with Q.
 * Asymmetry between the two folds (Q_left != Q_right) produces subharmonics
 * and irregular, "raspy" phonation (Steinecke & Herzel 1995).
 *
 * The glottal flow is coupled to the vocal tract: given the transglottal
 * driving pressure Q_d and the tract input impedance Z (characteristic
 * impedance of the first section plus viscous loss), the Bernoulli relation
 *   dP = rho U^2 / (2 a_min^2) + (Z + R_visc) U
 * is solved in closed form at every sample (Titze 1984 style).
 */
export interface TwoMassParams {
  /** tension factor (dimensionless), F0 roughly proportional */
  q: number;
  /** left/right asymmetry, Q_l = q (1 + asym/2), Q_r = q (1 - asym/2) */
  asym: number;
  /** rest (pre-phonatory) area of each mass, cm^2; small = pressed, large = breathy */
  a0: number;
  /** thickness of the lower mass, cm */
  d1: number;
  /** length of the folds relative to L_FOLD: the masses, the stiffnesses and the area per displacement scale with it */
  len: number;
}

const M1 = 0.125, M2 = 0.025; // g
const K1 = 80000, K2 = 8000; // dyn/cm
const KC = 25000; // dyn/cm
const R_DAMP = 20; // g/s (damping ratio ~0.1 for mass 1)
const COLL = 3; // collision stiffness factor c_i = 3 k_i
const L_FOLD = 1.4; // cm, length of the folds
const D2 = 0.05; // cm

export class TwoMassGlottis {
  // displacements (cm) and velocities (cm/s): [left1, left2, right1, right2]
  x = new Float64Array(4);
  v = new Float64Array(4);
  params: TwoMassParams = { q: 1, asym: 0, a0: 0.05, d1: 0.25, len: 1 };
  /** glottal areas at the two masses and their minimum, cm^2 */
  a1 = 0.05;
  a2 = 0.05;
  amin = 0.05;
  /** volume velocity between the folds, and beside them, cm^3/s */
  flow = 0;
  leak = 0;
  /** the steady part of the flow beside the folds: what the opening passes under the pressures of the aerodynamics */
  still = 0;
  /** folds held still (no voice): the air still passes */
  hold = false;
  /** pressure on the lower mass, dyn/cm^2 */
  p1 = 0;
  /** true when the glottis is closed */
  closed = false;
  /** shut since the last opening that was counted */
  private shut = false;
  /** set to true on the sample when the folds open after a closure */
  openingEvent = false;
  /** period measurement for pitch tracking (s) */
  lastPeriod = 0;
  private timeSinceOpening = 0;

  reset(): void {
    this.x.fill(0); this.v.fill(0);
    // small asymmetric kick so that oscillation can start
    this.x[0] = 0.002; this.x[2] = 0.002;
    this.flow = 0;
  }

  /**
   * Advances one step of duration dt.
   * @param ps     subglottal (lung) pressure, dyn/cm^2
   * @param po     slowly varying (DC) intraoral pressure above the glottis, dyn/cm^2
   * @param pMinus acoustic pressure wave arriving at the glottis from the tract
   * @param z      characteristic impedance of the first tract section
   * @param uMean  running mean of the flow between the folds (the steady part is handled by
   *               the aerodynamic model, only the rest enters the waveguide)
   * @param pSub   acoustic pressure wave arriving under the folds from the airways below (0: none)
   * @param zSub   characteristic impedance of the airways under the folds (0: the lungs' pressure alone)
   * @param bypass area open beside the folds (the chink between the cartilages, the part of an open glottis
   *               behind the folds), cm^2: its air passes under the same pressure and loads the same tract
   * @returns the flow through the folds and beside them
   */
  step(dt: number, ps: number, po: number, pMinus: number, z: number, uMean: number, pSub = 0, zSub = 0, bypass = 0): number {
    const p = this.params;
    const ql = p.q * (1 + p.asym / 2);
    const qr = p.q * (1 - p.asym / 2);
    const x = this.x, v = this.v;
    const l = L_FOLD * p.len;
    const a0 = p.a0;
    this.a1 = a0 + l * (x[0] + x[2]);
    this.a2 = a0 + l * (x[1] + x[3]);
    const a1 = this.a1, a2 = this.a2;
    const amin = Math.min(a1, a2);
    this.amin = amin;

    // Flow: ps - (po + 2 p- + z (u - uMean)) = rho u^2 / (2 amin^2) + R_visc u,
    // and under the folds the pressure is ps + 2 pSub - zSub (u - uMean): the
    // flow the folds let through draws on the tube below as it loads the one above
    //
    // The tubes carry the sound alone: the steady flow is the aerodynamics'
    // (it is what makes ps and po), so they are loaded with the flow less its
    // steady part. For the folds that is their running mean. For the opening
    // beside them it is what that opening passes under ps - po, known at
    // once: a mean would lag when the glottis opens or the lungs stop, and
    // while it lagged the folds would be driven by a pressure that is not
    // there.
    const zz = z + zSub;
    const still = bypass > 1e-6 ? bypass * Math.sqrt(2 / RHO) * rootThroughZero(ps - po, bypass) : 0;
    this.still = still;
    const ref = uMean + still;
    const drive = ps + 2 * pSub - po - 2 * pMinus + zz * ref;
    let u = 0, leak = 0;
    const a = amin > 1e-6 ? RHO / (2 * amin * amin) : 0;
    const w = amin / l; // glottal width
    const rv = amin > 1e-6 ? Math.min((12 * MU * p.d1) / (l * w * w * w), 1e6) : 0;
    if (bypass <= 1e-6) {
      if (amin > 1e-6) {
        const b = zz + rv;
        if (drive > 0) u = (2 * drive) / (b + Math.sqrt(b * b + 4 * a * drive));
        else u = -(2 * -drive) / (b + Math.sqrt(b * b - 4 * a * drive));
      }
    } else {
      // two ways through under one drop of pressure dP = s^2: the folds'
      // (a u^2 + rv u = dP) and the opening beside them (rho u^2 / (2 B^2) = dP),
      // whose sum loads the tract: s^2 + zz (u_folds + u_beside) = |drive|.
      // The left side grows with s and bends upward: Newton from the two
      // taken as one orifice, three steps
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
      if (amin > 1e-6) uf = (2 * s * s) / (rv + Math.sqrt(rv * rv + 4 * a * s * s));
      const sg = drive < 0 ? -1 : 1;
      u = sg * uf;
      leak = sg * kb * s;
    }
    this.flow = u;
    this.leak = leak;
    const all = u + leak;
    const pSupra = po + 2 * pMinus + z * (all - ref);
    ps += 2 * pSub - zSub * (all - ref);

    // Intraglottal pressures (flow separation at the narrowest point).
    let p1 = 0, p2 = 0;
    if (a1 > 0) {
      if (a2 <= 0) p1 = ps; // closed above: full lung pressure on the lower mass
      else if (a2 < a1) { p1 = ps - (RHO * u * u) / (2 * a1 * a1); p2 = pSupra; } // convergent
      else { p1 = pSupra; p2 = pSupra; } // divergent: jet separates at mass 1
    }
    this.p1 = p1;
    const f1 = l * p.d1 * p1;
    const f2 = l * D2 * p2;

    if (this.hold) { x.fill(0); v.fill(0); }
    else for (let side = 0; side < 2; side++) {
      const q = side === 0 ? ql : qr;
      const i1 = side * 2, i2 = i1 + 1;
      const m1 = (M1 * p.len) / q, m2 = (M2 * p.len) / q;
      const k1 = K1 * p.len * q, k2 = K2 * p.len * q, kc = KC * p.len * q;
      let force1 = f1 - k1 * x[i1] - R_DAMP * v[i1] - kc * (x[i1] - x[i2]);
      let force2 = f2 - k2 * x[i2] - R_DAMP * v[i2] - kc * (x[i2] - x[i1]);
      if (a1 < 0) force1 -= COLL * k1 * (a1 / (2 * l)) + 2 * R_DAMP * v[i1];
      if (a2 < 0) force2 -= COLL * k2 * (a2 / (2 * l)) + 2 * R_DAMP * v[i2];
      // semi-implicit Euler
      v[i1] += (force1 / m1) * dt;
      v[i2] += (force2 / m2) * dt;
      x[i1] += v[i1] * dt;
      x[i2] += v[i2] * dt;
      // guard against numerical blow-up
      if (!(Math.abs(x[i1]) < 1)) { x[i1] = 0; v[i1] = 0; }
      if (!(Math.abs(x[i2]) < 1)) { x[i2] = 0; v[i2] = 0; }
    }

    // Opening events for pitch measurement. The folds count as open again
    // once they have parted by more than a touch: short folds close
    // shallowly and bounce within their closed phase, and each bounce would
    // be taken for a period.
    this.closed = amin <= 0;
    if (this.closed) this.shut = true;
    this.openingEvent = false;
    this.timeSinceOpening += dt;
    if (this.shut && amin > PARTED * p.len) {
      this.shut = false;
      this.openingEvent = true;
      // (the first opening after a silence closes no period)
      this.lastPeriod = this.timeSinceOpening > 0.05 ? 0 : this.timeSinceOpening;
      this.timeSinceOpening = 0;
    }
    if (this.timeSinceOpening > 0.05) this.lastPeriod = 0; // no closures: not periodic
    return all;
  }

  /** Mean displacement of the medial edges, for drawing (cm). */
  get displacements(): { l1: number; l2: number; r1: number; r2: number } {
    return { l1: this.x[0], l2: this.x[1], r1: this.x[2], r2: this.x[3] };
  }
}

/** the glottal area from which folds that were shut count as open again, cm^2 (for folds of a man's length) */
const PARTED = 0.004;

export const TWO_MASS_CONST = { M1, M2, K1, K2, KC, L_FOLD, D2 };
