// Phones and tablets: the page-level bits of the touch build.
//   - body classes: `or-touchcap` on a touch screen, `or-touch` while the input mode is touch (engine/input.ts), so
//     the screens show TAP prompts and on-screen buttons (`.touch-only`) instead of key hints (`.kb-only`)
//   - no page scroll, pinch / double-tap zoom or pull-to-refresh (touch-action, overscroll, iOS gesture events)
//   - taps on `[data-tap]` elements become menu presses (pushMenu, src 'touch'); `[data-repeat]` ones fire on press
//     and repeat while held (the initials' up / down arrows)
//   - the "rotate your device" card in portrait, the Fullscreen API (+ a landscape orientation lock), haptics
import { inputMode, onInputMode, pushMenu, type MenuKey } from '../../engine/input';
import { touchCapable } from '../../engine/quality';
import { getSettings } from '../../engine/retro';
import { events } from '../../race/events';
import { addStyle, PIXEL_FONT } from '../pixel';

const CSS = `
html, body { touch-action: none; overscroll-behavior: none; -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
body:not(.or-touch) .touch-only { display: none !important; }
body.or-touch .kb-only { display: none !important; }
[data-tap] { cursor: pointer; }
.or-rotate { position: fixed; inset: 0; z-index: 100; display: none; flex-direction: column; align-items: center;
  justify-content: center; gap: 28px; padding: 24px; text-align: center; font-family: ${PIXEL_FONT}; color: #ffe14a;
  background: repeating-conic-gradient(#14204a 0 25%, #1b2a5c 0 50%) 0 0 / 48px 48px; text-shadow: 3px 3px 0 #000; }
.or-rotate .card { background: #0b0f22; border: 4px solid #000; box-shadow: inset 0 0 0 3px #c9c9d2, 6px 6px 0 rgba(0,0,0,.5);
  padding: 26px 22px; display: flex; flex-direction: column; align-items: center; gap: 22px; max-width: 320px; }
.or-rotate h2 { margin: 0; font-weight: normal; font-size: 18px; line-height: 1.6; }
.or-rotate p { margin: 0; font-size: 10px; line-height: 2; color: #cfe; }
.or-rotate svg { width: 132px; height: 132px; animation: or-rot 2.4s steps(1) infinite; image-rendering: pixelated; }
@keyframes or-rot { 0%, 40% { transform: rotate(0deg); } 50%, 90% { transform: rotate(-90deg); } }
@media (orientation: portrait) { body.or-touchcap .or-rotate { display: flex; } }
`;

/** A pixel phone with the game on its screen (the rotate card). */
const PHONE = `<svg viewBox="0 0 32 32" shape-rendering="crispEdges">
  <rect x="9" y="2" width="14" height="28" fill="#c9c9d2" stroke="#000"/><rect x="11" y="5" width="10" height="20" fill="#2a1d14"/>
  <rect x="12" y="7" width="8" height="16" fill="#b8742c"/><rect x="13" y="9" width="6" height="12" fill="none" stroke="#e9e4d4"/>
  <rect x="14" y="17" width="3" height="2" fill="#c8231f"/><rect x="15" y="27" width="2" height="1" fill="#000"/></svg>`;

let started = false;

