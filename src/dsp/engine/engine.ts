import { RHO, C_SOUND, CMH2O, NU, AREA_CLOSED } from '../constants';
import { LFSource, rdToTiming, timingFromQuotients, LFTiming } from '../glottis/lf';
import { TwoMassGlottis } from '../glottis/twoMass';
import { Waveguide } from '../tract/waveguide';
import { computeGeometry, lowerPharynxLength, TractGeometry, EPILARYNX_PASSAGE } from '../tract/geometry';
import { AreaFunction, N_SECTIONS, sectionsFromGeometry, resampleTube } from '../tract/areaFunction';
import { buildNasal, NasalTract, noseOf, nostrilArea, portArea } from '../tract/nasal';
import { Aero, newJetInfo, JetInfo, RE_CRIT, kineticResistances } from '../aero/aero';
import { TurbulenceSource, ShapedNoise } from '../noise/noise';
import { ButterworthLowpass } from '../util/biquad';
import { Rng } from '../util/rng';
import { smoothstep } from '../util/math';
import { TamChannel, TAM_TAU } from '../speech/tam';
import { Articulators, ARTICULATOR_KEYS } from '../tract/types';
import { EngineParams, Score, ScoreFrame, defaultParams } from './params';

/** Output samples between control updates. */
const CTRL = 32;
/** Minimum time between geometry recomputations (s). */
const GEOM_INTERVAL = 0.0027;
/** Radiated pressure at 1 m per unit dU/dt: rho / (4 pi r), in Pa. */
const RAD_PA = RHO / (4 * Math.PI * 100) / 10;
/** Digital full scale corresponds to this sound pressure at 1 m (Pa). */
const FULL_SCALE_PA = 0.3;
/**
 * Source-strength calibration of the turbulence models (dimensionless). The
 * wall and obstacle gains put held /s/ about 9 dB and /f/ about 17 dB below
 * /a/, with jets of the true hydraulic diameter of each passage.
 */
export const NOISE_K = { aspiration: 0.15, wall: 0.07, obstacle: 1.35, user: 0.04, bypass: 0.004, burst: 0.08 };
/**
 * What thin folds change in the LF source (Zhang 2016: the vertical thickness
 * of the medial surface sets the closed quotient and the slope of the
 * spectrum): per unit of thinness the pulse softens (Rd up), a gap stays open
 * (cm^2 in an adult man) and the swing shrinks (a share of the peak opening).
 * In the two-mass model the lower mass is thinner.
 */
const THIN = { rd: 1.4, chink: 0.04, swing: 0.4 };
/**
 * A second narrow passage of the tongue, apart from the narrowest one with
 * air between them (a doubly articulated fricative: ɧ, "simultaneous ʃ and
 * x"): narrower than this (cm^2), at least this far from the first (cm in an
 * adult man), with the passage between them this many times wider.
 */
const SECOND = { narrow: 0.2, apart: 2, cavity: 2.5 };
/** thinness of the folds: 0 for a chest voice, 0.8 for the thinnest falsetto; thicker than chest is below zero */
const thinness = (s: { thickness?: number }) => 1 - Math.max(0.2, Math.min(1.2, s.thickness ?? 1));
/** the posterior gap of the glottis with the gap thin folds leave, cm^2 before scaling */
const gapOf = (s: { chink: number; thickness?: number }) => Math.max(0, s.chink + THIN.chink * thinness(s));

/** Length of the vocal folds (cm) for the glottal Reynolds number. */
const FOLD_LENGTH = 1.4;

type TrillKey = 'tipY' | 'lipOpen' | 'tongueX';
/**
 * The articulators that trill: natural frequency (Hz) and damping of the
 * spring, the push of the air behind the passage (articulator units per s^2
 * per cmH2O), how far past the contact the spring holds it (articulator
 * units), the direction that shuts it and how fast the passage opens near
 * the contact (cm^2 per unit). The alveolar trill is about 26 Hz (Recasens
 * 1991; Ladefoged & Maddieson 1996).
 */
const TRILL: Record<TrillKey, { f: number; zeta: number; kp: number; press: number; dir: number; slope: number }> = {
  tipY: { f: 26, zeta: 0.08, kp: 2000, press: 0.1, dir: 1, slope: 0.42 },
  lipOpen: { f: 24, zeta: 0.08, kp: 2000, press: 0.3, dir: -1, slope: 1.7 },
  tongueX: { f: 28, zeta: 0.08, kp: 2000, press: 0.3, dir: -1, slope: 0.8 },
};
/** stiffness of the tissue pressed against the other side, times the spring */
const TRILL_CONTACT = 2;
/**
 * The air between the two closures of a click: the compliance of its walls
 * (the tongue pulled taut against the palate, stiff: cm^5/dyn) and how much
 * the tongue body, drawn down and back, enlarges it (cm^3).
 */
const CLICK = { walls: 3e-5, dv: 0.6 };

/** Volume of an area function from the glottis to s cm (cm^3). */
function volumeTo(areas: ArrayLike<number>, dx: number, s: number): number {
  let v = 0;
  for (let i = 0; i < areas.length; i++) {
    const s0 = i * dx;
    if (s0 >= s) break;
    v += areas[i] * Math.min(dx, s - s0);
  }
  return v;
}

/**
 * A control-rate value carried into the sample loop as a straight line over
 * one control period. Held as steps instead, it would modulate the glottal
 * pulses at the control rate (1.5 kHz) and leave a comb of whistles at its
 * multiples, heard as a fizz over the whole voice.
 */
class Ramp {
  private from: number;
  private to: number;
  v: number;
  constructor(v = 0) { this.from = this.to = this.v = v; }
  /** a new control value: the ramp starts from where it is now */
  set(target: number): void { this.from = this.v; this.to = target; }
  snap(v: number): void { this.from = this.to = this.v = v; }
  at(phase: number): number { this.v = this.from + (this.to - this.from) * phase; return this.v; }
}

export interface Telemetry {
  time: number;
  articulators: Articulators;
  abduction: number;
  areas: Float64Array;
  length: number;
  fsTract: number;
  teethIndex: number;
  lipsIndex: number;
  nasalPort: number;
  /** rms pressure and volume velocity per section (normalised 0..1) */
  pRms: Float64Array;
  uRms: Float64Array;
  // source
  f0: number;
  f0Target: number;
  phase: number;
  openQuotient: number;
  speedQuotient: number;
  ra: number;
  glottalArea: number;
  glottalFlow: number;
  twoMass: { l1: number; l2: number; r1: number; r2: number; a1: number; a2: number; q: number } | null;
  voicingAmp: number;
  // aero
  ps: number;
  po: number;
  ug: number;
  uMouth: number;
  uNose: number;
  constrictionIndex: number;
  /** the cavity of a click: its pressure (dyn/cm^2) and the flow through its front (cm^3/s, inward negative) */
  clickPo: number;
  uClick: number;
  constrictionArea: number;
  jet: JetInfo;
  glottalRe: number;
  slit: { height: number; width: number; area: number; vertical: number };
  // noise levels (rms, linear, after gains) for the meters
  levels: { aspiration: number; wall: number; obstacle: number; user: number; voice: number; out: number };
  playing: boolean;
  scoreTime: number;
  phone: string;
}

export interface Streams {
  out: Float32Array;
  flow: Float32Array;
  noise: Float32Array;
}

export class VoiceEngine {
  readonly fsOut: number;
  params: EngineParams;

