// The race HUD in the original's style: ONE small grey panel placed over an empty spot of each track (the track
// JSON's hud.panel anchor), with the race timer in a tab on top and LAP / NITRO rows of four colour cells (red,
// yellow, blue, grey). The track name sits beside it in red italic with a black outline. No positions and no
// money during the race. Also: the big centre banners (GET READY!, 3-2-1, GO!, FINISHED) and floating pickup texts.
import * as THREE from 'three';
import { addStyle, PIXEL_FONT } from './pixel';
import type { Anchor } from '../track/types';

const CSS = `
.or-rhud { position: fixed; left: 0; top: 0; pointer-events: none; font-family: ${PIXEL_FONT}; z-index: 5;
  transform: translate(-50%, -50%); image-rendering: pixelated; }
.or-rhud .tab { margin: 0 auto; width: max-content; min-width: 5.2em; padding: 4px 10px 3px; background: #1b1b22;
  color: #f4f4f4; font-size: 13px; text-align: center; border: 2px solid #c9c9d2; border-bottom: none;
  border-radius: 8px 8px 0 0; }
.or-rhud .box { background: linear-gradient(#d8d8de, #a9a9b4); border: 2px solid #3a3a44; padding: 4px 5px;
  box-shadow: 2px 2px 0 rgba(0,0,0,.5); }
.or-rhud .stripes { height: 4px; margin: -2px -3px 4px; background: linear-gradient(#d42a26 0 33%, #e8c020 33% 66%, #2f5fd8 66%); }
.or-rhud .row { display: grid; grid-template-columns: 4.6em repeat(4, 2.4em); gap: 3px; align-items: center; margin: 2px 0; }
.or-rhud .lbl { color: #1b1b22; font-size: 10px; }
.or-rhud .cell { color: #fff; font-size: 11px; text-align: center; padding: 3px 0 2px; border: 1px solid #1b1b22;
  text-shadow: 1px 1px 0 #000; }
.or-name { position: fixed; left: 0; top: 0; transform: translate(-50%, -50%) skewX(-12deg); pointer-events: none; z-index: 5;
  font-family: ${PIXEL_FONT}; font-size: 20px; color: #e8231c; white-space: nowrap;
  text-shadow: -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 3px 3px 0 #000; }
.or-banner { position: fixed; left: 50%; top: 46%; transform: translate(-50%, -50%); pointer-events: none; z-index: 6;
  font-family: ${PIXEL_FONT}; font-size: 44px; color: #ffe14a; white-space: nowrap; letter-spacing: 2px;
  text-shadow: -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 5px 5px 0 #7a1a12; }
.or-banner.go { color: #5cff6a; }
.or-float { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 6; font-family: ${PIXEL_FONT}; font-size: 13px;
  color: #fff; white-space: nowrap; text-shadow: -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000; }
@media (max-width: 700px) { .or-rhud { font-size: 9px; } .or-name { font-size: 13px; } .or-banner { font-size: 26px; } }
`;

const CELL_COLOURS = ['#c8231f', '#c9a412', '#2850c8', '#7e848c'];

export interface HudTruck {
  lap: number;
  nitros: number;
}

interface Floater {
  el: HTMLElement;
  pos: THREE.Vector3;
  t: number;
}

const _v = new THREE.Vector3();

export class RaceHud {
  readonly panel = document.createElement('div');
  readonly name = document.createElement('div');
  readonly banner = document.createElement('div');
  private timer: HTMLElement;
  private lapCells: HTMLElement[] = [];
  private nitroCells: HTMLElement[] = [];
  private floaters: Floater[] = [];
  private last = '';

  constructor(
    parent: HTMLElement,
    trackName: string,
    private anchors: { panel: Anchor; name: Anchor },
    private heightAt: (x: number, z: number) => number,
  ) {
    addStyle('or-rhud-css', CSS);
    this.panel.className = 'or-rhud';
    this.panel.id = 'or-race-hud';
    const cells = (cls: string) => CELL_COLOURS.map((c) => `<span class="cell ${cls}" style="background:${c}">0</span>`).join('');
    this.panel.innerHTML = `<div class="tab">0.0</div><div class="box"><div class="stripes"></div>
      <div class="row"><span class="lbl">LAP</span>${cells('lap')}</div>
      <div class="row"><span class="lbl">NITRO</span>${cells('nitro')}</div></div>`;
    this.timer = this.panel.querySelector('.tab') as HTMLElement;
    this.lapCells = [...this.panel.querySelectorAll('.cell.lap')] as HTMLElement[];
    this.nitroCells = [...this.panel.querySelectorAll('.cell.nitro')] as HTMLElement[];
    this.name.className = 'or-name';
    this.name.textContent = trackName;
    this.banner.className = 'or-banner';
    this.banner.style.display = 'none';
    parent.append(this.panel, this.name, this.banner);
  }

