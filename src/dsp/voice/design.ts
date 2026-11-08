import { Anatomy, Teeth, DEFAULT_ANATOMY, DEFAULT_TEETH } from '../tract/types';
import { EngineParams, SourceModel, DEFAULT_SOURCE, DEFAULT_NOISE } from '../engine/params';
import { ProsodyStyle, DEFAULT_STYLE } from '../speech/style';
import type { ScoreOptions } from '../speech/sequencer';
import { Setting, NO_SETTING, SETTING_OFFSETS } from './setting';

/**
 * A voice, as a person would describe one, in four layers (the layers of
 * Laver's Vocal Profile Analysis, 1980): the body it is made with, how its
 * folds vibrate, the habits of its mouth and the way it speaks. Everything a
 * voice keeps from one sentence to the next is here, and nothing that
 * changes from one sound to the next (the posture of a vowel, the pitch of
 * an accent). A voice is plain data: it is saved, exported as a file and
 * shared as a link.
 */
export type Bi = { it: string; en: string };

/** how the folds vibrate */
export interface Phonation {
  /** LF (the shape of the glottal pulse) or two-mass (folds that vibrate by themselves) */
  model: SourceModel;
  rd: number;
  peakArea: number;
  chink: number;
  jitter: number;
  shimmer: number;
  diplophonia: number;
  interaction: number;
  vibratoRate: number;
  vibratoDepth: number;
  asym: number;
  restArea: number;
  /** the folds vibrate at all (false: a whisper) */
  voicing: boolean;
  /** the hiss of the air through the glottis, dB */
  aspiration: number;
}

/** the posture kept beneath every sound, and how carefully the voice articulates */
export interface Habits extends Setting {
  precision: number;
}

/** how the voice speaks: its usual pitch and loudness, its accents, its pace and its style */
export interface Speaking {
  f0: number;
  ps: number;
  accent: number;
  rate: number;
  style: ProsodyStyle;
}

export const VOICE_FORMAT = 'voice-workshop.voice';
export const VOICE_VERSION = 1;

export interface VoiceDesign {
  format: typeof VOICE_FORMAT;
  version: number;
  /** stays the same when the voice is renamed, exported or shared */
  id: string;
  name: string;
  notes: string;
  body: { anatomy: Anatomy; teeth: Teeth };
  phonation: Phonation;
  habits: Habits;
  speaking: Speaking;
  /** the language it speaks unless told otherwise ('' = the interface's) */
  language: string;
}

const PHONATION_KEYS = ['model', 'rd', 'peakArea', 'chink', 'jitter', 'shimmer', 'diplophonia', 'interaction', 'vibratoRate', 'vibratoDepth', 'asym', 'restArea'] as const;

/**
 * The voice every other one is told apart from: the reference adult male of
 * the simulator. Frozen for each version of the format, since a shared link
 * holds only what differs from it.
 */
