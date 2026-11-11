import { RHO, NU, C_SOUND, CMH2O } from '../constants';
import { smoothstep } from '../util/math';

/**
 * Slow ("DC") aerodynamics of the airway, after Stevens (1998, ch. 2-3) and
 * Rothenberg: lungs -> glottis -> oral constriction (with the nose in
 * parallel) -> out. Each orifice obeys the Bernoulli law U = A sqrt(2 dP / rho);
 * the oral cavity between them has a compliance C (mostly its yielding walls),
 *   C dPo/dt = U_glottis - U_mouth - U_nose.
 * This gives intraoral pressure build-up during closures, the release burst of
 * stops, and the aerodynamic limits of voicing (no transglottal pressure, no
 * vibration).
 *
 * The walls do not follow the pressure at once: they have mass and they
 * resist (Ishizaka, French & Flanagan 1975). With their constants given, the
 * cavity is its air, small and quick, and beside it the walls, a mass on a
 * damped spring that takes its volume in and gives it back in about ten
 * milliseconds. So at the release of a stop the pressure falls as soon as the
 * passage lets out more than the glottis and the walls can supply, instead of
 * being held up by walls that would empty all at once.
 *
 * Turbulence noise (Stevens 1971, 1998; Flanagan & Cherry 1969; Shadle 1985):
 *  - a jet forms at the narrowest passage, with velocity v = sqrt(2 Po / rho);
 *  - noise appears when the Reynolds number Re = v D / nu exceeds about 1800;
 *  - the equivalent dipole source pressure scales as rho v^3 / c times
 *    sqrt(A) (that is, Stevens' U^3 A^-2.5 law);
 *  - if the jet hits an obstacle (the incisors, for sibilants) the source is
 *    stronger and sits at the obstacle. The share of the jet that hits the
 *    teeth depends on how the jet has spread when it reaches them compared
 *    with the opening of the slit between the incisors.
 *
 * The jet keeps its speed along a potential core, then slows down. A round
 * jet slows like 1/x; the flat jet out of a slit like 1/sqrt(x), until it is
 * a few slit widths long and turns round itself (Sforza, Steiger & Trentacoste
 * 1966). Its size is the hydraulic diameter of the passage, 4 A / P: about
 * twice the height of a slit.
 */

export const RE_CRIT = 1800;
/** reference area for the sqrt(A) source law, cm^2 */
const A_REF = 0.1;
/**
 * The teeth are an obstacle only to a jet aimed at them: one out of a narrow
 * channel close behind them, as in a sibilant (Shadle 1985). Out of a wide
 * passage, or one far back (the tongue of an [h] before a high vowel, of an
 * r-coloured vowel), the jet is spread along the palate before it gets there,
 * and makes its noise on the walls. Areas (cm^2) and distances (cm) over which
 * the aim fades: chosen, not measured, past the passages of the sibilants (up
 * to about 0.23 cm^2, 0.6 cm from the teeth) and of a tip of the tongue
 * letting go of the ridge (0.1-0.37 cm^2, 1.4-1.8 cm), toward those of [h]
 * (0.55 cm^2), of an [ɪ] after it (0.4 cm^2) and of [ɚ] (2.3-2.6 cm).
 */
const AIM_AREA: readonly [number, number] = [0.45, 0.32];
const AIM_DISTANCE: readonly [number, number] = [2.6, 2.0];

export interface JetInfo {
  /** jet velocity at the constriction (cm/s) */
  v: number;
  /** Reynolds number */
  re: number;
  /** hydraulic diameter (cm) */
  dh: number;
  /** distance from the constriction exit to the incisors (cm) */
  toTeeth: number;
  /** jet width when it reaches the teeth (cm) */
  widthAtTeeth: number;
  /** centre-line velocity at the teeth (cm/s) */
  vAtTeeth: number;
  /** fraction of the jet that hits the teeth (0..1) */
  impinge: number;
  /** turbulence onset factor (0..1) */
  onset: number;
  /** equivalent source pressures (dyn/cm^2 rms), before user gains */
  wallSource: number;
  obstacleSource: number;
  /** low-pass corner of the source spectrum (Hz) */
  fc: number;
  fcObstacle: number;
}

