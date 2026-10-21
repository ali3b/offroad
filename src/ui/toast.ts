// A short message at the top of the screen (settings changes like F2's DOS look), gone after a moment.
import { addStyle, PIXEL_FONT } from './pixel';

const CSS = `
.or-toast { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 50; pointer-events: none;
  font-family: ${PIXEL_FONT}; font-size: 12px; color: #ffe14a; background: #0b0f22; border: 3px solid #c9c9d2;
  padding: 8px 14px; text-shadow: 2px 2px 0 #000; box-shadow: 4px 4px 0 rgba(0,0,0,.5); }
`;

let el: HTMLDivElement | null = null;
let timer = 0;

export function toast(text: string, seconds = 1.6) {
  addStyle('or-toast-css', CSS);
  el ??= document.createElement('div');
  el.className = 'or-toast';
  el.textContent = text;
  document.body.appendChild(el);
  clearTimeout(timer);
  timer = window.setTimeout(() => el?.remove(), seconds * 1000);
}
