// The stadium around the arena, from the generator's models (Pro Racer and Arid Desert, ssg.models.json): a row of
// grandstands behind the back wall with a VIP box, bleachers outside the side walls, an inflatable sponsor arch over
// the start line with a start light on it, sponsor flags, and the desert outside (cacti, rocks, cliffs in the back
// corners, tumbleweeds rolling in the wind). It also finds the seats on the grandstands for the crowd (race/crowd.ts).
// Each track varies it through its JSON `stadium` options and `palette`. Without models nothing changes: build.ts's
// procedural stand, back wall and lamp tree stay.
import * as THREE from 'three';
import { loadModel, modelIndex } from '../race/models';
import { CLIPS, Character, loadCharacters } from '../race/characters';
import type { Track } from './build';
import { instanceModel, type Placement } from './props-view';
import type { StadiumOptions } from './types';

/** A crowd spot: where a fan's feet go (the seat is just behind), facing yaw. */
export interface Seat {
  pos: THREE.Vector3;
  yaw: number;
  /** Row from the front (0 = the lowest). */
  row: number;
}

export interface StadiumView {
  seats: Seat[];
  /** Per rendered frame with the session's sim time (the tumbleweeds). */
  update(time: number): void;
}

/** How much of the grandstand the race camera frames: a point this high and this far behind the arena's walls. */
export const STAND_TOP = { y: 3.5, back: 7 };
/** The stands are drawn a little over life size, like the fans on them (crowd.ts FAN_LOOK). */
const STAND_LOOK = 1.1;
const DESERT_LOOK = 1.5;
/** Foliage cards: the export's materials are opaque although their textures carry a cut-out alpha (OR-FB-018). */
const CUTOUT = new Set(['cactus_tall', 'cactus_low', 'succulent_a', 'succulent_b', 'tumbleweed']);
const FLORA = {
  cactus: ['cactus_tall', 'cactus_tall', 'cactus_low', 'succulent_b'],
  scrub: ['cactus_low', 'succulent_a', 'succulent_b', 'dead_tree'],
  mixed: ['cactus_tall', 'cactus_low', 'succulent_a', 'succulent_b', 'dead_tree'],
} as const;
const ROCKS = ['rock_a', 'rock_b', 'rock_a'];

