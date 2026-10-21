// A driving session on one track: the world, the track, the player's truck and its view. OR2 grows this into a
// race (CPU trucks, laps, start lights, results).
import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { buildTrack, type Track } from '../track/build';
import type { TrackData } from '../track/types';
import { Truck, type TruckInput } from '../physics/vehicle';
import { TruckView, TRUCK_COLOURS } from './truck-view';

export class Session {
  readonly track: Track;
  readonly truck: Truck;
  readonly view: TruckView;

  constructor(
    readonly world: RAPIER.World,
    scene: THREE.Scene,
    data: TrackData,
  ) {
    this.track = buildTrack(data, world);
    scene.add(this.track.group);
    this.truck = new Truck(world, this.startSpot(0));
    this.view = new TruckView(TRUCK_COLOURS.red);
    scene.add(this.view.root);
  }

  startSpot(slot: number) {
    const [x, z] = this.track.data.start.grid[slot];
    return { x, z, y: this.track.heightAt(x, z) + 1.4, heading: this.track.data.start.heading };
  }

  reset() {
    this.truck.place(this.startSpot(0));
  }

  step(dt: number, input: TruckInput) {
    this.truck.update(dt, input, { water: this.track.water });
    this.world.step();
  }

  render() {
    this.view.sync(this.truck);
  }
}
