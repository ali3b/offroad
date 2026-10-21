// Driver sign-up in the three colour panels (red, yellow, blue), like the original's join screen: up to three humans
// (local multiplayer). Each joins by pressing their accelerate / start key on the keyboard side they drive with
// (W or Left Shift / Space: the WASD player; Up, Enter or Right Ctrl: the arrows player) or (A) on a pad, enters three
// initials arcade style, picks a free colour panel and confirms (READY). Panels nobody joined say PRESS START TO JOIN
// and show the CPU driver who takes that colour. A ready player's start key starts the season once every joined
// player is ready (at least one). Also the "GET READY!" screen shown before every season race.
import { addStyle } from '../pixel';
import { KEY_SCHEMES, type MenuEvent, type MenuKey, type MenuSrc } from '../../engine/input';
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
.or-reg .panels { padding-bottom: 64px; }
.or-reg .panel .dev { font-size: 8px; padding: 4px 6px; background: rgba(0,0,0,.45); border: 2px solid #000; letter-spacing: 1px; color: #fff; }
.or-reg .panel[data-colour="yellow"] .key { color: #fff; }
.or-reg .panel.cpu { filter: saturate(.55) brightness(.75); }
.or-reg .panel.open { filter: none; }
.or-reg .panel.open > :not(.join) { filter: saturate(.55) brightness(.75); }
.or-reg .panel .join { font-size: 16px; line-height: 1.7; color: #fff; text-shadow: 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000; animation: or-reg-join 1.2s steps(2) infinite; }
@keyframes or-reg-join { 50% { opacity: .45; } }
.or-reg .panel .ready { font-size: 22px; color: #4cff5a; line-height: 1.5; }
.or-reg .panel .arrows { font-size: 22px; color: #fff; }
.or-reg .foot { bottom: 30px; font-size: 10px; line-height: 1.8; }
.or-reg .foot.go { color: #4cff5a; font-size: 14px; }
.or-reg .boss { position: absolute; left: 0; right: 0; bottom: 10px; text-align: center; font-size: 9px; color: #c9ccd2; }
.or-ready .panel .go { font-size: 30px; color: #ffe14a; line-height: 1.5; }
.or-ready .panel canvas { border: 3px solid #000; width: 100%; max-width: 300px; height: auto; image-rendering: pixelated; }
.or-reg .lp { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.or-reg .lp .row { display: flex; gap: 10px; }
.or-reg .lp .ar { width: 54px; height: 38px; display: flex; align-items: center; justify-content: center; font-size: 16px;
  background: rgba(0,0,0,.38); border: 3px solid #000; box-shadow: inset 0 0 0 2px rgba(255,255,255,.3); color: #fff; }
.or-reg .lp .ar:active { background: rgba(255,255,255,.35); }
.or-reg .tbtns { display: flex; gap: 10px; margin-top: auto; }
.or-reg .tb { min-height: 44px; min-width: 96px; padding: 0 12px; display: flex; align-items: center; justify-content: center; font-size: 11px;
  background: #1b1b22; border: 3px solid #000; box-shadow: inset 0 0 0 2px rgba(255,255,255,.3), 3px 3px 0 rgba(0,0,0,.45); color: #fff; }
.or-reg .tb.ok { background: #1d7a2a; }
.or-reg .tb.big { font-size: 13px; min-width: 150px; }
.or-reg .tb.leave { position: absolute; z-index: 2; left: calc(env(safe-area-inset-left) + 10px); top: 18px; }
@media (max-height: 560px) { .or-reg .tb.leave { top: 2px; min-height: 38px; } }
.or-reg .arrows .ar { display: inline-flex; width: 48px; height: 48px; align-items: center; justify-content: center; vertical-align: middle;
  background: rgba(0,0,0,.38); border: 3px solid #000; box-shadow: inset 0 0 0 2px rgba(255,255,255,.3); }
.or-reg .arrows .truck-ico { vertical-align: middle; }
.or-reg .panel.open .tapjoin { font-size: 15px; line-height: 1.7; color: #fff; text-shadow: 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000;
  animation: or-reg-join 1.2s steps(2) infinite; }
.or-reg .panel.open .tappick { font-size: 11px; line-height: 1.8; color: #fff; }
@media (max-height: 560px) {
  .or-reg .panels { padding: 8px 12px 26px; gap: 10px; }
  .or-reg .panel { padding: 8px 6px; gap: 6px; }
  .or-reg .panel .who { font-size: 10px; line-height: 1.5; }
  .or-reg .panel .step { font-size: 8px; line-height: 1.6; }
  .or-reg .panel .initials { gap: 8px; }
  .or-reg .panel .initials span { width: 44px; height: 44px; font-size: 24px; }
  .or-reg .lp .ar { width: 44px; height: 34px; font-size: 12px; }
  .or-reg .lp .row { gap: 8px; }
  .or-reg .panel .help { font-size: 7px; line-height: 1.8; }
  .or-reg .panel .join, .or-reg .panel.open .tapjoin { font-size: 11px; }
  .or-reg .panel .ready { font-size: 16px; }
  .or-reg .truck-ico { width: 84px; height: 45px; }
  .or-reg .panel .trophy { width: 22%; }
  .or-reg .foot { bottom: 12px; font-size: 7px; } .or-reg .foot.go { font-size: 10px; }
  .or-reg .boss { display: none; }
  .or-reg .tb { min-height: 42px; min-width: 84px; font-size: 9px; } .or-reg .tb.big { font-size: 11px; min-width: 120px; }
  .or-reg .arrows .ar { width: 44px; height: 44px; }
  .or-ready .panel .go { font-size: 18px; }
  .or-ready .panel canvas { max-width: 200px; }
}
`;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
export const DEFAULT_INITIALS = 'ACE';
/** Default initials per join order (else last season's). */
const DEFAULTS = [DEFAULT_INITIALS, 'JET', 'MAX'];

function cpuPanel(c: Colour) {
  const d = CPU_DRIVERS[c];
  return `<div class="panel cpu" style="background:${PANEL[c].bg};color:${PANEL[c].text}">
    <div class="who">CPU DRIVER</div>${truckIcon(HEX[c])}<div class="who">${d.nick}<br><span class="small">${d.name}</span></div>${trophyIcon()}</div>`;
}

/**
 * An open panel at the sign-up: PRESS START TO JOIN over the CPU driver who takes it otherwise. By touch: TAP TO
 * JOIN when nobody joined yet (a touch player is player 1), or TAP TO PICK while the touch player picks a colour.
 */
function openPanel(c: Colour, touch: 'join' | 'pick' | null) {
  const d = CPU_DRIVERS[c];
  const tap = touch === 'join' ? `data-tap="join:${c}"` : touch === 'pick' ? `data-tap="pick:${c}"` : '';
  const tapText = touch === 'join' ? '<div class="tapjoin touch-only">TAP TO<br>JOIN</div>' : touch === 'pick' ? '<div class="tappick touch-only">TAP TO PICK<br>THIS TRUCK</div>' : '';
  return `<div class="panel cpu open" data-colour="${c}" ${tap} style="background:${PANEL[c].bg};color:${PANEL[c].text}">
    <div class="kb-only join">PRESS START<br>TO JOIN</div>${tapText}
    <div class="small kb-only">W / L.SHIFT &middot; &uarr; / ENTER<br>OR (A) ON A PAD</div>
    ${truckIcon(HEX[c])}<div class="who"><span class="small">ELSE CPU</span><br>${d.nick}<br><span class="small">${d.name}</span></div>${trophyIcon()}</div>`;
}

/** One joined player's sign-up card. */
interface Card {
  src: MenuSrc;
  colour: Colour;
  letters: string[];
  cur: number;
  step: 'initials' | 'colour' | 'ready';
}

/** A signed-up human: initials, colour and the device they joined with ('wasd' / 'arrows' / 'padN'; 'kb' = tests). */
export interface SignUp {
  initials: string;
  colour: Colour;
  src: MenuSrc;
}

const KEYBOARD: MenuSrc[] = ['wasd', 'arrows', 'kb'];

function deviceLabel(src: MenuSrc, alone: boolean) {
  if (src === 'touch') return 'TOUCH SCREEN';
  if (src.startsWith('pad')) return `GAMEPAD ${Number(src.slice(3)) + 1}`;
  if (alone) return KEY_SCHEMES.solo.label;
  return src === 'wasd' ? KEY_SCHEMES.wasd.label : src === 'arrows' ? KEY_SCHEMES.arrows.label : 'KEYBOARD';
}

export class RegisterScreen implements Screen {
  readonly el = screenEl('or-reg');
  /** Joined players in join order (player 1, 2, 3). */
  readonly cards: Card[] = [];

  constructor(
    private o: { last?: { initials: string; colour: Colour }[]; onDone(players: SignUp[]): void; onBack(): void },
  ) {
    addStyle('or-reg-css', CSS);
    this.draw();
  }

  /** The sign-ups so far (tests, the flow). */
  get players(): SignUp[] {
    return this.cards.map((c) => ({ initials: c.letters.join('').trimEnd() || DEFAULT_INITIALS, colour: c.colour, src: c.src }));
  }

  /** Back-compat: the first player's initials. */
  get initials() {
    return this.players[0]?.initials ?? DEFAULT_INITIALS;
  }

  private free(c: Colour, except?: Card) {
    return !this.cards.some((x) => x !== except && x.colour === c);
  }

  private join(src: MenuSrc) {
    if (this.cards.length >= PLAYER_COLOURS.length) return;
    const k = this.cards.length;
    const last = this.o.last?.[k];
    const colour = last && this.free(last.colour) ? last.colour : PLAYER_COLOURS.find((c) => this.free(c))!;
    const initials = last?.initials ?? DEFAULTS[k] ?? DEFAULT_INITIALS;
    this.cards.push({ src, colour, letters: [...initials.padEnd(3).slice(0, 3)], cur: 0, step: 'initials' });
  }

  /** The keyboard card that typed letters go to: the first one still entering initials. */
  private typing() {
    return this.cards.find((c) => c.step === 'initials' && KEYBOARD.includes(c.src));
  }

  private type(c: Card, letter: string) {
    c.letters[c.cur] = letter;
    c.cur = Math.min(2, c.cur + 1);
  }

  private draw() {
    const alone = this.cards.length <= 1;
    const touchCard = this.cards.find((c) => c.src === 'touch');
    const openTouch = !this.cards.length ? 'join' : touchCard && touchCard.step !== 'ready' ? 'pick' : null;
    const panels = PLAYER_COLOURS.map((c) => {
      const i = this.cards.findIndex((x) => x.colour === c);
      if (i < 0) return openPanel(c, openTouch);
      const card = this.cards[i];
      const p = PANEL[c];
      const boxes = card.letters.map((l, j) => `<span class="${card.step === 'initials' && j === card.cur ? 'cur' : ''}">${l === ' ' ? '&nbsp;' : esc(l)}</span>`).join('');
      if (card.src === 'touch') return this.touchPanel(card, i, boxes);
      const pad = card.src.startsWith('pad');
      // The card's own start key.
      const ok = pad ? '(A)' : alone || card.src !== 'wasd' ? 'ENTER' : 'L.SHIFT';
      const body =
        card.step === 'initials'
          ? `<div class="step">ENTER YOUR<br>INITIALS</div><div class="initials">${boxes}</div>
             <div class="help"><span class="key">UP/DOWN</span> LETTER<br><span class="key">LEFT/RIGHT</span> MOVE${pad ? '' : '<br>OR TYPE A-Z'}<br><span class="key">${ok}</span> OK &nbsp; <span class="key">${pad ? '(B)' : 'ESC'}</span> BACK</div>`
          : card.step === 'colour'
            ? `<div class="initials done">${boxes}</div><div class="step">PICK YOUR TRUCK</div>
             <div class="arrows">&#9664; ${truckIcon(HEX[c])} &#9654;</div>
             <div class="help"><span class="key">LEFT/RIGHT</span> COLOUR<br><span class="key">${ok}</span> READY &nbsp; <span class="key">${pad ? '(B)' : 'ESC'}</span> BACK</div>`
            : `<div class="initials done">${boxes}</div>${truckIcon(HEX[c])}<div class="ready">READY!</div>
             <div class="help">PRESS <span class="key">${ok}</span> TO RACE<br><span class="key">${pad ? '(B)' : 'ESC'}</span> CHANGE</div>`;
      return `<div class="panel me" data-colour="${c}" data-player="${i + 1}" style="background:${p.bg};color:${p.text}"><div class="who">PLAYER ${i + 1}</div>
        <div class="dev">${deviceLabel(card.src, alone)}</div>${body}</div>`;
    }).join('');
    const boss = CPU_DRIVERS.grey;
    const allReady = this.cards.length > 0 && this.cards.every((c) => c.step === 'ready');
    const foot = allReady
      ? `<div class="foot go blink">ALL SET! <span class="kb-only">PRESS START</span><span class="touch-only">TAP START</span> TO RACE</div>`
      : `<div class="foot"><span class="kb-only">UP TO 3 PLAYERS &middot; JOIN WITH <span class="key">W</span> OR <span class="key">L.SHIFT</span> (WASD), <span class="key">&uarr;</span> OR <span class="key">ENTER</span> (ARROWS), <span class="key">(A)</span> ON A PAD</span>
        <span class="touch-only">${this.cards.length ? 'MORE PLAYERS JOIN WITH KEYS OR PADS' : 'TAP A TRUCK TO JOIN &middot; MORE PLAYERS JOIN WITH KEYS OR PADS'}</span></div>`;
    const leave = !this.cards.length ? '<div class="tb leave touch-only" data-tap="leave">&#9664; BACK</div>' : '';
    this.el.innerHTML = `${banner('DRIVER <i>SIGN-UP</i>')}${leave}<div class="panels">${panels}</div>${foot}
      <div class="boss">THE GREY TRUCK IS ALWAYS ${boss.nick} ${boss.name.toUpperCase()}, THE CPU BOSS</div>`;
  }

  /** The touch player's card: the letter picker (▲ / ▼ per letter), the colour arrows, OK / READY / START buttons. */
  private touchPanel(card: Card, i: number, boxes: string) {
    const c = card.colour;
    const head = `<div class="who">PLAYER ${i + 1}</div><div class="dev">${deviceLabel('touch', true)}</div>`;
    let body: string;
    if (card.step === 'initials') {
      const arrows = (dir: 'up' | 'down') =>
        `<div class="row">${[0, 1, 2].map((j) => `<div class="ar" data-tap="${dir}:${j}" data-repeat>${dir === 'up' ? '&#9650;' : '&#9660;'}</div>`).join('')}</div>`;
      const letters = card.letters
        .map((l, j) => `<span class="${j === card.cur ? 'cur' : ''}" data-tap="cur:${j}">${l === ' ' ? '&nbsp;' : esc(l)}</span>`)
        .join('');
      body = `<div class="step">YOUR INITIALS</div><div class="lp">${arrows('up')}<div class="initials">${letters}</div>${arrows('down')}</div>
        <div class="tbtns"><div class="tb" data-tap="back">&#9664; BACK</div><div class="tb ok" data-tap="ok">OK &#9654;</div></div>`;
    } else if (card.step === 'colour') {
      body = `<div class="initials done">${boxes}</div><div class="step">PICK YOUR TRUCK</div>
        <div class="arrows"><span class="ar" data-tap="colour:-1">&#9664;</span> ${truckIcon(HEX[c])} <span class="ar" data-tap="colour:1">&#9654;</span></div>
        <div class="tbtns"><div class="tb" data-tap="back">&#9664; BACK</div><div class="tb ok" data-tap="ok">READY &#9654;</div></div>`;
    } else {
      const all = this.cards.every((x) => x.step === 'ready');
      body = `<div class="initials done">${boxes}</div>${truckIcon(HEX[c])}<div class="ready">READY!</div>
        <div class="tbtns"><div class="tb" data-tap="back">CHANGE</div>${all ? '<div class="tb ok big pulse" data-tap="ok">START &#9654;</div>' : '<div class="tb">WAITING&hellip;</div>'}</div>`;
    }
    return `<div class="panel me" data-colour="${c}" data-player="${i + 1}" style="background:${PANEL[c].bg};color:${PANEL[c].text}">${head}${body}</div>`;
  }

  input(e: MenuEvent) {
    if (e.tap) this.tap(e.tap);
    else this.handle(e);
    this.draw();
  }

  /** A tap (touch is always player 1, so it only joins when nobody has). */
  private tap(t: string) {
    const [what, arg] = t.split(':');
    if (what === 'leave') return this.o.onBack();
    if (what === 'join') {
      if (this.cards.length) return;
      this.join('touch');
      if (PLAYER_COLOURS.includes(arg as Colour)) this.cards[0].colour = arg as Colour;
      return;
    }
    const card = this.cards.find((c) => c.src === 'touch');
    if (!card) return;
    const j = Number(arg);
    if (what === 'up' || what === 'down') {
      if (card.step !== 'initials') return;
      card.cur = j;
      this.cardInput(card, what);
    } else if (what === 'cur') {
      if (card.step === 'initials') card.cur = j;
    } else if (what === 'colour') {
      if (card.step === 'colour') this.cardInput(card, j < 0 ? 'left' : 'right');
    } else if (what === 'pick') {
      const c = arg as Colour;
      if (card.step !== 'ready' && this.free(c, card)) card.colour = c;
    } else if (what === 'ok') {
      if (card.step === 'initials') card.step = 'colour';
      else this.cardInput(card, 'confirm');
    } else if (what === 'back') {
      // BACK leaves the sign-up from the initials (the arrows move the cursor, not BACK).
      if (card.step === 'initials') this.cards.splice(this.cards.indexOf(card), 1);
      else this.cardInput(card, 'back');
    }
  }

  private handle(e: MenuEvent) {
    const src: MenuSrc = e.src ?? 'kb';
    let key: MenuKey | undefined = e.key;
    // W A S D: navigation for the WASD player's card; else they type into a card entering initials (or W joins).
    if (src === 'wasd' && e.letter && !this.cards.some((c) => c.src === 'wasd')) {
      const t = this.typing();
      if (t) return this.type(t, e.letter);
    }
    if (e.letter && !key) {
      const t = this.typing();
      if (t) this.type(t, e.letter);
      return;
    }
    if (!key) return;
    // Esc / Backspace: the last joined player steps back; with nobody joined, back to the hints.
    if (src === 'kb' && key === 'back' && !this.cards.some((c) => c.src === 'kb')) {
      const c = this.cards[this.cards.length - 1];
      return c ? this.cardInput(c, 'back') : this.o.onBack();
    }
    const card = this.cards.find((c) => c.src === src);
    if (!card) {
      if (key === 'confirm' || (key === 'up' && !src.startsWith('pad'))) this.join(src);
      else if (key === 'back' && !this.cards.length) this.o.onBack();
      return;
    }
    // A letter typed by the 'kb' card's keyboard while entering initials (tests: { letter }) goes in as a letter.
    this.cardInput(card, key);
  }

  private cardInput(c: Card, key: MenuKey) {
    if (c.step === 'initials') {
      if (key === 'up' || key === 'down') {
        const i = LETTERS.indexOf(c.letters[c.cur]);
        c.letters[c.cur] = LETTERS[(i + (key === 'up' ? 1 : -1) + LETTERS.length) % LETTERS.length];
      } else if (key === 'left') c.cur = Math.max(0, c.cur - 1);
      else if (key === 'right') c.cur = Math.min(2, c.cur + 1);
      else if (key === 'confirm') {
        if (c.cur < 2) c.cur++;
        else c.step = 'colour';
      } else if (key === 'back') {
        if (c.cur > 0) c.cur--;
        else this.cards.splice(this.cards.indexOf(c), 1);
      }
    } else if (c.step === 'colour') {
      if (key === 'left' || key === 'right') {
        const d = key === 'left' ? -1 : 1;
        let i = PLAYER_COLOURS.indexOf(c.colour);
        for (let k = 0; k < PLAYER_COLOURS.length; k++) {
          i = (i + d + PLAYER_COLOURS.length) % PLAYER_COLOURS.length;
          if (this.free(PLAYER_COLOURS[i], c)) break;
        }
        c.colour = PLAYER_COLOURS[i];
      } else if (key === 'confirm') c.step = 'ready';
      else if (key === 'back') {
        c.step = 'initials';
        c.cur = 2;
      }
    } else {
      if (key === 'confirm' && this.cards.every((x) => x.step === 'ready')) this.o.onDone(this.players);
      else if (key === 'back') c.step = 'colour';
    }
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
