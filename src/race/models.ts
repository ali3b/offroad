// Truck models from the generator: `public/models/models.json` is written by `ssg model apply` (npm run assets) and
// lists a GLB plus its manifest per model (format: the generator's docs/MODELS.md). When the folder is missing the
// game draws placeholder box trucks. __HAS_MODELS__ is decided at build/dev-server start (vite.config.ts), so a
// missing file never causes a 404 in the console.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

declare const __HAS_MODELS__: boolean;

export interface WheelInfo {
  node: string;
  radius: number;
  axle: [number, number, number];
  steer: boolean;
}

export interface ModelManifest {
  version: number;
  name: string;
  origin: string;
  bounds: { min: number[]; max: number[]; size: number[] };
  wheels?: Partial<Record<'fl' | 'fr' | 'rl' | 'rr', WheelInfo>>;
  collider?: { box: { center: number[]; size: number[] } };
}

export interface LoadedModel {
  scene: THREE.Object3D;
  manifest: ModelManifest;
}

export type TruckModels = Partial<Record<'red' | 'yellow' | 'blue' | 'grey', LoadedModel>>;

/** Load truck_<colour> GLBs listed in models.json; null when there are none (use the box trucks). */
export async function loadTruckModels(): Promise<TruckModels | null> {
  if (typeof __HAS_MODELS__ === 'undefined' || !__HAS_MODELS__) return null;
  const base = `${import.meta.env.BASE_URL}models/`;
  try {
    const index = (await (await fetch(`${base}models.json`)).json()) as {
      models: Record<string, { glb: string; data: ModelManifest }>;
    };
    const loader = new GLTFLoader();
    const out: TruckModels = {};
    for (const colour of ['red', 'yellow', 'blue', 'grey'] as const) {
      const entry = index.models[`truck_${colour}`];
      if (!entry) continue;
      const gltf = await loader.loadAsync(`${base}${entry.glb}`);
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      out[colour] = { scene: gltf.scene, manifest: entry.data };
    }
    return Object.keys(out).length ? out : null;
  } catch (e) {
    console.warn('truck models could not be loaded; using box trucks', e);
    return null;
  }
}
