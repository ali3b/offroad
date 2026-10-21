// Track data JSON → everything the race needs: the height grid, the ground, water and mud meshes, tyre walls with
// flags, the start line and flagman tower, the stadium dressing, physics colliders and surface queries.
// Placeholder art (vertex colours, primitive tyres and props) until the generator's 3D export supplies props
// (ssg.models.json; OR-FB-001).
import * as THREE from 'three';
import { addHeightfield, addWalls, WALL_HEIGHT } from '../physics/heightfield';
import { GROUP, RAPIER } from '../physics/world';
import { DIRT as DRY, type Surface } from '../physics/vehicle';
import { bridgeFrame, buildHeights, featureHeight, onDeck, polygonDistance, polylineDistance, sampleHeight, type BridgeFrame, type HeightGrid } from './heights';
import { RacingLine } from './line';
import type { BridgeFeature, Palette, TrackData, XZ, Zone } from './types';

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
  /**
   * The height a truck driving at `heading` would ride on at (x, z): the bridge deck when it's on a deck's footprint
   * and heading along the deck, else the ground. Used to put trucks and pickups on the right level.
   */
  levelAt(x: number, z: number, heading: number): number;
  /** Bridge decks (their own colliders over the heightfield). */
  decks: RAPIER.Collider[];
  bridges: BridgeFrame[];
  /** The surface under a point: dirt, water or mud. */
  surface(x: number, y: number, z: number): Surface;
  ground: RAPIER.Collider;
  walls: RAPIER.Collider[];
  line: RacingLine | null;
  lights: StartLights;
  flagman: Flagman;
}

// The original's sandy arena palette: orange-brown dirt, sun-bleached pink ridges, dark pits. A track's `palette`
// overrides any of these (its accent colours).
const DEFAULT_PALETTE: Required<Palette> = {
  dirt: '#b57336',
  dirtDark: '#7f4a22',
  dirtLight: '#c98a4c',
  ridge: '#d6a088',
  wallA: '#c42a24',
  wallB: '#e9e4dc',
  flag: '#2f55d4',
  backWall: '#9c97c9',
  accent: '#2f6fb6',
};
const paletteOf = (t: TrackData): Required<Palette> => ({ ...DEFAULT_PALETTE, ...t.palette });
const GRASS = new THREE.Color('#6f7f35');
const MUD = new THREE.Color('#553519');
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

/** Normalised distance into a zone: 0 at its centre (line), 1 at its edge. */
function zoneR(z: Zone, x: number, zz: number) {
  return z.shape === 'path' ? polylineDistance(x, zz, z.points) / (z.width / 2) : Math.hypot((x - z.x) / z.rx, (zz - z.z) / z.rz);
}

/** 0 outside .. 1 well inside a zone, with a soft rim of `soft` (in zone radii). */
function zoneWeight(z: Zone, x: number, zz: number, soft = 0.25) {
  return Math.max(0, Math.min(1, (1 - zoneR(z, x, zz)) / soft));
}

function inZone(z: Zone, x: number, zz: number) {
  return zoneR(z, x, zz) <= 1;
}

/** A zone's bounding box (x0, z0, x1, z1) with `pad` metres around it. */
function zoneBox(z: Zone, pad = 0): [number, number, number, number] {
  if (z.shape === 'ellipse') return [z.x - z.rx - pad, z.z - z.rz - pad, z.x + z.rx + pad, z.z + z.rz + pad];
  const xs = z.points.map((p) => p[0]);
  const zs = z.points.map((p) => p[1]);
  const r = z.width / 2 + pad;
  return [Math.min(...xs) - r, Math.min(...zs) - r, Math.max(...xs) + r, Math.max(...zs) + r];
}

