// Boot: renderer, Rapier world, the scene picked by ?scene= (default `test`), the fixed camera, the loop, the HUD.
// window.__or is the test/tool handle (scripts/load-check.mjs, drive-check.mjs, record.mjs).
import * as THREE from 'three';
import { createStage } from './engine/renderer';
import { fitFixedCamera, CAMERA } from './engine/camera';
import { Loop } from './engine/loop';
import { initKeyboard, readInput, resetRequested, wasPressed } from './engine/input';
import { createWorld, RAPIER } from './physics/world';
import { NO_INPUT, TUNING, type TruckInput } from './physics/vehicle';
import { Session } from './race/session';
import { Hud } from './ui/hud';
import { DebugOverlay } from './ui/debug';
import type { TrackData } from './track/types';
import testTrack from './track/test.json';

const TRACKS: Record<string, TrackData> = { test: testTrack as TrackData };
/** Scenes: `test` drives the placeholder truck on the test track. */
const SCENES = ['test'] as const;

declare global {
  interface Window {
    __or: Record<string, unknown> & { ready: boolean };
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const sceneName = params.get('scene') ?? 'test';
  window.__or = { ready: false, scene: sceneName };
  if (!(SCENES as readonly string[]).includes(sceneName)) throw new Error(`unknown scene "${sceneName}" (have: ${SCENES.join(', ')})`);

  const stage = createStage(document.body);
  const world = await createWorld();
  const session = new Session(world, stage.scene, TRACKS[params.get('track') ?? 'test']);

  const camera = new THREE.PerspectiveCamera();
  const frame = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    stage.renderer.setSize(w, h);
    fitFixedCamera(camera, session.track.bounds, w / h);
  };
  frame();
  window.addEventListener('resize', frame);

  initKeyboard();
  const hud = new Hud(document.body);
  const debug = new DebugOverlay(document.body);
  if (params.has('debug')) debug.toggle(true);

  let override: TruckInput | null = null;
  const loop = new Loop({
    step: (dt) => {
      if (resetRequested()) session.reset();
      session.step(dt, override ?? readInput());
    },
    render: () => {
      if (wasPressed('F3')) debug.toggle();
      session.render();
      const s = session.truck.state();
      hud.update(s);
      debug.update(s, loop);
      stage.renderer.render(stage.scene, camera);
    },
  });

  /** Raycast the physics ground at sample points and compare with the height grid (catches a transposed field). */
  const groundCheck = () => {
    let max = 0;
    const g = session.track.grid;
    for (let k = 0; k < 60; k++) {
      const x = (((k * 37) % 100) / 100 - 0.5) * g.w * 0.9;
      const z = (((k * 61) % 100) / 100 - 0.5) * g.d * 0.9;
      const hit = world.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true, undefined, undefined, undefined, undefined, (c) => c.handle === session.track.ground.handle);
      if (!hit) return Infinity;
      max = Math.max(max, Math.abs(50 - hit.timeOfImpact - session.track.heightAt(x, z)));
    }
    return max;
  };

  Object.assign(window.__or, {
    THREE,
    session,
    tuning: TUNING,
    camera: CAMERA,
    loop,
    truck: () => session.truck.state(),
    /** Drive from a test: partial input merged over no input; null hands control back to the keyboard/pad. */
    setInput: (i: Partial<TruckInput> | null) => (override = i ? { ...NO_INPUT, ...i } : null),
    reset: () => session.reset(),
    place: (x: number, z: number, heading = 0, lift = 1.4) => session.truck.place({ x, z, y: session.track.heightAt(x, z) + lift, heading }),
    advance: (s: number) => loop.advance(s),
    debug: (on?: boolean) => debug.toggle(on),
    groundCheck,
    heightAt: (x: number, z: number) => session.track.heightAt(x, z),
  });
  // A live getter (Object.assign would copy the value once).
  Object.defineProperty(window.__or, 'simTime', { get: () => loop.simTime, enumerable: true });

  // Let the truck settle on its springs before the first frame is judged.
  loop.advance(1);
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
