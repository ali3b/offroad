// The game's flow: which screen is up and which 3D scene (if any) runs behind it.
//
//   title (attract: demo race + logo) → hints → sign-up → get ready → race → results ┬→ shop → get ready → race …
//                                                                                    └→ continue? ─┬→ shop
//                                                                                                  └→ game over → title
// The title's "Continue season" picks a saved season (localStorage or.season) up at the shop.
// ?scene=race / ?scene=test are the standalone scenes (no season); ?scene=shop opens the shop straight away (checks).
// One Loop (fixed 60 Hz physics) drives whatever RaceScene is current; menus read their input once per frame.
import * as THREE from 'three';
import { Loop } from '../engine/loop';
import { clearPressed, confirmPressed, drainMenu, readInput, resetRequested, wasPressed, type MenuEvent } from '../engine/input';
import { NO_INPUT, TUNING, type TruckInput } from '../physics/vehicle';
import { events, type ScreenName } from '../race/events';
import type { TruckModels } from '../race/models';
import { CAMERA } from '../engine/camera';
import { getTrack } from '../track/tracks';
import { RAPIER } from '../physics/world';
import { DebugOverlay } from '../ui/debug';
import { RaceScene, type RaceSceneOpts } from './race-scene';
import { buy, takeContinue, type ShopItem } from './economy';
import { clearSeason, entriesFor, loadSeason, modsBySlot, newSeason, nitrosBySlot, raceFor, saveSeason, settleRace, trackOrder, type NextRace, type SeasonState } from './season';
import type { Colour } from '../race/roster';
import type { Screen } from '../ui/screens/common';
import { TitleScreen } from '../ui/screens/title';
import { HintsScreen } from '../ui/screens/hints';
import { GetReadyScreen, RegisterScreen } from '../ui/screens/register';
import { ShopScreen } from '../ui/screens/shop';
import { ContinueScreen, GameOverScreen } from '../ui/screens/continue';
import { money } from './economy';
import { ResultsScreen } from '../ui/results';
import { podiumView } from '../ui/podium-view';
import { cycleDosLook, dosLabel, getSettings, setSettings } from '../engine/retro';
import { toast } from '../ui/toast';
import { PRIZES, ROSTER } from '../race/roster';

export type FlowState = ScreenName | 'standalone' | 'loading';

/** Minimum time the GET READY! screen stays up (real seconds), while the race builds behind it. */
const GET_READY_SECONDS = 1.6;

