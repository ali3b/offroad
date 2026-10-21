// The grandstand crowd: the generator's Synty fans seated on the stadium's grandstands (track/stadium-view.ts finds
// the seats on the Pro Racer stand model). A few fans are real skinned characters (ssg.models.json `fan_a/b/c`) with
// their own mixer; everyone else is a static pose the generator baked (`crowd_a…f`, `poses`: seated, two seated-cheer
// frames, and standing up with arms raised or a fist pump) drawn as one InstancedMesh per fan model per pose, so a
// few hundred fans cost a few dozen draw calls and no skeletons. While the crowd cheers, about half the fans jump up
// (arms raised or fist pumping) and the rest cheer from their seats, each flipping between two frames at their own
// rhythm. The crowd cheers on the event bus: a truck finishing, or a big jump landing.
// Without models (no seats) nothing is drawn: build.ts's procedural stand keeps its box crowd.
import * as THREE from 'three';
import { Character, CLIPS, CROWD, CROWD_POSES, FANS, loadCharacters, loadPoses, type PosePart } from './characters';
import { events } from './events';
import type { Track } from '../track/build';
import type { Seat } from '../track/stadium-view';

/** Skinned, animated fans (the rest are baked poses). */
const ANIMATED = 6;
/** Fans are drawn a touch bigger than life, like the trucks and props, so they read at the far camera. */
const FAN_LOOK = 1.1;
/** A landing after this much air time (s) is a big jump. */
const BIG_JUMP = 0.5;
/** Share of the seats taken, and a cap on the crowd (triangles: ~700 a fan). */
const FILL = 0.8;
const MAX_FANS = 320;
/** Pose indices in CROWD_POSES. */
const SIT = 0;
const SIT_CHEER = 1;
const ARMS = 3;
const FIST = 5;

interface Fan {
  /** Fan model index (CROWD). */
  type: number;
  pos: THREE.Vector3;
  yaw: number;
  phase: number;
  /** Stands up to cheer (else cheers seated); and with which pose pair. */
  stands: boolean;
  standPose: number;
  character?: Character;
}

const _m = new THREE.Matrix4();
const _pm = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const hash = (n: number) => {
  const x = Math.sin(n * 91.345 + 7.1) * 43758.5453;
  return x - Math.floor(x);
};

export class Crowd {
  readonly root = new THREE.Group();
  private fans: Fan[] = [];
  /** [fan model][pose] → instanced mesh(es). */
  private meshes: THREE.InstancedMesh[][][] = [];
  /** [fan model][pose] → the export's mesh parts (their matrices carry the GLB's own node transforms). */
  private parts: PosePart[][][] = [];
  private cheerUntil = 0;
  private time = 0;
  private lastTime = -1;
  private off: (() => void)[] = [];
  private disposed = false;
  private wasCheering = false;
  /** Resolves once the fans are in (false without models or seats). */
  readonly ready: Promise<boolean>;

