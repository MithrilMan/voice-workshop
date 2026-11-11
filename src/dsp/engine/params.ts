import { Anatomy, Articulators, Teeth, DEFAULT_ANATOMY, DEFAULT_ARTICULATORS, DEFAULT_TEETH } from '../tract/types';
import { colourCurve, NOISE_CURVE_POINTS } from '../noise/noise';

export type SourceModel = 'lf' | 'twomass';

export interface SourceParams {
  model: SourceModel;
  /** target fundamental frequency, Hz */
  f0: number;
  /** LF shape parameter Rd (0.3 pressed ... 2.7 breathy) */
  rd: number;
  /** use Oq / alpha_m / Ra instead of Rd */
  advanced: boolean;
  oq: number;
  alphaM: number;
  ra: number;
  /** the return phase of each pulse (the time the folds take to close, Ta) against the one its Rd gives, 1 = Fant's:
   *  shorter, a sharper closure and stronger upper harmonics for the same opening (H1-H2) */
  returnPhase?: number;
  /** peak glottal opening in LF mode, cm^2 (sets the flow amplitude) */
  peakArea: number;
  /** posterior glottal chink (incomplete closure), cm^2 */
  chink: number;
  /** vertical thickness of the part of the folds that vibrates, 1 = body and cover together, as in a chest (modal)
   *  voice; thin, only the edge of the cover stretched by the cricothyroid: falsetto. Thinner folds close less
   *  and later, so the pulse is softer and the harmonics fall faster (Hollien 1974; Zhang 2016) */
  thickness: number;
  /** subglottal (lung) pressure, cm H2O */
  ps: number;
  /** cycle-to-cycle period perturbation, % */
  jitter: number;
  /** cycle-to-cycle amplitude perturbation, % */
  shimmer: number;
  /** alternate-cycle amplitude difference (diplophonia, creak), 0..1 */
  diplophonia: number;
  /** strength of source-tract interaction (glottal losses during the open phase), 0..1 */
  interaction: number;
  /** vibrato rate (Hz) and depth (cents) */
  vibratoRate: number;
  vibratoDepth: number;
  // two-mass model
  /** automatic tension control to follow f0 (otherwise use q) */
  tensionAuto: boolean;
  q: number;
  /** left/right asymmetry (raspy, subharmonics) */
  asym: number;
  /** rest (pre-phonatory) area of each mass, cm^2 */
  restArea: number;
}

export type NoiseLocation = 'glottis' | 'constriction' | 'teeth' | 'lips' | 'custom';

export interface UserNoiseParams {
  on: boolean;
  /** level in dB (0 dB is a moderate hiss) */
  level: number;
  location: NoiseLocation;
  /** custom position along the tract, 0 (glottis) .. 1 (lips) */
  position: number;
  /** 0 = steady, 1 = fully pulsed by the glottal flow */
  pulse: number;
  /** spectral shape in dB on log-spaced frequencies (NOISE_CURVE_POINTS) */
  curve: number[];
  lowCut: number;
  highCut: number;
  /** if true the noise bypasses the tract (heard as generated) */
  bypassTract: boolean;
}

export interface NoiseParams {
  aspirationOn: boolean;
  /** dB trim of the aspiration source */
  aspiration: number;
  /** 0 = steady aspiration, 1 = pulsed with the glottal flow (physical) */
  aspirationPulse: number;
  fricationOn: boolean;
  /** dB trim of the wall (jet) source at the constriction */
  frication: number;
  obstacleOn: boolean;
  /** dB trim of the obstacle (teeth) source */
  obstacle: number;
  /** release transient of stops on/off */
  burstOn: boolean;
  user: UserNoiseParams;
}

export interface EngineParams {
  articulators: Articulators;
  anatomy: Anatomy;
  teeth: Teeth;
  /** glottal abduction (0 = phonation position, 1 = wide open, breathing) */
  abduction: number;
  /** air from the lungs on/off */
  phonate: boolean;
  /** vocal folds allowed to vibrate (off = whisper / noise only) */
  voicing: boolean;
  source: SourceParams;
  noise: NoiseParams;
  /** output volume, dB */
  volume: number;
  /** bypass the vocal tract and hear the raw sources */
  bypassTract: boolean;
  /** multiplier of the waveguide losses */
  losses: number;
  /** how much of the yielding walls' motion is heard through the skin of the neck and cheeks (1 = all of it; the back of
   *  the pharynx rests on the spine and the neck is farther from the listener than the lips, so about half by default) */
  wallRadiation: number;
  /** the trachea and the bronchi below the glottis resonate, and are heard whenever the glottis is open */
  subglottal: boolean;
  /** vocal tract drawn as a tube (direct area-function mode) */
  tubeMode: boolean;
  /** user area function for tube mode (cm^2), any length >= 2, resampled to N */
  tubeAreas: number[];
  /** tube length in tube mode, cm */
  tubeLength: number;
}

