// The on-screen race controls for phones and tablets (touch input mode only):
//   left thumb   a slide pad for steering: analog, from the finger's offset (full lock at ~1 pad-third). A finger
//                that lands on the pad steers from the pad's centre (press an end = full lock, like a ◀ / ▶ button);
//                one that lands anywhere else on the left half steers from where it landed (a floating pad).
//   right thumb  the pedals: NITRO (nitro + gas, so the thumb can roll onto it from the gas), GAS (the big one; any
//                touch on the right half away from the other two is gas) and BRAKE / REVERSE. On a wide phone they
//                stack in a column (NITRO, GAS, BRAKE); on a tablet or a 16:9 screen they sit in a low block (GAS
//                tall on the right, NITRO over BRAKE beside it). Fingers slide between them.
// Multi-touch: every pointer is tracked (Pointer Events, touch-action none), so steer + gas + nitro work at once.
// The input goes to engine/input.ts setTouchInput() and drives player 1. The pads sit in the screen's side columns;
// reserve() tells the camera (engine/camera.ts fitFixedCamera) what to keep clear, so the track and the HUD panel
// stay out from under the thumbs.
import { setTouchInput } from '../../engine/input';
import type { TruckInput } from '../../physics/vehicle';
import { addStyle, PIXEL_FONT } from '../pixel';

const CSS = `
.or-tc { position: fixed; inset: 0; z-index: 8; pointer-events: none; font-family: ${PIXEL_FONT}; display: none;
  --u: clamp(1px, calc(100vmin / 390), 1.45px); touch-action: none; }
body.or-touch .or-tc.on { display: block; }
.or-tc .zone { position: absolute; top: calc(env(safe-area-inset-top) + 72px); bottom: 0; pointer-events: auto; touch-action: none; }
.or-tc .zone.l { left: 0; width: 50%; }
.or-tc .zone.r { right: 0; width: 50%; }
.or-tc .btn { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: calc(6 * var(--u)); color: #fff; font-size: calc(10 * var(--u)); letter-spacing: 1px; text-shadow: 2px 2px 0 #000;
  background: rgba(11, 15, 34, .42); border: 3px solid #000; image-rendering: pixelated;
  box-shadow: inset 0 0 0 2px rgba(233, 228, 212, .55), inset 0 -6px 0 rgba(0,0,0,.35), 4px 4px 0 rgba(0,0,0,.35); }
.or-tc .btn.down { background: rgba(255, 255, 255, .28); transform: translate(2px, 2px);
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.9), inset 0 6px 0 rgba(0,0,0,.25); }
.or-tc .btn svg { height: 42%; max-width: 60%; width: auto; }
.or-tc .gas { right: calc(env(safe-area-inset-right) + 14px); bottom: calc(env(safe-area-inset-bottom) + 14px + 72 * var(--u));
  width: calc(88 * var(--u)); height: calc(104 * var(--u)); }
.or-tc .gas b { color: #5cff6a; }
.or-tc .brake { right: calc(env(safe-area-inset-right) + 14px); bottom: calc(env(safe-area-inset-bottom) + 10px);
  width: calc(88 * var(--u)); height: calc(64 * var(--u)); }
.or-tc .brake b { color: #ff7a5a; }
.or-tc .nitro { right: calc(env(safe-area-inset-right) + 14px); bottom: calc(env(safe-area-inset-bottom) + 18px + 176 * var(--u));
  width: calc(88 * var(--u)); height: calc(64 * var(--u)); }
.or-tc .nitro b { color: #7fe3ff; }
.or-tc .btn b { font-weight: normal; }
.or-tc .pad { position: absolute; left: calc(env(safe-area-inset-left) + 14px); bottom: calc(env(safe-area-inset-bottom) + 14px);
  width: calc(156 * var(--u)); height: calc(84 * var(--u)); background: rgba(11, 15, 34, .42); border: 3px solid #000; box-sizing: border-box;
  box-shadow: inset 0 0 0 2px rgba(233, 228, 212, .55), 4px 4px 0 rgba(0,0,0,.35); }
.or-tc .pad .rail { position: absolute; left: 12%; right: 12%; top: 50%; height: 6px; margin-top: -3px; background: rgba(0,0,0,.55);
  border-top: 2px solid rgba(255,255,255,.25); }
.or-tc .pad .mid { position: absolute; left: 50%; top: 22%; bottom: 22%; width: 4px; margin-left: -2px; background: rgba(255,255,255,.35); }
.or-tc .pad .end { position: absolute; top: 0; bottom: 0; width: 30%; display: flex; align-items: center; justify-content: center; }
.or-tc .pad .end.left { left: 0; } .or-tc .pad .end.right { right: 0; }
.or-tc .pad .end svg { width: 50%; height: auto; opacity: .85; }
.or-tc .pad .end.lit svg { opacity: 1; filter: drop-shadow(0 0 0 #ffe14a); }
.or-tc .pad .end.lit svg rect { fill: #ffe14a; }
.or-tc .pad .knob { position: absolute; left: 50%; top: 50%; width: calc(40 * var(--u)); height: calc(52 * var(--u));
  transform: translate(-50%, -50%); background: #c9c9d2; border: 3px solid #000; box-sizing: border-box;
  box-shadow: inset -4px -4px 0 #7e848c, inset 3px 3px 0 #fff, 3px 3px 0 rgba(0,0,0,.4); opacity: .8; }
.or-tc .pad.down .knob { opacity: 1; background: #ffe14a; box-shadow: inset -4px -4px 0 #c9a412, inset 3px 3px 0 #fff6b0, 3px 3px 0 rgba(0,0,0,.4); }
/* Tablets and 16:9 phones (less wide than ~1.9:1): the pedals in a low block (GAS tall on the right, NITRO over BRAKE
   beside it), so the camera can keep a bottom strip clear instead of two side columns. */
@media (max-aspect-ratio: 19/10) {
  .or-tc .gas { bottom: calc(env(safe-area-inset-bottom) + 10px); height: calc(136 * var(--u)); }
  .or-tc .brake, .or-tc .nitro { right: calc(env(safe-area-inset-right) + 24px + 88 * var(--u)); }
  .or-tc .nitro { bottom: calc(env(safe-area-inset-bottom) + 18px + 64 * var(--u)); }
}
.or-tc .float { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border: 3px solid #ffe14a; display: none; opacity: .7; }
`;

