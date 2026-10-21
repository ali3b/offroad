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
.or-hints { touch-action: pan-y; }
.or-hints .tbtn { position: fixed; bottom: calc(env(safe-area-inset-bottom) + 12px); min-height: 48px; min-width: 120px; padding: 0 16px;
  display: flex; align-items: center; justify-content: center; font-size: 12px; background: #2a3b78; border: 3px solid #000;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.25), 4px 4px 0 rgba(0,0,0,.5); }
.or-hints .tbtn.go { right: calc(env(safe-area-inset-right) + 14px); background: #1d7a2a; color: #fff; }
.or-hints .tbtn.back { left: calc(env(safe-area-inset-left) + 14px); color: #cfe; }
body.or-touch .or-hints { padding-bottom: 84px; }
@media (max-height: 560px) {
  .or-hints-body { font-size: 9px; line-height: 1.9; }
  .or-hints-body .cols { column-count: 2; column-gap: 34px; }
  .or-hints-body .cols p, .or-hints-body .cols .item { break-inside: avoid; }
  .or-hints-body h2 { font-size: 18px; margin-bottom: 10px; }
  .or-hints-body .ctl { font-size: 7px; }
  .or-hints { padding: 14px 5% 20px; }
  .or-hints .next { right: 20px; bottom: 12px; font-size: 10px; }
}
`;

export function hintsHtml() {
  addStyle('or-hints-css', CSS);
  return `<div class="or-hints-body"><h2>RACING HINTS</h2><div class="cols">
    <p>Every race is 4 laps of the stadium.<br>Finish ahead of every CPU truck: <span class="free">FREE RACE!</span><br>
    Get beaten by one and it costs you a credit.</p>
    <p>Prize money goes by finishing place.<br>Money bags on the dirt are extra cash.<br>Spend it all at the Speed Shop:</p>
    <div class="item"><b>NITRO</b> - a quick shove of speed.</div>
    <div class="item"><b>TIRES</b> - sharper turns, less sliding.</div>
    <div class="item"><b>SHOCKS</b> - softer landings, less bounce.</div>
    <div class="item"><b>ACCELERATION</b> - more punch off the line.</div>
    <div class="item"><b>TOP SPEED</b> - a higher top end.</div>
    <p style="margin-top:12px">Out of credits? Continue, but your cash<br>goes back to $0. Upgrades stay on the truck.</p></div>
    <div class="ctl kb-only">1 PLAYER: ARROWS / WASD OR PAD &middot; NITRO: SPACE / SHIFT OR (B) &middot; M: MUTE<br>
    2-3 PLAYERS: WASD + L.SHIFT &middot; ARROWS + R.CTRL &middot; PADS (A GAS, B NITRO)</div>
    <div class="ctl touch-only">TOUCH: SLIDE THE LEFT PAD TO STEER &middot; GAS, BRAKE AND NITRO ON THE RIGHT<br>
    NITRO ALSO GIVES GAS: ROLL YOUR THUMB UP FROM THE PEDAL &middot; II PAUSES</div></div>`;
}

export class HintsScreen implements Screen {
  readonly el = screenEl('or-hints');

  constructor(private o: { onNext(): void; onBack(): void }) {
    // A tap anywhere goes on; BACK returns to the title. The page scrolls on a short screen.
    this.el.dataset.tap = 'hints:next';
    this.el.dataset.scroll = '';
    this.el.innerHTML = `${hintsHtml()}<div class="next blink kb-only">PRESS START</div>
      <div class="tbtn back touch-only" data-tap="hints:back">&#9664; BACK</div><div class="tbtn go touch-only pulse" data-tap="hints:next">NEXT &#9654;</div>`;
  }

  input(e: MenuEvent) {
    if (e.tap === 'hints:back') return this.o.onBack();
    if (e.key === 'confirm' || e.tap === 'hints:next') this.o.onNext();
    else if (e.key === 'back') this.o.onBack();
  }

  dispose() {
    this.el.remove();
  }
}
