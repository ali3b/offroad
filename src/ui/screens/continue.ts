// Out of credits: CONTINUE? with a 9 → 0 countdown in each out player's panel (local multiplayer: every human out of
// credits gets their own countdown, at the same time). Continuing resets that player's cash to $0 and keeps the
// upgrades; giving up (Esc / (B), or the countdown running out) drops them: their colour races on as a CPU truck.
// The other humans wait in their panels. Then GAME OVER (once nobody is left) and back to the title.
import { addStyle } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { CONTINUE_SECONDS, money } from '../../game/economy';
import type { PlayerState } from '../../game/season';
import { CPU_DRIVERS, PLAYER_COLOURS } from '../../race/roster';
import { banner, esc, PANEL, screenEl, type Screen } from './common';

const CSS = `
.or-cont .panel .digit { font-size: 120px; color: #ffe14a; line-height: 1.1;
  text-shadow: 5px 5px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000; }
.or-cont .panel .q { font-size: 24px; }
.or-cont .panel .res { font-size: 20px; line-height: 1.6; color: #4cff5a; }
.or-cont .panel .res.out { color: #ff5a4a; }
.or-cont .panel.off { filter: saturate(.3) brightness(.5); }
.or-cont .panel.wait { filter: saturate(.7) brightness(.8); }
.or-over { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; }
.or-over .big { font-size: 64px; color: #ff5a4a; letter-spacing: 6px; text-shadow: 6px 6px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000; }
.or-over .stats { font-size: 14px; line-height: 2.2; text-align: center; color: #ffe14a; }
.or-cont .tbtns { display: flex; gap: 10px; margin-top: auto; }
.or-cont .tb { min-height: 46px; min-width: 110px; padding: 0 12px; display: flex; align-items: center; justify-content: center; font-size: 11px;
  border: 3px solid #000; box-shadow: inset 0 0 0 2px rgba(255,255,255,.3), 3px 3px 0 rgba(0,0,0,.45); color: #fff; background: #1b1b22; }
.or-cont .tb.ok { background: #1d7a2a; }
@media (max-height: 560px) {
  .or-cont .panel .digit { font-size: 64px; }
  .or-cont .panel .q { font-size: 15px; }
  .or-cont .panel .res { font-size: 14px; }
  .or-cont .tb { min-height: 42px; min-width: 90px; font-size: 9px; }
  .or-over .big { font-size: 40px; } .or-over .stats { font-size: 10px; } .or-over { gap: 18px; }
}
`;

export type ContinueChoice = 'continue' | 'out';

export class ContinueScreen implements Screen {
  readonly el = screenEl('or-cont');
  /** Seconds left on each out player's countdown (index = player). */
  readonly left: Record<number, number> = {};
  /** What each out player chose. */
  readonly choice: Record<number, ContinueChoice> = {};
  private done = false;

  constructor(private o: { players: PlayerState[]; out: number[]; onDone(choices: Record<number, ContinueChoice>): void }) {
    addStyle('or-cont-css', CSS);
    for (const i of o.out) this.left[i] = CONTINUE_SECONDS + 0.999;
    this.draw();
  }

  /** Back-compat (one player): player 1's countdown. */
  get seconds() {
    return this.left[this.o.out[0]] ?? 0;
  }

  private draw() {
    const { players, out } = this.o;
    const many = players.length > 1;
    const panels = PLAYER_COLOURS.map((c) => {
      const i = players.findIndex((p) => p.colour === c);
      const bg = `background:${PANEL[c].bg};color:${PANEL[c].text}`;
      if (i < 0) return `<div class="panel off" style="background:${PANEL[c].bg}"></div>`;
      const p = players[i];
      const head = `<div class="who">PLAYER ${i + 1}<br>${esc(p.initials)}</div>`;
      if (!out.includes(i)) return `<div class="panel wait" data-player="${i + 1}" style="${bg}">${head}<div class="small">CREDITS ${p.credits}<br><br>WAITING&hellip;</div></div>`;
      const ch = this.choice[i];
      if (ch)
        return `<div class="panel me" data-player="${i + 1}" style="${bg}">${head}<div class="res${ch === 'out' ? ' out' : ''}">${
          ch === 'continue' ? 'CONTINUE!<br>3 CREDITS' : `GAME OVER${many ? `<br><span class="small">${CPU_DRIVERS[c].nick} TAKES<br>THE WHEEL</span>` : ''}`
        }</div></div>`;
      const ok = many ? 'START OR (A)' : 'ENTER OR (A)';
      return `<div class="panel me" data-player="${i + 1}" style="${bg}">${head}
            <div class="q">CONTINUE?</div><div class="digit" data-player="${i + 1}">${Math.max(0, Math.floor(this.left[i]))}</div>
            <div class="small"><span class="kb-only">PRESS ${ok}<br><br></span>CASH GOES BACK TO $0<br>(YOU HAVE ${money(p.cash)})<br>UPGRADES STAY</div>
            ${i === 0 ? `<div class="tbtns touch-only"><div class="tb" data-tap="cont:out">GIVE UP</div><div class="tb ok pulse" data-tap="cont:continue">CONTINUE</div></div>` : ''}</div>`;
    }).join('');
    this.el.innerHTML = `${banner('OUT OF <i>CREDITS</i>')}<div class="panels">${panels}</div>`;
  }

  private decide(i: number, ch: ContinueChoice) {
    if (this.choice[i] || this.done) return;
    this.choice[i] = ch;
    this.draw();
    if (this.o.out.every((k) => this.choice[k])) {
      this.done = true;
      this.o.onDone({ ...this.choice });
    }
  }

  input(e: MenuEvent) {
    // A press belongs to its player (the flow fills that in); else to the first player still deciding.
    const i = e.player ?? this.o.out.find((k) => !this.choice[k]);
    if (i === undefined || !this.o.out.includes(i)) return;
    // Taps are player 1's (the CONTINUE / GIVE UP buttons sit in their panel).
    if (e.tap === 'cont:continue') this.decide(i, 'continue');
    else if (e.tap === 'cont:out') this.decide(i, 'out');
    else if (e.key === 'confirm') this.decide(i, 'continue');
    else if (e.key === 'back') this.decide(i, 'out');
  }

  tick(dt: number) {
    for (const i of this.o.out) {
      if (this.choice[i]) continue;
      const before = Math.floor(this.left[i]);
      this.left[i] -= dt;
      if (this.left[i] <= 0) this.decide(i, 'out');
      else if (Math.floor(this.left[i]) !== before) {
        const el = this.el.querySelector(`.digit[data-player="${i + 1}"]`);
        if (el) el.textContent = String(Math.max(0, Math.floor(this.left[i])));
      }
    }
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
      <div class="blink" style="font-size:12px"><span class="kb-only">PRESS START</span><span class="touch-only">TAP TO GO ON</span></div>`;
    this.el.dataset.tap = 'over';
  }

  input(e: MenuEvent) {
    if (e.key === 'confirm' || e.key === 'back' || e.tap === 'over') this.o.onDone();
  }

  tick(dt: number) {
    this.t += dt;
    if (this.t > 6) this.o.onDone();
  }

  dispose() {
    this.el.remove();
  }
}
