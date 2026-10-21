// The Speed Shop between races, laid out like the original's: three colour panels; the shopping player's panel
// becomes the shop (CREDITS and CASH boxes over six tiles: Nitro, Acceleration, Tires, Top Speed, Shocks, Start Next
// Race with a map of the next track); the other panels show the CPU drivers and how far they've upgraded. With 2–3
// humans they shop in turn (player 1 first): the shopping player's panel is the shop, the other humans' panels show
// their cash, credits and upgrades (NEXT / DONE), and START NEXT RACE passes the shop on (the last one starts it).
// Only the shopping player's keys / pad act (MenuEvent.player, filled in by the flow).
import { addStyle } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { CPU_DRIVERS, HEX, PLAYER_COLOURS, type Colour } from '../../race/roster';
import { canBuy, MAX_LEVEL, MAX_NITROS, money, NITRO_PER_BUY, PRICES, priceLabel, type ShopItem, type Upgrade } from '../../game/economy';
import type { CpuState, NextRace, PlayerState } from '../../game/season';
import { banner, esc, levelBar, PANEL, screenEl, trophyIcon, truckIcon, type Screen } from './common';
import { trackThumb } from './track-thumb';

const CSS = `
.or-shop .panels { padding-bottom: 30px; }
.or-shop .panel.me { padding: 12px; gap: 10px; }
.or-shop .money { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; width: 100%; }
.or-shop .money div { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; }
.or-shop .money b { display: block; width: 100%; background: #0b0f22; border: 3px solid #000; color: #fff; text-shadow: 2px 2px 0 #000;
  font-weight: normal; font-size: 16px; padding: 7px 8px; text-align: right; }
.or-shop .money .credits b { text-align: center; }
.or-shop .tiles { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); gap: 8px; width: 100%; flex: 1; min-height: 0; }
.or-shop .tile { position: relative; background: #4f6478; border: 3px solid #000; outline: 3px solid transparent; display: grid;
  grid-template-columns: 1fr auto; grid-template-rows: auto 1fr; padding: 5px 6px; gap: 4px; min-height: 0; }
.or-shop .tile.sel { outline-color: #fff; z-index: 1; }
.or-shop .tile .hd { grid-column: 1 / -1; display: flex; justify-content: space-between; font-size: 10px; color: #fff; }
.or-shop .tile svg { width: 100%; height: 100%; max-height: 92px; min-height: 0; }
.or-shop .tile .lv i { width: 16px; height: 13px; }
.or-shop .tile.maxed .hd span:last-child { color: #4cff5a; }
.or-shop .tile .gauge { width: 16px; border: 2px solid #000; background: #233; display: flex; flex-direction: column-reverse; }
.or-shop .tile .gauge i { display: block; background: #4cff5a; }
.or-shop .tile .count { position: absolute; left: 8px; bottom: 6px; font-size: 11px; color: #7fe3ff; }
.or-shop .tile.start { grid-template-columns: 1fr; background: #3a2a1c; }
.or-shop .tile.start .hd { justify-content: center; text-align: center; line-height: 1.4; }
.or-shop .tile.start canvas { width: 100%; height: 100%; min-height: 0; object-fit: contain; image-rendering: pixelated; }
.or-shop .tile.start .nm { position: absolute; left: 0; right: 0; bottom: 4px; text-align: center; font-size: 8px; }
.or-shop .msg { height: 14px; font-size: 10px; color: #fff; text-shadow: 2px 2px 0 #000; }
.or-shop .msg.bad { color: #ffe14a; }
.or-shop .panel.cpu .bars { margin-top: 6px; }
.or-shop .panel.cpu .cash, .or-shop .panel.other .cash { font-size: 10px; line-height: 1.8; }
.or-shop .panel.other { filter: saturate(.85) brightness(.92); }
.or-shop .panel.other .state { font-size: 13px; color: #fff; text-shadow: 2px 2px 0 #000, -1px -1px 0 #000; }
.or-shop .panel .turn { font-size: 10px; color: #fff; }
.or-shop .boss { position: absolute; left: 0; right: 0; bottom: 8px; display: flex; gap: 14px; justify-content: center; align-items: center;
  font-size: 9px; color: #c9ccd2; }
.or-shop .boss .lv { flex-direction: row; } .or-shop .boss .lv i { width: 8px; height: 8px; }
`;

