// The truck: a Rapier DynamicRayCastVehicleController (4 raycast wheels with suspension) plus arcade assists that
// give the 1989 original's feel: grippy but slidey, quick to turn, bouncy over bumps, never stuck on its roof.
//
// Chassis frame: +z forward, +y up, +x to the truck's left (right = -x). Positive steer input = turn right.
import { Quaternion, Vector3 } from 'three';
import { GROUP, RAPIER } from './world';

export interface TruckInput {
  /** 0..1 */
  throttle: number;
  /** 0..1: brakes while rolling forward, reverses once nearly stopped. */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** Held: fires one nitro burst on the press. */
  nitro: boolean;
}

export const NO_INPUT: TruckInput = { throttle: 0, brake: 0, steer: 0, nitro: false };

/** What the ground under the truck does to it (track zones: water, mud). */
export interface Surface {
  kind: 'dirt' | 'water' | 'mud';
  /** Velocity drag (1/s). */
  drag: number;
  /** Multiplier on the lateral grip assist. */
  grip: number;
}

export const DIRT: Surface = { kind: 'dirt', drag: 0, grip: 1 };

export interface TruckEnv {
  surface(x: number, y: number, z: number): Surface;
}

/** Everything tunable in one place (OR1 feel gate). Speeds m/s, forces N, rates 1/s. */
export const TUNING = {
  mass: 1200,
  half: { x: 0.95, y: 0.42, z: 2.25 },
  /** Centre of mass below the box centre: harder to roll. */
  comY: -0.45,
  wheel: { x: 0.92, y: -0.2, zFront: 1.45, zRear: -1.45, radius: 0.5, rest: 0.55, travel: 0.45 },
  suspension: { stiffness: 34, compression: 3.2, relaxation: 4.2, maxForce: 60000 },
  frictionSlip: { front: 2.6, rear: 2.2 },
  engineForce: 5200, // per wheel, 4WD
  reverseForce: 1600,
  brakeForce: 60,
  idleBrake: 12,
  topSpeed: 25,
  reverseTopSpeed: 8,
  steer: { max: 0.6, highSpeed: 0.32, rate: 5 },
  /** Fraction of sideways velocity removed per second when all four wheels grip (slides survive below this). */
  lateralGrip: 4,
  rollingDrag: 0.1,
  /** Target yaw rate (rad/s) at full lock and how hard the assist pulls towards it. */
  yawRate: 3.0,
  yawAssist: 5,
  /** Upright stabilizer gains (rad/s per rad of tilt, per second) on the ground and in the air. */
  uprightGround: 3,
  uprightAir: 7,
  airSpinDamping: 1.6,
  airYaw: 4,
  airPitch: 2.2,
  nitro: { count: 6, seconds: 1.4, accel: 13, topSpeed: 32 },
  /** Seconds tipped over (up.y below this) before an automatic reset. */
  flipped: { upY: 0.25, seconds: 1.4 },
};

export interface TruckState {
  pos: { x: number; y: number; z: number };
  /** Forward speed (m/s, negative when reversing). */
  speed: number;
  /** Total speed (m/s). */
  speedAbs: number;
  heading: number;
  up: { x: number; y: number; z: number };
  contacts: boolean[];
  suspension: number[];
  airborne: boolean;
  airTime: number;
  nitros: number;
  nitroActive: boolean;
  inWater: boolean;
  surface: Surface['kind'];
  /** Sideways sliding speed (m/s). */
  slip: number;
  /** Automatic flip recoveries so far. */
  resets: number;
}

const _q = new Quaternion();
const _f = new Vector3();
const _r = new Vector3();
const _u = new Vector3();
const _v = new Vector3();
const _w = new Vector3();
const _a = new Vector3();
const UP = new Vector3(0, 1, 0);

export class Truck {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  steerAngle = 0;
  nitros = TUNING.nitro.count;
  nitroT = 0;
  airTime = 0;
  inWater = false;
  surface: Surface = DIRT;
  /** Sideways speed (m/s) after the grip assist, wheels on the ground (0..4), last input: read by fx and audio. */
  slip = 0;
  grounded = 0;
  input: TruckInput = NO_INPUT;
  /** Air time of the jump that just ended (set on the landing step, else 0). */
  landed = 0;
  /** Nitro presses this step (a counter, for events). */
  nitroFired = 0;
  resets = 0;
  private flippedT = 0;
  private nitroHeld = false;