  private fsT = 88000;
  private wg: Waveguide;
  private lf = new LFSource();
  private tm = new TwoMassGlottis();
  private aero = new Aero();
  private jet = newJetInfo();
  private aspNoise = new TurbulenceSource(11);
  private wallNoise = new TurbulenceSource(23);
  /** the jet of a second narrow passage */
  private wallNoise2 = new TurbulenceSource(29);
  private jet2 = newJetInfo();
  private wallAmp2 = 0;
  private wallJunction2 = -1;
  /** the second narrow passage: its area (Infinity when there is none), place, perimeter and width */
  private second = { area: Infinity, s: 0, perimeter: 0, width: 0 };
  private obsNoise = new TurbulenceSource(37);
  /** the jet of a click, rushing in through its front passage: turbulence on the walls of its cavity */
  private clickNoise = new TurbulenceSource(41);
  private clickJet = newJetInfo();
  private clickJetAmp = 0;
  private clickJetJunction = -1;
  private userNoise = new ShapedNoise(1024);
  private userNoiseKey = '';
  private lpf = new ButterworthLowpass(8);
  private rng = new Rng(99);

  // articulators and source controls (TAM-smoothed)
  private tam: Record<string, TamChannel> = {};
  readonly art: Articulators;
  private abduction = 0;
  private f0 = 120;
  private psCur = 0; // dyn/cm^2
  /** Rd change and glottal gate from the score */
  private rdOffset = 0;
  private gate = 1;

  // geometry
  geom: TractGeometry | null = null;
  af: AreaFunction;
  nasal: NasalTract;
  private geomKey = '';
  private sinceGeom = 1;
  private fineMinArea = 1;
  private fineMinS = 0;
  /** wetted perimeter and lateral width of the narrowest passage (0 = round) */
  private fineMinPerimeter = 0;
  private fineMinWidth = 0;
  private constrictionIndex = 0;
  /** air behind the narrowest passage (cm^3), and the change of it still to be felt by the pressure */
  private cavityVolume = -1;
  private pendingDV = 0;
  private dvRate = 0;
  /** length of the pharynx below its bend, which the larynx height stretches (cm) */
  private lowerPharynx = 0;
  /** walls of the cavity tensed (1: the pharynx of an ejective does not yield) or let go (-1: that of an implosive gives way) */
  private tense = 0;
  /** creak of the score (0..1), smoothed */
  private creak = 0;
  /** the articulator trilling, its offset from the smoothed posture and its speed */
  private trillKey: TrillKey | undefined;
  private trillY = 0;
  private trillV = 0;
  /** where the trilling articulator meets the other side, as the geometry shows it */
  private trillContact = 0;
  /**
   * a click: the cavity between its closures (pressure and inflow), how far
   * the tongue has rarefied it, its front passage and the air it holds
   */
  private clickAero = new Aero();
  private click = 0;
  private clickDelta = 0;
  private clickOn = false;
  private clickFrontArea = 1;
  private clickFrontIndex = -1;
  private clickVolume = 0;
  private rClick = new Ramp(0);
  private clickNow = 0;
  private clickSlow = 0;
  private wallJunction = 0;
  private aspJunction = 1;

  // resampler
  private ratio = 88000 / 48000;
  private pos = 0;
  private produced = 0;
  private ring = new Float64Array(8);
  private ringIdx = 0;

  // glottal bookkeeping
  private uMean = 0;
  private uMeanCoef = 0;
  private uPrev = 0;
  private gFlowPrev = 0;
  private voicingAmp = 0;
  private periodAmp = 1;
  private glottalArea = 0;
  private glottalFlow = 0;
  private glottalRe = 0;
  private dflow = 0;
  private aspMean = 0;
  private mouthSlow = 0;
  private mouthNow = 0;
  private poNow = 0;
  private psNow = 0;
  private mouthCoef = 0.1;
  private pulseMean = 0;
  private pulseMeanCoef = 0.004;
  private slowCoef = 0.003;
  private lastOpenTime = 0;
  private measuredF0 = 0;
  private tractTime = 0;
  private tmQ = 1;

  // per-sample noise amplitudes (set at control rate)
  private wallAmp = 0;
  private obsAmp = 0;
  // control-rate values ramped across each control period in the sample loop
  private rVoicing = new Ramp(0);
  private rGate = new Ramp(1);
  private rAbd = new Ramp(0);
  private rPs = new Ramp(0);
  private rPo = new Ramp(0);
  private rMouth = new Ramp(0);
  private rUg = new Ramp(0);
  private rWall = new Ramp(0);
  private rObs = new Ramp(0);
  private rWall2 = new Ramp(0);
  private rClickJet = new Ramp(0);
  private ctrlPhase = 1;
  private userAmp = 0;
  private userJunction = -1;
  private teethJunction = 40;
  private ctrl = 0;
  private time = 0;

  // score
  private score: Score | null = null;
  private scoreTime = 0;
  private scoreIdx = 0;
  private scoreHold = 0.25;

  // telemetry
  private levelAcc = { aspiration: 0, wall: 0, obstacle: 0, user: 0, voice: 0, out: 0, n: 0 };
  private telemetryLevels = { aspiration: 0, wall: 0, obstacle: 0, user: 0, voice: 0, out: 0 };
  /** optional streams for analysis (filled when set) */
  streams: Streams | null = null;
  streamPos = 0;
  private lastNoise = 0;

  constructor(fsOut = 48000, params: EngineParams = defaultParams()) {
    this.fsOut = fsOut;
    this.params = params;
    this.art = { ...params.articulators };
    for (const k of ARTICULATOR_KEYS) this.tam[k] = new TamChannel(this.art[k], TAM_TAU[k]);
    this.tam.abduction = new TamChannel(params.abduction, TAM_TAU.abduction);
    this.tam.f0 = new TamChannel(params.source.f0, TAM_TAU.f0);
    this.tam.ps = new TamChannel(0, TAM_TAU.ps);
    this.f0 = params.source.f0;
    this.af = { areas: new Float64Array(N_SECTIONS).fill(3), length: 17.5, dx: 17.5 / N_SECTIONS, teethIndex: 40, lipsIndex: 42 };
    this.nasal = buildNasal(this.af.dx, 1, AREA_CLOSED, 18);
    this.wg = new Waveguide(N_SECTIONS, this.nasal.areas.length, this.nasal.coupling);
    this.tm.reset();
    this.updateGeometry(true);
    this.lf.periodF0 = this.f0;
  }

  setParams(p: EngineParams): void { this.params = p; }

  /** Starts a sequenced utterance. */
  playScore(score: Score): void {
    this.score = score;
    this.scoreTime = 0;
    this.scoreIdx = 0;
    this.tam.f0.tau = score.f0Tau ?? TAM_TAU.f0;
    for (const k of ARTICULATOR_KEYS) this.tam[k].tau = TAM_TAU[k] * (score.tauScale?.[k] ?? 1);
  }

  stopScore(): void { this.score = null; this.restoreTau(); }

  /** the time constants of the hands, when a score ends or is stopped */
  private restoreTau(): void {
    this.tam.f0.tau = TAM_TAU.f0;
    for (const k of ARTICULATOR_KEYS) this.tam[k].tau = TAM_TAU[k];
  }

  get isPlaying(): boolean { return this.score !== null; }

  // ------------------------------------------------------------ control

