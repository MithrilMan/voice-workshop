import { Bi, VoiceDesign, cloneVoice } from './design';

/** A voice that comes with the simulator: a starting point for your own. */
export interface BuiltinVoice {
  id: string;
  name: Bi;
  hint: Bi;
  design: Readonly<VoiceDesign>;
}

const voice = (id: string, name: Bi, hint: Bi, make: (d: VoiceDesign) => void): BuiltinVoice => {
  const d = cloneVoice();
  d.id = `builtin-${id}`;
  d.name = name.en;
  make(d);
  return { id, name, hint, design: d };
};

/**
 * The speakers of the source panel (the first nine, the same voices as
 * before they were data) and a few colours of voice, each made of the body
 * and the habits that give it.
 */
export const BUILTIN_VOICES: BuiltinVoice[] = [
  voice('man', { it: 'Uomo', en: 'Man' }, { it: 'tratto di 17,5 cm, circa 110 Hz', en: '17.5 cm tract, about 110 Hz' }, (d) => { d.speaking.f0 = 110; }),
  voice('woman', { it: 'Donna', en: 'Woman' }, { it: 'tratto più corto (faringe relativamente più corta), circa 210 Hz, un po’ soffiata', en: 'shorter tract (relatively shorter pharynx), about 210 Hz, a little breathy' }, (d) => {
    d.body.anatomy.scale = 0.87; d.body.anatomy.pharynx = 0.86; d.speaking.f0 = 210; d.phonation.rd = 1.3; d.phonation.chink = 0.03; d.phonation.peakArea = 0.09;
  }),
  voice('child', { it: 'Bambino', en: 'Child' }, { it: 'tratto di circa 12,5 cm, circa 290 Hz', en: 'about 12.5 cm tract, about 290 Hz' }, (d) => {
    d.body.anatomy.scale = 0.72; d.body.anatomy.pharynx = 0.8; d.speaking.f0 = 290; d.phonation.rd = 1.4; d.phonation.chink = 0.025; d.phonation.peakArea = 0.06;
  }),
  voice('deep', { it: 'Profonda', en: 'Deep' }, { it: 'tratto lungo, laringe bassa, faringe ampia, circa 80 Hz', en: 'long tract, low larynx, wide pharynx, about 80 Hz' }, (d) => {
    d.body.anatomy.scale = 1.08; d.body.anatomy.pharynx = 1.1; d.body.anatomy.pharynxWidth = 1.2; d.habits.larynx = -0.8; d.speaking.f0 = 80; d.phonation.rd = 0.85;
  }),
  voice('whisper', { it: 'Sussurro', en: 'Whisper' }, { it: 'corde aperte che non vibrano: solo fruscio filtrato', en: 'open folds that do not vibrate: filtered hiss only' }, (d) => {
    d.phonation.voicing = false; d.habits.abduction = 0.42; d.phonation.aspiration = 4;
  }),
  voice('creak', { it: 'Cricchiata (vocal fry)', en: 'Creak (vocal fry)' }, { it: 'impulsi lenti e irregolari, cicli alterni', en: 'slow, irregular pulses, alternating cycles' }, (d) => {
    d.speaking.f0 = 48; d.phonation.rd = 0.45; d.phonation.diplophonia = 0.55; d.phonation.jitter = 5; d.phonation.shimmer = 10; d.speaking.ps = 5.5;
  }),
  voice('breathy', { it: 'Soffiata', en: 'Breathy' }, { it: 'le corde non chiudono del tutto: fruscio tra le armoniche', en: 'the folds do not close fully: hiss between the harmonics' }, (d) => {
    d.phonation.chink = 0.12; d.phonation.rd = 2.2;
  }),
  voice('pressed', { it: 'Pressata', en: 'Pressed' }, { it: 'chiusura rapida e lunga: più armoniche acute', en: 'fast, long closure: stronger high harmonics' }, (d) => {
    d.phonation.rd = 0.4; d.speaking.ps = 11; d.phonation.chink = 0;
  }),
  voice('raspy', { it: 'Rauca', en: 'Raspy' }, { it: 'corde auto-oscillanti asimmetriche: subarmoniche e irregolarità', en: 'asymmetric self-oscillating folds: subharmonics and roughness' }, (d) => {
    d.phonation.model = 'twomass'; d.phonation.asym = 0.4; d.speaking.ps = 10; d.speaking.f0 = 120; d.phonation.chink = 0.02;
  }),
  voice('dark', { it: 'Scura', en: 'Dark' }, { it: 'laringe tenuta bassa e faringe ampia: formanti più basse', en: 'larynx held low and a wide pharynx: lower formants' }, (d) => {
    d.speaking.f0 = 105; d.habits.larynx = -0.9; d.body.anatomy.pharynxWidth = 1.3; d.habits.lipRound = 0.15;
  }),
  voice('bright', { it: 'Chiara', en: 'Bright' }, { it: 'laringe alta, faringe stretta, lingua avanti, labbra tirate', en: 'high larynx, narrow pharynx, tongue forward, lips spread' }, (d) => {
    d.speaking.f0 = 130; d.habits.larynx = 0.7; d.body.anatomy.pharynxWidth = 0.75; d.habits.tongueX = 0.2; d.habits.lipRound = -0.3;
  }),
  voice('nasal', { it: 'Nasale', en: 'Nasal' }, { it: 'il velo resta un po’ aperto su vocali e sonoranti', en: 'the velum stays a little open on vowels and sonorants' }, (d) => {
    d.speaking.f0 = 125; d.habits.velum = 0.25; d.habits.jaw = -0.1;
  }),
  voice('warm', { it: 'Calda', en: 'Warm' }, { it: 'faringe un po’ ampia, laringe un po’ bassa, voce morbida', en: 'a slightly wide pharynx and low larynx, a soft voice' }, (d) => {
    d.speaking.f0 = 112; d.habits.larynx = -0.4; d.body.anatomy.pharynxWidth = 1.15; d.phonation.rd = 1.15; d.speaking.style.endRd = 0.7;
  }),
  voice('hollow', { it: 'Cava', en: 'Hollow' }, { it: 'faringe molto ampia e labbra arrotondate', en: 'a very wide pharynx and rounded lips' }, (d) => {
    d.speaking.f0 = 108; d.body.anatomy.pharynxWidth = 1.45; d.habits.lipRound = 0.35; d.habits.lipProtrude = 0.3;
  }),
  // fitted by measurement to the sentences of a reference voice: the usual
  // pitch and its range, the formants of the vowels, the balance of the
  // spectrum and the pace (a voice of the same kind, not a copy of it)
  voice('sky', { it: 'Sky-like', en: 'Sky-like' }, { it: 'donna, voce bassa e morbida con una melodia ampia (circa 170 Hz, 13 semitoni), adattata a misura su una voce di riferimento', en: 'a woman, low and soft with a wide melody (about 170 Hz, 13 semitones), fitted by measurement to a reference voice' }, (d) => {
    d.body.anatomy.scale = 0.87; d.body.anatomy.pharynx = 0.9; d.body.anatomy.palateHeight = 0.8; d.body.anatomy.tongueSize = 0.94;
    d.phonation.rd = 1.2; d.phonation.chink = 0.045; d.phonation.peakArea = 0.09; d.phonation.aspiration = -4; d.phonation.jitter = 1;
    d.habits.tongueX = 0.08; d.habits.epilarynx = 0.2;
    d.speaking.f0 = 172; d.speaking.accent = 8; d.speaking.rate = 1.08;
    Object.assign(d.speaking.style, { phrase: 1.7, floor: 7, finalFall: 3.5, pauseShort: 0.3, pauseLong: 0.45 });
  }),
];

export const builtinVoice = (id: string): BuiltinVoice | undefined => BUILTIN_VOICES.find((v) => v.id === id);
