// Keyboard + Gamepad API → TruckInput. Tests can override with window.__or.setInput().
import type { TruckInput } from '../physics/vehicle';

const held = new Set<string>();
const pressed = new Set<string>();

export function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F3'].includes(e.code)) e.preventDefault();
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
