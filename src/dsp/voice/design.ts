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
  /** the return phase of each pulse against the one its Rd gives (1): shorter, a sharper closure, a brighter voice */
  returnPhase: number;
  peakArea: number;
  chink: number;
  /** vertical thickness of the vibrating folds: 1 chest voice, thin falsetto */
  thickness: number;
  jitter: number;
  shimmer: number;
  diplophonia: number;
  interaction: number;
  vibratoRate: number;
  vibratoDepth: number;
  asym: number;
  restArea: number;
  /** the fold areas (model 'areas'): rest gaps of the two edges (cm), lag of the upper one (degrees), skew of the
   *  pulse, alternation, length and thickness at the natural pitch (cm, Hz), scale of the swing */
  gapLow: number;
  gapHigh: number;
  edgeLag: number;
  areaSkew: number;
  alternate: number;
  vibLength: number;
  vibDepth: number;
  naturalPitch: number;
  swing: number;
  /** the folds vibrate at all (false: a whisper) */
  voicing: boolean;
  /** the hiss of the air through the glottis, dB */
  aspiration: number;
  /** the hiss of the air against the walls where the mouth is narrow, dB */
  frication: number;
  /** the hiss of the jet against the incisors (most of s, ʃ and of the release of an English t), dB */
  obstacle: number;
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
  /**
   * where its timing, pauses, melody and swell come from: 'rules' (the planner's, with the style above), or a
   * delivery learnt from a recorded speaker ('woman', 'man'), where a model for the language is loaded
   */
  delivery: string;
  /** with a learnt delivery: how wide its melody swings around the usual pitch, against the speaker's own (1) */
  range: number;
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

