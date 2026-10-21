// Keyboard + Gamepad API → TruckInput. Tests can override with window.__or.setInput().
import type { TruckInput } from '../physics/vehicle';

const held = new Set<string>();
const pressed = new Set<string>();

export function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F3', 'Backspace'].includes(e.code)) e.preventDefault();
    if (!held.has(e.code)) pressed.add(e.code);
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

function gamepad(): TruckInput | null {
  const pads = navigator.getGamepads?.() ?? [];
  for (const p of pads) {
    if (!p || !p.connected) continue;
    const b = (i: number) => p.buttons[i]?.value ?? 0;
    const sx = p.axes[0] ?? 0;
    const steer = Math.abs(sx) < DEAD ? 0 : (sx - Math.sign(sx) * DEAD) / (1 - DEAD);
    const dpad = (b(15) > 0.5 ? 1 : 0) - (b(14) > 0.5 ? 1 : 0);
    const input = {
      // RT or A for gas, LT or X for brake/reverse, B / Y / RB for nitro.
      throttle: Math.max(b(7), b(0)),
      brake: Math.max(b(6), b(2)),
      steer: Math.max(-1, Math.min(1, steer + dpad)),
      nitro: b(1) > 0.5 || b(3) > 0.5 || b(5) > 0.5,
    };
    if (input.throttle || input.brake || input.steer || input.nitro) return input;
  }
  return null;
}

export function readInput(): TruckInput {
  const pad = gamepad();
  if (pad) return pad;
  return {
    throttle: any('ArrowUp', 'KeyW') ? 1 : 0,
    brake: any('ArrowDown', 'KeyS') ? 1 : 0,
    steer: (any('ArrowRight', 'KeyD') ? 1 : 0) - (any('ArrowLeft', 'KeyA') ? 1 : 0),
    nitro: any('Space', 'ShiftLeft', 'ShiftRight'),
  };
}

/** Gamepad Back/Select resets the truck (keyboard: R). */
let padResetHeld = false;
export function resetRequested() {
  const pads = navigator.getGamepads?.() ?? [];
  const now = pads.some((p) => p?.connected && (p.buttons[8]?.pressed ?? false));
  const edge = now && !padResetHeld;
  padResetHeld = now;
  return wasPressed('KeyR') || edge;
}

/** Enter / Space on the keyboard or A / Start on a pad (menus: "race again"). Edge-triggered. */
let padConfirmHeld = false;
export function confirmPressed() {
  const pads = navigator.getGamepads?.() ?? [];
  const now = pads.some((p) => p?.connected && ((p.buttons[0]?.pressed ?? false) || (p.buttons[9]?.pressed ?? false)));
  const edge = now && !padConfirmHeld;
  padConfirmHeld = now;
  const key = wasPressed('Enter') || wasPressed('NumpadEnter');
  return key || edge;
}

// ---- Menus ------------------------------------------------------------------------------------------------------

export type MenuKey = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';
/** One menu press: a navigation key and/or a typed letter (A–Z, for the initials). */
export interface MenuEvent {
  key?: MenuKey;
  letter?: string;
}

const MENU_CODES: Record<string, MenuKey> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Space: 'confirm',
  Escape: 'back',
  Backspace: 'back',
};

/** Forget key presses that happened before now (a screen change must not act on keys pressed during the race). */
export function clearPressed() {
  pressed.clear();
  padMenuHeld.clear();
  const pads = navigator.getGamepads?.() ?? [];
  pads.forEach((p, i) => {
    if (p?.connected) for (const [k, held] of padMenuState(p)) if (held) padMenuHeld.add(`${i}:${k}`);
  });
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

/** Menu presses since the last call (keyboard + every pad, edge-triggered). Consumes the keyboard presses. */
export function drainMenu(): MenuEvent[] {
  const out: MenuEvent[] = [];
  for (const code of pressed) {
    const key = MENU_CODES[code];
    const letter = /^Key[A-Z]$/.test(code) ? code.slice(3) : undefined;
    if (key || letter) out.push({ key, letter });
  }
  pressed.clear();
  const pads = navigator.getGamepads?.() ?? [];
  pads.forEach((p, i) => {
    if (!p?.connected) return;
    for (const [k, held] of padMenuState(p)) {
      const id = `${i}:${k}`;
      if (held && !padMenuHeld.has(id)) out.push({ key: k as MenuKey });
      if (held) padMenuHeld.add(id);
      else padMenuHeld.delete(id);
    }
  });
  return out;
}
