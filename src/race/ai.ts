// CPU driving (also the player's autopilot in tests): follow the racing line with a lookahead point, slow for the
// curvature ahead, fire nitros on straights, back off a wall when nose-in, and get unstuck.
import type { Truck, TruckInput } from '../physics/vehicle';
import type { RacingLine } from '../track/line';
import type { Skill } from './roster';

export interface AiContext {
  /** Rubber band: multiplies the pace (≈0.93..1.06). */
  rubber: number;
  /** Distance (m) to a wall straight ahead of the nose, Infinity if clear. */
  wallAhead: number;
  /** False before the start and after the finish (cool-down: drive gently). */
  racing: boolean;
  dt: number;
}

/** Deceleration the speed plan assumes when braking for a corner (m/s²). */
const BRAKE_DECEL = 8;

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class AiDriver {
  /** Progress along the line (m, 0..length): the projection hint, kept even when off the line. */
  s: number;
  private t = 0;
  private stuckT = 0;
  private reverseT = 0;
  private reverseSteer = 0;
  private noProgressT = 0;
  private bestS = 0;
  private nitroCool = 2;
  private pressNitro = false;
  private steerLag = 0;
  private phase: number;
  /** Set when the driver wants to be put back on the line (stuck for good). */
  wantsRescue = false;

  constructor(
    readonly line: RacingLine,
    readonly skill: Skill,
    readonly seed: number,
    startS: number,
  ) {
    this.s = startS;
    this.bestS = startS;
    this.phase = seed * 2.39;
  }

  private rand() {
    // Deterministic per driver (a race replays the same with the same inputs).
    this.seedState = (this.seedState * 16807) % 2147483647;
    return this.seedState / 2147483647;
  }
  private seedState = 1;

  reseed(n: number) {
    this.seedState = 1 + Math.floor(Math.abs(n) * 7919) % 2147483646;
  }

  drive(truck: Truck, ctx: AiContext): TruckInput {
    const k = this.skill;
    const dt = ctx.dt;
    this.t += dt;
    const p = truck.body.translation();
    const st = truck.state();
    const v = st.speed;
    const proj = this.line.project(p.x, p.z, this.s);
    this.s = proj.s;

    // Lateral wander so the pack doesn't drive in single file.
    const wander = k.wobble * (Math.sin(this.t * 0.37 + this.phase) * 0.7 + Math.sin(this.t * 0.91 + this.phase * 1.7) * 0.3);
    const look = k.lookahead + Math.max(0, v) * 0.42;
    const aim = this.line.pointAt(this.s + look);
    const tan = this.line.tangentAt(this.s + look);
    const tx = aim.x + tan.z * wander;
    const tz = aim.z - tan.x * wander;
    const want = Math.atan2(tx - p.x, tz - p.z);
    const err = wrapAngle(want - st.heading);

    // A little reaction lag: the steering error the driver acts on trails the real one.
    const lag = k.sloppiness > 0 ? 1 - Math.exp(-dt / k.sloppiness) : 1;
    this.steerLag += (err - this.steerLag) * lag;
    let steer = Math.max(-1, Math.min(1, -this.steerLag * 2.4));

    // Speed plan: the slowest of (corner speed at d ahead, braked back to here), v² κ ≤ grip and v² = vc² + 2·a·d.
    let vPlan = Infinity;
    for (let d = 0; d <= 10 + Math.max(0, v) * 1.6; d += 1.5) {
      const kap = Math.max(this.line.curvatureAt(this.s + d), 1e-3);
      // Better tyres (shop) let the driver trust a little more grip.
      const vc = Math.sqrt((k.cornerGrip * Math.sqrt(truck.mods.grip)) / kap);
      vPlan = Math.min(vPlan, Math.sqrt(vc * vc + 2 * BRAKE_DECEL * d));
    }
    const pace = (ctx.racing ? k.pace * ctx.rubber : 0.55) * truck.topSpeed();
    // Pointing well away from the line (spun, knocked sideways): slow down to turn.
    const vTarget = Math.min(pace, vPlan, Math.abs(err) > 1.2 ? 7 : Infinity);
    const throttle = v < vTarget ? 1 : v < vTarget + 1 ? 0.4 : 0;
    const brake = v > vTarget + 2 ? 1 : 0;

    // Nitro on a long straight, once in a while.
    this.nitroCool -= dt;
    let nitro = false;
    if (this.pressNitro) {
      nitro = false; // release after one step so the next press registers
      this.pressNitro = false;
    } else if (ctx.racing && this.nitroCool <= 0 && truck.nitros > 0 && v > 9 && Math.abs(err) < 0.25 && this.line.maxCurvature(this.s, 28) < 0.035) {
      this.nitroCool = 2.5;
      if (this.rand() < k.nitroChance) {
        nitro = true;
        this.pressNitro = true;
        this.nitroCool = 5;
      }
    }

    // Stuck or nose-in to a wall: back out, turning the nose towards the line.
    const tryingToGo = throttle > 0.3;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      return { throttle: 0, brake: 1, steer: this.reverseSteer, nitro: false };
    }
    if (tryingToGo && Math.abs(v) < 1.3) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    const noseIn = ctx.wallAhead < 1.8 && v < 4 && Math.abs(err) > 0.3;
    if (this.stuckT > 0.9 || noseIn) {
      this.stuckT = 0;
      this.reverseT = 0.9 + this.rand() * 0.4;
      // Reversing swings the nose the opposite way to the steering.
      this.reverseSteer = err > 0 ? 1 : -1;
      return { throttle: 0, brake: 1, steer: this.reverseSteer, nitro: false };
    }

    // No progress along the line for a long time: ask to be put back on it.
    const gain = this.line.delta(this.bestS, this.s);
    if (gain > 2 || gain < -this.line.length / 3) {
      this.bestS = this.s;
      this.noProgressT = 0;
    } else this.noProgressT += dt;
    this.wantsRescue = ctx.racing && (this.noProgressT > 6 || proj.dist > 14);
    if (this.wantsRescue) this.noProgressT = 0;

    if (!ctx.racing && v < 0.5 && throttle === 0) steer = 0;
    return { throttle, brake, steer, nitro };
  }
}
