// Trackside props from the generator's GLBs (public/models, `ssg model apply`). build.ts draws a placeholder per
// track JSON `props` entry (in order, inside the `props` group) and this swaps them for the real models once the
// GLBs have loaded: one InstancedMesh per GLB mesh, so ten barrels cost the same draw calls as one. The stadium
// around the arena (grandstands, start arch, desert) is track/stadium-view.ts.
// Without models (no public/models at dev-server start) nothing changes and the placeholders stay.
import * as THREE from 'three';
import { loadModel, modelIndex } from '../race/models';
import type { Track } from './build';

/**
 * Track JSON prop kind → model names in ssg.models.json (a spot picks one variant by its position, so a track
 * looks the same every time) and an optional scale. Kinds not listed keep their placeholder.
 */
/**
 * Props are drawn bigger than life, like the trucks (TRUCK_LOOK): at the far camera a 1 m barrel is a few pixels.
 * The procedural wall tyres are 1 m across, so 1.4 keeps piles and bales in proportion with them.
 */
export const PROP_LOOK = 1.4;

export const PROP_MODELS: Record<string, { models: string[]; scale?: number }> = {
  tyre_pile: { models: ['tyre_stack_a', 'tyre_stack_b', 'tire_pile'] },
  tyre_barrier: { models: ['tyre_barrier'] },
  flags: { models: ['flags_sponsor'] },
  pit_wall: { models: ['pit_wall'] },
  pit_box: { models: ['pit_box'] },
  cactus: { models: ['cactus_tall', 'cactus_low', 'succulent_a', 'succulent_b'] },
  rock: { models: ['rock_a', 'rock_b', 'rock_tall'] },
  tyre: { models: ['tire'] },
  barrel: { models: ['barrel', 'barrel_coloured'] },
  hay_bale: { models: ['hay_bale'] },
  cone: { models: ['cone'] },
  barrier: { models: ['barrier'] },
};

interface Spot {
  kind: string;
  x: number;
  z: number;
  rot: number;
  /** A model chosen by the spot itself (else picked from the kind's list by position). */
  model?: string;
  /** The placeholder this spot replaces (hidden once the model is in). */
  placeholder?: THREE.Object3D;
}

const pick = (x: number, z: number, n: number) => Math.abs(Math.floor(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453)) % n;

/** One placement of a model: position (y = ground when left out), yaw and a uniform or per-axis scale. */
export interface Placement {
  x: number;
  z: number;
  y?: number;
  rot: number;
  scale: number | [number, number, number];
}

/**
 * Draw `list` placements of model `name` as one InstancedMesh per GLB mesh inside `group` (origin bottom-centre:
 * y = 0 is the model's base). Returns the meshes (none when the model is missing).
 */
export async function instanceModel(group: THREE.Group, track: Track, name: string, list: Placement[], o: { shadow?: boolean } = {}): Promise<THREE.InstancedMesh[]> {
  const model = await loadModel(name);
  if (!model || !list.length) return [];
  model.scene.updateMatrixWorld(true);
  const place = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const out: THREE.InstancedMesh[] = [];
  model.scene.traverse((o2) => {
    const mesh = o2 as THREE.Mesh;
    if (!mesh.isMesh) return;
    const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    list.forEach((s, i) => {
      q.setFromAxisAngle(up, s.rot);
      const sc = typeof s.scale === 'number' ? new THREE.Vector3(s.scale, s.scale, s.scale) : new THREE.Vector3(...s.scale);
      place.compose(new THREE.Vector3(s.x, s.y ?? track.heightAt(s.x, s.z), s.z), q, sc);
      inst.setMatrixAt(i, place.multiply(mesh.matrixWorld));
    });
    inst.castShadow = o.shadow ?? true;
    inst.receiveShadow = true;
    inst.name = `${name}:${mesh.name}`;
    inst.computeBoundingSphere();
    group.add(inst);
    out.push(inst);
  });
  return out;
}

/** Swap the placeholder props for the generator's models (async; fire and forget). */
export async function dressTrack(track: Track): Promise<number> {
  if (!(await modelIndex())) return 0;
  const holder = track.group.getObjectByName('props');
  const data = track.data.props ?? [];
  const spots: Spot[] = data.map((p, i) => ({
    kind: p.kind,
    x: p.x,
    z: p.z,
    rot: p.rot ?? 0,
    // build.ts adds one placeholder per entry, in order.
    placeholder: holder && holder.children.length === data.length ? holder.children[i] : undefined,
  }));
  // Group the spots by the model they get.
  const byModel = new Map<string, { scale: number; spots: Spot[] }>();
  for (const s of spots) {
    const entry = PROP_MODELS[s.kind];
    if (!entry) continue;
    const name = s.model ?? entry.models[pick(s.x, s.z, entry.models.length)];
    const list = byModel.get(name) ?? { scale: (entry.scale ?? 1) * PROP_LOOK, spots: [] };
    list.spots.push(s);
    byModel.set(name, list);
  }
  const group = new THREE.Group();
  group.name = 'prop-models';
  track.group.add(group);
  let meshes = 0;
  await Promise.all(
    [...byModel].map(async ([name, { scale, spots: list }]) => {
      const got = await instanceModel(group, track, name, list.map((s) => ({ ...s, scale })));
      meshes += got.length;
      if (got.length) for (const s of list) if (s.placeholder) s.placeholder.visible = false;
    }),
  );
  return meshes;
}
