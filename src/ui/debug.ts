// F3 debug overlay: speed, the four wheel contacts and suspension, air time, fps and physics steps.
import type { TruckState } from '../physics/vehicle';

export class DebugOverlay {
  readonly el = document.createElement('pre');
  visible = false;

  constructor(parent: HTMLElement) {
    Object.assign(this.el.style, {
      position: 'fixed', left: '8px', bottom: '8px', margin: '0', padding: '6px 10px', background: 'rgba(0,0,0,.7)',
      color: '#b6ff9e', font: '12px/1.35 ui-monospace, monospace', pointerEvents: 'none', display: 'none', whiteSpace: 'pre',
    });
    this.el.id = 'or-debug';
    parent.appendChild(this.el);
  }

  toggle(on = !this.visible) {
    this.visible = on;
    this.el.style.display = on ? 'block' : 'none';
  }

  update(s: TruckState, loop: { fps: number; simTime: number; steps: number }) {
    if (!this.visible) return;
    const dot = (c: boolean) => (c ? '●' : '○');
    const [fl, fr, rl, rr] = s.contacts;
    const sus = s.suspension.map((x) => x.toFixed(2));
    this.el.textContent = [
      `speed  ${(s.speed * 3.6).toFixed(0).padStart(4)} km/h  (${s.speed.toFixed(1)} m/s)`,
      `wheels ${dot(fl)} ${dot(fr)}   susp ${sus[0]} ${sus[1]}`,
      `       ${dot(rl)} ${dot(rr)}        ${sus[2]} ${sus[3]}`,
      `air    ${s.airborne ? 'yes' : 'no '} ${s.airTime.toFixed(2)}s   up.y ${s.up.y.toFixed(2)}`,
      `pos    ${s.pos.x.toFixed(1)}, ${s.pos.y.toFixed(1)}, ${s.pos.z.toFixed(1)}   hdg ${((s.heading * 180) / Math.PI).toFixed(0)}°`,
      `nitro  ${s.nitros}${s.nitroActive ? ' BURST' : ''}   water ${s.inWater ? 'yes' : 'no'}   resets ${s.resets}`,
      `fps    ${loop.fps.toFixed(0)}   sim ${loop.simTime.toFixed(1)}s   steps ${loop.steps}`,
    ].join('\n');
  }
}
