// One track on screen: its own three.js scene and Rapier world, the Session (track + trucks), the Race flow on top
// (except the proving ground), the race HUD and the fixed camera. The flow (game/flow.ts) builds one per race and
// disposes it afterwards; the WebGL renderer is shared.
//   mode 'test'   the player's truck alone (?scene=test)
//   mode 'race'   a standalone race (?scene=race): Enter restarts, cash adds up for the page session
//   mode 'season' a season race: the flow banks the results and moves on to the shop
//   mode 'demo'   the title screen's attract race: every truck on AI, no records, no banners
import * as THREE from 'three';
import { createScene } from '../engine/renderer';
import { CAMERA, fitFixedCamera, type FreeRect } from '../engine/camera';
import { applyCrowdQuality, applySunQuality } from '../engine/quality';
import { hasModels } from '../race/models';
import { STAND_TOP } from '../track/stadium-view';
import { createWorld, RAPIER } from '../physics/world';
import type { TruckInput, TruckMods } from '../physics/vehicle';
import { Session } from '../race/session';
import { Race } from '../race/race';
import { COLOURS, type Entry } from '../race/roster';
import type { TruckModels } from '../race/models';
import type { TrackData } from '../track/types';
import { RaceHud } from '../ui/race-hud';
import { ResultsScreen } from '../ui/results';
import { retro } from '../engine/retro';

export type RaceMode = 'test' | 'race' | 'season' | 'demo';

export interface RaceSceneOpts {
  data: TrackData;
  /** Shown beside the HUD and on the results ("Rattlesnake Run (R)"). */
  name: string;
  mode: RaceMode;
  models: TruckModels | null;
  /** CPU trucks (0..3), default 3. */
  cpus?: number;
  autopilot?: boolean;
  entries?: Entry[];
  mods?: TruckMods[];
  nitros?: number[];
}

const ORDINAL = ['1ST', '2ND', '3RD', '4TH'];
const _p = new THREE.Vector3();

export class RaceScene {
  readonly scene: THREE.Scene;
  readonly session: Session;
  readonly race: Race | null;
  readonly hud: RaceHud;
  readonly results: ResultsScreen;
  readonly camera = new THREE.PerspectiveCamera();
  readonly sun: THREE.DirectionalLight;
  private frameBox: THREE.Box3;
  /** What the touch controls keep clear (CSS px; ui/touch/controls.ts reserve()), null without them. */
  private reserve: { left: number; right: number; bottom: number } | null = null;
  /** How the camera made room for the touch controls: 'none', 'sides' or 'bottom'. */
  fit: 'none' | 'sides' | 'bottom' = 'none';
  resultsShown = false;

  static async create(opts: RaceSceneOpts) {
    const world = await createWorld();
    return new RaceScene(world, opts);
  }

  private constructor(
    readonly world: RAPIER.World,
    readonly opts: RaceSceneOpts,
  ) {
    const stage = createScene();
    this.scene = stage.scene;
    this.sun = stage.sun;
    const { data, mode } = opts;
    const racing = mode !== 'test';
    const cpus = Math.max(0, Math.min(3, opts.cpus ?? 3));
    this.session = new Session(world, this.scene, data, {
      trucks: racing ? 1 + cpus : 1,
      models: opts.models,
      entries: opts.entries,
      mods: opts.mods,
    });
    this.race = racing ? new Race(this.session, { nitros: opts.nitros, saveRecords: mode !== 'demo' }) : null;
    if (this.race && (opts.autopilot || mode === 'demo')) this.race.autopilot = true;

    // The HUD panel sits over the track's empty spot (hud anchors); the test track puts it top-right.
    const b = this.session.track.bounds;
    const anchors = data.hud ?? { panel: { x: b.max.x - 10, z: b.min.z + 2 }, name: { x: b.max.x - 32, z: b.min.z + 0.5 } };
    this.frameBox = b.clone();
    for (const a of [anchors.panel, anchors.name]) this.frameBox.expandByPoint(new THREE.Vector3(a.x, 0, a.z - 1.5));
    // With the stadium models, show the front rows of the grandstand over the back wall (the original's crowd strip).
    if (hasModels()) this.frameBox.expandByPoint(new THREE.Vector3(b.getCenter(new THREE.Vector3()).x, STAND_TOP.y, b.min.z - STAND_TOP.back));
    this.hud = new RaceHud(document.body, opts.name, anchors, this.session.track.heightAt);
    this.results = new ResultsScreen(document.body);
    // The title's demo race runs under the logo: no HUD panel or track name.
    if (mode === 'demo') this.hud.show(false);
    if (this.race) this.race.onPickup = (text, x, y, z) => this.hud.float(text, x, y, z, text.includes('NITRO') ? '#7fe3ff' : '#ffe14a');
    void this.session.crowd.ready.then(() => this.applyQuality());
    this.resize();
  }

  /** The render quality (engine/quality.ts) on this scene: the sun's shadow map, the skinned fans. */
  applyQuality() {
    applySunQuality(this.sun);
    applyCrowdQuality(this.session.crowd.root);
  }

  get mode() {
    return this.opts.mode;
  }

