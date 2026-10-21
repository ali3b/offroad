// Track data JSON → everything the race needs: the height grid, the ground, water and mud meshes, tyre walls with
// flags, the start line and flagman tower, the stadium dressing, physics colliders and surface queries.
// Placeholder art (vertex colours, primitive tyres and props) until the generator's 3D export supplies props
// (ssg.models.json; OR-FB-001).
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { addHeightfield, addWalls, WALL_HEIGHT } from '../physics/heightfield';
import { DIRT as DRY, type Surface } from '../physics/vehicle';
import { buildHeights, featureHeight, polygonDistance, sampleHeight, type HeightGrid } from './heights';
import { RacingLine } from './line';
import type { TrackData, XZ, Zone } from './types';

export interface StartLights {
  /** 0 = all off, 1..3 = that many red lamps, 4 = green. */
  set(n: number): void;
}

export interface Flagman {
  /** 0 = flag down, 1 = raised, 2 = waving (call every frame with the time). */
  pose(state: 0 | 1 | 2, t: number): void;
}

export interface Track {
  data: TrackData;
  grid: HeightGrid;
  group: THREE.Group;
  /** Box around the playfield including the walls: what the fixed camera frames. */
  bounds: THREE.Box3;
  heightAt(x: number, z: number): number;
  /** The surface under a point: dirt, water or mud. */
  surface(x: number, y: number, z: number): Surface;
  ground: RAPIER.Collider;
  walls: RAPIER.Collider[];
  line: RacingLine | null;
  lights: StartLights;
  flagman: Flagman;
}

// The original's sandy arena palette: orange-brown dirt, sun-bleached pink ridges, dark pits.
const DIRT = new THREE.Color('#b57336');
const DIRT_DARK = new THREE.Color('#7f4a22');
const DIRT_LIGHT = new THREE.Color('#c98a4c');
const RIDGE = new THREE.Color('#d6a088');
const GRASS = new THREE.Color('#6f7f35');
const MUD = new THREE.Color('#4a2f19');
const PLANK = new THREE.Color('#5e3d22');
const PLANK_GAP = new THREE.Color('#3a2414');
const OUTSIDE = new THREE.Color('#5b3a22');

function hash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise (for the mottled, tyre-scuffed dirt). */
function vnoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const tx = x - xi;
  const tz = z - zi;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

/** 0 outside .. 1 well inside an ellipse zone, with a soft rim of `soft` (in ellipse radii). */
function zoneWeight(z: Zone, x: number, zz: number, soft = 0.25) {
  const r = Math.hypot((x - z.x) / z.rx, (zz - z.z) / z.rz);
  return Math.max(0, Math.min(1, (1 - r) / soft));
}

function inZone(z: Zone, x: number, zz: number) {
  return ((x - z.x) / z.rx) ** 2 + ((zz - z.z) / z.rz) ** 2 <= 1;
}

