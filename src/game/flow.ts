// The game's flow: which screen is up and which 3D scene (if any) runs behind it.
//
//   title (attract: demo race + logo) → hints → sign-up → get ready → race → results ┬→ shop → get ready → race …
//                                                                                    └→ continue? ─┬→ shop
//                                                                                                  └→ game over → title
// The title's "Continue season" picks a saved season (localStorage or.season) up at the shop.
// Local multiplayer: 1..3 humans sign up; each drives with their own keys / pad (engine/input.ts readPlayers), banks
// their own money, shops in turn and gets their own CONTINUE? countdown; a human who gives up becomes a CPU truck.
// ?scene=race / ?scene=test are the standalone scenes (no season); ?scene=shop opens the shop straight away (checks).
// One Loop (fixed 60 Hz physics) drives whatever RaceScene is current; menus read their input once per frame.
import * as THREE from 'three';
import { Loop } from '../engine/loop';
import { clearPressed, confirmPressed, drainMenu, onInputMode, padsFor, readInput, readPlayers, resetRequested, takeTap, wasPressed, type Control, type KeyScheme, type MenuEvent } from '../engine/input';
import { applyQuality, onQuality, qualityInfo, watchFps } from '../engine/quality';
import { getAudio } from '../audio';
import { TouchControls } from '../ui/touch/controls';
import { PauseMenu, type PauseChoice } from '../ui/touch/pause';
import { portraitBlocked, setHumanCheck } from '../ui/touch/mobile';
import { NO_INPUT, TUNING, type TruckInput } from '../physics/vehicle';
import { events, type ScreenName } from '../race/events';
import type { TruckModels } from '../race/models';
import { CAMERA } from '../engine/camera';
import { getTrack } from '../track/tracks';
import { RAPIER } from '../physics/world';
import { DebugOverlay } from '../ui/debug';
import { RaceScene, type RaceSceneOpts } from './race-scene';
import { buy, takeContinue, type ShopItem } from './economy';
import { clearSeason, dropToCpu, entriesFor, loadSeason, modsBySlot, newSeason, nitrosBySlot, outPlayers, raceFor, saveSeason, settleQuit, settleRace, trackOrder, type NextRace, type SeasonState } from './season';
import type { Colour } from '../race/roster';
import type { Screen } from '../ui/screens/common';
import { TitleScreen } from '../ui/screens/title';
import { HintsScreen } from '../ui/screens/hints';
import { GetReadyScreen, RegisterScreen, type SignUp } from '../ui/screens/register';
import { ShopScreen } from '../ui/screens/shop';
import { ContinueScreen, GameOverScreen, type ContinueChoice } from '../ui/screens/continue';
import { money } from './economy';
import { ResultsScreen } from '../ui/results';
import { podiumView } from '../ui/podium-view';
import { cycleDosLook, dosLabel, getSettings, setSettings } from '../engine/retro';
import { toast } from '../ui/toast';
import { HEX, PRIZES, ROSTER } from '../race/roster';

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
  /** Tests: a fixed input per human (window.__or.setInput). */
  private override: (TruckInput | null)[] = [];
  /** Each human's controls (index = player): their keyboard layout and the pad they joined with. */
  controls: Control[] = [{ keys: 'solo', pad: null }];
  /** Pads that joined at the sign-up, by colour (this page session; a reload lends pads in join order). */
  private joinedPads = new Map<Colour, number>();
  private buildToken = 0;
  private demoIndex = Math.floor(Math.random() * 64);
  private demoRebuild = false;
  private readyT = 0;
  private readyScene: RaceScene | null = null;
  /** The on-screen race controls (touch mode) and the pause menu. */
  readonly touch = new TouchControls();
  readonly pause: PauseMenu;
  /** The race is paused (the pause menu is up): no physics steps. */
  paused = false;
  private reserveKey = '';

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly models: TruckModels | null,
    readonly params: URLSearchParams,
  ) {
    this.debug = new DebugOverlay(document.body);
    if (params.has('debug')) this.debug.toggle(true);
    this.loop = new Loop({ step: (dt) => this.step(dt), render: (_a, frameDt) => this.render(frameDt) });
    window.addEventListener('resize', () => this.resize());
    this.pause = new PauseMenu({ onChoose: (c) => this.pauseChoice(c), soundLabel: () => (getAudio().settings.muted ? 'OFF' : 'ON') });
    // The touch controls come and go with the input mode: re-fit the camera around them.
    onInputMode(() => this.syncTouch());
    onQuality(() => {
      applyQuality(this.renderer);
      this.race?.applyQuality();
    });
    setHumanCheck((i) => !!this.race && this.race.mode !== 'demo' && this.race.session.isHuman(i));
    // Leaving the page (or the app) mid-race pauses it.
    document.addEventListener('visibilitychange', () => document.hidden && this.driving() && this.openPause());
  }

  // ---- touch, pause ----------------------------------------------------------------------------------------------

  /** A race the player drives is on screen (season race or standalone), not finished. */
  private driving() {
    const st = this.state;
    return (st === 'race' || st === 'standalone') && !!this.race && !this.race.resultsShown;
  }

  /** Show / hide the touch controls and the II button; re-fit the camera when what they cover changes. */
  private syncTouch() {
    const on = this.driving() && !this.paused;
    this.touch.show(on);
    this.pause.showButton(on);
    const r = this.touch.reserve();
    const key = r ? `${r.left},${r.right},${r.bottom},${window.innerWidth}x${window.innerHeight}` : '';
    if (key !== this.reserveKey) {
      this.reserveKey = key;
      this.race?.resize(r);
    }
  }

  openPause() {
    if (this.paused || !this.driving()) return;
    this.paused = true;
    this.touch.release();
    this.pause.show(this.state === 'standalone');
    void getAudio().ctx?.suspend();
    this.syncTouch();
  }

  private closePause() {
    if (!this.paused) return;
    this.paused = false;
    this.pause.hide();
    clearPressed();
    void getAudio().ctx?.resume();
    this.syncTouch();
  }

  private pauseChoice(c: PauseChoice) {
    if (c === 'sound') {
      const a = getAudio();
      a.setMuted(!a.settings.muted);
      return;
    }
    this.closePause();
    if (c === 'restart') this.race?.restart();
    else if (c === 'quit') this.quitSeasonRace();
  }

  /** QUIT TO TITLE from a season race: every human counts as finishing last (credit lost, no prize), then the title. */
  private quitSeasonRace() {
    const r = this.race;
    if (this.state === 'race' && this.season && r?.race && !r.resultsShown) {
      this.season = settleQuit(this.season, r.session.racers.map((x) => x.truck.nitros), r.session.track.data.id);
      saveSeason(this.season);
    }
    void this.toTitle();
  }

  // ---- scenes and screens --------------------------------------------------------------------------------------

  private setScreen(name: FlowState, screen: Screen | null) {
    if (this.paused) {
      this.paused = false;
      this.pause.hide();
      void getAudio().ctx?.resume();
    }
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
    this.reserveKey = '';
    this.race?.resize(this.touch.reserve());
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
    const save = s && p ? (s.players.length > 1 ? `${s.players.map((x) => x.initials).join(' + ')} &middot; RACE ${s.race + 1}` : `${p.initials} &middot; RACE ${s.race + 1} &middot; ${money(p.cash)}`) : null;
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
    const last = loadSeason()?.players;
    this.setScreen(
      'register',
      new RegisterScreen({
        last: last?.map((p) => ({ initials: p.initials, colour: p.colour })),
        onDone: (players) => this.startSeason(players),
        onBack: () => this.toHints(),
      }),
    );
  }

  /** Sign-ups → a new season. Alone = the whole keyboard and any pad; 2–3 humans split the keyboard (input.ts). */
  startSeason(players: (SignUp | { initials: string; colour: Colour })[]) {
    const n = players.length;
    const kbFree: KeyScheme[] = ['wasd', 'arrows'].filter((k) => !players.some((p) => 'src' in p && p.src === k)) as KeyScheme[];
    this.joinedPads.clear();
    const withKeys = players.map((p) => {
      const src = 'src' in p ? p.src : 'kb';
      if (src.startsWith('pad')) this.joinedPads.set(p.colour, Number(src.slice(3)));
      const keys: KeyScheme | null = n === 1 ? 'solo' : src === 'wasd' || src === 'arrows' ? src : src === 'kb' ? (kbFree.shift() ?? null) : null;
      return { initials: p.initials, colour: p.colour, keys };
    });
    this.season = newSeason(withKeys);
    saveSeason(this.season);
    this.syncControls();
    this.toGetReady();
  }

  /** Controls follow the season's players (after a sign-up, a reload or a human dropping out). */
  private syncControls() {
    const ps = this.season?.players ?? [];
    this.controls = ps.length ? ps.map((p) => ({ keys: p.keys, pad: ps.length > 1 ? (this.joinedPads.get(p.colour) ?? null) : null })) : [{ keys: 'solo', pad: null }];
  }

  continueSeason() {
    this.season = loadSeason();
    if (!this.season) return this.toTitle();
    this.syncControls();
    if (outPlayers(this.season).length) this.toContinue();
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
    const noteOf = (x: typeof o) => (x.free ? { text: 'FREE RACE!', kind: 'free' as const } : x.creditLost ? { text: x.out ? 'NO CREDITS LEFT' : 'CREDIT LOST', kind: 'lost' as const } : undefined);
    const anyOut = outPlayers(s).length > 0;
    r.results.show({
      track: r.opts.name,
      results,
      entries: r.session.racers.map((x) => x.entry),
      record: race.record,
      newRecord: race.newRecord,
      cash: me.cash,
      credits: me.credits,
      note: noteOf(o),
      prompt: anyOut ? 'PRESS START OR (A)' : 'PRESS START OR (A) FOR THE SPEED SHOP',
      touchPrompt: anyOut ? 'TAP TO GO ON' : 'TAP FOR THE SPEED SHOP',
      // Slot = player index (the line-up puts the humans first).
      humans: s.players.map((p, i) => ({ slot: i, nick: p.initials, hex: HEX[p.colour], cash: p.cash, credits: p.credits, note: noteOf(s.last!.outcomes[i]) })),
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
        players: () => this.season!.players,
        cpus: () => this.season!.cpus,
        next: this.next,
        raceNo: s.race + 1,
        onBuy: (item, player) => this.buy(item, player),
        onStart: () => this.toGetReady(),
        onQuit: () => this.toTitle(),
      }),
    );
  }

  /** Buy for a player (default player 1); false when it can't be bought. */
  buy(item: ShopItem, player = 0) {
    const s = this.season!;
    const r = buy(s.players[player], item);
    if (!r.ok) return false;
    s.players[player] = r.garage;
    saveSeason(s);
    return true;
  }

  /** CONTINUE? for every human out of credits, each with their own countdown; the rest wait. */
  toContinue() {
    this.setRace(null);
    const s = this.season!;
    const initials = s.players.map((p) => p.initials).join(' + ');
    this.setScreen(
      'continue',
      new ContinueScreen({
        players: s.players,
        out: outPlayers(s),
        onDone: (choices: Record<number, ContinueChoice>) => {
          let next = s;
          for (const [i, c] of Object.entries(choices)) if (c === 'continue') next.players[+i] = takeContinue(next.players[+i]);
          // Those who gave up become CPU drivers (highest index first so the others keep their places).
          for (const i of Object.keys(choices).map(Number).sort((a, b) => b - a)) if (choices[i] === 'out') next = dropToCpu(next, i);
          if (!next.players.length) return this.toGameOver(initials);
          this.season = next;
          saveSeason(next);
          this.syncControls();
          this.toShop();
        },
      }),
    );
  }

  toGameOver(initials?: string) {
    const s = this.season;
    clearSeason();
    this.season = null;
    this.setScreen('gameover', new GameOverScreen({ races: s?.race ?? 0, initials: initials ?? s?.players.map((p) => p.initials).join(' + ') ?? '', onDone: () => this.toTitle() }));
  }

  /** ?scene=shop (checks): the saved season's shop, or a fresh one with some cash (&cash=, default 250000; &race=). */
  openShop() {
    let s = loadSeason();
    if (!s) {
      // &players=2|3: a local multiplayer season (player 1 in &colour, the others in the next free colours).
      const n = Math.max(1, Math.min(3, Number(this.params.get('players') ?? 1)));
      const first = (this.params.get('colour') as Colour) ?? 'red';
      const colours = [first, ...(['red', 'yellow', 'blue'] as Colour[]).filter((c) => c !== first)].slice(0, n);
      s = newSeason(colours.map((colour, i) => ({ initials: ['ACE', 'JET', 'MAX'][i], colour })));
      s.players.forEach((p, i) => (p.cash = Number(this.params.get('cash') ?? 250_000) - i * 60_000));
      s.race = Number(this.params.get('race') ?? 1);
    }
    this.season = s;
    this.syncControls();
    this.toShop();
  }

  /** ?scene=register (screenshots): the sign-up, with &join=wasd,arrows,pad0 already joined (initials entered). */
  openRegister() {
    this.toRegister();
    const joins = (this.params.get('join') ?? '').split(',').filter(Boolean) as MenuEvent['src'][];
    const scr = this.screen as RegisterScreen;
    joins.forEach((src, k) => {
      scr.input({ key: 'confirm', src });
      // The first one confirms the initials and readies up; the next one stays on the initials.
      if (k === 0) for (let j = 0; j < 4; j++) scr.input({ key: 'confirm', src });
    });
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
    if (!r || this.paused) return;
    const st = this.state;
    const driving = st === 'race' || st === 'standalone';
    if (driving && st === 'standalone' && resetRequested()) r.restart();
    r.step(dt, driving ? this.humanInputs(st === 'standalone') : NO_INPUT);
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
    const isPause = (e: MenuEvent) => e.tap === 'pause' || e.key === 'back' || e.letter === 'P';
    // Menus: every press goes to the screen; the results podium waits for confirm. A race pauses on Esc / P / II.
    if (this.paused) {
      for (const e of drainMenu()) this.pause.input(e);
    } else if (st === 'standalone') {
      // Standalone: R and Enter are read as key presses (resetRequested, confirmPressed), so don't drain the keys.
      const tapConfirm = takeTap((e) => e.key === 'confirm');
      if (this.race?.resultsShown && (confirmPressed() || tapConfirm)) this.race.restart();
      else if (takeTap((e) => e.tap === 'pause') || wasPressed('Escape') || wasPressed('KeyP')) this.openPause();
    } else {
      for (const e of drainMenu()) {
        if (st === 'race' && isPause(e)) this.openPause();
        else this.press(e);
      }
    }
    // Portrait on a touch screen (the rotate card) pauses a race.
    if (portraitBlocked() && this.driving()) this.openPause();
    this.syncTouch();
    // Auto quality: a slow race drops to low (engine/quality.ts).
    if (this.race && (this.driving() || st === 'title') && watchFps(this.loop.fps, frameDt)) toast('QUALITY: LOW (AUTO)');
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

  /** Each human's input this step (the test override wins per player). */
  private humanInputs(standalone: boolean): TruckInput[] {
    const live = standalone ? [readInput()] : readPlayers(this.controls);
    const n = Math.max(live.length, this.override.length);
    return Array.from({ length: n }, (_, i) => this.override[i] ?? live[i] ?? NO_INPUT);
  }

  /**
   * Which human a menu press belongs to: their keyboard side or their pad (2+ humans). undefined = anyone (one human,
   * Esc / Backspace, tests); -1 = nobody (e.g. the arrows side when no human drives with the arrows).
   */
  ownerOf(e: MenuEvent): number | undefined {
    if (e.player !== undefined) return e.player;
    const s = this.season;
    if (!s || s.players.length <= 1 || !e.src || e.src === 'kb') return undefined;
    // Taps are player 1's (a touch player is always player 1).
    if (e.src === 'touch') return 0;
    if (e.src === 'wasd' || e.src === 'arrows') {
      const i = s.players.findIndex((p) => p.keys === e.src);
      return i >= 0 ? i : -1;
    }
    const i = padsFor(this.controls).indexOf(Number(e.src.slice(3)));
    return i >= 0 ? i : -1;
  }

  /** One menu press (keyboard/pad, or a test). */
  press(e: MenuEvent) {
    if (this.state === 'results') {
      if (e.key !== 'confirm' || !this.season) return;
      if (outPlayers(this.season).length) this.toContinue();
      else this.toShop();
      return;
    }
    this.screen?.input({ ...e, player: this.state === 'register' ? e.player : this.ownerOf(e) });
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
      /** Tests: hold a fixed input for a human (default player 1); null gives the keys / pad back. */
      setInput: (i: Partial<TruckInput> | null, player = 0) => (this.override[player] = i ? { ...NO_INPUT, ...i } : null),
      /** The humans' controls: keyboard layout, joined pad, the pad lent right now. */
      controls: () => {
        const pads = padsFor(this.controls);
        return this.controls.map((c, i) => ({ ...c, padNow: pads[i] }));
      },
      reset: () => scene().session.reset(),
      /** Render quality: setting, level, why; `{ watchFps: true }` turns the fps watch on under webdriver. */
      quality: (o?: { watchFps?: boolean }) => qualityInfo(o),
      /** The touch controls: visible, the input they send, how the camera made room. */
      touch: () => ({ visible: this.touch.visible, input: this.touch.last, reserve: this.touch.reserve(), fit: this.race?.fit ?? null, paused: this.paused }),
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
          const scr = this.screen;
          return {
            screen: this.state,
            race: s?.race ?? null,
            next: this.next && { id: this.next.id, reversed: this.next.reversed, name: this.next.name, cycle: this.next.slot.cycle },
            track: this.race ? { id: this.race.session.track.data.id, mode: this.race.mode } : null,
            player: p ? { initials: p.initials, colour: p.colour, cash: p.cash, credits: p.credits, nitros: p.nitros, levels: { ...p.levels } } : null,
            players: (s?.players ?? []).map((x) => ({ initials: x.initials, colour: x.colour, keys: x.keys, cash: x.cash, credits: x.credits, nitros: x.nitros, levels: { ...x.levels } })),
            cpus: (s?.cpus ?? []).map((c) => ({ colour: c.colour, cash: c.cash, levels: { ...c.levels } })),
            last: s?.last ?? null,
            shopCursor: scr instanceof ShopScreen ? scr.item : null,
            shopTurn: scr instanceof ShopScreen ? scr.turn : null,
            signup: scr instanceof RegisterScreen ? scr.cards.map((c) => ({ src: c.src, colour: c.colour, initials: c.letters.join(''), step: c.step })) : null,
            continue: scr instanceof ContinueScreen ? { left: { ...scr.left }, choice: { ...scr.choice } } : null,
          };
        },
        season: () => (this.season ? structuredClone(this.season) : null),
        /** Tests: change the season (e.g. credits) and save it. */
        patchPlayer: (patch: Record<string, unknown>, player = 0) => {
          Object.assign(this.season!.players[player], patch);
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
