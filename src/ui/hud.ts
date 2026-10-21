// The HUD: a strip across the top of the screen with one panel per truck colour, the way the original lays its
// scoreboard over the arena (position, laps, nitros, cash). OR1 fills the player's panel only; CPU panels are idle
// until OR2. Plain DOM over the canvas: crisp text at any size and no font loading.
import type { TruckState } from '../physics/vehicle';
import { TRUCK_COLOURS } from '../race/truck-view';

const CSS = `
.or-hud { position: fixed; left: 0; right: 0; top: 0; display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 6px; padding: 6px 8px; pointer-events: none; font: 700 13px/1.2 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace;
  color: #fff; text-shadow: 1px 1px 0 #000; }
.or-panel { border: 2px solid var(--c); background: rgba(0,0,0,.55); padding: 4px 8px; display: grid;
  grid-template-columns: auto 1fr auto; column-gap: 10px; align-items: center; min-width: 0; }
.or-panel .who { color: var(--c); font-size: 15px; letter-spacing: 1px; }
.or-panel .lap, .or-panel .cash { white-space: nowrap; }
.or-panel .nitro { grid-column: 1 / -1; letter-spacing: 2px; color: #7fe3ff; min-height: 1.2em; white-space: nowrap; overflow: hidden; }
.or-panel.idle { opacity: .55; }
@media (max-width: 640px) { .or-hud { grid-template-columns: repeat(2, 1fr); font-size: 11px; } }
`;

export class Hud {
  readonly el = document.createElement('div');
  private p1: { lap: HTMLElement; cash: HTMLElement; nitro: HTMLElement };

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el.className = 'or-hud';
    const panels = (Object.entries(TRUCK_COLOURS) as [string, string][]).map(([name, c], i) => {
      const p = document.createElement('div');
      p.className = `or-panel${i ? ' idle' : ''}`;
      p.style.setProperty('--c', c);
      p.innerHTML = `<span class="who">${i ? 'CPU' : 'P1'} ${name.toUpperCase()}</span><span class="lap">LAP -/4</span><span class="cash">$0</span><span class="nitro"></span>`;
      this.el.appendChild(p);
      return p;
    });
    const q = (s: string) => panels[0].querySelector(s) as HTMLElement;
    this.p1 = { lap: q('.lap'), cash: q('.cash'), nitro: q('.nitro') };
    parent.appendChild(this.el);
  }

  update(s: TruckState) {
    this.p1.nitro.textContent = `NITRO ${'■'.repeat(s.nitros)}${s.nitroActive ? '  >>>' : ''}`;
  }
}