const PHONATION_KEYS = ['model', 'rd', 'returnPhase', 'peakArea', 'chink', 'thickness', 'jitter', 'shimmer', 'diplophonia', 'interaction', 'vibratoRate', 'vibratoDepth', 'asym', 'restArea',
  'gapLow', 'gapHigh', 'edgeLag', 'areaSkew', 'alternate', 'vibLength', 'vibDepth', 'naturalPitch', 'swing'] as const;

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
    model: DEFAULT_SOURCE.model, rd: DEFAULT_SOURCE.rd, returnPhase: 1, peakArea: DEFAULT_SOURCE.peakArea, chink: DEFAULT_SOURCE.chink, thickness: DEFAULT_SOURCE.thickness,
    jitter: DEFAULT_SOURCE.jitter, shimmer: DEFAULT_SOURCE.shimmer, diplophonia: DEFAULT_SOURCE.diplophonia,
    interaction: DEFAULT_SOURCE.interaction, vibratoRate: DEFAULT_SOURCE.vibratoRate, vibratoDepth: DEFAULT_SOURCE.vibratoDepth,
    asym: DEFAULT_SOURCE.asym, restArea: DEFAULT_SOURCE.restArea,
    gapLow: DEFAULT_SOURCE.gapLow, gapHigh: DEFAULT_SOURCE.gapHigh, edgeLag: DEFAULT_SOURCE.edgeLag, areaSkew: DEFAULT_SOURCE.areaSkew,
    alternate: DEFAULT_SOURCE.alternate, vibLength: DEFAULT_SOURCE.vibLength, vibDepth: DEFAULT_SOURCE.vibDepth,
    naturalPitch: DEFAULT_SOURCE.naturalPitch, swing: DEFAULT_SOURCE.swing, voicing: true, aspiration: DEFAULT_NOISE.aspiration,
    frication: DEFAULT_NOISE.frication, obstacle: DEFAULT_NOISE.obstacle,
  },
  habits: { ...NO_SETTING, precision: 0 },
  speaking: { f0: DEFAULT_SOURCE.f0, ps: DEFAULT_SOURCE.ps, accent: 5, rate: 1, style: { ...DEFAULT_STYLE }, delivery: 'rules', range: 1 },
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
  tongue: { it: 'Lingua', en: 'Tongue' },
  nose: { it: 'Naso', en: 'Nose' },
  teeth: { it: 'Denti', en: 'Teeth' },
  folds: { it: 'Corde vocali', en: 'Vocal folds' },
  areas: { it: 'Corde a aree', en: 'Fold areas' },
  walls: { it: 'Pareti', en: 'Walls' },
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
  voiceless: { it: 'Voce e soffi sordi', en: 'Voice and voiceless hisses' },
  pauses: { it: 'Voce e pause', en: 'Voice and pauses' },
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
  n('body.anatomy.wallLoss', 'body', G.walls, { it: 'Pareti che assorbono', en: 'Absorbing walls' },
    { it: 'Quanto le pareti morbide della gola e della bocca assorbono il suono: 1 = quanto di solito. Meno, risonanze più strette che suonano più a lungo: una voce più squillante e chiara; più, risonanze larghe e smorzate: più ovattata.', en: 'How much the soft walls of the throat and mouth absorb the sound: 1 = the usual. Less, narrower resonances that ring longer: a more ringing, clearer voice; more, broad damped resonances: more muffled.' }, 0.2, 2, 0.01),
  n('body.anatomy.palateHeight', 'body', G.palate, { it: 'Volta del palato', en: 'Vault of the palate' },
    { it: 'Quanto sale la volta del palato tra la cresta dietro i denti e il velo: 1 = quella del disegno (circa 1 cm al colmo). Alta: le vocali anteriori un po’ più aperte e scure; bassa: più chiuse e chiare. Le consonanti vengono rifatte per questa bocca: la lingua va dove serve per avere la stessa stretta nello stesso punto.', en: 'How high the vault of the palate rises between the ridge behind the teeth and the velum: 1 = the drawing’s (about 1 cm at its top). High: the front vowels a little more open and darker; low: closer and brighter. The consonants are made again for this mouth: the tongue goes where it needs to for the same constriction in the same place.' }, 0.6, 1.45, 0.01),
  n('body.anatomy.archWidth', 'body', G.palate, { it: 'Larghezza dell’arcata', en: 'Width of the arch' },
    { it: 'Quanto è larga la bocca tra i denti di un lato e dell’altro: 1 = quella del disegno. Larga: cavità più ampia, formanti della bocca più basse; stretta: più alte. Le consonanti tengono la loro stretta.', en: 'How wide the mouth is from the teeth of one side to the other: 1 = the drawing’s. Wide: a roomier cavity, lower formants of the mouth; narrow: higher. The consonants keep their constriction.' }, 0.8, 1.25, 0.01),
  n('body.anatomy.tongueSize', 'body', G.tongue, { it: 'Grandezza della lingua', en: 'Size of the tongue' },
    { it: 'Il corpo della lingua rispetto alla bocca: 1 = quello del disegno. Più grande riempie la bocca e la gola: le vocali posteriori più scure; più piccolo le schiarisce. I suoni vengono rifatti per questa lingua.', en: 'The body of the tongue against the mouth: 1 = the drawing’s. Bigger, it fills the mouth and the throat: the back vowels darker; smaller, brighter. The sounds are made again for this tongue.' }, 0.92, 1.08, 0.01),
  n('body.anatomy.tipReach', 'body', G.tongue, { it: 'Frenulo della lingua', en: 'Frenulum of the tongue' },
    { it: 'Quanto il frenulo lascia salire la punta dal pavimento della bocca: 1 = mai d’intralcio. Corto (anchiloglossia): la punta non arriva alla cresta, /t d n/ chiudono alzando la mascella, la /r/ vibra a fatica, /s ʂ l/ si spostano.', en: 'How far the frenulum lets the tip rise from the floor of the mouth: 1 = never in the way. Short (tongue-tie): the tip does not reach the ridge, /t d n/ close by raising the jaw, /r/ barely trills, /s ʂ l/ shift.' }, 0.55, 1, 0.01),
  n('body.anatomy.mouthWidth', 'body', G.lips, { it: 'Larghezza della bocca', en: 'Width of the mouth' },
    { it: 'Da un angolo all’altro delle labbra: 1 = quella del disegno (4,6 cm distese). Più larga, l’apertura delle labbra più ampia e le formanti un po’ più alte.', en: 'From one corner of the lips to the other: 1 = the drawing’s (4.6 cm spread). Wider, a bigger opening of the lips and the formants a little higher.' }, 0.8, 1.2, 0.01),
  n('body.anatomy.lipThickness', 'body', G.lips, { it: 'Spessore delle labbra', en: 'Thickness of the lips' },
    { it: 'Le labbra da davanti a dietro: 1 = quelle del disegno (circa 1 cm). Più spesse allungano il tubo davanti ai denti: formanti più basse, le vocali arrotondate più scure.', en: 'The lips front to back: 1 = the drawing’s (about 1 cm). Thicker, they lengthen the tube in front of the teeth: lower formants, darker rounded vowels.' }, 0.7, 1.4, 0.01),
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
    hint: { it: 'LF disegna l’impulso glottico (preciso, regolabile); due masse lascia vibrare le corde da sole (asimmetrie, voce rauca); aree fa aprire e chiudere le corde lungo la loro lunghezza, come una cerniera, e l’aria che passa la trova la fisica contro la gola e la trachea a ogni campione (Titze 1984; Birkholz e altri 2019): la voce più umana delle tre.', en: 'LF draws the glottal pulse (precise, adjustable); two-mass lets the folds vibrate by themselves (asymmetries, a raspy voice); areas opens and shuts the folds along their length, like a zip, and the air through them is found by the physics against the throat and the windpipe at every sample (Titze 1984; Birkholz et al. 2019): the most human of the three.' },
    options: [{ value: 'lf', label: { it: 'LF', en: 'LF' } }, { value: 'twomass', label: { it: 'Due masse', en: 'Two-mass' } }, { value: 'areas', label: { it: 'Aree', en: 'Areas' } }],
  },
  { path: 'phonation.voicing', tab: 'phonation', group: G.folds, kind: 'boolean', label: { it: 'Le corde vibrano', en: 'The folds vibrate' },
    hint: { it: 'Spento: un sussurro, solo fruscio (apri anche la glottide nelle Abitudini).', en: 'Off: a whisper, only hiss (open the glottis in the Habits too).' } },
  n('body.anatomy.foldLength', 'phonation', G.folds, { it: 'Lunghezza delle corde', en: 'Length of the folds' },
    { it: 'Le corde vocali rispetto a quelle di un uomo adulto (circa 1,4 cm): una donna circa 0,7, un bambino 0,5. Più corte, la glottide si apre meno: impulsi più piccoli, meno aria, una voce più sottile; l’altezza resta quella della melodia.', en: 'The vocal folds against an adult man’s (about 1.4 cm): a woman’s about 0.7, a child’s 0.5. Shorter, the glottis opens less: smaller pulses, less air, a thinner voice; the pitch stays the melody’s.' }, 0.45, 1.15, 0.01),
  n('phonation.rd', 'phonation', G.folds, { it: 'Qualità (Rd)', en: 'Quality (Rd)' },
    { it: 'La forma dell’impulso (Fant 1995): 0,3-0,7 pressata, 1 modale, 1,4-2,7 soffiata.', en: 'The shape of the pulse (Fant 1995): 0.3-0.7 pressed, 1 modal, 1.4-2.7 breathy.' }, 0.3, 2.7, 0.01),
  n('phonation.returnPhase', 'phonation', G.folds, { it: 'Chiusura delle corde', en: 'Closure of the folds' },
    { it: 'Quanto ci mettono le corde a richiudersi alla fine di ogni impulso, rispetto a quanto dà la loro forma (Rd; la fase di ritorno, Fant 1995). Più breve, una chiusura più netta: le formanti alte più forti, una voce più chiara e piena, con la stessa apertura. Più lunga, una voce più scura e morbida.', en: 'How long the folds take to close at the end of each pulse, against what their shape gives (Rd; the return phase, Fant 1995). Shorter, a sharper closure: stronger upper formants, a clearer, fuller voice, with the same opening. Longer, a darker, softer voice.' }, 0.1, 2, 0.05),
  n('phonation.thickness', 'phonation', G.folds, { it: 'Spessore delle corde (falsetto)', en: 'Fold thickness (falsetto)' },
    { it: 'Quanta parte delle corde vibra in altezza. 1: tutte, corpo e copertura, come nella voce di petto; sottili, solo il bordo tirato dal muscolo cricotiroideo: il falsetto. Chiudono meno e più tardi: l’armonica fondamentale domina, le altre calano in fretta, resta un filo d’aria (Hollien 1974; Zhang 2016).', en: 'How much of the folds vibrates, top to bottom. 1: all of them, body and cover, as in the chest voice; thin, only the edge stretched by the cricothyroid muscle: falsetto. They close less and later: the fundamental dominates, the other harmonics fall fast, a little air is left (Hollien 1974; Zhang 2016).' }, 0.2, 1.2, 0.01),
  n('phonation.peakArea', 'phonation', G.folds, { it: 'Apertura massima', en: 'Peak opening' },
    { it: 'Quanto si aprono le corde a ogni ciclo: più aria, voce più forte e piena.', en: 'How far the folds open in each cycle: more air, a louder, fuller voice.' }, 0.02, 0.3, 0.005, 'cm²'),
  n('phonation.chink', 'phonation', G.breath, { it: 'Fessura posteriore', en: 'Posterior chink' },
    { it: 'Le corde non chiudono del tutto dietro: fruscio tra le armoniche, tipico di molte voci femminili (Södersten & Lindestad 1990).', en: 'The folds do not close fully at the back: hiss between the harmonics, common in women’s voices (Södersten & Lindestad 1990).' }, 0, 0.2, 0.002, 'cm²'),
  n('phonation.aspiration', 'phonation', G.breath, { it: 'Fruscio della glottide', en: 'Glottal hiss' },
    { it: 'Il livello del soffio d’aria tra le corde.', en: 'The level of the air hissing between the folds.' }, -30, 20, 0.5, 'dB'),
  n('phonation.frication', 'phonation', G.breath, { it: 'Fruscio alla strettoia', en: 'Hiss at the constriction' },
    { it: 'Il livello del fruscio dell’aria contro le pareti dove la bocca si stringe: f, v, x, h e il resto delle fricative.', en: 'The level of the air hissing against the walls where the mouth is narrow: f, v, x, h and the rest of the fricatives.' }, -30, 20, 0.5, 'dB'),
  n('phonation.obstacle', 'phonation', G.breath, { it: 'Fruscio sui denti', en: 'Hiss on the teeth' },
    { it: 'Il livello del getto d’aria che batte sugli incisivi: quasi tutto il suono di s e ʃ e del rilascio della t inglese. Più basso, sibilanti più morbide; più alto, più taglienti.', en: 'The level of the jet of air striking the incisors: most of the sound of s and ʃ and of the release of an English t. Lower, softer sibilants; higher, sharper ones.' }, -30, 20, 0.5, 'dB'),
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
  n('phonation.gapLow', 'phonation', G.areas, { it: 'Apertura a riposo, bordo di sotto', en: 'Rest gap, lower edge' },
    { it: 'Solo con le aree: quanto restano aperte le corde dietro, tra le cartilagini, prima di vibrare, misurato sul bordo di sotto. Più aperte: chiudono meno e più tardi, una voce più morbida e soffiata; più chiuse: chiudono a lungo, una voce più netta.', en: 'Areas only: how far the folds stay apart at the back, between the cartilages, before they vibrate, measured on the lower edge. Wider: they close less and later, a softer, breathier voice; narrower: they stay shut longer, a crisper voice.' }, 0, 0.2, 0.001, 'cm'),
  n('phonation.gapHigh', 'phonation', G.areas, { it: 'Apertura a riposo, bordo di sopra', en: 'Rest gap, upper edge' },
    { it: 'Solo con le aree: lo stesso sul bordo di sopra. Più del bordo di sotto: corde che si aprono a V verso l’alto.', en: 'Areas only: the same on the upper edge. More than the lower edge: folds open in a V toward the top.' }, 0, 0.2, 0.001, 'cm'),
  n('phonation.edgeLag', 'phonation', G.areas, { it: 'Ritardo del bordo di sopra', en: 'Lag of the upper edge' },
    { it: 'Solo con le aree: il bordo di sopra segue quello di sotto come un’onda sulla mucosa (circa 50-60 gradi di un periodo, Titze 1984). Più ritardo, una chiusura più rapida e una voce più ricca di armoniche.', en: 'Areas only: the upper edge follows the lower one like a wave on the mucosa (about 50-60 degrees of a period, Titze 1984). More lag, a faster closing and a voice richer in harmonics.' }, 0, 120, 1, '°'),
  n('phonation.areaSkew', 'phonation', G.areas, { it: 'Apertura lenta, chiusura rapida', en: 'Slow opening, fast closing' },
    { it: 'Solo con le aree: quanto del periodo le corde passano ad aprirsi rispetto a chiudersi. Più alto, si aprono piano e si richiudono di colpo, come nelle voci reali: armoniche alte più forti.', en: 'Areas only: how much of the period the folds spend opening against closing. Higher, they open slowly and snap shut, as real voices do: stronger upper harmonics.' }, -0.8, 0.8, 0.01),
  n('phonation.alternate', 'phonation', G.areas, { it: 'Impulsi alterni', en: 'Alternate pulses' },
    { it: 'Solo con le aree: un impulso sì e uno no più piccolo, una voce che tende al doppio e al cricchiato.', en: 'Areas only: every second pulse smaller, a voice tending to the double and the creaky.' }, 0, 0.5, 0.005),
  n('phonation.vibLength', 'phonation', G.areas, { it: 'Lunghezza che vibra', en: 'Vibrating length' },
    { it: 'Solo con le aree: quanto sono lunghe le corde che vibrano alla loro altezza naturale. Si allungano salendo di nota (più tese) e si accorciano scendendo; più lunghe, impulsi più ampi e più aria.', en: 'Areas only: how long the vibrating folds are at their natural pitch. They lengthen as the pitch rises (more stretched) and shorten as it falls; longer, wider pulses and more air.' }, 0.6, 2, 0.01, 'cm'),
  n('phonation.vibDepth', 'phonation', G.areas, { it: 'Spessore che vibra', en: 'Vibrating depth' },
    { it: 'Solo con le aree: lo spessore dei bordi che si toccano. Più spessi, l’aria tra loro frena di più nelle fessure strette: chiusura più morbida.', en: 'Areas only: the depth of the edges that meet. Thicker, the air between them is braked more in narrow gaps: a softer closing.' }, 0.1, 0.8, 0.005, 'cm'),
  n('phonation.naturalPitch', 'phonation', G.areas, { it: 'Altezza naturale', en: 'Natural pitch' },
    { it: 'Solo con le aree: la nota alla quale le corde hanno la lunghezza scritta sopra; sopra di lei sono più tese e lunghe, sotto più corte.', en: 'Areas only: the pitch at which the folds have the length above; above it they are more stretched and longer, below it shorter.' }, 80, 400, 1, 'Hz'),
  n('phonation.swing', 'phonation', G.areas, { it: 'Ampiezza del movimento', en: 'Size of the swing' },
    { it: 'Solo con le aree: quanto si spostano le corde a ogni ciclo per la stessa pressione (1 = 1 mm a 8 cmH₂O). Più ampio, impulsi più grandi, una voce più forte e piena.', en: 'Areas only: how far the folds move in each cycle for the same pressure (1 = 1 mm at 8 cmH₂O). Wider, bigger pulses, a louder, fuller voice.' }, 0.3, 2, 0.01),
  n('phonation.vibratoRate', 'phonation', G.vibrato, { it: 'Velocità del vibrato', en: 'Vibrato rate' },
    { it: 'I cantanti stanno tra 5 e 7 Hz (Sundberg 1987).', en: 'Singers are between 5 and 7 Hz (Sundberg 1987).' }, 3, 8, 0.1, 'Hz'),
  n('phonation.vibratoDepth', 'phonation', G.vibrato, { it: 'Ampiezza del vibrato', en: 'Vibrato depth' },
    { it: '0 nel parlato; 50-100 cent nel canto lirico.', en: '0 in speech; 50-100 cents in operatic singing.' }, 0, 120, 1, 'cent'),
  // ----------------------------------------------------------- habits
  n('habits.larynx', 'habits', G.throat, { it: 'Laringe', en: 'Larynx' },
    { it: 'Tenuta bassa (−): tratto più lungo, voce scura e piena; alta (+): chiara, tesa, infantile (Laver 1980).', en: 'Held low (−): a longer tract, a dark, full voice; high (+): bright, tense, childlike (Laver 1980).' }, -1.2, 1, 0.01, 'cm'),
  n('habits.epilarynx', 'habits', G.throat, { it: 'Twang', en: 'Twang' },
    { it: 'Il tubo corto sopra le corde tenuto stretto: risuona da solo intorno ai 3 kHz e la voce diventa squillante, metallica, «nasale» anche col naso chiuso (Sundberg 1974; Titze & Story 1997). Sotto zero un po’ più largo.', en: 'The short tube above the folds held narrow: it rings by itself around 3 kHz and the voice turns ringing, brassy, "nasal" even with the nose shut (Sundberg 1974; Titze & Story 1997). Below zero a little wider.' }, -0.3, 0.7, 0.01),
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
  {
    path: 'speaking.delivery', tab: 'melody', group: G.voice, kind: 'enum', label: { it: 'Modo di dire', en: 'Way of saying' },
    hint: { it: 'Da dove vengono i tempi, le pause, la melodia e l’intensità di ogni suono: dalle regole del simulatore (e dai cursori qui sotto), o da una piccola rete che li ha imparati da frasi registrate di una donna o di un uomo e li legge dalla frase stessa (solo italiano; le altre lingue con le regole). La rete dà la melodia attorno all’altezza abituale della voce e il ritmo diviso per la sua velocità.', en: 'Where the timing, the pauses, the melody and the loudness of every sound come from: the simulator’s rules (and the sliders below), or a small network that learnt them from recorded sentences of a woman or a man and reads them off the sentence itself (Italian only; other languages by the rules). The network gives the melody around the voice’s usual pitch and the pace divided by its rate.' },
    options: [{ value: 'rules', label: { it: 'Regole', en: 'Rules' } }, { value: 'woman', label: { it: 'Imparato (donna)', en: 'Learnt (woman)' } }, { value: 'man', label: { it: 'Imparato (uomo)', en: 'Learnt (man)' } }],
  },
  n('speaking.range', 'melody', G.voice, { it: 'Ampiezza della melodia imparata', en: 'Range of the learnt melody' },
    { it: 'Con un modo di dire imparato: quanto la melodia sale e scende attorno all’altezza abituale, rispetto a chi l’ha insegnata (1 come lui o lei, 0,5 più piatta, 1,5 più mossa). Con le regole conta la forza degli accenti.', en: 'With a learnt way of saying: how far the melody rises and falls around the usual pitch, against the speaker who taught it (1 as they did, 0.5 flatter, 1.5 livelier). With the rules the accent strength counts instead.' }, 0.2, 2.5, 0.05, '×'),
  n('speaking.f0', 'melody', G.voice, { it: 'Altezza abituale', en: 'Usual pitch' },
    { it: 'L’altezza media del parlato: uomini circa 100-130 Hz, donne 190-230, bambini 250-300.', en: 'The mean pitch of speech: men about 100-130 Hz, women 190-230, children 250-300.' }, 30, 500, 1, 'Hz'),
  n('speaking.accent', 'melody', G.accent, { it: 'Forza degli accenti', en: 'Accent strength' },
    { it: 'Di quanto sale la voce sulle sillabe accentate (e l’estensione dei toni): 0 monotona, 8 molto espressiva.', en: 'How far the voice rises on stressed syllables (and the span of the tones): 0 monotone, 8 very lively.' }, 0, 8, 0.5, 'st'),
  n('speaking.style.downstep', 'melody', G.accent, { it: 'Discesa tra gli accenti', en: 'Downstep' },
    { it: 'Ogni accento della frase alto questa parte di quello prima: 1 tutti uguali.', en: 'Each accent of a phrase this share of the one before: 1 all the same.' }, 0.6, 1, 0.01),
  n('speaking.style.downstepFloor', 'melody', G.accent, { it: 'Accento più basso', en: 'Lowest accent' },
    { it: '…ma mai meno di questa parte del primo.', en: '…but never less than this share of the first.' }, 0.3, 1, 0.01),
  n('speaking.style.peakDelay', 'melody', G.accent, { it: 'Accenti tenuti', en: 'Held accents' },
    { it: 'Dopo una sillaba accentata che non è l’ultima della frase, quanto la voce resta alta: 0 = scende subito, 1 = resta alta fino alla fine della vocale dopo (il picco in ritardo di chi legge scorrevole).', en: 'After a stressed syllable that is not the last of its phrase, how long the voice stays up: 0 = it falls at once, 1 = it stays up to the end of the next vowel (the late peak of fluent reading).' }, 0, 1, 0.05),
  n('speaking.style.floor', 'melody', G.phrase, { it: 'Fondo della voce', en: 'Bottom of the voice' },
    { it: 'Quanto sotto l’altezza abituale può scendere una frase.', en: 'How far below the usual pitch a phrase may fall.' }, 0, 10, 0.5, 'st'),
  n('speaking.style.phrase', 'melody', G.phrase, { it: 'Arco della frase', en: 'Arc of the phrase' },
    { it: 'La salita all’inizio di ogni frase e la sua lenta discesa (declinazione; Fujisaki 1984).', en: 'The rise at the start of each phrase and its slow fall (declination; Fujisaki 1984).' }, 0, 2, 0.05),
  n('speaking.style.phraseSpan', 'melody', G.phrase, { it: 'Ripresa della melodia', en: 'Melody restart' },
    { it: 'Una frase senza pause più lunga di così fa ripartire la melodia dall’alto al suo interno, prima di una parola grammaticale: 0 mai.', en: 'A phrase without a pause longer than this starts its melody again from the top inside it, before a function word: 0 never.' }, 0, 6, 0.1, 's'),
  n('speaking.style.micro', 'melody', G.phrase, { it: 'Microprosodia', en: 'Microprosody' },
    { it: 'Le piccole spinte di altezza delle vocali chiuse e delle consonanti sorde: 0 le toglie.', en: 'The small pitch pushes of close vowels and voiceless consonants: 0 removes them.' }, 0, 2, 0.05),
  n('speaking.style.flutter', 'melody', G.phrase, { it: 'Ondeggiamento', en: 'Flutter' },
    { it: 'Il lento vagare dell’altezza di una voce viva (Klatt & Klatt 1990): 25 naturale.', en: 'The slow wander of the pitch of a living voice (Klatt & Klatt 1990): 25 natural.' }, 0, 100, 1),
  n('speaking.style.variation', 'melody', G.phrase, { it: 'Variabilità', en: 'Variation' },
    { it: 'Quanto la voce cambia da una sillaba all’altra e da una volta all’altra: durate, pause, altezza degli accenti, spinta, e un lento ondeggiare del fiato e della tensione. 0 = sempre uguale, come una macchina; 1 = come di solito.', en: 'How much the voice changes from one syllable to the next and from one saying to the next: lengths, pauses, height of the accents, push, and a slow wander of the breath and the tension. 0 = the same every time, like a machine; 1 = usual.' }, 0, 2, 0.05),
  n('speaking.style.finalFall', 'melody', G.ends, { it: 'Discesa finale', en: 'Final fall' },
    { it: 'Quanto scende la voce alla fine di un’affermazione.', en: 'How far the voice falls at the end of a statement.' }, 0, 8, 0.1, 'st'),
  n('speaking.style.nuclearPeak', 'melody', G.ends, { it: 'Ultimo accento in cima', en: 'Last accent on top' },
    { it: 'L’ultimo accento di un’affermazione: 0 = la voce è alta prima della sillaba accentata e ci scende sopra, 1 = sale sulla sillaba accentata e scende dopo.', en: 'The last accent of a statement: 0 = the voice is high before the stressed syllable and falls onto it, 1 = it rises on the stressed syllable and falls after it.' }, 0, 1, 0.05),
  n('speaking.style.questionRise', 'melody', G.ends, { it: 'Salita della domanda', en: 'Question rise' },
    { it: 'Quanto sale alla fine di una domanda sì/no.', en: 'How far it rises at the end of a yes/no question.' }, 0, 14, 0.1, 'st'),
  n('speaking.style.questionRiseFall', 'melody', G.ends, { it: 'Domanda che sale e scende', en: 'Rise-fall question' },
    { it: 'Dove sale una domanda sì/no: 0 = alla fine, 1 = sull’ultima sillaba accentata, per poi scendere (come in molte parlate italiane).', en: 'Where a yes/no question rises: 0 = at its end, 1 = on its last stressed syllable, to fall after it (as in many varieties of Italian).' }, 0, 1, 0.05),
  n('speaking.style.continuation', 'melody', G.ends, { it: 'Salita alla virgola', en: 'Rise at a comma' },
    { it: 'Il piccolo rialzo che dice «non ho finito»; sotto zero la voce scende anche alla virgola.', en: 'The small rise that says "I have not finished"; below zero the voice falls at a comma too.' }, -6, 6, 0.1, 'st'),
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
    { it: 'Quanto si allunga l’ultima sillaba di una frase: 0 per niente, 1 come di solito.', en: 'How much the last syllable of a phrase lengthens: 0 not at all, 1 as usual.' }, 0, 4, 0.05),
  n('speaking.style.lastStressLengthening', 'rhythm', G.pace, { it: 'Rallentamento dall’ultimo accento', en: 'Slowing down from the last stress' },
    { it: 'La fine della frase comincia dall’accento della sua ultima parola («mare», «stelle»): quanto si allunga quella vocale accentata (0,5 = una volta e mezza), e per metà i suoni fino all’ultima vocale. 0 = si allunga solo l’ultima sillaba.', en: 'The end of a phrase starts at the stress of its last word ("mare", "stelle"): how much that stressed vowel lengthens (0.5 = half as long again), and by half as much the sounds up to the last vowel. 0 = only the last syllable lengthens.' }, 0, 1.5, 0.05),
  n('speaking.ps', 'rhythm', G.push, { it: 'Intensità', en: 'Loudness' },
    { it: 'La pressione dei polmoni: 5-6 voce bassa, 8 normale, 12-16 voce forte (Holmberg et al. 1988).', en: 'The lung pressure: 5-6 a soft voice, 8 usual, 12-16 a loud one (Holmberg et al. 1988).' }, 3, 16, 0.1, 'cmH₂O'),
  n('speaking.style.declination', 'rhythm', G.push, { it: 'Fiato che cala', en: 'Fading breath' },
    { it: 'Quanto cala la pressione dei polmoni dall’inizio alla fine di ogni frase: dopo un punto si riprende fiato.', en: 'How much the lung pressure falls from the start to the end of each sentence: after a full stop the breath is taken again.' }, 0, 0.4, 0.01),
  n('speaking.style.breath', 'rhythm', G.push, { it: 'Respiro', en: 'Breath' },
    { it: 'Quanto forte i polmoni tirano l’aria nella pausa dopo un punto: il respiro che si sente tra una frase e l’altra. 0 = pausa muta.', en: 'How hard the lungs pull the air in during the pause after a full stop: the breath heard between one sentence and the next. 0 = a silent pause.' }, 0, 5, 0.1, 'cmH₂O'),
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
  n('speaking.style.voicelessLead', 'rhythm', G.voiceless, { it: 'Voce che esce prima', en: 'Voice out early' },
    { it: 'Quanto prima di una f, s, ʃ, dopo un suono con la voce, le corde cominciano ad aprirsi: la voce si assottiglia già sulla fine della vocale. 0 = si aprono quando la consonante comincia.', en: 'How long before an f, s, ʃ, after a voiced sound, the folds start to part: the voice thins out over the end of the vowel. 0 = they part as the consonant starts.' }, 0, 0.06, 0.005, 's'),
  n('speaking.style.voicelessLag', 'rhythm', G.voiceless, { it: 'Voce che torna dopo', en: 'Voice back late' },
    { it: 'Quanto ci mettono le corde a richiudersi dopo una f, s, ʃ: il suono dopo comincia soffiato. 0 = sono chiuse quando la consonante finisce.', en: 'How long the folds take to come together again after an f, s, ʃ: the sound after it starts breathy. 0 = they are together as the consonant ends.' }, 0, 0.06, 0.005, 's'),
  n('speaking.style.pauseLead', 'rhythm', G.pauses, { it: 'Voce che si spegne nel fiato', en: 'Voice out in breath' },
    { it: 'Quanto prima di una pausa, o della fine, le corde cominciano ad aprirsi: la voce dell’ultimo suono si spegne nel fiato. 0 = si aprono quando il suono finisce.', en: 'How long before a pause, or the end, the folds start to part: the voice of the last sound goes out in breath. 0 = they part as the sound ends.' }, 0, 0.12, 0.005, 's'),
  n('speaking.style.pauseLag', 'rhythm', G.pauses, { it: 'Voce che entra soffiata', en: 'Voice in with breath' },
    { it: 'Quanto ci mettono le corde a chiudersi dopo una pausa, o all’inizio: il primo suono entra soffiato. 0 = sono chiuse prima che cominci.', en: 'How long the folds take to come together after a pause, or at the start: the first sound comes in breathy. 0 = they are together before it starts.' }, 0, 0.12, 0.005, 's'),
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
  p.noise = { ...DEFAULT_NOISE, aspiration: ph.aspiration, frication: ph.frication, obstacle: ph.obstacle, user: p.noise.user };
  p.voicing = ph.voicing;
  p.abduction = d.habits.abduction;
  p.articulators = { ...p.articulators, larynx: d.habits.larynx, epilarynx: d.habits.epilarynx };
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
