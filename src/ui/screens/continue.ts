// Out of credits: CONTINUE? with a 9 → 0 countdown in the player's panel (continuing resets the cash to $0, the
// upgrades stay), then GAME OVER and back to the title.
import { addStyle } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { CONTINUE_SECONDS, money } from '../../game/economy';
import type { PlayerState } from '../../game/season';
import { PLAYER_COLOURS } from '../../race/roster';
import { banner, esc, PANEL, screenEl, type Screen } from './common';

const CSS = `
.or-cont .panel .digit { font-size: 120px; color: #ffe14a; line-height: 1.1;
  text-shadow: 5px 5px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000; }
.or-cont .panel .q { font-size: 24px; }
.or-cont .panel.off { filter: saturate(.3) brightness(.5); }
.or-over { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; }
.or-over .big { font-size: 64px; color: #ff5a4a; letter-spacing: 6px; text-shadow: 6px 6px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000; }
.or-over .stats { font-size: 14px; line-height: 2.2; text-align: center; color: #ffe14a; }
`;

export class ContinueScreen implements Screen {
  readonly el = screenEl('or-cont');
  /** Seconds left on the countdown. */
  left = CONTINUE_SECONDS + 0.999;
  private shown = -1;

  constructor(private o: { player: PlayerState; onContinue(): void; onGiveUp(): void }) {
    addStyle('or-cont-css', CSS);
    const p = o.player;
    const panels = PLAYER_COLOURS.map((c) =>
      c === p.colour
        ? `<div class="panel me" style="background:${PANEL[c].bg};color:${PANEL[c].text}"><div class="who">PLAYER 1<br>${esc(p.initials)}</div>
            <div class="q">CONTINUE?</div><div class="digit">${CONTINUE_SECONDS}</div>
            <div class="small">PRESS ENTER OR (A)<br><br>CASH GOES BACK TO $0<br>(YOU HAVE ${money(p.cash)})<br>UPGRADES STAY</div></div>`
        : `<div class="panel off" style="background:${PANEL[c].bg}"></div>`,
    ).join('');
    this.el.innerHTML = `${banner('OUT OF <i>CREDITS</i>')}<div class="panels">${panels}</div>`;
  }

  input(e: MenuEvent) {
    if (e.key === 'confirm') this.o.onContinue();
    else if (e.key === 'back') this.o.onGiveUp();
  }

  tick(dt: number) {
    this.left -= dt;
    const d = Math.max(0, Math.floor(this.left));
    if (d !== this.shown) {
      this.shown = d;
      const el = this.el.querySelector('.digit');
      if (el) el.textContent = String(d);
    }
    if (this.left <= 0) this.o.onGiveUp();
  }

  dispose() {
    this.el.remove();
  }
}

export class GameOverScreen implements Screen {
  readonly el = screenEl('or-over');
  private t = 0;

  constructor(private o: { races: number; initials: string; onDone(): void }) {
    addStyle('or-cont-css', CSS);
    this.el.innerHTML = `<div class="big">GAME OVER</div>
      <div class="stats">${esc(o.initials)} RACED ${o.races} RACE${o.races === 1 ? '' : 'S'}<br>THANKS FOR PLAYING!</div>
      <div class="blink" style="font-size:12px">PRESS START</div>`;
  }

  input(e: MenuEvent) {
    if (e.key === 'confirm' || e.key === 'back') this.o.onDone();
  }

  tick(dt: number) {
    this.t += dt;
    if (this.t > 6) this.o.onDone();
  }

  dispose() {
    this.el.remove();
  }
}
