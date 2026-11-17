import { useRef } from 'react';
import { store, useStore, useTick } from '../store';
import { voice } from '../voice/voice';
import { useManual } from '../voice/hooks';
import { Slider, Toggle, Section, Seg, Readout, OneOpen } from './controls';
import { useAnimatedCanvas, C, label } from '../canvas';
import { NOISE_SHAPES } from '../presets';
import { NOISE_CURVE_POINTS, NOISE_CURVE_FMIN, NOISE_CURVE_FMAX, noiseCurveFreq } from '../../dsp/noise/noise';
import type { EngineParams, NoiseLocation } from '../../dsp/engine/params';

const DB_MIN = -45, DB_MAX = 10;

/** Drawable noise spectrum (32 log-spaced points). */
function CurveEditor() {
  const last = useRef<{ i: number; v: number } | null>(null);
  const ref = useAnimatedCanvas(({ ctx, w, h }) => {
    const u = voice.manual.noise.user;
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
    const X = (f: number) => 30 + (Math.log(f / NOISE_CURVE_FMIN) / Math.log(NOISE_CURVE_FMAX / NOISE_CURVE_FMIN)) * (w - 40);
    const Y = (db: number) => 8 + ((DB_MAX - db) / (DB_MAX - DB_MIN)) * (h - 26);
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.muted; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const f of [100, 300, 1000, 3000, 10000]) { ctx.beginPath(); ctx.moveTo(X(f), 8); ctx.lineTo(X(f), h - 18); ctx.stroke(); ctx.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), X(f), h - 15); }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const db of [0, -20, -40]) { ctx.beginPath(); ctx.moveTo(30, Y(db)); ctx.lineTo(w - 10, Y(db)); ctx.stroke(); ctx.fillText(String(db), 26, Y(db)); }
    // band limits
    ctx.fillStyle = 'rgba(11,14,20,0.6)';
    ctx.fillRect(30, 8, Math.max(0, X(u.lowCut) - 30), h - 26);
    ctx.fillRect(X(u.highCut), 8, Math.max(0, w - 10 - X(u.highCut)), h - 26);
    // curve
    ctx.beginPath();
    for (let i = 0; i < NOISE_CURVE_POINTS; i++) { const x = X(noiseCurveFreq(i)), y = Y(u.curve[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.lineTo(X(NOISE_CURVE_FMAX), h - 18); ctx.lineTo(X(NOISE_CURVE_FMIN), h - 18); ctx.closePath();
    const g = ctx.createLinearGradient(0, 8, 0, h - 18);
    g.addColorStop(0, 'rgba(169,139,250,0.55)'); g.addColorStop(1, 'rgba(169,139,250,0.05)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = C.violet; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < NOISE_CURVE_POINTS; i++) { const x = X(noiseCurveFreq(i)), y = Y(u.curve[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    if (!u.on) label(ctx, 'generator off: switch it on below', w / 2, h / 2, C.muted);
  });
  const paint = (e: React.PointerEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const w = r.width, h = r.height;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const f = NOISE_CURVE_FMIN * Math.pow(NOISE_CURVE_FMAX / NOISE_CURVE_FMIN, (px - 30) / (w - 40));
    const i = Math.max(0, Math.min(NOISE_CURVE_POINTS - 1, Math.round((Math.log(f / NOISE_CURVE_FMIN) / Math.log(NOISE_CURVE_FMAX / NOISE_CURVE_FMIN)) * (NOISE_CURVE_POINTS - 1))));
    const v = Math.max(DB_MIN, Math.min(DB_MAX, DB_MAX - ((py - 8) / (h - 26)) * (DB_MAX - DB_MIN)));
    const prev = last.current;
    voice.edit((p) => {
      const c = p.noise.user.curve;
      if (prev && prev.i !== i) {
        const a = Math.min(prev.i, i), b = Math.max(prev.i, i);
        for (let k = a; k <= b; k++) c[k] = prev.v + ((v - prev.v) * (k - prev.i)) / (i - prev.i);
      } else c[i] = v;
      p.noise.user.on = true;
    });
    last.current = { i, v };
  };
  return (
    <canvas ref={ref} className="curve-canvas"
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); last.current = null; paint(e); }}
      onPointerMove={(e) => { if (e.buttons) paint(e); }}
      onPointerUp={() => { last.current = null; }} />
  );
}

