// The truck's look. With the generator's models (public/models/models.json from `ssg model apply`) it draws the
// GLB for the truck's tint and turns the wheel nodes listed in the manifest's `wheels` block (spin, steer and
// suspension travel). Without them it draws the OR1 placeholder: a box body, a cab and four chunky wheels.
import * as THREE from 'three';
import { TUNING, type Truck } from '../physics/vehicle';
import type { LoadedModel } from './models';

export const TRUCK_COLOURS = { red: '#d42a26', yellow: '#e8c020', blue: '#2f5fd8', grey: '#9aa0a8' } as const;

/** Suspension length at rest under the truck's weight (m): where the model's axle line sits. */
const SAG_LENGTH = 0.45;
const WHEEL_KEYS = ['fl', 'fr', 'rl', 'rr'] as const;

interface ModelWheel {
  node: THREE.Object3D;
  basePos: THREE.Vector3;
  baseQuat: THREE.Quaternion;
  axis: THREE.Vector3;
  steer: boolean;
}

const _spin = new THREE.Quaternion();
const _steer = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class TruckView {
  readonly root = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private spin: THREE.Object3D[] = [];
  private modelWheels: (ModelWheel | null)[] = [];
  private modelScale = 1;
  readonly usesModel: boolean;

  constructor(colour: string, model?: LoadedModel | null) {
    this.usesModel = !!model;
    if (model) this.buildModel(model);
    else this.buildBox(colour);
  }

  private buildModel(model: LoadedModel) {
    const scene = model.scene.clone(true);
    const m = model.manifest;
    // Fit the model's length to the physics chassis (+ bumpers), so the box collider and the look agree.
    const len = m.bounds?.size?.[2] ?? TUNING.half.z * 2;
    // OR-FB-002: the export has no target size, so the game scales the GLB to its physics chassis.
    this.modelScale = Math.min(1.6, Math.max(0.6, (TUNING.half.z * 2 * 1.06) / len));
    const holder = new THREE.Group();
    holder.scale.setScalar(this.modelScale);
    // Origin axle-centre: the model's y = 0 is the axle line; put it where our wheel centres sit at rest.
    holder.position.y = TUNING.wheel.y - SAG_LENGTH;
    holder.add(scene);
    this.root.add(holder);
    this.modelWheels = WHEEL_KEYS.map((k) => {
      const w = m.wheels?.[k];
      const node = w ? scene.getObjectByName(w.node) : undefined;
      if (!w || !node) return null;
      return {
        node,
        basePos: node.position.clone(),
        baseQuat: node.quaternion.clone(),
        axis: new THREE.Vector3(...w.axle).normalize(),
        steer: w.steer,
      };
    });
  }

  private buildBox(colour: string) {
    const { x: hx, y: hy, z: hz } = TUNING.half;
    const paint = new THREE.MeshLambertMaterial({ color: colour });
    const dark = new THREE.MeshLambertMaterial({ color: '#2b2b2e' });
    const glass = new THREE.MeshLambertMaterial({ color: '#9fc4d8' });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
      return m;
    };
    // Bed and frame (the collider box), the cab towards the front, a roll bar and a light bar.
    add(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), paint, 0, 0, 0);
    add(new THREE.BoxGeometry(hx * 1.9, 0.75, 1.5), paint, 0, hy + 0.37, 0.75);
    add(new THREE.BoxGeometry(hx * 1.8, 0.5, 0.06), glass, 0, hy + 0.42, 1.51);
    add(new THREE.BoxGeometry(hx * 2.05, 0.18, 0.3), dark, 0, -hy + 0.1, hz + 0.1);
    add(new THREE.BoxGeometry(hx * 1.9, 0.1, 0.12), dark, 0, hy + 0.85, 0.6);
    add(new THREE.BoxGeometry(hx * 1.7, 0.08, 0.08), dark, 0, hy + 0.55, -0.9);
    const W = TUNING.wheel;
    const tyre = new THREE.CylinderGeometry(W.radius, W.radius, 0.45, 16);
    tyre.rotateZ(Math.PI / 2);
    const hub = new THREE.BoxGeometry(0.47, W.radius * 0.9, 0.18);
    const hubMat = new THREE.MeshLambertMaterial({ color: '#c9c9c9' });
    for (let i = 0; i < 4; i++) {
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tyre, dark);
      t.castShadow = true;
      spin.add(t, new THREE.Mesh(hub, hubMat));
      steer.add(spin);
      this.root.add(steer);
      this.wheels.push(steer);
      this.spin.push(spin);
    }
  }

  sync(truck: Truck) {
    const b = truck.body;
    const p = b.translation();
    const q = b.rotation();
    this.root.position.set(p.x, p.y, p.z);
    this.root.quaternion.set(q.x, q.y, q.z, q.w);
    const c = truck.controller;
    for (let i = 0; i < 4; i++) {
      const len = c.wheelSuspensionLength(i) ?? TUNING.wheel.rest;
      const steerRad = c.wheelSteering(i) ?? 0;
      const rot = c.wheelRotation(i) ?? 0;
      if (this.usesModel) {
        const w = this.modelWheels[i];
        if (!w) continue;
        w.node.position.copy(w.basePos);
        w.node.position.y += (SAG_LENGTH - len) / this.modelScale;
        _spin.setFromAxisAngle(w.axis, rot);
        _steer.setFromAxisAngle(UP, w.steer ? steerRad : 0);
        w.node.quaternion.copy(w.baseQuat).multiply(_steer).multiply(_spin);
        continue;
      }
      const cp = c.wheelChassisConnectionPointCs(i);
      if (!cp) continue;
      this.wheels[i].position.set(cp.x, cp.y - len, cp.z);
      this.wheels[i].rotation.y = steerRad;
      this.spin[i].rotation.x = rot;
    }
  }

  dispose() {
    this.root.removeFromParent();
  }
}