function groundMesh(t: TrackData, g: HeightGrid) {
  const cols = g.nx + 1;
  const rows = g.nz + 1;
  const pos = new Float32Array(rows * cols * 3);
  const col = new Float32Array(rows * cols * 3);
  const c = new THREE.Color();
  const ridges = t.features.filter((f) => f.type === 'ridge');
  const planks = t.features.filter((f) => f.type === 'ramp' && f.planks);
  const muds = t.zones.filter((z) => z.type === 'mud');
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const k = i * cols + j;
      const x = -g.w / 2 + j * g.res;
      const z = -g.d / 2 + i * g.res;
      const y = g.h[k];
      pos.set([x, y, z], k * 3);
      // Higher ground is sun-bleached, hollows are darker; mottled scuffs and speckle on top.
      const slope = y - sampleHeight(g, x - 1, z - 1);
      c.copy(DIRT).lerp(y > 0 ? DIRT_LIGHT : DIRT_DARK, Math.min(1, Math.abs(y) * 0.6));
      const mottle = vnoise(x * 0.35, z * 0.35) * 0.6 + vnoise(x * 1.1 + 7, z * 1.1) * 0.4;
      c.lerp(DIRT_DARK, Math.max(0, mottle - 0.55) * 0.9);
      c.offsetHSL(0, 0, slope * 0.06 + (hash(x, z) - 0.5) * 0.06);
      for (const r of ridges) {
        const w = featureHeight(r, x, z) / (r.type === 'ridge' ? r.height : 1);
        if (w > 0) c.lerp(RIDGE, Math.min(1, w * 1.6) * 0.85);
      }
      for (const p of planks) {
        if (p.type !== 'ramp') continue;
        const h = featureHeight(p, x, z);
        if (h > 0.02) {
          const s = Math.sin(p.heading);
          const co = Math.cos(p.heading);
          const u = (x - p.x) * s + (z - p.z) * co;
          const board = Math.abs((((u * 1.1) % 1) + 1) % 1 - 0.5) < 0.12 ? PLANK_GAP : PLANK;
          c.lerp(board, Math.min(1, h * 4));
        }
      }
      for (const m of muds) c.lerp(MUD, zoneWeight(m, x, z, 0.35) * 0.95);
      if (y < -0.35) c.lerp(MUD, Math.min(0.6, (-y - 0.35) * 1.2));
      c.lerp(GRASS, g.infield[k] * 0.85);
      // Outside the outer wall: darker, so the arena reads as one lit floor.
      const out = polygonDistance(x, z, t.walls[0].points);
      if (out > 0.6) c.lerp(OUTSIDE, Math.min(0.85, (out - 0.6) * 0.5));
      col.set([c.r, c.g, c.b], k * 3);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < g.nz; i++)
    for (let j = 0; j < g.nx; j++) {
      const a = i * cols + j;
      idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  mesh.name = `ground:${t.id}`;
  return mesh;
}

/** A wet sheen over each mud zone: a ground-hugging patch with a glossy material and a soft alpha rim. */
function mudMeshes(t: TrackData, g: HeightGrid) {
  const out: THREE.Mesh[] = [];
  const mat = new THREE.MeshStandardMaterial({
    color: '#3a2412',
    roughness: 0.28,
    metalness: 0.05,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  for (const z of t.zones) {
    if (z.type !== 'mud') continue;
    const n = 28;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const x = z.x + (j / n - 0.5) * 2.3 * z.rx;
        const zz = z.z + (i / n - 0.5) * 2.3 * z.rz;
        const a = zoneWeight(z, x, zz, 0.4) * (0.55 + 0.35 * vnoise(x * 0.8, zz * 0.8));
        pos.push(x, sampleHeight(g, x, zz) + 0.03, zz);
        col.push(1, 1, 1, a);
      }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const a = i * (n + 1) + j;
        idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.name = 'mud';
    out.push(mesh);
  }
  return out;
}

/** Stacks of tyres along every wall, painted in red and white blocks like the original's striped barriers. */
function tyreWalls(t: TrackData, g: HeightGrid) {
  const spots: { x: number; z: number; y: number; band: number }[] = [];
  const step = 1.0;
  for (const w of t.walls) {
    const n = w.points.length;
    const segs = w.closed ? n : n - 1;
    let along = 0;
    for (let k = 0; k < segs; k++) {
      const [ax, az] = w.points[k];
      const [bx, bz] = w.points[(k + 1) % n];
      const len = Math.hypot(bx - ax, bz - az);
      const m = Math.max(1, Math.round(len / step));
      const last = !w.closed && k === segs - 1;
      for (let s = 0; s < m + (last ? 1 : 0); s++) {
        const x = ax + ((bx - ax) * s) / m;
        const z = az + ((bz - az) * s) / m;
        spots.push({ x, z, y: sampleHeight(g, x, z), band: Math.floor(along / 3) });
        along++;
      }
    }
  }
  const tyre = new THREE.CylinderGeometry(0.5, 0.5, 0.42, 14);
  const layers = Math.round(WALL_HEIGHT / 0.42);
  const mesh = new THREE.InstancedMesh(tyre, new THREE.MeshLambertMaterial(), spots.length * layers);
  const m4 = new THREE.Matrix4();
  const red = new THREE.Color('#c42a24');
  const white = new THREE.Color('#e9e4dc');
  const dark = new THREE.Color('#2a2624');
  let i = 0;
  spots.forEach((p) => {
    for (let l = 0; l < layers; l++) {
      m4.makeTranslation(p.x, p.y + 0.21 + l * 0.42 - 0.15, p.z);
      mesh.setMatrixAt(i, m4);
      // Painted bands; the bottom row is bare rubber.
      mesh.setColorAt(i, l === 0 ? dark : p.band % 2 ? white : red);
      i++;
    }
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'walls';
  return mesh;
}

/** A white pole with a small blue flag at each free end of an inner wall. */
function wallFlags(t: TrackData, g: HeightGrid) {
  const group = new THREE.Group();
  group.name = 'flags';
  const pole = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: '#f4f1ea' });
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.55, 0, 0.9, -0.28, 0], 3));
  flagGeo.computeVertexNormals();
  const flagMat = new THREE.MeshLambertMaterial({ color: '#2f55d4', side: THREE.DoubleSide });
  for (const w of t.walls) {
    if (w.closed) continue;
    for (const [x, z] of [w.points[0], w.points[w.points.length - 1]]) {
      const y = sampleHeight(g, x, z) + WALL_HEIGHT - 0.1;
      const p = new THREE.Mesh(pole, poleMat);
      p.position.set(x, y + 1.3, z);
      p.castShadow = true;
      const f = new THREE.Mesh(flagGeo, flagMat);
      f.position.set(x, y + 2.55, z);
      f.rotation.y = -0.5;
      f.castShadow = true;
      group.add(p, f);
    }
  }
  return group;
}