/** Pixel arrows and icons for the buttons. */
const ARROW = (flip: boolean) =>
  `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" style="${flip ? 'transform:scaleX(-1)' : ''}"><g fill="#fff" stroke="none">
    <rect x="1" y="3" width="1" height="2"/><rect x="2" y="2" width="1" height="4"/><rect x="3" y="1" width="1" height="6"/><rect x="4" y="0" width="1" height="8"/>
    <rect x="5" y="3" width="2" height="2"/></g></svg>`;
const PEDAL = `<svg viewBox="0 0 12 14" shape-rendering="crispEdges"><rect x="1" y="1" width="10" height="12" fill="#5cff6a" stroke="#000" stroke-width=".8"/>
  <rect x="2" y="3" width="8" height="1" fill="#1b6b24"/><rect x="2" y="6" width="8" height="1" fill="#1b6b24"/><rect x="2" y="9" width="8" height="1" fill="#1b6b24"/></svg>`;
const BRAKE = `<svg viewBox="0 0 12 8" shape-rendering="crispEdges"><rect x="1" y="1" width="10" height="6" fill="#ff7a5a" stroke="#000" stroke-width=".8"/>
  <rect x="2" y="3" width="8" height="1" fill="#7a1a12"/><rect x="2" y="5" width="8" height="1" fill="#7a1a12"/></svg>`;
const BOTTLE = `<svg viewBox="0 0 8 12" shape-rendering="crispEdges"><rect x="2" y="3" width="4" height="8" fill="#c8ccd4" stroke="#000" stroke-width=".6"/>
  <rect x="3" y="1" width="2" height="2" fill="#d0281e"/><rect x="2" y="6" width="4" height="2" fill="#2f5fd8"/><rect x="6" y="1" width="2" height="1" fill="#ffe14a"/></svg>`;

type Pedal = 'gas' | 'brake' | 'nitro';
interface Finger {
  side: 'l' | 'r';
  /** Steering: the x the offset is measured from. */
  x0: number;
  x: number;
  pedal: Pedal | null;
  /** A floating steer (landed off the pad). */
  floating: boolean;
}

/** Full steering lock at this many CSS px of finger offset (× the size unit). */
const LOCK = 46;
const DEAD = 5;

export class TouchControls {
  readonly el = document.createElement('div');
  private pad: HTMLElement;
  private knob: HTMLElement;
  private float: HTMLElement;
  private ends: HTMLElement[];
  private btn: Record<Pedal, HTMLElement>;
  private fingers = new Map<number, Finger>();
  private on = false;
  /** Tests / tools: the last input sent. */
  last: TruckInput = { throttle: 0, brake: 0, steer: 0, nitro: false };

  constructor(parent: HTMLElement = document.body) {
    addStyle('or-touch-controls-css', CSS);
    this.el.className = 'or-tc';
    this.el.id = 'or-touch-controls';
    this.el.innerHTML = `<div class="zone l"></div><div class="zone r"></div>
      <div class="pad" data-role="steer"><div class="end left">${ARROW(false)}</div><div class="end right">${ARROW(true)}</div>
        <div class="rail"></div><div class="mid"></div><div class="knob"></div></div>
      <div class="btn nitro" data-role="nitro">${BOTTLE}<b>NITRO</b></div>
      <div class="btn gas" data-role="gas">${PEDAL}<b>GAS</b></div>
      <div class="btn brake" data-role="brake">${BRAKE}<b>BRAKE</b></div>
      <div class="float"></div>`;
    this.pad = this.el.querySelector('.pad')!;
    this.knob = this.el.querySelector('.knob')!;
    this.float = this.el.querySelector('.float')!;
    this.ends = [...this.el.querySelectorAll<HTMLElement>('.pad .end')];
    this.btn = { gas: this.el.querySelector('.gas')!, brake: this.el.querySelector('.brake')!, nitro: this.el.querySelector('.nitro')! };
    for (const z of this.el.querySelectorAll<HTMLElement>('.zone')) {
      z.addEventListener('pointerdown', this.down);
      z.addEventListener('pointermove', this.move);
      z.addEventListener('pointerup', this.up);
      z.addEventListener('pointercancel', this.up);
      z.addEventListener('lostpointercapture', this.up);
    }
    parent.appendChild(this.el);
  }