  /** Re-place the panel and name over their world anchors (call after the camera moves or the window resizes). */
  place(camera: THREE.Camera) {
    const put = (el: HTMLElement, a: Anchor) => {
      _v.set(a.x, this.heightAt(a.x, a.z), a.z).project(camera);
      el.style.left = `${((_v.x + 1) / 2) * window.innerWidth}px`;
      el.style.top = `${((1 - _v.y) / 2) * window.innerHeight}px`;
    };
    put(this.panel, this.anchors.panel);
    put(this.name, this.anchors.name);
    // Scale the panel with the window so it stays the same share of the arena.
    const s = Math.max(0.6, Math.min(1.6, window.innerWidth / 1280));
    this.panel.style.transform = `translate(-50%, -50%) scale(${s})`;
    this.name.style.fontSize = `${Math.round(20 * s)}px`;
    // On a small screen the anchors close up faster than the panel shrinks: slide the name out from under the panel
    // (to the left when it sits left of the panel's centre, else to the right).
    const p = this.panel.getBoundingClientRect();
    const n = this.name.getBoundingClientRect();
    if (p.width && n.width && n.right > p.left && n.left < p.right && n.bottom > p.top && n.top < p.bottom) {
      const left = n.left + n.width / 2 < p.left + p.width / 2;
      const dx = left ? p.left - 6 - n.right : p.right + 6 - n.left;
      this.name.style.left = `${parseFloat(this.name.style.left) + dx}px`;
    }
  }

  /** `trucks` in HUD colour order (red, yellow, blue, grey); null = that colour isn't racing. */
  update(clock: number, trucks: (HudTruck | null)[]) {
    const key = `${clock.toFixed(1)}|${trucks.map((t) => (t ? `${t.lap},${t.nitros}` : '-')).join(';')}`;
    if (key === this.last) return;
    this.last = key;
    this.timer.textContent = clock.toFixed(1);
    trucks.forEach((t, i) => {
      if (this.lapCells[i]) this.lapCells[i].textContent = t ? String(t.lap) : '-';
      if (this.nitroCells[i]) this.nitroCells[i].textContent = t ? String(t.nitros) : '-';
    });
    for (let i = trucks.length; i < 4; i++) {
      this.lapCells[i].textContent = '-';
      this.nitroCells[i].textContent = '-';
    }
  }

  setBanner(text: string | null, go = false) {
    if (!text) {
      this.banner.style.display = 'none';
      return;
    }
    this.banner.style.display = 'block';
    this.banner.classList.toggle('go', go);
    if (this.banner.textContent !== text) this.banner.textContent = text;
  }

  /** A text that rises and fades where a pickup was collected ("10,000", "1 NITRO"). */
  float(text: string, x: number, y: number, z: number, colour: string) {
    const el = document.createElement('div');
    el.className = 'or-float';
    el.textContent = text;
    el.style.color = colour;
    document.body.appendChild(el);
    this.floaters.push({ el, pos: new THREE.Vector3(x, y + 1, z), t: 0 });
  }

  tick(dt: number, camera: THREE.Camera) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      _v.copy(f.pos).setY(f.pos.y + f.t * 2.5).project(camera);
      f.el.style.left = `${((_v.x + 1) / 2) * window.innerWidth}px`;
      f.el.style.top = `${((1 - _v.y) / 2) * window.innerHeight}px`;
      f.el.style.transform = 'translate(-50%, -50%)';
      f.el.style.opacity = String(Math.max(0, 1 - Math.max(0, f.t - 0.9) / 0.6));
      if (f.t > 1.5) {
        f.el.remove();
        this.floaters.splice(i, 1);
      }
    }
  }

  dispose() {
    this.panel.remove();
    this.name.remove();
    this.banner.remove();
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
  }

  show(on: boolean) {
    this.panel.style.display = this.name.style.display = on ? '' : 'none';
  }
}
