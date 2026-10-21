// Keyboard + Gamepad API → TruckInput, per player. Tests can override with window.__or.setInput().
//
// One human: readInput() — arrows or WASD, Space / Shift = nitro, and any gamepad (KEY_SCHEMES.solo).
// Two or three humans (local multiplayer) split the keyboard: the WASD player (Left Shift = nitro), the arrows player
// (Right Ctrl or Enter = nitro); a third player drives with a gamepad. Every human can also use a pad: a player who
// joined with a pad keeps that pad, the other pads go to the other players in join order (padsFor()).
// Touch (phones, tablets): the on-screen race controls (ui/touch/controls.ts) set a 'touch' TruckInput that drives
// player 1 (alone, or as player 1 of a local multiplayer season); menu taps come in through pushMenu() with
// src 'touch'. The input mode (touch / keys / pad) follows the last device used and shows or hides the touch UI.
import type { TruckInput } from '../physics/vehicle';

// ---- Input mode -------------------------------------------------------------------------------------------------

/** The device the player used last: the touch UI shows in 'touch' mode only. */
export type InputMode = 'touch' | 'keys' | 'pad';
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
let mode: InputMode = coarse ? 'touch' : 'keys';
const modeListeners = new Set<(m: InputMode) => void>();

export const inputMode = () => mode;

export function setInputMode(m: InputMode) {
  if (m === mode) return;
  mode = m;
  for (const fn of modeListeners) fn(m);
}

export function onInputMode(fn: (m: InputMode) => void) {
  modeListeners.add(fn);
  return () => modeListeners.delete(fn);
}

const held = new Set<string>();
const pressed = new Set<string>();
/** Menu presses in order (a Set would merge two presses of the same key within one frame). */
const menuQueue: string[] = [];

export function initKeyboard() {
  // A finger on the screen switches to touch mode; a key or a pad (readInput / drainMenu) switches back.
  window.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && setInputMode('touch'), { capture: true });
  window.addEventListener('keydown', (e) => {
    // Tools (F2/F3/M) and modifier keys alone keep the touch UI up.
    if (!/^(F\d+|KeyM|Meta|Alt|Control|Shift)/.test(e.code)) setInputMode('keys');
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F2', 'F3', 'Backspace', 'ControlRight'].includes(e.code)) e.preventDefault();
    if (!held.has(e.code)) {
      pressed.add(e.code);
      menuQueue.push(e.code);
      // Standalone scenes never drain the menu queue: keep it short.
      if (menuQueue.length > 32) menuQueue.shift();
    }
    held.add(e.code);
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());
}

/** True once per key press (consumed). */
export function wasPressed(code: string) {
  const p = pressed.has(code);
  pressed.delete(code);
  return p;
}

const any = (...codes: string[]) => codes.some((c) => held.has(c));
const DEAD = 0.18;

// ---- Driving bindings ---------------------------------------------------------------------------------------------

/** A keyboard layout for one driver. 'solo' is the single-player layout (both key sets). */
export type KeyScheme = 'solo' | 'wasd' | 'arrows';

export interface KeyBinding {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  nitro: string[];
  /** Short label for the sign-up panel. */
  label: string;
}

/** The keyboard split (edit here to rebind). */
export const KEY_SCHEMES: Record<KeyScheme, KeyBinding> = {
  solo: {
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    nitro: ['Space', 'ShiftLeft', 'ShiftRight'],
    label: 'KEYS OR PAD',
  },
  wasd: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], nitro: ['ShiftLeft'], label: 'WASD + L.SHIFT' },
  arrows: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], nitro: ['ControlRight', 'Enter', 'NumpadEnter'], label: 'ARROWS + R.CTRL' },
};

/** One human's controls: a keyboard layout (or none: pad only) and the pad they joined with (else one is lent in join order). */
export interface Control {
  keys: KeyScheme | null;
  pad: number | null;
}

/** The driving input of one keyboard layout. */
export function readKeys(scheme: KeyScheme): TruckInput {
  const k = KEY_SCHEMES[scheme];
  return {
    throttle: any(...k.up) ? 1 : 0,
    brake: any(...k.down) ? 1 : 0,
    steer: (any(...k.right) ? 1 : 0) - (any(...k.left) ? 1 : 0),
    nitro: any(...k.nitro),
  };
}