export const VOICE_V1_BASE: Readonly<VoiceDesign> = deepFreeze({
  format: VOICE_FORMAT,
  version: 1,
  id: 'reference',
  name: '',
  notes: '',
  body: { anatomy: { ...DEFAULT_ANATOMY }, teeth: { ...DEFAULT_TEETH } },
  phonation: {
    model: DEFAULT_SOURCE.model, rd: DEFAULT_SOURCE.rd, peakArea: DEFAULT_SOURCE.peakArea, chink: DEFAULT_SOURCE.chink,
    jitter: DEFAULT_SOURCE.jitter, shimmer: DEFAULT_SOURCE.shimmer, diplophonia: DEFAULT_SOURCE.diplophonia,
    interaction: DEFAULT_SOURCE.interaction, vibratoRate: DEFAULT_SOURCE.vibratoRate, vibratoDepth: DEFAULT_SOURCE.vibratoDepth,
    asym: DEFAULT_SOURCE.asym, restArea: DEFAULT_SOURCE.restArea, voicing: true, aspiration: DEFAULT_NOISE.aspiration,
  },
  habits: { ...NO_SETTING, precision: 0 },
  speaking: { f0: DEFAULT_SOURCE.f0, ps: DEFAULT_SOURCE.ps, accent: 5, rate: 1, style: { ...DEFAULT_STYLE } },
  language: '',
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

/** A fresh copy of a voice (or of the reference voice), safe to change. */
export function cloneVoice(d: Readonly<VoiceDesign> = VOICE_V1_BASE): VoiceDesign {
  return JSON.parse(JSON.stringify(d)) as VoiceDesign;
}

/** a new id, short and unlikely to repeat */
export function newVoiceId(): string {
  const r = typeof crypto !== 'undefined' && 'getRandomValues' in crypto ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 2 ** 32, Math.random() * 2 ** 32];
  return Array.from(r, (x) => (x >>> 0).toString(36)).join('-');
}

// ------------------------------------------------------------------ fields

export type Tab = 'body' | 'phonation' | 'habits' | 'melody' | 'rhythm';

export interface Field {
  /** dotted path in the voice, e.g. 'body.anatomy.scale' */
  path: string;
  tab: Tab;
  /** a heading inside the tab */
  group: Bi;
  label: Bi;
  /** what it does, in plain words (and where its numbers come from) */
  hint: Bi;
  kind: 'number' | 'boolean' | 'enum';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** for an enum */
  options?: { value: string; label: Bi }[];
}

const n = (path: string, tab: Tab, group: Bi, label: Bi, hint: Bi, min: number, max: number, step: number, unit?: string): Field =>
  ({ path, tab, group, label, hint, kind: 'number', min, max, step, ...(unit ? { unit } : {}) });

const G = {
  size: { it: 'Misure', en: 'Size' },
  palate: { it: 'Palato e arcata', en: 'Palate and arch' },
  nose: { it: 'Naso', en: 'Nose' },
  teeth: { it: 'Denti', en: 'Teeth' },
  folds: { it: 'Corde vocali', en: 'Vocal folds' },
  irregular: { it: 'Irregolarità', en: 'Irregularity' },
  breath: { it: 'Aria e soffio', en: 'Air and breath' },
  vibrato: { it: 'Vibrato', en: 'Vibrato' },
  mouth: { it: 'Bocca e lingua', en: 'Mouth and tongue' },
  lips: { it: 'Labbra', en: 'Lips' },
  throat: { it: 'Gola e naso', en: 'Throat and nose' },
  care: { it: 'Cura', en: 'Care' },
  voice: { it: 'Voce', en: 'Voice' },
  phrase: { it: 'Frase', en: 'Phrase' },
  accent: { it: 'Accenti', en: 'Accents' },
  ends: { it: 'Fine della frase', en: 'End of the phrase' },
  pace: { it: 'Tempo', en: 'Pace' },
  push: { it: 'Spinta', en: 'Push' },
};

export const VOICE_FIELDS: Field[] = [
  // ------------------------------------------------------------- body
  n('body.anatomy.scale', 'body', G.size, { it: 'Taglia', en: 'Size' },
    { it: 'Lunghezza del tratto vocale: 1 = adulto uomo (17,5 cm), 0,87 donna, 0,72 bambino. Più lungo, formanti più basse: voce più scura e grande.', en: 'Length of the vocal tract: 1 = adult man (17.5 cm), 0.87 woman, 0.72 child. Longer, lower formants: a darker, bigger voice.' }, 0.62, 1.18, 0.01),
  n('body.anatomy.pharynx', 'body', G.size, { it: 'Faringe: lunghezza', en: 'Pharynx: length' },
    { it: 'La gola rispetto alla bocca. Gli uomini hanno una faringe relativamente più lunga (Fitch & Giedd 1999).', en: 'The throat against the mouth. Men have a relatively longer pharynx (Fitch & Giedd 1999).' }, 0.72, 1.25, 0.01),
  n('body.anatomy.pharynxWidth', 'body', G.size, { it: 'Faringe: larghezza', en: 'Pharynx: width' },
    { it: 'Ampia: suono cupo, cavo; stretta: chiaro, sottile.', en: 'Wide: a dark, hollow sound; narrow: bright and thin.' }, 0.55, 1.6, 0.01),
  n('body.anatomy.piriform', 'body', G.size, { it: 'Seni piriformi', en: 'Piriform fossae' },
    { it: 'Le due tasche d’aria ai lati della laringe: scavano una valle nello spettro intorno a 4-5 kHz (Dang & Honda 1997). 1 = vuote, come sempre.', en: 'The two air pockets beside the larynx: they cut a valley in the spectrum around 4-5 kHz (Dang & Honda 1997). 1 = empty, as always.' }, 0, 1, 0.01),
  n('body.anatomy.palateHeight', 'body', G.palate, { it: 'Volta del palato', en: 'Vault of the palate' },
    { it: 'Quanto sale la volta del palato tra la cresta dietro i denti e il velo: 1 = quella del disegno (circa 1 cm al colmo). Alta: le vocali anteriori un po’ più aperte e scure; bassa: più chiuse e chiare. Le consonanti vengono rifatte per questa bocca: la lingua va dove serve per avere la stessa stretta nello stesso punto.', en: 'How high the vault of the palate rises between the ridge behind the teeth and the velum: 1 = the drawing’s (about 1 cm at its top). High: the front vowels a little more open and darker; low: closer and brighter. The consonants are made again for this mouth: the tongue goes where it needs to for the same constriction in the same place.' }, 0.6, 1.45, 0.01),
  n('body.anatomy.archWidth', 'body', G.palate, { it: 'Larghezza dell’arcata', en: 'Width of the arch' },
    { it: 'Quanto è larga la bocca tra i denti di un lato e dell’altro: 1 = quella del disegno. Larga: cavità più ampia, formanti della bocca più basse; stretta: più alte. Le consonanti tengono la loro stretta.', en: 'How wide the mouth is from the teeth of one side to the other: 1 = the drawing’s. Wide: a roomier cavity, lower formants of the mouth; narrow: higher. The consonants keep their constriction.' }, 0.8, 1.25, 0.01),
  n('body.anatomy.nasalLeak', 'body', G.nose, { it: 'Velo che non chiude', en: 'Velum that does not close' },
    { it: 'Un passaggio sempre aperto verso il naso, anche sulle occlusive (insufficienza velofaringea): voce nasale e consonanti che perdono aria. Per un’abitudine nasale usa le Abitudini.', en: 'A passage to the nose always open, even on stops (velopharyngeal insufficiency): a nasal voice and consonants that leak air. For a nasal habit use the Habits.' }, 0, 1, 0.01),
  n('body.anatomy.nostrilLeft', 'body', G.nose, { it: 'Narice sinistra aperta', en: 'Left nostril open' },
    { it: '0 = chiusa (raffreddore, naso tappato): voce «denasale», le nasali si spengono.', en: '0 = shut (a cold, a pinched nose): a "denasal" voice, the nasals go dull.' }, 0, 1, 0.01),
  n('body.anatomy.nostrilRight', 'body', G.nose, { it: 'Narice destra aperta', en: 'Right nostril open' },
    { it: '0 = chiusa.', en: '0 = shut.' }, 0, 1, 0.01),
  n('body.anatomy.nasalCycle', 'body', G.nose, { it: 'Ciclo nasale', en: 'Nasal cycle' },
    { it: 'Quale lato del naso è congestionato: −1 sinistro, +1 destro. Cambia di poco il timbro delle nasali.', en: 'Which side of the nose is congested: −1 left, +1 right. It changes the colour of the nasals a little.' }, -1, 1, 0.01),
  n('body.teeth.slitWidth', 'body', G.teeth, { it: 'Larghezza fessura', en: 'Slit width' },
    { it: 'Quanto è larga la fessura tra gli incisivi: decide il fischio della /s/.', en: 'How wide the slit between the incisors is: it decides the whistle of /s/.' }, 0.5, 4, 0.05, 'cm'),
  n('body.teeth.slitOpen', 'body', G.teeth, { it: 'Apertura extra', en: 'Extra opening' },
    { it: 'Denti che non si chiudono del tutto (morso aperto).', en: 'Teeth that do not quite close (open bite).' }, -0.15, 0.8, 0.01, 'cm'),
  n('body.teeth.diastema', 'body', G.teeth, { it: 'Spazio tra gli incisivi', en: 'Gap between the incisors' },
    { it: 'Un diastema: la /s/ fischia meno e soffia di più.', en: 'A diastema: the /s/ whistles less and blows more.' }, 0, 0.4, 0.01, 'cm'),
  n('body.teeth.overjet', 'body', G.teeth, { it: 'Incisivi superiori in avanti', en: 'Upper incisors forward' },
    { it: 'Overjet: gli incisivi di sopra sporgono su quelli di sotto.', en: 'Overjet: the upper incisors stand out over the lower ones.' }, -0.2, 0.5, 0.01, 'cm'),
  n('body.teeth.advance', 'body', G.teeth, { it: 'Denti avanti/indietro', en: 'Teeth forward/back' },
    { it: 'Tutta l’arcata più vicina alle labbra o più indietro.', en: 'The whole arch closer to the lips or further back.' }, -0.3, 0.4, 0.01, 'cm'),
  n('body.teeth.upperLength', 'body', G.teeth, { it: 'Incisivi superiori lunghi', en: 'Upper incisor length' },
    { it: 'Bordo degli incisivi superiori più in basso (+) o più in alto (−).', en: 'Edge of the upper incisors lower (+) or higher (−).' }, -0.3, 0.4, 0.01, 'cm'),
  n('body.teeth.lowerLength', 'body', G.teeth, { it: 'Incisivi inferiori lunghi', en: 'Lower incisor length' },
    { it: 'Bordo degli incisivi inferiori più in alto (+) o più in basso (−).', en: 'Edge of the lower incisors higher (+) or lower (−).' }, -0.3, 0.4, 0.01, 'cm'),
  // -------------------------------------------------------- phonation
  {
    path: 'phonation.model', tab: 'phonation', group: G.folds, kind: 'enum', label: { it: 'Modello delle corde', en: 'Fold model' },
    hint: { it: 'LF disegna l’impulso glottico (preciso, regolabile); due masse lascia vibrare le corde da sole (asimmetrie, voce rauca).', en: 'LF draws the glottal pulse (precise, adjustable); two-mass lets the folds vibrate by themselves (asymmetries, a raspy voice).' },
    options: [{ value: 'lf', label: { it: 'LF', en: 'LF' } }, { value: 'twomass', label: { it: 'Due masse', en: 'Two-mass' } }],
  },
  { path: 'phonation.voicing', tab: 'phonation', group: G.folds, kind: 'boolean', label: { it: 'Le corde vibrano', en: 'The folds vibrate' },
    hint: { it: 'Spento: un sussurro, solo fruscio (apri anche la glottide nelle Abitudini).', en: 'Off: a whisper, only hiss (open the glottis in the Habits too).' } },
  n('phonation.rd', 'phonation', G.folds, { it: 'Qualità (Rd)', en: 'Quality (Rd)' },
    { it: 'La forma dell’impulso (Fant 1995): 0,3-0,7 pressata, 1 modale, 1,4-2,7 soffiata.', en: 'The shape of the pulse (Fant 1995): 0.3-0.7 pressed, 1 modal, 1.4-2.7 breathy.' }, 0.3, 2.7, 0.01),
  n('phonation.peakArea', 'phonation', G.folds, { it: 'Apertura massima', en: 'Peak opening' },
    { it: 'Quanto si aprono le corde a ogni ciclo: più aria, voce più forte e piena.', en: 'How far the folds open in each cycle: more air, a louder, fuller voice.' }, 0.02, 0.3, 0.005, 'cm²'),
  n('phonation.chink', 'phonation', G.breath, { it: 'Fessura posteriore', en: 'Posterior chink' },
    { it: 'Le corde non chiudono del tutto dietro: fruscio tra le armoniche, tipico di molte voci femminili (Södersten & Lindestad 1990).', en: 'The folds do not close fully at the back: hiss between the harmonics, common in women’s voices (Södersten & Lindestad 1990).' }, 0, 0.2, 0.002, 'cm²'),
  n('phonation.aspiration', 'phonation', G.breath, { it: 'Fruscio della glottide', en: 'Glottal hiss' },
    { it: 'Il livello del soffio d’aria tra le corde.', en: 'The level of the air hissing between the folds.' }, -30, 20, 0.5, 'dB'),
  n('phonation.interaction', 'phonation', G.folds, { it: 'Interazione con il tratto', en: 'Interaction with the tract' },
    { it: 'Quanto la gola e la bocca reagiscono sulla glottide aperta: smorza e arrotonda le formanti.', en: 'How much the throat and mouth act back on the open glottis: it damps and rounds the formants.' }, 0, 1, 0.01),
  n('phonation.jitter', 'phonation', G.irregular, { it: 'Jitter', en: 'Jitter' },
    { it: 'Irregolarità del periodo da un ciclo all’altro: oltre l’1 % la voce suona ruvida o anziana.', en: 'Cycle-to-cycle irregularity of the period: above 1 % the voice sounds rough or old.' }, 0, 8, 0.1, '%'),
  n('phonation.shimmer', 'phonation', G.irregular, { it: 'Shimmer', en: 'Shimmer' },
    { it: 'Irregolarità dell’ampiezza da un ciclo all’altro.', en: 'Cycle-to-cycle irregularity of the amplitude.' }, 0, 20, 0.1, '%'),
  n('phonation.diplophonia', 'phonation', G.irregular, { it: 'Diplofonia', en: 'Diplophonia' },
    { it: 'Un ciclo sì e uno no più debole: voce doppia, cricchiata.', en: 'Every other cycle weaker: a double, creaky voice.' }, 0, 1, 0.01),
  n('phonation.asym', 'phonation', G.irregular, { it: 'Asimmetria delle corde', en: 'Fold asymmetry' },
    { it: 'Solo con due masse: corde diverse a sinistra e a destra, subarmoniche e raucedine.', en: 'Two-mass only: left and right folds unlike, subharmonics and hoarseness.' }, 0, 0.8, 0.01),
  n('phonation.restArea', 'phonation', G.folds, { it: 'Apertura a riposo', en: 'Rest opening' },
    { it: 'Solo con due masse: quanto sono aperte le corde prima di vibrare.', en: 'Two-mass only: how open the folds are before they vibrate.' }, 0, 0.12, 0.002, 'cm²'),
  n('phonation.vibratoRate', 'phonation', G.vibrato, { it: 'Velocità del vibrato', en: 'Vibrato rate' },
    { it: 'I cantanti stanno tra 5 e 7 Hz (Sundberg 1987).', en: 'Singers are between 5 and 7 Hz (Sundberg 1987).' }, 3, 8, 0.1, 'Hz'),
  n('phonation.vibratoDepth', 'phonation', G.vibrato, { it: 'Ampiezza del vibrato', en: 'Vibrato depth' },
    { it: '0 nel parlato; 50-100 cent nel canto lirico.', en: '0 in speech; 50-100 cents in operatic singing.' }, 0, 120, 1, 'cent'),
  // ----------------------------------------------------------- habits
  n('habits.larynx', 'habits', G.throat, { it: 'Laringe', en: 'Larynx' },
    { it: 'Tenuta bassa (−): tratto più lungo, voce scura e piena; alta (+): chiara, tesa, infantile (Laver 1980).', en: 'Held low (−): a longer tract, a dark, full voice; high (+): bright, tense, childlike (Laver 1980).' }, -1.2, 1, 0.01, 'cm'),
  n('habits.tongueRoot', 'habits', G.throat, { it: 'Radice della lingua', en: 'Tongue root' },
    { it: 'Indietro (−): faringe stretta, voce «faringalizzata», strozzata; avanti (+): gola ampia.', en: 'Back (−): a narrow pharynx, a "pharyngealized", strained voice; forward (+): an open throat.' }, -0.8, 0.8, 0.01, 'cm'),
  n('habits.velum', 'habits', G.throat, { it: 'Nasalità', en: 'Nasality' },
    { it: 'Il velo non si chiude mai del tutto su vocali e sonoranti: voce nasale. Le occlusive restano orali.', en: 'The velum never quite closes on vowels and sonorants: a nasal voice. Stops stay oral.' }, 0, 0.5, 0.01),
  n('habits.abduction', 'habits', G.throat, { it: 'Glottide aperta', en: 'Open glottis' },
    { it: 'Le corde non si accostano mai del tutto: 0,1-0,2 voce soffiata, 0,4 sussurro (con le corde ferme).', en: 'The folds never quite meet: 0.1-0.2 a breathy voice, 0.4 a whisper (with the folds still).' }, 0, 0.6, 0.01),
  n('habits.jaw', 'habits', G.mouth, { it: 'Mascella', en: 'Jaw' },
    { it: 'Più aperta (+): suono aperto e sonoro; più chiusa (−): parlare a denti stretti.', en: 'More open (+): an open, ringing sound; closer (−): talking through clenched teeth.' }, -0.3, 0.3, 0.01),
  n('habits.tongueX', 'habits', G.mouth, { it: 'Lingua avanti/indietro', en: 'Tongue forward/back' },
    { it: 'Avanti (+): voce chiara, «palatalizzata»; indietro (−): scura, «velarizzata».', en: 'Forward (+): a bright, "palatalized" voice; back (−): dark, "velarized".' }, -0.6, 0.6, 0.01, 'cm'),
  n('habits.tongueY', 'habits', G.mouth, { it: 'Lingua alta/bassa', en: 'Tongue high/low' },
    { it: 'Corpo della lingua tenuto più alto (+) o più basso (−).', en: 'Tongue body held higher (+) or lower (−).' }, -0.6, 0.6, 0.01, 'cm'),
  n('habits.lipRound', 'habits', G.lips, { it: 'Labbra arrotondate', en: 'Rounded lips' },
    { it: 'Arrotondate (+): suono più scuro e cupo; tirate (−): più chiaro, «sorridente».', en: 'Rounded (+): a darker, rounder sound; spread (−): brighter, "smiling".' }, -0.5, 0.6, 0.01),
  n('habits.lipProtrude', 'habits', G.lips, { it: 'Labbra in fuori', en: 'Lips pushed out' },
    { it: 'Sporgenti (+) o tirate contro i denti (−).', en: 'Pushed out (+) or drawn back against the teeth (−).' }, -0.4, 0.6, 0.01, 'cm'),
  n('habits.precision', 'habits', G.care, { it: 'Precisione', en: 'Precision' },
    { it: 'Quanto articola: −1 trascurata (vocali che scivolano verso lo schwa, movimenti lenti), +1 scandita (vocali piene, movimenti rapidi) (Lindblom 1990).', en: 'How carefully it articulates: −1 slack (vowels drifting toward schwa, slow movements), +1 crisp (full vowels, quick movements) (Lindblom 1990).' }, -1, 1, 0.05),
  // ----------------------------------------------------------- melody
  n('speaking.f0', 'melody', G.voice, { it: 'Altezza abituale', en: 'Usual pitch' },
    { it: 'L’altezza media del parlato: uomini circa 100-130 Hz, donne 190-230, bambini 250-300.', en: 'The mean pitch of speech: men about 100-130 Hz, women 190-230, children 250-300.' }, 30, 500, 1, 'Hz'),
  n('speaking.accent', 'melody', G.accent, { it: 'Forza degli accenti', en: 'Accent strength' },
    { it: 'Di quanto sale la voce sulle sillabe accentate (e l’estensione dei toni): 0 monotona, 8 molto espressiva.', en: 'How far the voice rises on stressed syllables (and the span of the tones): 0 monotone, 8 very lively.' }, 0, 8, 0.5, 'st'),
  n('speaking.style.downstep', 'melody', G.accent, { it: 'Discesa tra gli accenti', en: 'Downstep' },
    { it: 'Ogni accento della frase alto questa parte di quello prima: 1 tutti uguali.', en: 'Each accent of a phrase this share of the one before: 1 all the same.' }, 0.6, 1, 0.01),
  n('speaking.style.downstepFloor', 'melody', G.accent, { it: 'Accento più basso', en: 'Lowest accent' },
    { it: '…ma mai meno di questa parte del primo.', en: '…but never less than this share of the first.' }, 0.3, 1, 0.01),
  n('speaking.style.floor', 'melody', G.phrase, { it: 'Fondo della voce', en: 'Bottom of the voice' },
    { it: 'Quanto sotto l’altezza abituale può scendere una frase.', en: 'How far below the usual pitch a phrase may fall.' }, 0, 10, 0.5, 'st'),
  n('speaking.style.phrase', 'melody', G.phrase, { it: 'Arco della frase', en: 'Arc of the phrase' },
    { it: 'La salita all’inizio di ogni frase e la sua lenta discesa (declinazione; Fujisaki 1984).', en: 'The rise at the start of each phrase and its slow fall (declination; Fujisaki 1984).' }, 0, 2, 0.05),
  n('speaking.style.micro', 'melody', G.phrase, { it: 'Microprosodia', en: 'Microprosody' },
    { it: 'Le piccole spinte di altezza delle vocali chiuse e delle consonanti sorde: 0 le toglie.', en: 'The small pitch pushes of close vowels and voiceless consonants: 0 removes them.' }, 0, 2, 0.05),
  n('speaking.style.flutter', 'melody', G.phrase, { it: 'Ondeggiamento', en: 'Flutter' },
    { it: 'Il lento vagare dell’altezza di una voce viva (Klatt & Klatt 1990): 25 naturale.', en: 'The slow wander of the pitch of a living voice (Klatt & Klatt 1990): 25 natural.' }, 0, 100, 1),
  n('speaking.style.finalFall', 'melody', G.ends, { it: 'Discesa finale', en: 'Final fall' },
    { it: 'Quanto scende la voce alla fine di un’affermazione.', en: 'How far the voice falls at the end of a statement.' }, 0, 8, 0.1, 'st'),
  n('speaking.style.questionRise', 'melody', G.ends, { it: 'Salita della domanda', en: 'Question rise' },
    { it: 'Quanto sale alla fine di una domanda sì/no.', en: 'How far it rises at the end of a yes/no question.' }, 0, 14, 0.1, 'st'),
  n('speaking.style.continuation', 'melody', G.ends, { it: 'Salita alla virgola', en: 'Rise at a comma' },
    { it: 'Il piccolo rialzo che dice «non ho finito».', en: 'The small rise that says "I have not finished".' }, 0, 6, 0.1, 'st'),
  n('speaking.style.endCreak', 'melody', G.ends, { it: 'Chiusura cricchiata', en: 'Creaky ending' },
    { it: 'Le affermazioni finiscono in voce cricchiata (vocal fry): bassa, a impulsi lenti e irregolari.', en: 'Statements end in creak (vocal fry): low, with slow, irregular pulses.' }, 0, 1, 0.05),
  // ----------------------------------------------------------- rhythm
  n('speaking.rate', 'rhythm', G.pace, { it: 'Velocità', en: 'Rate' },
    { it: '1 = velocità normale; 1,5 molto rapida.', en: '1 = usual pace; 1.5 very fast.' }, 0.4, 1.8, 0.05, '×'),
  n('speaking.style.pauseLong', 'rhythm', G.pace, { it: 'Pausa al punto', en: 'Pause at a full stop' },
    { it: 'Quanto si ferma tra una frase e l’altra.', en: 'How long it stops between sentences.' }, 0.1, 1, 0.01, 's'),
  n('speaking.style.pauseShort', 'rhythm', G.pace, { it: 'Pausa alla virgola', en: 'Pause at a comma' },
    { it: 'Quanto si ferma a una virgola.', en: 'How long it stops at a comma.' }, 0.05, 0.6, 0.01, 's'),
  n('speaking.style.finalLengthening', 'rhythm', G.pace, { it: 'Allungamento finale', en: 'Final lengthening' },
    { it: 'Quanto si allunga l’ultima sillaba di una frase: 0 per niente, 1 come di solito.', en: 'How much the last syllable of a phrase lengthens: 0 not at all, 1 as usual.' }, 0, 2.5, 0.05),
  n('speaking.ps', 'rhythm', G.push, { it: 'Intensità', en: 'Loudness' },
    { it: 'La pressione dei polmoni: 5-6 voce bassa, 8 normale, 12-16 voce forte (Holmberg et al. 1988).', en: 'The lung pressure: 5-6 a soft voice, 8 usual, 12-16 a loud one (Holmberg et al. 1988).' }, 3, 16, 0.1, 'cmH₂O'),
  n('speaking.style.declination', 'rhythm', G.push, { it: 'Fiato che cala', en: 'Fading breath' },
    { it: 'Quanto cala la pressione dei polmoni dall’inizio alla fine della frase.', en: 'How much the lung pressure falls from the start to the end of the utterance.' }, 0, 0.4, 0.01),
  n('speaking.style.stressPs', 'rhythm', G.push, { it: 'Spinta degli accenti', en: 'Push of the accents' },
    { it: 'Pressione in più sulle sillabe accentate.', en: 'Extra pressure on stressed syllables.' }, 0, 0.4, 0.01),
  n('speaking.style.stressRd', 'rhythm', G.push, { it: 'Tensione degli accenti', en: 'Tension of the accents' },
    { it: 'Voce più tesa (meno Rd) sulle sillabe accentate.', en: 'A tenser voice (less Rd) on stressed syllables.' }, 0, 0.4, 0.01),
  n('speaking.style.endWindow', 'rhythm', G.ends, { it: 'Coda della frase', en: 'Tail of the phrase' },
    { it: 'Su quanto della fine della frase la voce si rilassa.', en: 'Over how much of the end of a phrase the voice relaxes.' }, 0.1, 0.6, 0.01, 's'),
  n('speaking.style.endPs', 'rhythm', G.ends, { it: 'Fiato che finisce', en: 'Breath running out' },
    { it: 'Quanto cala la pressione alla fine di ogni frase.', en: 'How much the pressure falls at the end of each phrase.' }, 0, 0.5, 0.01),
  n('speaking.style.endRd', 'rhythm', G.ends, { it: 'Fine soffiata', en: 'Breathy end' },
    { it: 'Quanto diventa soffiata la voce alla fine della frase.', en: 'How breathy the voice gets at the end of a phrase.' }, 0, 1.5, 0.01),
];

// ------------------------------------------------------------- reading

const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);
const set = (o: Record<string, unknown>, path: string, v: unknown): void => {
  const ks = path.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) x = x[k] as Record<string, unknown>;
  x[ks[ks.length - 1]] = v;
};

