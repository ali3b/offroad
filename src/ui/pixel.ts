// The pixel-font look shared by the race HUD, banners and the results screen (Press Start 2P, OFL, bundled).
import '@fontsource/press-start-2p/400.css';

export const PIXEL_FONT = `'Press Start 2P', ui-monospace, monospace`;

let injected = false;
/** Add a stylesheet once. */
export function addStyle(id: string, css: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = css;
  document.head.appendChild(s);
  injected = true;
}

export function styled() {
  return injected;
}