  private targetFrame(): { art: Articulators | null; abduction: number; f0: number; ps: number; tip: number; lips: number; dorsum: number; rd: number; gate: number; tense: number; creak: number; trill: number; trillKey?: TrillKey; trillAt: number; trillOpen: number; click: number } | null {
    const sc = this.score;
    if (!sc) return null;
    if (this.scoreTime > sc.duration + this.scoreHold) { this.score = null; this.restoreTau(); return null; }
    const fr = sc.frames;
    while (this.scoreIdx < fr.length - 2 && fr[this.scoreIdx + 1].t <= this.scoreTime) this.scoreIdx++;
    const a = fr[this.scoreIdx], b = fr[Math.min(this.scoreIdx + 1, fr.length - 1)];
    const t = b.t > a.t ? Math.min(1, Math.max(0, (this.scoreTime - a.t) / (b.t - a.t))) : 0;
    const mix = (x: number, y: number) => x + (y - x) * t;
    let art: Articulators | null = null;
    if (a.art && b.art) {
      art = {} as Articulators;
      for (const k of ARTICULATOR_KEYS) art[k] = mix(a.art[k], b.art[k]);
    }
    return {
      art, abduction: mix(a.abduction, b.abduction), f0: mix(a.f0, b.f0), ps: mix(a.ps, b.ps),
      tip: mix(a.tip ?? 0, b.tip ?? 0), lips: mix(a.lips ?? 0, b.lips ?? 0), dorsum: mix(a.dorsum ?? 0, b.dorsum ?? 0),
      rd: mix(a.rd ?? 0, b.rd ?? 0), gate: mix(a.gate ?? 1, b.gate ?? 1), tense: mix(a.tense ?? 0, b.tense ?? 0), creak: mix(a.creak ?? 0, b.creak ?? 0),
      trill: mix(a.trill ?? 0, b.trill ?? 0), trillKey: a.trillKey ?? b.trillKey, trillAt: a.trillAt ?? b.trillAt ?? 0, trillOpen: a.trillOpen ?? b.trillOpen ?? 0,
      click: mix(a.click ?? 0, b.click ?? 0),
    };
  }

  private control(): void {
    const dt = CTRL / this.fsOut;
    const p = this.params;
    const fr = this.targetFrame();
    if (this.score) this.scoreTime += dt;
    const artT = fr?.art ?? p.articulators;
    for (const k of ARTICULATOR_KEYS) this.art[k] = this.tam[k].step(artT[k], dt);
    // taps: the contacts of the tongue tip are ballistic, added on top of the
    // smoothed posture; the same for the lips (ⱱ) and the dorsum
    const tk = fr && fr.trill > 0 ? fr.trillKey : undefined;
    if (fr && fr.tip) this.art.tipY += fr.tip;
    if (fr && fr.lips) this.art.lipOpen += fr.lips;
    if (fr && fr.dorsum) this.art.tongueX += fr.dorsum;
    this.trillStep(fr, tk, dt);
    const ck = fr ? fr.click : 0;
    this.clickDelta = ck - this.click;
    this.click = ck;
    this.rdOffset = fr ? fr.rd : 0;
    // a glottal stop closes within a few milliseconds
    this.gate += ((fr ? fr.gate : 1) - this.gate) * (1 - Math.exp(-dt / 0.006));
    this.tense += ((fr ? fr.tense : 0) - this.tense) * (1 - Math.exp(-dt / 0.02));
    this.creak += ((fr ? fr.creak : 0) - this.creak) * (1 - Math.exp(-dt / 0.02));
    this.abduction = this.tam.abduction.step(fr ? fr.abduction : p.abduction, dt);
    const vib = p.source.vibratoDepth > 0 ? Math.pow(2, (p.source.vibratoDepth / 1200) * Math.sin(2 * Math.PI * p.source.vibratoRate * this.time)) : 1;
    // flutter: slow quasi-random F0 wander of a living voice (Klatt & Klatt 1990)
    const fl = this.score?.flutter ?? 0;
    const tt = this.time;
    const flutter = fl > 0 ? 1 + (fl / 50 / 100) * (Math.sin(2 * Math.PI * 12.7 * tt) + Math.sin(2 * Math.PI * 7.1 * tt) + Math.sin(2 * Math.PI * 4.7 * tt)) : 1;
    this.f0 = this.tam.f0.step(fr ? fr.f0 : p.source.f0, dt) * vib * flutter;
    const psTarget = fr ? fr.ps : p.phonate ? p.source.ps : 0;
    this.psCur = this.tam.ps.step(psTarget, dt) * CMH2O;

    // geometry
    this.sinceGeom += dt;
    if (this.sinceGeom >= GEOM_INTERVAL) this.updateGeometry(false);

    // aerodynamics
    this.updateAero(dt);
    this.time += dt;
    this.rVoicing.set(this.voicingAmp);
    this.rGate.set(this.gate);
    this.rAbd.set(Math.max(0, this.abduction));
    this.rPs.set(this.psCur);
    this.rPo.set(this.aero.po);
    this.rMouth.set(this.aero.uMouth);
    this.rUg.set(this.aero.ug);
    this.rClick.set(this.clickAero.uMouth);
    this.rWall.set(this.wallAmp);
    this.rWall2.set(this.wallAmp2);
    this.rClickJet.set(this.clickJetAmp);
    this.rObs.set(this.obsAmp);
    this.ctrlPhase = 0;
  }

  /**
   * Trills are aeroelastic (McGowan 1992; Solé 2002): the tip, the lips or
   * the dorsum is a mass on a spring whose rest is lightly past the contact.
   * Shut, the pressure builds up behind it and blows it open; open, the
   * pressure falls, a little later than the passage opens, and the spring
   * closes it again. That lag feeds the oscillation, as in the vocal folds:
   * the trill needs enough air, and stops when the pressure behind the
   * passage is too low (a trill said with weak lungs, or with the nose open,
   * dies into an approximant or a single contact).
   */
  private trillStep(fr: { trill: number; trillKey?: TrillKey; trillAt: number; trillOpen: number } | null, tk: TrillKey | undefined, dt: number): void {
    if (tk && tk !== this.trillKey && fr) { this.trillKey = tk; this.trillY = 0; this.trillV = 0; this.trillContact = fr.trillAt; }
    const k = this.trillKey;
    if (!k) return;
    const P = TRILL[k];
    const w = 2 * Math.PI * P.f;
    const on = tk && fr ? fr.trill : 0;
    const base = this.art[k];
    const rest = tk && fr ? this.trillContact + P.dir * P.press - base : 0;
    let acc = -w * w * (this.trillY - rest) - 2 * (on > 0 ? P.zeta : 1) * w * this.trillV;
    if (on > 0 && fr) {
      // the air behind the passage pushes it open (and a suction would pull it shut)
      acc -= P.dir * P.kp * on * (this.aero.po / CMH2O);
      // pressed against the other side, the tissue is much stiffer
      const z = P.dir * (base + this.trillY - this.trillContact);
      if (z > 0) acc -= P.dir * TRILL_CONTACT * w * w * z + 2 * 0.3 * w * Math.sqrt(TRILL_CONTACT) * this.trillV;
      // a fricative trill (ř): the body of the tongue, raised behind the
      // blade, lets it open only so far, into a narrow channel that hisses
      // (Ladefoged & Maddieson 1996: a trill and a fricative at once). The
      // blade bounces off that limit back toward its contact: an elastic
      // stop, or the bounce would eat the energy that keeps it trilling
      const zo = fr.trillOpen > 0 ? -z - fr.trillOpen : 0;
      if (zo > 0) acc += P.dir * TRILL_CONTACT * w * w * zo;
    }
    this.trillV += acc * dt;
    this.trillY += this.trillV * dt;
    if (!on && Math.abs(this.trillY) < 1e-4 && Math.abs(this.trillV) < 1e-2) { this.trillKey = undefined; this.trillY = 0; this.trillV = 0; return; }
    this.art[k] = base + this.trillY;
  }

