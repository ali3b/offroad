// Sound effects: continuous per-truck voices (engine, skid) and one-shots. All synthesised: FM tones, filtered noise.
import { midiToHz, noise, perc, playNote, type Patch } from './fm';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function panner(ctx: BaseAudioContext, dest: AudioNode, x = 0) {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, x)) * 0.8;
  p.connect(dest);
  return p;
}

/** One truck's engine: FM growl (carrier = firing frequency, sub-octave modulator) through a lowpass, panned. */
export class EngineVoice {
  private car: OscillatorNode;
  private mod: OscillatorNode;
  private dev: GainNode;
  private filter: BiquadFilterNode;
  private amp: GainNode;
  private pan: StereoPannerNode;
  private rumble: OscillatorNode;
  private rumbleGain: GainNode;
  lastUpdate = -1;
  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private truck: number,
  ) {
    this.pan = ctx.createStereoPanner();
    this.pan.connect(dest);
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2;
    this.filter.frequency.value = 400;
    this.car = ctx.createOscillator();
    this.car.type = 'sawtooth';
    this.mod = ctx.createOscillator();
    this.dev = ctx.createGain();
    this.mod.connect(this.dev).connect(this.car.frequency);
    this.rumble = ctx.createOscillator();
    this.rumble.type = 'square';
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.25;
    this.rumble.connect(this.rumbleGain).connect(this.filter);
    this.car.connect(this.filter).connect(this.amp).connect(this.pan);
    this.set(0, 0, 0, false, 0);
    this.car.start();
    this.mod.start();
    this.rumble.start();
  }

  set(rpm: number, throttle: number, x: number, player: boolean, level = 1) {
    const now = this.ctx.currentTime;
    const r = clamp01(rpm);
    const th = clamp01(throttle);
    // Each truck sits a little apart in pitch so four engines don't phase into one drone.
    const f = (32 + r * 120) * (1 + this.truck * 0.035);
    const k = 0.04;
    this.car.frequency.setTargetAtTime(f, now, k);
    this.mod.frequency.setTargetAtTime(f * 0.5, now, k);
    this.dev.gain.setTargetAtTime(f * 0.5 * (1.2 + th * 3.2), now, k);
    this.rumble.frequency.setTargetAtTime(f * 0.5, now, k);
    this.filter.frequency.setTargetAtTime(260 + r * 1900 + th * 700, now, k);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, x)) * 0.75, now, 0.05);
    const g = (0.07 + 0.06 * th + 0.03 * r) * (player ? 1 : 0.4) * level;
    this.amp.gain.setTargetAtTime(g, now, 0.06);
    this.lastUpdate = now;
  }

  silence() {
    this.amp.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
  }

  dispose() {
    this.silence();
    const t = this.ctx.currentTime + 0.8;
    for (const o of [this.car, this.mod, this.rumble]) o.stop(t);
    setTimeout(() => this.pan.disconnect(), 1000);
  }
}

/** Tyre hiss: looped bandpassed noise whose level and brightness follow the slip amount. */
export class SkidVoice {
  private src: AudioBufferSourceNode;
  private bp: BiquadFilterNode;
  private amp: GainNode;
  private pan: StereoPannerNode;
  lastUpdate = -1;
  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.pan = ctx.createStereoPanner();
    this.pan.connect(dest);
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.bp = ctx.createBiquadFilter();
    this.bp.type = 'bandpass';
    this.bp.Q.value = 1.4;
    this.bp.frequency.value = 1500;
    this.src = noise(ctx, ctx.currentTime, true);
    this.src.connect(this.bp).connect(this.amp).connect(this.pan);
  }
  set(amount: number, x = 0) {
    const now = this.ctx.currentTime;
    const a = clamp01(amount);
    this.amp.gain.setTargetAtTime(a * 0.22, now, 0.04);
    this.bp.frequency.setTargetAtTime(1100 + a * 1600, now, 0.05);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, x)) * 0.75, now, 0.05);
    this.lastUpdate = now;
  }
  silence() {
    this.amp.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
  }
  dispose() {
    this.silence();
    this.src.stop(this.ctx.currentTime + 0.5);
    setTimeout(() => this.pan.disconnect(), 800);
  }
}