export interface AeroInputs {
  /** subglottal (lung) pressure, dyn/cm^2 */
  ps: number;
  /** mean glottal area (cm^2): vibrating glottis average + chink + abduction */
  glottalArea: number;
  /** narrowest oral area (cm^2) */
  oralArea: number;
  /** nasal passage effective area (cm^2) */
  nasalArea: number;
  /** compliance of the cavity behind the constriction, its walls and its air (cm^5/dyn) */
  compliance: number;
  /**
   * the part of that compliance that is the walls, reached through their
   * resistance (dyn s/cm^5) and their mass (g/cm^4). Left out, the walls
   * follow the pressure at once.
   */
  wallCompliance?: number;
  wallResistance?: number;
  wallMass?: number;
  /**
   * rate of change of the volume of that cavity (cm^3/s): a larynx rising
   * with the glottis shut compresses the air in front of it (ejectives), one
   * lowering rarefies it (implosives), a tongue or jaw moving during a closure
   * does the same a little
   */
  dVdt?: number;
}

export class Aero {
  /** intraoral pressure above the glottis, dyn/cm^2 */
  po = 0;
  /** mean flows, cm^3/s */
  ug = 0;
  uMouth = 0;
  uNose = 0;
  /** rate of change of the mouth flow (for the release transient) */
  dUMouth = 0;
  /** volume the walls have yielded (cm^3), the pressure of their spring and the flow into them */
  vWall = 0;
  pw = 0;
  uWall = 0;

  reset(): void { this.po = 0; this.ug = 0; this.uMouth = 0; this.uNose = 0; this.dUMouth = 0; this.vWall = 0; this.pw = 0; this.uWall = 0; }

  step(dt: number, x: AeroInputs): void {
    // (below zero the lungs pull: the air goes in through the glottis, and in through the mouth and the nose)
    const ps = x.ps;
    if ((x.wallCompliance ?? 0) > 0) { this.stepWalls(dt, x, ps, x.wallCompliance!); return; }
    const ag2 = x.glottalArea * x.glottalArea;
    const aout = x.oralArea + x.nasalArea;
    const ao2 = aout * aout;
    // steady-state intraoral pressure where glottal inflow equals outflow
    const poStar = ag2 + ao2 > 1e-12 ? (ps * ag2) / (ag2 + ao2) : 0;
    const k = Math.sqrt(2 / RHO);
    const dpg = Math.abs(ps - this.po);
    // linearised conductances dU/dP = A k / (2 sqrt(dP)) give the relaxation time
    const gg = (x.glottalArea * k) / (2 * Math.sqrt(Math.max(dpg, 1)));
    const go = (aout * k) / (2 * Math.sqrt(Math.max(Math.abs(this.po), 1)));
    const g = gg + go;
    // C dPo/dt = Ug - Umouth - Unose - dV/dt: the pressure relaxes toward the
    // balance of the flows, shifted by the change of volume (with both ends
    // shut it only integrates it: dPo = -dV / C)
    const q = x.dVdt ?? 0;
    const e = g > 1e-12 ? -Math.expm1((-dt * g) / x.compliance) : (dt * g) / x.compliance;
    const a = 1 - e;
    const f = g > 1e-12 ? e / g : dt / x.compliance;
    this.po = poStar + (this.po - poStar) * a - q * f;
    this.ug = x.glottalArea * k * rootThroughZero(ps - this.po, x.glottalArea);
    // below the outside pressure the air flows in (the burst of an implosive or a click goes inward)
    const sq = Math.sign(this.po) * Math.sqrt(Math.abs(this.po));
    const um = x.oralArea * k * sq;
    this.dUMouth = (um - this.uMouth) / dt;
    this.uMouth = um;
    this.uNose = x.nasalArea * k * sq;
  }