/** Install the page-level touch support (once, at boot). */
export function initMobile() {
  if (started) return;
  started = true;
  addStyle('or-touch-page-css', CSS);
  const body = document.body;
  body.classList.toggle('or-touchcap', touchCapable());
  const syncMode = () => body.classList.toggle('or-touch', inputMode() === 'touch');
  syncMode();
  onInputMode((m) => {
    if (m === 'touch') body.classList.add('or-touchcap');
    syncMode();
  });

  // iOS Safari ignores user-scalable=no: block pinch (gesture events) and double-tap zoom.
  for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  // No pull-to-refresh / rubber-band scroll except inside a scrolling panel (the hints).
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.target as Element | null;
      if (!t?.closest?.('[data-scroll]') && e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener('contextmenu', (e) => {
    if (inputMode() === 'touch') e.preventDefault();
  });

  installTaps();
  installRotateCard();
  installHaptics();
}

// ---- taps --------------------------------------------------------------------------------------------------------

/** `data-tap="<id>"` (+ optional `data-key="confirm"`): a click is a menu press. `data-repeat`: press + auto-repeat. */
function installTaps() {
  const fire = (el: HTMLElement) => pushMenu({ key: (el.dataset.key as MenuKey | undefined) || undefined, tap: el.dataset.tap });
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest?.('[data-tap]') as HTMLElement | null;
    if (!el || el.hasAttribute('data-repeat')) return;
    e.preventDefault();
    fire(el);
  });
  let timer = 0;
  const stop = () => {
    clearTimeout(timer);
    clearInterval(timer);
    timer = 0;
  };
  document.addEventListener('pointerdown', (e) => {
    const el = (e.target as Element | null)?.closest?.('[data-repeat]') as HTMLElement | null;
    if (!el) return;
    e.preventDefault();
    stop();
    fire(el);
    // The screen redraws on every press: repeat on whatever element carries the same tap id now.
    const id = el.dataset.tap ?? '';
    const again = () => {
      const now = [...document.querySelectorAll<HTMLElement>('[data-repeat]')].find((x) => x.dataset.tap === id);
      if (now) fire(now);
      else stop();
    };
    timer = window.setTimeout(() => (timer = window.setInterval(again, 110)), 420);
  });
  for (const ev of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(ev, stop);
}

// ---- rotate card -------------------------------------------------------------------------------------------------

function installRotateCard() {
  const el = document.createElement('div');
  el.className = 'or-rotate';
  el.id = 'or-rotate';
  el.innerHTML = `<div class="card">${PHONE}<h2>ROTATE YOUR<br>DEVICE</h2><p>OFF ROAD PLAYS IN<br>LANDSCAPE</p></div>`;
  document.body.appendChild(el);
}

/** True while the rotate card is up (a touch screen held in portrait). */
export function portraitBlocked() {
  return document.body.classList.contains('or-touchcap') && matchMedia('(orientation: portrait)').matches;
}

// ---- fullscreen --------------------------------------------------------------------------------------------------

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

/** The Fullscreen API is there (not on iPhone Safari, which has Add to Home Screen instead). */
export function canFullscreen() {
  const el = document.documentElement as FsEl;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen) && document.fullscreenEnabled !== false;
}

export function isFullscreen() {
  const d = document as FsDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Enter or leave fullscreen; on entering, try to lock landscape (Android Chrome allows it in fullscreen). */
export async function toggleFullscreen() {
  const d = document as FsDoc;
  try {
    if (isFullscreen()) await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    else {
      const el = document.documentElement as FsEl;
      await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o?.lock?.('landscape').catch(() => {});
    }
  } catch {
    // Refused (no user gesture, or not allowed): stay as we are.
  }
}

// ---- haptics -----------------------------------------------------------------------------------------------------

let humanTruck: (i: number) => boolean = (i) => i === 0;

/** Who is human (the flow's current race): only their nitros and crashes buzz. */
export function setHumanCheck(fn: (i: number) => boolean) {
  humanTruck = fn;
}

export const canVibrate = () => typeof navigator.vibrate === 'function';

function buzz(ms: number | number[]) {
  if (!canVibrate() || !getSettings().haptics || inputMode() !== 'touch') return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Not allowed before a user gesture: skip.
  }
}

function installHaptics() {
  let lastHit = 0;
  events.on('nitro', (e) => humanTruck(e.truck) && buzz(35));
  events.on('impact', (e) => {
    if (!humanTruck(e.truck) || e.strength < 0.45) return;
    const now = performance.now();
    if (now - lastHit < 250) return;
    lastHit = now;
    buzz(e.strength > 0.8 ? [60, 40, 60] : Math.round(25 + e.strength * 40));
  });
}