  private artKey(): string {
    const a = this.art, an = this.params.anatomy, t = this.params.teeth;
    let s = '';
    for (const k of ARTICULATOR_KEYS) s += (Math.round(a[k] * 400) / 400) + ',';
    s += `${an.scale},${an.pharynx},${an.pharynxWidth},${an.nasalLeak},${an.nasalCycle},${an.nostrilLeft},${an.nostrilRight},${an.piriform}|${t.slitWidth},${t.diastema},${t.overjet},${t.advance},${t.upperLength},${t.lowerLength},${t.slitOpen}`;
    if (this.params.tubeMode) s += '|tube' + this.params.tubeAreas.join(',') + this.params.tubeLength;
    return s;
  }

  private updateGeometry(force: boolean): void {
    const key = this.artKey();
    if (!force && key === this.geomKey) return;
    this.geomKey = key;
    this.sinceGeom = 0;
    const p = this.params;
    if (p.tubeMode) {
      this.geom = null;
      const n = N_SECTIONS;
      const areas = resampleTube(p.tubeAreas, n, this.af.areas, AREA_CLOSED);
      this.af.length = p.tubeLength;
      this.af.dx = p.tubeLength / n;
      this.af.teethIndex = n - 3;
      this.af.lipsIndex = n - 2;
      // the turbulent constriction is looked for above the epilaryngeal tube,
      // as in the head (2.6 cm in a 17.5 cm tract)
      this.fineMinArea = Infinity;
      this.fineMinPerimeter = 0;
      this.fineMinWidth = 0;
      const i0 = Math.max(2, Math.ceil((2.6 * p.tubeLength) / 17.5 / this.af.dx));
      for (let i = i0; i < n; i++) if (areas[i] < this.fineMinArea) { this.fineMinArea = areas[i]; this.fineMinS = (i + 0.5) * this.af.dx; }
    } else {
      this.geom = computeGeometry(this.art, p.anatomy, p.teeth, { reuse: this.geom ?? undefined });
      sectionsFromGeometry(this.geom, N_SECTIONS, this.af);
      // fine-grid minimum above the larynx (aerodynamic constriction); the
      // tube above the folds counts only when the sphincter draws it in
      const g = this.geom;
      let m = Infinity, ms = 0, mp = 0, mw = 0, mi = -1;
      const sStart = this.art.epilarynx > EPILARYNX_PASSAGE ? 0 : 2.6 * p.anatomy.scale;
      for (let i = 0; i <= g.lastRay; i++) {
        if (g.s[i] < sStart) continue;
        const a = g.hits[i].area;
        if (a < m) { m = a; ms = g.s[i]; mp = g.hits[i].perimeter; mw = g.hits[i].width; mi = i; }
      }
      // the incisal slit is a constriction too
      if (g.slit.area < m && g.teethPos > 0) { m = g.slit.area; ms = g.teethPos; mp = g.slit.perimeter; mw = g.slit.width; mi = -1; }
      this.fineMinArea = Math.max(m, 0);
      this.fineMinS = ms;
      this.fineMinPerimeter = mp;
      this.fineMinWidth = mw;
      // a second narrow passage of the tongue, with air between it and the
      // first (the teeth and the lips have sources of their own)
      const sc = this.second;
      sc.area = Infinity;
      const tongue = (r: string) => r !== 'teeth' && r !== 'lips' && r !== 'labiodental' && r !== 'closed';
      if (m >= 0.004 && m < SECOND.narrow && mi >= 0 && tongue(g.hits[mi].rule)) {
        let i2 = -1;
        for (let i = 0; i <= g.lastRay; i++) {
          const h = g.hits[i];
          if (g.s[i] < sStart || Math.abs(g.s[i] - ms) < SECOND.apart * p.anatomy.scale) continue;
          if (!tongue(h.rule)) continue;
          if (h.area < sc.area) { sc.area = h.area; i2 = i; }
        }
        let between = 0;
        if (i2 >= 0) for (let i = 0; i <= g.lastRay; i++) if ((g.s[i] - ms) * (g.s[i] - g.s[i2]) < 0) between = Math.max(between, g.hits[i].area);
        if (i2 < 0 || sc.area >= SECOND.narrow || between < SECOND.cavity * sc.area) sc.area = Infinity;
        else { sc.s = g.s[i2]; sc.perimeter = g.hits[i2].perimeter; sc.width = g.hits[i2].width; }
      }
    }
    const af = this.af;
    const n = N_SECTIONS;
    // tract rate follows the length so that one sample = one section
    const fsNew = (n * C_SOUND) / af.length;
    if (Math.abs(fsNew - this.fsT) > 0.002 * this.fsT || force) {
      this.fsT = fsNew;
      this.ratio = this.fsT / this.fsOut;
      this.lpf.design(Math.min(0.42 * this.fsOut, 0.24 * this.fsT), this.fsT);
      this.uMeanCoef = Math.exp(-2 * Math.PI * 12 / this.fsT);
      this.mouthCoef = 1 - Math.exp(-2 * Math.PI * 1500 / this.fsT);
      this.pulseMeanCoef = 1 - Math.exp(-1 / (0.003 * this.fsT));
      this.slowCoef = 1 - Math.exp(-2 * Math.PI * 40 / this.fsT);
    }
    const scale = p.anatomy.scale;
    const port = portArea(this.art.velum, p.anatomy.nasalLeak, scale);
    // the nose joins the pharynx where the velum begins. The model's velum has
    // no uvula, so the dorsum makes a uvular closure below it: with the port
    // open and the mouth shut there (ɴ), the nose joins just behind that
    // closure, where the uvula would hang, instead of being cut off from the
    // glottis
    let coupling = Math.round(0.43 * n) - 1;
    const shutAt = Math.min(n - 1, Math.max(0, Math.floor(this.fineMinS / af.dx)));
    if (port > 2e-3 && this.fineMinArea < 0.004 && shutAt <= coupling) coupling = Math.max(2, shutAt - 1);
    this.nasal = buildNasal(af.dx, scale, port, coupling, this.nasal.dx === af.dx ? this.nasal : undefined, noseOf(p.anatomy));
    const steps = Math.round(this.fsT * GEOM_INTERVAL * 1.05);
    this.wg.lossParams.base = 70 * p.losses;
    this.wg.lossParams.narrow = 45 * p.losses;
    this.wg.setGeometry(af, this.nasal, this.fsT, force ? 1 : steps);
    // constriction and noise injection points
    const dx = af.dx;
    this.aspJunction = Math.max(1, Math.min(n - 2, Math.round(1.0 / dx)));
    let ci = Math.min(n - 1, Math.max(0, Math.floor(this.fineMinS / dx)));
    this.constrictionIndex = ci;
    // the air between the glottis and the narrowest passage, and the larynx
    // as a piston under it: raised, it shortens the pharynx below the bend
    // (the drawing is squeezed evenly there) and takes away the air of that
    // stretch, lowered it adds some. Only the larynx counts: the tongue of the
    // area function does not keep its volume (a stop aims past the contact),
    // so the cavity it seems to leave behind a closure is not real air
    const s = this.fineMinS;
    this.cavityVolume = volumeTo(af.areas, dx, s);
    if (this.geom) {
      const lb = lowerPharynxLength(p.anatomy, this.art);
      if (!force && this.lowerPharynx > 0) {
        this.pendingDV += (volumeTo(af.areas, dx, Math.min(s, lb)) * (lb - this.lowerPharynx)) / lb;
        this.dvRate = this.pendingDV / GEOM_INTERVAL;
      }
      this.lowerPharynx = lb;
    }
    // the contact of a trilling articulator moves with the rest of the
    // posture (a jaw still closing from the vowel before): the geometry tells
    // where it is. Shut, it is at most where the articulator is; just open,
    // the articulator is short of it by the passage it leaves
    if (this.trillKey) {
      const P = TRILL[this.trillKey];
      const x = this.art[this.trillKey];
      if (this.fineMinArea < 0.004) { if (P.dir * (x - this.trillContact) < 0) this.trillContact = x; }
      else if (this.fineMinArea < 0.3) this.trillContact = x + (P.dir * this.fineMinArea) / P.slope;
    }
    // a click: the passage in front of its back closure (the narrowest, and
    // as long as the dorsum's contact), and the air between the two
    this.clickOn = this.click > 0 || this.clickAero.po < -10;
    if (this.clickOn && this.geom) {
      const g = this.geom;
      let i0 = 0;
      while (i0 < g.lastRay && g.s[i0] < this.fineMinS) i0++;
      while (i0 < g.lastRay && g.hits[i0].area < 0.004) i0++;
      const from = g.s[i0] + 0.3 * p.anatomy.scale;
      let m = Infinity, ms = from;
      for (let i = i0; i <= g.lastRay; i++) {
        if (g.s[i] <= from) continue;
        if (g.hits[i].area < m) { m = g.hits[i].area; ms = g.s[i]; }
      }
      if (g.slit.area < m && g.teethPos > from) { m = g.slit.area; ms = g.teethPos; }
      this.clickFrontArea = Number.isFinite(m) ? m : 1;
      this.clickFrontIndex = Math.min(n - 2, Math.max(0, Math.floor(ms / dx)));
      this.clickVolume = Math.max(0, volumeTo(af.areas, dx, ms) - volumeTo(af.areas, dx, this.fineMinS));
      // the inward jet hits the cavity half a centimetre behind the front passage
      const back = Math.floor(this.fineMinS / dx) + 1;
      this.clickJetJunction = Math.max(back, this.clickFrontIndex - Math.max(1, Math.round((0.5 * p.anatomy.scale) / dx)));
    } else { this.clickFrontIndex = -1; this.clickJetJunction = -1; }
    // exit of the constriction: first section downstream that opens up
    let exit = ci;
    const ac = Math.max(af.areas[ci], 1e-3);
    while (exit < n - 1 && af.areas[exit + 1] < 2.2 * ac) exit++;
    this.wallJunction = Math.min(n - 2, exit + Math.max(1, Math.round(0.5 / dx)));
    if (Number.isFinite(this.second.area)) {
      let e2 = Math.min(n - 1, Math.max(0, Math.floor(this.second.s / dx)));
      const a2 = Math.max(af.areas[e2], 1e-3);
      while (e2 < n - 1 && af.areas[e2 + 1] < 2.2 * a2) e2++;
      this.wallJunction2 = Math.min(n - 2, e2 + Math.max(1, Math.round(0.5 / dx)));
    } else this.wallJunction2 = -1;
    this.teethJunction = Math.min(n - 2, Math.max(1, af.teethIndex));
    const u = p.noise.user;
    let uj = -1;
    if (u.on) {
      switch (u.location) {
        case 'glottis': uj = this.aspJunction; break;
        case 'constriction': uj = this.wallJunction; break;
        case 'teeth': uj = this.teethJunction; break;
        case 'lips': uj = n - 2; break;
        case 'custom': uj = Math.max(0, Math.min(n - 2, Math.round(u.position * (n - 1)))); break;
      }
    }
    this.userJunction = uj;
    const nk = `${u.curve.join(',')}|${u.lowCut}|${u.highCut}`;
    if (nk !== this.userNoiseKey) { this.userNoiseKey = nk; this.userNoise.setSpectrum(u.curve, u.lowCut, u.highCut); }
  }

