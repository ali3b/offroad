// Boot: renderer, Rapier world, the scene picked by ?scene= (default `test`), the fixed camera, the loop, the HUD.
//   ?scene=test               the player's truck alone on a track (default track `test`)
//   ?scene=race&track=<id>    a 4-truck race (default track `rattlesnake`); &reverse drives the reversed variant
//   &cpus=N (0..3) races fewer CPU trucks; &autopilot drives the player's truck by AI (tests, demos); &debug = F3 overlay
// window.__or is the test/tool handle (scripts/load-check.mjs, drive-check.mjs, race-check.mjs, record.mjs).
import * as THREE from 'three';
import { createStage } from './engine/renderer';
import { fitFixedCamera, CAMERA } from './engine/camera';
import { Loop } from './engine/loop';
import { confirmPressed, initKeyboard, readInput, resetRequested, wasPressed } from './engine/input';
import { createWorld, RAPIER } from './physics/world';
import { NO_INPUT, TUNING, type TruckInput } from './physics/vehicle';
import { Session } from './race/session';
import { Race } from './race/race';
import { events } from './race/events';
import { loadTruckModels } from './race/models';
import { RaceHud } from './ui/race-hud';
import { ResultsScreen } from './ui/results';
import { DebugOverlay } from './ui/debug';
import { getTrack } from './track/tracks';
// Audio: synthesised music + SFX (src/audio), fed from the race events by bridgeAudio; M mutes.
import { getAudio } from './audio';
import { bridgeAudio } from './audio/bridge';

/** Scenes: `test` drives the player's truck alone; `race` runs a full 4-truck race; `audio` is the sound bench. */
const SCENES = ['test', 'race', 'audio'] as const;

declare global {
  interface Window {
    __or: Record<string, unknown> & { ready: boolean };
  }
}

/** Prize money won this page session (the season and shop come in OR3). */
let cash = 0;