function waterMeshes(t: TrackData) {
  const out: THREE.Mesh[] = [];
  for (const z of t.zones) {
    if (z.type !== 'water') continue;
    const geo = new THREE.CircleGeometry(1, 40);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: '#4f8fc4', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(z.rx, z.rz, 1);
    mesh.position.set(z.x, z.level, z.z);
    mesh.receiveShadow = true;
    mesh.name = 'water';
    out.push(mesh);
  }
  return out;
}

/** A chequered strip along gate 0 (or across the lane in front of the grid on tracks without gates). */
function startLine(t: TrackData, g: HeightGrid) {
  let a: XZ;
  let b: XZ;
  if (t.gates?.length) [a, b] = t.gates[0];
  else {
    const xs = t.start.grid.map((p) => p[0]);
    const zs = t.start.grid.map((p) => p[1]);
    const x = Math.max(...xs) + 4;
    a = [x, Math.min(...zs) - 5];
    b = [x, Math.max(...zs) + 5];
  }
  const sq = 0.9;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len;
  const uz = (b[1] - a[1]) / len;
  const count = Math.floor(len / sq);
  const geo = new THREE.PlaneGeometry(sq, sq);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), count * 2);
  const white = new THREE.Color('#f2efe6');
  const black = new THREE.Color('#1c1c1c');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(ux, uz));
  const one = new THREE.Vector3(1, 1, 1);
  let i = 0;
  for (let r = 0; r < 2; r++)
    for (let k = 0; k < count; k++) {
      const d = (k + 0.5) * sq + (len - count * sq) / 2;
      const off = (r - 0.5) * sq;
      const x = a[0] + ux * d + uz * off;
      const z = a[1] + uz * d - ux * off;
      m4.compose(new THREE.Vector3(x, sampleHeight(g, x, z) + 0.04, z), q, one);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i++, (r + k) % 2 ? black : white);
    }
  mesh.receiveShadow = true;
  mesh.name = 'start-line';
  return mesh;
}