  private meanGlottalArea(): number {
    const p = this.params;
    // the glottis: its areas scale with the size of the head and the length of the folds
    const s2 = p.anatomy.scale * p.anatomy.scale * (p.anatomy.foldLength ?? 1);
    const abd = 0.55 * s2 * Math.max(0, this.abduction);
    let vib = 0;
    if (p.voicing) {
      if (p.source.model === 'lf') vib = 0.45 * p.source.peakArea * (1 - THIN.swing * thinness(p.source)) * s2 * this.voicingAmp;
      else vib = Math.max(0, this.tm.amin) * 0.5 + 0.5 * Math.max(0, p.source.restArea);
    }
    return (vib + gapOf(p.source) * s2) * this.gate + abd;
  }

  private updateAero(dt: number): void {
    const p = this.params;
    const scale = p.anatomy.scale;
    const ag = this.meanGlottalArea();
    // the air leaves the nose through the nostrils: pinched, they stop it
    const nasalArea = Math.min(portArea(this.art.velum, p.anatomy.nasalLeak, scale), 1.0 * scale * scale, nostrilArea(scale, noseOf(p.anatomy)));
    const oral = Math.max(0, this.fineMinArea);
    // two narrow passages in series pass the flow of one of area (A1^-2 + A2^-2)^-1/2,
    // and each takes the share (A / A_k)^2 of the drop of pressure
    const a2 = this.second.area;
    const both = Number.isFinite(a2) && oral > 0 ? 1 / Math.sqrt(1 / (oral * oral) + 1 / (a2 * a2)) : oral;
    // the change of volume of the cavity, spread over a geometry interval
    const want = this.dvRate * dt;
    const take = Math.abs(want) >= Math.abs(this.pendingDV) ? this.pendingDV : want;
    this.pendingDV -= take;
    // compliance of the cavity: its yielding walls (Stevens 1998: about
    // 1e-3 cm^5/dyn for the whole tract, a few times less when the walls are
    // tensed; let go and drawn outward, as the pharynx and the cheeks of an
    // implosive, they take in a few times more, Westbury 1983) and the air
    // itself, V / (rho c^2)
    const air = Math.max(this.cavityVolume, 0) / (RHO * C_SOUND * C_SOUND);
    const walls = this.tense >= 0 ? 1 - 0.8 * this.tense : 1 - 2 * this.tense;
    const compliance = 1.0e-3 * scale * scale * scale * walls + air;
    // sub-steps for the stiff closure/release dynamics
    const sub = 4;
    for (let i = 0; i < sub; i++) {
      this.aero.step(dt / sub, {
        ps: this.psCur, glottalArea: ag, oralArea: both, nasalArea: nasalArea > 2e-3 ? nasalArea : 0,
        compliance, dVdt: take / dt,
      });
    }
    // the cavity of a click, shut off from the lungs by its back closure: the
    // tongue enlarges it, and the air rushes in when the front opens
    if (this.clickOn) {
      const c = CLICK.walls * scale * scale * scale + this.clickVolume / (RHO * C_SOUND * C_SOUND);
      const q = (CLICK.dv * scale * scale * scale * this.clickDelta) / dt;
      for (let i = 0; i < sub; i++) this.clickAero.step(dt / sub, { ps: 0, glottalArea: 0, oralArea: this.clickFrontArea, nasalArea: 0, compliance: c, dVdt: q });
    } else this.clickAero.reset();
    // voicing needs transglottal pressure and adducted folds. Below the
    // speaking pressure (8 cmH2O) the vibration amplitude falls almost in
    // proportion, so that with the jet speed (sqrt of the pressure) the voice
    // loses 8-9 dB per halving of the pressure, as measured (Titze & Sundberg
    // 1992): a voiced fricative, with pressure behind its constriction, is
    // much weaker than its vowels. Above it the amplitude grows more slowly.
    const dp = Math.max(0, this.psCur - this.aero.po) / CMH2O;
    const adduction = 1 - smoothstep(0.25, 0.6, this.abduction);
    const pressureGate = smoothstep(1.2, 3.5, dp);
    const drive = dp < 8 ? Math.pow(dp / 8, 0.9) : Math.sqrt(Math.min(dp, 30) / 8);
    this.voicingAmp = p.voicing ? adduction * pressureGate * drive : 0;

    // jet and turbulence sources
    const g = this.geom;
    const teethPos = g ? g.teethPos : this.af.length - 1;
    const slitH = g ? g.slit.height : 0.3;
    // distance from the constriction exit to the incisors
    let exitS = this.fineMinS;
    if (g) {
      for (let i = 0; i <= g.lastRay; i++) {
        if (g.s[i] <= this.fineMinS) continue;
        if (g.hits[i].area > 2.2 * Math.max(this.fineMinArea, 1e-3)) { exitS = g.s[i]; break; }
      }
    }
    const share1 = oral > 0 ? (both / oral) ** 2 : 1;
    this.aero.jet(oral, g ? teethPos - exitS : -1, slitH, this.jet, this.fineMinPerimeter, this.fineMinWidth, share1);
    // the jets lose their kinetic pressure where they expand: flow resistances
    kineticResistances(this.af.areas, this.aero.uMouth, this.wg.resTarget, this.constrictionIndex, this.fineMinArea);
    const n = this.params.noise;
    const db = (x: number) => Math.pow(10, x / 20);
    this.wallAmp = n.fricationOn ? NOISE_K.wall * this.jet.wallSource * db(n.frication) : 0;
    this.obsAmp = n.obstacleOn ? NOISE_K.obstacle * this.jet.obstacleSource * db(n.obstacle) : 0;
    this.wallNoise.configure(this.fsT, this.jet.fc);
    if (this.wallJunction2 >= 0) {
      this.aero.jet(a2, -1, 0, this.jet2, this.second.perimeter, this.second.width, (both / a2) ** 2);
      this.wallAmp2 = n.fricationOn ? NOISE_K.wall * this.jet2.wallSource * db(n.frication) : 0;
      this.wallNoise2.configure(this.fsT, this.jet2.fc);
    } else this.wallAmp2 = 0;
    // a click's jet, inward: the same law as a fricative's, from its own cavity's pressure
    if (this.clickOn && this.clickJetJunction >= 0 && this.clickAero.po < 0) {
      this.clickAero.jet(this.clickFrontArea, -1, 0, this.clickJet);
      this.clickJetAmp = n.fricationOn ? NOISE_K.wall * this.clickJet.wallSource * db(n.frication) : 0;
      this.clickNoise.configure(this.fsT, this.clickJet.fc);
    } else this.clickJetAmp = 0;
    // glottal jet: width of the glottis ~0.2-0.3 cm, St ~0.15
    const vgl = Math.sqrt((2 * Math.max(this.psCur - this.aero.po, 0)) / RHO);
    this.aspNoise.configure(this.fsT, (0.15 * vgl) / (0.25 * scale));
    this.obsNoise.configure(this.fsT, this.jet.fcObstacle);
    this.userAmp = n.user.on ? NOISE_K.user * 1000 * db(n.user.level) : 0;
  }

