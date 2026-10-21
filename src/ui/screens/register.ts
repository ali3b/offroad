// Driver sign-up in the three colour panels (red, yellow, blue): three initials entered arcade style, then the truck
// colour (moving the sign-up card between the panels). The panels nobody signed into show the CPU driver who takes
// that colour. One human for now; the panels are laid out for up to three (local multiplayer, OR4).
// Also the "GET READY!" screen shown before every season race.
import { addStyle } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { CPU_DRIVERS, HEX, PLAYER_COLOURS, type Colour } from '../../race/roster';
import type { TrackData } from '../../track/types';
import { banner, esc, PANEL, screenEl, trophyIcon, truckIcon, type Screen } from './common';
import { trackThumb } from './track-thumb';

const CSS = `
.or-reg .panel .initials { display: flex; gap: 10px; }
.or-reg .panel .initials span { width: 54px; height: 64px; display: flex; align-items: center; justify-content: center; font-size: 34px;
  background: #0b0f22; border: 3px solid #000; color: #fff; }
.or-reg .panel .initials span.cur { border-color: #ffe14a; color: #ffe14a; animation: or-reg-cur .8s steps(2) infinite; }
@keyframes or-reg-cur { 50% { color: #0b0f22; } }
.or-reg .panel .initials.done span { color: #ffe14a; }
.or-reg .panel .step { font-size: 12px; line-height: 1.9; }
.or-reg .panel .help { font-size: 9px; line-height: 2; opacity: .95; margin-top: auto; }
.or-reg .panel.cpu { filter: saturate(.55) brightness(.75); }
.or-reg .panel .arrows { font-size: 22px; color: #fff; }
.or-reg .boss { position: absolute; left: 0; right: 0; bottom: 10px; text-align: center; font-size: 9px; color: #c9ccd2; }
.or-ready .panel .go { font-size: 30px; color: #ffe14a; line-height: 1.5; }
.or-ready .panel canvas { border: 3px solid #000; width: 100%; max-width: 300px; height: auto; image-rendering: pixelated; }
`;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
export const DEFAULT_INITIALS = 'ACE';

function cpuPanel(c: Colour) {
  const d = CPU_DRIVERS[c];
  return `<div class="panel cpu" style="background:${PANEL[c].bg};color:${PANEL[c].text}">
    <div class="who">CPU DRIVER</div>${truckIcon(HEX[c])}<div class="who">${d.nick}<br><span class="small">${d.name}</span></div>${trophyIcon()}</div>`;
}

export class RegisterScreen implements Screen {
  readonly el = screenEl('or-reg');
  private letters: string[];
  private cur = 0;
  private step: 'initials' | 'colour' = 'initials';
  private colour: Colour;

  constructor(
    private o: { initials?: string; colour?: Colour; onDone(p: { initials: string; colour: Colour }): void; onBack(): void },
  ) {
    addStyle('or-reg-css', CSS);
    this.letters = [...(o.initials ?? DEFAULT_INITIALS).padEnd(3).slice(0, 3)];
    this.colour = o.colour ?? 'red';
    this.draw();
  }

  get initials() {
    return this.letters.join('').trimEnd() || DEFAULT_INITIALS;
  }