/** the value of a field in a voice */
export const fieldValue = (d: VoiceDesign, f: Field): number | boolean | string => get(d, f.path) as number | boolean | string;

/** A copy of a voice with one field changed (clamped to its range). */
export function withField(d: VoiceDesign, path: string, v: number | boolean | string): VoiceDesign {
  const out = cloneVoice(d);
  const f = VOICE_FIELDS.find((x) => x.path === path);
  set(out as unknown as Record<string, unknown>, path, f ? clean(f, v, get(d, path)) : v);
  return out;
}

function clean(f: Field, v: unknown, fallback: unknown): unknown {
  if (f.kind === 'boolean') return typeof v === 'boolean' ? v : fallback;
  if (f.kind === 'enum') return f.options!.some((o) => o.value === v) ? v : fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(f.min!, Math.min(f.max!, v));
}

const text = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

/**
 * A voice from anything (a file, a link, the library): only the known
 * fields are kept, each number limited to its range, and whatever is
 * missing or wrong takes the reference voice's value. Null if it is not a
 * voice at all.
 */
export function sanitizeVoice(x: unknown): VoiceDesign | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (o.format !== VOICE_FORMAT) return null;
  const d = cloneVoice();
  for (const f of VOICE_FIELDS) set(d as unknown as Record<string, unknown>, f.path, clean(f, get(o, f.path), get(d, f.path)));
  d.version = VOICE_VERSION;
  d.name = text(o.name, 60);
  d.notes = text(o.notes, 500);
  d.id = typeof o.id === 'string' && /^[a-z0-9-]{1,40}$/.test(o.id) ? o.id : newVoiceId();
  d.language = typeof o.language === 'string' && /^[a-zA-Z-]{0,12}$/.test(o.language) ? o.language : '';
  return d;
}