  // -------------------------------------------------------- sample loop

  private nextPeriod = (src: LFSource): void => {
    const s = this.params.source;
    // creak adds irregularity and weakens alternate pulses
    const c = this.creak;
    const j = ((s.jitter + 6 * c) / 100) * this.rng.gauss();
    src.periodF0 = Math.max(20, Math.min(1500, this.f0 * (1 + Math.max(-0.3, Math.min(0.3, j)))));
    let amp = 1 + ((s.shimmer + 10 * c) / 100) * this.rng.gauss();
    const dip = Math.max(s.diplophonia, 0.6 * c);
    if (dip > 0 && (src.periodIndex & 1)) amp *= 1 - 0.8 * dip;
    this.periodAmp = Math.max(0, amp);
    const rd = Math.max(0.3, Math.min(2.7, s.rd + this.rdOffset + THIN.rd * thinness(s)));
    const timing: LFTiming = s.advanced ? timingFromQuotients(s.oq, s.alphaM, s.ra) : rdToTiming(rd);
    src.setShape(timing);
    // measured F0 (for display)
    this.measuredF0 = src.periodF0;
  };

  private tractStep(): number {
    const p = this.params;
    const wg = this.wg;
    const fs = this.fsT;
    const dt = 1 / fs;
    this.tractTime += dt;
    const s2 = p.anatomy.scale * p.anatomy.scale * (p.anatomy.foldLength ?? 1);
    // control-rate values, ramped across the control period
    const ph = this.ctrlPhase = Math.min(1, this.ctrlPhase + 1 / (CTRL * this.ratio));
    const voicingAmp = this.rVoicing.at(ph);
    const gate = this.rGate.at(ph);
    const abduction = this.rAbd.at(ph);
    // intraoral pressure and lung pressure come from the control-rate
    // aerodynamics: interpolate them per sample (no staircase in the flow)
    this.poNow += (this.rPo.at(ph) - this.poNow) * this.mouthCoef;
    this.psNow += (this.rPs.at(ph) - this.psNow) * this.mouthCoef;
    const po = this.poNow;
    const ps = this.psNow;
    const dp = Math.max(ps - po, 0);
    const vg = Math.sqrt((2 * dp) / RHO);
    const z0 = wg.z0;
    const steadyArea = gapOf(p.source) * s2 * gate + 0.55 * s2 * abduction;
    let u = 0; // total glottal flow (cm^3/s)
    let ag = steadyArea;
    if (p.source.model === 'lf') {
      this.lf.step(fs, this.nextPeriod);
      const amp = p.voicing ? p.source.peakArea * (1 - THIN.swing * thinness(p.source)) * s2 * voicingAmp * this.periodAmp * gate : 0;
      const avib = amp * this.lf.flow;
      ag = avib + steadyArea;
      u = ag * vg;
      // acoustic part of the flow: the pulses minus their period mean. The
      // quasi-steady flow (mean of the pulses plus any leak) belongs to the
      // aerodynamic model and is not injected into the waveguide. The mean
      // glides (3 ms): a new period with another amplitude (shimmer) or shape
      // (Rd) would otherwise shift it in one step, a click at every period.
      this.pulseMean += (amp * this.lf.meanFlow - this.pulseMean) * this.pulseMeanCoef;
      const uAc = (avib - this.pulseMean) * vg;
      // glottal impedance (dynamic Bernoulli resistance) for source-tract interaction
      const zg = u > 1e-3 ? (2 * dp) / u : 1e12;
      const rgPhys = (zg - z0) / (zg + z0);
      const rg = 1 - p.source.interaction * (1 - Math.max(-0.4, rgPhys));
      this.uMean = this.uMeanCoef * this.uMean + (1 - this.uMeanCoef) * u;
      wg.rg = rg;
      wg.glottalInjection = z0 * (1 + rg) * 0.5 * uAc;
    } else {
      const tp = this.tm.params;
      const sp = p.source;
      tp.asym = Math.min(1, sp.asym + 0.3 * this.creak);
      tp.a0 = Math.max(0.0, sp.restArea) * s2 + (p.voicing ? 0 : 0.2);
      tp.d1 = 0.25 * p.anatomy.scale * (1 - 0.6 * thinness(sp));
      tp.len = p.anatomy.foldLength ?? 1;
      tp.q = sp.tensionAuto ? this.tmQ : sp.q;
      const uf = this.tm.step(dt, p.voicing ? ps : 0, po, wg.pMinus, z0, this.uMean) * gate;
      ag = Math.max(0, this.tm.amin) + steadyArea;
      u = uf + steadyArea * vg;
      this.uMean = this.uMeanCoef * this.uMean + (1 - this.uMeanCoef) * uf;
      wg.rg = 1;
      wg.glottalInjection = z0 * (uf - this.uMean);
      if (this.tm.openingEvent && this.tm.lastPeriod > 0) {
        const f = 1 / this.tm.lastPeriod;
        this.measuredF0 = f;
        if (sp.tensionAuto && this.f0 > 0) {
          const err = Math.log(this.f0 / f);
          this.tmQ = Math.max(0.3, Math.min(6, this.tmQ * Math.exp(0.35 * Math.max(-0.5, Math.min(0.5, err)))));
        }
        this.lastOpenTime = this.tractTime;
      }
      if (this.tractTime - this.lastOpenTime > 0.1) {
        // not oscillating: move tension toward the open-loop estimate
        this.tmQ += (this.f0 / 125 - this.tmQ) * 0.0005;
        this.measuredF0 = 0;
      }
    }
    this.dflow = (u - this.gFlowPrev) * fs;
    this.gFlowPrev = u;
    this.glottalFlow = u;
    this.glottalArea = ag;

    // aspiration: turbulence of the glottal jet, pulsed by the flow
    const n = p.noise;
    let asp = 0;
    if (n.aspirationOn && ag > 1e-5) {
      const re = u / (FOLD_LENGTH * p.anatomy.scale * (p.anatomy.foldLength ?? 1) * NU);
      this.glottalRe = re;
      // turbulence grows once the glottal jet is clearly above the critical
      // Reynolds number: modal pulses (peak Re ~2000) stay mostly laminar,
      // a leaky (breathy) or abducted glottis (Re 4000+) is fully turbulent
      const onset = 0.1 + 0.9 * smoothstep(RE_CRIT * 0.9, RE_CRIT * 2.2, re);
      const inst = ((RHO * vg * vg * vg) / C_SOUND) * Math.sqrt(ag / 0.1) * onset;
      this.aspMean += (inst - this.aspMean) * 0.0005;
      const m = n.aspirationPulse;
      const amp = NOISE_K.aspiration * Math.pow(10, n.aspiration / 20) * ((1 - m) * this.aspMean + m * inst);
      asp = amp * this.aspNoise.next();
    }
    // flow modulation of the supraglottal sources: the glottal pulses pass through the constriction
    const ug = this.rUg.at(ph);
    const mod = ug > 1 ? Math.min(3, Math.pow(Math.max(0, u) / Math.max(ug, 1), 1.5)) : 1;
    const wallAmp = this.rWall.at(ph), obsAmp = this.rObs.at(ph);
    const wall = wallAmp > 0 ? wallAmp * mod * this.wallNoise.next() : 0;
    const wallAmp2 = this.rWall2.at(ph);
    const wall2 = wallAmp2 > 0 && this.wallJunction2 >= 0 ? wallAmp2 * mod * this.wallNoise2.next() : 0;
    const obs = obsAmp > 0 ? obsAmp * mod * this.obsNoise.next() : 0;
    const clickJetAmp = this.rClickJet.at(ph);
    const cjet = clickJetAmp > 0 && this.clickJetJunction >= 0 ? clickJetAmp * this.clickNoise.next() : 0;
    let user = 0;
    if (this.userAmp > 0) {
      const fl = p.source.peakArea > 0 ? Math.min(2, u / Math.max(p.source.peakArea * s2 * vg, 1)) : 0;
      const m = n.user.pulse;
      user = this.userAmp * ((1 - m) + m * 2 * fl) * this.userNoise.next(fs);
    }
    this.lastNoise = asp + wall + wall2 + obs + user + cjet;

    wg.srcCount = 0;
    if (asp !== 0) { wg.srcJunction[wg.srcCount] = this.aspJunction; wg.srcValue[wg.srcCount++] = asp; }
    if (wall !== 0) { wg.srcJunction[wg.srcCount] = this.wallJunction; wg.srcValue[wg.srcCount++] = wall; }
    if (wall2 !== 0) { wg.srcJunction[wg.srcCount] = this.wallJunction2; wg.srcValue[wg.srcCount++] = wall2; }
    if (obs !== 0) { wg.srcJunction[wg.srcCount] = this.teethJunction; wg.srcValue[wg.srcCount++] = obs; }
    if (cjet !== 0) { wg.srcJunction[wg.srcCount] = this.clickJetJunction; wg.srcValue[wg.srcCount++] = cjet; }
    if (user !== 0 && !n.user.bypassTract && this.userJunction >= 0) {
      wg.srcJunction[wg.srcCount] = this.userJunction; wg.srcValue[wg.srcCount++] = user;
    }
    // release transient: the fast part of the mouth flow injected at the constriction
    // (the aerodynamic flow is updated at the control rate: smooth it to
    // remove the staircase, keeping the millisecond-scale release transient)
    this.mouthNow += (this.rMouth.at(ph) - this.mouthNow) * this.mouthCoef;
    if (n.burstOn) {
      this.mouthSlow += (this.mouthNow - this.mouthSlow) * this.slowCoef;
      wg.monoJunction = Math.min(N_SECTIONS - 2, this.constrictionIndex);
      wg.monoValue = NOISE_K.burst * (this.mouthNow - this.mouthSlow);
    } else wg.monoJunction = -1;
    // a click: the air rushing into its rarefied cavity as the front opens
    this.clickNow += (this.rClick.at(ph) - this.clickNow) * this.mouthCoef;
    this.clickSlow += (this.clickNow - this.clickSlow) * this.slowCoef;
    if (n.burstOn && this.clickFrontIndex >= 0) {
      wg.monoJunction = Math.min(N_SECTIONS - 2, this.clickFrontIndex);
      wg.monoValue = NOISE_K.burst * (this.clickNow - this.clickSlow);
    }

    wg.step();
    const uOut = wg.lipFlow + wg.nosFlow + p.wallRadiation * wg.wallFlow;
    let rad = (uOut - this.uPrev) * fs;
    this.uPrev = uOut;
    if (p.bypassTract) rad = this.dflow + (asp + wall + obs + user) * NOISE_K.bypass * fs;
    else if (n.user.bypassTract && user !== 0) rad += user * NOISE_K.bypass * fs;

    // meters
    const la = this.levelAcc;
    la.aspiration += asp * asp; la.wall += wall * wall; la.obstacle += obs * obs; la.user += user * user;
    la.voice += this.voicingAmp; la.n++;

    return this.lpf.process(rad * RAD_PA / FULL_SCALE_PA);
  }

