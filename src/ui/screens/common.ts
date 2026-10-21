// Shared look and plumbing for the full-screen menus (title, hints, sign-up, get ready, shop, continue, game over):
// the DOS-era pixel style (Press Start 2P, a 16-colour-ish palette, hard drop shadows, chunky bevelled panels).
import { addStyle, PIXEL_FONT } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import type { Colour } from '../../race/roster';

export interface Screen {
  readonly el: HTMLElement;
  /** A menu press (keyboard / pad, or a test via window.__or.flow.press). */
  input(e: MenuEvent): void;
  /** Real seconds since the last frame (blinks, countdowns). */
  tick?(dt: number): void;
  dispose(): void;
}

/** Panel colours per truck colour (darker than the truck paint so white text reads). */
export const PANEL: Record<Colour, { bg: string; hi: string; text: string }> = {
  red: { bg: '#b8261c', hi: '#ff6a4a', text: '#fff' },
  yellow: { bg: '#d2a514', hi: '#ffe14a', text: '#1b1b22' },
  blue: { bg: '#2848b8', hi: '#7fa8ff', text: '#fff' },
  grey: { bg: '#6d727a', hi: '#c9ccd2', text: '#fff' },
};

const CSS = `
.or-scr { position: fixed; inset: 0; z-index: 20; font-family: ${PIXEL_FONT}; color: #fff; text-shadow: 2px 2px 0 #000;
  image-rendering: pixelated; user-select: none; box-sizing: border-box; }
.or-scr *, .or-scr *::before, .or-scr *::after { box-sizing: border-box; }
.or-scr.solid { background: #0c2f4a; }
.or-scr .blink { animation: or-scr-blink 1s steps(2) infinite; }
@keyframes or-scr-blink { 50% { opacity: 0; } }
.or-scr .banner { height: 86px; display: flex; align-items: center; justify-content: center; gap: 22px;
  background: linear-gradient(#1b1b22 0 6px, #e9e4d4 6px 10px, #2a3b78 10px calc(100% - 10px), #e9e4d4 calc(100% - 10px) calc(100% - 6px), #1b1b22 calc(100% - 6px));
  border-bottom: 4px solid #000; }
.or-scr .banner h1 { margin: 0; font-size: 34px; font-weight: normal; letter-spacing: 3px; color: #7fd8ff;
  text-shadow: 3px 3px 0 #0a1a40, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 5px 5px 0 #000; }
.or-scr .banner h1 i { font-style: normal; color: #fff; }
.or-scr .chequer { width: 64px; height: 40px; background: repeating-conic-gradient(#111 0 25%, #f2f2f2 0 50%) 0 0 / 16px 16px;
  border: 3px solid #000; }
.or-scr .panels { position: absolute; top: 86px; left: 0; right: 0; bottom: 0; display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 18px; padding: 18px 40px; background: #0d4a52; }
.or-scr .panel { position: relative; border: 4px solid #000; box-shadow: inset 0 0 0 3px rgba(255,255,255,.25), 6px 6px 0 rgba(0,0,0,.45);
  display: flex; flex-direction: column; align-items: center; padding: 22px 14px; gap: 14px; text-align: center; overflow: hidden; }
.or-scr .panel .who { font-size: 15px; line-height: 1.7; }
.or-scr .panel .small { font-size: 10px; line-height: 1.8; opacity: .9; }
.or-scr .key { color: #ffe14a; }
.or-scr .foot { position: absolute; left: 0; right: 0; bottom: 14px; text-align: center; font-size: 10px; color: #cfe; }
.or-scr .bars { display: flex; gap: 10px; justify-content: center; }
.or-scr .bars .bar { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 8px; }
.or-scr .lv { display: flex; flex-direction: column-reverse; gap: 2px; }
.or-scr .lv i { display: block; width: 14px; height: 9px; border: 2px solid #000; background: #233; }
.or-scr .lv i.on { background: #4cff5a; }
.or-scr .truck-ico { width: 120px; height: 64px; }
.or-scr .panel .trophy { width: 34%; max-width: 140px; margin-top: auto; opacity: .85; }
@media (max-width: 900px) { .or-scr .panels { gap: 8px; padding: 10px; } .or-scr .banner h1 { font-size: 20px; } .or-scr .panel .who { font-size: 11px; } }
`;

export function screenEl(cls: string, solid = true) {
  addStyle('or-scr-css', CSS);
  const el = document.createElement('div');
  el.className = `or-scr ${cls}${solid ? ' solid' : ''}`;
  return el;
}

/** The chequered-flag banner on top of the shop and sign-up screens. */
export function banner(title: string) {
  return `<div class="banner"><div class="chequer"></div><h1>${title}</h1><div class="chequer"></div></div>`;
}

/** Five stacked level boxes (lit from the bottom). */
export function levelBar(level: number, max = 5) {
  return `<span class="lv">${Array.from({ length: max }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</span>`;
}

/** A side-on pixel pickup truck in a colour (sign-up, get ready). */
export function truckIcon(hex: string) {
  return `<svg class="truck-ico" viewBox="0 0 60 32" shape-rendering="crispEdges">
    <rect x="4" y="13" width="52" height="10" fill="${hex}" stroke="#000" stroke-width="1"/>
    <rect x="20" y="5" width="18" height="9" fill="${hex}" stroke="#000" stroke-width="1"/>
    <rect x="23" y="7" width="12" height="6" fill="#9fc4d8"/>
    <rect x="40" y="4" width="2" height="10" fill="#222"/><rect x="40" y="4" width="14" height="2" fill="#222"/>
    <rect x="2" y="16" width="4" height="4" fill="#ffe14a"/>
    <circle cx="15" cy="24" r="6" fill="#1b1b1b"/><circle cx="15" cy="24" r="2.5" fill="#bbb"/>
    <circle cx="45" cy="24" r="6" fill="#1b1b1b"/><circle cx="45" cy="24" r="2.5" fill="#bbb"/>
  </svg>`;
}

/** A pixel trophy on a plinth (the empty lower half of the CPU panels, like the original's trophy art). */
export function trophyIcon() {
  return `<svg class="trophy" viewBox="0 0 32 40" shape-rendering="crispEdges">
    <rect x="8" y="2" width="16" height="14" fill="#e8e2c8" stroke="#000"/><rect x="10" y="4" width="3" height="10" fill="#fff"/>
    <rect x="3" y="4" width="5" height="3" fill="#cfc8a8" stroke="#000"/><rect x="3" y="4" width="3" height="8" fill="#cfc8a8" stroke="#000"/>
    <rect x="24" y="4" width="5" height="3" fill="#cfc8a8" stroke="#000"/><rect x="26" y="4" width="3" height="8" fill="#cfc8a8" stroke="#000"/>
    <rect x="13" y="16" width="6" height="7" fill="#b8b090" stroke="#000"/><rect x="9" y="23" width="14" height="4" fill="#e8e2c8" stroke="#000"/>
    <rect x="5" y="27" width="22" height="11" fill="#4a4d55" stroke="#000"/><rect x="9" y="30" width="14" height="4" fill="#ffe14a"/>
  </svg>`;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
