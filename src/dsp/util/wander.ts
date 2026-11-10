import { Rng } from './rng';

/**
 * A slow random wander of unit rms: the sum of a few low-passed noises with
 * their corners an octave or more apart and the same power each, so that
 * it moves about as much over a second as over a tenth of one (a drift
 * close to 1/f). Each noise passes two one-pole low-passes, so that above
 * its corner it falls by 12 dB an octave and the wander is smooth from one
 * step to the next. It starts already wandering, not from zero.
 */
export class Wander {
  private readonly y1: Float64Array;
  private readonly y2: Float64Array;
  private readonly rng: Rng;

  constructor(seed: number, private readonly corners: readonly number[]) {
    this.rng = new Rng(seed);
    this.y1 = new Float64Array(corners.length);
    this.y2 = new Float64Array(corners.length);
    for (let i = 0; i < corners.length; i++) this.y1[i] = this.y2[i] = this.rng.gauss();
  }

  /** the value after another dt seconds */
  step(dt: number): number {
    let s = 0;
    for (let i = 0; i < this.corners.length; i++) {
      const a = 1 - Math.exp(-2 * Math.PI * this.corners[i] * dt), r = 1 - a;
      // white noise through a²/(1 - r z⁻¹)² has the variance a(1 + r²)/(2 - a)³ times its own
      const gain = Math.sqrt((2 - a) ** 3 / (a * (1 + r * r)));
      this.y1[i] += a * (gain * this.rng.gauss() - this.y1[i]);
      this.y2[i] += a * (this.y1[i] - this.y2[i]);
      s += this.y2[i];
    }
    return s / Math.sqrt(this.corners.length);
  }
}