const hash = (x: number, z: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Seats found on a stand model (feet points in the model's own frame), cached per model. */
const seatCache = new Map<string, Promise<THREE.Vector3[]>>();

/**
 * Find the seat rows of a stand model by casting rays down through it: along z the profile has flats (treads, seat
 * pans, bench tops); a flat 0.3–0.6 m above the one in front of it is a seat with the feet on the lower flat. Seats
 * along a row are every `pitch` metres where the ray finds that seat height (aisles have none). The manifests carry no
 * seat points for stands (OR-FB-024).
 */
export function findSeats(name: string, facing: 1 | -1 = 1, pitch = 0.62): Promise<THREE.Vector3[]> {
  const key = `${name}:${facing}`;
  let p = seatCache.get(key);
  if (!p) {
    p = (async () => {
      const model = await loadModel(name);
      if (!model) return [];
      const scene = model.scene;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const ray = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const top = (x: number, z: number) => {
        ray.set(new THREE.Vector3(x, box.max.y + 5, z), down);
        const hit = ray.intersectObject(scene, true)[0];
        return hit ? hit.point.y : -Infinity;
      };
      // Profile through the middle of the left seat block (a third of the width in).
      const px = box.min.x + (box.max.x - box.min.x) * 0.3;
      const step = 0.04;
      const flats: { y: number; zFront: number; zBack: number }[] = [];
      let cur: { y: number; zFront: number; zBack: number } | null = null;
      const d = facing;
      const len = (f: { zFront: number; zBack: number }) => Math.abs(f.zFront - f.zBack);
      // From the front (the side the seats face) to the back.
      for (let z = d > 0 ? box.max.z - 0.01 : box.min.z + 0.01; d > 0 ? z > box.min.z : z < box.max.z; z -= step * d) {
        const y = top(px, z);
        if (cur && Math.abs(y - cur.y) < 0.03) cur.zBack = z;
        else {
          if (cur && len(cur) >= 0.16) flats.push(cur);
          cur = { y, zFront: z, zBack: z };
        }
      }
      if (cur && len(cur) >= 0.16) flats.push(cur);
      const out: THREE.Vector3[] = [];
      for (let i = 0; i + 1 < flats.length; i++) {
        const feet = flats[i];
        const seat = flats[i + 1];
        const dy = seat.y - feet.y;
        if (dy < 0.3 || dy > 0.62 || len(feet) < 0.25) continue;
        const zSeat = (seat.zFront + seat.zBack) / 2;
        // Feet just in front of the seat's front edge.
        const a = feet.zFront - d * 0.05;
        const b = seat.zFront + d * 0.28;
        const zFeet = d > 0 ? Math.min(a, b) : Math.max(a, b);
        for (let x = box.min.x + pitch / 2; x < box.max.x; x += pitch)
          if (Math.abs(top(x, zSeat) - seat.y) < 0.06) out.push(new THREE.Vector3(x, feet.y, zFeet));
      }
      return out;
    })();
    seatCache.set(key, p);
  }
  return p;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Build the stadium for `track` (async; null without models). */
export async function dressStadium(track: Track): Promise<StadiumView | null> {
  if (!(await modelIndex())) return null;
  const t = track.data;
  const o: StadiumOptions = t.stadium ?? {};
  const xs = t.walls[0].points.map((p) => p[0]);
  const zs = t.walls[0].points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const group = new THREE.Group();
  group.name = 'stadium-models';
  const jobs: Promise<unknown>[] = [];
  const add = (name: string, list: Placement[], opts?: { shadow?: boolean }) => {
    const job = instanceModel(group, track, name, list, opts).then((meshes) => {
      if (CUTOUT.has(name))
        for (const m of meshes) {
          // OR-FB-018: cut the foliage cards out of their textures' alpha.
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.alphaTest = 0.5;
          mat.transparent = false;
          mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        }
      return meshes;
    });
    jobs.push(job);
    return job;
  };

  // --- Desert ground all round (the heightfield ends a few metres outside the walls).
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: o.sand ?? '#a8703f' }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = -0.12;
  sand.receiveShadow = true;
  group.add(sand);

  // --- Grandstands along the back, behind a lowered back wall (the palette's colour stays as the stands' fence).
  const stadium = track.group.getObjectByName('stadium');
  const backWall = stadium?.getObjectByName('back-wall');
  const backZ = backWall ? backWall.position.z + 0.3 : z0 - 3.9;
  const standW = 12.5 * STAND_LOOK;
  const standD = 12.54 * STAND_LOOK;
  const xa = x0 - 10;
  const xb = x1 + 10;
  const n = Math.ceil((xb - xa) / standW);
  const cz = backZ - 0.15 - standD / 2;
  const centres = Array.from({ length: n }, (_, k) => (xa + xb) / 2 + (k - (n - 1) / 2) * standW);
  const vipX = o.vip === undefined ? 0 : o.vip;
  const vipAt = vipX === null ? -1 : centres.reduce((best, x, k) => (Math.abs(x - vipX) < Math.abs(centres[best] - vipX) ? k : best), 0);
  const stands: Placement[] = [];
  const vips: Placement[] = [];
  centres.forEach((x, k) => (k === vipAt ? vips : stands).push({ x, z: cz, y: 0, rot: 0, scale: STAND_LOOK }));
  add('grandstand', stands);
  add('vip_box', vips);
  if (backWall) {
    // Low enough for the front rows to show over it from the race camera.
    backWall.scale.y = 0.45;
    backWall.position.y = backWall.position.y - 1.6 + 0.72;
  }
  stadium?.getObjectByName('grandstand')?.removeFromParent();

  // --- Bleachers outside the side walls, in the back half, facing the arena.
  const bleachers: Placement[] = [];
  const sideSpots: { x: number; z: number; rot: number }[] = [];
  if (o.sides ?? true) {
    const bw = 5 * STAND_LOOK;
    const bd = 5.61 * STAND_LOOK;
    for (const side of [-1, 1]) {
      const x = side < 0 ? x0 - 2.2 - bd / 2 : x1 + 2.2 + bd / 2;
      const rot = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      for (let z = z0 + bw / 2 - 1; z < (z0 + z1) / 2 - 2; z += bw + 0.6) {
        bleachers.push({ x, z, y: 0, rot, scale: STAND_LOOK });
        sideSpots.push({ x, z, rot });
      }
    }
    add('bleachers', bleachers);
  }

  // --- Start arch over gate 0, the start light on it, chequered flags at its feet.
  const gate = t.gates?.[0];
  let lamps: THREE.MeshBasicMaterial[] = [];
  if (gate) {
    const [a, b] = gate;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const rot = Math.atan2(-uz, ux);
    const sx = (len + 1.6) / 10.8;
    const sy = 1.2;
    add('start_arch', [{ x: mx, z: mz, y: track.heightAt(mx, mz), rot, scale: [sx, sy, 1.2] }]);
    const flags: Placement[] = [];
    for (const e of [-1, 1]) {
      const d = (len / 2 + 1.6) * e;
      flags.push({ x: mx + ux * d, z: mz + uz * d, rot: rot + (e < 0 ? 0 : Math.PI), scale: 1.7 });
    }
    add('flag_chequered', flags);
    // The light stands on the arch's beam at its middle, facing the camera (south) so the lamps read.
    const LIGHT = 2.6;
    const ly = track.heightAt(mx, mz) + 4.77 * sy - 0.25;
    add('start_light', [{ x: mx, z: mz, y: ly, rot: 0, scale: LIGHT }]);
    lamps = lampDiscs(group, mx, ly, mz, LIGHT);
    const tree = track.group.getObjectByName('start-tree');
    if (tree) tree.visible = false;
    const orig = track.lights.set.bind(track.lights);
    track.lights.set = (n: number) => {
      orig(n);
      lamps.forEach((m, k) => m.color.set(n === 4 ? '#3dff6a' : k < n ? '#ff2b1f' : k === 2 ? '#2a0d0b' : '#2a0d0b'));
    };
    track.lights.set(0);
  }
  if (t.flagman) {
    const f = t.flagman;
    // Sponsor flags beside the flagman's tower (on the far side of it from the lamp post).
    const fx = f.x + Math.cos(f.heading) * 2.6;
    const fz = f.z - Math.sin(f.heading) * 2.6;
    add('flags_sponsor', [{ x: fx, z: fz, rot: f.heading, scale: 1.5 }]);
  }

  // --- The desert outside the walls: plants and rocks on a jittered grid in the strips the camera sees.
  const fill = o.desert ?? 0.6;
  const flora = FLORA[o.flora ?? 'mixed'];
  const keepOut: [number, number, number][] = [];
  if (t.flagman) keepOut.push([t.flagman.x, t.flagman.z, 4.5]);
  if (gate) for (const p of gate) keepOut.push([p[0], p[1], 3.5]);
  for (const s of sideSpots) keepOut.push([s.x, s.z, 4.2]);
  for (const p of t.props ?? []) keepOut.push([p.x, p.z, 2.5]);
  const clear = (x: number, z: number) => keepOut.every(([kx, kz, r]) => Math.hypot(x - kx, z - kz) > r);
  const plants = new Map<string, Placement[]>();
  const put = (name: string, p: Placement) => plants.set(name, [...(plants.get(name) ?? []), p]);
  const spots: { x: number; z: number; low: boolean }[] = [];
  // The near strip (between the front wall and the camera): low plants only, so nothing hides the near lane.
  for (let x = x0 - 6; x <= x1 + 6; x += 4.2) spots.push({ x, z: z1 + 3.6, low: true });
  for (const side of [-1, 1])
    for (let z = z0 - 2; z <= z1 + 4; z += 4.4) spots.push({ x: side < 0 ? x0 - 4.5 : x1 + 4.5, z, low: z > (z0 + z1) / 2 });
  for (const s of spots) {
    const h = hash(s.x, s.z);
    if (h > fill) continue;
    const x = s.x + (hash(s.z, s.x) - 0.5) * 2.4;
    const z = s.z + (hash(s.x + 3, s.z) - 0.5) * 1.6;
    if (!clear(x, z)) continue;
    const r = hash(x * 1.7, z * 0.3);
    const rot = r * Math.PI * 2;
    if (r < 0.32) put(ROCKS[Math.floor(r * 9) % ROCKS.length], { x, z, rot, scale: DESERT_LOOK * (s.low ? 0.6 : 0.9) });
    else {
      let name: string = flora[Math.floor(r * 97) % flora.length];
      if (s.low && name !== 'cactus_low') name = r < 0.45 ? 'cactus_low' : 'rock_a';
      put(name, { x, z, rot, scale: DESERT_LOOK * (name === 'cactus_low' ? 1.3 : 1) });
    }
  }
  // Sponsor billboards (Pro Racer's own art) in the back corners, angled towards the arena, with cliffs behind.
  add('billboard_skidmark', [
    { x: xa - 3, z: backZ - 1.5, rot: 0.45, scale: 1.25 },
    { x: xb + 3, z: backZ - 1.5, rot: -0.45, scale: 1.25 },
  ]);
  // Cliffs and a tall rock in the back corners, beside the stands.
  put('cliff_a', { x: xa - 12, z: cz - 2, rot: 0.5, scale: 1 });
  put('cliff_b', { x: xb + 13, z: cz - 1, rot: -0.4, scale: 0.9 });
  put('rock_tall', { x: xb + 4, z: backZ + 3, rot: 1.1, scale: 0.8 });
  // Small dressing casts no shadow (a second pass for a few pixels).
  for (const [name, list] of plants) add(name, list, { shadow: name.startsWith('cliff') });

  jobs.push(flagmanCharacter(track));

  // --- Tumbleweeds rolling across the near strip and the sides with the wind.
  const weeds = await tumbleweeds(group, track, o.tumbleweeds ?? 3, x0 - 14, x1 + 14, z1);
  await Promise.all(jobs);

  // --- Seats on the grandstands for the crowd.
  const seats: Seat[] = [];
  const seatOn = async (model: string, list: Placement[], facing: 1 | -1 = 1) => {
    const local = await findSeats(model, facing);
    const rowYs = [...new Set(local.map((p) => Math.round(p.y * 100)))].sort((p, q) => p - q);
    for (const s of list) {
      _m.compose(_v.set(s.x, s.y ?? 0, s.z), _q.setFromAxisAngle(UP, s.rot), new THREE.Vector3(STAND_LOOK, STAND_LOOK, STAND_LOOK));
      for (const p of local) seats.push({ pos: p.clone().applyMatrix4(_m), yaw: s.rot + (facing < 0 ? Math.PI : 0), row: rowYs.indexOf(Math.round(p.y * 100)) });
    }
  };
  await seatOn('grandstand', stands);
  await seatOn('vip_box', vips);
  await seatOn('bleachers', bleachers);
  // Only the rows the race camera frames (STAND_TOP): the higher rows behind them are off the top of the screen.
  const visible = seats.filter((s) => s.pos.z > backZ - STAND_TOP.back - 1.5 || Math.abs(s.yaw) > 1);
  console.debug(`stadium: ${seats.length} seats, ${visible.length} in view`);
  track.group.add(group);
  return { seats: visible, update: (time) => weeds(time) };
}

/**
 * Three lamp discs over the traffic light's lamp faces (top to bottom), lit by the race through track.lights. The
 * light is one mesh on the pack atlas, with no lamp parts or emissive slots to switch (OR-FB-022).
 */
function lampDiscs(group: THREE.Group, x: number, y: number, z: number, scale: number) {
  const geo = new THREE.CircleGeometry(0.1 * scale, 16);
  return [0.97, 0.66, 0.35].map((h) => {
    const mat = new THREE.MeshBasicMaterial({ color: '#2a0d0b' });
    const disc = new THREE.Mesh(geo, mat);
    disc.position.set(x, y + h * scale, z + 0.2 * scale);
    disc.name = 'start-lamp';
    group.add(disc);
    return mat;
  });
}

/**
 * Tumbleweeds: one instanced copy of the model per weed, rolling east with the wind along the strips outside the
 * walls (gusts change the speed), bouncing a little, and wrapping round from the east end to the west.
 */
async function tumbleweeds(group: THREE.Group, track: Track, count: number, xa: number, xb: number, zNear: number) {
  const model = count > 0 ? await loadModel('tumbleweed') : null;
  if (!model) return () => {};
  model.scene.updateMatrixWorld(true);
  const SCALE = 1.7;
  const R = 0.38 * SCALE;
  const parts: { inst: THREE.InstancedMesh; matrix: THREE.Matrix4 }[] = [];
  model.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
    // OR-FB-018: the branch cards are cut out of the texture's alpha.
    mat.alphaTest = 0.5;
    mat.side = THREE.DoubleSide;
    const inst = new THREE.InstancedMesh(mesh.geometry, mat, count);
    inst.castShadow = true;
    inst.frustumCulled = false;
    inst.name = 'tumbleweed';
    // Roll about the weed's own centre: the model's origin is its base.
    parts.push({ inst, matrix: new THREE.Matrix4().makeTranslation(0, -0.38, 0).multiply(mesh.matrixWorld) });
    group.add(inst);
  });
  const weeds = Array.from({ length: count }, (_, k) => ({ x: xa + ((xb - xa) * (k + 0.37)) / count, z: zNear + 2.6 + (k % 2) * 1.6, speed: 2 + k * 0.7, angle: k }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(SCALE, SCALE, SCALE);
  const p = new THREE.Vector3();
  const roll = new THREE.Vector3(0, 0, -1);
  let last = -1;
  return (time: number) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, time - last));
    last = time;
    weeds.forEach((w, k) => {
      const gust = 0.6 + 0.4 * Math.sin(time * 0.7 + k * 2.1) + 0.25 * Math.sin(time * 2.3 + k);
      const v = w.speed * Math.max(0.15, gust);
      w.x += v * dt;
      if (w.x > xb) w.x = xa;
      w.angle += (v * dt) / R;
      const hop = Math.abs(Math.sin(w.angle * 0.5)) * 0.35 * gust;
      p.set(w.x, track.heightAt(w.x, w.z) + R + hop, w.z);
      q.setFromAxisAngle(roll, w.angle);
      m.compose(p, q, s);
      for (const part of parts) part.inst.setMatrixAt(k, _m.multiplyMatrices(m, part.matrix));
    });
    for (const part of parts) part.inst.instanceMatrix.needsUpdate = true;
  };
}

