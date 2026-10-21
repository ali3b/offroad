// Money bags and nitro bottles that drop onto the racing line about once a lap. Each one collected raises the
// value of the next drop of that kind: money 10K → 20K → 30K, nitros 1 → 2. Any truck can collect them.
import * as THREE from 'three';
import type { RacingLine } from '../track/line';
import type { Truck } from '../physics/vehicle';

export type PickupKind = 'money' | 'nitro';

interface Item {
  kind: PickupKind;
  value: number;
  x: number;
  y: number;
  z: number;
  ttl: number;
  mesh: THREE.Object3D;
}

const MONEY_STEPS = [10_000, 20_000, 30_000];
const NITRO_STEPS = [1, 2];
const RADIUS = 2.7;

function dollarTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a3b00';
  g.font = 'bold 26px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('$', 16, 17);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Pickups {
  readonly group = new THREE.Group();
  items: Item[] = [];
  private moneyStep = 0;
  private nitroStep = 0;
  private spawnT: number;
  private seed: number;
  private bagGeo = new THREE.SphereGeometry(0.62, 14, 10);
  private bagMat = new THREE.MeshLambertMaterial({ color: '#f0c22c', emissive: '#3a2a00' });
  private dollar = new THREE.SpriteMaterial({ map: dollarTexture(), depthTest: false });
  private bottleGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 12);
  private bottleMat = new THREE.MeshLambertMaterial({ color: '#c8ccd4', emissive: '#202226' });
  private capMat = new THREE.MeshLambertMaterial({ color: '#d0281e' });

  constructor(
    readonly line: RacingLine,
    /** The level a truck rides on at (x, z) heading that way (the deck on a bridge, else the ground). */
    readonly heightAt: (x: number, z: number, heading: number) => number,
    /** Rough lap time (s): about one drop per lap. */
    readonly lapTime: number,
    seed = 7,
  ) {
    this.group.name = 'pickups';
    this.seed = seed;
    this.spawnT = lapTime * 0.5;
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  nextValue(kind: PickupKind) {
    return kind === 'money' ? MONEY_STEPS[Math.min(this.moneyStep, MONEY_STEPS.length - 1)] : NITRO_STEPS[Math.min(this.nitroStep, NITRO_STEPS.length - 1)];
  }

  private makeMesh(kind: PickupKind) {
    const o = new THREE.Group();
    if (kind === 'money') {
      const bag = new THREE.Mesh(this.bagGeo, this.bagMat);
      bag.scale.set(1, 0.85, 1);
      bag.castShadow = true;
      const knot = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.4, 8), this.bagMat);
      knot.position.y = 0.6;
      const sign = new THREE.Sprite(this.dollar);
      sign.scale.set(0.8, 0.8, 1);
      sign.position.y = 0.05;
      o.add(bag, knot, sign);
    } else {
      const b = new THREE.Mesh(this.bottleGeo, this.bottleMat);
      b.castShadow = true;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 10), this.capMat);
      cap.position.y = 0.72;
      o.add(b, cap);
      o.rotation.z = 0.35;
    }
    return o;
  }

  /** Drop one at a random spot of the line away from every truck. */
  spawn(trucks: Truck[], kind?: PickupKind) {
    const k: PickupKind = kind ?? (this.rand() < 0.55 ? 'money' : 'nitro');
    for (let tries = 0; tries < 20; tries++) {
      const s = this.rand() * this.line.length;
      const p = this.line.pointAt(s);
      const far = trucks.every((t) => {
        const q = t.body.translation();
        return Math.hypot(q.x - p.x, q.z - p.z) > 15;
      });
      if (!far && tries < 19) continue;
      const mesh = this.makeMesh(k);
      const y = this.heightAt(p.x, p.z, this.line.headingAt(s)) + 0.9;
      mesh.position.set(p.x, y, p.z);
      this.group.add(mesh);
      this.items.push({ kind: k, value: this.nextValue(k), x: p.x, y, z: p.z, ttl: this.lapTime * 1.4, mesh });
      return;
    }
  }

  /** Advance timers, spin the items, and return what each truck collected this step. */
  step(dt: number, trucks: Truck[], time: number): { slot: number; kind: PickupKind; value: number; x: number; y: number; z: number }[] {
    const got: { slot: number; kind: PickupKind; value: number; x: number; y: number; z: number }[] = [];
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = this.lapTime * (0.85 + this.rand() * 0.35);
      if (this.items.length < 2) this.spawn(trucks);
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.ttl -= dt;
      it.mesh.rotation.y = time * 2.2;
      it.mesh.position.y = it.y + Math.sin(time * 4 + i) * 0.15;
      const slot = trucks.findIndex((t) => {
        const q = t.body.translation();
        return Math.hypot(q.x - it.x, q.z - it.z) < RADIUS && Math.abs(q.y - it.y) < 2.5;
      });
      if (slot >= 0) {
        got.push({ slot, kind: it.kind, value: it.value, x: it.x, y: it.y, z: it.z });
        if (it.kind === 'money') this.moneyStep++;
        else this.nitroStep++;
      }
      if (slot >= 0 || it.ttl <= 0) {
        this.group.remove(it.mesh);
        this.items.splice(i, 1);
      }
    }
    return got;
  }

  clear() {
    for (const it of this.items) this.group.remove(it.mesh);
    this.items = [];
  }
}