/** The flagman's grey tower with a ladder, the flagman and his chequered flag, and a three-lamp start tree. */
function flagmanTower(t: TrackData, g: HeightGrid): { group: THREE.Group; lights: StartLights; flagman: Flagman } {
  const group = new THREE.Group();
  group.name = 'flagman';
  const spot = t.flagman ?? { x: t.start.grid[0][0] + 6, z: t.start.grid[0][1] + 8, heading: Math.PI };
  group.position.set(spot.x, sampleHeight(g, spot.x, spot.z), spot.z);
  group.rotation.y = spot.heading;
  const grey = new THREE.MeshLambertMaterial({ color: '#b9bcc4' });
  const dark = new THREE.MeshLambertMaterial({ color: '#4a4d55' });
  const suit = new THREE.MeshLambertMaterial({ color: '#e8e2d0' });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  // Tower and platform; the ladder is on the side facing the track (local +z, the heading turns it).
  box(1.8, 2.6, 1.8, grey, 0, 1.3, 0);
  box(2.2, 0.15, 2.2, dark, 0, 2.66, 0);
  for (let r = 0; r < 6; r++) box(0.9, 0.06, 0.08, dark, 0, 0.3 + r * 0.42, 0.95);
  box(0.06, 2.6, 0.08, dark, -0.45, 1.3, 0.95);
  box(0.06, 2.6, 0.08, dark, 0.45, 1.3, 0.95);
  // The flagman: overalls, head, an arm holding the chequered flag.
  const man = new THREE.Group();
  man.position.set(0, 2.74, 0);
  group.add(man);
  box(0.5, 0.9, 0.32, suit, 0, 0.45, 0, man);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshLambertMaterial({ color: '#d9a27a' }));
  head.position.set(0, 1.08, 0);
  head.castShadow = true;
  man.add(head);
  const arm = new THREE.Group();
  arm.position.set(0.3, 0.8, 0);
  man.add(arm);
  box(0.12, 0.6, 0.12, suit, 0, 0.3, 0, arm);
  const stick = box(0.04, 1.1, 0.04, dark, 0, 0.9, 0, arm);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const cx = cv.getContext('2d')!;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      cx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      cx.fillRect(x * 4, y * 4, 4, 4);
    }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.55), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
  flag.position.set(0.38, 0.3, 0);
  stick.add(flag);
  // Start tree: a post with three lamps (two red, one green) beside the tower.
  const post = new THREE.Group();
  post.position.set(-1.6, 0, 0);
  group.add(post);
  box(0.12, 3.2, 0.12, dark, 0, 1.6, 0, post);
  box(0.45, 1.5, 0.3, dark, 0, 3.4, 0, post);
  const lampGeo = new THREE.SphereGeometry(0.17, 10, 8);
  const lamps = [0, 1, 2].map((k) => {
    const m = new THREE.MeshLambertMaterial({ color: '#331010', emissive: '#000000' });
    const l = new THREE.Mesh(lampGeo, m);
    l.position.set(0, 3.9 - k * 0.48, 0.17);
    post.add(l);
    return m;
  });
  const lights: StartLights = {
    set(n) {
      lamps.forEach((m, k) => {
        const green = n === 4;
        const on = green ? k === 2 : k < n;
        const c = green ? '#36ff5a' : '#ff2a20';
        m.color.set(on ? c : k === 2 ? '#0f2a12' : '#331010');
        m.emissive.set(on ? c : '#000000');
      });
    },
  };
  const flagman: Flagman = {
    pose(state, time) {
      // Arm angle about the man's local z: down by his side, straight up, or waving side to side.
      arm.rotation.z = state === 0 ? -2.6 : state === 1 ? 0 : Math.sin(time * 14) * 0.9;
    },
  };
  flagman.pose(0, 0);
  lights.set(0);
  return { group, lights, flagman };
}

/** A lilac stadium back wall along the far side and a speckled grandstand in the far-left corner. */
function stadium(t: TrackData, g: HeightGrid) {
  const group = new THREE.Group();
  group.name = 'stadium';
  const xs = t.walls[0].points.map((p) => p[0]);
  const zs = t.walls[0].points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const z0 = Math.min(...zs);
  const back = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 16, 3.2, 0.6), new THREE.MeshLambertMaterial({ color: '#9c97c9' }));
  back.position.set((x0 + x1) / 2, sampleHeight(g, (x0 + x1) / 2, z0 - 4) + 1.6, z0 - 4.2);
  back.receiveShadow = true;
  group.add(back);
  // Grandstand: four steps of benches and a speckled crowd of tiny boxes.
  const stand = new THREE.Group();
  stand.position.set(x0 - 1, sampleHeight(g, x0, z0), z0 - 0.5);
  stand.rotation.y = -0.6;
  group.add(stand);
  const benchMat = new THREE.MeshLambertMaterial({ color: '#8d8da0' });
  for (let r = 0; r < 4; r++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(11, 0.6 + r * 0.6, 1.3), benchMat);
    b.position.set(0, (0.6 + r * 0.6) / 2, -r * 1.3);
    b.castShadow = true;
    b.receiveShadow = true;
    stand.add(b);
  }
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.62, 0.36), new THREE.MeshLambertMaterial(), 4 * 22);
  const m4 = new THREE.Matrix4();
  const palette = ['#d94b3c', '#f1d34a', '#3e6fd8', '#f2efe8', '#55a35a', '#e98a3c', '#7d4fb0', '#222222'].map((c) => new THREE.Color(c));
  let i = 0;
  for (let r = 0; r < 4; r++)
    for (let k = 0; k < 22; k++) {
      const x = -5.2 + k * 0.5 + (hash(r, k) - 0.5) * 0.15;
      m4.makeTranslation(x, 0.6 + r * 0.6 + 0.31, -r * 1.3 + (hash(k, r) - 0.5) * 0.3);
      crowd.setMatrixAt(i, m4);
      crowd.setColorAt(i++, palette[Math.floor(hash(k * 3.1, r * 7.7) * palette.length)]);
    }
  crowd.castShadow = true;
  stand.add(crowd);
  return group;
}

