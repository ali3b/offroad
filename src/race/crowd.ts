// The grandstand crowd: the generator's Synty fans (ssg.models.json `fan_a/b/c`) in place of build.ts's coloured
// boxes. A few fans are real skinned characters with their own mixer (idle, then a wave when the crowd cheers);
// everyone else is a pose baked once into static geometry (race/characters.ts bakePose, OR-FB-012) and drawn as one
// InstancedMesh per fan model per pose, so ~40 fans cost a handful of draw calls and no skeletons.
// The crowd cheers on the event bus: a truck finishing, or a big jump landing.
// Without models nothing changes and the boxes stay.
import * as THREE from 'three';
import { bakePose, Character, CLIPS, FANS, loadCharacters, type BakedPose } from './characters';
import { events } from './events';
import type { Track } from '../track/build';
import type { LoadedModel } from './models';

/** Skinned, animated fans (the rest are baked poses). */
const ANIMATED = 6;
/** Fans are drawn a touch bigger than life, like the trucks and props, so they read at the far camera. */
const FAN_LOOK = 1.05;
/** A landing after this much air time (s) is a big jump. */
const BIG_JUMP = 0.5;
/** Poses baked per fan model: standing idle, then two frames of the two-arm wave for the cheer. */
const POSES = [
  { clip: CLIPS.idle, t: 0.6 },
  { clip: CLIPS.cheer, t: 0.12 },
  { clip: CLIPS.cheer, t: 0.5 },
] as const;

interface Fan {
  /** Fan model index (FANS). */
  type: number;
  pos: THREE.Vector3;
  yaw: number;
  phase: number;
  character?: Character;
}

/** Baked poses per fan model, shared by every race (the pages's GPU buffers live as long as the page). */
const baked = new Map<string, BakedPose[][]>();

