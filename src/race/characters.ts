// Synty characters from the generator (ssg.models.json `driver_<colour>`, `fan_*`): skinned GLBs with their clips
// merged in. `Character` is one animated copy (its own skeleton and AnimationMixer); `bakePose` freezes a clip at a
// time into a plain static mesh, so a crowd can draw dozens of copies as one InstancedMesh per pose.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadModel, modelIndex, type LoadedModel } from './models';
import type { Colour } from './roster';

/** The clips the game merges into its character exports (ssg.models.json), by what they are for. */
export const CLIPS = {
  idle: 'POLY_IDL_Base',
  victory: 'MartialArts_Victory',
  cheer: 'POLY_IDL_Wave_Double_Loop',
  wave: 'POLY_IDL_Wave_Large_Loop',
  waveSmall: 'POLY_IDL_Wave_Small_Loop',
  dejected: 'POLY_IDL_Posture_Slumped_Loop',
} as const;

export const FANS = ['fan_a', 'fan_b', 'fan_c'] as const;
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
    return !!THREE.AnimationClip.findByName(this.model.clips, clip);
  }

  /**
   * Play a clip (looping unless `once`; a one-shot holds its last frame). `then` follows a one-shot when it ends.
   * Unknown clips are ignored, so a missing export clip leaves the character in its current pose.
   */
  play(name: string, o: { once?: boolean; fade?: number; then?: string; offset?: number } = {}) {
    const clip = THREE.AnimationClip.findByName(this.model.clips, name);
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

export interface BakedPose {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Freeze `clip` at `time` (s) into static geometry in the model's own frame (feet at y = 0, facing +Z): the CPU
 * skins every vertex once. A static pose draws as a plain (instanced) mesh, with no skeleton per copy.
 */
export function bakePose(model: LoadedModel, clip: string, time: number): BakedPose[] {
  const root = cloneSkinned(model.scene);
  const mixer = new THREE.AnimationMixer(root);
  const c = THREE.AnimationClip.findByName(model.clips, clip);
  if (c) {
    mixer.clipAction(c).play();
    mixer.setTime(Math.min(time, c.duration));
  }
  root.updateMatrixWorld(true);
  const out: BakedPose[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const src = m.geometry;
    const pos = src.getAttribute('position');
    const nor = src.getAttribute('normal');
    const p = new Float32Array(pos.count * 3);
    const n = new Float32Array(pos.count * 3);
    const normalMat = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    if (m.isSkinnedMesh) m.skeleton.update();
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (m.isSkinnedMesh) {
        // The normal follows the skinning: skin the point one normal-length away and take the difference.
        if (nor) _n.fromBufferAttribute(nor, i).multiplyScalar(0.01).add(_v);
        m.applyBoneTransform(i, _v);
        if (nor) m.applyBoneTransform(i, _n);
        if (nor) _n.sub(_v);
      } else if (nor) _n.fromBufferAttribute(nor, i);
      _v.applyMatrix4(m.matrixWorld);
      _v.toArray(p, i * 3);
      if (nor) _n.applyMatrix3(normalMat).normalize().toArray(n, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    if (nor) g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    else g.computeVertexNormals();
    const uv = src.getAttribute('uv');
    if (uv) g.setAttribute('uv', uv);
    if (src.index) g.setIndex(src.index);
    for (const grp of src.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
    g.computeBoundingSphere();
    out.push({ geometry: g, material: Array.isArray(m.material) ? m.material[0] : m.material });
  });
  mixer.stopAllAction();
  return out;
}
