// ?scene=audio: a plain DOM bench for every song and sound. Everything goes through a local event bus, so it also
// exercises attachAudio() and the event contract in ./types.ts. window.__orAudio is the check handle.
import { attachAudio, renderSfx, renderSong, SFX_NAMES, SONGS, songSeconds } from './index';
import { tokens } from './sequencer';
import type { AudioEvents, AudioEventType } from './types';

type Handler = (e: never) => void;
function localBus() {
  const map = new Map<string, Set<Handler>>();
  return {
    on<K extends AudioEventType>(type: K, fn: (e: AudioEvents[K]) => void) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)!.add(fn as Handler);
    },
    emit<K extends AudioEventType>(type: K, e: AudioEvents[K]) {
      map.get(type)?.forEach((fn) => (fn as (e: AudioEvents[K]) => void)(e));
    },
  };
}

const CSS = `
  body { overflow:auto !important; color:#f3e6d0; font:14px/1.4 system-ui, sans-serif; padding:20px 24px; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:.04em; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:#d9a55b; margin:22px 0 8px; }
  .row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  button { background:#3a2817; color:#f3e6d0; border:1px solid #7a5532; border-radius:6px; padding:7px 12px; font:inherit; cursor:pointer; }
  button:hover { background:#4e351e; }
  button.on { background:#b8742a; border-color:#e0a050; color:#1a120c; }
  label { display:flex; gap:8px; align-items:center; min-width:260px; }
  input[type=range] { width:180px; }
  .note { color:#b49a7c; font-size:12px; }
  #status { margin-top:6px; color:#b49a7c; }
`;

export function startAudioScene(root: HTMLElement) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.title = 'Off Road: audio bench';
  const bus = localBus();
  const audio = attachAudio(bus);

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, parent: HTMLElement = root): HTMLElementTagNameMap[K] => {
    const n = Object.assign(document.createElement(tag), props);
    parent.appendChild(n);
    return n;
  };
  const section = (title: string) => {
    el('h2', { textContent: title });
    return el('div', { className: 'row' });
  };

  el('h1', { textContent: 'Off Road: audio bench' });
  el('div', { className: 'note', textContent: 'Click anywhere or press a key to start audio. M mutes. Everything is synthesised (2-operator FM + noise).' });
  const status = el('div', { id: 'status' });
  const refresh = () => {
    status.textContent = `context: ${audio.ctx?.state ?? 'locked'} · song: ${audio.currentSong ?? 'none'} · ${audio.settings.muted ? 'MUTED' : 'sound on'}`;
  };
  setInterval(refresh, 250);
  audio.onChange(refresh);

  const songs = section('Music');
  for (const name of Object.keys(SONGS)) {
    const s = SONGS[name];
    el('button', { textContent: `${name}: ${s.title}`, title: `${s.bpm} bpm, ${songSeconds(s).toFixed(1)} s${s.loop ? ' loop' : ''}`, onclick: () => audio.playSong(name) }, songs).dataset.song = name;
  }
  el('button', { textContent: 'stop', onclick: () => audio.stopMusic() }, songs);

  const fx = section('Sound effects');
  const fire: Record<string, () => void> = {
    impact: () => bus.emit('impact', { strength: 0.8, with: 'wall' }),
    'impact (soft)': () => bus.emit('impact', { strength: 0.2, with: 'wall' }),
    'truck hit': () => bus.emit('impact', { strength: 0.7, with: 'truck' }),
    splash: () => bus.emit('splash', {}),
    nitro: () => bus.emit('nitro', { truck: 0 }),
    land: () => bus.emit('land', { strength: 0.8 }),
    'countdown 3-2-1-go': () => {
      [3, 2, 1].forEach((n, i) => setTimeout(() => bus.emit('countdown', { n }), i * 700));
      setTimeout(() => bus.emit('go', undefined), 2100);
    },
    go: () => bus.emit('go', undefined),
    lap: () => bus.emit('lap', { truck: 0, lap: 2 }),
    finish: () => bus.emit('finish', { truck: 0, place: 2 }),
    'finish 1st (+cheer)': () => bus.emit('finish', { truck: 0, place: 1 }),
    pickup: () => bus.emit('pickup', { kind: 'cash' }),
    cheer: () => audio.sfx('cheer'),
  };
  for (const [name, f] of Object.entries(fire)) el('button', { textContent: name, onclick: f }, fx).dataset.sfx = name;

  const sc = section('Scenes (event bus)');
  for (const name of ['title', 'race', 'podium', 'shop', 'none']) el('button', { textContent: `scene ${name}`, onclick: () => bus.emit('scene', { name }) }, sc).dataset.scene = name;

  const eng = section('Engines');
  const state = { rpm: 0.3, throttle: 0.5, x: 0, skid: 0, running: [true, false, false, false] };
  const slider = (label: string, key: 'rpm' | 'throttle' | 'x' | 'skid', min = 0, max = 1) => {
    const l = el('label', { textContent: label }, eng);
    const i = el('input', { type: 'range', min: String(min), max: String(max), step: '0.01', value: String(state[key]) }, l);
    i.dataset.key = key;
    i.oninput = () => (state[key] = Number(i.value));
  };
  slider('rpm', 'rpm');
  slider('throttle', 'throttle');
  slider('pan x', 'x', -1, 1);
  slider('skid', 'skid');
  const trucks = el('div', { className: 'row' });
  state.running.forEach((on, t) => {
    const b = el('button', { textContent: `truck ${t}${t === 0 ? ' (player)' : ''}`, className: on ? 'on' : '' }, trucks);
    b.dataset.truck = String(t);
    b.onclick = () => {
      state.running[t] = !state.running[t];
      b.className = state.running[t] ? 'on' : '';
    };
  });
  let engineOn = false;
  const engBtn = el('button', { textContent: 'engines: off' }, trucks);
  engBtn.id = 'engines';
  engBtn.onclick = () => {
    engineOn = !engineOn;
    engBtn.textContent = `engines: ${engineOn ? 'on' : 'off'}`;
    engBtn.className = engineOn ? 'on' : '';
  };
  setInterval(() => {
    if (!engineOn) return;
    state.running.forEach((on, t) => {
      if (!on) return;
      // CPU trucks wobble around the slider values so they sound alive.
      const w = t === 0 ? 0 : Math.sin(performance.now() / (700 + t * 230)) * 0.12;
      bus.emit('engine', { truck: t, rpm: Math.max(0, Math.min(1, state.rpm + w)), throttle: state.throttle, x: t === 0 ? state.x : Math.max(-1, Math.min(1, state.x + (t - 2) * 0.4)) });
      if (state.skid > 0.01) bus.emit('skid', { truck: t, amount: state.skid, x: state.x });
    });
  }, 50);

  const vol = section('Volume (saved in localStorage or.audio)');
  for (const k of ['master', 'music', 'sfx'] as const) {
    const l = el('label', { textContent: k }, vol);
    const i = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(audio.settings[k]) }, l);
    i.dataset.vol = k;
    i.oninput = () => audio.setVolume(k, Number(i.value));
  }
  el('button', { textContent: 'mute (M)', onclick: () => audio.toggleMute() }, vol);

  window.__orAudio = {
    audio,
    bus,
    songs: Object.keys(SONGS),
    sfx: SFX_NAMES,
    renderSong,
    renderSfx,
    tokens,
  };
  refresh();
}

declare global {
  interface Window {
    __orAudio: Record<string, unknown>;
  }
}
