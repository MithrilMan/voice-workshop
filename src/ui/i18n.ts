/** The strings of the interface that more than one component uses. */
export const S = {
  appTitle: 'Voice Workshop',
  appSub: 'a buzz, a hiss and a filter',
  mLearn: 'Learn',
  mPlay: 'Play',
  mLab: 'Lab',
  mVoices: 'Voices',
  mLearnHint: 'Guided chapters, one step at a time',
  mPlayHint: 'A few big controls to play with the voice',
  mLabHint: 'Every control, ordered along the signal chain',
  mVoicesHint: 'Make, save and share a voice of your own',
  sound: 'Sound',
  soundOn: 'Sound on',
  soundHint: 'Gives the head a breath of voice: you hear its shape',
  soundOffHint: 'Stops everything: sentence, melody, clip and lungs',
  hold: 'Hold',
  holdHint: 'The voice keeps sounding instead of resting after a breath',
  numbers: 'Numbers',
  freeze: 'Freeze',
  volume: 'Volume',
  // view tabs
  vSpectrum: 'Spectrum',
  vScope: 'Waveform',
  vGlottis: 'Vocal folds',
  vChart: 'Vowel map',
  vTube: 'The tube',
  v3d: '3D tract',
  spectrogram: 'Spectrogram',
  // control tabs
  cSource: 'Source',
  cTract: 'Tract & person',
  cTeeth: 'Teeth & slit',
  cNoise: 'Noise',
  cSpeak: 'Speak',
  cMelody: 'Melody',
  cAB: 'A/B experiment',
  cMachine: 'Machine voice',
  // head view
  headTitle: 'Head cross-section',
  headHint: 'Drag the handles: tongue, tip, jaw, lips, velum, larynx, teeth',
  fieldPressure: 'Pressure',
  fieldVelocity: 'Velocity',
  fieldAir: 'Airflow',
  hTongue: 'tongue',
  hTip: 'tip',
  hJaw: 'jaw',
  hLips: 'lips',
  hVelum: 'velum',
  hLarynx: 'larynx',
  hTeeth: 'teeth',
  // misc
  play: 'Listen',
  stop: 'Stop',
  reset: 'Reset',
  on: 'on',
  off: 'off',
  mic: 'Microphone',
  micHint: 'Compare your voice (analysis only, nothing is recorded)',
  harmonics: 'Harmonics',
  envelope: 'Filter envelope',
  window: 'Window',
  mel: 'Log-mel 80 bands',
  linear: 'Linear',
  noAudio: 'Press “Sound” to hear and see the voice.',
} as const;

export type Key = keyof typeof S;

export const tr = (k: Key): string => S[k];

export function useT(): (k: Key) => string {
  return tr;
}