const TILES: ShopItem[] = ['nitro', 'accel', 'tires', 'top', 'shocks'];
const LABEL: Record<ShopItem, string> = { nitro: 'NITRO', accel: 'ACCEL.', tires: 'TIRES', top: 'TOP SPD', shocks: 'SHOCKS' };
const SHORT: Record<Upgrade, string> = { accel: 'ACC', tires: 'TIR', top: 'SPD', shocks: 'SHK' };

/** Little pixel pictures for the tiles (our own). */
const ICON: Record<ShopItem, string> = {
  nitro: `<svg viewBox="0 0 40 40" shape-rendering="crispEdges"><rect x="14" y="9" width="12" height="27" fill="#c8ccd4" stroke="#000"/><rect x="16" y="5" width="8" height="5" fill="#d0281e" stroke="#000"/><rect x="17" y="2" width="6" height="3" fill="#555"/><rect x="16" y="15" width="3" height="16" fill="#fff" opacity=".6"/><rect x="14" y="20" width="12" height="5" fill="#2f5fd8"/><path d="M26 7 h6 v4" stroke="#ffe14a" stroke-width="2" fill="none"/></svg>`,
  accel: `<svg viewBox="0 0 40 40" shape-rendering="crispEdges"><rect x="6" y="14" width="26" height="16" fill="#c0392b" stroke="#000"/><rect x="9" y="8" width="20" height="7" fill="#888" stroke="#000"/><rect x="12" y="4" width="4" height="5" fill="#555"/><rect x="22" y="4" width="4" height="5" fill="#555"/><rect x="32" y="18" width="5" height="8" fill="#666" stroke="#000"/><rect x="8" y="30" width="3" height="7" fill="#ddd"/><rect x="15" y="30" width="3" height="7" fill="#ddd"/><rect x="22" y="30" width="3" height="7" fill="#ddd"/><rect x="29" y="30" width="3" height="7" fill="#ddd"/><rect x="9" y="18" width="20" height="2" fill="#e74c3c"/><rect x="9" y="23" width="20" height="2" fill="#e74c3c"/></svg>`,
  tires: `<svg viewBox="0 0 40 40" shape-rendering="crispEdges"><circle cx="20" cy="20" r="16" fill="#1b1b1b" stroke="#000"/><circle cx="20" cy="20" r="12" fill="#2b2b2b"/><circle cx="20" cy="20" r="7" fill="#9a9a9a" stroke="#000"/><circle cx="20" cy="20" r="2" fill="#333"/><g fill="#444"><rect x="18" y="3" width="4" height="3"/><rect x="18" y="34" width="4" height="3"/><rect x="3" y="18" width="3" height="4"/><rect x="34" y="18" width="3" height="4"/></g></svg>`,
  top: `<svg viewBox="0 0 40 40"><path d="M5 28 A15 15 0 0 1 35 28 Z" fill="#f2f2f2" stroke="#000" stroke-width="1.5"/><g stroke="#000" stroke-width="1.5"><line x1="8" y1="24" x2="10" y2="23"/><line x1="12" y1="16" x2="13.5" y2="17.5"/><line x1="20" y1="13" x2="20" y2="15"/><line x1="28" y1="16" x2="26.5" y2="17.5"/><line x1="32" y1="24" x2="30" y2="23"/></g><line x1="20" y1="28" x2="30" y2="19" stroke="#d0281e" stroke-width="2.5"/><circle cx="20" cy="28" r="2.5" fill="#222"/><rect x="11" y="31" width="18" height="6" fill="#2f5fd8" stroke="#000"/><text x="20" y="36" font-size="5" fill="#fff" text-anchor="middle" font-family="monospace">MAX</text></svg>`,
  shocks: `<svg viewBox="0 0 40 40" shape-rendering="crispEdges"><rect x="17" y="2" width="6" height="6" fill="#888" stroke="#000"/><rect x="18" y="26" width="4" height="9" fill="#bbb" stroke="#000"/><rect x="16" y="34" width="8" height="4" fill="#888" stroke="#000"/><path d="M12 9 L28 12 L12 15 L28 18 L12 21 L28 24 L12 27" stroke="#d0281e" stroke-width="3" fill="none"/><rect x="18" y="8" width="4" height="19" fill="#555"/></svg>`,
};

