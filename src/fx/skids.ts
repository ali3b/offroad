// Skid marks: a ring buffer of ground decal segments (one instanced quad each, built in the vertex shader from the
// segment's two ends) that fade out over FADE seconds. Each wheel extends its own trail while it slides.
import * as THREE from 'three';

const FADE = 22;

const VERT = /* glsl */ `
attribute vec3 iA;
attribute vec3 iB;
attribute vec2 iMeta; // birth time, strength
uniform float uTime;
varying float vAlpha;
void main() {
  vec3 dir = iB - iA;
  vec3 side = normalize(vec3(-dir.z, 0.0, dir.x) + vec3(1e-5, 0.0, 0.0));
  vec3 p = mix(iA, iB, position.y + 0.5) + side * position.x * 0.42;
  float age = uTime - iMeta.x;
  vAlpha = iMeta.y * clamp(1.0 - age / ${FADE.toFixed(1)}, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) discard;
  gl_FragColor = vec4(0.17, 0.09, 0.04, vAlpha);
  #include <colorspace_fragment>
}`;

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly cap: number;
  private next = 0;
  private count = 0;
  private aA: THREE.InstancedBufferAttribute;
  private aB: THREE.InstancedBufferAttribute;
  private aMeta: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private dirty = false;
  /** Per wheel trail: the last point laid, or null when the trail is broken. */
  private last = new Map<number, THREE.Vector3 | null>();

  constructor(cap = 2400) {
    this.cap = cap;
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aMeta = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iA', this.aA);
    this.geo.setAttribute('iB', this.aB);
    this.geo.setAttribute('iMeta', this.aMeta);
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'skids';
  }

  get segments() {
    return this.count;
  }

  /** Extend wheel `key`'s trail to (x, y, z), or break it with strength 0. */
  mark(key: number, x: number, y: number, z: number, strength: number, time: number) {
    const prev = this.last.get(key);
    if (strength <= 0) {
      this.last.set(key, null);
      return;
    }
    const p = new THREE.Vector3(x, y + 0.04, z);
    if (!prev) {
      this.last.set(key, p);
      return;
    }
    if (prev.distanceToSquared(p) < 0.35 * 0.35) return;
    if (prev.distanceToSquared(p) > 3 * 3) {
      this.last.set(key, p);
      return;
    }
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.count = Math.min(this.cap, this.count + 1);
    (this.aA.array as Float32Array).set([prev.x, prev.y, prev.z], i * 3);
    (this.aB.array as Float32Array).set([p.x, p.y, p.z], i * 3);
    (this.aMeta.array as Float32Array).set([time, Math.min(0.6, strength)], i * 2);
    this.last.set(key, p);
    this.dirty = true;
  }

  sync(time: number) {
    this.mat.uniforms.uTime.value = time;
    if (!this.dirty) return;
    this.geo.instanceCount = this.count;
    this.aA.needsUpdate = this.aB.needsUpdate = this.aMeta.needsUpdate = true;
    this.dirty = false;
  }

  clear() {
    this.count = 0;
    this.next = 0;
    this.last.clear();
    this.geo.instanceCount = 0;
  }
}