  /** Renders n output samples into out (mono). */
  process(out: Float32Array, n: number = out.length): void {
    const gain = Math.pow(10, this.params.volume / 20);
    const st = this.streams;
    for (let i = 0; i < n; i++) {
      if (this.ctrl-- <= 0) { this.ctrl = CTRL - 1; this.control(); }
      this.pos += this.ratio;
      const need = Math.floor(this.pos) + 2;
      while (this.produced <= need) {
        const y = this.tractStep();
        this.ring[this.ringIdx & 7] = y;
        this.ringIdx++;
        this.produced++;
      }
      // keep pos and produced bounded
      if (this.produced > 1 << 30) { this.produced -= 1 << 29; this.pos -= 1 << 29; }
      const base = Math.floor(this.pos);
      const frac = this.pos - base;
      // ring holds the last 8 tract samples; we need base-1 .. base+2
      const off = this.produced - 1 - (base + 2);
      const i3 = this.ringIdx - 1 - off;
      const y0 = this.ring[(i3 - 3) & 7], y1 = this.ring[(i3 - 2) & 7], y2 = this.ring[(i3 - 1) & 7], y3 = this.ring[i3 & 7];
      // Catmull-Rom cubic interpolation
      const c1 = 0.5 * (y2 - y0);
      const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
      const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      let y = ((c3 * frac + c2) * frac + c1) * frac + y1;
      y *= gain;
      this.levelAcc.out += y * y;
      // soft limiter
      const ay = Math.abs(y);
      if (ay > 0.8) y = Math.sign(y) * (0.8 + 0.2 * Math.tanh((ay - 0.8) / 0.2));
      out[i] = y;
      if (st) {
        const k = this.streamPos;
        if (k < st.out.length) {
          st.out[k] = y;
          st.flow[k] = this.glottalFlow;
          st.noise[k] = this.lastNoise;
          this.streamPos = k + 1;
        }
      }
    }
  }