export interface ShopOpts {
  players: () => PlayerState[];
  cpus: () => CpuState[];
  next: NextRace;
  raceNo: number;
  onBuy(item: ShopItem, player: number): void;
  onStart(): void;
  onQuit(): void;
}

export class ShopScreen implements Screen {
  readonly el = screenEl('or-shop');
  /** Cursor over the six tiles (0 nitro, 1 accel, 2 tires, 3 top speed, 4 shocks, 5 start). */
  cursor = 0;
  private msg = '';
  private msgBad = false;
  private msgT = 0;
  private quitArmed = false;
  private thumb: HTMLCanvasElement;
  /** The human shopping now (index into players()). */
  turn = 0;

  constructor(private o: ShopOpts) {
    addStyle('or-shop-css', CSS);
    this.thumb = trackThumb(o.next.data, 220, 130);
    this.draw();
  }

  /** The item under the cursor ('start' for the last tile). */
  get item(): ShopItem | 'start' {
    return this.cursor === 5 ? 'start' : TILES[this.cursor];
  }

  private flash(text: string, bad = false) {
    this.msg = text;
    this.msgBad = bad;
    this.msgT = 2.2;
  }

  /** The shopping player. */
  player() {
    return this.o.players()[this.turn];
  }

  draw() {
    const all = this.o.players();
    const me = all[this.turn];
    const cpus = this.o.cpus();
    const many = all.length > 1;
    const tiles = TILES.map((it, i) => {
      const max = it === 'nitro' ? me.nitros >= MAX_NITROS : me.levels[it] >= MAX_LEVEL;
      const side =
        it === 'nitro'
          ? `<span class="gauge"><i style="height:${Math.round((Math.min(me.nitros, 50) / 50) * 100)}%"></i></span>`
          : levelBar(me.levels[it], MAX_LEVEL);
      return `<div class="tile${i === this.cursor ? ' sel' : ''}${max ? ' maxed' : ''}" data-item="${it}">
        <div class="hd"><span>${LABEL[it]}</span><span>${max ? 'MAX' : priceLabel(PRICES[it])}</span></div>${ICON[it]}${side}
        ${it === 'nitro' ? `<span class="count">${me.nitros}</span>` : ''}</div>`;
    }).join('');
    const start = `<div class="tile start${this.cursor === 5 ? ' sel' : ''}" data-item="start"><div class="hd">START NEXT<br>RACE</div><div class="map"></div>
      <div class="nm">${esc(this.o.next.name.toUpperCase())}</div></div>`;
    const panels = PLAYER_COLOURS.map((c) => {
      if (c === me.colour)
        return `<div class="panel me" data-colour="${c}" data-player="${this.turn + 1}" style="background:${PANEL[c].bg}">
          ${many ? `<div class="turn">PLAYER ${this.turn + 1} ${esc(me.initials)} SHOPPING</div>` : ''}<div class="money"><div class="credits">CREDITS<b>${me.credits}</b></div><div>CASH<b>${money(me.cash)}</b></div></div>
          <div class="tiles">${tiles}${start}</div>
          <div class="msg${this.msgBad ? ' bad' : ''}">${this.msg}</div></div>`;
      const k = all.findIndex((x) => x.colour === c);
      if (k >= 0) return humanPanel(all[k], k, k < this.turn ? 'DONE' : 'NEXT');
      const cpu = cpus.find((x) => x.colour === c);
      return cpu ? cpuPanel(c, cpu) : '';
    }).join('');
    const boss = cpus.find((x) => x.colour === 'grey');
    const bossLine = boss
      ? `<div class="boss">${CPU_DRIVERS.grey.nick} (GREY): ${(['accel', 'tires', 'top', 'shocks'] as Upgrade[]).map((u) => `${SHORT[u]} ${levelBar(boss.levels[u])}`).join(' ')}</div>`
      : '';
    this.el.innerHTML = `${banner(`SPEED <i>SHOP</i>`)}<div class="panels">${panels}</div>${bossLine}`;
    this.el.querySelector('.tile.start .map')?.appendChild(this.thumb);
  }