export class Flow {
  readonly loop: Loop;
  readonly debug: DebugOverlay;
  state: FlowState = 'loading';
  race: RaceScene | null = null;
  screen: Screen | null = null;
  season: SeasonState | null = null;
  /** The race being driven (season) or about to be. */
  next: NextRace | null = null;
  /** Standalone ?scene=race: prize money won this page session. */
  private standaloneCash = 0;
  private override: TruckInput | null = null;
  private buildToken = 0;
  private demoIndex = Math.floor(Math.random() * 64);
  private demoRebuild = false;
  private readyT = 0;
  private readyScene: RaceScene | null = null;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly models: TruckModels | null,
    readonly params: URLSearchParams,
  ) {
    this.debug = new DebugOverlay(document.body);
    if (params.has('debug')) this.debug.toggle(true);
    this.loop = new Loop({ step: (dt) => this.step(dt), render: (_a, frameDt) => this.render(frameDt) });
    window.addEventListener('resize', () => this.resize());
  }

  // ---- scenes and screens --------------------------------------------------------------------------------------

  private setScreen(name: FlowState, screen: Screen | null) {
    this.screen?.dispose();
    this.screen = screen;
    if (screen) document.body.appendChild(screen.el);
    this.state = name;
    clearPressed();
    if (name !== 'standalone' && name !== 'loading') events.emit('screen', { name });
  }

  private setRace(scene: RaceScene | null) {
    if (this.race && this.race !== scene) this.race.dispose();
    this.race = scene;
    if (scene) this.resize();
  }

  /** Build a race scene; null if another build or screen change superseded it meanwhile. */
  private async build(opts: RaceSceneOpts): Promise<RaceScene | null> {
    const token = ++this.buildToken;
    const scene = await RaceScene.create(opts);
    if (token !== this.buildToken) {
      scene.dispose();
      return null;
    }
    // Let the trucks settle on their springs before the first frame (a race holds them on the grid meanwhile).
    for (let t = 0; t < (opts.mode === 'test' ? 1 : 0.5); t += 1 / 60) scene.step(1 / 60, NO_INPUT);
    return scene;
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.race?.resize();
  }

  // ---- states --------------------------------------------------------------------------------------------------

  /** ?scene=test / ?scene=race: one scene, no season (Enter restarts a finished race). */
  async standalone(kind: 'test' | 'race') {
    const p = this.params;
    const reversed = p.has('reverse') && p.get('reverse') !== '0';
    const data = getTrack(p.get('track') ?? (kind === 'race' ? 'rattlesnake' : 'test'), reversed);
    const scene = await this.build({
      data,
      name: data.name + (reversed ? ' (R)' : ''),
      mode: kind,
      models: this.models,
      cpus: Number(p.get('cpus') ?? 3),
      autopilot: p.has('autopilot'),
    });
    this.setRace(scene);
    this.setScreen('standalone', null);
  }

  async toTitle() {
    ++this.buildToken;
    this.setRace(null);
    const s = loadSeason();
    const p = s?.players[0];
    const save = s && p ? `${p.initials} &middot; RACE ${s.race + 1} &middot; ${money(p.cash)}` : null;
    this.setScreen('title', new TitleScreen({ save, onNew: () => this.toHints(), onContinue: () => this.continueSeason() }));
    await this.demo();
  }

  /** The attract race behind the title: the next track in the order, a random direction, every truck on AI. */
  private async demo() {
    const order = trackOrder();
    const id = order[this.demoIndex++ % order.length];
    const reversed = Math.random() < 0.5 && !!getTrack(id).reverse;
    const data = getTrack(id, reversed);
    const scene = await this.build({ data, name: data.name + (reversed ? ' (R)' : ''), mode: 'demo', models: this.models });
    if (scene && this.state === 'title') this.setRace(scene);
    else scene?.dispose();
  }

  toHints() {
    this.setRace(null);
    ++this.buildToken;
    this.setScreen('hints', new HintsScreen({ onNext: () => this.toRegister(), onBack: () => this.toTitle() }));
  }

  toRegister() {
    const last = loadSeason()?.players[0];
    this.setScreen(
      'register',
      new RegisterScreen({
        initials: last?.initials,
        colour: last?.colour,
        onDone: (p) => this.startSeason([p]),
        onBack: () => this.toHints(),
      }),
    );
  }

  startSeason(players: { initials: string; colour: Colour }[]) {
    this.season = newSeason(players);
    saveSeason(this.season);
    this.toGetReady();
  }

  continueSeason() {
    this.season = loadSeason();
    if (!this.season) return this.toTitle();
    if (this.season.players[0].credits <= 0) this.toContinue();
    else this.toShop();
  }

  /** GET READY! while the next race builds; then the race. */
  async toGetReady() {
    const s = this.season!;
    this.next = raceFor(s.race);
    this.setRace(null);
    this.readyT = 0;
    this.readyScene = null;
    this.setScreen('getready', new GetReadyScreen({ players: s.players, track: this.next.data, trackName: this.next.name, raceNo: s.race + 1 }));
    const scene = await this.build({
      data: this.next.data,
      name: this.next.name,
      mode: 'season',
      models: this.models,
      entries: entriesFor(s),
      mods: modsBySlot(s),
      nitros: nitrosBySlot(s),
    });
    if (scene && this.state === 'getready') this.readyScene = scene;
    else scene?.dispose();
  }

  private toRace() {
    this.setRace(this.readyScene);
    this.readyScene = null;
    this.setScreen('race', null);
  }

  /** The season race just ended: bank it and show the podium with FREE RACE! / CREDIT LOST. */
  private seasonResults(r: RaceScene) {
    const race = r.race!;
    const results = race.results!;
    const s = settleRace(this.season!, results, r.session.racers.map((x) => x.truck.nitros), r.session.track.data.id);
    this.season = s;
    saveSeason(s);
    const o = s.last!.outcomes[0];
    const me = s.players[0];
    r.results.show({
      track: r.opts.name,
      results,
      entries: r.session.racers.map((x) => x.entry),
      record: race.record,
      newRecord: race.newRecord,
      cash: me.cash,
      credits: me.credits,
      note: o.free ? { text: 'FREE RACE!', kind: 'free' } : o.creditLost ? { text: o.out ? 'NO CREDITS LEFT' : 'CREDIT LOST', kind: 'lost' } : undefined,
      prompt: o.out ? 'PRESS ENTER OR (A)' : 'PRESS ENTER OR (A) FOR THE SPEED SHOP',
    });
    this.setScreen('results', null);
  }

  toShop() {
    const s = this.season!;
    this.setRace(null);
    ++this.buildToken;
    this.next = raceFor(s.race);
    this.setScreen(
      'shop',
      new ShopScreen({
        player: () => this.season!.players[0],
        cpus: () => this.season!.cpus,
        next: this.next,
        raceNo: s.race + 1,
        onBuy: (item) => this.buy(item),
        onStart: () => this.toGetReady(),
        onQuit: () => this.toTitle(),
      }),
    );
  }

  /** Buy for player 1; false when it can't be bought. */
  buy(item: ShopItem, player = 0) {
    const s = this.season!;
    const r = buy(s.players[player], item);
    if (!r.ok) return false;
    s.players[player] = r.garage;
    saveSeason(s);
    return true;
  }

  toContinue() {
    this.setRace(null);
    const s = this.season!;
    this.setScreen(
      'continue',
      new ContinueScreen({
        player: s.players[0],
        onContinue: () => {
          s.players[0] = takeContinue(s.players[0]);
          saveSeason(s);
          this.toShop();
        },
        onGiveUp: () => this.toGameOver(),
      }),
    );
  }

  toGameOver() {
    const s = this.season;
    clearSeason();
    this.season = null;
    this.setScreen('gameover', new GameOverScreen({ races: s?.race ?? 0, initials: s?.players[0].initials ?? '', onDone: () => this.toTitle() }));
  }

  /** ?scene=shop (checks): the saved season's shop, or a fresh one with some cash (&cash=, default 250000; &race=). */
  openShop() {
    let s = loadSeason();
    if (!s) {
      s = newSeason([{ initials: 'ACE', colour: (this.params.get('colour') as Colour) ?? 'red' }]);
      s.players[0].cash = Number(this.params.get('cash') ?? 250_000);
      s.race = Number(this.params.get('race') ?? 1);
    }
    this.season = s;
    this.toShop();
  }

  /** ?scene=podium (screenshots): the results screen with made-up results, no race behind it. */
  async podiumScene() {
    const order = (this.params.get('order') ?? '2,0,1,3').split(',').map(Number);
    const results = order.map((slot, i) => {
      const laps = [16.4, 15.9, 16.1, 16.0].map((t) => t + i * 0.4 + slot * 0.05);
      const time = laps.reduce((a, b) => a + b, 0);
      return { slot, place: i + 1, time, prize: PRIZES[i], bags: i === 0 ? 12_000 : 0, lapTimes: laps, best: Math.min(...laps), avg: time / 4 };
    });
    results.sort((a, b) => a.slot - b.slot);
    const screen = new ResultsScreen(document.body);
    screen.show({ track: 'Rattlesnake Run', results, entries: ROSTER, record: { time: 63.2, who: 'STEEL' }, newRecord: false, cash: 102_000 });
    this.setScreen('results', null);
    await podiumView().ready;
  }

  // ---- loop hooks ----------------------------------------------------------------------------------------------

  private step(dt: number) {
    const r = this.race;
    if (!r) return;
    const st = this.state;
    const driving = st === 'race' || st === 'standalone';
    if (driving && st === 'standalone' && resetRequested()) r.restart();
    r.step(dt, this.override ?? (driving ? readInput() : NO_INPUT));
    if (r.takeResults()) {
      if (r.mode === 'season' && st === 'race') this.seasonResults(r);
      else if (r.mode === 'race') {
        const me = r.race!.results![0];
        this.standaloneCash += me.prize + me.bags;
        r.results.show({ track: r.opts.name, results: r.race!.results!, entries: r.session.racers.map((x) => x.entry), record: r.race!.record, newRecord: r.race!.newRecord, cash: this.standaloneCash });
      } else if (r.mode === 'demo') this.demoRebuild = true;
    }
  }

  private render(frameDt: number) {
    if (wasPressed('F3')) this.debug.toggle();
    if (wasPressed('F2')) toast(`DOS LOOK: ${dosLabel(cycleDosLook())}`);
    const st = this.state;
    // Menus: every press goes to the screen; the results podium waits for confirm.
    if (st === 'standalone') {
      if (this.race?.resultsShown && confirmPressed()) this.race.restart();
    } else {
      for (const e of drainMenu()) this.press(e);
    }
    this.screen?.tick?.(frameDt);
    if (this.state === 'getready') {
      this.readyT += frameDt;
      if (this.readyScene && this.readyT >= GET_READY_SECONDS) this.toRace();
    }
    if (this.demoRebuild && this.state === 'title') {
      this.demoRebuild = false;
      void this.demo();
    }
    const r = this.race;
    if (r) {
      r.render(this.renderer, frameDt);
      this.debug.update(r.session.truck.state(), this.loop);
    }
  }

  /** One menu press (keyboard/pad, or a test). */
  press(e: MenuEvent) {
    if (this.state === 'results') {
      if (e.key !== 'confirm' || !this.season) return;
      const o = this.season?.last?.outcomes[0];
      if (o?.out) this.toContinue();
      else this.toShop();
      return;
    }
    this.screen?.input(e);
  }

  // ---- the test handle -----------------------------------------------------------------------------------------

  /** window.__or: the race handles follow the current scene; `flow` drives the menus. */
  installHandles(target: Record<string, unknown>) {
    const scene = () => {
      if (!this.race) throw new Error(`no race scene on screen "${this.state}"`);
      return this.race;
    };
    const live = (name: string, get: () => unknown) => Object.defineProperty(target, name, { get, enumerable: true, configurable: true });
    live('session', () => this.race?.session ?? null);
    live('race', () => this.race?.race ?? null);
    live('simTime', () => this.loop.simTime);
    Object.assign(target, {
      THREE,
      RAPIER,
      events,
      tuning: TUNING,
      camera: CAMERA,
      loop: this.loop,
      models: !!this.models,
      truck: () => scene().session.truck.state(),
      trucks: () => scene().session.racers.map((r) => r.truck.state()),
      /** Upgrade multipliers per truck (slot order). */
      mods: () => scene().session.racers.map((r) => ({ colour: r.entry.colour, ...r.truck.mods })),
      raceState: () => this.race?.race?.snapshot() ?? null,
      autopilot: (on = true) => scene().race && (scene().race!.autopilot = on),
      restart: () => scene().restart(),
      resultsVisible: () => !!this.race?.results.visible,
      /** The results screen's 3D podium (ui/podium-view.ts): stop(), tick(dt), info. */
      podium: () => podiumView(),
      /** The saved settings (localStorage or.settings): get, or set e.g. { dos: true, palette: 16 }. */
      settings: (s?: Partial<ReturnType<typeof getSettings>>) => {
        if (s) setSettings({ ...getSettings(), ...s });
        return getSettings();
      },
      /** The grandstand fans: cheer(s), cheering, drawCalls(), ready. */
      crowd: () => scene().session.crowd,
      /** The race scene's camera (tools: close-ups for screenshots; a resize re-fits it). */
      camera3d: () => scene().camera,
      /** The main renderer's last frame: draw calls (incl. the shadow pass) and triangles. */
      renderInfo: () => ({ calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles }),
      setInput: (i: Partial<TruckInput> | null) => (this.override = i ? { ...NO_INPUT, ...i } : null),
      reset: () => scene().session.reset(),
      place: (x: number, z: number, heading = 0, lift = 1.4) => {
        const s = scene().session;
        s.truck.place({ x, z, y: s.track.heightAt(x, z) + lift, heading });
      },
      advance: (s: number) => this.loop.advance(s),
      debug: (on?: boolean) => this.debug.toggle(on),
      groundCheck: () => scene().groundCheck(),
      heightAt: (x: number, z: number) => scene().session.track.heightAt(x, z),
      line: () => {
        const l = scene().session.track.line;
        return l && { length: l.length, points: l.samples(2) };
      },
      flow: {
        /** Where the game is: the screen, the season summary and the race being driven. */
        state: () => {
          const s = this.season;
          const p = s?.players[0];
          return {
            screen: this.state,
            race: s?.race ?? null,
            next: this.next && { id: this.next.id, reversed: this.next.reversed, name: this.next.name, cycle: this.next.slot.cycle },
            track: this.race ? { id: this.race.session.track.data.id, mode: this.race.mode } : null,
            player: p ? { initials: p.initials, colour: p.colour, cash: p.cash, credits: p.credits, nitros: p.nitros, levels: { ...p.levels } } : null,
            last: s?.last ?? null,
            shopCursor: this.screen instanceof ShopScreen ? this.screen.item : null,
          };
        },
        season: () => (this.season ? structuredClone(this.season) : null),
        /** Tests: change the season (e.g. credits) and save it. */
        patchPlayer: (patch: Record<string, unknown>) => {
          Object.assign(this.season!.players[0], patch);
          saveSeason(this.season!);
        },
        /** A menu press: 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back', or { letter: 'Q' }. */
        press: (k: string | MenuEvent) => this.press(typeof k === 'string' ? { key: k as MenuEvent['key'] } : k),
        /** Tests: run the menus' clocks (countdowns, get ready) by `s` seconds. */
        tick: (s: number) => {
          for (let t = 0; t < s; t += 0.1) this.render(0.1);
        },
        /** Tests: end the current race with this finishing order (slots, winner first). */
        forceFinish: (order: number[]) => scene().race!.forceFinish(order),
        order: () => trackOrder(),
        raceFor: (i: number) => {
          const n = raceFor(i);
          return { id: n.id, reversed: n.reversed, name: n.name, cycle: n.slot.cycle };
        },
        text: () => (this.screen?.el.innerText ?? this.race?.results.el.innerText ?? ''),
      },
    });
  }
}
