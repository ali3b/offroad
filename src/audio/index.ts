// Off Road audio: one AudioSystem per page. attachAudio(bus) subscribes it to the race events (./types.ts).
// The AudioContext is created on the first key press or click (autoplay policy); events before that are dropped,
// except the latest scene, whose music starts on unlock. M toggles mute.
import { loadSettings, saveSettings } from './settings';
import { EngineVoice, playSfx, SkidVoice, type SfxName, type SfxParams } from './sfx';
import { SongPlayer, scheduleAll, songSeconds } from './sequencer';
import { SONGS } from './songs';
import type { AudioBus, AudioEvents, AudioSettings } from './types';

export type { AudioBus, AudioEvents, AudioSettings } from './types';
export { SONGS } from './songs';
export { SFX_NAMES } from './sfx';

/** Master chain shared by live and offline contexts: music + sfx buses → master → gentle limiter → out. */
function buildMix(ctx: BaseAudioContext, out: AudioNode) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 4;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  const master = ctx.createGain();
  const music = ctx.createGain();
  const sfx = ctx.createGain();
  music.connect(master);
  sfx.connect(master);
  master.connect(limiter).connect(out);
  return { master, music, sfx, limiter };
}

const RACE_SONGS = ['race1', 'race2'];
const ENGINE_TIMEOUT = 0.4;

export class AudioSystem {
  ctx: AudioContext | null = null;
  settings: AudioSettings = loadSettings();
  /** Which truck is the player's (louder engine; lap/finish sounds). */
  playerTruck = 0;
  private mix: ReturnType<typeof buildMix> | null = null;
  private player: SongPlayer | null = null;
  private songName: string | null = null;
  private wantedSong: string | null = null;
  private engines = new Map<number, EngineVoice>();
  private skids = new Map<number, SkidVoice>();
  private raceCount = 0;
  private pendingRace: string | null = null;
  private raceTimer: ReturnType<typeof setTimeout> | null = null;
  private reaper: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    const unlock = () => this.unlock();
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['range', 'checkbox', 'button', 'radio'].includes(t.type));
      if (e.code === 'KeyM' && !e.repeat && !typing) this.toggleMute();
    });
  }

  get unlocked() {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Create/resume the AudioContext. Safe to call repeatedly; must run inside a user gesture the first time. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.mix = buildMix(this.ctx, this.ctx.destination);
      this.applyVolumes();
      this.reaper = setInterval(() => this.reap(), 150);
      if (this.wantedSong) this.playSong(this.wantedSong);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /**
   * Tools (scripts/trailer.mjs): a MediaStream of the final mix (after the limiter), for recording the game's sound
   * alongside a video. Unlocks the context if needed; null before it exists.
   */
  captureStream(): MediaStream | null {
    this.unlock();
    if (!this.ctx || !this.mix) return null;
    const tap = this.ctx.createMediaStreamDestination();
    this.mix.limiter.connect(tap);
    return tap.stream;
  }

  // ---- settings ------------------------------------------------------------------------------------------------

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setVolume(kind: 'master' | 'music' | 'sfx', v: number) {
    this.settings[kind] = Math.max(0, Math.min(1, v));
    this.commit();
  }

  setMuted(m: boolean) {
    this.settings.muted = m;
    this.commit();
  }

  toggleMute() {
    this.setMuted(!this.settings.muted);
  }

  private commit() {
    saveSettings(this.settings);
    this.applyVolumes();
    this.listeners.forEach((f) => f());
  }

  private applyVolumes() {
    if (!this.ctx || !this.mix) return;
    const now = this.ctx.currentTime;
    const s = this.settings;
    this.mix.master.gain.setTargetAtTime(s.muted ? 0 : s.master, now, 0.03);
    this.mix.music.gain.setTargetAtTime(s.music * 0.8, now, 0.03);
    this.mix.sfx.gain.setTargetAtTime(s.sfx, now, 0.03);
  }

  // ---- music ---------------------------------------------------------------------------------------------------

  get currentSong() {
    return this.songName;
  }

  playSong(name: string) {
    if (!SONGS[name]) throw new Error(`unknown song "${name}"`);
    this.wantedSong = name;
    if (!this.ctx || !this.mix) return;
    this.player?.stop();
    const p = new SongPlayer(this.ctx, this.mix.music, SONGS[name]);
    p.onEnd = () => {
      if (this.player === p) {
        this.player = null;
        this.songName = null;
        this.wantedSong = null;
      }
    };
    this.player = p;
    this.songName = name;
    p.start();
  }

  stopMusic() {
    this.wantedSong = null;
    this.songName = null;
    this.player?.stop();
    this.player = null;
  }

  // ---- sfx -----------------------------------------------------------------------------------------------------

  sfx(name: SfxName, p: SfxParams = {}) {
    if (!this.ctx || !this.mix || this.ctx.state !== 'running') return;
    playSfx(this.ctx, this.mix.sfx, name, p);
  }

  engine(e: AudioEvents['engine']) {
    if (!this.ctx || !this.mix) return;
    let v = this.engines.get(e.truck);
    if (!v) this.engines.set(e.truck, (v = new EngineVoice(this.ctx, this.mix.sfx, e.truck)));
    v.set(e.rpm, e.throttle, e.x, e.truck === this.playerTruck);
  }

  skid(e: AudioEvents['skid']) {
    if (!this.ctx || !this.mix) return;
    let v = this.skids.get(e.truck);
    if (!v) this.skids.set(e.truck, (v = new SkidVoice(this.ctx, this.mix.sfx)));
    v.set(e.truck === this.playerTruck ? e.amount : e.amount * 0.5, e.x ?? 0);
  }

  /** Silence engines/skids that stopped getting updates. */
  private reap() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of [...this.engines.values(), ...this.skids.values()]) if (v.lastUpdate >= 0 && now - v.lastUpdate > ENGINE_TIMEOUT) v.silence();
  }

  /** Drop all continuous voices (scene change). */
  stopVoices() {
    for (const v of this.engines.values()) v.dispose();
    for (const v of this.skids.values()) v.dispose();
    this.engines.clear();
    this.skids.clear();
  }

  // ---- events --------------------------------------------------------------------------------------------------

  scene(name: string) {
    this.stopVoices();
    if (this.raceTimer) clearTimeout(this.raceTimer);
    this.pendingRace = null;
    if (name === 'title') this.playSong('title');
    else if (name === 'shop') this.playSong('shop');
    else if (name === 'podium' || name === 'results') this.playSong('fanfare');
    else if (name === 'race' || RACE_SONGS.includes(name)) {
      // Race music waits for the green light (falls back to 8 s if no `go` arrives).
      this.stopMusic();
      this.pendingRace = RACE_SONGS.includes(name) ? name : RACE_SONGS[this.raceCount++ % RACE_SONGS.length];
      this.raceTimer = setTimeout(() => this.startRaceMusic(), 8000);
    } else this.stopMusic();
  }

  private startRaceMusic() {
    if (this.raceTimer) clearTimeout(this.raceTimer);
    this.raceTimer = null;
    if (this.pendingRace) this.playSong(this.pendingRace);
    this.pendingRace = null;
  }

  /** Subscribe to an event bus. */
  attach(bus: AudioBus) {
    bus.on('engine', (e) => this.engine(e));
    bus.on('skid', (e) => this.skid(e));
    bus.on('impact', (e) => this.sfx(e.with === 'truck' ? 'truckHit' : 'impact', { strength: e.strength, x: e.x }));
    bus.on('splash', (e) => this.sfx('splash', { x: e?.x }));
    bus.on('nitro', (e) => this.sfx('nitro', { x: e.x, strength: e.truck === this.playerTruck ? 1 : 0.5 }));
    bus.on('land', (e) => this.sfx('land', { strength: e.strength, x: e.x }));
    bus.on('countdown', () => this.sfx('countdown'));
    bus.on('go', () => {
      this.sfx('go');
      this.startRaceMusic();
    });
    bus.on('lap', (e) => {
      if (e.truck === this.playerTruck && e.lap > 0) this.sfx('lap');
    });
    bus.on('finish', (e) => {
      if (e.truck === this.playerTruck || e.place === 1) this.sfx('finish');
      if (e.truck === this.playerTruck && e.place === 1) this.sfx('cheer');
    });
    bus.on('pickup', () => this.sfx('pickup'));
    bus.on('scene', (e) => this.scene(e.name));
    return this;
  }

  dispose() {
    this.stopMusic();
    this.stopVoices();
    if (this.reaper) clearInterval(this.reaper);
    void this.ctx?.close();
  }
}