// ------------------------------------------------------------- using it

/**
 * Makes the hands' parameters this voice: its body, its folds, its usual
 * pitch and loudness, its larynx and its glottis. The posture held, the
 * volume, the filter and the noise generator stay as they are.
 */
export function applyDesign(p: EngineParams, d: Readonly<VoiceDesign>): void {
  const ph = d.phonation;
  p.anatomy = { ...d.body.anatomy };
  p.teeth = { ...d.body.teeth };
  p.source = { ...DEFAULT_SOURCE, f0: d.speaking.f0, ps: d.speaking.ps };
  for (const k of PHONATION_KEYS) (p.source as unknown as Record<string, unknown>)[k] = ph[k];
  p.noise = { ...DEFAULT_NOISE, aspiration: ph.aspiration, user: p.noise.user };
  p.voicing = ph.voicing;
  p.abduction = d.habits.abduction;
  p.articulators = { ...p.articulators, larynx: d.habits.larynx };
}

/** the voice's setting, as the speech planner takes it */
export function settingOfVoice(d: Readonly<VoiceDesign>): Setting {
  const s = { ...NO_SETTING } as Setting;
  for (const k of SETTING_OFFSETS) s[k] = d.habits[k];
  s.velum = d.habits.velum;
  s.abduction = d.habits.abduction;
  return s;
}

/** How this voice says a text: the options of the speech planner. */
export function speechOptions(d: Readonly<VoiceDesign>, lang: string): ScoreOptions {
  return {
    lang, f0: d.speaking.f0, ps: d.speaking.ps, accent: d.speaking.accent, rate: d.speaking.rate,
    style: { ...d.speaking.style }, setting: settingOfVoice(d), precision: d.habits.precision,
    head: { anatomy: { ...d.body.anatomy }, teeth: { ...d.body.teeth } },
  };
}