  /** Show the controls (a race on screen; CSS also needs touch mode). Hiding lets go of everything. */
  show(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.el.classList.toggle('on', on);
    if (!on) this.release();
  }

  get visible() {
    return this.on && document.body.classList.contains('or-touch');
  }

  /** Let go of every finger (pause, screen change, the window losing focus). */
  release() {
    this.fingers.clear();
    this.float.style.display = 'none';
    this.sync();
  }

  /**
   * What the camera must keep clear while the controls show (CSS px from each edge): the left column (steer pad),
   * the right column (pedals) and their height from the bottom. null when hidden.
   */
  reserve(): { left: number; right: number; bottom: number } | null {
    if (!this.visible) return null;
    const pad = this.pad.getBoundingClientRect();
    const col = [this.btn.nitro, this.btn.gas, this.btn.brake].map((b) => b.getBoundingClientRect());
    const top = Math.min(pad.top, ...col.map((r) => r.top));
    return {
      left: pad.right + 8,
      right: window.innerWidth - Math.min(...col.map((r) => r.left)) + 8,
      bottom: window.innerHeight - top + 6,
    };
  }

  private unit() {
    return parseFloat(getComputedStyle(this.el).getPropertyValue('--u')) || 1;
  }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const side = (e.currentTarget as HTMLElement).classList.contains('l') ? 'l' : 'r';
    let x0 = e.clientX;
    let floating = false;
    if (side === 'l') {
      const r = this.pad.getBoundingClientRect();
      // On (or right by) the pad: steer from its centre, so its ends are full lock.
      if (e.clientX >= r.left - 24 && e.clientX <= r.right + 24 && e.clientY >= r.top - 36 && e.clientY <= r.bottom + 24) x0 = r.left + r.width / 2;
      else {
        floating = true;
        this.float.style.left = `${e.clientX}px`;
        this.float.style.top = `${e.clientY}px`;
        this.float.style.display = 'block';
      }
    }
    this.fingers.set(e.pointerId, { side, x0, x: e.clientX, pedal: side === 'r' ? this.pedalAt(e.clientX, e.clientY) : null, floating });
    this.sync();
  };

  private move = (e: PointerEvent) => {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    e.preventDefault();
    f.x = e.clientX;
    if (f.side === 'r') f.pedal = this.pedalAt(e.clientX, e.clientY);
    this.sync();
  };

  private up = (e: PointerEvent) => {
    if (!this.fingers.delete(e.pointerId)) return;
    if (![...this.fingers.values()].some((f) => f.floating)) this.float.style.display = 'none';
    this.sync();
  };

  /** The pedal under a finger on the right half: nitro / brake when on (or near) them, else gas. */
  private pedalAt(x: number, y: number): Pedal {
    const near = (el: HTMLElement, m: number) => {
      const r = el.getBoundingClientRect();
      return x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m;
    };
    if (near(this.btn.nitro, 10)) return 'nitro';
    if (near(this.btn.brake, 10)) return 'brake';
    return 'gas';
  }

  private sync() {
    const u = this.unit();
    let steer = 0;
    let steering = false;
    const held = new Set<Pedal>();
    for (const f of this.fingers.values()) {
      if (f.side === 'l') {
        // The latest finger on the left wins.
        const d = f.x - f.x0;
        steer = Math.abs(d) < DEAD ? 0 : Math.max(-1, Math.min(1, (d - Math.sign(d) * DEAD) / (LOCK * u)));
        steering = true;
      } else if (f.pedal) held.add(f.pedal);
    }
    const brake = held.has('brake');
    const input: TruckInput = {
      throttle: !brake && (held.has('gas') || held.has('nitro')) ? 1 : 0,
      brake: brake ? 1 : 0,
      steer,
      nitro: held.has('nitro'),
    };
    this.last = input;
    setTouchInput(this.on ? input : null);
    // The look: pressed pedals, the knob's offset, the lit end.
    for (const p of ['gas', 'brake', 'nitro'] as Pedal[]) this.btn[p].classList.toggle('down', held.has(p));
    this.pad.classList.toggle('down', steering);
    const travel = this.pad.clientWidth * 0.36;
    this.knob.style.transform = `translate(calc(-50% + ${steer * travel}px), -50%)`;
    this.ends[0].classList.toggle('lit', steer < -0.5);
    this.ends[1].classList.toggle('lit', steer > 0.5);
  }

  dispose() {
    this.show(false);
    this.el.remove();
  }
}
