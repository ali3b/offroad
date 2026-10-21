// The 3D podium on the results screen: a small canvas of its own (one WebGL context, made once and reused) with
// three steps, the top three drivers standing on them in front of their trucks and 4th place beside it. The drivers
// are the generator's Synty characters (`driver_<colour>`, ssg.models.json): the winner plays the victory clip and
// then waves both arms with the trophy, 2nd waves, 3rd gives a small wave and 4th slumps. Columns line up with the
// results plates below (2nd, 1st, 3rd, 4th). Without models the results screen keeps its flat pixel drivers.
import * as THREE from 'three';
import { CLIPS, Character, driverModel, loadCharacters } from '../race/characters';
import { loadModel, loadTruckModels, modelIndex, type TruckModels } from '../race/models';
import { TRUCK_LOOK, TruckView } from '../race/truck-view';
import { COLOURS, type Colour } from '../race/roster';

export interface PodiumEntry {
  place: number;
  colour: Colour;
  hex: string;
}

/** Column pitch in metres: the canvas is 4 columns wide, like the plates. */
const PITCH = 3.6;
/** Step height by place (m); 4th stands on the ground. */
const STEP_H = [1.15, 0.8, 0.5, 0];
const STEP_COLOURS = ['#f2c94c', '#cfd3da', '#d08a4a'];
/** Plate order left to right: 2nd, 1st, 3rd, 4th (the winner raised in the middle). */
const COLUMN_OF_PLACE = [1, 0, 2, 3];
const TROPHY_SCALE = 1.7;

let shared: PodiumView | null = null;

/** The podium canvas, created on first use. */
export function podiumView() {
  shared ??= new PodiumView();
  return shared;
}

/** Start loading the drivers, the trophy and the trucks so the first results screen does not wait. */
export function preloadPodium() {
  void modelIndex().then((i) => {
    if (!i) return;
    void loadCharacters(COLOURS.map(driverModel));
    void loadModel('trophy');
  });
}