  constructor(
    world: RAPIER.World,
    start: { x: number; y: number; z: number; heading: number },
    nitros: number = TUNING.nitro.count,
  ) {
    this.nitros = nitros;
    const T = TUNING;
    const rot = yawQuat(start.heading);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(start.x, start.y, start.z)
        .setRotation(rot)
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.4),
    );
    const { x: hx, y: hy, z: hz } = T.half;
    const m = T.mass;
    // Box inertia, roll/pitch boosted so landings don't tumble the truck.
    const inertia = {
      x: ((m / 12) * (4 * hy * hy + 4 * hz * hz)) * 1.3,
      y: (m / 12) * (4 * hx * hx + 4 * hz * hz),
      z: ((m / 12) * (4 * hx * hx + 4 * hy * hy)) * 1.6,
    };
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setMassProperties(m, { x: 0, y: T.comY, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.3)
        .setRestitution(0.3)
        .setCollisionGroups(GROUP.TRUCK)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(4000),
      this.body,
    );

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    const W = T.wheel;
    const spots = [
      { x: W.x, z: W.zFront }, // FL (+x is the truck's left)
      { x: -W.x, z: W.zFront }, // FR
      { x: W.x, z: W.zRear }, // RL
      { x: -W.x, z: W.zRear }, // RR
    ];
    spots.forEach((s, i) => {
      this.controller.addWheel({ x: s.x, y: W.y, z: s.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, W.rest, W.radius);
      this.controller.setWheelSuspensionStiffness(i, T.suspension.stiffness);
      this.controller.setWheelSuspensionCompression(i, T.suspension.compression);
      this.controller.setWheelSuspensionRelaxation(i, T.suspension.relaxation);
      this.controller.setWheelMaxSuspensionForce(i, T.suspension.maxForce);
      this.controller.setWheelMaxSuspensionTravel(i, W.travel);
      this.controller.setWheelFrictionSlip(i, i < 2 ? T.frictionSlip.front : T.frictionSlip.rear);
      this.controller.setWheelSideFrictionStiffness(i, 1);
    });
    this.collider = this.body.collider(0);
  }

  readonly collider: RAPIER.Collider;

  /** One fixed physics step's worth of control: call before world.step(). */
  update(dt: number, input: TruckInput, env: TruckEnv) {
    const T = TUNING;
    this.input = input;
    this.nitroFired = 0;
    const c = this.controller;
    const b = this.body;
    const rot = b.rotation();
    _q.set(rot.x, rot.y, rot.z, rot.w);
    _f.set(0, 0, 1).applyQuaternion(_q);
    _r.set(-1, 0, 0).applyQuaternion(_q);
    _u.set(0, 1, 0).applyQuaternion(_q);
    const lv = b.linvel();
    _v.set(lv.x, lv.y, lv.z);
    const fwd = _v.dot(_f);

    // Nitro: one burst per press while the burst isn't running.
    if (input.nitro && !this.nitroHeld && this.nitroT <= 0 && this.nitros > 0) {
      this.nitros--;
      this.nitroT = T.nitro.seconds;
      this.nitroFired = 1;
    }
    this.nitroHeld = input.nitro;
    const boosting = this.nitroT > 0;
    if (boosting) this.nitroT -= dt;
    const top = boosting ? T.nitro.topSpeed : T.topSpeed;

    // Steering eases towards the input; less lock at speed.
    const speedT = Math.min(1, Math.abs(fwd) / T.topSpeed);
    const lock = T.steer.max + (T.steer.highSpeed - T.steer.max) * speedT;
    const target = -input.steer * lock; // positive wheel angle turns left (about +y)
    this.steerAngle += Math.max(-T.steer.rate * dt, Math.min(T.steer.rate * dt, target - this.steerAngle));
    c.setWheelSteering(0, this.steerAngle);
    c.setWheelSteering(1, this.steerAngle);

    // Throttle, brake and reverse.
    let engine = 0;
    let brake = 0;
    if (input.throttle > 0) engine = input.throttle * T.engineForce * Math.max(0, 1 - (Math.max(0, fwd) / top) ** 2);
    if (input.brake > 0) {
      if (fwd > 1.5) brake = input.brake * T.brakeForce;
      else engine -= input.brake * T.reverseForce * Math.max(0, 1 - (Math.max(0, -fwd) / T.reverseTopSpeed) ** 2);
    }
    // Parked: hold the truck on slopes.
    if (!input.throttle && !input.brake && Math.abs(fwd) < 1) brake = T.idleBrake;
    for (let i = 0; i < 4; i++) {
      c.setWheelEngineForce(i, engine);
      c.setWheelBrake(i, brake);
    }

    c.updateVehicle(dt, undefined, GROUP.WHEEL_RAY);

    // ---- Arcade assists (velocity edits after the raycast vehicle has applied its impulses) ----
    let grounded = 0;
    _a.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      if (c.wheelIsInContact(i)) {
        grounded++;
        const n = c.wheelContactNormal(i);
        if (n) _a.add(_w.set(n.x, n.y, n.z));
      }
    }
    const g = grounded / 4;
    const p0 = b.translation();
    const surf = env.surface(p0.x, p0.y, p0.z);
    const lv2 = b.linvel();
    _v.set(lv2.x, lv2.y, lv2.z);
    const av = b.angvel();
    _w.set(av.x, av.y, av.z);

    if (grounded > 0) {
      // Lateral grip boost: bleed sideways speed (a slide shrinks instead of the tyres snapping).
      const lat = _v.dot(_r);
      _v.addScaledVector(_r, -lat * (1 - Math.exp(-T.lateralGrip * surf.grip * g * dt)));
      // Rolling drag.
      const fv = _v.dot(_f);
      _v.addScaledVector(_f, -fv * (1 - Math.exp(-T.rollingDrag * g * dt)));
      // Yaw: pull the spin rate towards what the steering asks for (zero with no input = yaw damping).
      const dir = fv >= 0 ? 1 : -1;
      const wantYaw = -input.steer * T.yawRate * Math.min(1, Math.abs(fv) / 5) * dir;
      const yaw = _w.dot(_u);
      _w.addScaledVector(_u, (wantYaw - yaw) * (1 - Math.exp(-T.yawAssist * g * dt)));
    } else {
      // Air control: steer spins, throttle/brake pitch the nose; damp tumbling.
      _w.addScaledVector(UP, -input.steer * T.airYaw * dt);
      _w.addScaledVector(_r, (input.throttle - input.brake) * T.airPitch * dt);
      const spinY = _w.dot(UP);
      _a.copy(_w).addScaledVector(UP, -spinY);
      _w.addScaledVector(_a, -(1 - Math.exp(-T.airSpinDamping * dt)));
    }
    // Upright stabilizer: rotate up towards world up (in the air) or the ground normal (on it).
    const wantUp = grounded > 0 && _a.lengthSq() > 0 ? _a.normalize() : UP;
    const axis = new Vector3().crossVectors(_u, wantUp);
    _w.addScaledVector(axis, (grounded > 0 ? T.uprightGround : T.uprightAir) * dt * 10);

    // Nitro push along the nose.
    if (boosting && _v.dot(_f) < top) _v.addScaledVector(_f, T.nitro.accel * dt * (grounded > 0 ? 1 : 0.4));

    // Water and mud: drag while the chassis is in them (horizontal only, so a truck still falls into a puddle).
    const p = p0;
    this.surface = surf;
    this.inWater = surf.kind === 'water';
    if (surf.drag > 0 && grounded > 0) {
      const k = Math.exp(-surf.drag * dt);
      _v.x *= k;
      _v.z *= k;
    }
    this.slip = grounded > 0 ? Math.abs(_v.dot(_r)) : 0;
    this.landed = this.airTime > 0 && grounded > 0 ? this.airTime : 0;
    this.grounded = grounded;

    b.setLinvel(_v, true);
    b.setAngvel(_w, true);

    this.airTime = grounded === 0 ? this.airTime + dt : 0;

    // Flipped for too long: put it back on its wheels where it is.
    if (_u.y < T.flipped.upY) this.flippedT += dt;
    else this.flippedT = 0;
    if (this.flippedT > T.flipped.seconds) {
      const h = Math.atan2(_f.x, _f.z);
      this.resets++;
      this.place({ x: p.x, y: p.y + 1.5, z: p.z, heading: h });
    }
  }

  /** Current top speed (higher during a nitro burst). */
  topSpeed() {
    return this.nitroT > 0 ? TUNING.nitro.topSpeed : TUNING.topSpeed;
  }

  /** Engine load 0..1 for sound: speed share of top speed, kicked up by throttle. */
  rpm() {
    const lv = this.body.linvel();
    const v = Math.hypot(lv.x, lv.z);
    return Math.min(1, 0.15 + (v / TUNING.nitro.topSpeed) * 0.7 + this.input.throttle * 0.15);
  }

  place(at: { x: number; y: number; z: number; heading: number }) {
    this.body.setTranslation({ x: at.x, y: at.y, z: at.z }, true);
    this.body.setRotation(yawQuat(at.heading), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.flippedT = 0;
    this.steerAngle = 0;
    this.nitroT = 0;
    this.airTime = 0;
  }

  state(): TruckState {
    const b = this.body;
    const p = b.translation();
    const rot = b.rotation();
    _q.set(rot.x, rot.y, rot.z, rot.w);
    _f.set(0, 0, 1).applyQuaternion(_q);
    _u.set(0, 1, 0).applyQuaternion(_q);
    const lv = b.linvel();
    _v.set(lv.x, lv.y, lv.z);
    const contacts = [0, 1, 2, 3].map((i) => this.controller.wheelIsInContact(i));
    return {
      pos: { x: p.x, y: p.y, z: p.z },
      speed: _v.dot(_f),
      speedAbs: _v.length(),
      heading: Math.atan2(_f.x, _f.z),
      up: { x: _u.x, y: _u.y, z: _u.z },
      contacts,
      suspension: [0, 1, 2, 3].map((i) => this.controller.wheelSuspensionLength(i) ?? 0),
      airborne: !contacts.some(Boolean),
      airTime: this.airTime,
      nitros: this.nitros,
      nitroActive: this.nitroT > 0,
      inWater: this.inWater,
      surface: this.surface.kind,
      slip: this.slip,
      resets: this.resets,
    };
  }
}

export function yawQuat(heading: number) {
  return { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
}
