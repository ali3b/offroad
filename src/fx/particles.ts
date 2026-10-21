// Pooled particles: one instanced quad mesh, camera-facing soft blobs. Simulated per physics step on the CPU
// (cheap: a few hundred live), uploaded once per rendered frame. Kinds: dust, splash, mud, smoke.
import * as THREE from 'three';

export type ParticleKind = 'dust' | 'splash' | 'mud' | 'smoke';

interface KindSpec {
  life: number;
  size0: number;
  size1: number;
  gravity: number;
  drag: number;
  alpha: number;
  colours: THREE.Color[];
}

const KINDS: Record<ParticleKind, KindSpec> = {
  dust: { life: 1.2, size0: 0.9, size1: 3.0, gravity: -0.6, drag: 2.2, alpha: 0.6, colours: ['#ecc79a', '#e2b88a', '#f2d6b0'].map((c) => new THREE.Color(c)) },
  splash: { life: 0.65, size0: 0.32, size1: 0.18, gravity: 12, drag: 0.6, alpha: 0.9, colours: ['#ffffff', '#d8ecff', '#a9d2f5'].map((c) => new THREE.Color(c)) },
  mud: { life: 0.75, size0: 0.34, size1: 0.24, gravity: 13, drag: 0.6, alpha: 0.95, colours: ['#3b2412', '#4c311b', '#2d1b0d'].map((c) => new THREE.Color(c)) },
  smoke: { life: 0.8, size0: 0.8, size1: 2.6, gravity: -1.2, drag: 2.5, alpha: 0.7, colours: ['#f4f4f4', '#e6e6e6'].map((c) => new THREE.Color(c)) },
};

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute float iSize;
attribute vec4 iColor;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vColor = iColor;
  vUv = uv;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * iSize;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = vColor.a * (1.0 - smoothstep(0.35, 1.0, d));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <colorspace_fragment>
}`;

export class Particles {
  readonly mesh: THREE.Mesh;
  private readonly cap: number;
  private n = 0;
  private px: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private kind: Uint8Array;
  private col: Float32Array;
  private aPos: THREE.InstancedBufferAttribute;
  private aSize: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private kinds = Object.keys(KINDS) as ParticleKind[];
  private seed = 1;

  constructor(cap = 1200) {
    this.cap = cap;
    this.px = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.col = new Float32Array(cap * 3);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iSize', this.aSize);
    this.geo.setAttribute('iColor', this.aCol);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'particles';
  }

  rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  get live() {
    return this.n;
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const k = KINDS[kind];
    this.px.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.age[i] = 0;
    this.life[i] = k.life * (0.75 + this.rand() * 0.5);
    this.kind[i] = this.kinds.indexOf(kind);
    const c = k.colours[Math.floor(this.rand() * k.colours.length)];
    this.col.set([c.r, c.g, c.b], i * 3);
  }

  step(dt: number) {
    for (let i = 0; i < this.n; ) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // Swap-remove with the last live particle.
        const j = --this.n;
        if (i !== j) {
          this.px.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.col.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.age[i] = this.age[j];
          this.life[i] = this.life[j];
          this.kind[i] = this.kind[j];
        }
        continue;
      }
      const k = KINDS[this.kinds[this.kind[i]]];
      const d = Math.exp(-k.drag * dt);
      const o = i * 3;
      this.vel[o] *= d;
      this.vel[o + 2] *= d;
      this.vel[o + 1] = this.vel[o + 1] * d - k.gravity * dt;
      this.px[o] += this.vel[o] * dt;
      this.px[o + 1] += this.vel[o + 1] * dt;
      this.px[o + 2] += this.vel[o + 2] * dt;
      i++;
    }
  }

  /** Upload the live particles (call once per rendered frame). */
  sync() {
    const pos = this.aPos.array as Float32Array;
    const size = this.aSize.array as Float32Array;
    const col = this.aCol.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const k = KINDS[this.kinds[this.kind[i]]];
      const t = this.age[i] / this.life[i];
      pos[i * 3] = this.px[i * 3];
      pos[i * 3 + 1] = this.px[i * 3 + 1];
      pos[i * 3 + 2] = this.px[i * 3 + 2];
      size[i] = k.size0 + (k.size1 - k.size0) * t;
      col[i * 4] = this.col[i * 3];
      col[i * 4 + 1] = this.col[i * 3 + 1];
      col[i * 4 + 2] = this.col[i * 3 + 2];
      col[i * 4 + 3] = k.alpha * (1 - t) * Math.min(1, t * 8 + 0.3);
    }
    this.geo.instanceCount = this.n;
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  clear() {
    this.n = 0;
    this.geo.instanceCount = 0;
  }
}
