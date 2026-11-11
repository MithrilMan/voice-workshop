# Voice Workshop (Officina della voce)

An interactive, physically based simulator of human voice production: a buzz
(the vocal folds), a hiss (turbulent air) and a filter (the vocal tract). It
follows the concepts of the video "The Buzz and the Filter" and lets you hear
and see each of them, from the single glottal pulse to sequenced speech.

**Try it in the browser: https://mithrilman.github.io/voice-workshop/**

[![The Buzz and the Filter: how a voice is made (video, 7 min)](public/video/the-buzz-and-the-filter.jpg)](public/video/the-buzz-and-the-filter.mp4)

**The Buzz and the Filter: how a voice is made** (7 minutes, English with
captions) takes a voice apart: the vocal folds, the throat and the mouth,
formants, noise, and the spectrogram. It is narrated by the small speech model
of the paper [Teacher in the Loop](https://github.com/MithrilMan/teacher-in-the-loop)
(doi:[10.5281/zenodo.23400040](https://doi.org/10.5281/zenodo.23400040)). In
the app it opens from the first step of Learn.

Everything is computed live in the browser: a mid-sagittal articulatory model
of the head gives an area function, a lossy Kelly-Lochbaum waveguide with
nasal cavity, sinuses, yielding walls and lip radiation filters a glottal
source (Liljencrants-Fant or a self-oscillating two-mass model), and
turbulence noise appears wherever the Reynolds number of the airflow says it
should, with a separate obstacle source where the jet hits the incisors.

The interface is in English by default, with an Italian toggle (EN / IT). The
last choice is remembered in the browser, and `?lang=it` or `?lang=en` in the
address opens the page in that language.

## Run

Requirements: Node.js 20.19+ or 22.12+ (Vite 8), a recent Chrome, Edge,
Firefox or Safari (AudioWorklet).

```bash
npm install
npm run dev        # http://localhost:5186
npm test           # 223 automated tests (physics, speech, analysis, the voice controller, interface text)
npm run validate   # runs the tests and prints every validation number as a table
npm run build      # type check + production build in dist/ (static files, relative paths)
npm run preview    # serves dist/
```

Or, without Node on the machine, in a container (Docker Compose):

```bash
docker compose up                      # http://localhost:5186
docker compose run --rm dev npm test
```

Every push to `main` runs the tests, builds the site and publishes it on
GitHub Pages (`.github/workflows/pages.yml`).

Press **▶ Sound / Suono** in the header (browsers only allow audio after a user
gesture): it gives the head a breath of voice, and you hear its shape. Press
it again to stop everything. Any phoneme, voice, sentence or experiment also
starts the audio by itself. The voice of your hands lasts a breath: it rests
2.5 s after the last change (a phoneme picked, a handle or a slider moved),
and keeps sounding while you drag the head, so nothing drones on; the Lab's
**∞ Hold** keeps it sounding. The volume starts at -8 dB (a held vowel near
-30 dBFS), and a limiter on the output catches the bursts of a sentence or a
volume pushed up.

## What you can do

Four modes, switchable in the header and remembered in the browser:

- **Learn**, for someone who starts from nothing (a welcome and 11 chapters,
  the first ones following the video), one step at a time. The head and the
  one view the step needs fill the screen; under them sits the step: one
  idea in a sentence or two, the sounds to try (one to three buttons, the
  next one lit), what to look and listen for, and on demand the explanation
  ("Why?") and the live numbers behind it. Opening a step is silent: the
  head takes the step's starting shape and nothing sounds until you ask.
  Back and Next (or the arrow keys) turn the steps, the dots jump to one,
  and the chapter's name opens the list of chapters. The chapters: a buzz and a filter; waves, harmonics and spectrum; the source
  (pulses, pitch, melody with the buzz alone); the filter (formants, vowels,
  the F1-F2 map, what belongs to the person); two independent knobs (source
  and filter); the hiss (s, f, breathy voice, pulsed aspiration); consonants
  (closures, the pressure behind them, voice onset time); the nose (velum,
  antiresonances, the two passages); vocal tracts measured by MRI and the
  tract in 3D (the side channels of an "l", the piriform fossae); the
  spectrogram (slices, window trade-off, log-mel); from sounds to sentences
  (coarticulation, timing, melody, each one switched off); a machine voice.
  Steps that need a tool (A/B, melody, machine voice) open it on the
  stage, beside the view. Where a step is about a hand, a hint on the head
  points at the handle to drag (the tongue, the jaw, the lips, the velum)
  until you drag it. A test keeps the steps short (at most 220 characters of
  text, three sounds, seven steps a chapter) and checks that every step
  opens in silence, that every sound of it is heard as it is shown, and that
  it rests a breath later.
- **Play**, for someone who wants to try things without the theory, one
  activity at a time. Four big tabs (Speak, Sounds, Voices, Vowels) each
  show the head with its handles beside the one view that suits them (the
  spectrogram for a sentence, the spectrum for a sound or a voice, the
  vowel map for the vowels) and, under them, only that activity's controls:
  a text to say, the phoneme buttons, the four speakers, the vowels. On a
  phone the controls sit right under the head.
- **Lab**, for someone who knows the subject, one bench at a time. A block of
  the signal chain, Source → Tract → Noise → Output, chooses the bench: the
  views that part of the chain is seen in (the vocal folds and the spectrum
  for the source, the tube and the vowel map for the tract, the spectrum
  and the spectrogram for the noise, the scope and the spectrogram for the
  output) and its controls in the inspector, where one section is open at
  a time. The experiments (Speak, Melody, A/B, Machine voice) open from a
  menu at the end of the chain, in place of the inspector, with a button
  back to the block you came from. One or two views; each has its own view
  picker and an enlarge button (Esc closes it), and a view changed is
  remembered for that bench in the browser.
- **Voices**, a studio to make a voice of your own, keep it and share it.
  On one side the library: your voices, kept in the browser, a new voice,
  import (a `.voice.json` file, chosen or dropped on the page) and fifteen
  starting voices (man, woman, child, deep, whisper, vocal fry, breathy,
  pressed, raspy, dark, bright, nasal, warm, hollow, and "Sky-like": a
  woman's voice fitted by measurement to the sentences of a neural
  text-to-speech voice, in its usual pitch and range, the formants of its
  vowels, the balance of its spectrum and its pace; a voice of the same
  kind, not a copy, whose third formant stays 5 % higher). On the other the voice
  being edited: its name and notes; save, duplicate, export as a file and
  a link that opens it; a test sentence in any of the languages, with
  patterns for a statement, a yes/no question, a question with "where" and
  a list; "As it was" says it again with the voice before the changes, and
  "Replay after each change" says it by itself when a slider is let go.
  Ctrl+Enter listens from anywhere. This bar stays in place: on a desk the
  studio fills the window and only the fields scroll, beside the head and a
  view; on a narrow window the page scrolls and the sentence with Listen
  stays on top. Five tabs hold every field of the voice, one line each: its
  name (a click unfolds what it does, or "Explanations" unfolds them all),
  its slider, its number to read or type, with its unit. A field that
  differs from the voice as it was opened or saved shows a dot, a tick on
  the slider where it was and a way back to it; each tab counts its changed
  fields, and Undo takes them all back. The tabs: the body (size, pharynx, palate and arch, tongue, lips, nose, teeth), the voice (the fold
  model, its quality, irregularity, breath and vibrato; with the breath the
  levels of the hiss at a constriction and of the hiss on the teeth, the
  most of s and ʃ, as in the Noise panel of the Lab), the habits (the
  posture kept beneath every sound, a twang among it, and the precision), the melody (usual
  pitch, accents, downstep, the ends of statements and questions, how much
  it varies from one saying to the next, with the
  pitch the voice will give the sentence drawn above them) and the rhythm
  and breath (rate, pauses, lengthening, loudness and its fall). The voice
  being edited is the voice that sounds, held on a vowel or saying the
  sentence; the head and a view sit beside the editor. The Speak activity
  of Play and the Lab's Speak panel say their text with the active voice
  and lead to the studio.
  **From a recording** (in the library column): an audio file, or the
  microphone, with what it says if you have it. The recording is measured
  (its pitch and how far it moves below and above its median, the first
  two harmonics and the cepstral peak, its formants, the balance of its
  voice in five bands, the hiss of its unvoiced sounds against its voiced
  ones, its pace and its pauses), then a voice of the simulator says the
  same text in the language of the recording, or a passage of its own
  when the text is not given (in Italian and English; in other languages
  the text is needed, since a passage in another language would bring
  other vowels and another rhythm), and is
  measured the same way, again and again, while its fields are moved a
  few at a time toward the recording: the usual pitch, then the melody,
  the size of the head, the palate and the tongue for the formants, the
  folds, the two hisses of the mouth, the pace, and a last pass over the
  body and the folds (analysis by synthesis). It runs in a worker, a
  minute or a few, and can be stopped keeping the best voice found; the
  voice opens in the editor beside a table of the measures, not saved.
  What comes out is a voice of the same kind, not a copy: what a recording
  has beyond these measures and beyond the fields of a voice is not carried
  over. The same fit runs from the command line on a list of WAV files and
  their texts (`scripts/fit-voice.ts`).

Who drives the voice is always shown under the header. Your hands (the
handles, the sliders, the phoneme buttons) drive it unless something else
does: a sentence moves the tongue, lips, jaw, velum, pitch, lungs and glottis;
a melody the pitch, lungs and glottis (the head stays yours, so you can change
the vowel while it sings); a clip everything but the volume. The filter can
also leave the head: a measured or drawn tube replaces the tongue, jaw, lips,
teeth and body, and "no filter" lets you hear the raw source. Whatever is
driven is locked where you see it: sliders are greyed with a padlock, the
live value and the reason; the head's handles turn hollow and say who moves
them. **Stop** gives the voice back to your hands, **Take over** keeps the
posture and pitch sounding at that instant, **Back to the head** leaves the
tube. When a sentence, melody or clip ends, the head glides back to the
posture you had and the lungs stop, so nothing starts again by itself.

Views:

| View | What it shows |
|---|---|
| Head | Mid-sagittal head, drawn as an anatomical illustration, with draggable handles for tongue body, tongue tip, jaw, lips, velum, larynx and incisors. Everything that bounds the air is drawn from the acoustic geometry of the moment, so what you see is what sounds. The airway is coloured by the live acoustic field (pressure, particle velocity or airflow), with glottal pulses, nasal airflow, turbulence particles at the jet and the teeth, and sparks on releases. |
| Vowel map | F1-F2 chart (log axes) with Peterson & Barney (men, women, children), Hillenbrand et al. and the narrator's vowels of the video; the model's vowels are clickable, dragging blends articulations; the live trail and the microphone's formants are drawn on it. |
| Spectrum | Measured output spectrum, predicted harmonics (source harmonics x filter), filter envelope, formant labels, optional microphone overlay. |
| Waveform | Output pressure, glottal flow and noise. |
| Vocal folds | Top view of the glottis in slow motion, the LF cycle with tp / te / ta, the two-mass schematic. |
| Tube | The tract as a tube of sections with the field and the standing waves of F1-F3; in tube mode you draw the area function directly (16 points) and set its length, or listen to one of the 11 vowel shapes measured by MRI (Tract & person tab). |
| 3D tract | The airway in three dimensions, built from the same cross-sections the sound is computed with and coloured by the live field, inside the tongue, palate, teeth, velum, pharynx and lips; the lateral channels and the supralingual cavity of an /l/, the piriform fossae with their water. Drag to turn, scroll to zoom; side, front, top and ¾ views, a mid-sagittal cutaway, tissues and labels on or off; Numbers gives the narrowest passage, the channels and the cavity. Loaded on demand (three.js, WebGL). |
| Spectrogram | Scrolling, 0-8 kHz linear or 80-band log-mel; analysis window from 3 to 80 ms with a plain explanation of the time-frequency trade-off. |

Inspector (Lab) and tools (Learn):

| Block | Controls |
|---|---|
| Source | Lungs, voicing, F0, lung pressure, glottal opening, vibrato; voice presets (man, woman, child, deep, whisper, vocal fry, breathy, pressed, raspy); LF (Rd or Oq / alpha_m / Ra) or two-mass (tension, asymmetry, rest area); peak area, source-tract interaction, posterior chink, fold thickness (chest to falsetto); jitter, shimmer, diplophonia. |
| Tract: tract & person | Filter (head, tube or none), articulators as sliders, phoneme buttons (IPA), the vowels measured by MRI (Story 2008) loaded as the tube, anatomy (size, pharynx length and width, vault of the palate, width of the arch, nasal leak, nasal cycle, each nostril, pinch the nose, air in the piriform fossae), timbre presets, losses. |
| Tract: teeth & slit | Front view and side view of the incisors with the jet; slit width, extra opening, diastema, overjet, advance, upper / lower incisor length, tongue groove; presets (open bite, gap teeth, overjet, short teeth); s / ʃ / f / θ / z shortcuts; live jet readouts (velocity, Reynolds number, share of the jet hitting the teeth). |
| Noise | The physical sources (aspiration, constriction jet, teeth obstacle, release bursts) with trims and pulsing; your own noise: colour (white, pink, brown, blue, violet), a drawable 32-point spectrum, band limits, level, pulsing by the glottal flow, injection point (glottis, constriction, teeth, lips or anywhere along the tract) or straight to the ears (bypassing the tract). |
| Speak | Italian or English text (numbers are read out), or text in one of 68 other languages, transcribed by an open pronunciation dictionary and, for the words it lacks, by a neural model, both downloaded at first use (what came from where is listed under the text); /IPA/ between slashes, said with the rules of English or Italian; or [IPA] between brackets, any language said as written (every symbol of the chart with its diacritics, length, stress and tones; what the model only approximates is listed under the text); rate, accent strength; examples in several languages and in IPA; a phone timeline that follows the playback; "what makes it sound natural": timing, intonation, micro-variation, voice quality and coarticulation, each switchable, with a plain explanation and a one-click robot voice. |
| Melody | Draw a pitch contour (erase = unvoiced) and play it with the buzz alone or through the current vowel; contour presets (sample sentence, question, flat); a two-octave keyboard (mouse or computer keys) with vibrato. |
| A/B experiment | Nine ready-made experiments (same filter other pitch, same pitch other filter, same vowel another body, dark vs bright, velum closed vs open, one nostril pinched, steady vs pulsed hiss, voice vs whisper, LF vs two-mass) plus your own A/B captures. Each side plays through the live engine, so the head and the views show A or B as you hear it, and the long-term spectra are taken from the samples you heard. |
| Machine voice | Only the excitation of the speech model of the paper Teacher in the Loop, as the paper describes it: nine sines at 1..9 x F0, locked to the pitch, switched off where the melody is zero and replaced by soft noise, mixed by learned weights (here by hand). |

| Output | Volume, sample rate and level; harmonics, filter envelope, log-mel, analysis window; numbers everywhere; freeze the views; the microphone (opt-in, analysed locally, never played back). |

The header holds the four modes, the Sound button (and in the Lab, Hold),
the volume and EN / IT; reset sits at the end of the Lab's chain. On a
desktop the page fits the window, with no page scroll: the header and the
bar at the bottom (Learn's step, Play's controls) stay in view, the stage
takes the height that is left, and whatever is long (a step with its "Why?",
the Lab's inspector) scrolls inside its own panel. On a phone, or a window
less than 640 px tall, the page scrolls as usual.

## Architecture

```
src/
  dsp/                    pure TypeScript, no DOM: runs in the worklet, in tests and in Node
    constants.ts          CGS constants (c, rho, mu, wall parameters)
    glottis/lf.ts         LF model with the Rd parameterisation
    glottis/twoMass.ts    Steinecke-Herzel asymmetric two-mass model
    tract/geometry.ts     mid-sagittal articulatory model, teeth and slit
    tract/section3d.ts    3D cross-sections: lens shapes, perimeter, soft wall, groove, lateral channels, piriform fossae
    tract/areaFunction.ts grid -> area function (44 sections)
    tract/nasal.ts        nasal tract: nasopharynx, left and right passages and nostrils, sinuses
    tract/waveguide.ts    real-time Kelly-Lochbaum waveguide
    tract/subglottal.ts   trachea and bronchi: their tube, and its resonances as the glottis meets them
    tract/acoustics.ts    frequency-domain reference (lossy ABCD chain)
    aero/aero.ts          slow aerodynamics, jets, Reynolds number, obstacle
    noise/noise.ts        turbulence sources and user noise shaping
    engine/engine.ts      the voice engine (one sample loop, telemetry)
    speech/               phonemes, the IPA chart (ipa.ts) and its reader, sounds from rules (derive.ts), G2P (it/en), the phonemizer of the other languages, sequencer, target approximation, prosodic style
    voice/                a voice as data: its fields (design.ts), the starting voices, the file and link codec, the articulatory setting, an utterance (a voice saying something)
    analysis/             LPC formants, YIN pitch, mel filterbank
    data/vowels.ts        reference vowel formants
    data/mri.ts           vowel area functions measured by MRI (Story 2008)
  audio/programRunner.ts  what the worklet runs: live parameters, sentences, melodies, clips and samples as programs
  audio/worklet.ts        AudioWorkletProcessor wrapping the program runner
  audio/audioEngine.ts    AudioContext, worklet node, microphone (the voice sink)
  ui/voice/               the voice controller, the only door to the sound: hands, performers, filter lanes, locks
  ui/modes/               Learn, Play, Lab and the voice studio, the view frame, the quick controls
  ui/library.ts           your voices, kept in the browser, and a voice received with a link
  ui/ds/                  small design system: card, pills, icon button, value with unit
  ui/                     React 19 views, panels, store, i18n, guided tour
  ui/three/meshes.ts      pure mesh builder for the 3D view (tested in Node); three.js loads only with that view
  ui/head/                the illustrated head: the scene (pure, tested in Node) and the painter
public/anatomy/head.jpg   the painted backdrop of the illustrated head
public/video/             the video The Buzz and the Filter (H.264 720p) and its poster frame
tests/                    Vitest suites with the validation numbers
scripts/                  validate.ts, say.ts (renders sentences to WAV), tuning and debug tools
```

Every change to what you hear goes through one object, the voice controller
(`src/ui/voice/voice.ts`). It keeps the hands' parameters (read-only to the
rest of the interface, so the compiler refuses a direct write), knows who
drives each control, refuses an edit to a locked control unless the action
explicitly takes over, and talks to the audio through a small interface (the
voice sink), so the controller, the store and the guided tour are tested in
Node with a fake sink and a fake clock.

The engine runs inside an `AudioWorkletProcessor`. The controller sends the
parameters (coalesced per task) and programs: a sentence or melody score, a
clip of parameters for a few seconds, or ready samples (the machine voice).
A program carries its own parameters and the ones to return to, so the two
never arrive out of order; it ends with an `ended` message carrying its id
(stale ones are ignored), and a 5 ms fade covers the jumps between programs.
The worklet streams the output, the glottal flow and the noise back in blocks
of 1024 samples, plus telemetry (areas, field per section, F0, jet, levels)
about 60 times per second; the views draw what sounds, from that telemetry.
Canvases read a shared ring buffer in `requestAnimationFrame`. Offline renders
(tests, the machine excitation, exports) use the same engine class
synchronously.

The illustrated head keeps the rule that what you see is what sounds. A
painting of the head in section (`public/anatomy/head.jpg`) was generated
from a guide image of the canonical head at rest (`scripts/head-guide.ts`)
and is registered on it: 51.2 pixels per centimetre over a fixed frame. It
was retouched where the painting did not match the model: a dark fringe
along the profile, a translucent velum painted over the pharynx, and a pocket
of air under the tongue that the model fills with tissue. The painting
shows what the model does not move (skull, brain, vertebrae, the nose and
its sinuses, the back wall of the throat, skin and neck); everything that
moves and bounds the air is placed from the geometry of the moment
(`src/ui/head/scene.ts`, pure, tested in Node):

- the painting is cut in bands (neck, cranium, the jaw above and below the
  hinge) that follow the same transform as the geometry, the jaw's rotation
  and the pharynx stretch included, with a zone of triangles under the jaw
  that bends between them as the model's outline does;
- the tongue, the lower incisor and the faces of the lips carry their own
  painting stretched onto their shape of the moment, triangle by triangle
  from the same shape at rest; the palate and the upper teeth are rigid;
- the velum, the air above it, the mucosa behind the lips and wherever the
  painting's air is tissue now are drawn, not painted;
- the air itself is the acoustic channel, drawn last with the sound field,
  so nothing can hide it. A test (`tests/head-overlay.test.ts`) checks, in
  every phoneme's posture and at the ends of each articulator's range, that
  the drawn air is the acoustic channel on every grid line and that no air
  of the painting is left where the model has tissue; and, at rest, that
  the painting sits exactly where it was painted.

The painter (`src/ui/head/painter.ts`) draws the painting and the soft parts
on a layer of its own, painted again only when the posture, the size or the
view changes (about a millisecond on a GPU canvas); each frame then draws
that layer, the glow of the nose, the air and the handles. Until the painting
loads, or if it cannot, the head is drawn in flat shapes.

## The model

Units are CGS throughout (cm, g, s; pressure in dyn/cm², volume velocity in
cm³/s), c = 35 000 cm/s, rho = 1.14e-3 g/cm³.

### Source

**LF model** (Fant, Liljencrants & Lin 1985) of the glottal flow derivative in
one period T0 = 1:

- open phase, 0 <= t <= te: E(t) = E0 e^(alpha t) sin(pi t / tp)
- return phase, te < t <= 1: E(t) = -(Ee / (eps ta)) [e^(-eps (t - te)) - e^(-eps (1 - te))]

with eps ta = 1 - e^(-eps (1 - te)) and alpha such that the flow returns to
zero. The single shape parameter Rd (Fant 1995) sets Ra = (-1 + 4.8 Rd)/100,
Rk = (22.4 + 11.8 Rd)/100, Rg = Rk / (4 (0.11 Rd / (0.5 + 1.2 Rk) - Ra)),
tp = 1/(2 Rg), te = tp (1 + Rk), ta = Ra. Rd 0.3-0.7 is pressed, about 1 modal,
2-2.7 breathy. Advanced mode sets Oq, alpha_m and Ra directly. The return
phase can be scaled apart from Rd (a voice's closure of the folds, 1 =
Fant's): his regression ties it to the opening as in an average voice, and
a voice whose folds open as wide may close faster, its upper harmonics
stronger. On the middles of the vowels of five sentences, the woman and the
man had H1-A2 and H1-A3 (the first harmonic over the strongest one near F2
and F3, Hanson 1997) 0.7-6.5 and 3.6-5.2 dB higher than the recordings of
neural text-to-speech voices of their kind, with H1-H2 1.5-1.8 dB lower: a
duller voice. A return phase of 0.7 brings H1-A3 within 1.1 dB and H1-A2
within 3.6, at a cost of 0.7-1.2 dB of H1-H2; raising Rd to give that back
gives back most of the upper harmonics too. Cycle-to-cycle
jitter, shimmer and alternate-cycle diplophonia, a posterior chink (incomplete
closure) and vibrato complete the source. The thickness of the folds sets
the register (Hollien 1974): 1 is the chest voice, body and cover vibrating
together; thinner, only the edge of the cover stretched by the
cricothyroid vibrates, as in falsetto. The vertical thickness of the medial
surface sets how long and how firmly the folds close, hence the slope of
the spectrum (Zhang 2016): per unit of thinness Rd rises by 1.4, the glottis
keeps a gap of 0.04 cm² and the swing shrinks by 40 %; in the two-mass model
the lower mass thins (60 % per unit). At 300 Hz, from 1 to 0.3, H1-H2 rises
from 4.0 to 13.7 dB (two-mass 9.9 to 21.1) and the harmonics near 3 kHz fall
19 dB further (18). Only the AC part of the pulse train
is injected into the tract; the mean flow belongs to the aerodynamic model.
That mean glides over 3 ms: subtracted in one step at each new period (a
shimmer amplitude, a new Rd), it would put a small click on every period, a
broadband fizz above 5 kHz.

**Two-mass model** (Ishizaka & Flanagan 1972, in the asymmetric form of
Steinecke & Herzel 1995):

    m_i x_i'' + r_i x_i' + k_i x_i + H(-a_i) c_i a_i/(2 l) + k_c (x_i - x_j) = F_i
    a_i = a0_i + l (x_left + x_right),   F_1 = l d_1 P_1,   F_2 = l d_2 P_2

P_1 is the pressure under the narrowest point (the lung pressure less the
Bernoulli drop while the glottis converges, all of it when the upper masses
are shut) and P_2 the pressure above the glottis, where the jet has
separated. Pitch comes from the tension Q (k -> Q k, m -> m / Q); with automatic tension
the model follows the requested F0. The length of the folds (1 = an adult
man's 1.4 cm; a woman's about 0.7, a child's 0.5) scales their masses,
stiffnesses and the area per displacement, and in either model every area
of the glottis (the pulses, the chink, the abduction) and its Reynolds
number: shorter folds give smaller pulses and less air at the same pitch. Left/right asymmetry gives subharmonics
and raspy voice. The flow is solved each sample against the tract input
impedance, dP = rho U²/(2 a_min²) + (Z + R_visc) U (Titze 1984), so the tract
loads the folds. The wave it is solved against is the one the glottal end
reflects, the tract's without its quasi-static part: solved against the
whole of it, the difference was fed back, a held /a/ came out 8 dB louder
than with the LF source, and with a wide glottis, which hardly resists, the
flow ran away.

An open glottis is open behind the folds, between the cartilages that draw
them apart. That air passes beside the folds under the same drop of
pressure and into the same tract, so the two flows are solved together
(Newton, three steps), and for it the glottal end of the tract is no longer
a hard wall. The tubes carry the sound alone, so they are loaded with the
flow less its steady part: for the folds, their running mean; for the
opening beside them, what it passes under the pressures of the
aerodynamics, known at once. A mean lags when the glottis opens or the
lungs stop, and while it lagged the folds were driven by a pressure that
was not there: the vowel after an /h/ came out three times as loud, and the
air went on for 0.2 s after the lungs had stopped.

Nobody tells these folds to stop. The more air passes beside them, the less
the tract answers to their own flow, which is what keeps them going: a held
/a/ is at -21.9 dB with the folds together (LF source -22.4), at -26.8 dB
with them a little apart (0.2 of the full opening: LF -25.9), and from 0.7
on it is breath without a pitch. Through an /h/ between vowels they go on
vibrating, as a voiced [ɦ]. In "he has a house" the two sources are 0.4 dB
apart.

**Source-tract interaction** (LF mode): the glottal end reflection of the
waveguide follows the time-varying glottal impedance during the open phase,
which widens F1 and skews the pulses as in real voices.

### Aerodynamics

Lungs -> glottis -> oral constriction (with the nose in parallel) -> out
(Stevens 1998). Each orifice obeys U = A sqrt(2 dP / rho); the cavity behind
the constriction has a compliance C (its walls, plus the air itself,
V / (rho c^2)) and a volume V that can change,

    C dPo/dt = U_glottis - U_mouth - U_nose - dV/dt

This gives intraoral pressure build-up in closures, the release of stops, and
the aerodynamic limit of voicing (no transglottal pressure, no vibration).
The pressure may fall below the outside one: the mouth and nose flows then
go inward, and the jet noise follows the speed of the air whichever way it
moves. The lungs may pull as well as push: below zero their pressure draws
the air in through the glottis, which is how a breath is taken. A jet's
speed goes with the root of the pressure behind it, which turns round at
zero with an infinite slope: where the air stops going out and starts
coming in the flow would step, and the step is heard as a pop. But a wide
glottis under a low pressure is not what holds the air back: the airways
below it are, 1.5 cmH2O per l/s in healthy adults breathing with the
glottis open (DuBois, Botelho & Comroe 1956), and through them the flow
goes with the pressure itself. The glottis takes the smaller of the two
flows: the airways' below 1.2 cmH2O when it is wide open (0.56 cm²), below
0.35 cmH2O at 0.3 cm², and below 0.01 cmH2O for the glottis of a voice,
where nothing changes. The volume changes with the larynx, a piston under the cavity: raised,
it shortens the pharynx below its bend and takes away the air of that
stretch; lowered, it adds some. Only the larynx counts, because the tongue of
the area function does not keep its volume (a stop aims past the contact),
so the cavity it seems to leave behind a closure is not real air. The walls
yield about 1e-3 cm^5/dyn; tensed, as the pharynx of an ejective, five times
less; let go and drawn outward, as the pharynx and the cheeks of an
implosive (Westbury 1983), three times more. They do not follow the
pressure at once: they have mass and they resist (per unit area the
constants of Ishizaka, French & Flanagan 1975, as tabulated by Titze,
Palaparthi & Smith 2014), so the cavity is its air, small and quick, and
beside it the walls, which take their volume in and give it back in about
12 ms. At the release of a stop the pressure then falls as soon as the
passage lets out more than the glottis and the walls can supply, where
walls without mass emptied all at once and held it up. An ejective (kʼ)
then shuts its
glottis, raises its larynx once the mouth is closed and compresses the air
to more than the lungs give (10.6 cmH2O against 8), with no air from the
lungs: a short burst, then the voice. An implosive (ɓ) lowers its larynx
with the folds vibrating, and the pressure behind the lips rises to little
more than half that of [b], so the voice keeps going through the closure; a
voiceless one
(ɓ̥) lowers it with the glottis shut and draws the air in at the release.
The sequencer finds the moment the mouth is shut by running the engine's
target dynamics and measuring the passage they leave (the lips shut some
40 ms after they set out, the tongue leaving an open vowel 70-80 ms after),
has the gesture set out early enough to be shut when its sound is due (see
Speech), and starts the piston there.

A click (ʘ ǀ ǃ ǁ ǂ) has a second cavity, between its velar closure and its
front one, shut off from the lungs. Once both closures are made, the
tongue body enlarges it by 0.6 cm³ against stiff walls (the tongue pulled
taut against the palate, 3e-5 cm^5/dyn, plus its air), so its pressure
falls to about -19 cmH2O; the front then opens first (the back closure, and
the tip of a lateral click, hold on 25 ms longer; a lateral click keeps its
sides shut and releases by lowering them), the air rushes in (170 to
300 cm³/s inward for a few milliseconds, through a passage that opens as
the tongue leaves it) and that inflow, injected at the front passage, is
the pop. The inflow is a jet too, blowing inward: by the same
law as a fricative's it makes turbulence on the walls of the cavity half a
centimetre behind the front passage, which gives the dental click its
hiss (above 3 kHz the 8 ms after the release rise 18 dB; the hiss alone is
flat from 1 to 4 kHz and peaks at 3 kHz, lower than Hadza dental clicks,
which peak near 6 kHz: Demolin, Ghio & Harvey 2023). The lungs meanwhile press against the back closure,
which bursts as a plosive a moment later.
Below the speaking pressure (8 cmH2O) the vibration amplitude falls almost in
proportion to the transglottal pressure, so that, with the jet speed, the
voice loses 8-9 dB per halving of the pressure, as measured (Titze & Sundberg
1992): a voiced fricative, with pressure behind its constriction, is much
weaker than its vowels.
Above the speaking pressure the amplitude grows more slowly, and a louder
voice also closes more sharply: in the LF source Rd falls by 0.2 per
doubling of the lung pressure, so the level and the upper spectrum rise
together. A held /a/ at 4, 8 and 16 cmH2O is at -32.8, -22.4 and -13.7 dB,
with its 2-4 kHz band 37.9, 36.2 and 33.4 dB below the band under 1 kHz
(before: the same tilt at 4 and 8, and 6 dB from 8 to 16). The pressure
above the glottis also slows the folds, by 1 % of the pitch per cmH2O: the
pitch dips by 5 % in a long /b/ and by 3 % in a /z/, and stays in an /m/.
That is 1.2 Hz per cmH2O at 120 Hz, below the 2-6 Hz per cmH2O found across
the folds (Titze 1989), as the planned pitch already dips after a voiced
consonant. The two-mass folds do both from their equations: 8.9 and 7.9 dB
per doubling, a tilt 6.1 and 5.6 dB less steep, and a pitch 3 Hz lower at
4 cmH2O than at 8.
Lung and intraoral pressures are smoothed per sample, so a closure never
produces steps. Everything the sample loop takes from the control rate
(pressures, mouth flow, voicing amplitude, glottal opening, the glottal-stop
gate, the noise levels) is carried as a straight line across each 32-sample
control period: held as steps, it would modulate the glottal pulses at
1.5 kHz and leave a comb of whistles at its multiples.
The passage the aerodynamics works with (its area, perimeter and width, the
way from its exit to the teeth, the front passage of a click) is measured
with the shape, every few milliseconds, and follows its measures along the
same smooth curve as the sections of the tube (see Vocal tract), and as
late as they do. Taken at once, a closure opened in steps, and the flow,
the pressure and the hiss of its release with it: a tick at every step.
Half a measure ahead of the tube, the air of a release and the inflow of a
click were let into sections that had not opened yet, and sounded many
times louder there (the pop of [ǀ] by 14 dB).

### Vocal tract

**Articulatory geometry** (in the spirit of Maeda 1990 and Birkholz's
VocalTractLab): rigid and deformable structures in the mid-sagittal plane
(posterior pharyngeal wall, velum, hard palate, incisors, lips, jaw, tongue
body and tip) are cut by a semi-polar grid of lines. Each line gives the
distance d between the lower and the upper wall on the midline; across it
the section is a lens between two walls that meet toward the sides,
h(z) = d - K |z|^p, closed laterally by the teeth or the lateral pharyngeal
walls (src/dsp/tract/section3d.ts). Its area is the power law A = alpha d^beta
that X-ray and cast studies fitted region by region (Heinz & Stevens 1965;
Sundberg et al. 1987), with beta = 1 + 1/p; because the shape itself is
modelled, every section also has its true perimeter (a flat passage has far
more wall than a round duct of the same area: 1.9 times for a 1 mm high oral
section), the share of that wall which is soft tissue and yields (tongue,
velum, pharynx, cheeks, lips) or bone and does not (hard palate, teeth), the
central groove of the tongue blade and, in a lateral, the two channels beside
the tongue. The lips (elliptic opening) and the teeth (the explicit slit
between the incisor edges) keep their own shapes. The centreline length is
measured, so lip protrusion and a lowered larynx really lengthen the tube
(and spread lips, protrusion below zero, shorten it). The geometry and the
area function cost about 0.1 ms per update. 15 articulators: jaw, tongue body
x/y, tongue root, tip x/y, blade groove, tongue sides (the margins drawn in
and lowered, for laterals), lip opening, rounding, protrusion, labiodental
tuck, velum, larynx height and the sphincter above the folds. The
tongue root moves the back of the tongue below the body centre forward or
back on its own (as Maeda's tongue-shape parameter), fully at the hyoid and
fading toward the dorsum: tense /i/ advances it and widens the lower
pharynx, lax /ɪ ɛ/ pull it back. Its rest position and the epilaryngeal tube
above the glottis (about 0.45 cm², A = 0.55 d^1.3) follow the area functions
measured by MRI (Story 2008), where the lower pharynx of most vowels is about
1 cm². The aryepiglottic sphincter (the arytenoids drawn forward under the
epiglottis and the folds above the vocal folds drawn in: Esling 2005; Moisik
& Esling 2011) draws the front of that tube back to the wall and narrows it
side to side, most between 0.6 and 2.4 cm above the glottis: 0.19 cm² at
0.5, shut at 1 (the epiglottal stop), a little wider below zero. Narrowed to
a fraction of the pharynx it rings on its own near 3 kHz, the singer's
formant and the "twang" (Sundberg 1974; Titze & Story 1997): at 0.5 the band
from 2.4 to 3.6 kHz rises 3.7-8.9 dB against the first formant's in the
transfer function of /a i u/, 2.3 dB in a held /a/ as the engine makes it.
The narrowest passage of a sound is looked for above that tube, which is
narrow even at rest, unless the sphincter is drawn in past 0.3. A tucked lower lip keeps its slit under the upper teeth whatever the
jaw, as a closing lip does for a bilabial (motor equivalence), and it slides
out in front of the incisors when it rises above their edge, so that a /v/
on its way to a rounded /w/ ("vuole") never closes. The anatomy (size,
pharynx length and width, the vault of the palate and the width of the
dental arch, the size of the tongue and its frenulum, the width of the mouth
and the thickness of the lips, nasal leak) is the persistent "person" part
of the filter. The vault rises or sinks over the
line from the velum to the alveolar ridge, so the seams with the velum and
the incisors stay where they are; the arch widens or narrows every section
of the mouth; the tongue's body is a larger or smaller circle; the frenulum
ties the underside of the tip to the floor of the mouth, which turns with
the jaw, so a short one (tongue-tie) holds the tip down and only closing
the jaw lifts it; thicker lips reach further in front of the teeth and
lengthen the tube, a wider mouth widens the opening between them.

**A head of another shape** (src/dsp/speech/derive.ts, adapt()): every
posture of the tables and every recipe was made on the drawing's head. On a
head whose mouth or throat has another shape (the vault, the arch, the
width of the pharynx, the tongue, the lips) each sound is aimed again, as a speaker aims at the
constriction and not at a posture (motor equivalence; Perkell et al. 1993):
a stop or a nasal closes, pressing as far past its new contact as it
pressed past the old one (where its articulator cannot reach, the jaw comes
up, then the body of the tongue: a tongue-tied /t/ is closed by the jaw);
a click keeps both its closures; a fricative, an approximant or a trill keeps its
passage at its place with the articulator that makes it, and the body of
the tongue comes down (or the root forward) if the head would narrow the
tract somewhere else; a lateral keeps its sides; a vowel keeps its passage
within 0.85-1.2 of its own at its constriction and never narrower than
0.3 cm², so what is left of the difference is the head's timbre. It does
so with an articulator that stays inside its range, where one can. Under
a low palate the body of the tongue was sent below its range for the
r-coloured vowels; wherever a posture was then kept to the ranges (the
planner, the engine, the habits of a voice) it was pulled back up, their
passage fell from 0.21-0.25 to 0.05-0.07 cm², the pressure rose behind it
and the voice went out in a hiss ("heard" on a voice fitted to a
recording); nor would the slow body have got that far in a short vowel.
Now the tip of the tongue comes down a little instead, and a posture
already past a range is taken no further out, but never pulled back
(`within`). The size,
the length of the pharynx and the nose change no posture (a posture scales
with the head), nor do the teeth (their effect on a hiss is theirs to give).
Only a vowel that would no longer let the air through is opened, as a
voice says it (`vented`): a posture shrinks with the head, its passages
with the square of the size, and takes the speaker's habits, but the air
that has to go through does not. Its narrowest passage, in cm² on the
speaker's own head, is kept to 0.85 of the one it has on the drawing's
head (of 0.3 cm², if that is wider; chosen, not measured), place by
place, by the articulator that does it with the least move. On a head
0.83 of the drawing's, 15 of the 35 vowels were narrower than that; with
the tongue kept back by 0.08 as well, 14 (down to 0.35 of what they
need); with that tongue on the drawing's head, 6.
The planner, the sounds held by hand and the trills' contacts all use the
adapted sounds; a sound the head does not let the tongue make is listed as
approximate.

**Waveguide** (Kelly & Lochbaum 1962): 44 equal sections of pressure waves
with one sample of delay each, run at fs_t = N c / L (88 kHz for 17.5 cm), so
any tract length is exact. Junctions:

    r = (A1 - A2)/(A1 + A2),  w = r (f_in - b_in),  f_out = f_in + w,  b_out = b_in + w
    three-way (velum, sinus ostia):  p_J = 2 sum(A_i p_i) / sum(A_i),  out_i = p_J - p_i
    dipole source p_s:   f_out += p_s (1 + r)/2,  b_out -= p_s (1 - r)/2
    monopole source u_s: f_out += rho c u_s / (A1 + A2),  b_out += rho c u_s / (A1 + A2)
    glottal end:         f_0 = r_g b_0 + Z_0 (1 + r_g)/2 U_g
    series resistance R: q = 2 (f_in - b_in) / (1/A1 + 1/A2 + R/(rho c)),
                         f_out = b_in + q/A2,  b_out = f_in - q/A1

Losses: per-section decay exp(-sigma/fs) with sigma = 70 + 45 X sqrt(3/A) s⁻¹,
where X = P / (2 sqrt(pi A)) is the perimeter of the section relative to a
round one of the same area (1 for a circle, at most 8): narrow and flat
sections lose more. Calibrated against the frequency-domain model, which
takes the same perimeters for its viscous and thermal losses.
Yielding walls: a mass-spring-damper per section pair (m = 1.5 g/cm²,
r = 1000 dyn s/cm³, k = 3e5 dyn/cm³) removes
air as a flow sink over the soft part of the wall only (in /i/ half of the
wall under the hard palate, the tongue; all of it in the pharynx; none at the
incisal slit), which raises F1 in closed tracts and sets the low-frequency
bandwidths. The mass and the stiffness are those Ishizaka, French &
Flanagan (1975) found by shaking the cheek and the neck. The resistance is
set by what the walls do to the air: measured through sealed lips with the
glottis closed, the tract has a resonance of its air on the mass of its
walls at 210 ± 55 Hz in men, 105 ± 30 Hz wide and 3.9 ± 1.0 MPa s/m³ high
(Hanna, Smith & Wolfe 2016), which gives walls of 1.5 g/cm² and about
950 dyn s/cm³ (near the 1050 they work out for Ishizaka's tensed cheek;
his neck, at 2300, is the most damped of the places he shook). A tube like
theirs, 17 cm long and 1 cm in radius, shut at both ends, resonates here
at 225 Hz, 103 Hz wide and 4.0 MPa s/m³ high in the frequency model, and
at 232 Hz, 110 Hz and 3.7 MPa s/m³ in the waveguide. With 1600 dyn s/cm³,
as before, it was 161 Hz wide and 2.9 MPa s/m³ high, and the first
resonance of /u/ 111 Hz wide; it is now 73 Hz (/i/ 59), where about 70 Hz
was measured on close vowels with the glottis closed (Fujimura & Lindqvist
1971). The walls are also heard: the air they take in and give back
moves the tissue out to the skin of the neck and the cheeks, which radiates
it like a small mouth. Half of their summed volume velocity joins the sound
(the back of the pharynx rests on the spine, and the neck is farther from
the listener than the lips), so a voiced closure hums low, 24-26 dB below its
vowel: the voice bar of a spectrogram, through which /b d g/ sound voiced;
a voiceless closure stays silent. The surfaces glide with the areas, and a
wall where a branch joins comes to rest instead of stopping, still taking
its flow from the tube while it does (the fossae follow the larynx from
junction to junction: a wall whose flow went at once when they arrived left
a tick inside a vowel). Lips and nostrils: Flanagan's piston radiation
impedance (parallel R-L) as a first-order reflection filter (bilinear
transform); the sound is the time derivative of lip plus nostril flow, with
the walls' share. The shape is measured every few milliseconds, and the
areas move between the measures sample by sample. They do not run straight
to each measure and wait there for the next: a section that starts and
stops three hundred times a second changes its speed at once each time, and
on the steady flow of speech each change of speed is a small step of
pressure, a tick. They follow the smooth curve the measures draw (their
quadratic B-spline): when a measure comes, each area is half way between
the last one and it, moving at the speed that takes one to the other.
Place and speed are continuous, a section that closes lands on its closure
with no speed left, and the price is half a measure of delay, under 2 ms.
Losses and radiation coefficients glide with the areas. Jet losses: where the flow leaves a
narrow passage (the constriction of a fricative, the slit between the
incisors, the lips) it separates into a jet that loses its kinetic pressure in
the wider part downstream (Borda-Carnot), dp = rho/2 v² (1 - A/A_down)². For
the sound this is a series resistance R = rho U (1 - A/A_down)² / A² at that
junction, with the mean flow U of the aerodynamic model (Birkholz, Jackèl &
Kröger 2007; Stevens 1998). The air always leaves the lips into open air,
so the lips carry the whole exit loss, R = rho U / A², even when a passage
just behind them is narrower. It widens the resonances around a fricative
several times (the sharpest one below 4 kHz in /ʃ/ 3.6 times at
600 cm³/s) and those of a vowel hardly at all (1.15 times in /i/ at
150 cm³/s). The output is low-passed (8th-order
Butterworth) and resampled to the audio rate with Catmull-Rom interpolation.

**Nasal tract**: 28 sections (about 11 cm, scaled with the speaker) with the
area profile of Dang, Honda & Suzuki (1994), joined at the velopharyngeal
port, where the velum begins. The model's velum has no uvula, so the dorsum
makes a uvular closure below it: with the port open and the mouth shut
there (ɴ), the nose joins just behind that closure, where the uvula would
hang, instead of being cut off from the glottis (the murmur of [aɴa] is
7.9 dB under its vowel, 19 dB with the nose joined at the velum). The first 7 sections (the nasopharynx) are common; at the choanae a
three-way junction splits them into the left and right passages, each with
half the area and its own radiating nostril. Two equal passages sound like
the merged tube; unequal ones add a pole-zero pair (Dang et al. 1994): with
one side congested by the nasal cycle (the turbinates of one side swell
while the other side's shrink, every few hours) /m/ gains a resonance near
2.2 kHz with its antiresonance. A pinched nostril closes its passage, which
becomes a closed side branch: a new antiresonance near 560 Hz, and the first
resonance of /m/ falls from about 320 to 240 Hz. With both pinched the air of
a held /m/ has no way out (the aerodynamics take the nostril area too): the
mouth pressure rises to the lung pressure and the hum dies. The maxillary
sinuses (one per side) and the sphenoidal sinus (on the nasopharynx) are
neck + closed cavity side branches, resonating near 450-650 Hz (Dang & Honda
1996). The convoluted turbinates give the passages more wall surface, hence
higher viscous and thermal losses; their walls are bone and cartilage under a
thin mucosa, so unlike the cheeks they hardly yield. With soft walls the
first resonance of the murmur would rise to about 390 Hz; with bony ones it
stays near 310-330 Hz, close to the 250-300 Hz measured in men (Stevens
1998), in both models. The waveguide damps the nose ten times more than the
plain wall losses, which puts a held /m/ 7-9 dB below /a/ (Fletcher 1953).

**Blind branches**: two kinds of cavity open off the main tube and end in a
rigid wall; each joins it at a three-way junction with sections of its own,
and a branch that closes or moves to another junction restarts from silence.
The piriform fossae, two pouches beside the larynx (about 1.8 cm deep in
adult men, 2.35 cm effective here, 1.4 cm² together at the opening and
0.5 cm² at the bottom), open where the epilaryngeal tube ends: they put an
antiresonance at 4-5 kHz into every vowel and lower the formants below it
(Dang & Honda 1997), here 4470-4490 Hz and 23-27 dB deep. Filled halfway with
water, as in Dang and Honda's experiment (Tract & person: piriform fossae, air
inside), the valley rises to about 8 kHz. The larynx carries them along as
it rises and falls, about twice a second in speech, so their mouth moves to
the next junction of the tube: a copy of the branch, with its waves, opens
there from a sliver while the branch narrows to one where it was, over two
geometry updates (moving it in one sample, with its waves zeroed, was a
click of up to +51 dB above the voice around it). In a lateral the tip closes on the
midline and the air flows past both sides of the tongue, through channels of
0.1-0.5 cm² a side (Narayanan, Alwan & Haker 1997; here 0.52 cm² both
together); the lumen between the margins of the tongue, from where the
channels split off to the contact, is the supralingual cavity (3.1 cm in
Zhang & Espy-Wilson 2004; here 2.5 cm in /l/, 3.4 cm in /ɫ/), with its
antiresonance between F3 and F4: 3490 Hz in /l/, 3960 Hz in /ɫ/.

**Frequency-domain reference** (Sondhi & Schroeter 1987; Story, Titze &
Hoffman 1996): the same area function as a chain of lossy ABCD sections with
viscous, thermal and wall losses and the radiation load. It draws the filter
envelope and formants in the UI and validates the waveguide, with the same
jet resistances: for the obstacle noise of /ʃ/ the two give the same spectrum
within 1.1 dB in every band from 0.5 to 8 kHz. On the 11 vowel
area functions Story (2008) measured by MRI (one adult man, 44 sections) it
gives the formants he computed from them within 4.8 % (F1), 2.2 % (F2) and
0.8 % (F3) on average.

**Measured shapes** (src/dsp/data/mri.ts): those 11 MRI area functions can be
loaded as the tube and heard. The articulatory vowels are fitted to them
(scripts/fit-mri.ts): among the many tract shapes that give a vowel its
reference formants, the fit chooses the one closest to the measured shape
(log areas compared along the tract, lips left out because MRI segments them
poorly), with the measured tract length and typical jaw openings, and never
a passage narrower than the measured one (it would hiss and throttle the
airflow). The shape distance falls from 0.98 with the drawing's own vowels
to 0.59 (0.1 means areas within about 10 %); the formants stay on target.

### Below the glottis

The trachea and the bronchi are a tube too, about 20 cm long, closed at the
top by the folds and open at the bottom, where the airways have divided
into so many that their total section opens out. Its resonances have been
measured through the skin of the neck: 554 ± 42, 1327 ± 77 and
2179 ± 126 Hz in young men, 660 ± 47, 1513 ± 69 and 2426 ± 101 Hz in young
women, where a uniform tube closed at the glottis and open at its other end
has them, the first a little higher because the walls yield (Lulich et al.
2012; Lulich 2025).

Here (src/dsp/tract/subglottal.ts) the tube is the trachea, 1.8 cm wide and
12 cm long, and three generations of bronchi, each airway dividing into a
larger and a smaller one with the diameters and lengths of Florens, Sapoval
& Filoche (2011). For plane waves the airways of one generation are one
tube with the sum of their sections and of their walls. It ends after the
third generation, 19.5 cm below the glottis, in an open end: where the
measured resonances put the end of the tube, not where the airways end.
With walls that yield as those of the tract do, the frequency-domain model
gives it resonances at 523, 1324 and 2195 Hz (469 Hz for the first with
rigid walls), and 601, 1522 and 2523 Hz for a speaker 0.87 times the size.

The engine does not run this tube section by section. It keeps what the
glottis sees of it: the pressure the tube answers with under the folds to
the flow that leaves it, a sum of resonances (band-pass filters of the
flow) with the frequency, the width and the height of each peak of the
tube's impedance at its closed end, below 4 kHz. The glottis is then a
resistance Zg between two tubes, and one flow passes through it:

    U = (Zg Ug + 2 (a - b)) / (Zg + Z0 + Zt)

with Ug the flow of the source, b the wave arriving from the tract, Z0 the
impedance of the tract's first section, and 2 a - Zt U the pressure below
(what the resonances hold from the flows before, less what they answer at
once). With nothing below it is the glottal reflection used before. A
second waveguide under the glottis does the same, and was tried first: but
its sections change length whenever the tract's does (the tract's rate
follows the length of the mouth), and a tube that has to keep its own
length, cut again at each change, ticked.

While the glottis is shut the voice does not know the tube is there. Open,
the two are joined: in a breathy /a/, the folds apart, the harmonics
nearest to the three resonances fall by 3.6, 2.6 and 2.6 dB, where the tube
below stops the flow that the glottis would let through, and nothing
changes away from them; in a modal /a/ they fall by 0.6, 2.0 and 0.9 dB.
The two-mass folds have the pressure below them in their flow equation and
in the forces on their masses.

### Turbulence noise

At the narrowest oral passage a jet forms with v = sqrt(2 Po / rho) and
hydraulic diameter D = 4 A / P, with the true perimeter P of the passage
(2 sqrt(A / pi) for a round one, about twice the height of a slit). Noise
starts when the Reynolds number
Re = v D / nu passes about 1800 (smooth onset). Sources (Stevens 1971, 1998;
Flanagan & Cherry 1969; Shadle 1985):

- **Constriction (wall) source**: a dipole at about 0.5 cm downstream of the
  constriction exit, strength proportional to rho v³ / c times sqrt(A)
  (Stevens' U³ A^-2.5 law).
- **Obstacle (teeth) source**: the jet keeps its speed along a potential
  core (5 D for a round passage, shorter for a flat one), then slows: like
  1/sqrt(x) while it is flat, like 1/x once it is about five widths long and
  has turned round (Sforza, Steiger & Trentacoste 1966). It spreads
  (width about D + 0.22 x); the share that hits the incisors is
  1 - slit height / jet width. That share, with the velocity at the teeth,
  sets a stronger dipole at the teeth. This is what makes /s/ and /ʃ/ louder
  and sharper than /f/ and /θ/, and why opening the incisal slit weakens /s/.
  The jet leaves the passage where the tract opens up again, and no further
  than the incisors: they are not more of the passage but what stands in
  front of it, so a channel of the tongue that runs up to them (a sibilant
  said with the jaw a little lower, between two open vowels) lets its jet
  out at the teeth. Looked for past them, the way out was found at the lips,
  and a sibilant in a sentence lost its teeth whenever the slit was less
  than twice its channel. The teeth are an obstacle only to a jet aimed at
  them, out of a narrow channel close behind them (Shadle 1985); out of a
  wide passage, or one far back, the jet spreads along the palate first and
  makes its noise on the walls. The share that hits fades from 1 to 0 as
  the passage widens from 0.32 to 0.45 cm² and as its exit moves from 2.0
  to 2.6 cm behind the incisors (chosen, not measured; both taken at the
  drawing's size, as a posture is): past the sibilants
  (up to about 0.23 cm², 0.6 cm) and a tip of the tongue letting go of the
  ridge (0.1-0.37 cm², 1.4-1.8 cm), toward the tongue of an [h] (0.55 cm²)
  and of an r-coloured vowel (2.3-2.6 cm). Without it the teeth hissed in
  [h] about 15 dB below an /s/, and in an [ɪ] after it; heard by ear in a
  copy where only the sibilants kept the teeth, the shrill noises between
  the sibilants were gone. Now the teeth are silent in [h], 21 dB quieter in
  that [ɪ] and 25-30 dB in [ɚ ɝ]; the sibilants and the bursts of the stops
  are as they were.
- **Aspiration**: turbulence of the glottal jet, from the glottal Reynolds
  number, pulsed by the glottal flow (as in real voices) or steady. The jet
  of the glottis is wide and slow, and its corner is near 2 kHz. Above the
  corner its source falls at 12 dB per octave, as the spectrum Stevens
  (1989) gives for the source of turbulence noise does (4 dB down at 2 kHz
  against 1 kHz, 14 at 5, 26 at 10: two poles at 2.5 kHz are 2.9, 12.3 and
  22.6 dB down). Falling at 6 dB per octave, as the jets of the mouth do,
  it was radiated flat up to 20 kHz: the breath after an aspirated stop
  had 56 % of its energy above 6 kHz, where its vowel has next to nothing,
  a hiss as bright as a sibilant; it has 8 %. The jets of the mouth keep
  the gentler fall, with which the sibilants and the bursts were matched to
  measured ones.
- **The top of the spectrum**: above about 10 kHz a tube of plane waves,
  a few millimetres a section and losing the same at every frequency, is
  no longer the mouth: its walls lose more as the frequency rises, the
  waves no longer fill a section as one, and the teeth and lips scatter
  them. There the long-term spectrum of speech lay 8 dB above the measured
  one at 12.7 kHz and 18-20 dB at 16-20 kHz, and held /s/ 17-22 dB (Monson,
  Lotto & Story 2012, on axis in an anechoic room): every fricative and
  every release carried a sizzle that no speaker makes, most of the energy
  of the hiss of an English /t/. What the tube radiates now goes through a
  low-pass of order 6 at 12.5 kHz (higher in a smaller head, as the
  section a plane wave fills scales with it), which brings both within
  4.2 dB of the measured ones up to 16 kHz and 6.6 dB at 20 kHz, and
  changes nothing below 8 kHz. It is a correction of the whole, set on measurements, not a
  model of the losses.
- **Release burst**: a monopole at the closure that opened, proportional to
  the quick part of the air it lets out. The pulses of the voice are already
  in the tube and do not count: a closure made on a voiced sound lets out no
  air. A seal with pressure behind it is parted by the air before the
  articulator has moved away: a centimetre of seal with the stiffness of the
  walls opens 0.12 cm² under 8 cmH2O. The release is then a quick rise, a
  pause while the pressure falls, and the rise the articulator makes, and
  the burst is made in the pause (Hanson & Stevens 2000). What the burst is
  made of depends on the seal, and the three seals are set so that the
  bursts come out as loud against their vowels as they were measured
  (Nicolaidis et al. 2019). The lips are free and wide: 2 cm of them part
  at once into a flat slit. The tip of the tongue is held against the
  ridge: its seal takes a millisecond and a half to part, so it pops
  little, and the air leaves at first through a channel no wider than the
  one the tip itself is opening, a jet that is turbulent from the start and
  strikes the teeth. The burst of a /t/ is then a short hiss, about as loud for its
  few milliseconds as an /s/, which is what the measures say (-10.7 dB
  against /a/ for the burst, -10 dB for /s/). Parted at once into a flat
  slit, as it was, the tip gave a bare pop with hardly any hiss in it: a
  click of the tongue. The opening then spreads across the seal: the tip
  was pressed against the ridge or the teeth from side to side, not along
  the narrow channel that a held sound is drawn with (the law of the areas
  was fitted on held sounds), so 10 ms after the release the air leaves
  through a flat slit 2 cm wide (at the drawing's size) and as high as the
  tip has come down, until the tip is 2-6 mm away or 30-60 ms have passed
  (all chosen, not measured). The pressure behind a /t/ or a /d/ is then
  gone in some ten milliseconds also before a high vowel, where the jaw is
  still up and the tip has little way to go: through the narrow channel
  alone 40 % of it was still there 10 ms after the /d/ of "la dita", and
  the air went on hissing at the teeth for 40 ms, a [dz]. A tongue that
  goes on to the groove of a sibilant keeps its channel, and so does a
  trill. The body of the tongue parts at once over 1 cm. The source stays at the place of its closure while it
  lasts, also when another place becomes the narrowest, and takes 4 ms to
  move to the next closure that opens.
- **A second passage**: where the tongue narrows the tract twice, both
  passages below 0.2 cm², at least 2 cm apart and with a passage 2.5 times
  wider between them (ɧ, "simultaneous ʃ and x"), the flow goes through
  both as through one of area (A1^-2 + A2^-2)^-1/2, each takes the share
  (A / Ak)^2 of the drop of pressure, and the second has a jet source of its
  own at its exit. The lips and the teeth never count as one: they have
  sources of their own.

Each noise is Gaussian white noise through a first-order high-pass (dipoles
radiate little at low frequency) and a first-order low-pass at the Strouhal
corner f_c = 0.15 v / D, then filtered by the part of the tract in front of
it (the same source model as VocalTractLab, Birkholz 2014).

**Sibilant shapes.** The spectrum of /s/ and /ʃ/ is mostly the cavity in front
of the incisors and the constriction. A /ʃ/ with its constriction 2.5 cm
behind the teeth and long, nearly closed lips had a front cavity of 5.4 cm:
its lowest resonance, near 1.2 kHz, carried as much energy as the 3-4 kHz
band and pulled the spectral mean down to 3.1 kHz. scripts/tune-sibilant.ts
fits the articulation on the frequency model (fast, many starting points,
the place kept behind the alveolar ridge) to the peak and mean measured on
real speakers (Jongman et al. 2000), then checks the rendered sound: tongue
a little forward, a deeper groove, lips more protruded.

**Your noise**: a white, pink, brown, blue or violet base, or a spectrum you
draw on 32 log-spaced points (50 Hz - 16 kHz), band-limited, at a chosen level,
optionally pulsed by the glottal flow, injected at the glottis, the
constriction, the teeth, the lips or any point of the tract, or sent straight
to the ears to compare it with what the tract makes of it.

### Teeth and the slit

The incisors are explicit structures. The slit between their edges has a
width (default 22 mm), a height set by the jaw plus an extra opening, a
central diastema, and can be moved by overjet, advance and incisor length.
The slit area enters the area function at the teeth, and its height sets the
obstacle share above. The tongue groove narrows the blade channel for
sibilants. The teeth panel draws the front and side views with the live jet.

### Speech

- **Phonemes**: 14 steady vowels (Italian and English, with the r-coloured
  /ɝ/), the American diphthongs /eɪ aɪ oʊ aʊ ɔɪ/ (a nucleus that glides to its
  offglide), unstressed /ɚ/ and 30 consonants, each a set of articulator
  targets plus source settings (voicing, abduction). Vowel articulations were
  fitted so that the frequency-domain model hits adult male targets: Peterson
  & Barney (1952) where available, Hillenbrand et al. (1995) for Italian
  /e o/, Italian /a/ between /æ/ and /ɑ/, and the uniform tube for /ə/; the
  eleven vowels Story (2008) measured also take his MRI shapes (see Measured
  shapes), and /a ə/ keep their narrowest passage at 0.3 cm² or more. The
  consonants that place the tongue body (s z ʃ ʒ k g ŋ ɲ l ʎ ɫ ɹ j w and /ɝ/)
  keep the root forward, the wide pharynx they were tuned with. The
  American /ɹ/ and /ɝ/ have the tip up and back with rounded lips, which
  pulls F3 down to about 1600-1750 Hz (scripts/tune-rhotic.ts), with the
  narrowest passage kept at 0.3 cm² on the fine grid the aerodynamics uses:
  narrower, the jet turns them into fricatives that hiss; the dark /ɫ/
  of English codas backs the tongue body (F2 about 1000 Hz). The clear /l/
  sets its own tongue body: its air flows around the sides of the tongue,
  which a one-dimensional tube cannot show, and a high vowel next to it
  would otherwise close the passage. The nasal consonants open the
  velopharyngeal port to about 0.4 cm²: in running speech the velum parts
  from the pharyngeal wall by only 2-4 mm, against about 10 mm in a breath,
  across a port 12-28 mm wide (X-ray films of sentences, Laprie, Elie &
  Tsukanova 2015); the 1.6 cm² of the velum fully lowered is the breath.
  The velar nasal /ŋ/ closes against the
  oral face of the lowered velum, in front of the velopharyngeal port;
  further back it would cut the nose off too. /s z/ spread the lips back
  against the teeth (lip protrusion below zero): the short cavity in front of
  the groove puts the hiss where it is measured, and a rounded neighbour
  cannot stretch it down to a lisp. Gestures that cannot be held:
  the tap /ɾ/ (one flick of the tongue tip) and the glottal stop /ʔ/ (the
  folds pressed shut).
- **Italian G2P**: orthography rules (c/g before e/i, ch/gh, sc(i), gn, gl(i),
  qu, z, geminates, silent h, intervocalic s voiced in the northern norm,
  ɲ ʎ ʃ ts dz always long between vowels, penultimate stress unless an accent
  is written); unstressed function words (articles, clitics, prepositions,
  and the verb forms è, ha, ho, hai), which keep their stress when nothing
  follows them in the phrase (chi ce l'ha?); an n that takes the place of
  the consonant after it, inside a word and across words (banco ŋk, un bacio
  mb, in fondo ɱf), but not across a pause;
  numbers in words (ventitré, centottantuno).
- **English G2P** (src/dsp/speech/english.ts): an American lexicon of 89 321
  words with primary and secondary stress, loaded on demand (0.69 MB,
  gzip-compressed; built by scripts/build-lexicon.ts from the gold dictionary
  of the misaki G2P, hexgrad, Apache-2.0); weak forms of function words
  (a, of, to, and...) and "the" before a vowel; inflections of known words
  (-s, -ed, -ing, -er, -ly...) with their voicing rules; compounds split into
  known words; for anything else, letter-to-sound rules in the style of
  Elovitz et al. (1976) with a simple stress rule; numbers and years in words.
  Flaps ("water"), glottal stops ("button"), dark l and r-coloured vowels come
  from the lexicon's American forms. Across words, inside a phrase, a final
  /t d/ links the American way: a flap between vowels ("it is", "get up"), a
  /t/ held by a glottal stop and not released before a consonant ("it
  rains": the folds close with the tongue, so no pressure builds up behind
  it), dropped between consonants ("just two").
- **Other languages** (src/dsp/speech/phonemizer.ts, languages.ts): 68
  languages without rules of their own. The browser's word breaker
  (Intl.Segmenter, which also splits Chinese, Japanese and Thai) cuts the
  text into words; each is looked up in the open pronunciation dictionary
  of its language, ipa-dict (open-dict-data, pinned to one version), where
  there is one with an open license and a reasonable size: French (France
  and Quebec), Brazilian Portuguese, Dutch, Swedish, Norwegian, Icelandic,
  Esperanto, Persian, Malay and Indonesian, Swahili, Japanese, Korean,
  Mandarin (simplified and traditional), Cantonese, Vietnamese. In Chinese
  and Japanese a word the dictionary lacks is split into the longest words
  it has. What no dictionary has is transcribed by CharsiuG2P (Zhu, Zhang &
  Jurgens 2022), a ByT5 transformer that reads bytes, trained on the
  pronunciations of 100 languages: the tiny version with 8 layers (phoneme
  error rate 10.7 %, word error rate 31 % over the 100 languages, as
  published), run in the browser by ONNX Runtime Web on one thread, word
  by word, greedily, behind the language prefix ("<fra>: bonjour" gives
  bɔ̃ʒuʁ). Neither is part of the site: a language's dictionary is fetched
  from the ipa-dict repository when the language is chosen, the model (29
  MB, from Hugging Face, pinned to one revision) only when Speak is pressed
  with words no dictionary has, and both are kept in the browser's cache
  storage. The transcription is said like [IPA], as written, with the
  pauses and questions of the punctuation (the Greek question mark is a
  semicolon). Where the source marks no stress and the language fixes it,
  it goes there: the first syllable in Czech, Slovak, Hungarian, Finnish,
  Estonian, Icelandic, Irish; the penultimate in Polish, Welsh, Esperanto,
  Malay, Swahili; the last in French, Armenian, Persian and the Turkic
  languages. The articles, prepositions, conjunctions and clitic pronouns
  of Spanish, Portuguese, Galician, Catalan, Romanian, German, Dutch,
  Swedish, Norwegian, Danish, Polish and Hungarian are said without stress
  and short, unless nothing follows them in their phrase. The model's German r, often a tap, becomes the uvular one of
  the standard. Where the model learned SAMPA rather than IPA it is turned
  into IPA: Swedish (u0 ɵ, } ʉ, 2 ø, 9 œ, the retroflexes n` t` d` s` l`, S
  for the sj-sound ɧ, % and " for stress), the Amharic ejective mark, the
  Estonian palatalization mark, the Uzbek S; a capital the model kept from
  a name is read as its small letter, and the Danish affricated tˢ as t͡s.
  On the test transcriptions of the model's 60 languages this left about
  50 symbols unread out of some 4000 (letters of other scripts the model
  wrote by mistake).
- **Each language's prosody** (src/dsp/speech/languages.ts,
  LanguageProsody): a language read by the phonemizer is timed and
  intoned by a profile of its own. Its rhythm: by stress feet (German and
  the other Germanic languages, Russian, Ukrainian, Belarusian, Bulgarian,
  European Portuguese, Arabic: a stressed vowel x1.35, an unstressed one
  x0.62, a function word's x0.5), by syllables (the rest: x1.15 and x0.9)
  or by morae (Japanese: no stress in the length, a long vowel twice a
  short one, a geminate x2.2) (Pike 1945; Dauer 1983; Ramus, Nespor &
  Mehler 1999). Its accents: on every stressed word, only on the last
  syllable of each phrase (French, Korean, Japanese), or none where the
  tones do it (Chinese, Cantonese, Vietnamese, Thai). Where its peaks fall:
  early in the vowel (Germanic, Finnish, Estonian, Hungarian, Czech,
  Slovak) or late (Romance, Greek...). How it asks: a yes/no question rises
  at the end, or in Hungarian, Romanian, Greek and the East Slavic
  languages rises on its last stress and falls after it (Ladd 2008). And
  how much it lengthens the end of a phrase: more in French, less where
  length is a phoneme (Finnish, Estonian, Hungarian, Japanese). The voice
  keeps its own body, habits and style in every language; the language
  brings its rhythm and its tunes.
- **IPA** (src/dsp/speech/ipaReader.ts): every symbol of the IPA chart
  (2020), pulmonic and non-pulmonic, with its diacritics and modifier
  letters (voicing, aspiration, breathy and creaky voice, secondary
  articulations ʷ ʲ ˠ ˤ, nasalization, dental, advanced and retracted,
  raised and lowered, apical and laminal (the tip a little back or
  forward: Basque s̺ s̻), rounding, compressed lips (Japanese ɯᵝ), tongue
  root, syllabic, no release, ejective, rhotic, and the strong articulation
  ͈ of the Korean tense consonants: a narrow, stiff glottis, the larynx
  up, no breath, a closure 1.3 times as long and the pitch 3.5 semitones
  higher after it), tie bars (t͡s, k͡p, a͡ɪ), prenasalized stops (ᵐb),
  stress ˈ ˌ, length ː ˑ ˘, syllable breaks, groups | ‖, tones as tone
  letters (˥˩, ˨˩˦), superscript or plain digits (⁵¹, 214) or diacritics
  (á à ā ǎ â), a glottal stop letter inside a tone (Vietnamese ˧ˀ˥: the
  vowel creaks through its contour), downstep ꜜ and upstep ꜛ, the global
  rise and fall ↗ ↘. The
  text is read in canonical decomposition, so a precomposed ã and a with a
  combining tilde are the same sound. Whatever it cannot read is listed
  under the text, never dropped in silence. Between slashes, /phonemic/ IPA
  goes through the rules of English or Italian; between brackets,
  [phonetic] IPA is said as written, with neutral rules: the nominal
  duration of each sound, longer when stressed (x1.25), phrase-final (x1.4)
  or written long (x1.7 vowels, x1.85 consonants), shorter unstressed, in a
  closed syllable or in a cluster; aspiration only where it is written;
  syllables from the written breaks, or else the longest onset rising in
  sonority toward the vowel.
- **Sounds from rules** (src/dsp/speech/derive.ts), in the spirit of
  Browman & Goldstein's articulatory phonology (a gesture is an organ, a
  place and a degree of constriction). Every place has a recipe: the
  articulators it sets and the one that narrows the passage there (the
  rounded lips for bilabials, the lower lip under the incisors, the tip
  against the incisors, the ridge, behind it, or up and back for
  retroflexes, the blade and front of the body for alveolo-palatals, the
  body for palatals and velars, the dorsum backed against the uvula with the
  root forward, the tongue root for pharyngeals, the sphincter above the
  folds for the epiglottals: shut for ʡ, narrowed to a hiss for ʜ ʢ).
  The manner gives the degree: closed for stops and nasals, about 0.1 cm²
  for fricatives (Stevens 1998), 0.3 cm² for approximants, 0.12 cm² between
  the contacts of a trill; a bisection on the geometry finds the value of
  the key that gives it inside the place's window, as the tuning scripts did
  by hand for the fitted consonants. Laterals close the midline and lower
  the sides of the tongue to the degree (ɬ ɮ: 0.1 cm² past the sides). Taps
  and trills strike with the tip, the lips (ʙ ⱱ) or the dorsum against the
  uvula (ʀ). Vowels are interpolated over the fitted vowels by their height
  and backness on the chart (inverse-distance weights of the four nearest),
  with the lips of the rounded or unrounded fitted vowels of the same height:
  [y] has the tongue of [i] and the lips of [u], [ɯ] the tongue of [u] and
  spread lips. The diacritics change the result: a raised or lowered
  sound moves one step along closed, 0.05, 0.1, 0.3 and 0.6 cm² (a lowered
  fricative is an approximant, Spanish β̞ ð̞; a raised trill narrows until
  it hisses between its contacts and lets the glottis open as a voiced
  fricative does, Czech ř, made laminal with the body of the tongue raised
  and fronted behind the blade, as for [ʒ], its contact on the front of the
  ridge); dental, advanced and retracted move the tip or
  the body and solve the degree again (a dental closes with the tip on the
  back of the upper incisors, in a window from their edge to where their
  back meets the gum, 2.4 cm in front of an alveolar; a dental click stays
  laminal, its blade up to the ridge, which keeps its cavity small, and
  the palatal click's front closure is the blade's, on the ridge and the
  front of the palate, while the body makes its velar one; ɧ narrows the
  passage at the ridge with the tip to 0.1 cm² and at the velum with the
  body to 0.12 cm², each solved again with the other in place); palatalization, velarization and
  pharyngealization move the tongue body, then relax it until it leaves
  0.3 cm² behind the primary constriction (emphatic /tˤ sˤ/ lower F2 by
  400-600 Hz with the pharynx open); nasalization opens the velum.
  Where a symbol is one of the fitted phonemes, the fitted one is used, and
  a diacritic on it starts from its posture. Results are cached; the whole
  chart takes about half a second, at most 10 ms a symbol.
- **Laryngeal tier**: aspiration where it is written, with a voice onset
  time by place, 55 ms for labials to 80 ms for uvulars (further back,
  longer: Cho & Ladefoged 1999), and the short lag of unaspirated stops by
  place; murmur after a breathy-voiced stop (the folds vibrate apart, with a
  breathy pulse shape, for 70 ms) and a breathy source through breathy
  sounds; a pressed source and a pitch 3 semitones lower through creaky
  ones; the glottis held shut through an ejective's closure and burst (and a
  voiceless implosive's), with the walls of the pharynx tensed; the larynx
  raised through an ejective and lowered through an implosive, from the
  moment the mouth is shut, both with a longer closure (Lindau 1984), and
  the walls let go through a voiced implosive; no burst after an unreleased
  stop.
- **Lexical tones**: each toned syllable has pitch targets in the speaker's
  range, Chao's five levels (1930) spread over 12 semitones at the default
  accent strength (the accent slider scales it), level 3 in the middle; a
  contour tone (˧˥, ˨˩˦, ˥˩) is a line through the syllable. The voice
  approaches the targets as a critically damped third-order system, the
  quantitative target approximation model (Prom-on, Xu & Thipakorn 2009)
  with a time constant of 11 ms per stage, aligned with the whole syllable,
  so neighbouring tones shape each other as in speech: a high tone after a
  low one starts low. Downstep ꜜ and upstep ꜛ move the register by 2
  semitones, the global rise and fall ↗ ↘ by 3; a toneless syllable continues
  from the tone before, drifting down. The tones take the place of the pitch
  accents and ride on the phrase's declination; they are part of the words,
  so they stay when the intonation is switched off.
- **Sequencer** (src/dsp/speech/sequencer.ts): the phones are syllabified
  (legal onsets, geminates close the syllable before), grouped into words and
  phrases (commas, full stops, questions), and turned into a gestural score.
  Each ingredient of natural speech can be switched off in the speak panel:
  - *Timing*: English durations follow Klatt (1979): every sound has an
    inherent and a minimum duration, and multiplicative rules scale the
    compressible part (phrase-final lengthening x1.4, non-final shortening,
    polysyllabic and unstressed shortening, the next consonant: x1.6 before a
    voiced fricative, x0.7 before a voiceless stop, cluster shortening).
    Italian uses rules of the same form: stressed vowels long in open
    syllables (x1.55) and short before a geminate or a coda, unstressed and
    function-word vowels short, geminates x1.85, phrase-final lengthening.
    The speaking rate acts on the same compressible part, so a faster voice
    does not shorten every sound alike: the minimum is a larger share of a
    consonant than of a vowel, and of an unstressed vowel than of a stressed
    one. The part that gives is scaled by whatever makes the whole last
    1/rate of what it lasts at the usual rate; with a quarter of it left,
    at about 1.5 times the usual rate, the vowels are near their minimum
    and everything is shortened together from there on. Between a slow rate
    (0.9) and a fast one (1.15) the Italian vowels come down to 0.74 of
    their duration and the stops to 0.83, the English ones to 0.72 and 0.83.
    Speakers of English asked to talk slowly and then fast had 0.75 for
    the vowels and 0.9 for the consonants of /pVp/ syllables (Gay 1978), and
    0.74 for a stressed vowel against 0.8 for the stop after it (Port 1981;
    both as reviewed by Katsuda & Kang 2026). A language read from its
    transcription, which has no table of minimum durations, takes the
    share they have in those two: 0.45 of a vowel, 0.65 of a consonant.
  - *Intonation*: the Fujisaki model (Fujisaki & Hirose 1984): ln F0 = ln Fb
    + phrase commands (impulses through α² t e^(-αt), α = 2/s: the slow rise
    and declination of each phrase) + accent commands (steps through
    1 - (1 + βt) e^(-βt), capped at 0.9) on the stressed syllables of content
    words, 5 semitones by default, with a gentle downstep (x0.9 per accent,
    never below 60 %). Each command lasts at least 130-170 ms, so that short
    syllables still reach their peak. English accents rise through the
    stressed syllable and peak inside its vowel; Italian prenuclear accents
    peak late (L+H*), at the end of the vowel rather than on the next
    consonant, where a voiceless sound would hide them; the statement nucleus
    falls onto the stressed syllable (H+L*). The engine follows this curve
    with only a 6 ms smoothing (a slider gets 25 ms), so the accents keep
    their height. Statements end with a final
    lowering, yes/no questions rise, questions with a question word fall, a
    comma leaves a small continuation rise.
  - *Micro-variation*: intrinsic F0 of vowels (+0.7 st for i u, -0.5 st for
    a), the push of the previous consonant on the vowel onset (+1.3 st after a
    voiceless obstruent, -0.8 st after a voiced one, decaying in 35 ms), and
    flutter, the slow F0 wander of Klatt & Klatt (1990): F0 (1 + FL/5000 (sin
    2π 12.7 t + sin 2π 7.1 t + sin 2π 4.7 t)), FL = 25.
  - *Living variation*, with a seed (the app gives a new one to every
    sentence it says; the tests, the fit and the melody drawn in the studio
    have none, and the rules alone): the length of each syllable is
    multiplied by a log-normal factor (sd 8 %, half of it a tempo that
    drifts over a few syllables), each pause by one of 20 %, the height of
    each pitch accent by one of 20 %, the phrase commands and the boundary
    tones by 15 %, the push and tension of each stressed syllable by 30 %
    and the relaxing into each phrase end by 20 %. The flutter becomes a
    random wander of the same rms over about 2-12 Hz (three noises, each
    low-passed twice) instead of the three sines, and the lung pressure
    (4 % rms) and Rd (0.06 rms) wander over 0.7-5 Hz, Rd also from one
    pulse to the next (sd 0.1); the mouth is never still either: the tongue
    body (0.05 rms) and root (0.04), the jaw and the rounding and
    protrusion of the lips (0.03) wander over 1-8 Hz under every sound,
    while the tip and the opening of the lips, which make the closures, do
    not. All of it is scaled
    by the voice's variation (1 by default, 0 the rules alone) and differs
    with the seed; the same seed says it the same way again. The figures
    are chosen, not measured.
  - *Voice quality*: more lung pressure (+14 %) and a tenser source (Rd -0.12)
    on stressed syllables; lower pressure and a breathier source (Rd +0.55)
    over the last 280 ms of each phrase; a lung pressure that falls by 12 %
    from the start of each sentence to its end and is whole again after a
    full stop, where the breath is taken (after a comma it goes on
    falling); quiet pauses (the lungs hold back
    instead of blowing through the open glottis). The utterance starts with
    the folds already together, so there is no breathy onset, and ends when
    the last sound ends, without a trailing breath. A pause does the same:
    the lungs, which take some 60 ms to let go, hold back from 30 ms before
    it, and before a voiced sound after it the folds come together again
    while the pressure is still low. Held back only from 40 ms into it,
    the air blew a breathy [h] through the parted folds, its first 100 ms
    11 dB below the vowels (17 dB now, its hiss above 3 kHz 20 dB lower),
    and the next word began with another (its last 60 ms 28 dB below the
    vowels, 43 now; the eight pauses of five sentences, said by the woman
    and by the man). A last sound with voice ends the same way: the lungs
    let go from 30 ms before its end, and the relaxed pressure of the end of
    the phrase holds after it. The relaxation used to stop with the last
    sound, and for the 50 ms the score goes on the lungs pushed again as
    hard as before through the parted folds: a breathy tail of some 100 ms,
    6-15 dB below the vowels, heard as a breath after a question. The voice
    now dies away within 40 ms (34 dB down).
  - *Coarticulation*: consonants only set the articulators they need; the
    others are interpolated from the neighbouring vowels (Öhman 1966), so lips
    round ahead of /u/ and the tongue glides through /p/. After a consonant,
    the articulators it used are released at once toward their next target
    (the tip leaves the ridge, the lip the teeth) instead of drifting back
    through the following sounds, where they would close the tract again.
    Off: every sound sets every articulator.
  Consonant gestures are timed so that their sound happens when planned
  (scripts/landmarks.ts): fricatives, nasals and approximants start 20 ms
  ahead and overlap the vowel before, so a 50 ms /v/ still reaches its slit;
  stops aim beyond the contact. Coming from an open vowel the jaw, the
  slowest of the organs that carry the lips, the tip and the dorsum, may
  still be low when a closure is due: the sequencer runs the engine's target
  dynamics over every stop and nasal, and where one would not shut it pushes
  the closing articulator further past its contact and the jaw up (a velar,
  which sets no jaw of its own, takes it for the closure), as speakers do in
  fast speech (Kuehn & Moll 1976). /g/ after an open vowel now closes, and at
  1.5 times the usual rate so do /t/ and /k/.
  A velar is made where its vowel is, the /k/ of "chi" further forward than
  that of "cosa", and nothing in the plan says so: the body of the tongue,
  which is slow, is still on its way from one vowel to the next when it
  meets the palate. The front edge of the contact, where the cavity the
  burst rings in ends, is 6.9 cm from the lips before /i/, 7.8 before /a/,
  8.0 before /u/ and 9.0 before /o/; the tip of the tongue, which is fast
  and has a ridge to go to, moves by 0.5 cm. Aiming the body itself halfway
  to the vowel's place was tried and left out: the /k/ of "chi" came
  further forward still and its burst, already weaker than speakers', lost
  another 6 dB. Every consonant lets
  its target go just before the planned release, earlier for the slower
  articulators (tongue body, jaw, velum, in proportion to their time
  constants), so that all of them open together. In the tract model the
  tucked lower lip of /f v/ rises to the upper teeth whatever the jaw (motor
  equivalence, as for bilabial closure). The result: nasals dip 6-13 dB below
  their vowels (the /m/ of "mamma", beside an open /a/, the most) and /v/
  11-19 dB, as in the relative intensities of speech sounds (Fletcher 1953;
  Fry 1979).
  The middle of a vowel belongs to the vowel: the tongue tip, the tongue
  body and the velum may head for the next consonant only from 0.75 of their
  time constant before it. Otherwise a short vowel between alveolars was
  said with the tip already up (an r-coloured, retroflex vowel: /i/ F3 2360
  Hz instead of 2990), one before a velar with the dorsum on its way there,
  and one before a nasal through a port of up to 1 cm². English is the
  exception for the velum: it lowers it from the start of a vowel before a
  nasal, and the nasalized vowel is part of the word (Cohn 1990); Italian
  keeps the vowel oral. A short vowel would also end before the slow
  articulators (tongue body, jaw, lips) reach it, since the tongue body
  needs about 85 ms for 90 % of its way: like a speaker who means to reach
  it, the sequencer aims past the vowel, by as much as the engine's own
  dynamics, run ahead of time, say it falls short, at most 0.6 of the way
  and never outside the articulator's range. Vowels still fall a little
  short where the range ends (/u/ after /j/, /i/ after /ɹ/), as real ones
  do in fast speech (Lindblom 1963). scripts/context.ts measures every vowel
  of 15 English and Italian sentences in its middle against the same vowel
  held: front vowels reach 99 % of their F2 on average (94 % before), 97 %
  at the 10th percentile (77 %); the tip in vowel middles is at 0.24 at the
  90th percentile (1.05); the tongue body misses its target by 0.04 (0.15);
  vowels with an F3 150 Hz below their own fell from 23 % to 6 % (after
  /ɹ/, and before /l/ in Italian); the port in vowels away from nasals is
  shut, and averages 0.05 cm² next to one (0.20).
  An unstressed open vowel is reduced all the same, and nothing in the
  plan lowers its target: it is half as long as a stressed one, and the
  jaw, the slowest of the organs, does not get down in time between two
  closures of the tongue. In /tatata/ the first formant of an unstressed
  /a/ is 583 Hz before the stress and 544 after it, against 728
  stressed: 20 and 25 % below, where two speakers of Italian had it
  18 % and 28 % below, with the tongue and the jaw higher (Farnetani &
  Vayra 1991); the last /a/ of the word, which has the time, opens again
  as theirs did. A slack speaker reduces further and a crisp one less (the
  precision of a voice, below).
  Stops are split into closure and release. English voiceless stops at the
  start of a stressed syllable (not after /s/) keep the glottis open past the
  release: aspiration, a voice onset time of about 60-70 ms. The tip of an
  English /t/ before a vowel is let go slowly: the closure is made where an
  [s] is, pressed past its channel, and opens into it, so that what is
  heard up to the voice is a short hiss at the ridge more than a breath of
  the glottis (English /t/ is often affricated: Buizza & Plug 2012). The
  tip sets out early enough for the channel to open when the release is
  due, whatever the jaw under it is doing. With an l, r,
  w or j after the stop in the same onset the open glottis lasts into it
  and the voice starts later still (longer before a sonorant: Klatt 1975):
  79 ms in "play", 86 ms in "tree", 10 ms in "splash". Italian ones
  (and English ones after /s/) are unaspirated: the folds part in the
  closure and are nearly together again, held stiff, when it opens, so
  little air follows the burst and the voice returns after a short lag,
  shortest for /p/ and longest behind the slower release of the tongue body
  for /k/ (12, 17 and 25 ms; Italian voiceless stops are short-lag, under
  about 30 ms, with /k/ the longest). A voiced stop slackens the walls
  behind its closure and makes room there (Westbury 1983), or the pressure
  would stop the voice within it: by his measurements and model, tense
  walls let the voice go on for about 10 ms of a closure, slack ones for
  80 ms or more, a cavity actively made larger almost indefinitely. The
  walls are let go as the mouth shuts, 30 ms before the closure is due,
  and held out until it has opened, 20 ms after the release (two closures
  on end are one): stiffened while the mouth was still shut, they gave
  the air they had taken back to the cavity, and the pressure stopped the
  voice right at the release. The room (`room` in the score, on a voiced
  closure that is not a tap) is made as the pressure calls for it: above
  half the lungs' pressure behind the closure the cavity grows, by up to
  300 cm³/s and 20 cm³ in all on the drawing's head, and once the
  pressure has fallen it is given back slowly (40 % of it is left 0.1 s
  after the release, 14 % after 0.2 s). Nothing in it is sudden (the
  leave to make room comes and goes within 10 ms, the making slows down
  over the last quarter of the room there is): the walls have mass, and
  would turn a jump of the flow into a jump of the pressure, and that
  into a knock at the release. A short closure makes no room and builds
  its pressure as before; a long one (76-104 ms shut in [ˈabːa ˈadːa
  ˈagːa]) keeps its voice, 0.48-0.49 of full at its end against 0.00-0.13
  without the room, with 3.7-7.6 cm³, and about twice that behind folds
  that leak. The rates and the sizes are chosen, not measured.
  A stop is shut when its sound is due. The lips shut some 40 ms after they
  set out, the tongue leaving an open vowel 70-80 ms after, with the jaw it
  rides on: set out a fixed time before its sound, the tongue shut some
  45 ms late, the closure lasted a few milliseconds, and the breath of a
  voiceless stop, whose folds parted on time, hissed through the passage
  still closing. The gesture sets out as much earlier as it would be late,
  measured on the engine's own dynamics (the slow articulators only: the tip
  and the lips are quick, and wait; the vowel before keeps its middle), and
  the folds part as the mouth shuts, not before. A fricative is as narrow as
  it is meant when its sound is due, by the same means: coming from an open
  vowel its channel was still closing through most of it, and a sibilant
  twice as wide as it is held has no hiss to speak of.
  An utterance has edges. The lungs wait for the first sound (they start
  some 30 ms before it, the time the pressure takes to rise; before a first
  stop without voice, once the mouth is shut): pushing from the start,
  while the mouth was still on its way from rest, they gave every word a
  short vowel of its own before it. Before a first sound without voice the
  folds are already apart. After a last sound without voice they stay
  apart, and the lungs stop with it (a last stop is let go on the air it
  holds): brought together again as before a vowel, the folds voiced the
  air that was left, and "tonight" ended in another short vowel.
  At a full stop a breath is taken. The lungs, which hold back in any
  pause, pull instead (3 cmH2O unless the voice says otherwise), the folds
  part wide, and the air is heard going in: the hiss of the glottis with
  the flow the other way, 39 dB below the loudest vowel of the sentence. It
  starts once the last sound has died away and is over in time for the
  folds to come together again, so in the 0.3 s of the usual pause it is a
  quick one, about 160 ms of air going in at up to 1.1 l/s; a longer pause
  gives a longer breath, a comma none. A tap is a ballistic
  raised-cosine flick of the tongue tip added on top of the smoothed posture
  (Recasens 1991); its height is computed from the tip's smoothed position,
  so it really closes against the ridge. It is one strike of 40 ms however
  long its time: its height is the way to the contact, looked for in the
  posture of that moment, and a quarter more, so that the tip is on the
  ridge for about 12 ms of it (chosen, not measured; 13 ms shut in "the
  city", and as many when the tap is given four times its time). Spread
  over the time a copy gave it, the flick held the tip on the ridge as
  long as a stop. A trill is aeroelastic (McGowan
  1992; Solé 2002): the tip, the lips or the dorsum becomes a mass on a
  spring (19, 18 and 21 Hz, lightly damped) held a little past its contact,
  and the air does the rest. Pressed on the contact, where the tissue is
  stiffer, and pushed off it by the air, it beats faster than its spring
  alone: the tip at 26 Hz, the rate of the contacts of an alveolar trill
  (Recasens 1991; Ladefoged & Maddieson 1996), the lips and the dorsum at
  about 30. Shut, the pressure builds up behind it and
  blows it open; open, the pressure falls, a little later than the passage
  opens, and the spring and the softer tissue in contact close it again. The
  lag of the pressure, set by the compliance of the walls, feeds the
  oscillation, as in the vocal folds, so a trill needs air: with the lungs
  at 8 cmH2O the long Italian /rː/ makes 3 contacts 38 ms apart, with almost
  no pressure only the one on its way, and a voiceless trill, with the
  glottis open, keeps going on less. The contact moves with the rest of the
  posture (a jaw still closing from the vowel before), so the engine reads
  where it is from the geometry: shut, it is at most where the articulator
  is; just open, the articulator is short of it by the passage it leaves.
  A fricative trill (Czech ř) opens between its contacts only into a
  fricative's channel, 0.19 cm² at its widest, and bounces off that limit
  back to its contact (an elastic stop: a damped one eats the energy that
  keeps it trilling): [ˈr̝eka] makes three contacts, [ˈtr̝̊i] two, and the
  hiss of its open phases is 24 dB above that of a plain r. After the last
  sound the mouth relaxes to rest, releasing a final stop. A drawn contour
  replaces the intonation.
- **A speaker's way of speaking** (src/dsp/speech/style.ts,
  src/dsp/voice/setting.ts): what makes one voice speak unlike another,
  beyond its body and its source, is part of the score, and none of it
  changes the speech planner's own defaults (tests/golden.test.ts keeps
  fingerprints of eleven scores and of every sound's posture).
  - *Prosodic style*: the pitch floor, the strength of the phrase commands,
    the downstep and its floor, the final fall, the rises of questions and of
    commas, the microprosody, the flutter, the pauses, the final lengthening,
    the fall of the lung pressure, the push of an accent, the way a phrase
    ends and how much all of it varies. A style can end its statements in creak (vocal fry): over the last
    stretch of the phrase the source makes slow, irregular pulses with
    alternate ones weaker, about seven semitones lower, pressed rather than
    breathy (fry is about 25-70 Hz: Hollien & Michel 1968); questions and
    commas never creak. Laryngealized sounds creak the same way.
  - *Articulatory setting* (Laver 1980; Honikman 1964): the posture kept
    beneath every sound. Offsets of the jaw, the tongue body and root, the
    lips and the larynx, a floor for the velum and one for the glottal
    opening. Vowels take all of it; a consonant keeps the articulators that
    make its constriction as they are and takes the larynx and the lips; the
    velum comes down only on vowels and sonorants, so an obstruent keeps its
    air. Before, a voice lost its low larynx or rounded lips as soon as it
    spoke, and a whispering voice fell nearly silent (its folds closed on
    every vowel); now its vowels are whispered, 24 dB above that.
  - *Precision* (Lindblom 1990): a crisp speaker's tongue body, jaw and lip
    rounding move faster, aim further past a short vowel, and the vowels
    spread out from schwa; a slack speaker's move slower and fall in toward
    it, the unstressed vowels most.
- **Target approximation** (Birkholz 2007; Prom-on, Xu & Thipakorn 2009):
  every articulator follows its targets through three identical first-order
  sections (critically damped, no overshoot), with articulator-specific time
  constants (tip faster than jaw).

### A voice as data

A voice (src/dsp/voice/design.ts) is the four layers of the phonetic
description of voice quality (Laver 1980; the Vocal Profile Analysis of
Laver, Wirz, Mackenzie & Hiller 1981): the body (the anatomy and the
teeth), the phonation (the fold model, its quality, irregularity, breath
and vibrato), the habits (the articulatory setting and the precision) and
the way of speaking (the usual pitch, the lung pressure, the accent
strength, the rate and the prosodic style). Every field has a range, a
unit, a step and an explanation in both languages; one table serves the
studio and the validation, which keeps only the fields it knows, each
within its range, so a file or a link can never carry anything else. The
speaker presets are built-in voices, checked against the presets they
were. A voice is saved as readable JSON (`.voice.json`, with its format
and version, so later versions can add fields) and travels as a link:
`#voice=v1.` followed by the fields that differ from a reference voice
frozen for that version, deflated and in base64url (80-181 characters for
the starting voices made by hand, 340 for the one fitted by measurement).
The fragment never leaves the browser, so a shared
voice needs no server. `utterance()` gives the engine parameters and the
score of a voice saying something: one turn of a dialogue.

### Analysis

- Spectrum: Hann-windowed FFT of the output. Predicted harmonics are the LF
  source harmonics times the reference filter |H(f)|.
- Spectrogram: 5 ms hop, window 3-80 ms. Log-mel: 80 triangular bands
  (HTK mel scale, mel = 2595 log10(1 + f/700)), 0-8 kHz, natural log.
- Microphone: LPC formants (autocorrelation, after decimation) and YIN pitch
  (de Cheveigné & Kawahara 2002), shown on the vowel map and spectrum.
- Voice print (`voicePrint`, what a voice is fitted to): every clip at
  24 kHz or below, 40 ms Hann frames every 10 ms; a frame more than 35 dB
  below the loudest (98th percentile) is silence. Pitch by YIN (60-500 Hz,
  confidence above 0.6, octave slips taken back to their stretch): median,
  5th and 95th percentiles in semitones from it, spread. On voiced frames
  the medians of H1-H2 (the peaks near f0 and 2 f0), of the cepstral peak
  (cepstrum of the dB spectrum, peak at 2-17 ms over its regression line
  at 1-20 ms) and of LPC formants (order 12 on a copy at about 11 kHz,
  bandwidths under 500 Hz, frames within 12 dB of the loudest), of
  H1-A1, H1-A2 and H1-A3 on the same frames (the peak within 10 % of f0
  over the strongest within 10, 8 and 6 % of each formant), and the
  voiced power in five bands from 50 Hz to 8 kHz against all of it; on
  unvoiced frames the hiss in 2-4, 4-8 and 8-10.5 kHz against the mean
  voiced frame. Pace: time speaking, syllable nuclei per second (peaks of
  the voiced energy at 0.3-2.5 kHz), mean pause (silences of 120 ms or
  more inside the speech).
- Fit (`fitVoice`): coordinate descent over a voice's fields, in stages
  (pitch, melody, body, folds, hiss, pace, a last pass): each field is
  tried a step up, then down, and kept where the distance falls, and the
  steps are halved after every round. The distance is the root mean
  square of the gaps between the two prints, each divided by about what
  the ear tells apart (0.3 semitone of pitch, 3-5 % of a formant, 1.5 dB
  of a band); a stage is judged on its own measures (the melody on the
  range of the pitch, the body on the formants and the bands, the folds
  on H1-H2, the cepstral peak, H1-A1, H1-A2, H1-A3 and the bands), the last
  pass on all of them. The bands alone could be matched with more breath
  as well as with a sharper closure; the harmonics at the formants tell
  the two apart, and the return phase is one of the fields of the folds.
  The usual pitch is set by the ratio of the medians
  at the start and after the melody and the last pass. With the
  recording's text the voice says the same words, else a passage of two
  or three sentences. The rendering is at 24 kHz or the recording's rate,
  whichever is lower. Tried on five voices of a neural text-to-speech
  system trained on recordings (two American women, an American man, an
  Italian woman and an Italian man, each saying sentences of its language
  for 10-12 s, with their texts): the distance from the nearest starting
  voice, 2.25-2.75, fell to 1.00-1.55 in 99-110 renderings, 3.5-6 minutes
  in the container (five at once); the Sky-like voice, fitted by hand to
  one of them, stands at 2.14 from it. The range of the pitch below and
  above its median comes within 1 semitone (but for the widest melody,
  2.3 short below its median), the formants within 5 % but for five (the
  first of three voices, 7 % high; the third of the Italian man and the
  fourth of the Italian woman, 6 %), the time speaking within 4 %. The
  starting voices were duller than the recordings, H1-A3 1.5-4.4 dB
  higher; fitted, H1-A2 is within 1 dB and H1-A3 within 2.3 but for the
  American man (2.5 dB lower and 4.7 higher: brighter in the middle,
  duller above), with return phases of 0.7-1.1. What stays: the folds of
  the simulator are more regular (cepstral peak 0.3-0.6 dB higher) with a
  smaller H1-H2 (0-4.9 dB), and the band at 0.5-1 kHz is 2-3.7 dB off in
  four of the five. The fit raises the glottal hiss by 8 dB in all five,
  and the chink: they are what makes the voice less periodic (a jitter of
  1.5 % and a shimmer of 5 % lower the cepstral peak by 0.08 dB), so it
  buys the cepstral peak with breath.
- Copy synthesis (`src/dsp/voice/copy.ts`, `scripts/copy-test.ts`): a
  recording's timing, melody and loudness put on a voice of the simulator
  saying the same text, to hear how much of a voice that sounds alive is
  in its prosody and how much in its sound. Our saying and the recording
  are aligned by dynamic time warping of their cepstra (25 ms frames
  every 10 ms, 26 mel bands from 100 Hz to 7.6 kHz, c1-c12, the mean of
  the speech removed; symmetric steps within a band about the diagonal,
  the path smoothed over 70 ms). Each sound of ours is then given the
  length of the stretch of the recording the path gives it (within 40 %
  and three times its own, never under 20 ms, what one cannot take passed
  to the next), each pause the recording's, and a silence of the
  recording of 150 ms or more inside one of our words becomes a pause at
  its end, aligned again; the planner plans the saying again on those
  lengths (the score option `timing`, three rounds), so that every
  gesture is made whole, and the score starts where the recording does.
  A recording that comes with the times of its sounds (a `.phones.json`
  next to it, as a synthesizer that reports them or a labelled corpus
  gives) is copied by them instead (`copyTimingSaid`; `--dtw` lines the
  two signals up all the same): two signals slip where the two say a
  sound differently, and a double consonant came out single (the /t/ of
  "stanotte" 60 ms long for the recording's 215), a word in a hurry
  behind a pause that was not there ("heard": 56 ms of vowel and a tap,
  for 225 ms and a /d/). The labels are first put on the recording's
  clock (they trail its sounds by 25-55 ms on the reference voices: the
  shift within 120 ms that best puts the voiceless sounds on frames
  without a voice, the vowels and the sonorants on frames with one), then
  matched with ours letter by letter. Each sound of ours takes the time
  of its partners and of the sounds about them that we do not say (no
  shorter than 40 % of ours nor than 20 ms, no longer than six times),
  each pause the gap between the two sounds about it. Times that leave
  no gaps fold the pauses into the sounds: a silence of 150 ms in the
  time of the last sound of a word becomes a pause, unless it is the
  closure of a voiceless stop. Our own sounds are planned as much earlier
  as they come after their plan (up to 20 ms), so that the two are heard
  together.
  Its pitch is replaced by the recording's (gliding in log across the
  voiceless stretches). YIN finds a period in breath, creak and
  near-silence too, and the copy followed it an octave or two up for a
  few frames (a creaky /e/ in "e il mare", a whisper before "ever"): so
  a frame more than 30 dB below the loudest counts as voiceless, an
  octave slip is taken back to the median of the voiced frames within
  100 ms, a frame still more than half an octave off it or an octave off
  the median of the whole saying counts as voiceless, and so does a run
  of fewer than three voiced frames. Its lung pressure is multiplied by
  the slow swell of the gap between the two loudnesses (voiced frames, about 100 ms,
  within 8 dB, 9.6 dB for each doubling of the pressure, as a held vowel;
  twice). Pitch and pressure are given three time constants early, the
  lag of the engine's smoothing (18 and 60 ms). The script writes, for
  each sentence, the recording, our saying by the rules, the same living,
  and the copies of timing, of timing and melody, and of all three, with
  a page that plays them side by side. On the five reference voices (15
  sentences, copied by the times of their sounds) the copies lie a median
  18-48 ms from the recording (as the two signals line up), against
  48-307 ms by our rules, the pitch 0.21-0.30 semitone off (jitter and
  flutter included), the swell of the loudness 0.5-1.7 dB rms off against
  2.3-3.8.
- Cross-synthesis (`crossSynth`, `scripts/copy-test.ts --cross`): the
  fine structure of one saying (its linear-prediction residual: the
  pulses of the folds, their irregularity, the breath and the noise of
  the consonants) through the spectral envelope of another (formants and
  tilt), on the same timing. Every 5 ms a predictor of order 4 + fs/1 kHz
  is fitted on 25 ms (Hann, pre-emphasis 0.97) of each; the first is
  inverse filtered with its own, brought to the level of the second's
  own residual (gliding over the 5 ms) and filtered by the second's. On
  our copy and the recording it tells whether what sounds mechanical in
  ours is in the source or in the mouth: the page plays the recording,
  our copy, our fine structure through their envelope, and the same only
  in some stretches, our copy as it is elsewhere (`where`). A crossing by
  stretches fades between the two over 20 ms and brings our copy to the
  crossing's level: switching the predictor itself from one frame to the
  next rang, up to 20 dB above both. By ear, their envelope
  only in the passages (25 ms either side of each edge between two sounds,
  56 % of the speech) came closest to their envelope everywhere; only in
  the middle of the vowels, of the consonants, or in the consonants and the
  passages, less; of the passages, those of the nasals, liquids and
  fricatives (36 % of the speech) more than those next to a stop or an
  affricate (20 %), and our copy in a small room (a tail of dark noise
  dying by 60 dB in 0.3 s, 25 dB below the voice: chosen, not measured, so
  that the quietest 20 ms of a closure fall to the recordings', 38 dB below
  the vowels against 40) next. Our copy with the jet on the teeth heard
  only in the sibilants (s z ʃ ʒ and the affricates; elsewhere the same
  score rendered without that source) was clearly better again: the
  shrill noises between them were the teeth's, and the model now aims the
  jet (see the obstacle source). The page plays the recording, a column
  of the time before (`--before`, its files kept), our copy with the
  model as it is, the same with a sharper closure of the folds (return
  phase 0.55) and with the glottal hiss at its default level (the fit
  raises it by 8 dB), and their envelope only in the passages of the
  nasals, liquids and fricatives; `--columns` writes only some of them.
  A crossing is a patchwork of two voices: it shows where the difference
  lies, and cannot be judged as our voice.
- Envelope report (`scripts/envelope-report.ts`): on the voiced frames
  where a copy and its recording are both loud, the formants and their
  LPC bandwidths, the balance of five bands and how fast the envelope
  moves (the distance of the cepstra from one 10 ms frame to the next),
  also split into its tilt (c1-c2) and the shape of the formants
  (c3-c12) and by where it is (the middle of a vowel, of a consonant,
  25 ms about an edge), and how far F1 and F2 move between 20 and 80 % of
  each vowel. On the 15 sentences of the five reference voices our
  copies have the formants where the recordings have them (within 2 %),
  their bandwidths 13-25 % wider, 1-3 dB less above 1 kHz, and an
  envelope that moves a quarter less (a third less inside the vowels,
  41 % less inside the voiced consonants, a fifth less about the edges);
  their F1 moves 12 % inside a vowel where the recordings' moves 22 %.
  Crossed, our fine structure through their envelope moves as theirs
  does (9.9 against 10.4). Neither the living mouth, nor articulators
  quicker or a jaw slower, nor tenser folds or smaller losses close the
  gap in movement (the tenser folds and the smaller losses close those
  of the bands and the bandwidths).
- Consonant report (`scripts/consonant-report.ts`): on the same files,
  the middle half of each sound (its level below the vowels of its
  sentence and the balance of six bands, by kind), how deep a stop's
  closure goes (its quietest 20 ms, whatever the alignment), the floor
  before the speech, the spectrum of /s z ʃ/ from 1 to 12 kHz, and the
  passages between a consonant and a vowel (with the cepstra, how long the
  envelope takes from 20 to 80 % of the way between the middle of the one
  and of the other, and when it is half-way). On the 15 sentences,
  measured against the neural voices: the closure of a voiceless stop
  goes down to 84 dB below the vowels in ours and to 40 dB in theirs
  (unvoiced, above their floor of 52 dB; ours is digital zero), that of a
  voiced stop to 24 against 12; our /s/ and /z/ have 8-11 dB too much
  between 1.6 and 5 kHz
  (a broad hiss where theirs rises sharply above 5 kHz); the passages
  take about as long on the whole (23-29 ms against 21-28), but ours leave
  a nasal or a stop for the vowel slower (32-35 ms against 16-27). The
  hiss, the band from 3 to 12 kHz every 5 ms, is more than 6 dB louder in
  ours in a fifth of the vowel frames and in a third of those at the edges
  of a consonant: most often in /ɝ/ (half of its frames), at an /h/ before
  a vowel (20 dB louder, median), about /t d/ and in the pauses. Rendered
  with the noise sources one at a time switched off, it is the jet on the
  teeth: heard only in the sibilants, the share falls to 14 % of the vowel
  frames and 23 % of the edges, and /ɝ/ to the recordings' level (0 dB,
  median), /h/ to 12 dB louder. With the jet aimed (see the obstacle
  source) and the voices fitted again, the vowels' hiss is 2 dB below the
  recordings' (median) and 18 % of their frames are more than 6 dB louder,
  /ɝ/ at their level; what stays louder is the edge of a /t/ or a /d/
  (12-15 dB in English, 6-15 in Italian, median, against 4-7 with the
  teeth heard only in the sibilants): the teeth still catch the jet of a
  tip of the tongue letting go of the ridge, as the measured hiss of an
  English /t/ asks, and catch more of it than the recordings show. The
  same holds where a stop or a tap ends a word before a pause ("heard,"):
  its closure, made before the lungs let go, bursts on the teeth into the
  silence.

## Main parameters

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| F0 | 120 Hz | 40-900 | fundamental frequency |
| lung pressure | 8 cmH2O | 0-20 | drives flow, loudness and noise |
| Rd | 1.0 | 0.3-2.7 | LF shape: pressed to breathy |
| peak glottal area | 0.12 cm² | | sets the pulse amplitude |
| chink | 0.01 cm² | 0-0.2 | posterior leak, breathiness |
| abduction | 0 | 0-1 | open glottis (h, voiceless consonants, breathing) |
| source-tract interaction | 0.6 | 0-1 | glottal loading of the tract |
| two-mass tension Q / asymmetry | auto / 0 | | pitch and raspiness |
| jitter / shimmer | 0.4 % / 2 % | | cycle-to-cycle perturbation |
| size (scale) | 1 | 0.62-1.18 | 1 = adult male, about 17.5 cm |
| slit width | 22 mm | | lateral width of the incisal slit |
| losses | 1 | 0.3-3 | multiplier of the waveguide losses |
| noise trims | 0 dB | | per source |

## Validation

`npm run validate` (or `npm test`) reproduces these numbers. Formant targets
in brackets are the adult male targets described under Speech.

| Check | Result |
|---|---|
| Uniform 17.5 cm tube, lossless, ideal open end | 500.0 / 1500.0 / 2500.0 Hz (theory 500 / 1500 / 2500) |
| Same tube, lossy + piston radiation | 525 (B 27) / 1451 (B 32) / 2406 (B 63) / 3370 (B 100) Hz |
| Real-time waveguide on the same tube | 531 / 1453 / 2406 / 3370 Hz |
| Waveguide vs reference, /i/ | 284 / 2191 / 2994 vs 287 / 2192 / 2994 Hz |
| Waveguide vs reference, /a/ | 726 / 1294 / 2593 vs 729 / 1298 / 2594 Hz |
| Waveguide vs reference, /u/ | 314 / 872 / 2245 vs 311 / 874 / 2245 Hz |
| Waveguide vs reference, /ɛ/ /o/ | 529 / 1825 / 2412 and 480 / 896 / 2456 Hz (ref 532 / 1826 / 2415 and 478 / 898 / 2456) |
| Waveguide vs reference, laterals | /l/ and /ɫ/: every peak and valley below 4.5 kHz that stands out by 3 dB or more, the supralingual cavity's and the fossae's included: worst difference 1.0 % |
| Waveguide vs reference, MRI shapes | worst F1-F3 difference 0.9 % over the 11 measured vowels |
| MRI areas, frequency model | mean difference from the formants Story (2008) computed from the same areas: F1 5.6 %, F2 2.3 %, F3 0.8 % |
| Vowel shapes vs MRI | log-area distance mean 0.60, worst /ɔ/ 0.79 (the drawing's own vowels: 0.98); no vowel narrower than the measured one |
| Vowels F1 / F2 (target) | i 287 / 2192 (270 / 2290), ɪ 395 / 1972 (390 / 1990), e 445 / 2028 (440 / 2050), ɛ 532 / 1826 (530 / 1840), æ 646 / 1661 (660 / 1720), a 729 / 1298 (740 / 1300), ɑ 704 / 1106 (730 / 1090), ɔ 551 / 869 (570 / 840), o 478 / 898 (470 / 900), ʊ 444 / 1007 (440 / 1020), u 311 / 874 (300 / 870), ʌ 636 / 1191 (640 / 1190), ə 501 / 1496 (500 / 1500) |
| Flat passages | a 1 mm high oral section has 1.9 times the wall of a round duct of the same area; three times the wall widens B1 of a 17.5 cm tube from 27 to 40 Hz |
| Yielding walls | /i/: 50 % of the wall under the hard palate yields (the tongue), 100 % in the pharynx, none at the incisal slit (8.1 cm of bone) |
| Closed tract | a tube 17 cm long and 1 cm in radius, shut at both ends: frequency model 225 Hz, 103 Hz wide, 4.0 MPa s/m³; waveguide 232 Hz, 110 Hz wide, 3.7 MPa s/m³; measured through sealed lips on men 210 ± 55 Hz, 105 ± 30 Hz, 3.9 ± 1.0 MPa s/m³ (Hanna et al. 2016) |
| Bandwidths, glottis closed | waveguide, radiation included (frequency model in brackets): uniform tube 54 (27), 58 (32), 85 (63) Hz at 525, 1451, 2406 Hz; /u/ 103 (73) Hz at 311 Hz, 81 (46) at 874 Hz; /i/ 88 (59) Hz at 287 Hz |
| Piriform fossae | antiresonance /a/ 4490 Hz (-27 dB), /i/ 4470 Hz (-23 dB), /u/ 4470 Hz (-26 dB), /ə/ 4480 Hz (-26 dB) (4-5 kHz, Dang & Honda 1997); half filled with water, /a/ 7970 Hz |
| Laterals | /l/: channels 0.52 cm² beside the contact, supralingual cavity 2.5 cm, antiresonance 3490 Hz (-22 dB); /ɫ/: 0.52 cm², 3.4 cm, 3960 Hz (-42 dB) (Zhang & Espy-Wilson 2004: cavity 3.1 cm, antiresonance between F3 and F4) |
| Geometry cost | geometry, 3D sections and area function 0.08-0.12 ms per update, at most one every 2.7 ms |
| 3D view | the cross-sections it draws (a i u l) have the areas of the acoustic model within 0.1 % |
| F1 vs tract length (uniform) | 12 cm 729 Hz, 14.5 cm 603 Hz, 17.5 cm 500 Hz, 20 cm 438 Hz (1/L) |
| /a/ scaled to 0.75 | F2 ratio 1.329 (ideal 1.333) |
| LF spectral slope, Rd 1, 1-5 kHz | -11.8 dB/oct (flow derivative), -17.9 dB/oct (flow) |
| LF H1-H2 | Rd 0.5: -2.0 dB, Rd 1: 3.8 dB, Rd 2.5: 17.5 dB (pressed to breathy) |
| Two-mass F0 vs tension | Q 0.7: 88 Hz, Q 1.2: 166 Hz, Q 1.8: 241 Hz; automatic tension within 4 % of the target |
| /s/ | peak 4875 Hz, centroid 6250 Hz, -14.3 dB re /a/ (male /s/: peak 4-5 kHz, mean 5-6 kHz, Jongman et al. 2000) |
| /ʃ/ | peak 3797 Hz, centroid 3832 Hz, 0.7-1.8 kHz band 6.9 dB below the 2-3.5 kHz band, -6.6 dB re /a/ (7.7 dB louder than /s/; Jongman et al. 2000: peak about 3-4 kHz, mean 4.2 kHz, lower for men) |
| Fricative spectrum, waveguide vs reference | /ʃ/ obstacle source: worst difference 0.9 dB over 8 bands, 0.5-8 kHz |
| Jet losses | the sharpest resonance below 4 kHz widens 4.4 times in /ʃ/ (600 cm³/s), 1.09 times in /i/ (150 cm³/s) |
| /f/ | centroid 7456 Hz, flat (2-10 kHz spread 9.7 dB vs 11.6 dB for /s/), -22.2 dB re /a/, -7.9 dB re /s/ |
| Teeth | opening the incisal slit by 6 mm lowers /s/ in 4-10 kHz by 15.8 dB |
| Breathiness | HF/LF ratio +10.1 dB with a 0.12 cm² chink and Rd 2.2 |
| Aspiration | F0 envelope modulation depth: steady 0.109, pulsed 0.369 |
| High frequencies | third-octave levels against those Monson, Lotto & Story (2012) measured on axis, in dB: the long-term spectrum of three sentences said by the man, re 1 kHz, against that of normal speech: -1.9 at 10 kHz, +4.1 at 12.7, +2.6 at 16, -6.7 at 20; held /s/, re 8 kHz: -2.7, -1.1, -0.2, -4.0 (before the losses above the plane waves: speech -1.6, +8.2, +17.5, +20.0; /s/ -2.4, +2.6, +17.1, +22.5) |
| Glottal noise source | corner at 2.5 kHz, against 1 kHz: -2.9 dB at 2 kHz, -12.3 at 5 kHz, -22.6 at 10 kHz (the source of turbulence noise, Stevens 1989: -4, -14, -26; the jets of the mouth, with one pole: -1.4, -6.1, -11.3) |
| Breath of an aspirated stop | "park" as an English speaker says it, from 14 ms after /p/ is let go to the voice (41 ms): 8 % of it above 6 kHz, 8-16 kHz 12.6 dB below 1-3 kHz (56 % and 0.5 dB above with a source falling half as fast) |
| Period boundaries | jitter 1 % and shimmer 6 % change the 8-16 kHz energy by +0.1 dB (+32 dB when the pulse mean jumped at each period) |
| Control rate | voice onset from rest: 3-8 kHz at -44.3 dB re 0-1 kHz (-6.5 dB with stepped control values) |
| User pink noise | -2.99 dB/oct (theory -3.01) |
| "sasso" | geminate /sː/ 187 ms vs single /s/ 107 ms; HF/LF +15.1 dB in /sː/ vs -42.9 dB in /a/ |
| "mamma" | nasal murmur 800-3000 / 80-400 Hz balance -38.5 dB vs -9.8 dB in the vowel |
| Nasal murmur, waveguide vs reference | lowest resonance with the same damping /m/ 310 vs 311, /n/ 322 vs 324, /ŋ/ 312 vs 312 Hz (312, 329, 320 Hz with the waveguide's tenfold nasal damping; 392-416 Hz in the reference while it gave the nose soft walls) |
| Nasal cycle | /m/ with one passage congested (cycle 0.6): a new resonance at 2170 Hz with its antiresonance; first resonance 280 -> 270 Hz |
| Pinched nostril | /m/ with the left nostril pinched: first resonance 310 -> 240 Hz, new antiresonance at 550 Hz |
| Asymmetric nose, waveguide vs reference | congested left side, right nostril 40 % open, lossless: worst difference 0.34 % over 6 resonances below 3 kHz |
| No clicks in running speech | "la luna e le stelle", with the piriform junction moving twice: loudest transient inside a vowel or sonorant, above 6 kHz, against the 40 ms around it +16 dB (+41 when a move zeroed the branch). Millisecond by millisecond, "la luna è piena stanotte." has 7 ms that stand 15 dB out of the 20 ms around them and "where did you put the keys?" 4 (the closures of the folds, which come back a period before and a period after, or a period and two before where the voice fades into a narrower sound, are the voice and are not counted): all at the edges of the stops (where the mouth shuts and opens, or where the time of a stop that the glottis held ends), none inside a vowel, none sharp inside a closure (before: +41 dB inside the closure of a /d/, +28 dB between /u/ and /n/, +21 dB inside the /ɪ/ of "did") |
| Stops on time | the mouth shut against the plan, and for how long: "la luna è piena stanotte." p +16 ms (56 of 89 ms), t -3 (63 of 79), t +16 (127 of 157); "where did you put the keys?" d +4 (50 of 68), d +12 (43 of 65), p -6 (80 of 93), k +19 (47 of 140, the rest its aspiration); no breath before the closure of a voiceless stop (the tongue after an open vowel shut some 45 ms late before) |
| Room behind a voiced closure | [ˈabːa ˈadːa ˈagːa], shut 103, 76 and 104 ms: the voice at the end of the closure 0.48, 0.49, 0.48 of full, with 0.54 of the lungs' pressure behind it and 6.3, 3.7, 7.6 cm³ of room made (0.02, 0.13, 0.00 and 0.79, 0.72, 0.82 without the room); largest rise of the pressure in 1 ms 0.93, 0.24, 0.16 cmH2O (2.20, 0.24, 3.31 without), the highest sample after the release within 1 % of the one without; of the 6.3 cm³ of [ˈabːa], 2.5 and 0.9 are left 0.1 and 0.2 s after the release; [ˈabːabːa] 0.50 and 0.45 at the end of its two closures (0.04, 0.03 without); behind folds that leak (a chink of 0.04 cm²) 0.46-0.47 with 12.7, 8.6, 14.9 cm³ (0.00 without) |
| Tap | the tap of "the city": shut 13 ms in its 20 ms, and 13 ms when given 80 ms |
| Edges of a word | as the studio plays it, against the loudest of the word: "tonight" -49 dB before its first sound, the folds at 0.12 of their swing after its last, -42 dB 60 ms on; "this" -52 dB, 0.03, -26 dB; "stop" -43 dB, 0.14, -43 dB (before: 45 ms of full voice ahead of the first /t/ of "tonight", and a breathy vowel of 100 ms and more after its last) |
| Breath at a full stop | "la luna è piena. Stanotte la vedo.", a pause of 300 ms: the lungs pull down to -2.8 cmH2O and 1098 cm³/s go in, for 161 ms; its hiss 39 dB below the loudest vowel of the sentence before (83 dB below with no breath taken; 27 dB while the air going in hissed on the teeth too, which it cannot); the loudest millisecond of the pause 20 dB above its median one and 30 dB below that vowel; no air goes in at a comma |
| Airways below a wide glottis | the flow is the airways' (1.5 cmH2O per l/s) below 1.21 cmH2O with the glottis wide open (0.56 cm²), 0.35 cmH2O at 0.3 cm², 0.010 cmH2O for the glottis of a voice (0.05 cm²) |
| Sibilant in a sentence | the /s/ of "stanotte": narrower than 0.2 cm² 5 ms into its sound, the teeth sounding through 75 % of it; the releases of the two /t/ 2.1 and 3.6 dB below its hiss |
| Bursts | RMS of 10 ms at the burst less 30 ms at the start of the vowel, as Nicolaidis et al. (2019) measured Greek /p t k/ (theirs in brackets): "la pata" -15.3 dB (-11.2), "la pita" -11.7 (-11.0), "la tata" -15.3 (-10.7), "la tita" -17.0 (-13.0), "la cata" -19.1 (-5.9), "la chita" -15.4 (-11.1); the voice starts after 10, 5, 19, 15, 27 and 25 ms (16, 14, 12, 23, 30, 63); without the pop of the air let out the burst of /p/ loses 2.0 dB, that of /t/ 0.9 dB: it is mostly a hiss |
| Fricated release | every /t/ as the studio plays it, from the moment it is let go: when the voice begins, for how long the noise stays within 10 dB of the start of the vowel, how much of it lies below 3 kHz, and by how much its first 15 ms stand over the rest. "tattoo" in English 46 ms, 9 ms, 6 %, +2.8 dB and 82 ms, 64 ms, 6 %, -1.6 dB; "tea" 77 ms, 60 ms, 5 %, +0.2 dB; in Italian 20 ms, 4 ms, 50 % and 17 ms, 3 ms, 70 %; "ti" 16 ms, 3 ms, 76 % (let go at once with the folds apart, the English ones had 46 and 26 % below 3 kHz and a first stage 9.6 and 15.4 dB over the rest) |
| A tip that leaves its closure | the pressure behind a /t/ or a /d/ 10 and 20 ms after its release, against the one at the release: the man's "la dita" 11 and 5 %, "la tita" 5 and 3 %, "la data" 12 and 2 %; the woman's 10 and 5 %, 5 and 3 %, 12 and 2 % (through the narrow channel alone "la dita" kept 40 and 28 %, "la tita" 30 and 21 %, "la data" as now) |
| Place of a velar | front edge of the contact when the stop is let go: 6.9 cm from the lips before /i/, 7.8 before /a/, 8.0 before /u/, 9.0 before /o/; /t/ 3.9 before /i/, 4.4 before /o/ |
| Speaking rate | the whole lasts 1/rate of what it lasts at the usual rate, from 0.6 to 2.5 times (Italian within 1 %; English, whose aspiration follows the root of the rate, within 15 %); between a slow rate (0.9) and a fast one (1.15): Italian vowels 0.74 and stops 0.83 of their duration, English 0.72 and 0.83 (speakers 0.75 and 0.9, Gay 1978; 0.74 and 0.8, Port 1981); slower than usual (0.9): vowels +14 % and stops +9 %, English +15 % and +8 %; from 2 to 2.5 times vowels and stops both 0.80 |
| Unstressed /a/ | /tatata/: F1 728 Hz stressed (156 ms, jaw 0.88); 583 Hz before the stress (77 ms, jaw 0.38), 20 % below; 544 Hz after it, 25 % below; 728 Hz at the end of the word (speakers 18 % and 28 % below, the last of the word open again: Farnetani & Vayra 1991); /i/ and /u/ the same stressed or not |
| Motion of the tube | a section follows the measures of its shape with a speed that changes, from one sample to the next, 450 times less than if it ran to each measure and stopped there; it lands on a closure with no speed left; a steady flow through a narrowing that comes and goes in 20 ms: the sharpest sample of the flow at the lips 74 dB below the swing the gesture makes |
| Pinched nose | held /m/: nasal airflow 231 -> 0 cm³/s, mouth pressure 8.0 cmH2O (the lung pressure), the hum silent |
| Italian G2P | sasso, mamma, voce, rosa (northern /z/), gnocchi, figlio (long ʎ), scena, chiesa, città; IPA parsing |
| English G2P | 89 321-word lexicon; voice v ɔɪ s, water w ɔ ɾ ɚ, little l ɪ ɾ ə ɫ, 1984 "nineteen eighty four", blick (rules) b l ɪ k; weak forms; wh-questions marked |
| American linking | it is ɪ ɾ ɪ z, get up g ɛ ɾ ʌ p, just two dʒ ʌ s t u; oral pressure behind the /t/ of "it rains" 0.7 cmH2O (glottal stop, no puff) vs 6.4 cmH2O in "it." |
| American r | /ɹ/ 411 / 1103 / 1596 Hz, /ɝ/ 482 / 1315 / 1741 Hz (Peterson & Barney /ɝ/ 490 / 1350 / 1690), narrowest passage 0.3 cm² (no hiss) |
| Dark l | F2 clear /l/ 1506 Hz, dark /ɫ/ 937 Hz |
| Klatt durations | /i/ in bead 223 ms vs beat 153 ms; "heed heed heed": first 121 ms, last 223 ms |
| Italian durations | stressed /a/ in fato 156 ms vs fatto 104 ms |
| Voice onset time | /t/ English 64 ms, after /s/ 20 ms; Italian /p t k/ 12 / 17 / 25 ms (Lisker & Abramson: English /t/ about 70 ms, range 30-105; Italian voiceless stops short-lag, under about 30 ms, /k/ longest) |
| Trill and tap | tongue-tip closures: "carro" 3, "caro" 1 |
| Consonant dips | nasals 5.9-13.4 dB, /v/ 10.9-18.8 dB below their vowels (natural speech: nasals 6-12 dB, voiced fricatives 12-20 dB) ("la mamma vuole la nonna e il vino", "Every voice you have ever heard is raining in."); no complete closure in /v w l/, the narrowest /v/ 0.08 cm² (0.03 before the lip could slide out from under the teeth); /ŋ/ in front of the nasal port in every vowel context |
| Vowels in running speech | 15 English and Italian sentences, each vowel in its middle against the same vowel held: front vowels F2 99 % on average, 97 % at the 10th percentile; F3 of non-rhotic vowels 2353 Hz at the 10th percentile, 8.6 % of them 150 Hz below their own (after /ɹ/, before /l/); tip 0.26 at the 90th percentile; F1 98 %; tongue body 0.04 from its target; nasal port 0.008 cm² at most away from nasals, 0.05 cm² on average next to one |
| Fujisaki intonation | final F0: statement 106 Hz, wh-question 101 Hz, yes/no question 180 Hz (base 120 Hz) |
| Melody | "Every voice you have ever heard is made of just two ingredients.": planned F0 range 10.2 st; the voice follows the plan within 0.74 st (90 %), 1.9 st with the slider smoothing |
| Log-mel | 80 bands; a 1 kHz tone lands in band 25-29 |
| IPA places | narrowest passage, cm from the lips: stops p 1.8, t 4.3, ʈ 4.8, c 6.8, k 9.6, q 12.3, ʡ 16.7; fricatives ɸ 0.4, ɕ 3.2, ʂ 4.7, ç 5.6, x 9.0, χ 11.5, ħ 12.3 |
| IPA degrees | derived stops and nasals closed; fricatives 0.06-0.14 cm²; approximants 0.25-0.4 cm² |
| Derived vowels | y 265/1869/2395, ø 402/1534/2191, œ 502/1626/2087, ɯ 344/1403/2237, ɨ 404/1679/2306 Hz: rounding lowers F2 and F3 of the front vowels, unrounding raises F2 of the back ones |
| Czech ř | laminal, its narrowest passage in front of /r/'s; contacts in [ˈr̝eka] 3, in [ˈtr̝̊i] 2; open phases at most 0.16 cm², their hiss 27 dB above /r/'s |
| Dentals | t̪ d̪ n̪ closed 2.4 cm in front of /t/, with no note |
| Stops close | "papa tata kaka gaga": every closure builds its pressure (/g/ after /a/ did not close before) |
| Head shapes | 120 sounds on 13 heads (vault 0.6 and 1.45, arch 0.8 and 1.25, pharynx 0.7 and 1.4, tongue 0.92 and 1.08, frenulum 0.6, mouth 0.8 and 1.2, lips 0.7 and 1.4): every stop, nasal and click closes, every other consonant keeps its passage within 0.8-1.15, no vowel narrows below 0.25 cm²; only the laterals closed by the dorsum (ʎ ʟ) under the lowest vault or the biggest tongue are approximate. On a vault of 0.6 "kaka gaga tata cece" builds 51-100 % of the lungs' pressure behind each closure |
| Vowels that let the air through | of 35 vowels, narrower than they need as their posture leaves them: 15 on a head 0.83 of the drawing's (the narrowest 0.81 of what it needs), 14 with the tongue kept back by 0.08 as well (0.35), 6 with that tongue on the drawing's head (0.51); none as the voice says them. The r-coloured vowels of "ever heard" under a low palate, on two heads: passage 0.23 cm², voice 0.90-0.98 of full, 0.07-0.14 of the lungs' pressure behind it |
| Palate and arch | F2 of /i/ 2192 Hz: 2036 with a vault of 1.3, 2258 with 0.7; 2140 with an arch of 1.2, 2237 with 0.85 |
| Language prosody | unstressed against stressed vowels: German 0.46, Spanish 0.78, Japanese 1.00; a long vowel in Japanese 2.0 times a short one (Spanish 1.7); the same four words, Spanish accents the first 4.5 st above French, which accents only the last (3.7 st above the one before); a yes/no question: Spanish rises to the end (112 -> 163 Hz), Hungarian and Greek peak on the last stress and fall (152 -> 98 Hz) |
| Falsetto | 300 Hz, fold thickness 1 -> 0.3: LF H1-H2 4.0 -> 13.7 dB, H1 over the harmonic near 3 kHz 35.3 -> 54.4 dB, 8.3 dB weaker; two-mass still at 300 Hz, H1-H2 9.0 -> 19.5 dB, slope 25.4 -> 47.8 dB |
| Fold length | folds 0.7 as long open a glottis 0.70 as wide at its peak; two-mass folds 0.6 as long still follow a 220 Hz target (220 Hz) |
| Lips | F2 of /u/ 874 Hz: 817 with lips 1.4 times as thick (the tract 0.7 cm longer), 931 with 0.7; 899 with a mouth 1.2 times as wide, 852 with 0.8 |
| Tongue | F2 of /a/ 1298 Hz: 1228 with a tongue of 1.08, 1412 with 0.92; with a frenulum of 0.6 /t d n/ close with the jaw raised and the tip of /r/ no longer reaches its contact |
| Speaking habits | a setting with a low larynx and rounded lips keeps both through every sound; a nasal one never lowers the velum on an obstruent; a whispering voice speaks its vowels 24 dB above the near silence it had; with every habit at its extreme /p t k/ still close |
| Trills | closures of the lips in [aʙa] 3, of the dorsum against the uvula in [aʀa] 3, of the tip in [ara] 1 |
| Velar lateral | ʟ: midline closed by the dorsum, lateral channels over 10 grid lines, 7.0-9.6 cm from the lips; /l/ F3 still 2421 Hz |
| Uvular nasal | murmur against the vowel: [ŋ] -5.7 dB, [ɴ] -5.9 dB (-19.3 dB with the nose joined at the velum, in front of the closure) |
| Walls heard | quietest 10 ms of a closure against its vowel: /b/ -25, /d/ -24, /g/ -26 dB, a hum centred at 148 Hz (-101 dB with the walls unheard); /p/ -83 dB; held against /a/: /i/ -4.2 dB, /u/ -8.3 dB (-13.2 unheard), /m/ -7.4 dB |
| Epilarynx | narrowest section of the tube above the folds 0.43 cm² at rest, 0.19 with the sphincter at 0.5, shut at 1; at 0.5 the band 2.4-3.6 kHz rises against the first formant's by 3.9 dB (/a/), 4.6 (/i/), 8.9 (/u/) in the transfer function and by 2.8 dB in a held /a/ |
| Subglottal resonances | trachea (2.54 cm², 12 cm) and 2, 4, 8 bronchi (3.14, 3.42, 3.89 cm² over 4.4, 1.9, 1.2 cm), 19.5 cm in all: 523 (B 31), 1324 (B 36), 2195 (B 61) Hz, against 554 ± 42, 1327 ± 77, 2179 ± 126 Hz measured on men (Lulich et al. 2012); with rigid walls the first at 469 Hz; 0.87 times the size: 601, 1522, 2523 Hz (women 660 ± 47, 1513 ± 69, 2426 ± 101) |
| Subglottal impedance | the tube at its closed end: 291, 222 and 153 dyn s/cm⁵ at the three peaks; the resonances the engine keeps are within 0.1 dB of it there, within 1.5 dB half a width to either side |
| Subglottal resonances in the voice | held /a/, harmonics at 480, 1320, 2160 Hz, with the airways below against without: folds apart -3.3, -2.6, -2.6 dB (away from them -0.2, -0.2 dB); modal -0.3, -2.1, -0.9 dB; the level changes by 0.2 dB; two-mass folds -0.2 dB |
| Epiglottals | ʡ shut 16.7 cm from the lips, its closure 58 dB below the vowel in [ˈaʡa]; ʜ 0.10 cm² at 16.5 cm (ħ at 12.3), 29 dB below the vowel; a voice with a twang keeps the sphincter at its setting through every other sound |
| ɧ | front passage 0.10 cm², back one 0.12 cm², 0.32 cm² at least between them; a second hiss through the whole middle of [ˈaɧa], 3.0 dB below the first; spectral peak 1.3 kHz against 3.8 for [ʃ]; no second hiss in four ordinary sentences |
| Click jet | [ǀ]: the 8 ms after the front opens, above 3 kHz, 0.2 dB against the vowel with its jet, -17.9 dB without (the pop alone); the hiss of the jet alone peaks at 3.0 kHz |
| Clicks | cavity between the closures: [ʘ] -17.1 cmH2O, [ǀ] -19.4, [ǃ] -19.6, [ǁ] -19.5, [ǂ] -19.5; inflow at the front release 296, 265, 294, 174, 254 cm³/s with the back closure still shut |
| Aeroelastic trills | lungs at 8 cmH2O: [arːa] 3 closures every 38 ms, [aʙːa] 5 every 34 ms, [aʀːa] 5 every 33 ms; at 0.5 cmH2O 1, 1 and 2 |
| Written aspiration | VOT [p] 10 ms, [pʰ] 66 ms, [kʰ] 73 ms |
| Aspiration in clusters | English VOT: "play" 79 ms, "tree" 86 ms (their l and r said without voice), "splash" 10 ms |
| Italian linking | "anche un banco in gamba" a ŋ k e u m b a ŋ k o i ŋ g a m b a; "in fondo, un vino" ɱ f, ɱ v; no change across a pause or in a long n; "la terra è rossa" has two stresses, and the verb left at the end of "chi ce la ha?" keeps its own |
| Function words elsewhere | Spanish "la casa de Pedro": la and de without stress, a de at the end of a phrase with it; Polish "na stole": one stress, on stole |
| Breath groups | lung pressure against the same sentence without the fall: "la luna. le stelle" 88.4 % at the end of the first sentence, 99.6 % at the start of the second; "la luna, le stelle" 95.4 % and 93.6 % |
| Loudness and brightness | held /a/ at 4, 8, 16 cmH2O, LF source: -32.7, -22.2, -13.5 dB, 2-4 kHz against 0-1 kHz -37.9, -36.3, -34.0 dB; two-mass source, its tension held: -30.6, -21.7, -13.9 dB and -36.6, -30.8, -25.2 dB, pitch 118, 121, 121 Hz |
| Pitch in voiced consonants | LF source, against the planned pitch: long /b/ -5.0 %, /z/ -2.9 %, /m/ -0.3 % |
| Two-mass folds apart | held /a/: -21.9 dB together (LF source -22.2), -27.0 dB a little apart (-25.9); at 0.7 of the full opening -40.6 dB and no pitch; wide apart -37.0 dB (-40.4) |
| Two-mass flow, glottis wide | 1354, 1508 and 1629 cm³/s at 0.7, 0.85 and 1 of the full opening, steady within 1 % (LF source 1210, 1366, 1493: the folds at rest add their own opening) |
| Two-mass folds speaking | "he has a house": -26.1 dB, peak 0.26 (LF source -26.3 dB, 0.29); 2 cm³/s through the glottis 0.2 s after the end |
| Ejective | [kʼ] 10.6 cmH2O behind the shut glottis (lungs 8), larynx up 0.88 cm, no flow from the lungs; mouth flow in the 30 ms after the burst 66 cm³/s against 462 for [k] |
| Implosive | [ɓ] 2.7 cmH2O behind the lips against 4.1 for [b], voicing amplitude at the release 0.69 against 0.53, larynx down 1.25 cm |
| Voiceless implosive | [ɓ̥] -8.7 cmH2O at the release, mouth flow -349 cm³/s (the air drawn in) |
| Mandarin tones | [ma˥ ma˧˥ ma˨˩˦ ma˥˩], F0 at five points of each vowel, semitones from the base, heard (YIN): high level 5.5 5.6 5.4 5.4 5.4; rising 1.9 1.9 2.5 3.3 3.9; dipping -5.2 -5.8 -5.6 -4.3 -3.2; falling 1.6 -0.4 -2.2 -4.4 -5.5 |
| Downstep | [á ꜜá á]: high tones at 2.2, 0.6, -0.2 st |
| Phonemizer | French "Bonjour, comment ça va ? Je m'appelle Mireille." bɔ̃ʒˈuʁ kɔmˈɑ̃ sˈa vˈa? ʒˈə mapˈɛl miʁˈɛj (5 words from the dictionary, 2 from the model); Mandarin 你好，世界 ni˨˩˦ xɑʊ˨˩˦ ʂɚ˥˩ tɕjɛ˥˩ (dictionary, tones read); German "Guten Morgen, wie geht es dir?" gˈuːtən mˈɔʁgən viː get ˈɛs dˈiːʁ (model, 6 words in 0.5 s including loading it, Node, one thread); dictionary format, word splitting, the longest dictionary words, greedy decoding and fixed stress tested on a scripted network |
| Voice print | held /a/: formants 730 / 1286 / 2590 Hz (the waveguide's own 729 / 1298 / 2594); with the woman's head 844 / 1632 / 3056 Hz |
| Voice fit | the Sky-like voice saying "Is it raining in the city today? Not at all.", found again from the woman's (effort 0.3): distance 2.46 → 0.45 in 52 renderings, median pitch 196 Hz against 196 |
| Living variation | "ieri sera, sulla spiaggia, abbiamo guardato la luna piena salire sopra il mare." over 30 seeds: its sounds 8.6 % longer or shorter (sd), its accent peaks moved by 0.89 st (sd), the whole 95-106 % of the saying by the rules; at variation 2, 17.2 % and 1.93 st |
| Copy synthesis | "la luna piena sale sopra il mare" copied onto the same said slower (rate 0.8), higher (140 Hz) and with wider phrases: middles of the sounds 308 → 4 ms apart (median), pitch 4.95 → 0.15 st off, swell of the loudness 1.1 → 0.5 dB rms off. By the times of its sounds: labels given 40 ms late are found 25 ms after the sounds, which come 15 ms after their plan, and the starts of the sounds lie 0 ms off the recording's (median and at most); the last sound, labelled 300 ms too long, ends 22 ms after the recording's; a silence in the time of the last sound of "luna" becomes a pause, the /p/ after it starting 15 ms off the recording's |
| Cross-synthesis | "la luna piena" crossed with itself: the same samples; the man's folds through the woman's mouth: pitch 116 Hz (the man's 116), centroid of 200-1000 Hz in the /u/ 330 Hz (the woman's 322, the man's 301); her mouth every other 60 ms: no 5 ms frame louder than both the whole crossing and the man as he is (0.0 dB) |

## Simplifications and limits

- The head is a canonical adult male mid-sagittal drawing. Its vowels are
  fitted to the MRI shapes of one speaker (Story 2008) as far as its
  articulators allow (shape distance 0.60, not 0); the consonants are not.
  With the 3D sections /i/ reaches F2 2192 Hz against 2290 (2260 before):
  the fit stops at the limits of the tongue root and the lips, and a
  narrower palatal passage than the measured one is not allowed; /æ/ and
  /ɑ/ are 2-4 % off in F2 or F1.
  The cross-sections are lenses with analytic lateral profiles (a palatal
  vault, the teeth at the sides, the tongue with its groove and margins), not
  shapes measured slice by slice; the tract is still one tube of plane waves
  along its centreline (see below). Each grid line takes one air
  passage; where the tip of the lower lip enters the gap above the lower
  incisors and splits it, the area and the midpoint pass smoothly from the
  whole gap to the one between the lips while the lip on the line is thinner
  than 3 mm, and a gap from the lower incisors to the upper lip is as wide as
  the lips (largest F1/F2 step of /u/ 0.6 % per 0.005 of lip opening, 4.5 %
  before). The front end of the tract still moves by whole grid lines: when
  the upper lip comes down onto the last line the tract grows by 1.5 mm and
  the formants step by about 1 % (/ʊ/).
- The sphincter above the folds narrows and shuts the epilaryngeal tube
  but does not vibrate: the aryepiglottic trills that often go with ʜ ʢ
  (Esling 2005) and the growl of some singers are not made. On its own its
  narrowing adds only 2.3 dB of ring to a held /a/ at 0.5; the twang of a
  singer also raises the larynx, narrows the pharynx and spreads the lips,
  which the habits set apart.
- A held /u/ is on the weak side: 8.3 dB below /a/, against 4.2 dB for
  /i/, where speakers have the two about as loud as each other (in the
  three studies Rossi 1971 compares, /u/ is within 2 dB of /i/ and /ɑ/ 4 to
  5.5 dB above it). The /u/ here is as narrow as the one a speaker held for
  the MRI, 0.14 cm² at the velum and 0.16 at the lips, and what it loses it
  loses to the air that has to pass there: 1.1 of the lungs' 8 cmH2O are
  spent before the lips, so the folds are driven by less, and the two jets
  take about 2 dB from its two lowest resonances. A /u/ said in a word is
  hardly that narrow. The walls are no longer part of it (see Yielding
  walls).
- The waveguide loses the same at every frequency: its decay is set for
  the middle of the spectrum, with more of it in narrow sections. Above
  about 10 kHz it stands for a mouth no more, and what it radiates there
  is shaped by a low-pass set on measured spectra (see The top of the
  spectrum): a correction of the whole, not a model of the losses. It
  leaves /ʃ/ 11-12 dB too strong at 10-13 kHz against its own peak at
  6.3 kHz (Monson et al. 2012: 10.5 and 13.3 dB below it): the jet that
  strikes its teeth has a corner near 11 kHz, where that of /s/ is near
  5 kHz. With the
  glottis closed, a uniform tube has resonances 54, 58 and 85 Hz wide at
  525, 1451 and 2406 Hz, radiation included, where the frequency model,
  with the viscous and thermal losses of a smooth duct, has 27, 32 and
  63 Hz; measured through sealed lips, so without any radiation, they are
  45 ± 5, 60 ± 15 and 65 ± 20 Hz at 585, 1415 and 2465 Hz in men (Hanna et
  al. 2016), growing by about 1 Hz per 100 Hz. So the waveguide is close
  below 1 kHz and too sharp above 2 kHz, by the 20 Hz or more that the
  radiation would add to the measured ones. At 300 Hz it is too dull in a
  narrow passage: the first resonance of /u/ is 103 Hz wide and that of /i/
  88 Hz, against 73 and 59 Hz in the frequency model.
- One-dimensional plane-wave acoustics: no cross modes (fine below about
  5 kHz for an adult tract), no 3D flow. The noise sources are lumped dipoles
  with laws and constants calibrated to match measured fricative levels and
  spectra; the jet is not simulated as a flow field. The jet losses use the
  mean flow of the single oral constriction the aerodynamic model knows; the
  slit and lip losses do not feed back into that flow.
- The consonant postures are fitted to formants and fricative spectra, not to
  measured area functions. The laterals keep their contact, channels and
  supralingual cavity, but their F3 stays low: /l/ 2421 Hz and /ɫ/ 2254 Hz
  against about 2600 measured. The channels run back from the front of the
  midline contact to the molars, or at least 2.5 cm behind the contact: a
  velar lateral ʟ has them around the dorsum. The palatal /ʎ/ has its lateral channels but
  no midline contact, so no supralingual cavity.
- The sounds made from rules (derive.ts) are placed and narrowed by rules,
  not fitted to measurements of each sound: their place, their degree and
  the order of their formants are checked, not their spectra against
  recordings. Where a rule cannot reach its degree, the interface says so
  under the text. The Swedish ɧ is made as the IPA chart describes it,
  "simultaneous ʃ and x", one of the readings of a sound phoneticians
  still describe in several ways. The palatal click ǂ has
  its two closures, the blade's in front and the body's at the velum, but
  the body cannot also fill the cavity between them as a real tongue's
  front does, nor can it hollow it for ǃ: the two clicks differ only by
  where the blade seals (0.54 and 0.55 cm³ of air between the closures).
- The pop of a click is the inflow into a small cavity (about 1 cm³ of air
  to refill), released through the passage the tongue leaves as it opens:
  its peak is 9-21 dB below the vowel's, where real clicks are among the
  loudest consonants. The pressure of the cavity
  (-19 cmH2O) is not fitted to measurements. The inward jet hisses in the
  dental click, at 1-4 kHz where recorded ones peak near 6, but hardly in
  the lateral and bilabial ones, whose releases are also noisy in real
  speech.
- The burst of a velar stop before an open vowel is weak: 19 dB below its
  vowel in "la cata", where Greek speakers have it 6 dB below (Nicolaidis
  et al. 2019; the bursts of /p/ and /t/ are within 4 dB of theirs, that of
  /k/ before /i/ within 6), and the voice starts as soon after /k/ before /i/ as
  before /a/ (25 ms, theirs 63). The bursts of the voiced stops, and the
  frication that follows a release into a close vowel (the /d/ of "did",
  the /k/ of "keys"), are not checked against measurements.
- The hiss of an English /t/ is set by ear and against a synthetic voice,
  not against measurements of speakers. No published level of an English
  burst was at hand; the words were compared with the same words from a
  neural text-to-speech voice trained on recordings (American English),
  whose /t/ before a stressed vowel is 60-80 ms of hiss between 3 and
  8 kHz, 6 to 14 dB below the loudest of the word, with a tenth of it or
  less below 3 kHz. Ours lasts as long, lies as high and is 8 to 12 dB
  below the loudest of the word ("tattoo", "too", "tea"). Above 12 kHz,
  where the reference has nothing to compare (it is sampled at 24 kHz),
  ours had most of its energy before the losses above the plane waves,
  and stood 4 to 8 dB below the loudest of the word. Only /t/ is let go this way: /p/ and /k/
  open at once, and the folds are held as wide through their whole breath
  as at the release, where speakers have them widest near the release and
  closing from there (Hoole & Bombien 2017).
- The velum has no uvula: the uvular closures (q, ɴ, χ) are made by the
  dorsum against the pharynx just below the velum, and the uvular trill ʀ
  is a trill of the dorsum, not of the uvula. The sublingual cavity of a
  retroflex is the air pocket under the raised blade, joined to the
  channel beside it, not a side branch of its own.
- The air behind a constriction is one cavity, and only the larynx changes
  its volume: the jaw, the cheeks and the tongue root of a real speaker also
  expand or squeeze it, here they are folded into the compliance of the
  walls. The walls are heard as one share of their summed motion, not as
  surfaces of the neck and the cheeks with their own place, size and
  filtering by the tissue; the share (half) is set by the voice bar and by
  the level of a held /m/, which it leaves 7.2 dB below /a/.
- The piriform fossae have the dimensions of an average adult man, scaled
  with the speaker; real ones differ from person to person, and from the
  left to the right side.
- The nasal branch has a fixed number of sections that scales with the
  speaker. Its damping in the waveguide is set by the level of /m/, not by
  measured bandwidths: the murmur's peaks are wider than in the frequency
  model, which keeps the plain wall losses (the resonance frequencies agree).
  No frontal or ethmoid sinuses; a pinched nose is silent (no sound through
  the tissues).
- The slow aerodynamics run at control rate (every 32 samples), ramped
  linearly in the sample loop; a strong closure damping term keeps closed
  cavities stable.
- The two-mass model is the 4-mass asymmetric form without collision
  dynamics beyond the contact spring. All of an open glottis is beside its
  folds, whose rest position does not widen: real folds drawn apart are
  apart along their length. Its breath has more of the band between 0.9 and
  1.5 kHz than the LF source's (7 dB with the glottis wide open): an open
  glottis ends the tract in whatever its flow equation gives, where the LF
  source limits how far the reflection at the glottal end may fall.
- The airways below the glottis are their resonances below 4 kHz, not a
  tube run section by section, and they end in an open end after three
  generations of bronchi, where the measured resonances put it: nothing
  beyond takes sound in. The widths of the resonances (43, 39 and 62 Hz)
  are those of walls like the tract's, and are not checked against
  measurements. The breath of a whisper is made above the glottis and
  hardly reaches them (its spectrum changes by 1 dB).
- What a louder voice changes is in the source alone (level, brightness).
  Speakers who raise their voice also raise its pitch, by about 5 Hz per
  dB, and their first formant, by about 3.5 Hz per dB (Liénard & Di
  Benedetto 1999). Here the pitch and the loudness of a voice are two
  settings, and the mouth does not open wider with the loudness: that is
  20 Hz of F1 over the 6 dB either side of a speaking voice, and in this
  geometry more jaw lowers F1 in the open back vowels. The vowels are not
  lengthened either.
- Unstressed vowels are reduced by the time they lack, so the close ones,
  which need no jaw, are the same stressed or not (/i/ and /u/ between two
  /t/: F1 and F2 within a few hertz); unless the voice is a slack one,
  nothing draws them toward the middle of the vowel space.
- The speaking rate shortens the sounds, not the movements: the organs are
  no quicker in fast speech and no slower in slow speech, the pauses and
  the breath of an aspirated stop follow the rate by rules of their own
  (in proportion, and with its root), and fricatives and nasals give as
  much as stops. In Japanese, which tells long sounds from short ones,
  speakers changed their vowels and their stops alike and their fricatives
  and nasals less (Katsuda & Kang 2026).
- A breath is taken only at a full stop, never before the first sentence,
  and it is the same breath whatever is said next: it is not deeper before
  a long sentence. The lungs are a pressure, not a volume that runs out.
  The airways below the glottis hold the flow back only where it is slow
  and the glottis wide; their resistance is not in the flow of a voice,
  where it would take about 3 %.
- English pronunciation is American only; unknown words use letter-to-sound
  rules, which miss many irregular spellings. Homographs (read, live) take one
  pronunciation. Italian open and close e/o are only known where an accent is
  written. Prosody is rule-based: it has no idea which word the sentence is
  about, so the nuclear accent always falls on the last content word.
- An American flap /ɾ/ after an r-coloured vowel still closes long enough
  for the pressure behind it to build (shut 23 ms, 3.7 cmH2O in "heard
  is"; 13 ms and 2.2 in "the city"), and its release bursts like a stop;
  the one of "get it" does not close (0.03 cm² at its narrowest).
- The other languages are read word by word, with no context: homographs
  take one pronunciation, links across words (French liaison, tone sandhi)
  are not made, and the model's mistakes pass unchecked (привет comes out
  ɪprʲɪvʲet, with a vowel in front; German geht with a short e). Lexical
  stress is only where the source writes it (the Russian and Greek
  transcriptions have none), Japanese pitch accent is not marked, numbers
  are read out only in Italian and English, and the prosody is a profile per
  language (rhythm, accents, peaks, questions, final lengthening), not the
  full intonation grammar of each. The first use of
  a language needs the network.
- Tones are said as they are written: a transcription carries the tones of
  the surface, so there are no tone sandhi rules. A [phonetic] transcription
  gets the profile of the language chosen for it, or neutral rules if that
  is Italian or English.
- The machine-voice tab describes only the excitation as the paper Teacher in
  the Loop presents it; it does not model any trained network.
- The colourful field and particle visualisations are illustrative (the
  colours follow the real per-section pressure / velocity / flow, the
  particles are decorative). In the 3D view the air has the cross-sections
  the sound is computed with, one colour across each section as plane waves
  have; the tissues around it are sheets of a fixed thickness and the teeth
  are boxes along a typical dental arch, drawn for orientation.
- The illustrated head is one painting of an adult man, scaled for the other
  sizes. The painting under the tongue (the floor of the mouth, the hyoid)
  stays with the jaw and the neck, so a tongue root pushed far back or
  forward leaves a visible step below the tongue; the soft parts the model
  adds where the painting had air are plain mucosa.
- A voice fitted to a recording matches its measures, not the recording:
  what is not in the voice print (the shape of each vowel and consonant,
  the timing of each syllable, the melody word by word, a regional
  accent) is not carried over, nor what the fields of a voice cannot do.
  The fit has been tried on the simulator's own voices and on voices of a
  neural text-to-speech system trained on recordings, not on recordings
  of people, and the microphone has not been tried from here. A short
  pause of the simulator does not reach silence: a comma of 0.15 s stays
  25-33 dB below the loudest frames, where silence is counted from 35 dB
  below (one of 0.3 s goes down to 65 dB below), so the fit has to make
  the pauses longer than the recording's before they are measured at all.
- The living variation draws each factor on its own from spreads that are
  chosen, not measured on speakers: a person's longer syllable, higher
  accent and stronger push tend to come together, on the word that
  matters, where here they fall where they fall. Copy synthesis keeps our
  articulation, and the alignment is only as good as the two sayings are
  alike: on the sentence with four /t/ between vowels ("The little button
  on the water bottle") the copies stay 30-47 ms off, elsewhere 11-33.
  The linear-prediction envelope holds the tilt of the source as well as
  the formants, so the crossing splits the fine structure from the
  envelope, not exactly the folds from the mouth.

## References

- Abbs, J. H. & Gracco, V. L. (1984). Control of complex motor gestures. J. Neurophysiol. 51.
- Birkholz, P. (2007). Control of an articulatory speech synthesizer based on dynamic approximation of spatial articulatory targets. Interspeech.
- Birkholz, P. (2014). Enhanced area functions for noise source modeling in the vocal tract. 10th International Seminar on Speech Production, Cologne.
- Birkholz, P., Jackèl, D. & Kröger, B. J. (2007). Simulation of losses due to turbulence in the time-varying vocal system. IEEE Trans. Audio, Speech, and Language Processing 15.
- Dang, J., Honda, K. & Suzuki, H. (1994). Morphological and acoustical analysis of the nasal and the paranasal cavities. JASA 96.
- Dang, J. & Honda, K. (1996). Acoustic characteristics of the human paranasal sinuses derived from transmission characteristic measurement and morphological observation. JASA 100.
- Dang, J. & Honda, K. (1997). Acoustic characteristics of the piriform fossa in models and humans. JASA 101.
- de Cheveigné, A. & Kawahara, H. (2002). YIN, a fundamental frequency estimator for speech and music. JASA 111.
- Fant, G. (1960). Acoustic Theory of Speech Production. Mouton.
- Fant, G., Liljencrants, J. & Lin, Q. (1985). A four-parameter model of glottal flow. STL-QPSR 4.
- Fant, G. (1995). The LF-model revisited. Transformations and frequency domain analysis. STL-QPSR 2-3.
- Flanagan, J. L. (1972). Speech Analysis, Synthesis and Perception, 2nd ed. Springer.
- Flanagan, J. L. & Cherry, L. (1969). Excitation of vocal-tract synthesizers. JASA 45.
- Buizza, E. & Plug, L. (2012). Lenition, fortition and the status of plosive affrication: the case of spontaneous RP English /t/. Phonology 29(1).
- Hoole, P. & Bombien, L. (2017). A cross-language study of laryngeal-oral coordination across varying prosodic and syllable-structure conditions. J. Speech Lang. Hear. Res. 60.
- Heinz, J. M. & Stevens, K. N. (1965). On the relations between lateral cineradiographs, area functions and acoustic spectra of speech. ICA 5.
- Hillenbrand, J., Getty, L. A., Clark, M. J. & Wheeler, K. (1995). Acoustic characteristics of American English vowels. JASA 97.
- Ishizaka, K. & Flanagan, J. L. (1972). Synthesis of voiced sounds from a two-mass model of the vocal cords. Bell Syst. Tech. J. 51.
- Ishizaka, K., French, J. C. & Flanagan, J. L. (1975). Direct determination of vocal tract wall impedance. IEEE Trans. ASSP 23.
- Kelly, J. L. & Lochbaum, C. C. (1962). Speech synthesis. Proc. 4th Int. Congr. Acoustics.
- Maeda, S. (1990). Compensatory articulation during speech. In Speech Production and Speech Modelling. Kluwer.
- Narayanan, S. S., Alwan, A. A. & Haker, K. (1995). An articulatory study of fricative consonants using magnetic resonance imaging. JASA 98.
- Narayanan, S. S., Alwan, A. A. & Haker, K. (1997). Toward articulatory-acoustic models for liquid approximants based on MRI and EPG data. Part I. The laterals. JASA 101.
- Öhman, S. E. G. (1966). Coarticulation in VCV utterances. JASA 39.
- Peterson, G. E. & Barney, H. L. (1952). Control methods used in a study of the vowels. JASA 24.
- Prom-on, S., Xu, Y. & Thipakorn, B. (2009). Modeling tone and intonation in Mandarin and English as a process of target approximation. JASA 125.
- Browman, C. P. & Goldstein, L. (1992). Articulatory phonology: an overview. Phonetica 49.
- Chao, Y. R. (1930). A system of tone letters. Le Maître Phonétique 45.
- Cho, T. & Ladefoged, P. (1999). Variation and universals in VOT: evidence from 18 languages. J. Phonetics 27.
- DuBois, A. B., Botelho, S. Y. & Comroe, J. H. (1956). A new method for measuring airway resistance in man using a body plethysmograph. J. Clin. Invest. 35.
- Liénard, J.-S. & Di Benedetto, M.-G. (1999). Effect of vocal effort on spectral properties of vowels. JASA 106(1).
- Ladefoged, P. & Maddieson, I. (1996). The Sounds of the World’s Languages. Blackwell.
- Lindau, M. (1984). Phonetic differences in glottalic consonants. J. Phonetics 12.
- McGowan, R. S. (1992). Tongue-tip trills and vocal-tract wall compliance. JASA 91.
- Solé, M.-J. (2002). Aerodynamic characteristics of trills and phonological patterning. J. Phonetics 30.
- Westbury, J. R. (1983). Enlargement of the supraglottal cavity and its relation to stop consonant voicing. JASA 73.
- Lulich, S. M., Morton, J. R., Arsikere, H., Sommers, M. S., Leung, G. K. F. & Alwan, A. (2012). Subglottal resonances of adult male and female native speakers of American English. JASA 132(4).
- Lulich, S. M. (2025). Subglottal resonances in older adults. Beszédtudomány - Speech Science 2025/1.
- Florens, M., Sapoval, B. & Filoche, M. (2011). An anatomical and functional model of the human tracheobronchial tree. J. Appl. Physiol. 110.
- Hanson, H. M. (1997). Glottal characteristics of female speakers: Acoustic correlates. J. Acoust. Soc. Am. 101, 466-481.
- Hanson, H. M. & Stevens, K. N. (2000). Modeling stop-consonant releases for synthesis. Poster, 139th Meeting of the Acoustical Society of America, Atlanta.
- Monson, B. B., Lotto, A. J. & Story, B. H. (2012). Analysis of high-frequency energy in long-term average spectra of singing, speech, and voiceless fricatives. J. Acoust. Soc. Am. 132(3).
- Nicolaidis, K., Sfakianaki, A., Vlahavas, G. & Kafentzis, G. (2019). An acoustic study of Greek voiceless stops. Proceedings of the 19th ICPhS, Melbourne.
- Titze, I. R., Palaparthi, A. & Smith, S. L. (2014). Benchmarks for time-domain simulation of sound propagation in soft-walled airways: steady configurations. JASA 136(6).
- Recasens, D. (1991). On the production characteristics of apicoalveolar taps and trills. J. Phonetics 19.
- Elovitz, H. S., Johnson, R., McHugh, A. & Shore, J. E. (1976). Automatic translation of English text to phonetics by means of letter-to-sound rules. NRL Report 7948.
- Espy-Wilson, C. Y., Boyce, S. E., Jackson, M., Narayanan, S. & Alwan, A. (2000). Acoustic modeling of American English /r/. JASA 108.
- Fujisaki, H. & Hirose, K. (1984). Analysis of voice fundamental frequency contours for declarative sentences of Japanese. J. Acoust. Soc. Jpn. (E) 5.
- Klatt, D. H. (1979). Synthesis by rule of segmental durations in English sentences. In Frontiers of Speech Communication Research. Academic Press.
- Katsuda, H. & Kang, Y. (2026). Speaking rate effects on Japanese vowel and consonant length contrasts. Journal of Phonetics 115, 101473.
- Cohn, A. C. (1990). Phonetic and phonological rules of nasalization. UCLA Working Papers in Phonetics 76.
- Laprie, Y., Elie, B. & Tsukanova, A. (2015). 2D articulatory velum modeling applied to copy synthesis of sentences containing nasal phonemes. ICPhS 2015, Glasgow.
- Lindblom, B. (1963). Spectrographic study of vowel reduction. JASA 35.
- Farnetani, E. & Vayra, M. (1991). Word- and phrase-level aspects of vowel reduction in Italian. Proc. XIIth ICPhS, Aix-en-Provence, vol. 2.
- Klatt, D. H. & Klatt, L. C. (1990). Analysis, synthesis, and perception of voice quality variations among female and male talkers. JASA 87.
- Lisker, L. & Abramson, A. S. (1964). A cross-language study of voicing in initial stops: acoustical measurements. Word 20.
- Dauer, R. M. (1983). Stress-timing and syllable-timing reanalyzed. J. Phonetics 11.
- Ramus, F., Nespor, M. & Mehler, J. (1999). Correlates of linguistic rhythm in the speech signal. Cognition 73.
- Ladd, D. R. (2008). Intonational Phonology (2nd ed.). Cambridge University Press.
- Pike, K. L. (1945). The Intonation of American English. University of Michigan Press.
- Perkell, J. S., Matthies, M. L., Svirsky, M. A. & Jordan, M. I. (1993). Trading relations between tongue-body raising and lip rounding in production of the vowel /u/: a pilot "motor equivalence" study. JASA 93.
- Laver, J. (1980). The Phonetic Description of Voice Quality. Cambridge University Press.
- Laver, J., Wirz, S., Mackenzie, J. & Hiller, S. M. (1981). A perceptual protocol for the analysis of vocal profiles. Edinburgh University Department of Linguistics, Work in Progress 14.
- Honikman, B. (1964). Articulatory settings. In D. Abercrombie et al. (eds.), In Honour of Daniel Jones. Longmans.
- Lindblom, B. (1990). Explaining phonetic variation: a sketch of the H&H theory. In Speech Production and Speech Modelling. Kluwer.
- Hollien, H. & Michel, J. F. (1968). Vocal fry as a phonational register. J. Speech Hear. Res. 11.
- Hollien, H. (1974). On vocal registers. J. Phonetics 2.
- Demolin, D., Ghio, A. & Harvey, A. (2023). Acoustic and aerodynamic features of Hadza clicks. Proceedings of the 20th ICPhS, Prague.
- Zhang, Z. (2016). Cause-effect relationship between vocal fold physiology and voice production in a three-dimensional phonation model. JASA 139.
- Fletcher, H. (1953). Speech and Hearing in Communication. Van Nostrand.
- Fry, D. B. (1979). The Physics of Speech. Cambridge University Press.
- Fujimura, O. (1962). Analysis of nasal consonants. JASA 34.
- Fujimura, O. & Lindqvist, J. (1971). Sweep-tone measurements of vocal-tract characteristics. JASA 49.
- Hanna, N., Smith, J. & Wolfe, J. (2016). Frequencies, bandwidths and magnitudes of vocal tract and surrounding tissue resonances, measured through the lips during phonation. JASA 139(5).
- Rossi, M. (1971). L'intensité spécifique des voyelles. Proc. 7th Int. Congress of Phonetic Sciences, Montreal.
- Gick, B., Allen, B., Roewer-Després, F. & Stavness, I. (2017). Speaking tongues are actively braced. JSLHR 60.
- Jongman, A., Wayland, R. & Wong, S. (2000). Acoustic characteristics of English fricatives. JASA 108.
- Jongman, A. (2024). Phonetics of fricatives. Oxford Research Encyclopedia of Linguistics.
- Zue, V. W. & Laferriere, M. (1979). Acoustic study of medial /t, d/ in American English. JASA 66.
- Sforza, P. M., Steiger, M. H. & Trentacoste, N. (1966). Studies on three-dimensional viscous jets. AIAA Journal 4.
- Shadle, C. H. (1985). The acoustics of fricative consonants. PhD thesis, MIT.
- Sondhi, M. M. & Schroeter, J. (1987). A hybrid time-frequency domain articulatory speech synthesizer. IEEE Trans. ASSP 35.
- Steinecke, I. & Herzel, H. (1995). Bifurcations in an asymmetric vocal-fold model. JASA 97.
- Stevens, K. N. (1971). Airflow and turbulence noise for fricative and stop consonants. JASA 50.
- Stevens, K. N. (1989). On the quantal nature of speech. Journal of Phonetics 17.
- Stevens, K. N. (1998). Acoustic Phonetics. MIT Press.
- Stone, M. (1990). A three-dimensional model of tongue movement based on ultrasound and x-ray microbeam data. JASA 87.
- Story, B. H., Titze, I. R. & Hoffman, E. A. (1996). Vocal tract area functions from magnetic resonance imaging. JASA 100.
- Story, B. H. (2008). Comparison of magnetic resonance imaging-based vocal tract area functions obtained from the same speaker in 1994 and 2002. JASA 123.
- Sundberg, J., Johansson, C., Wilbrand, H. & Ytterbergh, C. (1987). From sagittal distance to area. Phonetica 44.
- Sundberg, J. (1974). Articulatory interpretation of the "singing formant". JASA 55.
- Titze, I. R. & Story, B. H. (1997). Acoustic interactions of the voice source with the lower vocal tract. JASA 101.
- Esling, J. H. (2005). There are no back vowels: the laryngeal articulator model. Canadian Journal of Linguistics 50.
- Moisik, S. R. & Esling, J. H. (2011). The "whole larynx" approach to laryngeal features. Proceedings of the 17th ICPhS, Hong Kong.
- Titze, I. R. (1984). Parameterization of the glottal area, glottal flow, and vocal fold contact area. JASA 75.
- Titze, I. R. (1989). On the relation between subglottal pressure and fundamental frequency in phonation. JASA 85.
- Klatt, D. H. (1975). Voice onset time, frication, and aspiration in word-initial consonant clusters. J. Speech Hear. Res. 18.
- Titze, I. R. & Sundberg, J. (1992). Vocal intensity in speakers and singers. JASA 91.
- Young, S. et al. The HTK Book (mel filterbank).
- Zhang, Z. & Espy-Wilson, C. Y. (2004). A vocal-tract model of American English /l/. JASA 115.
- Zhu, J., Zhang, C. & Jurgens, D. (2022). ByT5 model for massively multilingual grapheme-to-phoneme conversion. Interspeech 2022.

## Developer scripts

```bash
npx tsx scripts/say.ts out/            # render example sentences to WAV, print phones, durations and pitch range
npx tsx scripts/fit-voice.ts list.json --out=a.voice.json   # fit a voice to WAV recordings and their texts
npx tsx scripts/copy-test.ts list.json --n=3 --out=.ref/copy    # a recording's timing, melody and loudness on our voice, to listen to
npx tsx scripts/copy-test.ts list.json --n=3 --cross            # the fine structure of each through the envelope of the other
npx tsx scripts/copy-test.ts list.json --n=3 --cross --before=all --columns=all,sharp   # only those columns, next to one of the time before
npx tsx scripts/copy-test.ts list.json --n=3 --dtw              # timing by lining the two signals up, also where the times of the sounds are given
npx tsx scripts/envelope-report.ts .ref/copy                    # how the envelope of the copies differs from the recordings'
npx tsx scripts/consonant-report.ts .ref/copy                   # the consonants of the copies: level, bands, /s/, passages, hiss
npx tsx scripts/say.ts out/ en "any sentence"   # one sentence; add --flat for the robot version
npx tsx scripts/say.ts out/ it "la luna" --voice=deep   # with a starting voice, or --voice=my.voice.json from the studio
npx tsx scripts/g2p.ts en "the water bottle"    # phones of a text and where each English word came from
npx tsx scripts/phonemize.ts fr "ça va ?"       # another language, with the real dictionary and model (downloaded into out/g2p/)
npx tsx scripts/trace.ts it "il carro"          # every 2 ms: phone, constriction area, oral pressure, voicing, larynx, mouth flow
npx tsx scripts/build-lexicon.ts us_gold.json   # rebuild public/lexicon/en-us.lex
npx tsx scripts/tune-rhotic.ts 490,1350,1690 ɹ  # fit an articulation to F1/F2/F3 with tip and lips free
npx tsx scripts/areas.ts ɹ ɝ j l w              # narrowest passage and formants of each phoneme's posture
npx tsx scripts/ipa-chart.ts ʂ r̝ y kʷ          # the IPA chart as the rules make it (no arguments: the whole chart)
npx tsx scripts/posture.ts '{"from":"k","sweep":"tongueY","lo":0.6,"hi":1.7}'   # narrowest passage of postures, for new places
npx tsx scripts/melody.ts en "is it raining?"   # planned F0 at each phone
npx tsx scripts/noisemap.ts en "every voice"    # level of each noise source per phone
npx tsx scripts/contrast.ts it "il vino"        # how deep each consonant dips below its vowels
npx tsx scripts/landmarks.ts                    # when constrictions form and open, against the plan
npx tsx scripts/context.ts --base a.json        # vowels in sentences against the same vowels held (--save a.json keeps the measures)
npx tsx scripts/sibilants.ts a.wav b.wav        # peak and spectral mean of the hissing frames of recordings
npx tsx scripts/pitch.ts a.wav b.wav            # pitch track, level and F0 spread of recordings
npx tsx scripts/hnr.ts a.wav b.wav              # harmonics-to-noise ratio, full band and above 2 kHz
npx tsx scripts/specpng.ts out.png a.wav b.wav  # stacked spectrograms with pitch tracks
npx tsx scripts/explore.ts a out.wav   # one phoneme: level, F0, LPC formants
npx tsx scripts/tune-vowels.ts a --keys=jaw,tongueX,tongueY,tongueRoot --minarea=0.3   # fit vowel articulations to reference formants
npx tsx scripts/fit-mri.ts             # fit the vowels to formants and to the MRI shapes (--write updates phonemes.ts)
npx tsx scripts/mri.ts --profiles      # acoustic model on the MRI areas; our vowels against the measured shapes
npx tsx scripts/tune-consonants.ts     # consonant tuning helper
npx tsx scripts/tune-sibilant.ts ʃ 3000 4000   # fit a sibilant to a spectral peak and mean (frequency model, then rendered)
npx tsx scripts/tune-lateral.ts l 350 1500 2600 --robust   # fit a lateral to F1/F2/F3, keeping the contact, the channels and a 2 cm cavity
npx tsx scripts/areas3d.ts i a u l     # narrowest passage, perimeter, hydraulic diameter, channels, formants with and without the piriform fossae
npx tsx scripts/noise-transfer.ts s    # transfer from a noise source at each front junction
npx tsx scripts/scan-variants.ts ʃ '[{"jaw":0.2}]'
npx tsx scripts/debug-geometry.ts geometry.html
npx tsx scripts/head-guide.ts out/      # the guide image the head's painting was generated from
```

In development builds the store is exposed as `window.voiceStore` for
debugging.

## License

Apache-2.0 (`LICENSE`). The American English lexicon is derived from the
Misaki G2P by hexgrad (Apache-2.0): see `NOTICE`. Third-party components and
data are listed in `THIRD_PARTY_NOTICES.md`.