function padInput(p: Gamepad): TruckInput {
  const b = (i: number) => p.buttons[i]?.value ?? 0;
  const sx = p.axes[0] ?? 0;
  const steer = Math.abs(sx) < DEAD ? 0 : (sx - Math.sign(sx) * DEAD) / (1 - DEAD);
  const dpad = (b(15) > 0.5 ? 1 : 0) - (b(14) > 0.5 ? 1 : 0);
  // RT or A for gas, LT or X for brake/reverse, B / Y / RB for nitro.
  return {
    throttle: Math.max(b(7), b(0)),
    brake: Math.max(b(6), b(2)),
    steer: Math.max(-1, Math.min(1, steer + dpad)),
    nitro: b(1) > 0.5 || b(3) > 0.5 || b(5) > 0.5,
  };
}

const active = (i: TruckInput) => !!(i.throttle || i.brake || i.steer || i.nitro);
const IDLE: TruckInput = { throttle: 0, brake: 0, steer: 0, nitro: false };

// ---- Touch ------------------------------------------------------------------------------------------------------

let touch: TruckInput = IDLE;

/** The on-screen controls' input (ui/touch/controls.ts), held until the next call. */
export function setTouchInput(i: TruckInput | null) {
  touch = i ?? IDLE;
}

/** The touch driving input (player 1). */
export const readTouch = (): TruckInput => touch;

/** Note pad use (switches the input mode away from touch). */
function sawPad(i: TruckInput) {
  if (active(i)) setInputMode('pad');
  return i;
}

function connectedPads(): Gamepad[] {
  return [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected);
}

/** One pad's driving input (null when that pad isn't connected). */
export function readPad(index: number): TruckInput | null {
  const p = connectedPads().find((x) => x.index === index);
  return p ? padInput(p) : null;
}

/**
 * Which pad each human drives with: a pad they joined with stays theirs; the other connected pads go to the players
 * without one, in join order (pad index order). null = no pad for that player right now.
 */
export function padsFor(controls: Control[], connected = connectedPads().map((p) => p.index)): (number | null)[] {
  const fixed = new Set(controls.map((c) => c.pad).filter((p): p is number => p !== null));
  const free = connected.filter((i) => !fixed.has(i)).sort((a, b) => a - b);
  return controls.map((c) => (c.pad !== null ? c.pad : (free.shift() ?? null)));
}

/** Every human's driving input (index = player). A single 'solo' player reads like readInput(). */
export function readPlayers(controls: Control[]): TruckInput[] {
  if (controls.length === 1 && controls[0].keys === 'solo' && controls[0].pad === null) return [readInput()];
  const pads = padsFor(controls);
  return controls.map((c, i) => {
    // Touch drives player 1.
    if (i === 0 && active(touch)) return touch;
    const pad = pads[i] !== null ? readPad(pads[i]!) : null;
    if (pad && active(sawPad(pad))) return pad;
    return c.keys ? readKeys(c.keys) : IDLE;
  });
}

/** One human (standalone scenes, a 1-player season): the first active pad, else arrows or WASD. */
export function readInput(): TruckInput {
  if (active(touch)) return touch;
  for (const p of connectedPads()) {
    const input = padInput(p);
    if (active(sawPad(input))) return input;
  }
  return readKeys('solo');
}

/** Gamepad Back/Select resets the truck (keyboard: R). */
let padResetHeld = false;
export function resetRequested() {
  const now = connectedPads().some((p) => p.buttons[8]?.pressed ?? false);
  const edge = now && !padResetHeld;
  padResetHeld = now;
  return wasPressed('KeyR') || edge;
}

/** Enter / Space on the keyboard or A / Start on a pad (menus: "race again"). Edge-triggered. */
let padConfirmHeld = false;
export function confirmPressed() {
  const now = connectedPads().some((p) => (p.buttons[0]?.pressed ?? false) || (p.buttons[9]?.pressed ?? false));
  const edge = now && !padConfirmHeld;
  padConfirmHeld = now;
  const key = wasPressed('Enter') || wasPressed('NumpadEnter');
  return key || edge;
}

// ---- Menus ------------------------------------------------------------------------------------------------------

export type MenuKey = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';
/**
 * Where a menu press came from: the WASD side of the keyboard ('wasd': W A S D, Left Shift, Space), the arrows side
 * ('arrows': arrows, Enter, Right Ctrl), the rest of the keyboard ('kb': Esc, Backspace, other letters), or a pad
 * ('pad0', 'pad1', …), or a tap on the screen ('touch': always player 1). Tests leave it out.
 */