  /**
   * Fit the camera to the window. With the touch controls up (`reserve`, CSS px from the edges) the track keeps out
   * of either the side columns or the bottom strip, whichever leaves it bigger (side columns on a phone, the bottom
   * strip on a tablet).
   */
  resize(reserve: { left: number; right: number; bottom: number } | null = this.reserve) {
    this.reserve = reserve;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;
    const top = 1 - CAMERA.hudTop;
    if (!reserve) {
      fitFixedCamera(this.camera, this.frameBox, aspect);
      this.fit = 'none';
    } else {
      const sides: FreeRect = { left: -1 + (2 * reserve.left) / w, right: 1 - (2 * reserve.right) / w, bottom: -1, top };
      const bottom: FreeRect = { left: -1, right: 1, bottom: -1 + (2 * reserve.bottom) / h, top };
      const ds = fitFixedCamera(this.camera, this.frameBox, aspect, sides).distance;
      const db = fitFixedCamera(this.camera, this.frameBox, aspect, bottom).distance;
      this.fit = ds < db ? 'sides' : 'bottom';
      if (ds < db) fitFixedCamera(this.camera, this.frameBox, aspect, sides);
    }
    this.hud.place(this.camera);
  }

  /** Screen x (-1..1) of a truck, for audio panning. */
  screenX(i: number) {
    const pos = this.session.racers[i]?.truck.state().pos;
    return pos ? Math.max(-1, Math.min(1, _p.set(pos.x, pos.y, pos.z).project(this.camera).x)) : 0;
  }

  /** One physics step; `input` is player 1's, or one per human (local multiplayer). */
  step(dt: number, input: TruckInput | TruckInput[]) {
    const inputs = Array.isArray(input) ? input : [input];
    if (this.race) this.race.step(dt, inputs);
    else this.session.step(dt, inputs);
  }

  /** The race just reached its results (call once per step; true once). */
  takeResults() {
    if (!this.race || this.race.phase !== 'results' || !this.race.results || this.resultsShown) return false;
    this.resultsShown = true;
    return true;
  }

  restart() {
    this.results.hide();
    this.resultsShown = false;
    if (this.race) this.race.restart();
    else this.session.reset();
  }

  render(renderer: THREE.WebGLRenderer, frameDt: number) {
    const s = this.session;
    s.render();
    const race = this.race;
    if (race) {
      // HUD cells in colour order (red, yellow, blue, grey), whoever drives which.
      const bySlot = race.states.map((_, i) => ({ lap: race.lapShown(i), nitros: s.racers[i].truck.nitros }));
      this.hud.update(
        race.clock,
        COLOURS.map((c) => {
          const i = s.racers.findIndex((r) => r.entry.colour === c);
          return i >= 0 ? bySlot[i] : null;
        }),
      );
      const p = race.phase;
      // The latest human to finish (with 2+ humans the banner names them).
      const done = race.humans.filter((h) => race.states[h].finished).sort((a, b) => race.states[b].finishTime! - race.states[a].finishTime!);
      const me = race.states[done[0] ?? race.humans[0]];
      const who = race.humans.length > 1 && done.length ? `${s.racers[done[0]].entry.nick} ` : '';
      if (this.mode === 'demo') this.hud.setBanner(null);
      else if (p === 'ready') this.hud.setBanner('GET READY!');
      else if (p === 'countdown') this.hud.setBanner(String(3 - Math.min(2, Math.floor(race.phaseT))));
      else if (p === 'racing' && race.clock < 1) this.hud.setBanner('GO!', true);
      else if (p === 'racing' && me.finished && race.clock - (me.finishTime ?? 0) < 3) this.hud.setBanner(`${who}${ORDINAL[me.place - 1]} PLACE!`);
      else this.hud.setBanner(null);
    } else this.hud.update(0, [{ lap: 1, nitros: s.truck.nitros }]);
    this.hud.tick(frameDt, this.camera);
    // Straight to the screen, or through the DOS-look pass (F2, engine/retro.ts).
    retro.render(renderer, this.scene, this.camera);
  }

  /** Raycast the physics ground at sample points and compare with the height grid (catches a transposed field). */
  groundCheck() {
    let max = 0;
    const t = this.session.track;
    const g = t.grid;
    for (let k = 0; k < 60; k++) {
      // Nudged off the cell lines: Rapier's heightfield ray cast can miss exactly on a triangle edge.
      const x = (((k * 37) % 100) / 100 - 0.5) * g.w * 0.9 + 0.013;
      const z = (((k * 61) % 100) / 100 - 0.5) * g.d * 0.9 + 0.017;
      const hit = this.world.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true, undefined, undefined, undefined, undefined, (c) => c.handle === t.ground.handle);
      if (!hit) return Infinity;
      max = Math.max(max, Math.abs(50 - hit.timeOfImpact - t.heightAt(x, z)));
    }
    return max;
  }

  /** Free the world, the GPU buffers of the track and effects, and the DOM overlays. */
  dispose() {
    this.results.hide();
    this.hud.dispose();
    // Truck views may share the generator's GLB geometry with later races: detach them, don't dispose them.
    for (const r of this.session.racers) r.view.dispose();
    this.session.crowd.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose();
        x.dispose();
      }
    });
    this.scene.clear();
    this.session.queue.free();
    this.world.free();
  }
}
