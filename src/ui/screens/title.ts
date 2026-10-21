// The title / attract screen: our "OFF ROAD" logo in a late-80s DOS style over the demo race (CPU trucks on
// autopilot), a little menu (new season / continue season), a blinking PRESS START, our credits line. Left idle it
// cycles to the racing hints and back, like an arcade attract loop.
import { addStyle, PIXEL_FONT } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { hintsHtml } from './hints';
import { screenEl, type Screen } from './common';
import { cycleDosLook, dosLabel, getSettings, onSettings, setSettings } from '../../engine/retro';
import { cycleQuality, onQuality, qualityLabel, touchCapable } from '../../engine/quality';
import { getAudio } from '../../audio';
import { canFullscreen, canVibrate, isFullscreen, toggleFullscreen } from '../touch/mobile';

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
.or-title { pointer-events: auto; }
.or-title .opts { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin: 0 auto 16px; max-width: 94vw; }
.or-title .opts div { font-size: 10px; color: #9fb4c8; padding: 9px 12px; min-height: 36px; display: flex; align-items: center;
  background: rgba(11,15,34,.75); border: 3px solid #000; box-shadow: inset 0 0 0 2px rgba(255,255,255,.18), 3px 3px 0 rgba(0,0,0,.45); }
.or-title .opts div.sel { color: #ffe14a; box-shadow: inset 0 0 0 2px #ffe14a, 3px 3px 0 rgba(0,0,0,.45); }
.or-title .opts div b { font-weight: normal; color: #fff; margin-left: 8px; }
.or-title .opts div.sel b { color: #ffe14a; }
.or-title .menu div[data-tap] { min-height: 22px; }
.or-title .fs { position: absolute; top: calc(env(safe-area-inset-top) + 12px); right: calc(env(safe-area-inset-right) + 12px);
  width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; background: rgba(11,15,34,.75);
  border: 3px solid #000; box-shadow: inset 0 0 0 2px rgba(255,255,255,.25), 3px 3px 0 rgba(0,0,0,.45); }
.or-title .fs svg { width: 28px; height: 28px; }
body.or-touch .or-title .menu div { padding-top: 6px; padding-bottom: 6px; }
@media (max-height: 560px) {
  .or-title .top { padding: calc(env(safe-area-inset-top) + 22px) 0 8px; }
  .or-logo { font-size: 46px; letter-spacing: 3px; }
  .or-logo span { text-shadow: 0 -2px 0 #fff6b0, 2px 2px 0 #e07a10, 4px 4px 0 #a8420c, 6px 6px 0 #5a1c06, 8px 8px 0 #000,
    -2px 0 0 #000, 0 2px 0 #000, 2px 0 0 #000, 0 -4px 0 #000; }
  .or-title .tag { margin-top: 14px; font-size: 9px; letter-spacing: 3px; }
  .or-title .bottom { padding: 16px 0 calc(env(safe-area-inset-bottom) + 6px); }
  .or-title .menu { font-size: 13px; gap: 4px; margin-bottom: 8px; }
  .or-title .menu div small { font-size: 8px; margin-top: 4px; }
  .or-title .opts { gap: 8px; margin-bottom: 8px; }
  .or-title .opts div { font-size: 8px; padding: 6px 9px; min-height: 34px; }
  .or-title .press { font-size: 13px; margin-bottom: 8px; }
  .or-title .credits { font-size: 7px; line-height: 1.8; }
  .or-title .credits .made { display: none; }
  .or-title .attract { padding: 16px 6%; }
}
`;

/** A pixel "fullscreen" glyph (four corners). */
const FS_ICON = `<svg viewBox="0 0 10 10" shape-rendering="crispEdges" fill="#fff"><rect x="0" y="0" width="4" height="1"/><rect x="0" y="0" width="1" height="4"/>
  <rect x="6" y="0" width="4" height="1"/><rect x="9" y="0" width="1" height="4"/><rect x="0" y="9" width="4" height="1"/><rect x="0" y="6" width="1" height="4"/>
  <rect x="6" y="9" width="4" height="1"/><rect x="9" y="6" width="1" height="4"/></svg>`;

type ItemId = 'new' | 'continue' | 'dos' | 'quality' | 'sound' | 'haptics';
/** The settings, a row of chips under the season items. */
const OPTIONS: ItemId[] = ['dos', 'quality', 'sound', 'haptics'];

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
  private items: { id: ItemId; html: string }[];
  private offSettings: () => void;
  private offQuality: () => void;

  constructor(private o: TitleOpts) {
    addStyle('or-title-css', CSS);
    this.items = [
      ...(o.save ? [{ id: 'continue' as const, html: `CONTINUE SEASON<small>${o.save}</small>` }] : []),
      { id: 'new', html: 'NEW SEASON' },
      { id: 'dos', html: '' },
      { id: 'quality', html: '' },
      { id: 'sound', html: '' },
      // Vibration only where the device can (Android; not iOS Safari).
      ...(canVibrate() && touchCapable() ? [{ id: 'haptics' as const, html: '' }] : []),
    ];
    // F2 / M change settings anywhere; keep the menu in step.
    this.offSettings = onSettings(() => this.draw());
    this.offQuality = onQuality(() => this.draw());
    const offAudio = getAudio().onChange(() => this.draw());
    const off = this.offSettings;
    this.offSettings = () => {
      off();
      offAudio();
    };
    const logo = [...'OFF ROAD'].map((ch) => (ch === ' ' ? '<span class="sp"></span>' : `<span>${ch}</span>`)).join('');
    // A tap anywhere but a menu item starts (the first item: continue the season, else a new one).
    this.el.dataset.tap = 'title:start';
    this.el.innerHTML = `
      <div class="top"><div class="or-logo">${logo}</div>
        <div class="tag">STADIUM <b>4X4</b> TRUCK RACING</div></div>
      <div class="bottom">
        <div class="menu"></div>
        <div class="opts"></div>
        <div class="press blink"><span class="kb-only">PRESS START</span><span class="touch-only">TAP TO START</span></div>
        <div class="credits"><span class="kb-only">KEYS: ARROWS / WASD &middot; ENTER / SPACE &middot; ESC &nbsp;&nbsp; PAD: D-PAD &middot; A &middot; B<br></span>
          <span class="touch-only">TOUCH: STEER WITH THE LEFT THUMB &middot; GAS, BRAKE, NITRO WITH THE RIGHT<br></span>
          <span class="made">MADE BY THE OFF ROAD CONTRIBUTORS &middot; ALL TRACKS, ART AND MUSIC OUR OWN<br></span>&copy; 2026 Off Road contributors</div>
      </div>
      ${canFullscreen() ? `<div class="fs" id="or-fullscreen" title="Fullscreen">${FS_ICON}</div>` : ''}
      <div class="attract">${hintsHtml()}</div>`;
    // Fullscreen needs the tap itself (a user gesture), so it isn't a queued menu press.
    this.el.querySelector('.fs')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.idle = 0;
      void toggleFullscreen().then(() => this.draw());
    });
    this.draw();
  }

  get selected() {
    return this.items[this.sel].id;
  }

  private draw() {
    const label: Partial<Record<ItemId, string>> = {
      dos: `DOS LOOK<b>${dosLabel()}</b>`,
      quality: `QUALITY<b>${qualityLabel()}</b>`,
      sound: `SOUND<b>${getAudio().settings.muted ? 'OFF' : 'ON'}</b>`,
      haptics: `VIBRATE<b>${getSettings().haptics ? 'ON' : 'OFF'}</b>`,
    };
    const item = (it: (typeof this.items)[number], i: number) =>
      `<div class="${i === this.sel ? 'sel' : ''}" data-id="${it.id}" data-tap="title:${it.id}">${label[it.id] ?? it.html}</div>`;
    const all = this.items.map((it, i) => ({ it, i }));
    this.el.querySelector('.menu')!.innerHTML = all.filter(({ it }) => !OPTIONS.includes(it.id)).map(({ it, i }) => item(it, i)).join('');
    this.el.querySelector('.opts')!.innerHTML = all.filter(({ it }) => OPTIONS.includes(it.id)).map(({ it, i }) => item(it, i)).join('');
    this.el.querySelector('.fs')?.classList.toggle('on', isFullscreen());
  }

  /** Do what an item does (confirm on it, or a tap). */
  private activate(id: ItemId) {
    if (id === 'dos') cycleDosLook();
    else if (id === 'quality') setSettings({ quality: cycleQuality() });
    else if (id === 'sound') getAudio().toggleMute();
    else if (id === 'haptics') {
      setSettings({ haptics: !getSettings().haptics });
      if (getSettings().haptics) navigator.vibrate?.(40);
    } else if (id === 'continue') this.o.onContinue();
    else this.o.onNew();
  }

  input(e: MenuEvent) {
    const wasAttract = this.el.classList.contains('hints');
    this.idle = 0;
    this.el.classList.remove('hints');
    if (wasAttract) return;
    if (e.tap?.startsWith('title:')) {
      const id = e.tap.slice(6);
      if (id === 'start') return this.activate(this.items[0].id);
      const i = this.items.findIndex((it) => it.id === id);
      if (i < 0) return;
      this.sel = i;
      this.draw();
      return this.activate(this.items[i].id);
    }
    const inRow = OPTIONS.includes(this.selected);
    if (e.key === 'up' || e.key === 'down' || (inRow && (e.key === 'left' || e.key === 'right'))) {
      const d = e.key === 'up' || e.key === 'left' ? -1 : 1;
      this.sel = (this.sel + d + this.items.length) % this.items.length;
      this.draw();
    } else if (e.key === 'confirm') this.activate(this.selected);
  }

  tick(dt: number) {
    this.idle += dt;
    const hints = this.idle > ATTRACT_IDLE && this.idle < ATTRACT_IDLE + ATTRACT_HINTS;
    this.el.classList.toggle('hints', hints);
    if (this.idle >= ATTRACT_IDLE + ATTRACT_HINTS) this.idle = 0;
  }

  dispose() {
    this.offSettings();
    this.offQuality();
    this.el.remove();
  }
}
