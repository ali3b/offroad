// Trackside props from the generator's GLBs (public/models, `ssg model apply`). build.ts draws a placeholder per
// track JSON `props` entry (in order, inside the `props` group) and this swaps them for the real models once the
// GLBs have loaded: one InstancedMesh per GLB mesh, so ten barrels cost the same draw calls as one. It also adds the
// stadium dressing: floodlight trailers and advert billboards along the back wall.
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
const PROP_LOOK = 1.4;

export const PROP_MODELS: Record<string, { models: string[]; scale?: number }> = {
  tyre_pile: { models: ['tire_pile', 'tire_stack'] },
  tyre: { models: ['tire'] },
  barrel: { models: ['barrel', 'barrel_coloured'] },
  hay_bale: { models: ['hay_bale'] },
  cone: { models: ['cone'] },
  barrier: { models: ['barrier'] },
  floodlight: { models: ['floodlight'], scale: 1.2 },
  billboard: { models: ['billboard_pizza', 'billboard_burgers', 'billboard_holiday', 'billboard_donuts'] },
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

/**
 * Floodlight trailers along the back wall (the grandstand fills the far-left corner), with an advert billboard
 * between each pair, facing the camera; the adverts take turns along the wall.
 */
function stadiumSpots(t: Track): Spot[] {
  const xs = t.data.walls[0].points.map((p) => p[0]);
  const zs = t.data.walls[0].points.map((p) => p[1]);
  const a = Math.min(...xs) + 16;
  const b = Math.max(...xs) + 1;
  const z = Math.min(...zs) - 3.4;
  const n = Math.max(2, Math.round((b - a) / 28) + 1);
  const lights: Spot[] = Array.from({ length: n }, (_, k) => ({ kind: 'floodlight', x: a + ((b - a) * k) / (n - 1), z, rot: 0 }));
  const ads = PROP_MODELS.billboard.models;
  // The back wall's face is at z - 0.5 (build.ts stadium); a billboard is 1.15 m deep at PROP_LOOK, so stand it clear.
  const boards: Spot[] = lights.slice(1).map((l, k) => ({ kind: 'billboard', x: (lights[k].x + l.x) / 2, z: z + 0.25, rot: 0, model: ads[k % ads.length] }));
  return [...lights, ...boards];
}

/** Swap the placeholder props for the generator's models and add the stadium dressing (async; fire and forget). */
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
  spots.push(...stadiumSpots(track));
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
  const place = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let meshes = 0;
  await Promise.all(
    [...byModel].map(async ([name, { scale, spots: list }]) => {
      const model = await loadModel(name);
      if (!model) return;
      model.scene.updateMatrixWorld(true);
      model.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
        list.forEach((s, i) => {
          // Origin bottom-centre: y = 0 is the model's base, so it stands on the ground.
          q.setFromAxisAngle(up, s.rot);
          place.compose(new THREE.Vector3(s.x, track.heightAt(s.x, s.z), s.z), q, new THREE.Vector3(scale, scale, scale));
          inst.setMatrixAt(i, place.multiply(mesh.matrixWorld));
        });
        inst.castShadow = true;
        inst.receiveShadow = true;
        inst.name = `${name}:${mesh.name}`;
        group.add(inst);
        meshes++;
      });
      for (const s of list) if (s.placeholder) s.placeholder.visible = false;
    }),
  );
  track.group.add(group);
  return meshes;
}
