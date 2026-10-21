// A driving session on one track: the world, the track, one to four trucks with their views, the effects (dust,
// splash, mud spray, nitro smoke, skid marks) and the game events (race/events.ts) that come out of the physics.
// The race flow (start, laps, results) lives in race/race.ts on top of this.
import type * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildTrack, type Track } from '../track/build';
import { polygonDistance } from '../track/heights';
import type { TrackData } from '../track/types';
import { Truck, TUNING, type TruckInput, type TruckMods } from '../physics/vehicle';
import { TruckView } from './truck-view';
import { ROSTER, type Entry } from './roster';
import type { TruckModels } from './models';
import { Particles } from '../fx/particles';
import { SkidMarks } from '../fx/skids';
import { events } from './events';

export interface Racer {
  slot: number;
  entry: Entry;
  truck: Truck;
  view: TruckView;
}

const _ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

export class Session {
  readonly track: Track;
  readonly racers: Racer[] = [];
  readonly particles = new Particles();
  readonly skids = new SkidMarks();
  readonly queue = new RAPIER.EventQueue(true);
  time = 0;
  private byCollider = new Map<number, number>();
  private wallHandles = new Set<number>();
  private impactCool = new Map<string, number>();
  private skidT: number[] = [];
  private splashT: number[] = [];
  private lastSurface: string[] = [];

  constructor(
    readonly world: RAPIER.World,
    readonly scene: THREE.Scene,
    data: TrackData,
    opts: { trucks?: number; nitros?: number[]; models?: TruckModels | null; entries?: Entry[]; mods?: TruckMods[] } = {},
  ) {
    this.track = buildTrack(data, world);
    scene.add(this.track.group, this.skids.mesh, this.particles.mesh);
    for (const w of this.track.walls) this.wallHandles.add(w.handle);
    // The season passes its own line-up (the player's colour and initials, CPU drivers); else the default roster.
    const roster = opts.entries ?? ROSTER;
    const n = Math.min(opts.trucks ?? (opts.entries ? roster.length : 1), data.start.grid.length, roster.length);
    for (let slot = 0; slot < n; slot++) {
      const entry = roster[slot];
      const truck = new Truck(world, this.startSpot(slot), opts.nitros?.[slot] ?? TUNING.nitro.count);
      truck.power = entry.power ?? 1;
      if (opts.mods?.[slot]) truck.setMods(opts.mods[slot]);
      const view = new TruckView(entry.hex, opts.models?.[entry.colour]);
      scene.add(view.root);
      this.racers.push({ slot, entry, truck, view });
      this.byCollider.set(truck.collider.handle, slot);
      this.skidT.push(0);
      this.splashT.push(0);
      this.lastSurface.push('dirt');
    }
  }

  /** The player's truck (slot 0). */
  get truck() {
    return this.racers[0].truck;
  }

  startSpot(slot: number) {
    const [x, z] = this.track.data.start.grid[slot];
    return { x, z, y: this.track.heightAt(x, z) + 1.4, heading: this.track.data.start.heading };
  }

  reset() {
    this.racers.forEach((r) => r.truck.place(this.startSpot(r.slot)));
  }

  /** True when the truck is outside the outer wall or has fallen below the ground. */
  outside(truck: Truck) {
    const p = truck.body.translation();
    return polygonDistance(p.x, p.z, this.track.data.walls[0].points) > 0.3 || p.y < this.track.heightAt(p.x, p.z) - 3;
  }

  /** Distance from the truck's nose to a wall straight ahead (m), Infinity when clear within `max`. */
  wallAhead(truck: Truck, max = 4) {
    const p = truck.body.translation();
    const s = truck.state();
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const nose = TUNING.half.z;
    _ray.origin = { x: p.x + fx * nose, y: p.y + 0.2, z: p.z + fz * nose };
    _ray.dir = { x: fx, y: 0, z: fz };
    const hit = this.world.castRay(_ray, max, true, undefined, undefined, undefined, undefined, (c) => this.wallHandles.has(c.handle));
    return hit ? hit.timeOfImpact : Infinity;
  }

  step(dt: number, inputs: TruckInput[]) {
    const env = { surface: this.track.surface };
    this.racers.forEach((r, i) => r.truck.update(dt, inputs[i] ?? inputs[0], env));
    this.world.step(this.queue);
    if (this.racers.length === 1 && this.outside(this.truck)) this.reset();
    this.time += dt;
    this.unstack();
    this.drainImpacts();
    this.racers.forEach((r, i) => this.truckFx(r, i, dt));
    this.particles.step(dt);
    for (const [k, v] of this.impactCool) if (v <= this.time) this.impactCool.delete(k);
  }

  /** A truck that lands on another one's roof slides off sideways (the wheels can't see trucks, OR2 pile-ups). */
  private unstack() {
    const rs = this.racers;
    for (let a = 0; a < rs.length; a++)
      for (let b = 0; b < rs.length; b++) {
        if (a === b) continue;
        const pa = rs[a].truck.body.translation();
        const pb = rs[b].truck.body.translation();
        const dx = pa.x - pb.x;
        const dz = pa.z - pb.z;
        const d = Math.hypot(dx, dz);
        if (pa.y - pb.y < 0.5 || d > 2.6) continue;
        const v = rs[a].truck.body.linvel();
        const nx = d > 0.05 ? dx / d : 1;
        const nz = d > 0.05 ? dz / d : 0;
        rs[a].truck.body.setLinvel({ x: v.x + nx * 0.35, y: v.y, z: v.z + nz * 0.35 }, true);
      }
  }