export const DEFAULT_SOURCE: SourceParams = {
  model: 'lf',
  f0: 120,
  rd: 1.0,
  advanced: false,
  oq: 0.6,
  alphaM: 0.75,
  ra: 0.03,
  returnPhase: 1,
  peakArea: 0.12,
  chink: 0.01,
  thickness: 1,
  ps: 8,
  jitter: 0.4,
  shimmer: 2,
  diplophonia: 0,
  interaction: 0.6,
  vibratoRate: 5.5,
  vibratoDepth: 0,
  tensionAuto: true,
  q: 1,
  asym: 0,
  restArea: 0.03,
};

export const DEFAULT_USER_NOISE: UserNoiseParams = {
  on: false,
  level: 0,
  location: 'teeth',
  position: 0.9,
  pulse: 0,
  curve: Array.from(colourCurve('white')),
  lowCut: 100,
  highCut: 14000,
  bypassTract: false,
};

export const DEFAULT_NOISE: NoiseParams = {
  aspirationOn: true,
  aspiration: 0,
  aspirationPulse: 1,
  fricationOn: true,
  frication: 0,
  obstacleOn: true,
  obstacle: 0,
  burstOn: true,
  user: DEFAULT_USER_NOISE,
};

export function defaultParams(): EngineParams {
  return {
    articulators: { ...DEFAULT_ARTICULATORS },
    anatomy: { ...DEFAULT_ANATOMY },
    teeth: { ...DEFAULT_TEETH },
    abduction: 0,
    phonate: false,
    voicing: true,
    source: { ...DEFAULT_SOURCE },
    noise: { ...DEFAULT_NOISE, user: { ...DEFAULT_USER_NOISE, curve: DEFAULT_USER_NOISE.curve.slice() } },
    volume: 0,
    bypassTract: false,
    losses: 1,
    wallRadiation: 0.5,
    subglottal: true,
    tubeMode: false,
    tubeAreas: new Array(16).fill(3),
    tubeLength: 17.5,
  };
}

export { NOISE_CURVE_POINTS };

/** A frame of a sequenced utterance: targets for the articulators and source. */
export interface ScoreFrame {
  /** time, s */
  t: number;
  /** articulator targets; a score without them (a melody) leaves the tract to the hands */
  art?: Articulators;
  abduction: number;
  f0: number;
  /** lung pressure, cm H2O */
  ps: number;
  /**
   * fast tongue-tip raise added after the articulator smoothing (cm): the
   * ballistic contacts of taps and trills, too quick for the target dynamics
   */
  tip?: number;
  /** the same for the lips (added to lipOpen: bilabial trills, labiodental flaps) */
  lips?: number;
  /** and for the dorsum against the uvula (added to tongueX: uvular trills) */
  dorsum?: number;
  /**
   * a trill (0..1): the articulator `trillKey` becomes a mass on a spring
   * held lightly past its contact at `trillAt`, and the air behind it blows
   * it open
   */
  trill?: number;
  /** a click (0..1): how far the tongue body has rarefied the air between its two closures */
  click?: number;
  trillKey?: 'tipY' | 'lipOpen' | 'tongueX';
  trillAt?: number;
  /** how far from its contact the trilling articulator may open (its units): a fricative trill (ř) opens only into a narrow, hissing passage */
  trillOpen?: number;
  /** change of the LF shape parameter Rd (breathier phrase ends, tenser accents) */
  rd?: number;
  /** vocal-fold vibration and leak allowed (1) or folds pressed shut (0, glottal stop) */
  gate?: number;
  /** creak (0..1): slow, irregular pulses with alternate ones weaker (laryngealized sounds, vocal fry) */
  creak?: number;
  /**
   * folds held stiff (0..1): close to each other, they do not vibrate. The
   * glottis of a plain voiceless stop at its release: little air passes, so
   * the burst is short, and the voice starts after a short lag
   */
  stiff?: number;
  /** walls of the cavity tensed (up to 1: they do not yield to the pressure of an ejective) or let go (down to -1: they give way, as in an implosive) */
  tense?: number;
}

export interface ScorePhone { ipa: string; t0: number; t1: number; label?: string }

export interface Score {
  frames: ScoreFrame[];
  phones: ScorePhone[];
  duration: number;
  /** slow random wander of F0 while the score plays (Klatt's flutter, 0..100; 25 is natural) */
  flutter?: number;
  /**
   * a living voice: with a seed the flutter is a random wander (another for
   * each seed) instead of Klatt's three sines, and the breath and the
   * tension of the folds wander too, by `variation` (1 = usual)
   */
  seed?: number;
  variation?: number;
  /** time constant (s) of the F0 smoothing while the score plays, when its contour is already smooth */
  f0Tau?: number;
  /** multipliers of the articulators' time constants while the score plays (a slack or a crisp speaker) */
  tauScale?: Partial<Record<keyof Articulators, number>>;
}