export class PodiumView {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(20, 3, 0.5, 200);
  private stage = new THREE.Group();
  private chars: Character[] = [];
  private trophy: THREE.Object3D | null = null;
  private winner: Character | null = null;
  private raf = 0;
  private last = 0;
  private token = 0;
  /** Resolves when the current show() has its drivers in place (tests and the ?scene=podium screenshot). */
  ready: Promise<boolean> = Promise.resolve(false);
  /** Draw calls and triangles of the last frame. */
  info = { calls: 0, triangles: 0 };

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'or-podium3d';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);

    this.scene.add(new THREE.HemisphereLight('#fff3dc', '#5a3b22', 1.5));
    const sun = new THREE.DirectionalLight('#fff0d0', 2.4);
    sun.position.set(-6, 12, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 7, bottom: -7, near: 1, far: 40 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, this.stage);
    // A round of arena dirt for the podium to stand on (the results screen's checker shows around it).
    const ground = new THREE.Mesh(new THREE.CircleGeometry(7.6, 48), new THREE.MeshLambertMaterial({ color: '#b5703c' }));
    ground.rotation.x = -Math.PI / 2;
    ground.scale.set(1, 0.5, 1);
    ground.position.z = -1.7;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.buildSteps();
  }

  /** Three steps with their place number on the front. */
  private buildSteps() {
    for (let place = 1; place <= 3; place++) {
      const h = STEP_H[place - 1];
      const x = (COLUMN_OF_PLACE[place - 1] - 1.5) * PITCH;
      // The front face's texture has the face's own aspect, so the number is not squashed on the low steps.
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = Math.round((256 * h) / (PITCH * 0.78));
      const draw = () => {
        const g = c.getContext('2d')!;
        g.fillStyle = STEP_COLOURS[place - 1];
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#1b1b22';
        g.font = `${Math.round(c.height * 0.55)}px "Press Start 2P", monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(place), c.width / 2, c.height * 0.56);
      };
      draw();
      // Redraw once the pixel font has loaded (a canvas does not wait for web fonts).
      void document.fonts?.load('40px "Press Start 2P"').then(() => {
        draw();
        front.needsUpdate = true;
      });
      const front = new THREE.CanvasTexture(c);
      front.colorSpace = THREE.SRGBColorSpace;
      const side = new THREE.MeshLambertMaterial({ color: STEP_COLOURS[place - 1] });
      const mats = [side, side, side, side, new THREE.MeshLambertMaterial({ map: front }), side];
      const box = new THREE.Mesh(new THREE.BoxGeometry(PITCH * 0.78, h, 1.9), mats);
      box.position.set(x, h / 2, 0);
      box.castShadow = true;
      box.receiveShadow = true;
      this.scene.add(box);
    }
  }

  /** Put the drivers on the podium (top three, plus 4th beside it) and start animating inside `parent`. */
  show(parent: HTMLElement, entries: PodiumEntry[], trucks?: TruckModels | null) {
    this.stop();
    const token = ++this.token;
    parent.appendChild(this.canvas);
    this.clearStage();
    this.ready = (async () => {
      const [drivers, trophy, truckModels] = await Promise.all([
        loadCharacters(entries.map((e) => driverModel(e.colour))),
        loadModel('trophy'),
        trucks === undefined ? loadTruckModels() : Promise.resolve(trucks),
      ]);
      if (token !== this.token) return false;
      for (const e of entries) {
        const col = COLUMN_OF_PLACE[e.place - 1] ?? 3;
        const x = (col - 1.5) * PITCH;
        const y = STEP_H[e.place - 1] ?? 0;
        // The truck parked behind its driver, nose towards the camera and turned a little.
        const tv = new TruckView(e.hex, truckModels?.[e.colour]);
        tv.root.position.set(x + (e.place === 4 ? 0.3 : 0), TruckView.groundLift, -4.1);
        tv.root.rotation.y = e.place === 4 ? 0.55 : col < 1.5 ? 0.3 : -0.3;
        this.stage.add(tv.root);
        const model = drivers[driverModel(e.colour)];
        if (!model) continue;
        const ch = new Character(model);
        ch.root.position.set(x, y, e.place === 4 ? 0.4 : 0);
        ch.root.scale.setScalar(TRUCK_LOOK);
        ch.root.rotation.y = e.place === 4 ? -0.35 : 0;
        // Stagger the loops so the waves are not in step.
        const offset = e.place * 0.37;
        if (e.place === 1) {
          ch.play(CLIPS.victory, { once: true, then: CLIPS.cheer, fade: 0 });
          this.winner = ch;
        } else if (e.place === 2) ch.play(CLIPS.wave, { fade: 0, offset });
        else if (e.place === 3) ch.play(ch.has(CLIPS.waveSmall) ? CLIPS.waveSmall : CLIPS.wave, { fade: 0, offset });
        else ch.play(ch.has(CLIPS.dejected) ? CLIPS.dejected : CLIPS.idle, { fade: 0, offset });
        this.stage.add(ch.root);
        this.chars.push(ch);
      }
      if (trophy && this.winner) {
        this.trophy = trophy.scene.clone(true);
        this.trophy.scale.setScalar(TROPHY_SCALE);
        this.stage.add(this.trophy);
      }
      this.tick(0);
      return true;
    })();
    this.last = performance.now();
    const frame = (now: number) => {
      if (token !== this.token) return;
      this.tick(Math.min(0.1, (now - this.last) / 1000));
      this.last = now;
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Advance the clips by dt and draw (also used directly by tests). */
  tick(dt: number) {
    for (const c of this.chars) c.update(dt);
    if (this.trophy && this.winner) {
      // The trophy rides in the winner's right hand but stays upright (independent of the hand bone's axes).
      const hand = this.winner.socket('hand_r');
      this.winner.root.updateMatrixWorld(true);
      if (hand) hand.getWorldPosition(this.trophy.position);
      else this.winner.root.getWorldPosition(this.trophy.position).add(new THREE.Vector3(0.4, 1.2, 0.3));
      this.trophy.position.y -= 0.12;
      this.trophy.rotation.y = Math.sin(performance.now() / 600) * 0.25;
    }
    this.resize();
    this.renderer.render(this.scene, this.camera);
    this.info = { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }

  /** Size the drawing buffer to the canvas' CSS box and frame the four columns across its width. */
  private resize() {
    const w = this.canvas.clientWidth || 900;
    const h = this.canvas.clientHeight || 260;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
    const aspect = w / h;
    // Fit 4 columns (4 × PITCH) across at the drivers' depth.
    const dist = 15;
    const halfW = (4 * PITCH) / 2 + 0.3;
    this.camera.aspect = aspect;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfW / dist / aspect));
    this.camera.position.set(0, 4.2, dist);
    this.camera.lookAt(0, 1.8, -0.8);
    this.camera.updateProjectionMatrix();
  }

  private clearStage() {
    for (const c of this.chars) c.mixer.stopAllAction();
    this.chars = [];
    this.winner = null;
    this.trophy = null;
    this.stage.clear();
  }

  stop() {
    ++this.token;
    cancelAnimationFrame(this.raf);
  }

  /** Stop animating and take the canvas off the page (the GL context stays for the next results screen). */
  hide() {
    this.stop();
    this.canvas.remove();
    this.clearStage();
  }
}