// ---- one-shots ------------------------------------------------------------------------------------------------

const BEEP: Patch = { car: 'square', mod: 'sine', ratio: 1, index: 0, a: 0.003, d: 0.05, s: 0.9, r: 0.03, gain: 0.2 };
const BELL: Patch = { car: 'sine', mod: 'sine', ratio: 3.5, index: 2.4, indexEnd: 0.1, indexTime: 0.6, a: 0.002, d: 0.9, s: 0, r: 0.4, gain: 0.22 };
const DING: Patch = { car: 'sine', mod: 'sine', ratio: 4, index: 1.8, indexEnd: 0.1, indexTime: 0.25, a: 0.002, d: 0.4, s: 0, r: 0.2, gain: 0.2 };
const HORN: Patch = { car: 'sawtooth', mod: 'sine', ratio: 1, index: 0.8, a: 0.04, d: 0.2, s: 0.85, r: 0.25, gain: 0.08, lp: 1800 };

function noiseBurst(ctx: BaseAudioContext, dest: AudioNode, t: number, o: { type: BiquadFilterType; from: number; to?: number; q?: number; peak: number; attack?: number; decay: number; sweep?: number }) {
  const src = noise(ctx, t);
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.Q.value = o.q ?? 0.8;
  f.frequency.setValueAtTime(o.from, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + (o.sweep ?? o.decay));
  const g = ctx.createGain();
  perc(g.gain, t, o.peak, o.decay, o.attack ?? 0.003);
  src.connect(f).connect(g).connect(dest);
  src.stop(t + (o.attack ?? 0) + o.decay + 0.05);
  src.onended = () => g.disconnect();
}

function thump(ctx: BaseAudioContext, dest: AudioNode, t: number, from: number, to: number, peak: number, decay: number) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.6);
  const g = ctx.createGain();
  perc(g.gain, t, peak, decay);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + decay + 0.05);
  o.onended = () => g.disconnect();
}

export interface SfxParams {
  strength?: number;
  x?: number;
  n?: number;
}

export type SfxName = 'impact' | 'truckHit' | 'splash' | 'nitro' | 'land' | 'countdown' | 'go' | 'lap' | 'finish' | 'pickup' | 'cheer';