  /**
   * The same balance with the walls as a branch of their own:
   *   Ca dPo/dt = Ug - Umouth - Unose - dV/dt - Uw,
   *   Lw dUw/dt = Po - Pw - Rw Uw,   Cw dPw/dt = Uw.
   * The air alone is stiff (it follows the orifices in a fraction of a
   * millisecond), so the step is implicit: the balance at the end of the step
   * grows with the pressure there, and is solved by bisection.
   */
  private stepWalls(dt: number, x: AeroInputs, ps: number, cw: number): void {
    const k = Math.sqrt(2 / RHO);
    const ca = Math.max(x.compliance - cw, 1e-9);
    const ag = x.glottalArea * k, ao = (x.oralArea + x.nasalArea) * k;
    const q = x.dVdt ?? 0;
    const lw = (x.wallMass ?? 0) / dt;
    const pw0 = this.vWall / cw;
    // the wall flow at the end of the step is linear in the pressure: (b + p) / z
    const z = lw + (x.wallResistance ?? 0) + dt / cw;
    const b = this.uWall * lw - pw0;
    const p0 = this.po;
    const h = (p: number) => (ca * (p - p0)) / dt - ag * rootThroughZero(ps - p, x.glottalArea) + ao * Math.sign(p) * Math.sqrt(Math.abs(p)) + q + (b + p) / z;
    let lo = Math.min(p0, pw0, ps, 0) - 1, hi = Math.max(p0, pw0, ps, 0) + 1;
    let w = hi - lo;
    for (let i = 0; i < 60 && h(lo) > 0; i++) { lo -= w; w *= 2; }
    for (let i = 0; i < 60 && h(hi) < 0; i++) { hi += w; w *= 2; }
    for (let i = 0; i < 60 && hi - lo > 1e-4; i++) {
      const mid = 0.5 * (lo + hi);
      if (h(mid) > 0) hi = mid; else lo = mid;
    }
    const p = 0.5 * (lo + hi);
    this.po = p;
    this.uWall = (b + p) / z;
    this.vWall += this.uWall * dt;
    this.pw = this.vWall / cw;
    this.ug = ag * rootThroughZero(ps - p, x.glottalArea);
    const sq = Math.sign(p) * Math.sqrt(Math.abs(p));
    const um = x.oralArea * k * sq;
    this.dUMouth = (um - this.uMouth) / dt;
    this.uMouth = um;
    this.uNose = x.nasalArea * k * sq;
  }

  /**
   * Jet and noise-source description for a constriction of area ac, wetted
   * perimeter `perimeter` and lateral width `width` (0 = a round passage).
   * `share` is the part of the pressure behind the passages that drops across
   * this one (1 when it is the only one).
   */
  jet(ac: number, toTeeth: number, slitHeight: number, out: JetInfo, perimeter = 0, width = 0, share = 1): JetInfo {
    // the jet blows out, or in when the pressure behind the passage is below the outside
    const v = Math.sqrt((2 * share * Math.abs(this.po)) / RHO);
    const a = Math.max(ac, 1e-4);
    const round = 2 * Math.sqrt(a / Math.PI);
    const dh = Math.max(perimeter > 0 ? Math.min((4 * a) / perimeter, round) : round, 0.02);
    // aspect of the passage, 1 for a round one; a flat jet's core is about
    // five slit heights long instead of five diameters
    const w = Math.max(width > 0 ? width : round, dh);
    const aspect = Math.max(1, ((w * w) / a) * (Math.PI / 4));
    const thin = 0.5 + 0.5 / Math.sqrt(aspect);
    const core = 5 * dh * thin;
    const turn = Math.max(core, 5 * w);
    const re = (v * dh) / NU;
    const onset = smoothstep(RE_CRIT * 0.6, RE_CRIT * 1.8, re);
    // Lighthill-type dipole scaling with Stevens' area dependence
    const base = ((RHO * v * v * v) / C_SOUND) * Math.sqrt(Math.max(ac, 1e-4) / A_REF) * onset;
    out.v = v; out.re = re; out.dh = dh; out.onset = onset;
    out.toTeeth = toTeeth;
    out.wallSource = base;
    if (toTeeth >= 0) {
      const x = toTeeth;
      const vt = x <= core ? v : x <= turn ? v * Math.sqrt(core / x) : (v * Math.sqrt(core / turn) * turn) / x;
      const width = dh * thin + 0.22 * x;
      const aim = smoothstep(AIM_AREA[0], AIM_AREA[1], ac) * smoothstep(AIM_DISTANCE[0], AIM_DISTANCE[1], x);
      const impinge = aim * Math.max(0, Math.min(1, 1 - slitHeight / width));
      out.vAtTeeth = vt;
      out.widthAtTeeth = width;
      out.impinge = impinge;
      out.obstacleSource = ((RHO * vt * vt * vt) / C_SOUND) * Math.sqrt(Math.max(ac, 1e-4) / A_REF) * onset * impinge;
    } else {
      out.vAtTeeth = 0; out.widthAtTeeth = 0; out.impinge = 0; out.obstacleSource = 0;
    }
    // Strouhal number ~0.15 for the dominant eddies of the jet
    out.fc = Math.min(16000, (0.15 * v) / dh);
    out.fcObstacle = Math.min(16000, (0.15 * Math.max(out.vAtTeeth, 1)) / Math.max(Math.min(slitHeight, out.widthAtTeeth || 1), 0.05));
    return out;
  }
}

