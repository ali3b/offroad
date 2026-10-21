// The results / podium screen after a race: finish time and the track record on top, then a podium plate per
// truck with place, prize money (+ money bags), driver, average and best lap. Our own layout and art.
import { addStyle, PIXEL_FONT } from './pixel';
import type { RaceRecord, RacerResult } from '../race/race';
import type { Entry } from '../race/roster';
import { hasModels } from '../race/models';
import { podiumView } from './podium-view';

const CSS = `
.or-results { position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 12px; font-family: ${PIXEL_FONT}; color: #fff; text-shadow: 2px 2px 0 #000;
  background:
    repeating-conic-gradient(#14204a 0 25%, #1b2a5c 0 50%) 0 0 / 48px 48px;
  animation: or-fade .35s ease-out; }
@keyframes or-fade { from { opacity: 0; } to { opacity: 1; } }
.or-results .title { font-size: 26px; color: #ffe14a; letter-spacing: 3px; }
.or-results .times { background: #0b0f22; border: 3px solid #c9c9d2; padding: 12px 22px; font-size: 13px; line-height: 2;
  text-align: center; box-shadow: 4px 4px 0 rgba(0,0,0,.5); }
.or-results .times .rec { color: #7fe3ff; }
.or-results .times .new { color: #5cff6a; }
.or-results .podium3d { width: 922px; height: 300px; margin: -4px 0 -8px; }
.or-results .podium3d canvas { display: block; width: 100%; height: 100%; }
.or-results .podium, .or-results .plates { display: flex; align-items: flex-end; gap: 14px; }
.or-results .plates { align-items: stretch; margin-top: -10px; }
.or-results .col { display: flex; flex-direction: column; align-items: center; width: 220px; }
.or-results .driver { width: 46px; height: 74px; position: relative; margin-bottom: 6px; }
.or-results .driver .helmet { position: absolute; left: 9px; top: 0; width: 28px; height: 26px; border-radius: 14px 14px 6px 6px;
  border: 2px solid #000; }
.or-results .driver .visor { position: absolute; left: 15px; top: 9px; width: 18px; height: 7px; background: #20262e; }
.or-results .driver .suit { position: absolute; left: 4px; top: 27px; width: 38px; height: 47px; border: 2px solid #000;
  border-radius: 6px 6px 0 0; }
.or-results .driver .arm { position: absolute; left: 36px; top: 4px; width: 9px; height: 28px; border: 2px solid #000;
  transform: rotate(18deg); }
.or-results .step { width: 100%; background: linear-gradient(#e9e9ee, #a9a9b4); border: 3px solid #3a3a44; color: #1b1b22;
  text-shadow: none; text-align: center; font-size: 30px; padding-top: 8px; }
.or-results .plate { width: 220px; box-sizing: border-box; background: #0b0f22; border: 3px solid var(--c); margin-top: 8px; padding: 9px 8px;
  font-size: 10px; line-height: 1.9; text-align: center; }
.or-results .plate .place { color: var(--c); font-size: 12px; }
.or-results .plate .money { color: #ffe14a; }
.or-results .plate .who { color: #fff; }
.or-results .plate .dim { color: #aab; }
.or-results .cash { font-size: 13px; color: #ffe14a; }
.or-results .note { font-size: 18px; letter-spacing: 2px; animation: or-blink .6s steps(2) 6; }
.or-results .note.free { color: #5cff6a; }
.or-results .note.lost { color: #ff5a4a; }
.or-results .again { font-size: 12px; color: #fff; animation: or-blink 1s steps(2) infinite; }
@keyframes or-blink { 50% { opacity: .25; } }
@media (max-width: 960px) { .or-results .podium3d { width: calc(88vw + 42px); height: 28vw; }
  .or-results .col, .or-results .plate { width: 22vw; } .or-results .plate { font-size: 8px; } .or-results .title { font-size: 18px; } }
`;

const ORDINAL = ['1st', '2nd', '3rd', '4th'];
const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const secs = (t: number | null) => (t === null ? '--.--' : t.toFixed(2));

