// Track data JSON → everything the race needs: the height grid, the ground and water meshes, tyre walls, physics
// colliders and zone queries. Placeholder art (vertex colours, primitive tyres) until the generator's 3D export
// (ssg model apply) supplies props.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { addHeightfield, addWalls, WALL_HEIGHT } from '../physics/heightfield';
import { buildHeights, polygonDistance, sampleHeight, type HeightGrid } from './heights';
import type { TrackData, WaterZone } from './types';

export interface Track {
  data: TrackData;
  grid: HeightGrid;
  group: THREE.Group;
  /** Box around the playfield including the walls: what the fixed camera frames. */
  bounds: THREE.Box3;
  heightAt(x: number, z: number): number;
  /** Drag (1/s) on a body at this point, 0 when dry. */
  water(x: number, y: number, z: number): number;
  ground: RAPIER.Collider;
}

const DIRT = new THREE.Color('#b8743f');
const DIRT_DARK = new THREE.Color('#8a5229');
const DIRT_LIGHT = new THREE.Color('#d39a5e');
const GRASS = new THREE.Color('#6f7f35');
const MUD = new THREE.Color('#5a3a20');
const OUTSIDE = new THREE.Color('#3a2418');

function hash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function inEllipse(z: WaterZone, x: number, zz: number) {
  return ((x - z.x) / z.rx) ** 2 + ((zz - z.z) / z.rz) ** 2 <= 1;
}

function groundMesh(t: TrackData, g: HeightGrid) {
  const cols = g.nx + 1;
  const rows = g.nz + 1;
  const pos = new Float32Array(rows * cols * 3);
  const col = new Float32Array(rows * cols * 3);
  const c = new THREE.Color();
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const k = i * cols + j;
      const x = -g.w / 2 + j * g.res;
      const z = -g.d / 2 + i * g.res;
      const y = g.h[k];
      pos.set([x, y, z], k * 3);
      // Higher ground is sun-bleached, hollows are darker and muddier; the infield is scrubby grass.
      const slope = y - sampleHeight(g, x - 1, z - 1);
      c.copy(DIRT).lerp(y > 0 ? DIRT_LIGHT : DIRT_DARK, Math.min(1, Math.abs(y) * 0.55));
      c.offsetHSL(0, 0, slope * 0.05 + (hash(x, z) - 0.5) * 0.05);
      if (y < -0.35) c.lerp(MUD, Math.min(1, (-y - 0.35) * 1.5));
      c.lerp(GRASS, g.infield[k] * 0.85);
      // Outside the outer wall: darker scrub, so the arena reads as one lit pit.
      const out = polygonDistance(x, z, t.walls[0].points);
      if (out > 0.6) c.lerp(OUTSIDE, Math.min(0.9, (out - 0.6) * 0.8));
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

/** Stacks of two tyres along every wall segment, alternating black and white like a painted tyre wall. */
function tyreWalls(t: TrackData, g: HeightGrid) {
  const spots: { x: number; z: number; y: number }[] = [];
  const step = 1.0;
  for (const w of t.walls) {
    const n = w.points.length;
    const segs = w.closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const [ax, az] = w.points[k];
      const [bx, bz] = w.points[(k + 1) % n];
      const len = Math.hypot(bx - ax, bz - az);
      const m = Math.max(1, Math.round(len / step));
      for (let s = 0; s < m; s++) {
        const x = ax + ((bx - ax) * s) / m;
        const z = az + ((bz - az) * s) / m;
        spots.push({ x, z, y: sampleHeight(g, x, z) });
      }
    }
  }
  const tyre = new THREE.CylinderGeometry(0.5, 0.5, 0.42, 14);
  const layers = Math.round(WALL_HEIGHT / 0.42);
  const mesh = new THREE.InstancedMesh(tyre, new THREE.MeshLambertMaterial(), spots.length * layers);
  const m4 = new THREE.Matrix4();
  const black = new THREE.Color('#222222');
  const white = new THREE.Color('#e8e4da');
  let i = 0;
  spots.forEach((p, si) => {
    for (let l = 0; l < layers; l++) {
      m4.makeTranslation(p.x, p.y + 0.21 + l * 0.42 - 0.15, p.z);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, (si + l) % 4 < 2 ? black : white);
      i++;
    }
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'walls';
  return mesh;
}

function waterMeshes(t: TrackData) {
  const out: THREE.Mesh[] = [];
  for (const z of t.zones) {
    if (z.type !== 'water') continue;
    const geo = new THREE.CircleGeometry(1, 40);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ color: '#4d86b8', transparent: true, opacity: 0.78 }),
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

/** A chequered start/finish strip across the lane at the start grid. */
function startLine(t: TrackData, g: HeightGrid) {
  const xs = t.start.grid.map((p) => p[0]);
  const zs = t.start.grid.map((p) => p[1]);
  const x = Math.max(...xs) + 4;
  const z0 = Math.min(...zs) - 5;
  const z1 = Math.max(...zs) + 5;
  const group = new THREE.Group();
  const sq = 0.9;
  const geo = new THREE.PlaneGeometry(sq, sq);
  const mats = [new THREE.MeshLambertMaterial({ color: '#f2efe6' }), new THREE.MeshLambertMaterial({ color: '#1c1c1c' })];
  for (let r = 0; r < 2; r++)
    for (let k = 0; k * sq < z1 - z0; k++) {
      const m = new THREE.Mesh(geo, mats[(r + k) % 2]);
      const px = x + r * sq;
      const pz = z0 + k * sq + sq / 2;
      m.rotation.x = -Math.PI / 2;
      m.position.set(px, sampleHeight(g, px, pz) + 0.03, pz);
      m.receiveShadow = true;
      group.add(m);
    }
  group.name = 'start-line';
  return group;
}

export function buildTrack(t: TrackData, world: RAPIER.World): Track {
  const grid = buildHeights(t);
  const group = new THREE.Group();
  group.name = `track:${t.id}`;
  group.add(groundMesh(t, grid), tyreWalls(t, grid), startLine(t, grid), ...waterMeshes(t));
  const ground = addHeightfield(world, grid);
  addWalls(world, grid, t.walls);
  const bounds = new THREE.Box3();
  for (const w of t.walls) for (const [x, z] of w.points) bounds.expandByPoint(new THREE.Vector3(x, sampleHeight(grid, x, z), z));
  bounds.min.y = Math.min(bounds.min.y, -0.5);
  bounds.max.y += WALL_HEIGHT;
  bounds.expandByScalar(0.6);
  return {
    data: t,
    grid,
    group,
    bounds,
    ground,
    heightAt: (x, z) => sampleHeight(grid, x, z),
    water: (x, y, z) => {
      for (const zone of t.zones) if (zone.type === 'water' && inEllipse(zone, x, z) && y < zone.level + 1.2) return zone.drag;
      return 0;
    },
  };
}