function groundMesh(t: TrackData, g: HeightGrid) {
  const pal = paletteOf(t);
  const DIRT = new THREE.Color(pal.dirt);
  const DIRT_DARK = new THREE.Color(pal.dirtDark);
  const DIRT_LIGHT = new THREE.Color(pal.dirtLight);
  const RIDGE = new THREE.Color(pal.ridge);
  const cols = g.nx + 1;
  const rows = g.nz + 1;
  const pos = new Float32Array(rows * cols * 3);
  const col = new Float32Array(rows * cols * 3);
  const c = new THREE.Color();
  // Raised earth (ridges, banks, plateaus) is sun-bleached pink; a negative ridge is a channel and stays dirt.
  const ridges = t.features.filter((f) => (f.type === 'ridge' && f.height > 0) || f.type === 'bank' || f.type === 'plateau');
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
        const w = featureHeight(r, x, z) / ('height' in r ? r.height : 1);
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
  const mat = new THREE.MeshPhongMaterial({
    color: '#5b3b1f',
    specular: '#9a7a58',
    shininess: 70,
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
    const [bx0, bz0, bx1, bz1] = zoneBox(z, 1);
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const x = bx0 + (j / n) * (bx1 - bx0);
        const zz = bz0 + (i / n) * (bz1 - bz0);
        const a = zoneWeight(z, x, zz, 0.4) * (0.6 + 0.35 * vnoise(x * 0.8, zz * 0.8));
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
  const pal = paletteOf(t);
  const red = new THREE.Color(pal.wallA);
  const white = new THREE.Color(pal.wallB);
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
  const flagMat = new THREE.MeshLambertMaterial({ color: paletteOf(t).flag, side: THREE.DoubleSide });
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
    const mat = new THREE.MeshStandardMaterial({ color: '#4f8fc4', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 });
    if (z.shape === 'path') {
      // A creek: a flat sheet at the water level, kept where it's inside the band (fine cells, so the banks are smooth).
      const [x0, z0, x1, z1] = zoneBox(z);
      const cell = 0.35;
      const nx = Math.ceil((x1 - x0) / cell);
      const nz = Math.ceil((z1 - z0) / cell);
      const pos: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= nz; i++) for (let j = 0; j <= nx; j++) pos.push(x0 + j * cell, z.level, z0 + i * cell);
      const inside = (k: number) => zoneR(z, pos[k * 3], pos[k * 3 + 2]) <= 1.02;
      for (let i = 0; i < nz; i++)
        for (let j = 0; j < nx; j++) {
          const a = i * (nx + 1) + j;
          const b = a + 1;
          const c = a + nx + 1;
          const d = c + 1;
          if (inside(a) && inside(b) && inside(c)) idx.push(a, c, b);
          if (inside(b) && inside(c) && inside(d)) idx.push(b, c, d);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.name = 'water';
      out.push(mesh);
      continue;
    }
    const geo = new THREE.CircleGeometry(1, 40);
    const mesh = new THREE.Mesh(geo, mat);
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
  const back = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 16, 3.2, 0.6), new THREE.MeshLambertMaterial({ color: paletteOf(t).backWall }));
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
  const accent = new THREE.MeshLambertMaterial({ color: paletteOf(t).accent });
  const coneMat = new THREE.MeshLambertMaterial({ color: '#f06a1a' });
  const bandMat = new THREE.MeshLambertMaterial({ color: '#f4f1ea' });
  const pal = paletteOf(t);
  const poleMat = new THREE.MeshLambertMaterial({ color: '#f4f1ea' });
  const pennant = new THREE.BufferGeometry();
  pennant.setAttribute('position', new THREE.Float32BufferAttribute([-0.3, 0, 0, 0.3, 0, 0, 0, -0.55, 0], 3));
  pennant.computeVertexNormals();
  const pennantMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const drumMat = new THREE.MeshLambertMaterial({ color: '#f1efe9' });
  const bandA = new THREE.MeshLambertMaterial({ color: '#c8302a' });
  const bandB = new THREE.MeshLambertMaterial({ color: '#2f5fc8' });
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
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 12), accent);
      m.position.y = 0.6;
      m.castShadow = true;
      o.add(m);
    } else if (p.kind === 'bunting') {
      // Two poles and a sagging string of pennants in alternating colours, high enough to drive (and jump) under.
      const len = p.len ?? 12;
      const top = 4.2;
      for (const end of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, top, 6), poleMat);
        pole.position.set((end * len) / 2, top / 2, 0);
        pole.castShadow = true;
        o.add(pole);
      }
      const n = Math.round(len / 0.9);
      const flags = new THREE.InstancedMesh(pennant, pennantMat, n);
      const m4 = new THREE.Matrix4();
      const colours = [pal.flag, pal.wallA, pal.wallB].map((c) => new THREE.Color(c));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        const x = (u - 0.5) * len;
        const y = top - 0.15 - Math.sin(u * Math.PI) * 0.7;
        m4.makeTranslation(x, y, 0);
        flags.setMatrixAt(k, m4);
        flags.setColorAt(k, colours[k % colours.length]);
      }
      o.add(flags);
      // Stand the bunting on the highest ground under it (it spans a ridge).
      let hi = -Infinity;
      for (let k = 0; k <= 8; k++) {
        const x = (k / 8 - 0.5) * len;
        const c = Math.cos(p.rot ?? 0);
        const sn = Math.sin(p.rot ?? 0);
        hi = Math.max(hi, sampleHeight(g, p.x + x * c, p.z - x * sn));
      }
      o.position.y = hi;
    } else if (p.kind === 'drum') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.2, 24), drumMat);
      body.position.y = 1.6;
      body.castShadow = true;
      body.receiveShadow = true;
      o.add(body);
      for (const [y, mat] of [[0.7, bandA], [2.5, bandB]] as const) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(1.53, 1.53, 0.45, 24), mat);
        band.position.y = y;
        o.add(band);
      }
    } else if (p.kind === 'cone') {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.85, 10), coneMat);
      m.position.y = 0.43;
      m.castShadow = true;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.16, 10), bandMat);
      band.position.y = 0.48;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.06, 0.75), coneMat);
      base.position.y = 0.03;
      o.add(m, band, base);
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

