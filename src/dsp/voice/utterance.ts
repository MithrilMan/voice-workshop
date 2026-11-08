import { defaultParams, EngineParams, Score } from '../engine/params';
import { buildScore, ScoreOptions } from '../speech/sequencer';
import type { Phone } from '../speech/g2p';
import { VoiceDesign, applyDesign, speechOptions } from './design';

/**
 * What a voice needs to say something: the engine's parameters (its body,
 * its folds) and the score (the phones with its habits and its way of
 * speaking). One turn of a conversation: several voices, each with its own
 * engine or one after another on the same one, are a dialogue.
 */
export interface Utterance {
  voice: string;
  params: EngineParams;
  score: Score;
}

export function utterance(d: Readonly<VoiceDesign>, phones: Phone[], lang: string, over: ScoreOptions = {}): Utterance {
  const params = defaultParams();
  applyDesign(params, d);
  params.phonate = true;
  return { voice: d.id, params, score: buildScore(phones, { ...speechOptions(d, lang), ...over }) };
}
