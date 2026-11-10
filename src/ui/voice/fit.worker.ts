/**
 * Fits a voice to a recording away from the page: the recording is
 * measured, then the voice is said and measured again and again (a few
 * minutes), and every step is reported so that the page can show it, and
 * keep the best voice so far if it is stopped.
 */
import { voicePrint } from '../../dsp/analysis/voiceprint';
import { fitVoice, Material } from '../../dsp/voice/fit';

export interface FitRequest { samples: Float32Array; fs: number; material: Material[]; sameText: boolean; effort: number }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<FitRequest>) => void) | null; postMessage(m: unknown): void };

ctx.onmessage = (e) => {
  const { samples, fs, material, sameText, effort } = e.data;
  try {
    const target = voicePrint([{ samples, fs }]);
    if (target.frames < 20) { ctx.postMessage({ type: 'error', reason: 'novoice' }); return; }
    const res = fitVoice(target, material, {
      sameText, effort,
      onProgress: (p) => ctx.postMessage({ type: 'progress', stage: p.stage, evaluations: p.evaluations, budget: p.budget, distance: p.distance, design: p.design }),
    });
    ctx.postMessage({ type: 'done', design: res.design, measures: res.measures, startDistance: res.startDistance, distance: res.distance, evaluations: res.evaluations });
  } catch (err) {
    ctx.postMessage({ type: 'error', reason: err instanceof Error ? err.message : String(err) });
  }
};