/** Trackside dressing (placeholders until the generator's props, OR-FB-001). */
function props(t: TrackData, g: HeightGrid) {
  const group = new THREE.Group();
  group.name = 'props';
  const rubber = new THREE.MeshLambertMaterial({ color: '#262321' });
  const tyre = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12);
  for (const p of t.props ?? []) {
    const y = sampleHeight(g, p.x, p.z);
    const o = new THREE.Group();
    o.position.set(p.x, y, p.z);
    o.rotation.y = p.rot ?? 0;
    if (p.kind === 'tyre_pile') {
      for (let k = 0; k < 5; k++) {
        const m = new THREE.Mesh(tyre, rubber);
        m.position.set((k % 2) * 0.3 - 0.15, 0.2 + k * 0.4, 0);
        m.castShadow = true;
        o.add(m);
      }
    } else if (p.kind === 'barrel') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 12), new THREE.MeshLambertMaterial({ color: '#2f6fb6' }));
      m.position.y = 0.6;
      m.castShadow = true;
      o.add(m);
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.0), new THREE.MeshLambertMaterial({ color: '#d8b453' }));
      m.position.y = 0.45;
      m.castShadow = true;
      o.add(m);
    }
    group.add(o);
  }
  return group;
}

export function buildTrack(t: TrackData, world: RAPIER.World): Track {
  const grid = buildHeights(t);
  const group = new THREE.Group();
  group.name = `track:${t.id}`;
  const tower = flagmanTower(t, grid);
  group.add(
    groundMesh(t, grid),
    tyreWalls(t, grid),
    wallFlags(t, grid),
    startLine(t, grid),
    tower.group,
    stadium(t, grid),
    props(t, grid),
    ...waterMeshes(t),
    ...mudMeshes(t, grid),
  );
  const ground = addHeightfield(world, grid);
  const walls = addWalls(world, grid, t.walls);
  const bounds = new THREE.Box3();
  for (const w of t.walls) for (const [x, z] of w.points) bounds.expandByPoint(new THREE.Vector3(x, sampleHeight(grid, x, z), z));
  bounds.min.y = Math.min(bounds.min.y, -0.5);
  bounds.max.y += WALL_HEIGHT;
  bounds.expandByScalar(0.6);
  const surfaces = t.zones.map((z): Surface => (z.type === 'water' ? { kind: 'water', drag: z.drag, grip: 0.8 } : { kind: 'mud', drag: z.drag, grip: z.grip }));
  const surface = (x: number, y: number, z: number): Surface => {
    for (let k = 0; k < t.zones.length; k++) {
      const zone = t.zones[k];
      if (!inZone(zone, x, z)) continue;
      if (zone.type === 'water' && y > zone.level + 1.2) continue;
      return surfaces[k];
    }
    return DRY;
  };
  return {
    data: t,
    grid,
    group,
    bounds,
    ground,
    walls,
    line: t.line ? new RacingLine(t.line) : null,
    lights: tower.lights,
    flagman: tower.flagman,
    heightAt: (x, z) => sampleHeight(grid, x, z),
    surface,
  };
}
