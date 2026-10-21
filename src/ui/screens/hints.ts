// "Racing Hints": the rules in a nutshell, in our own words, before signing up (also part of the title's attract loop).
import { addStyle } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { screenEl, type Screen } from './common';

const CSS = `
.or-hints-body { max-width: 980px; margin: 0 auto; font-size: 13px; line-height: 2.05; color: #ffd23a; }
.or-hints-body h2 { margin: 0 0 18px; font-weight: normal; font-size: 30px; color: #7fd8ff; letter-spacing: 3px;
  text-shadow: 3px 3px 0 #0a1a40, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 5px 5px 0 #000; }
.or-hints-body p { margin: 0 0 12px; }
.or-hints-body .item { padding-left: 2.2em; }
.or-hints-body .item b { color: #7fd8ff; font-weight: normal; }
.or-hints-body .free { color: #5cff6a; }
.or-hints-body .ctl { margin-top: 18px; color: #cfe; font-size: 10px; }
.or-hints { padding: 34px 6%; overflow: auto; }
.or-hints .next { position: absolute; right: 40px; bottom: 26px; font-size: 13px; color: #fff; }
`;

export function hintsHtml() {
  addStyle('or-hints-css', CSS);
  return `<div class="or-hints-body"><h2>RACING HINTS</h2>
    <p>Every race is 4 laps of the stadium.<br>Finish ahead of every CPU truck: <span class="free">FREE RACE!</span><br>
    Get beaten by one and it costs you a credit.</p>
    <p>Prize money goes by finishing place.<br>Money bags on the dirt are extra cash.<br>Spend it all at the Speed Shop:</p>
    <div class="item"><b>NITRO</b> - a quick shove of speed.</div>
    <div class="item"><b>TIRES</b> - sharper turns, less sliding.</div>
    <div class="item"><b>SHOCKS</b> - softer landings, less bounce.</div>
    <div class="item"><b>ACCELERATION</b> - more punch off the line.</div>
    <div class="item"><b>TOP SPEED</b> - a higher top end.</div>
    <p style="margin-top:12px">Out of credits? Continue, but your cash<br>goes back to $0. Upgrades stay on the truck.</p>
    <div class="ctl">1 PLAYER: ARROWS / WASD OR PAD &middot; NITRO: SPACE / SHIFT OR (B) &middot; M: MUTE<br>
    2-3 PLAYERS: WASD + L.SHIFT &middot; ARROWS + R.CTRL &middot; PADS (A GAS, B NITRO)</div></div>`;
}

export class HintsScreen implements Screen {
  readonly el = screenEl('or-hints');

  constructor(private o: { onNext(): void; onBack(): void }) {
    this.el.innerHTML = `${hintsHtml()}<div class="next blink">PRESS START</div>`;
  }

  input(e: MenuEvent) {
    if (e.key === 'confirm') this.o.onNext();
    else if (e.key === 'back') this.o.onBack();
  }

  dispose() {
    this.el.remove();
  }
}
