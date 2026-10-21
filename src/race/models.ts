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
  /** The wheel centre in the model's metres (the node sits there). */
  pos?: [number, number, number];
}

export interface ModelManifest {
  version: number;
  name: string;
  origin: string;
  bounds: { min: number[]; max: number[]; size: number[] };
  wheels?: Partial<Record<'fl' | 'fr' | 'rl' | 'rr', WheelInfo>>;
  collider?: { box: { center: number[]; size: number[] } };
  warnings?: string[];
}

interface ModelIndex {
  models: Record<string, { glb: string; data: ModelManifest }>;
}

const BASE = `${import.meta.env.BASE_URL}models/`;
let indexP: Promise<ModelIndex | null> | null = null;
const glbs = new Map<string, Promise<LoadedModel | null>>();

/** public/models/models.json, fetched once; null when the game was started without models. */
export function modelIndex(): Promise<ModelIndex | null> {
  if (typeof __HAS_MODELS__ === 'undefined' || !__HAS_MODELS__) return Promise.resolve(null);
  indexP ??= fetch(`${BASE}models.json`)
    .then((r) => r.json() as Promise<ModelIndex>)
    .catch(() => null);
  return indexP;
}

/** One model from the index by name (loaded once, shared: clone the scene before adding it twice). */
export function loadModel(name: string): Promise<LoadedModel | null> {
  let p = glbs.get(name);
  if (!p) {
    p = modelIndex().then(async (index) => {
      const entry = index?.models[name];
      if (!entry) return null;
      const gltf = await new GLTFLoader().loadAsync(`${BASE}${entry.glb}`);
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      return { scene: gltf.scene, manifest: entry.data };
    });
    glbs.set(name, p);
  }
  return p;
}

export interface LoadedModel {
  scene: THREE.Object3D;
  manifest: ModelManifest;
}

export type TruckModels = Partial<Record<'red' | 'yellow' | 'blue' | 'grey', LoadedModel>>;

/** Load truck_<colour> GLBs listed in models.json; null when there are none (use the box trucks). */
export async function loadTruckModels(): Promise<TruckModels | null> {
  try {
    if (!(await modelIndex())) return null;
    const out: TruckModels = {};
    const colours = ['red', 'yellow', 'blue', 'grey'] as const;
    const loaded = await Promise.all(colours.map((c) => loadModel(`truck_${c}`)));
    colours.forEach((c, i) => {
      if (loaded[i]) out[c] = loaded[i]!;
    });
    return Object.keys(out).length ? out : null;
  } catch (e) {
    console.warn('truck models could not be loaded; using box trucks', e);
    return null;
  }
}