/**
 * The flagman on his tower: the generator's roadworker (hi-vis) with the chequered flag in his right hand, standing
 * (flag down), arms raised (the countdown) and waving the flag (the start), in place of build.ts's box man.
 */
async function flagmanCharacter(track: Track) {
  const [chars, flag] = await Promise.all([loadCharacters(['flagman']), loadModel('flag_chequered')]);
  const model = chars.flagman;
  const old = track.group.getObjectByName('flagman-man');
  if (!model || !old?.parent) return;
  const ch = new Character(model);
  ch.root.position.copy(old.position);
  ch.root.scale.setScalar(1.15);
  old.parent.add(ch.root);
  old.visible = false;
  const hand = ch.socket('hand_r');
  // The flag follows the hand's position but stays upright (the bone's own axes and scale are the rig's), leaning
  // with the wave.
  const f = flag && hand ? flag.scene.clone(true) : null;
  if (f) {
    f.scale.setScalar(0.62);
    old.parent.add(f);
  }
  const at = new THREE.Vector3();
  const follow = (state: number, time: number) => {
    if (!f || !hand) return;
    ch.root.updateMatrixWorld(true);
    hand.getWorldPosition(at);
    f.parent!.worldToLocal(at);
    // The pole's foot is the model's origin: hold it a little below the cloth.
    f.position.copy(at).add(_v.set(0, -0.35, 0));
    f.rotation.set(0, Math.PI / 2, state === 2 ? Math.sin(time * 12) * 0.5 : 0);
  };
  ch.play(CLIPS.idle, { fade: 0 });
  let last = -1;
  const orig = track.flagman.pose.bind(track.flagman);
  track.flagman.pose = (state, time) => {
    orig(state, time);
    const want = state === 0 ? CLIPS.idle : state === 1 ? CLIPS.armsUp : CLIPS.flagWave;
    if (ch.current !== want) ch.play(want, { fade: 0.15 });
    ch.update(last < 0 ? 0 : Math.min(0.1, Math.max(0, time - last)));
    last = time;
    follow(state, time);
  };
}