export type MenuSrc = 'wasd' | 'arrows' | 'kb' | 'touch' | `pad${number}`;

/** One menu press: a navigation key and/or a typed letter (A–Z, for the initials). */
export interface MenuEvent {
  key?: MenuKey;
  letter?: string;
  src?: MenuSrc;
  /** The human this press belongs to (the flow fills it in; tests may set it). undefined = anyone. */
  player?: number;
  /** A tap: what was tapped (the screen's own id, e.g. a shop tile 'tires', a letter 'up:1'). */
  tap?: string;
}

/** Taps waiting for the next drainMenu() (ui/touch/tap.ts). */
const touchMenu: MenuEvent[] = [];

/**
 * Take the waiting taps that match (by tap id or key) without draining the keys (a standalone race, where R and
 * Enter are read with wasPressed). The others stay queued.
 */
export function takeTap(match: (e: MenuEvent) => boolean) {
  const i = touchMenu.findIndex(match);
  if (i < 0) return false;
  touchMenu.splice(i, 1);
  return true;
}

/** A menu press from a tap (src 'touch'); the flow reads it with the keys and pads on the next frame. */
export function pushMenu(e: Omit<MenuEvent, 'src'>) {
  touchMenu.push({ ...e, src: 'touch' });
  if (touchMenu.length > 32) touchMenu.shift();
}

const MENU_CODES: Record<string, [MenuKey, MenuSrc]> = {
  KeyW: ['up', 'wasd'],
  KeyS: ['down', 'wasd'],
  KeyA: ['left', 'wasd'],
  KeyD: ['right', 'wasd'],
  ShiftLeft: ['confirm', 'wasd'],
  Space: ['confirm', 'wasd'],
  ArrowUp: ['up', 'arrows'],
  ArrowDown: ['down', 'arrows'],
  ArrowLeft: ['left', 'arrows'],
  ArrowRight: ['right', 'arrows'],
  Enter: ['confirm', 'arrows'],
  NumpadEnter: ['confirm', 'arrows'],
  ControlRight: ['confirm', 'arrows'],
  Escape: ['back', 'kb'],
  Backspace: ['back', 'kb'],
};

/** Forget key presses that happened before now (a screen change must not act on keys pressed during the race). */
export function clearPressed() {
  pressed.clear();
  menuQueue.length = 0;
  touchMenu.length = 0;
  padMenuHeld.clear();
  for (const p of connectedPads()) for (const [k, held] of padMenuState(p)) if (held) padMenuHeld.add(`${p.index}:${k}`);
}

const padMenuHeld = new Set<string>();
function padMenuState(p: Gamepad): [string, boolean][] {
  const b = (i: number) => p.buttons[i]?.pressed ?? false;
  const ax = p.axes[0] ?? 0;
  const ay = p.axes[1] ?? 0;
  return [
    ['up', b(12) || ay < -0.6],
    ['down', b(13) || ay > 0.6],
    ['left', b(14) || ax < -0.6],
    ['right', b(15) || ax > 0.6],
    // A or Start confirm, B or Back goes back.
    ['confirm', b(0) || b(9)],
    ['back', b(1) || b(8)],
  ];
}

/** Menu presses since the last call (keyboard + every pad, edge-triggered, with their source). Consumes the keyboard presses. */
export function drainMenu(): MenuEvent[] {
  const out: MenuEvent[] = [];
  for (const code of menuQueue) {
    const m = MENU_CODES[code];
    const letter = /^Key[A-Z]$/.test(code) ? code.slice(3) : undefined;
    if (m || letter) out.push({ key: m?.[0], letter, src: m?.[1] ?? 'kb' });
  }
  menuQueue.length = 0;
  pressed.clear();
  out.push(...touchMenu);
  touchMenu.length = 0;
  for (const p of connectedPads()) {
    for (const [k, held] of padMenuState(p)) {
      const id = `${p.index}:${k}`;
      if (held && !padMenuHeld.has(id)) {
        out.push({ key: k as MenuKey, src: `pad${p.index}` });
        setInputMode('pad');
      }
      if (held) padMenuHeld.add(id);
      else padMenuHeld.delete(id);
    }
  }
  return out;
}