function bakedFor(name: string, model: LoadedModel) {
  let b = baked.get(name);
  if (!b) {
    b = POSES.map((p) => bakePose(model, p.clip, p.t));
    baked.set(name, b);
  }
  return b;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Crowd {
  readonly root = new THREE.Group();
  private fans: Fan[] = [];
  /** [fan model][pose] → instanced mesh(es). */
  private meshes: THREE.InstancedMesh[][][] = [];
  private cheerUntil = 0;
  private time = 0;
  private lastTime = -1;
  private off: (() => void)[] = [];
  private disposed = false;
  /** Resolves once the fans are in (false without models or a grandstand). */
  readonly ready: Promise<boolean>;

  constructor(private track: Track) {
    this.root.name = 'crowd-fans';
    this.ready = this.build();
    this.off.push(
      events.on('finish', () => this.cheer(4)),
      events.on('land', (e) => {
        if (e.airTime >= BIG_JUMP) this.cheer(2.5);
      }),
    );
  }

  /** Cheer for `seconds` from now (extends a cheer already going). */
  cheer(seconds: number) {
    this.cheerUntil = Math.max(this.cheerUntil, this.time + seconds);
  }

  get cheering() {
    return this.time < this.cheerUntil;
  }

  private async build() {
    const stand = this.track.group.getObjectByName('grandstand');
    const boxes = stand?.getObjectByName('crowd') as THREE.InstancedMesh | undefined;
    if (!stand || !boxes) return false;
    const models = await loadCharacters(FANS);
    const names = FANS.filter((n) => models[n]);
    if (!names.length || this.disposed) return false;

    // Stand where every other box sat (the boxes are seated people 0.5 m apart; standing fans need more room).
    const spots: THREE.Vector3[] = [];
    for (let i = 0; i < boxes.count; i += 2) {
      boxes.getMatrixAt(i, _m);
      _m.decompose(_p, _q, _s);
      // A box's centre is 0.31 m above its bench.
      spots.push(new THREE.Vector3(_p.x, _p.y - 0.31, _p.z));
    }
    const hash = (n: number) => {
      const x = Math.sin(n * 91.345 + 7.1) * 43758.5453;
      return x - Math.floor(x);
    };
    // Animated fans spread along the front two rows; the rest baked.
    const animatedAt = new Set<number>();
    for (let k = 0; k < Math.min(ANIMATED, spots.length); k++) animatedAt.add(Math.floor(((k + 0.5) / ANIMATED) * Math.min(spots.length, 22)));
    spots.forEach((pos, i) => {
      const fan: Fan = { type: Math.floor(hash(i) * names.length), pos, yaw: (hash(i + 50) - 0.5) * 0.5, phase: hash(i + 99) };
      if (animatedAt.has(i)) {
        const ch = new Character(models[names[fan.type]]);
        ch.root.position.copy(pos);
        ch.root.rotation.y = fan.yaw;
        ch.root.scale.setScalar(FAN_LOOK);
        ch.play(CLIPS.idle, { fade: 0, offset: fan.phase * 2 });
        this.root.add(ch.root);
        fan.character = ch;
      }
      this.fans.push(fan);
    });

    this.meshes = names.map((name, type) => {
      const count = this.fans.filter((f) => f.type === type && !f.character).length;
      return bakedFor(name, models[name]).map((pose) =>
        pose.map((part) => {
          const im = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, count));
          im.castShadow = true;
          im.count = 0;
          // The instances span the whole stand: one bounding sphere per update would be wasted work.
          im.frustumCulled = false;
          this.root.add(im);
          return im;
        }),
      );
    });
    stand.add(this.root);
    boxes.visible = false;
    this.place(0);
    return true;
  }

  /** Write every baked fan into the mesh of its current pose (idle, or one of the two cheer frames). */
  private place(time: number) {
    const cheering = this.cheering;
    const counts = this.meshes.map((poses) => poses.map(() => 0));
    for (const f of this.fans) {
      if (f.character) continue;
      // Cheering fans flip between the two wave frames at their own rhythm and hop a little.
      const beat = time * 4.2 + f.phase * 4;
      const pose = cheering ? 1 + (Math.floor(beat) % 2) : 0;
      const hop = cheering ? Math.abs(Math.sin(beat * Math.PI * 0.5)) * 0.12 : 0;
      _p.copy(f.pos).setY(f.pos.y + hop);
      _q.setFromAxisAngle(UP, f.yaw);
      _s.setScalar(FAN_LOOK);
      _m.compose(_p, _q, _s);
      const slot = counts[f.type][pose]++;
      for (const im of this.meshes[f.type][pose]) im.setMatrixAt(slot, _m);
    }
    this.meshes.forEach((poses, type) =>
      poses.forEach((parts, pose) => {
        for (const im of parts) {
          im.count = counts[type][pose];
          im.instanceMatrix.needsUpdate = true;
        }
      }),
    );
  }

  /** Per rendered frame with the session's sim time: animate the skinned fans, re-pose the baked ones. */
  update(time: number) {
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.time = time;
    if (!this.fans.length) return;
    const cheering = this.cheering;
    for (const f of this.fans) {
      const ch = f.character;
      if (!ch) continue;
      const want = cheering ? (f.phase < 0.5 ? CLIPS.cheer : CLIPS.wave) : CLIPS.idle;
      if (ch.current !== want) ch.play(want, { fade: 0.25, offset: f.phase });
      ch.update(dt);
    }
    // Baked fans only change pose a few times a second (and not at all while idle).
    if (cheering || this.wasCheering) this.place(time);
    this.wasCheering = cheering;
  }

  private wasCheering = false;

  /** Unsubscribe and detach (the baked geometry and the fan models' materials are shared with later races). */
  dispose() {
    this.disposed = true;
    for (const f of this.off) f();
    this.off = [];
    for (const f of this.fans) f.character?.mixer.stopAllAction();
    this.root.removeFromParent();
  }

  /** Draw calls the crowd adds (InstancedMesh with instances + skinned fans), for the cost table. */
  drawCalls() {
    let n = 0;
    for (const poses of this.meshes) for (const parts of poses) for (const im of parts) if (im.count > 0) n++;
    return n + this.fans.filter((f) => f.character).length;
  }
}