/** Red/white stripes for a bridge's sides (a canvas texture repeated along the deck). */
function stripeTexture(a: string, b: string) {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 4;
  const cx = cv.getContext('2d')!;
  cx.fillStyle = a;
  cx.fillRect(0, 0, 16, 4);
  cx.fillStyle = b;
  cx.fillRect(16, 0, 16, 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Each bridge: the deck (a plank slab with striped sides) and its two railings, drawn and collided. The deck is a
 * cuboid collider flush with the embankment top; the railings are walls that start under the deck edge and stop
 * 1.6 m above it, so they never reach down into the lane below.
 */
function bridges(t: TrackData, world: RAPIER.World, frames: BridgeFrame[]) {
  const group = new THREE.Group();
  group.name = 'bridges';
  const decks: RAPIER.Collider[] = [];
  const rails: RAPIER.Collider[] = [];
  const pal = paletteOf(t);
  const SLAB = 0.4;
  for (const b of frames) {
    const f = b.f as BridgeFeature;
    const len = b.spanHalf * 2;
    const yaw = f.heading;
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const deckW = f.width + 1;
    // Deck: local x across, z along (the heading), so it lines up with three's rotation.y = heading.
    const stripes = stripeTexture(pal.wallA, pal.wallB);
    stripes.repeat.set(len / 3, 1);
    const side = new THREE.MeshLambertMaterial({ map: stripes });
    const top = new THREE.MeshLambertMaterial({ color: '#7a5634' });
    const under = new THREE.MeshLambertMaterial({ color: '#3b2a1c' });
    // Box faces: +x, -x, +y, -y, +z, -z. The long sides (±x) carry the stripes.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, SLAB, len), [side, side, top, under, under, under]);
    deck.position.set(f.x, f.height - SLAB / 2, f.z);
    deck.rotation.y = yaw;
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);
    // Planks across the deck.
    const plank = new THREE.BoxGeometry(deckW - 0.2, 0.04, 0.12);
    const plankMat = new THREE.MeshLambertMaterial({ color: '#4a3220' });
    const nPl = Math.floor(len / 0.9);
    const planks = new THREE.InstancedMesh(plank, plankMat, nPl);
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const one = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < nPl; k++) {
      const u = -len / 2 + (k + 0.5) * (len / nPl);
      m4.compose(new THREE.Vector3(f.x + b.ux * u, f.height + 0.01, f.z + b.uz * u), quat, one);
      planks.setMatrixAt(k, m4);
    }
    planks.receiveShadow = true;
    group.add(planks);
    decks.push(
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(deckW / 2, SLAB / 2, len / 2)
          .setTranslation(f.x, f.height - SLAB / 2, f.z)
          .setRotation(q)
          .setFriction(0.9)
          .setRestitution(0.05)
          .setCollisionGroups(GROUP.STATIC),
      ),
    );
    // Railings: striped barriers along both edges with a flag pole (the bunting colour) at each corner.
    const railTex = stripeTexture(pal.wallA, pal.wallB);
    railTex.repeat.set(len / 2, 1);
    const railMat = new THREE.MeshLambertMaterial({ map: railTex });
    const poleMat = new THREE.MeshLambertMaterial({ color: '#f4f1ea' });
    const flagMat = new THREE.MeshLambertMaterial({ color: pal.flag, side: THREE.DoubleSide });
    for (const sgn of [-1, 1]) {
      const v = sgn * (f.width / 2 + 0.25);
      const cx = f.x + b.uz * v;
      const cz = f.z - b.ux * v;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, len), [railMat, railMat, under, under, under, under]);
      rail.position.set(cx, f.height + 0.5, cz);
      rail.rotation.y = yaw;
      rail.castShadow = true;
      group.add(rail);
      rails.push(
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.25, 1.1, len / 2)
            .setTranslation(cx, f.height + 0.5, cz)
            .setRotation(q)
            .setFriction(0.2)
            .setRestitution(0.45)
            .setCollisionGroups(GROUP.STATIC),
        ),
      );
      for (const end of [-1, 1]) {
        const px = cx + b.ux * end * (len / 2);
        const pz = cz + b.uz * end * (len / 2);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), poleMat);
        pole.position.set(px, f.height + 1.2, pz);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), flagMat);
        flag.position.set(px + 0.45, f.height + 2.15, pz);
        group.add(pole, flag);
      }
    }
  }
  return { group, decks, rails };
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
  const frames = t.features.filter((f): f is BridgeFeature => f.type === 'bridge').map(bridgeFrame);
  const br = bridges(t, world, frames);
  group.add(br.group);
  // Railings count as walls (impact sounds, the AI's nose-in check).
  // Giant drums are solid (a truck bounces off them like a wall).
  const drums = (t.props ?? [])
    .filter((p) => p.kind === 'drum')
    .map((p) =>
      world.createCollider(
        RAPIER.ColliderDesc.cylinder(1.6, 1.5)
          .setTranslation(p.x, sampleHeight(grid, p.x, p.z) + 1.6, p.z)
          .setFriction(0.2)
          .setRestitution(0.45)
          .setCollisionGroups(GROUP.STATIC),
      ),
    );
  const walls = [...addWalls(world, grid, t.walls), ...br.rails, ...drums];
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
    levelAt: (x, z, heading) => {
      for (const b of frames) {
        if (!onDeck(b, x, z, 0.5)) continue;
        const along = Math.abs(Math.cos(heading - b.f.heading));
        const across = Math.abs(Math.cos(heading - (b.f as BridgeFeature).under.heading));
        if (along >= across) return (b.f as BridgeFeature).height;
      }
      return sampleHeight(grid, x, z);
    },
    decks: br.decks,
    bridges: frames,
    surface,
  };
}
