// Synty characters from the generator (ssg.models.json `driver_<colour>`, `fan_*`, `crowd_*`). `Character` is one
// animated copy of a skinned export (its own skeleton and AnimationMixer). Crowds use `crowd_*`: exports with baked
// static poses (`poses`: idle and two cheer frames), plain meshes ready for an InstancedMesh.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadModel, modelIndex, type LoadedModel } from './models';
import type { Colour } from './roster';

/**
 * The clips the game merges into its character exports (ssg.models.json), by what they are for. The specs qualify
 * them by gender (`POLY_IDL_Base@Feminine`) and the GLB names a clip as asked, so lookups match the base name.
 */
export const CLIPS = {
  idle: 'POLY_IDL_Base',
  victory: 'MartialArts_Victory',
  cheer: 'POLY_IDL_Wave_Double_Loop',
  wave: 'POLY_IDL_Wave_Large_Loop',
  waveSmall: 'POLY_IDL_Wave_Small_Loop',
  dejected: 'POLY_IDL_Posture_Slumped_Loop',
} as const;

export const FANS = ['fan_a', 'fan_b', 'fan_c'] as const;
/** The same three fans as baked static poses (`poses` exports), in FANS order. */
export const CROWD = ['crowd_a', 'crowd_b', 'crowd_c'] as const;
/** The pose nodes of a crowd export: standing idle, then two frames of the two-arm wave for the cheer. */
export const CROWD_POSES = ['idle', 'cheer_a', 'cheer_b'] as const;
export const driverModel = (c: Colour) => `driver_${c}`;

/** One driver or fan with its own skeleton, playing clips by name with a short cross-fade. */
export class Character {
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private action: THREE.AnimationAction | null = null;
  current = '';

  constructor(readonly model: LoadedModel) {
    this.root = cloneSkinned(model.scene);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        // The bind-pose bounds (arms out) would cull the posed character at the screen edges.
        o.frustumCulled = false;
      }
    });
    this.mixer = new THREE.AnimationMixer(this.root);
  }

  has(clip: string) {
    return !!findClip(this.model.clips, clip);
  }

  /**
   * Play a clip (looping unless `once`; a one-shot holds its last frame). `then` follows a one-shot when it ends.
   * Unknown clips are ignored, so a missing export clip leaves the character in its current pose.
   */
  play(name: string, o: { once?: boolean; fade?: number; then?: string; offset?: number } = {}) {
    const clip = findClip(this.model.clips, name);
    if (!clip || this.current === name) return;
    const next = this.mixer.clipAction(clip);
    next.reset();
    next.setLoop(o.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = !!o.once;
    if (o.offset) next.time = o.offset % clip.duration;
    const fade = o.fade ?? 0.25;
    if (this.action) next.crossFadeFrom(this.action, fade, false);
    next.play();
    this.action = next;
    this.current = name;
    if (o.once && o.then) {
      const then = o.then;
      const done = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== next) return;
        this.mixer.removeEventListener('finished', done);
        if (this.current === name) this.play(then, { fade: 0.4 });
      };
      this.mixer.addEventListener('finished', done);
    }
  }

  /** The node of a manifest socket (`hand_r`, `head`, …). */
  socket(name: string): THREE.Object3D | undefined {
    const s = this.model.manifest.sockets?.find((x) => x.name === name);
    return s ? this.root.getObjectByName(s.node) : undefined;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}

/** A clip by its base name: exact, or qualified (`name@Feminine`, `name@#664`). */
export function findClip(clips: THREE.AnimationClip[], name: string): THREE.AnimationClip | undefined {
  return clips.find((c) => c.name === name) ?? clips.find((c) => c.name.startsWith(`${name}@`));
}

/** Load character models by name (cached by loadModel); missing ones are left out. */
export async function loadCharacters(names: readonly string[]): Promise<Record<string, LoadedModel>> {
  if (!(await modelIndex())) return {};
  const out: Record<string, LoadedModel> = {};
  const got = await Promise.all(names.map((n) => loadModel(n).catch(() => null)));
  names.forEach((n, i) => {
    if (got[i]?.clips.length) out[n] = got[i]!;
  });
  return out;
}

/** One baked pose of a `poses` export: its static mesh parts (usually one, a primitive per material). */
export interface PosePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** The part's transform within the export (root fit, pose node, meshopt's dequantising child). */
  matrix: THREE.Matrix4;
}

/**
 * The baked poses of a `poses` export (ssg.models.json `crowd_*`), by pose name in `names` order; null when the
 * model is missing or lacks one of the poses.
 */
export async function loadPoses(name: string, names: readonly string[]): Promise<PosePart[][] | null> {
  const model = await loadModel(name);
  if (!model) return null;
  model.scene.updateMatrixWorld(true);
  const out: PosePart[][] = [];
  for (const n of names) {
    const node = model.scene.getObjectByName(n);
    if (!node) return null;
    const parts: PosePart[] = [];
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      parts.push({ geometry: m.geometry, material: Array.isArray(m.material) ? m.material[0] : m.material, matrix: m.matrixWorld.clone() });
    });
    out.push(parts);
  }
  return out;
}
