// The race's pause: a chunky II button in the top-left corner (touch mode) and, on Esc / P or a tap, the PAUSED
// menu (RESUME, SOUND on/off, QUIT; a standalone race has RESTART instead of QUIT). The flow stops the physics while
// it's up. Taps and keys both work: the menu reads the flow's menu presses (up / down / confirm / back) and its own
// buttons' taps.
import type { MenuEvent } from '../../engine/input';
import { addStyle, PIXEL_FONT } from '../pixel';

const CSS = `
.or-pausebtn { position: fixed; z-index: 9; left: calc(env(safe-area-inset-left) + 12px); top: calc(env(safe-area-inset-top) + 10px);
  width: 52px; height: 52px; display: none; align-items: center; justify-content: center; gap: 7px; box-sizing: border-box;
  background: rgba(11, 15, 34, .5); border: 3px solid #000; box-shadow: inset 0 0 0 2px rgba(233,228,212,.55), 3px 3px 0 rgba(0,0,0,.35);
  touch-action: none; }
.or-pausebtn i { display: block; width: 8px; height: 22px; background: #fff; box-shadow: 2px 2px 0 #000; }
body.or-touch .or-pausebtn.on { display: flex; }
.or-pause { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center;
  background: rgba(6, 12, 30, .62); font-family: ${PIXEL_FONT}; color: #fff; text-shadow: 2px 2px 0 #000; touch-action: none; }
.or-pause.on { display: flex; }
.or-pause .box { min-width: 280px; background: #0b0f22; border: 4px solid #000; padding: 20px 22px 18px;
  box-shadow: inset 0 0 0 3px #c9c9d2, 8px 8px 0 rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 10px; align-items: stretch; }
.or-pause h2 { margin: 0 0 8px; text-align: center; font-weight: normal; font-size: 24px; color: #ffe14a; letter-spacing: 3px; }
.or-pause .it { min-height: 48px; display: flex; align-items: center; justify-content: center; font-size: 13px; padding: 0 14px;
  background: #2a3b78; border: 3px solid #000; box-shadow: inset 0 0 0 2px rgba(255,255,255,.25), 3px 3px 0 rgba(0,0,0,.45); color: #cfe; }
.or-pause .it.sel { color: #ffe14a; background: #3a52a8; }
.or-pause .it.quit { background: #6b1a14; }
.or-pause .it.quit.sel { background: #a8261c; }
.or-pause .hint { margin-top: 6px; text-align: center; font-size: 8px; line-height: 1.8; color: #9fb4c8; }
@media (max-height: 420px) { .or-pause .box { padding: 12px 18px; gap: 7px; } .or-pause h2 { font-size: 18px; margin-bottom: 4px; } .or-pause .it { min-height: 44px; } }
`;

export type PauseChoice = 'resume' | 'quit' | 'restart' | 'sound';

export class PauseMenu {
  readonly button = document.createElement('div');
  readonly el = document.createElement('div');
  private sel = 0;
  private items: { id: PauseChoice; label: () => string }[] = [];
  open = false;

  constructor(
    private o: { onChoose(c: PauseChoice): void; soundLabel(): string },
    parent: HTMLElement = document.body,
  ) {
    addStyle('or-pause-css', CSS);
    this.button.className = 'or-pausebtn';
    this.button.id = 'or-pause-button';
    this.button.dataset.tap = 'pause';
    this.button.innerHTML = '<i></i><i></i>';
    this.el.className = 'or-pause';
    this.el.id = 'or-pause';
    parent.append(this.button, this.el);
  }

  /** The II button (a race on screen; CSS shows it in touch mode only). */
  showButton(on: boolean) {
    this.button.classList.toggle('on', on && !this.open);
  }

  /** Open the menu: `standalone` races offer RESTART instead of QUIT. */
  show(standalone: boolean) {
    this.items = [
      { id: 'resume', label: () => 'RESUME' },
      { id: 'sound', label: () => `SOUND: ${this.o.soundLabel()}` },
      standalone ? { id: 'restart', label: () => 'RESTART RACE' } : { id: 'quit', label: () => 'QUIT TO TITLE' },
    ];
    this.sel = 0;
    this.open = true;
    this.button.classList.remove('on');
    this.el.classList.add('on');
    this.draw(standalone);
  }

  hide() {
    this.open = false;
    this.el.classList.remove('on');
  }

  private standalone = false;

  private draw(standalone = this.standalone) {
    this.standalone = standalone;
    const hint = standalone ? '' : 'THE SEASON IS SAVED AT THE SPEED SHOP<br>BEFORE THIS RACE';
    this.el.innerHTML = `<div class="box"><h2>PAUSED</h2>${this.items
      .map((it, i) => `<div class="it ${it.id}${i === this.sel ? ' sel' : ''}" data-tap="pause:${it.id}">${it.label()}</div>`)
      .join('')}${hint ? `<div class="hint">${hint}</div>` : ''}<div class="hint kb-only">ESC / P RESUMES</div></div>`;
  }

  /** A menu press while open (keys, pads or taps). */
  input(e: MenuEvent) {
    if (e.tap?.startsWith('pause:')) return this.choose(e.tap.slice(6) as PauseChoice);
    if (e.key === 'up' || e.key === 'down') {
      this.sel = (this.sel + (e.key === 'up' ? -1 : 1) + this.items.length) % this.items.length;
      this.draw();
    } else if (e.key === 'confirm') this.choose(this.items[this.sel].id);
    else if (e.key === 'back') this.choose('resume');
  }

  private choose(c: PauseChoice) {
    this.o.onChoose(c);
    if (c === 'sound') this.draw();
  }

  dispose() {
    this.button.remove();
    this.el.remove();
  }
}