  constructor(private track: Track, seats: Promise<Seat[] | null>) {
    this.root.name = 'crowd-fans';
    this.ready = this.build(seats);
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

  /** How many fans are seated in the stands. */
  get count() {
    return this.fans.length;
  }

  private async build(seatsP: Promise<Seat[] | null>) {
    const seats = await seatsP;
    if (!seats?.length || this.disposed) return false;
    const [models, ...posed] = await Promise.all([loadCharacters(FANS), ...CROWD.map((n) => loadPoses(n, CROWD_POSES))]);
    // A fan type needs its baked poses; its skinned model is optional (the animated fans use it when there).
    const types = CROWD.map((_, i) => i).filter((i) => posed[i]);
    if (!types.length || this.disposed) return false;

    // Fill the seats with a preference for the front rows, thinning the back ones at random (an even crowd, not a
    // full front row and empty seats behind).
    const score = seats.map((s, i) => ({ s, k: hash(i * 1.37 + s.pos.x) + s.row * 0.07 }));
    const taken = score
      .filter((x) => x.k < FILL + 0.3)
      .sort((a, b) => a.k - b.k)
      .slice(0, MAX_FANS)
      .map((x) => x.s);
    // Animated fans in the front row, spread across the middle of the arena.
    const first = Math.min(...taken.map((t) => t.row));
    const front = taken.filter((s) => s.row === first).sort((a, b) => a.pos.x - b.pos.x);
    const animatedAt = new Set<Seat>();
    for (let k = 0; k < Math.min(ANIMATED, front.length); k++) animatedAt.add(front[Math.floor(((k + 0.5) / ANIMATED) * front.length)]);
    taken.forEach((seat, i) => {
      const h = hash(i + 11);
      const fan: Fan = {
        type: Math.floor(hash(i + seat.pos.z) * types.length),
        pos: seat.pos,
        yaw: seat.yaw + (hash(i + 50) - 0.5) * 0.3,
        phase: hash(i + 99),
        stands: h < 0.45,
        standPose: h < 0.22 ? ARMS : FIST,
      };
      const skinned = types[fan.type] < FANS.length ? models[FANS[types[fan.type]]] : undefined;
      if (animatedAt.has(seat) && skinned) {
        const ch = new Character(skinned);
        ch.root.position.copy(seat.pos);
        ch.root.rotation.y = fan.yaw;
        ch.root.scale.setScalar(FAN_LOOK);
        ch.play(CLIPS.sit, { fade: 0, offset: fan.phase * 3 });
        this.root.add(ch.root);
        fan.character = ch;
      }
      this.fans.push(fan);
    });

    this.parts = types.map((t) => posed[t]!);
    this.meshes = this.parts.map((poses, type) => {
      const count = this.fans.filter((f) => f.type === type && !f.character).length;
      return poses.map((pose) =>
        pose.map((part) => {
          const im = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, count));
          // The stands are in the back: the crowd's shadows would cost a second pass for a few dark pixels.
          im.castShadow = false;
          im.count = 0;
          // The instances span the whole stand: one bounding sphere per update would be wasted work.
          im.frustumCulled = false;
          this.root.add(im);
          return im;
        }),
      );
    });
    this.track.group.add(this.root);
    this.place(0);
    return true;
  }

  /** Write every baked fan into the mesh of its current pose. */
  private place(time: number) {
    const cheering = this.cheering;
    const counts = this.meshes.map((poses) => poses.map(() => 0));
    for (const f of this.fans) {
      if (f.character) continue;
      // Cheering fans flip between their two frames at their own rhythm; the standing ones hop a little.
      const beat = time * 4.2 + f.phase * 4;
      const flip = Math.floor(beat) % 2;
      const pose = !cheering ? SIT : f.stands ? f.standPose + flip : SIT_CHEER + flip;
      const hop = cheering && f.stands ? Math.abs(Math.sin(beat * Math.PI * 0.5)) * 0.1 : 0;
      _p.copy(f.pos).setY(f.pos.y + hop);
      _q.setFromAxisAngle(UP, f.yaw);
      _s.setScalar(FAN_LOOK);
      _m.compose(_p, _q, _s);
      const slot = counts[f.type][pose]++;
      this.meshes[f.type][pose].forEach((im, k) => im.setMatrixAt(slot, _pm.multiplyMatrices(_m, this.parts[f.type][pose][k].matrix)));
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
      const want = cheering ? (f.stands ? CLIPS.armsUp : CLIPS.sitCheer) : CLIPS.sit;
      if (ch.current !== want) ch.play(want, { fade: 0.25, offset: f.phase });
      ch.update(dt);
    }
    // Baked fans only change pose a few times a second (and not at all while seated).
    if (cheering || this.wasCheering) this.place(time);
    this.wasCheering = cheering;
  }

  /** Unsubscribe and detach (the pose geometry and the fan models' materials are shared with later races). */
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