  input(e: MenuEvent) {
    // Only the shopping player's keys / pad (undefined = anyone: one human, Esc, tests).
    if (e.player !== undefined && e.player !== this.turn) return;
    if (e.key !== 'back') this.quitArmed = false;
    const col = this.cursor % 2;
    const row = Math.floor(this.cursor / 2);
    switch (e.key) {
      case 'left':
      case 'right':
        this.cursor = row * 2 + (1 - col);
        break;
      case 'up':
        this.cursor = ((row + 2) % 3) * 2 + col;
        break;
      case 'down':
        this.cursor = ((row + 1) % 3) * 2 + col;
        break;
      case 'confirm': {
        const it = this.item;
        if (it === 'start') {
          if (this.turn >= this.o.players().length - 1) return this.o.onStart();
          // The next human's turn at the shop.
          this.turn++;
          this.cursor = 0;
          this.msg = '';
          break;
        }
        const c = canBuy(this.player(), it);
        if (c === 'ok') {
          this.o.onBuy(it, this.turn);
          this.flash(it === 'nitro' ? `+${NITRO_PER_BUY} NITRO` : `${LABEL[it]} LEVEL ${this.player().levels[it]}`);
        } else this.flash(c === 'cash' ? 'NOT ENOUGH CASH' : 'ALREADY MAXED', true);
        break;
      }
      case 'back':
        if (this.quitArmed) return this.o.onQuit();
        this.quitArmed = true;
        this.flash('ESC / (B) AGAIN: SAVE + QUIT', true);
        break;
    }
    this.draw();
  }

  tick(dt: number) {
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) {
        this.msg = '';
        this.quitArmed = false;
        const m = this.el.querySelector('.msg');
        if (m) m.textContent = '';
      }
    }
  }

  dispose() {
    this.el.remove();
  }
}

/** Another human's panel while someone else shops: their truck, upgrades, cash and credits. */
function humanPanel(p: PlayerState, k: number, state: string) {
  const c = p.colour;
  const bars = (['accel', 'tires', 'top', 'shocks'] as Upgrade[]).map((u) => `<span class="bar">${levelBar(p.levels[u])}${SHORT[u]}</span>`).join('');
  return `<div class="panel other" data-colour="${c}" data-player="${k + 1}" style="background:${PANEL[c].bg};color:${PANEL[c].text}">
    <div class="who">PLAYER ${k + 1}<br>${esc(p.initials)}</div>${truckIcon(HEX[c])}<div class="state">${state}</div>
    <div class="bars">${bars}</div><div class="cash">${money(p.cash)}<br>CREDITS ${p.credits} &middot; NITRO ${p.nitros}</div>${trophyIcon()}</div>`;
}

function cpuPanel(c: Colour, cpu: CpuState) {
  const d = CPU_DRIVERS[c];
  const bars = (['accel', 'tires', 'top', 'shocks'] as Upgrade[]).map((u) => `<span class="bar">${levelBar(cpu.levels[u])}${SHORT[u]}</span>`).join('');
  return `<div class="panel cpu" data-colour="${c}" style="background:${PANEL[c].bg};color:${PANEL[c].text}">
    <div class="who">CPU DRIVER</div>${truckIcon(HEX[c])}<div class="who">${d.nick}<br><span class="small">${d.name}</span></div>
    <div class="bars">${bars}</div><div class="cash">${money(cpu.cash)}</div>${trophyIcon()}</div>`;
}