async function boot() {
  const params = new URLSearchParams(location.search);
  const sceneName = params.get('scene') ?? 'test';
  window.__or = { ready: false, scene: sceneName };
  if (!(SCENES as readonly string[]).includes(sceneName)) throw new Error(`unknown scene "${sceneName}" (have: ${SCENES.join(', ')})`);
  if (sceneName === 'audio') {
    const { startAudioScene } = await import('./audio/dev-scene');
    startAudioScene(document.body);
    window.__or.ready = true;
    return;
  }
  const isRace = sceneName === 'race';
  const reversed = params.has('reverse') && params.get('reverse') !== '0';
  const data = getTrack(params.get('track') ?? (isRace ? 'rattlesnake' : 'test'), reversed);

  const stage = createStage(document.body);
  const [world, models] = await Promise.all([createWorld(), loadTruckModels()]);
  // &cpus=0..3 races fewer CPU trucks (tuning and lap-time probes).
  const cpus = Math.max(0, Math.min(3, Number(params.get('cpus') ?? 3)));
  const session = new Session(world, stage.scene, data, { trucks: isRace ? 1 + cpus : 1, models });
  const race = isRace ? new Race(session) : null;
  if (race && params.has('autopilot')) race.autopilot = true;

  // The HUD panel sits over the track's empty spot (hud anchors); the test track puts it top-right.
  const b = session.track.bounds;
  const anchors = data.hud ?? { panel: { x: b.max.x - 10, z: b.min.z + 2 }, name: { x: b.max.x - 32, z: b.min.z + 0.5 } };
  const frameBox = b.clone();
  for (const a of [anchors.panel, anchors.name]) frameBox.expandByPoint(new THREE.Vector3(a.x, 0, a.z - 1.5));

  const camera = new THREE.PerspectiveCamera();
  const hud = new RaceHud(document.body, data.name + (reversed ? ' (R)' : ''), anchors, session.track.heightAt);
  const frame = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    stage.renderer.setSize(w, h);
    fitFixedCamera(camera, frameBox, w / h);
    hud.place(camera);
  };
  frame();
  window.addEventListener('resize', frame);

  const _p = new THREE.Vector3();
  bridgeAudio(events, (i) => {
    const pos = session.racers[i]?.truck.state().pos;
    return pos ? Math.max(-1, Math.min(1, _p.set(pos.x, pos.y, pos.z).project(camera).x)) : 0;
  });

  initKeyboard();
  const debug = new DebugOverlay(document.body);
  const results = new ResultsScreen(document.body);
  if (params.has('debug')) debug.toggle(true);
  if (race) {
    race.onPickup = (text, x, y, z) => hud.float(text, x, y, z, text.includes('NITRO') ? '#7fe3ff' : '#ffe14a');
  }

  let override: TruckInput | null = null;
  let resultsShown = false;
  const restart = () => {
    results.hide();
    resultsShown = false;
    race?.restart();
  };
  const loop = new Loop({
    step: (dt) => {
      if (resetRequested()) {
        if (race) restart();
        else session.reset();
      }
      const input = override ?? readInput();
      if (race) race.step(dt, input);
      else session.step(dt, [input]);
    },
    render: (_alpha, frameDt) => {
      if (wasPressed('F3')) debug.toggle();
      session.render();
      const s = session.truck.state();
      if (race) {
        const snap = race.states;
        hud.update(race.clock, snap.map((st, i) => ({ lap: race.lapShown(i), nitros: session.racers[i].truck.nitros })));
        const p = race.phase;
        const me = race.states[0];
        if (p === 'ready') hud.setBanner('GET READY!');
        else if (p === 'countdown') hud.setBanner(String(3 - Math.min(2, Math.floor(race.phaseT))));
        else if (p === 'racing' && race.clock < 1) hud.setBanner('GO!', true);
        else if (p === 'racing' && me.finished && race.clock - (me.finishTime ?? 0) < 3) hud.setBanner(`${['1ST', '2ND', '3RD', '4TH'][me.place - 1]} PLACE!`);
        else hud.setBanner(null);
        if (p === 'results' && !resultsShown && race.results) {
          resultsShown = true;
          cash += race.results[0].prize + race.results[0].bags;
          results.show({ track: hud.name.textContent ?? data.name, results: race.results, entries: session.racers.map((r) => r.entry), record: race.record, newRecord: race.newRecord, cash });
        }
        if (resultsShown && confirmPressed()) restart();
      } else hud.update(0, [{ lap: 1, nitros: s.nitros }]);
      hud.tick(frameDt, camera);
      debug.update(s, loop);
      stage.renderer.render(stage.scene, camera);
    },
  });

  /** Raycast the physics ground at sample points and compare with the height grid (catches a transposed field). */
  const groundCheck = () => {
    let max = 0;
    const g = session.track.grid;
    for (let k = 0; k < 60; k++) {
      // Nudged off the cell lines: Rapier's heightfield ray cast can miss exactly on a triangle edge.
      const x = (((k * 37) % 100) / 100 - 0.5) * g.w * 0.9 + 0.013;
      const z = (((k * 61) % 100) / 100 - 0.5) * g.d * 0.9 + 0.017;
      const hit = world.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true, undefined, undefined, undefined, undefined, (c) => c.handle === session.track.ground.handle);
      if (!hit) return Infinity;
      max = Math.max(max, Math.abs(50 - hit.timeOfImpact - session.track.heightAt(x, z)));
    }
    return max;
  };

  Object.assign(window.__or, {
    THREE,
    RAPIER,
    session,
    race,
    events,
    tuning: TUNING,
    camera: CAMERA,
    loop,
    models: !!models,
    truck: () => session.truck.state(),
    trucks: () => session.racers.map((r) => r.truck.state()),
    /** Race snapshot: phase, clock, per-truck laps/gates/places, results, record, pickups. */
    raceState: () => race?.snapshot() ?? null,
    autopilot: (on = true) => race && (race.autopilot = on),
    restart,
    resultsVisible: () => results.visible,
    /** Drive from a test: partial input merged over no input; null hands control back to the keyboard/pad. */
    setInput: (i: Partial<TruckInput> | null) => (override = i ? { ...NO_INPUT, ...i } : null),
    reset: () => session.reset(),
    place: (x: number, z: number, heading = 0, lift = 1.4) => session.truck.place({ x, z, y: session.track.heightAt(x, z) + lift, heading }),
    advance: (s: number) => loop.advance(s),
    debug: (on?: boolean) => debug.toggle(on),
    groundCheck,
    heightAt: (x: number, z: number) => session.track.heightAt(x, z),
    audio: getAudio(),
    line: () => session.track.line && { length: session.track.line.length, points: session.track.line.samples(2) },
  });
  // A live getter (Object.assign would copy the value once).
  Object.defineProperty(window.__or, 'simTime', { get: () => loop.simTime, enumerable: true });

  // Let the trucks settle on their springs before the first frame is judged (the race holds them on the grid).
  loop.advance(isRace ? 0.5 : 1);
  loop.start();
  window.__or.ready = true;
}

boot().catch((e) => {
  console.error(e);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#f88;padding:16px;font:14px monospace';
  pre.textContent = `Off Road failed to start:\n${e?.stack ?? e}`;
  document.body.appendChild(pre);
});