export function NoisePanel() {
  const p = useManual();
  const numbers = useStore((s) => s.ui.numbers);
  useTick(numbers ? 4 : 0);
  const n = p.noise, u = n.user;
  const set = (f: (q: EngineParams) => void, o?: { takeOver?: boolean }) => voice.edit(f, o);
  const tel = store.telemetry;
  const dbl = (x: number) => (x > 0 ? (20 * Math.log10(x)).toFixed(0) + ' dB' : '–');
  return (
    <div className="panel-body"><OneOpen>
      <Section title={'Physical hiss (turbulence)'} accent={C.violet}
        info={'When air rushes through a narrow passage the flow becomes turbulent (Reynolds number above about 1800) and makes noise over a wide range of frequencies, with no harmonics. Here it arises in three places: at the glottis (aspiration, “h”, breathy voice), at the exit of the constriction (wall) and on the incisors (obstacle, the “s”). Aspiration pulses with each cycle of the folds, strongest while they are open.'}>
        <Toggle control="noise" label={'Aspiration at the glottis'} value={n.aspirationOn} onChange={(v) => set((x) => { x.noise.aspirationOn = v; })} />
        <Slider control="noise" label={'aspiration level'} value={n.aspiration} min={-30} max={20} step={0.5} onChange={(v) => set((x) => { x.noise.aspiration = v; })} format={(v) => `${v.toFixed(0)} dB`} />
        <Slider control="noise" label="steady ↔ pulsed" value={n.aspirationPulse} min={0} max={1} onChange={(v) => set((x) => { x.noise.aspirationPulse = v; })} format={(v) => (v < 0.2 ? 'steady' : v > 0.8 ? 'pulsed' : 'mixed')} />
        <Toggle control="noise" label={'Hiss at the constriction'} value={n.fricationOn} onChange={(v) => set((x) => { x.noise.fricationOn = v; })} />
        <Slider control="noise" label={'constriction level'} value={n.frication} min={-30} max={20} step={0.5} onChange={(v) => set((x) => { x.noise.frication = v; })} format={(v) => `${v.toFixed(0)} dB`} />
        <Toggle control="noise" label={'Hiss on the teeth (obstacle)'} value={n.obstacleOn} onChange={(v) => set((x) => { x.noise.obstacleOn = v; })} />
        <Slider control="noise" label="obstacle level" value={n.obstacle} min={-30} max={20} step={0.5} onChange={(v) => set((x) => { x.noise.obstacle = v; })} format={(v) => `${v.toFixed(0)} dB`} />
        <Toggle control="noise" label="Stop release burst" value={n.burstOn} onChange={(v) => set((x) => { x.noise.burstOn = v; })} />
        <Readout items={tel ? [
          ['aspiration', dbl(tel.levels.aspiration)], ['constriction', dbl(tel.levels.wall)],
          ['obstacle', dbl(tel.levels.obstacle)], ['Re ' + 'glottis', tel.glottalRe.toFixed(0)],
          ['Re ' + 'constriction', tel.jet.re.toFixed(0)], ['constriction area', `${tel.constrictionArea.toFixed(3)} cm²`],
        ] : []} />
      </Section>

      <Section title={'Your white noise'} accent={C.sky}
        info={'A noise generator you shape: pick a color or draw the spectrum with the mouse, choose where it enters the tract (glottis, constriction, teeth, lips or anywhere) and whether it pulses with the folds. With “no filter” you hear it as it is; otherwise it passes through the tract and takes on its resonances.'}>
        <Toggle control="noise" label={'Generator on'} value={u.on} onChange={(v) => { set((x) => { x.noise.user.on = v; }); if (v) { set((x) => { x.phonate = true; }); void voice.ensureAudio(); } }} />
        <div className="chips">
          {NOISE_SHAPES.map((s) => <button key={s.id} className="chip" onClick={() => set((x) => { x.noise.user.curve = s.curve(); x.noise.user.on = true; })}>{s.name}</button>)}
        </div>
        <CurveEditor />
        <Slider control="noise" label="Level" value={u.level} min={-40} max={20} step={0.5} onChange={(v) => set((x) => { x.noise.user.level = v; })} format={(v) => `${v.toFixed(0)} dB`} />
        <Slider control="noise" label="Low cut" value={u.lowCut} min={20} max={8000} log onChange={(v) => set((x) => { x.noise.user.lowCut = v; })} format={(v) => `${Math.round(v)} Hz`} />
        <Slider control="noise" label="High cut" value={u.highCut} min={500} max={20000} log onChange={(v) => set((x) => { x.noise.user.highCut = v; })} format={(v) => `${Math.round(v)} Hz`} />
        <Slider control="noise" label="Pulses with the folds" value={u.pulse} min={0} max={1} onChange={(v) => set((x) => { x.noise.user.pulse = v; })} />
        <Seg<NoiseLocation> control="noise" value={u.location} onChange={(v) => set((x) => { x.noise.user.location = v; })} options={[
          ['glottis', 'Glottis'], ['constriction', 'Constriction'], ['teeth', 'Teeth'], ['lips', 'Lips'], ['custom', 'Custom'],
        ]} />
        {u.location === 'custom' && <Slider control="noise" label={'Position (glottis → lips)'} value={u.position} min={0} max={1} onChange={(v) => set((x) => { x.noise.user.position = v; })} />}
        <Toggle control="noise" label={'No filter (hear the raw noise)'} value={u.bypassTract} onChange={(v) => set((x) => { x.noise.user.bypassTract = v; })} />
        <div className="row wrap">
          <button className="chip" onClick={() => set((x) => { x.voicing = false; x.abduction = 0; x.noise.aspirationOn = false; x.noise.fricationOn = false; x.noise.obstacleOn = false; x.noise.user.on = true; x.phonate = true; }, { takeOver: true })}>Only my noise</button>
          <button className="chip" onClick={() => set((x) => { x.voicing = true; x.noise.aspirationOn = true; x.noise.fricationOn = true; x.noise.obstacleOn = true; })}>Voice back on</button>
        </div>
      </Section>
    </OneOpen></div>
  );
}