export class ResultsScreen {
  readonly el = document.createElement('div');

  constructor(private parent: HTMLElement) {
    addStyle('or-results-css', CSS);
    this.el.className = 'or-results';
    this.el.id = 'or-results';
  }

  show(o: {
    track: string;
    results: RacerResult[];
    entries: Entry[];
    record: RaceRecord | null;
    newRecord: boolean;
    cash: number;
    /** Season: FREE RACE! / CREDIT LOST and the credits left. */
    note?: { text: string; kind: 'free' | 'lost' };
    credits?: number;
    /** The blinking prompt at the bottom. */
    prompt?: string;
  }) {
    const me = o.results[0];
    // Podium order: 2nd, 1st, 3rd, 4th (the winner raised in the middle).
    const byPlace = [...o.results].sort((a, b) => a.place - b.place);
    const order = [byPlace[1], byPlace[0], byPlace[2], byPlace[3]].filter(Boolean);
    const stepH = [100, 70, 48, 28];
    const cols = order
      .map((r) => {
        const e = o.entries[r.slot];
        const h = stepH[r.place - 1] ?? 30;
        return `<div class="col" style="--c:${e.hex}" data-slot="${r.slot}">
          <div class="driver"><div class="arm" style="background:${e.hex}"></div><div class="helmet" style="background:${e.hex}"></div><div class="visor"></div><div class="suit" style="background:${e.hex}"></div></div>
          <div class="step" style="height:${h}px">${r.place}</div></div>`;
      })
      .join('');
    const plates = order
      .map((r) => {
        const e = o.entries[r.slot];
        const who = e.human ? `${e.nick}<br>${e.name}` : r.slot === 0 ? `YOU<br>&nbsp;` : `${e.nick}<br>${e.name}`;
        return `<div class="plate" style="--c:${e.hex}"><div class="place">${ORDINAL[r.place - 1]} Place</div>
            <div class="money">${money(r.prize)}${r.bags ? ` + ${money(r.bags)}` : ''}</div>
            <div class="who">${who}</div>
            <div class="dim">Time: ${secs(r.time)}</div>
            <div class="dim">Avg: ${secs(r.avg)}</div><div class="dim">Best: ${secs(r.best)}</div></div>`;
      })
      .join('');
    // With the generator's characters the podium is a little 3D scene (ui/podium-view.ts); else flat drivers.
    const in3d = hasModels();
    const rec = o.record ? `Record (${o.record.who}): ${o.record.time.toFixed(2)}` : 'Record: --.--';
    const me_ = o.entries[0];
    const you = me_?.human ? me_.nick : 'YOU';
    this.el.innerHTML = `<div class="title">${o.track.toUpperCase()}</div>
      <div class="times">${you} Finish Time: ${secs(me.time)}<br><span class="${o.newRecord ? 'new' : 'rec'}">${rec}${o.newRecord ? ' NEW!' : ''}</span></div>
      ${in3d ? '<div class="podium3d"></div>' : `<div class="podium">${cols}</div>`}
      <div class="plates">${plates}</div>
      ${o.note ? `<div class="note ${o.note.kind}">${o.note.text}</div>` : ''}
      <div class="cash">You won ${money(me.prize + me.bags)} &nbsp; Cash ${money(o.cash)}${o.credits !== undefined ? ` &nbsp; Credits ${o.credits}` : ''}</div>
      <div class="again">${o.prompt ?? 'PRESS ENTER OR (A) TO RACE AGAIN'}</div>`;
    this.parent.appendChild(this.el);
    if (in3d)
      podiumView().show(
        this.el.querySelector<HTMLElement>('.podium3d')!,
        byPlace.map((r) => ({ place: r.place, colour: o.entries[r.slot].colour, hex: o.entries[r.slot].hex })),
      );
  }

  hide() {
    if (this.el.isConnected && this.el.querySelector('.podium3d')) podiumView().hide();
    this.el.remove();
  }

  get visible() {
    return this.el.isConnected;
  }
}