/** Play a one-shot at time `t` into `dest`. Works on live and offline contexts. */
export function playSfx(ctx: BaseAudioContext, dest: AudioNode, name: SfxName, p: SfxParams = {}, t = ctx.currentTime) {
  const s = clamp01(p.strength ?? 0.7);
  const out = panner(ctx, dest, p.x ?? 0);
  switch (name) {
    case 'impact':
      thump(ctx, out, t, 120, 45, 0.25 + 0.5 * s, 0.25 + 0.15 * s);
      noiseBurst(ctx, out, t, { type: 'lowpass', from: 900 + 2500 * s, to: 200, peak: 0.2 + 0.45 * s, decay: 0.18 + 0.2 * s });
      break;
    case 'truckHit':
      // Metal on metal: inharmonic FM clank plus a crunch.
      playNote(ctx, out, { car: 'sine', mod: 'square', ratio: 1.41, index: 5, indexEnd: 0.2, indexTime: 0.1, a: 0.001, d: 0.2, s: 0, r: 0.1, gain: 0.12 + 0.18 * s }, 180, t, 0.15);
      noiseBurst(ctx, out, t, { type: 'bandpass', from: 2500, to: 600, q: 1.2, peak: 0.2 + 0.3 * s, decay: 0.15 });
      thump(ctx, out, t, 90, 40, 0.3 * s, 0.2);
      break;
    case 'splash':
      noiseBurst(ctx, out, t, { type: 'lowpass', from: 5000, to: 400, peak: 0.42, attack: 0.02, decay: 0.7, sweep: 0.6 });
      noiseBurst(ctx, out, t + 0.05, { type: 'bandpass', from: 900, to: 2200, q: 3, peak: 0.25, decay: 0.35 });
      for (let i = 0; i < 4; i++) thump(ctx, out, t + 0.12 + i * 0.07, 500 + i * 140, 900 + i * 200, 0.06, 0.06);
      break;
    case 'nitro': {
      noiseBurst(ctx, out, t, { type: 'bandpass', from: 400, to: 3500, q: 1.5, peak: 0.4, attack: 0.08, decay: 1.1, sweep: 0.5 });
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(440, t + 0.6);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1500;
      const g = ctx.createGain();
      perc(g.gain, t, 0.09, 1, 0.1);
      o.connect(f).connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.2);
      o.onended = () => g.disconnect();
      break;
    }
    case 'land':
      thump(ctx, out, t, 85 + 30 * s, 35, 0.4 + 0.5 * s, 0.22 + 0.15 * s);
      noiseBurst(ctx, out, t, { type: 'lowpass', from: 700, to: 150, peak: 0.15 + 0.3 * s, decay: 0.15 });
      break;
    case 'countdown':
      playNote(ctx, out, BEEP, midiToHz(69), t, 0.16);
      break;
    case 'go':
      playNote(ctx, out, BEEP, midiToHz(81), t, 0.55, 1);
      break;
    case 'lap':
      playNote(ctx, out, BELL, midiToHz(84), t, 0.3);
      playNote(ctx, out, BELL, midiToHz(91), t + 0.12, 0.5);
      break;
    case 'finish':
      // Air horn: a detuned minor-third pair.
      for (const [m, d] of [
        [58, 0],
        [61, 6],
        [58, -8],
      ]) {
        const hz = midiToHz(m) * Math.pow(2, d / 1200);
        playNote(ctx, out, HORN, hz, t, 0.35);
        playNote(ctx, out, HORN, hz, t + 0.45, 0.9);
      }
      break;
    case 'pickup':
      [76, 83, 88].forEach((m, i) => playNote(ctx, out, DING, midiToHz(m), t + i * 0.06, 0.15));
      break;
    case 'cheer': {
      // A crowd: bands of noise with a jittery level, swelling in and dying away.
      const dur = 3.2;
      for (const [hz, q, lvl] of [
        [450, 1.2, 0.3],
        [1100, 1.6, 0.26],
        [2600, 2, 0.14],
      ]) {
        const src = noise(ctx, t, true);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = hz;
        f.Q.value = q;
        const jitter = ctx.createGain();
        const curve = new Float32Array(64);
        let seed = hz;
        for (let i = 0; i < curve.length; i++) {
          seed = (seed * 9301 + 49297) % 233280;
          curve[i] = 0.6 + 0.4 * (seed / 233280);
        }
        jitter.gain.setValueCurveAtTime(curve, t, dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(lvl, t + 0.6);
        g.gain.setValueAtTime(lvl, t + 1.4);
        g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
        src.connect(f).connect(jitter).connect(g).connect(out);
        src.stop(t + dur + 0.05);
        src.onended = () => g.disconnect();
      }
      // A few whistles.
      for (const [dt, m] of [
        [0.3, 93],
        [0.9, 95],
      ])
        playNote(ctx, out, { car: 'sine', mod: 'sine', ratio: 1, index: 0, a: 0.05, d: 0.1, s: 1, r: 0.1, gain: 0.04, vib: [7, 60] }, midiToHz(m), t + dt, 0.35);
      break;
    }
  }
}

export const SFX_NAMES: SfxName[] = ['impact', 'truckHit', 'splash', 'nitro', 'land', 'countdown', 'go', 'lap', 'finish', 'pickup', 'cheer'];
