// The title / attract screen: our "OFF ROAD" logo in a late-80s DOS style over the demo race (CPU trucks on
// autopilot), a little menu (new season / continue season), a blinking PRESS START, our credits line. Left idle it
// cycles to the racing hints and back, like an arcade attract loop.
import { addStyle, PIXEL_FONT } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { hintsHtml } from './hints';
import { screenEl, type Screen } from './common';

const CSS = `
.or-title { display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }
.or-title .top { padding: 44px 0 30px; text-align: center;
  background: linear-gradient(rgba(6,22,40,.92), rgba(6,22,40,.78) 80%, rgba(6,22,40,0)); }
.or-logo { display: inline-block; font-family: ${PIXEL_FONT}; font-size: 84px; line-height: 1; letter-spacing: 6px;
  transform: rotate(-4deg) skewX(-8deg); position: relative; }
.or-logo span { display: inline-block; color: #ffd23a;
  text-shadow: 0 -3px 0 #fff6b0, 3px 3px 0 #e07a10, 6px 6px 0 #a8420c, 9px 9px 0 #5a1c06, 12px 12px 0 #000,
    -3px 0 0 #000, 0 3px 0 #000, 3px 0 0 #000, 0 -6px 0 #000; }
.or-logo span:nth-child(odd) { transform: translateY(-4px); }
.or-logo .sp { width: .5em; }
.or-title .tag { margin-top: 26px; font-size: 13px; letter-spacing: 4px; color: #7fd8ff; }
.or-title .tag b { color: #fff; font-weight: normal; }
.or-title .bottom { padding: 34px 0 16px; text-align: center;
  background: linear-gradient(rgba(6,22,40,0), rgba(6,22,40,.82) 25%, rgba(6,22,40,.95)); }
.or-title .menu { display: inline-flex; flex-direction: column; gap: 12px; text-align: left; font-size: 16px; margin-bottom: 18px; }
.or-title .menu div { padding-left: 34px; position: relative; color: #9fb4c8; }
.or-title .menu div.sel { color: #ffe14a; }
.or-title .menu div.sel::before { content: '\\25B6'; position: absolute; left: 0; color: #ff5a4a; }
.or-title .menu div small { display: block; font-size: 9px; color: #9fb4c8; margin-top: 6px; }
.or-title .press { font-size: 18px; color: #fff; margin-bottom: 18px; }
.or-title .credits { font-size: 9px; line-height: 2; color: #b9c8d8; }
.or-title .attract { position: absolute; inset: 0; display: none; background: rgba(8,30,52,.94); padding: 40px 10%; }
.or-title.hints .attract { display: block; }
`;

export interface TitleOpts {
  /** A saved season to continue: one line about it ("ACE · RACE 4 · $180,000"). */
  save: string | null;
  onNew(): void;
  onContinue(): void;
}

/** Seconds on the logo before the attract loop shows the hints, and how long they stay. */
const ATTRACT_IDLE = 16;
const ATTRACT_HINTS = 10;

export class TitleScreen implements Screen {
  readonly el = screenEl('or-title', false);
  private sel = 0;
  private idle = 0;
  private items: { id: 'new' | 'continue'; html: string }[];

  constructor(private o: TitleOpts) {
    addStyle('or-title-css', CSS);
    this.items = [
      ...(o.save ? [{ id: 'continue' as const, html: `CONTINUE SEASON<small>${o.save}</small>` }] : []),
      { id: 'new', html: 'NEW SEASON' },
    ];
    const logo = [...'OFF ROAD'].map((ch) => (ch === ' ' ? '<span class="sp"></span>' : `<span>${ch}</span>`)).join('');
    this.el.innerHTML = `
      <div class="top"><div class="or-logo">${logo}</div>
        <div class="tag">STADIUM <b>4X4</b> TRUCK RACING</div></div>
      <div class="bottom">
        <div class="menu"></div>
        <div class="press blink">PRESS START</div>
        <div class="credits">KEYS: ARROWS / WASD &middot; ENTER / SPACE &middot; ESC &nbsp;&nbsp; PAD: D-PAD &middot; A &middot; B<br>
          MADE BY THE OFF ROAD CONTRIBUTORS &middot; ALL TRACKS, ART AND MUSIC OUR OWN<br>&copy; 2026 Off Road contributors</div>
      </div>
      <div class="attract">${hintsHtml()}</div>`;
    this.draw();
  }

  get selected() {
    return this.items[this.sel].id;
  }

  private draw() {
    this.el.querySelector('.menu')!.innerHTML = this.items.map((it, i) => `<div class="${i === this.sel ? 'sel' : ''}" data-id="${it.id}">${it.html}</div>`).join('');
  }

  input(e: MenuEvent) {
    const wasAttract = this.el.classList.contains('hints');
    this.idle = 0;
    this.el.classList.remove('hints');
    if (wasAttract) return;
    if (e.key === 'up' || e.key === 'down') {
      this.sel = (this.sel + (e.key === 'up' ? -1 : 1) + this.items.length) % this.items.length;
      this.draw();
    } else if (e.key === 'confirm') {
      if (this.selected === 'continue') this.o.onContinue();
      else this.o.onNew();
    }
  }

  tick(dt: number) {
    this.idle += dt;
    const hints = this.idle > ATTRACT_IDLE && this.idle < ATTRACT_IDLE + ATTRACT_HINTS;
    this.el.classList.toggle('hints', hints);
    if (this.idle >= ATTRACT_IDLE + ATTRACT_HINTS) this.idle = 0;
  }

  dispose() {
    this.el.remove();
  }
}
