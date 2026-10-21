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
import { getSettings } from '../engine/retro';

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
/** The Pro Racer cup (0.84 m) held up in one hand. */
const TROPHY_SCALE = 0.95;
/** The Pro Racer podium (three discs, 5.34 m wide) scaled so its discs sit over the plates' columns. */
const PODIUM_SCALE = 2;
const CONFETTI = 260;

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
    void loadModel('podium');
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
  /** Step heights by place, from the podium model once it loaded (else the procedural STEP_H). */
  private stepH = [...STEP_H];
  private boxes: THREE.Object3D[] = [];
  private confetti: Confetti | null = null;
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
      this.boxes.push(box);
    }
  }

  /**
   * Swap the procedural steps for the Pro Racer podium (ssg.models.json `podium`, three black discs) once it loads:
   * the disc tops (found by casting rays down at each column) become the step heights, and each disc gets its
   * place number on the front.
   */
  private podiumModel: Promise<void> | null = null;
  private usePodiumModel() {
    this.podiumModel ??= (async () => {
      const model = await loadModel('podium');
      if (!model) return;
      const podium = model.scene.clone(true);
      podium.scale.setScalar(PODIUM_SCALE);
      // The middle disc stands over the winner's column.
      const cx = (COLUMN_OF_PLACE[0] - 1.5) * PITCH;
      podium.position.set(cx, 0, 0);
      podium.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
      });
      this.scene.add(podium);
      podium.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      const heights: number[] = [];
      for (let place = 1; place <= 3; place++) {
        const x = (COLUMN_OF_PLACE[place - 1] - 1.5) * PITCH;
        ray.set(new THREE.Vector3(x, 10, 0), new THREE.Vector3(0, -1, 0));
        heights.push(ray.intersectObject(podium, true)[0]?.point.y ?? STEP_H[place - 1]);
      }
      // Discs taller in place order (the model's middle disc is the 1st place, its sides the same height).
      this.stepH = [...heights, 0];
      for (const b of this.boxes) b.visible = false;
      for (let place = 1; place <= 3; place++) {
        const x = (COLUMN_OF_PLACE[place - 1] - 1.5) * PITCH;
        const h = heights[place - 1];
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const draw = () => {
          const g = c.getContext('2d')!;
          g.clearRect(0, 0, 64, 64);
          g.fillStyle = STEP_COLOURS[place - 1];
          g.font = '44px "Press Start 2P", monospace';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(String(place), 34, 36);
        };
        draw();
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        void document.fonts?.load('40px "Press Start 2P"').then(() => {
          draw();
          tex.needsUpdate = true;
        });
        const size = Math.min(0.9, h * 0.8);
        const label = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
        // On the front of the disc (radius: half the model's 1.63 m depth).
        label.position.set(x, h / 2, 0.82 * PODIUM_SCALE + 0.02);
        this.scene.add(label);
      }
    })();
    return this.podiumModel;
  }

  /** Put the drivers on the podium (top three, plus 4th beside it) and start animating inside `parent`. */
  show(parent: HTMLElement, entries: PodiumEntry[], trucks?: TruckModels | null) {
    this.stop();
    const token = ++this.token;
    parent.appendChild(this.canvas);
    this.clearStage();
    this.ready = (async () => {
      const [drivers, trophy, , truckModels] = await Promise.all([
        loadCharacters(entries.map((e) => driverModel(e.colour))),
        loadModel('trophy'),
        this.usePodiumModel(),
        trucks === undefined ? loadTruckModels() : Promise.resolve(trucks),
      ]);
      if (token !== this.token) return false;
      for (const e of entries) {
        const col = COLUMN_OF_PLACE[e.place - 1] ?? 3;
        const x = (col - 1.5) * PITCH;
        const y = this.stepH[e.place - 1] ?? 0;
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
          ch.play(CLIPS.victory, { once: true, then: CLIPS.trophy, fade: 0 });
          this.winner = ch;
        } else if (e.place === 2) ch.play(CLIPS.clap, { fade: 0, offset });
        else if (e.place === 3) ch.play(CLIPS.fist, { fade: 0, offset });
        else ch.play(ch.has(CLIPS.dejected) ? CLIPS.dejected : CLIPS.idle, { fade: 0, offset });
        this.stage.add(ch.root);
        this.chars.push(ch);
      }
      if (trophy && this.winner) {
        this.trophy = trophy.scene.clone(true);
        this.trophy.scale.setScalar(TROPHY_SCALE);
        this.stage.add(this.trophy);
      }
      // Confetti over the winner's step.
      if (drivers && Object.keys(drivers).length) {
        this.confetti = new Confetti(CONFETTI, (COLUMN_OF_PLACE[0] - 1.5) * PITCH);
        this.stage.add(this.confetti.mesh);
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
    this.confetti?.update(dt);
    if (this.trophy && this.winner) {
      // The trophy rides in the winner's right hand but stays upright (independent of the hand bone's axes).
      const hand = this.winner.socket('hand_r');
      this.winner.root.updateMatrixWorld(true);
      if (hand) hand.getWorldPosition(this.trophy.position);
      else this.winner.root.getWorldPosition(this.trophy.position).add(new THREE.Vector3(0.4, 1.2, 0.3));
      // Hold the cup by its stem: the hand is a little under the bowl.
      this.trophy.position.y -= 0.22;
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
    // The DOS look (F2): a third of the resolution, upscaled with hard pixels.
    const dos = getSettings().dos;
    const bw = dos ? Math.round(w / 3) : w;
    const bh = dos ? Math.round(h / 3) : h;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== bw || size.y !== bh) this.renderer.setSize(bw, bh, false);
    this.canvas.style.imageRendering = dos ? 'pixelated' : '';
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
    this.confetti = null;
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

/** Confetti: small paper squares falling and fluttering over the winner, recycled at the top (one draw call). */
class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private p: { pos: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3; rot: THREE.Euler; phase: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(n: number, private cx: number) {
    const geo = new THREE.PlaneGeometry(0.12, 0.08);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), n);
    this.mesh.frustumCulled = false;
    const colours = ['#f2c94c', '#e8413c', '#3f7be0', '#4fc26a', '#f4f1ea', '#e85fb0'].map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      this.p.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8), rot: new THREE.Euler(), phase: Math.random() * 6 });
      this.spawn(i, true);
      this.mesh.setColorAt(i, colours[i % colours.length]);
    }
  }

  private spawn(i: number, anywhere: boolean) {
    const c = this.p[i];
    c.pos.set(this.cx + (Math.random() - 0.5) * 9, anywhere ? Math.random() * 7 : 6.5 + Math.random() * 1.5, -2 + Math.random() * 4);
    c.vel.set((Math.random() - 0.5) * 0.4, -0.7 - Math.random() * 0.6, 0);
  }

  update(dt: number) {
    this.p.forEach((c, i) => {
      c.phase += dt * 3;
      c.pos.addScaledVector(c.vel, dt);
      c.pos.x += Math.sin(c.phase) * 0.4 * dt;
      if (c.pos.y < 0.02) this.spawn(i, false);
      c.rot.set(c.rot.x + c.spin.x * dt, c.rot.y + c.spin.y * dt, c.rot.z + c.spin.z * dt);
      this.q.setFromEuler(c.rot);
      this.mesh.setMatrixAt(i, this.m.compose(c.pos, this.q, this.one));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
