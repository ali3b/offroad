// The truck's look. OR1 placeholder: a box body, a cab and four chunky wheels, positioned every frame from the
// raycast vehicle (suspension length, steering, wheel spin). It is replaced by the generator's lifted pickup GLB
// (ssg.models.json truck_<colour>, origin axle-centre, wheels block in the manifest) once `ssg model apply` exists.
import * as THREE from 'three';
import { TUNING, type Truck } from '../physics/vehicle';

export const TRUCK_COLOURS = { red: '#c8282a', blue: '#2a52c8', yellow: '#e8c020', grey: '#8a8f96' } as const;

export class TruckView {
  readonly root = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private spin: THREE.Object3D[] = [];

  constructor(colour: string) {
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
      const cp = c.wheelChassisConnectionPointCs(i);
      const len = c.wheelSuspensionLength(i) ?? TUNING.wheel.rest;
      if (!cp) continue;
      this.wheels[i].position.set(cp.x, cp.y - len, cp.z);
      this.wheels[i].rotation.y = c.wheelSteering(i) ?? 0;
      this.spin[i].rotation.x = c.wheelRotation(i) ?? 0;
    }
  }
}