  /** Builds a telemetry snapshot and resets the accumulators. */
  telemetry(): Telemetry {
    const wg = this.wg;
    const n = N_SECTIONS;
    const pR = new Float64Array(n), uR = new Float64Array(n);
    const c = Math.max(1, wg.accCount);
    let pm = 1e-9, um = 1e-9;
    for (let i = 0; i < n; i++) {
      pR[i] = Math.sqrt(wg.pAcc[i] / c); uR[i] = Math.sqrt(wg.uAcc[i] / c);
      pm = Math.max(pm, pR[i]); um = Math.max(um, uR[i]);
    }
    for (let i = 0; i < n; i++) { pR[i] /= pm; uR[i] /= um; }
    wg.pAcc.fill(0); wg.uAcc.fill(0); wg.accCount = 0;
    const la = this.levelAcc;
    const ln = Math.max(1, la.n);
    const lv = this.telemetryLevels;
    lv.aspiration = Math.sqrt(la.aspiration / ln); lv.wall = Math.sqrt(la.wall / ln);
    lv.obstacle = Math.sqrt(la.obstacle / ln); lv.user = Math.sqrt(la.user / ln);
    lv.voice = la.voice / ln; lv.out = Math.sqrt(la.out / Math.max(1, ln / this.ratio));
    la.aspiration = la.wall = la.obstacle = la.user = la.voice = la.out = 0; la.n = 0;
    const s = this.params.source;
    const timing = s.advanced ? timingFromQuotients(s.oq, s.alphaM, s.ra) : rdToTiming(s.rd);
    const g = this.geom;
    let phone = '';
    if (this.score) {
      for (const ph of this.score.phones) if (this.scoreTime >= ph.t0 && this.scoreTime < ph.t1) { phone = ph.ipa; break; }
    }
    return {
      time: this.time,
      articulators: { ...this.art },
      abduction: this.abduction,
      areas: Float64Array.from(this.af.areas),
      length: this.af.length,
      fsTract: this.fsT,
      teethIndex: this.af.teethIndex,
      lipsIndex: this.af.lipsIndex,
      nasalPort: portArea(this.art.velum, this.params.anatomy.nasalLeak, this.params.anatomy.scale),
      pRms: pR,
      uRms: uR,
      f0: s.model === 'lf' ? (this.voicingAmp > 0.05 ? this.lf.periodF0 : 0) : this.measuredF0,
      f0Target: this.f0,
      phase: this.lf.phase,
      openQuotient: timing.te,
      speedQuotient: timing.tp / timing.te,
      ra: timing.ta,
      glottalArea: this.glottalArea,
      glottalFlow: this.glottalFlow,
      twoMass: s.model === 'twomass'
        ? { l1: this.tm.x[0], l2: this.tm.x[1], r1: this.tm.x[2], r2: this.tm.x[3], a1: this.tm.a1, a2: this.tm.a2, q: s.tensionAuto ? this.tmQ : s.q }
        : null,
      voicingAmp: this.voicingAmp,
      ps: this.psCur,
      po: this.aero.po,
      ug: this.aero.ug,
      uMouth: this.aero.uMouth,
      uNose: this.aero.uNose,
      constrictionIndex: this.constrictionIndex,
      clickPo: this.clickAero.po,
      uClick: this.clickAero.uMouth,
      constrictionArea: this.fineMinArea,
      jet: { ...this.jet },
      glottalRe: this.glottalRe,
      slit: g ? { height: g.slit.height, width: g.slit.width, area: g.slit.area, vertical: g.slit.vertical } : { height: 0, width: 0, area: 0, vertical: 0 },
      levels: { ...lv },
      playing: this.score !== null,
      scoreTime: this.scoreTime,
      phone,
    };
  }

  /** Immediately jumps the smoothed articulators to their targets. */
  snapArticulators(): void {
    for (const k of ARTICULATOR_KEYS) { this.tam[k].set(this.params.articulators[k]); this.art[k] = this.params.articulators[k]; }
    this.updateGeometry(true);
  }

  /** Jumps lung pressure (for offline rendering). */
  snapPressure(): void {
    const ps = this.params.phonate ? this.params.source.ps : 0;
    this.tam.ps.set(ps);
    this.psCur = ps * CMH2O;
    this.psNow = this.psCur;
    this.rPs.snap(this.psCur);
  }

  get tractRate(): number { return this.fsT; }
}

/** Offline rendering helper (tests, export). */
export function renderOffline(params: EngineParams, seconds: number, fs = 48000, score?: Score): { out: Float32Array; engine: VoiceEngine } {
  const e = new VoiceEngine(fs, params);
  e.snapArticulators();
  e.snapPressure();
  if (score) e.playScore(score);
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  const block = 128;
  for (let i = 0; i < n; i += block) {
    const m = Math.min(block, n - i);
    const view = out.subarray(i, i + m);
    e.process(view, m);
  }
  return { out, engine: e };
}

export type { ScoreFrame };