  private drainImpacts() {
    this.queue.drainContactForceEvents((e) => {
      const a = e.collider1();
      const b = e.collider2();
      const sa = this.byCollider.get(a);
      const sb = this.byCollider.get(b);
      const force = e.maxForceMagnitude();
      const strength = Math.min(1, force / 90000);
      if (strength < 0.08) return;
      const report = (slot: number, other: number) => {
        const kind = this.byCollider.has(other) ? 'truck' : this.wallHandles.has(other) ? 'wall' : 'ground';
        if (kind === 'ground') return;
        const key = `${slot}:${other}`;
        if (this.impactCool.has(key)) return;
        this.impactCool.set(key, this.time + 0.3);
        const p = this.racers[slot].truck.body.translation();
        events.emit('impact', { truck: slot, with: kind, strength, x: p.x, z: p.z });
      };
      if (sa !== undefined) report(sa, b);
      if (sb !== undefined) report(sb, a);
    });
  }

  /** Dust, splash and mud spray from the wheels, nitro smoke, skid marks, and their events. */
  private truckFx(r: Racer, i: number, dt: number) {
    const t = r.truck;
    const c = t.controller;
    const P = this.particles;
    const lv = t.body.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    const surf = t.surface.kind;
    if (t.nitroFired) events.emit('nitro', { truck: i, left: t.nitros });
    if (t.landed > 0.25) {
      events.emit('land', { truck: i, airTime: t.landed });
      const p = t.body.translation();
      events.emit('impact', { truck: i, with: 'ground', strength: Math.min(1, t.landed / 1.2), x: p.x, z: p.z });
      for (let k = 0; k < 10; k++) {
        const a = P.rand() * Math.PI * 2;
        P.emit('dust', p.x + Math.cos(a) * 1.5, p.y - 0.5, p.z + Math.sin(a) * 2, Math.cos(a) * 3, 0.8, Math.sin(a) * 3);
      }
    }
    const sliding = t.slip > 2.2 && t.grounded >= 2;
    for (let w = 0; w < 4; w++) {
      const on = c.wheelIsInContact(w);
      const cp = on ? c.wheelContactPoint(w) : null;
      // Skid marks from every wheel while sliding (or locked up under hard braking) on dirt and mud.
      const braking = t.input.brake > 0 && t.state().speed > 6;
      const mark = cp && surf !== 'water' && (sliding || braking) ? Math.min(1, (t.slip - 1.5) / 5 + (braking ? 0.3 : 0)) : 0;
      if (cp) this.skids.mark(i * 4 + w, cp.x, cp.y, cp.z, mark, this.time);
      else this.skids.mark(i * 4 + w, 0, 0, 0, 0, this.time);
      if (!cp) continue;
      const rear = w >= 2;
      if (surf === 'dirt') {
        // Dust puffs behind the rear wheels, more when fast or sliding.
        const rate = rear ? Math.max(0, speed - 4) * 0.35 + (sliding ? 4 : 0) : sliding ? 2 : 0;
        if (P.rand() < rate * dt) P.emit('dust', cp.x, cp.y + 0.3, cp.z, -lv.x * 0.15 + (P.rand() - 0.5), 0.6 + P.rand() * 0.6, -lv.z * 0.15 + (P.rand() - 0.5));
      } else if (speed > 2.5) {
        // Water splash or mud spray: flecks thrown up and out from every wheel.
        const kind = surf === 'water' ? 'splash' : 'mud';
        const n = speed * dt * (surf === 'water' ? 1.6 : 1.1);
        for (let k = 0; k < Math.floor(n) + (P.rand() < n % 1 ? 1 : 0); k++)
          P.emit(kind, cp.x, cp.y + 0.2, cp.z, -lv.x * 0.25 + (P.rand() - 0.5) * 4, 2.5 + P.rand() * 3.5, -lv.z * 0.25 + (P.rand() - 0.5) * 4);
      }
    }
    if (t.nitroT > 0 && P.rand() < 22 * dt) {
      const p = t.body.translation();
      const s = t.state();
      P.emit('smoke', p.x - Math.sin(s.heading) * 2.6, p.y + 0.1, p.z - Math.cos(s.heading) * 2.6, (P.rand() - 0.5) * 1.5, 0.6, (P.rand() - 0.5) * 1.5);
    }
    // Throttled events for sound.
    this.skidT[i] -= dt;
    if (sliding && surf !== 'water' && this.skidT[i] <= 0) {
      this.skidT[i] = 0.1;
      events.emit('skid', { truck: i, intensity: Math.min(1, t.slip / 8) });
    }
    this.splashT[i] -= dt;
    if (surf !== 'dirt' && speed > 2 && (this.lastSurface[i] !== surf || this.splashT[i] <= 0)) {
      this.splashT[i] = 0.2;
      events.emit('splash', { truck: i, kind: surf, strength: Math.min(1, speed / 15) });
    }
    this.lastSurface[i] = surf;
  }

  render() {
    this.racers.forEach((r, i) => {
      r.view.sync(r.truck);
      events.emit('engine', { truck: i, rpm: r.truck.rpm(), throttle: r.truck.input.throttle, speed: r.truck.state().speed, nitro: r.truck.nitroT > 0, player: i === 0 });
    });
    this.particles.sync();
    this.skids.sync(this.time);
  }

  dispose() {
    for (const r of this.racers) {
      r.view.dispose();
      this.world.removeVehicleController(r.truck.controller);
      this.world.removeRigidBody(r.truck.body);
    }
    this.scene.remove(this.track.group, this.skids.mesh, this.particles.mesh);
    this.world.removeCollider(this.track.ground, false);
    for (const w of this.track.walls) this.world.removeCollider(w, false);
    this.queue.free();
  }
}