/**
 * Flow resistances of the jets in the tract, R / (rho c) in 1/cm^2, at the exit
 * of each section (the last entry at the lips). Where the flow leaves a narrow
 * passage it separates into a jet, which loses its kinetic pressure in the
 * wider part downstream (Borda-Carnot): dp = rho/2 v^2 (1 - A / A_down)^2, a
 * differential resistance R = rho U (1 - A / A_down)^2 / A^2. The losses damp
 * the resonances of the cavities around a fricative and a stop release
 * (Birkholz, Jackel & Kroger 2007; Stevens 1998). `narrowIndex` and
 * `narrowArea` give the main constriction measured on the fine grid, narrower
 * than the mean area of its section. It is the passage the flow was computed
 * with, so no section counts as narrower: the areas may be those the tract is
 * still gliding to (a closure a few milliseconds ahead of the flow).
 */
export function kineticResistances(areas: ArrayLike<number>, flow: number, out: Float64Array, narrowIndex = -1, narrowArea = Infinity): Float64Array {
  out.fill(0);
  const n = areas.length;
  flow = Math.abs(flow);
  if (!(flow > 0)) return out;
  const at = (i: number) => (i === narrowIndex ? Math.min(areas[i], narrowArea) : areas[i]);
  const floor = Number.isFinite(narrowArea) ? narrowArea : 0;
  // the jet speed is bounded by the lung pressure (about 0.15 c)
  const r = (a: number, loss: number) => (loss * Math.min(flow / a, 0.15 * C_SOUND)) / (C_SOUND * a);
  for (let i = 1; i < n - 1; i++) {
    const a = Math.max(at(i), floor, 1e-4);
    if (a > at(i - 1) || a >= at(i + 1)) continue;
    // widest part downstream before the tract narrows again
    let j = i + 1;
    while (j < n - 1 && at(j + 1) >= at(j)) j++;
    out[i] = r(a, (1 - a / at(j)) ** 2);
  }
  // the air always leaves the lips into open air, which takes all of its
  // kinetic pressure (exit loss), whether or not the lips are the narrowest
  out[n - 1] = r(Math.max(at(n - 1), floor, 1e-4), 1);
  return out;
}

/**
 * Resistance of the airways from the lungs to the mouth while breathing
 * with the glottis open, dyn s/cm^5: 1.5 cmH2O per l/s, between 0.6 and 2.4
 * in healthy adults (DuBois, Botelho & Comroe 1956).
 */
export const AIRWAY_RES = 1.47;

/**
 * The signed square root of the pressure across a glottis of the given area,
 * as the speed of its jet takes it (speed = sqrt(2/rho) times this).
 *
 * A jet's speed goes with the root of the pressure behind it, which turns
 * round at zero with an infinite slope: where the air of a breath stops
 * going out and starts coming in the flow would step, and the step is heard
 * as a pop. But a wide glottis under a low pressure is not what holds the
 * air back: the airways below it are, and through them the flow goes with
 * the pressure itself, dp / R. The two flows are equal at dp = 2 R^2 A^2 /
 * rho; below it the flow is the airways', above it the jet's. For the
 * glottis of a voice (0.05 cm^2) that is 0.01 cmH2O, and nothing changes;
 * wide open for a breath (0.56 cm^2) it is 1.2 cmH2O.
 */
export function rootThroughZero(dp: number, area: number): number {
  const creep = Math.max(1, (2 * AIRWAY_RES * AIRWAY_RES * area * area) / RHO);
  const a = Math.abs(dp);
  return a >= creep ? Math.sign(dp) * Math.sqrt(a) : dp / Math.sqrt(creep);
}

export function newJetInfo(): JetInfo {
  return {
    v: 0, re: 0, dh: 0, toTeeth: 0, widthAtTeeth: 0, vAtTeeth: 0, impinge: 0, onset: 0,
    wallSource: 0, obstacleSource: 0, fc: 1000, fcObstacle: 1000,
  };
}

export const cmH2O = (p: number) => p / CMH2O;