let system: AudioSystem | null = null;
/** The page's audio system (created on first use; installs the unlock and M listeners). */
export function getAudio() {
  return (system ??= new AudioSystem());
}

/** Wire the audio system to the race event bus. */
export function attachAudio(bus: AudioBus) {
  return getAudio().attach(bus);
}

/** Loudness of a render: RMS over all channels and the absolute peak. */
export interface RenderStats {
  rms: number;
  peak: number;
  seconds: number;
}

async function renderOffline(seconds: number, fill: (ctx: OfflineAudioContext, bus: { music: AudioNode; sfx: AudioNode }) => void): Promise<RenderStats> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  const mix = buildMix(ctx, ctx.destination);
  mix.master.gain.value = 1;
  mix.music.gain.value = 0.8;
  fill(ctx, mix);
  const buf = await ctx.startRendering();
  let sum = 0;
  let peak = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    n += d.length;
  }
  return { rms: Math.sqrt(sum / n), peak, seconds };
}

/** Render `seconds` of a song offline at full volume (checks: audible, not clipping). */
export const renderSong = (name: string, seconds = 4) => renderOffline(seconds, (ctx, bus) => scheduleAll(ctx, bus.music, SONGS[name], 0.05, seconds));
/** Render a one-shot offline. */
export const renderSfx = (name: SfxName, seconds = 2, p: SfxParams = {}) => renderOffline(seconds, (ctx, bus) => playSfx(ctx, bus.sfx, name, p, 0.05));
export { songSeconds };