  private draw() {
    const panels = PLAYER_COLOURS.map((c) => {
      if (c !== this.colour) return cpuPanel(c);
      const p = PANEL[c];
      const boxes = this.letters.map((l, i) => `<span class="${this.step === 'initials' && i === this.cur ? 'cur' : ''}">${l === ' ' ? '&nbsp;' : esc(l)}</span>`).join('');
      const body =
        this.step === 'initials'
          ? `<div class="step">ENTER YOUR<br>INITIALS</div><div class="initials">${boxes}</div>
             <div class="help"><span class="key">UP/DOWN</span> LETTER<br><span class="key">LEFT/RIGHT</span> MOVE<br>OR TYPE A-Z<br><span class="key">ENTER / (A)</span> OK &nbsp; <span class="key">ESC / (B)</span> BACK</div>`
          : `<div class="initials done">${boxes}</div><div class="step">PICK YOUR TRUCK</div>
             <div class="arrows">&#9664; ${truckIcon(HEX[c])} &#9654;</div>
             <div class="help"><span class="key">LEFT/RIGHT</span> COLOUR<br><span class="key">ENTER / (A)</span> RACE! &nbsp; <span class="key">ESC / (B)</span> BACK</div>`;
      return `<div class="panel me" data-colour="${c}" style="background:${p.bg};color:${p.text}"><div class="who">PLAYER 1</div>${body}</div>`;
    }).join('');
    const boss = CPU_DRIVERS.grey;
    this.el.innerHTML = `${banner('DRIVER <i>SIGN-UP</i>')}<div class="panels">${panels}</div>
      <div class="boss">THE GREY TRUCK IS ALWAYS ${boss.nick} ${boss.name.toUpperCase()}, THE CPU BOSS</div>`;
  }

  input(e: MenuEvent) {
    if (this.step === 'initials') {
      if (e.letter && !e.key?.match(/confirm|back/)) {
        // Typed letters win over WASD navigation while entering initials.
        this.letters[this.cur] = e.letter;
        this.cur = Math.min(2, this.cur + 1);
      } else if (e.key === 'up' || e.key === 'down') {
        const i = LETTERS.indexOf(this.letters[this.cur]);
        this.letters[this.cur] = LETTERS[(i + (e.key === 'up' ? 1 : -1) + LETTERS.length) % LETTERS.length];
      } else if (e.key === 'left') this.cur = Math.max(0, this.cur - 1);
      else if (e.key === 'right') this.cur = Math.min(2, this.cur + 1);
      else if (e.key === 'confirm') {
        if (this.cur < 2) this.cur++;
        else this.step = 'colour';
      } else if (e.key === 'back') {
        if (this.cur > 0) this.cur--;
        else return this.o.onBack();
      }
    } else {
      if (e.key === 'left' || e.key === 'right') {
        const i = PLAYER_COLOURS.indexOf(this.colour);
        this.colour = PLAYER_COLOURS[(i + (e.key === 'left' ? -1 : 1) + PLAYER_COLOURS.length) % PLAYER_COLOURS.length];
      } else if (e.key === 'confirm') return this.o.onDone({ initials: this.initials, colour: this.colour });
      else if (e.key === 'back') {
        this.step = 'initials';
        this.cur = 2;
      }
    }
    this.draw();
  }

  dispose() {
    this.el.remove();
  }
}

/** "GET READY!": the player's panel with the next track, the CPU drivers in theirs. */
export class GetReadyScreen implements Screen {
  readonly el = screenEl('or-reg or-ready');

  constructor(o: { players: { initials: string; colour: Colour }[]; track: TrackData; trackName: string; raceNo: number }) {
    addStyle('or-reg-css', CSS);
    const mine = new Map(o.players.map((p, i) => [p.colour, { ...p, n: i + 1 }]));
    const panels = PLAYER_COLOURS.map((c) => {
      const p = mine.get(c);
      if (!p) return cpuPanel(c);
      return `<div class="panel me" style="background:${PANEL[c].bg};color:${PANEL[c].text}"><div class="who">PLAYER ${p.n}<br>${esc(p.initials)}</div>
        <div class="go blink">GET<br>READY!</div><div class="thumb"></div><div class="step">${esc(o.trackName.toUpperCase())}</div></div>`;
    }).join('');
    this.el.innerHTML = `${banner(`RACE <i>${o.raceNo}</i>`)}<div class="panels">${panels}</div>`;
    this.el.querySelector('.thumb')?.appendChild(trackThumb(o.track, 300, 180));
  }

  input() {}

  dispose() {
    this.el.remove();
  }
}
