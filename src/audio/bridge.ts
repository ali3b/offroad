// Maps the game's event bus (src/race/events.ts) onto the audio contract (./types.ts) and attaches the audio system.
// Pan comes from each truck's screen x, which only the scene knows, so main.ts passes `screenX`.
// Screens (game/flow.ts `screen` events) pick the music: the attract loop and sign-up play the title song, the shop
// its own; the race and podium music still follow the race phases. The title's demo race stays silent apart from
// the title song (its engines, skids and race music are dropped).

import type { EventBus, GameEvents } from '../race/events';
import { attachAudio } from './index';
import type { AudioBus, AudioEvents } from './types';

type Fn = (e: never) => void;

export function bridgeAudio(game: EventBus<GameEvents>, screenX: (truck: number) => number) {
  const subs = new Map<keyof AudioEvents, Set<Fn>>();
  const send = <K extends keyof AudioEvents>(type: K, e: AudioEvents[K]) => {
    for (const fn of subs.get(type) ?? []) (fn as (e: AudioEvents[K]) => void)(e);
  };
  const bus: AudioBus = {
    on(type, fn) {
      let set = subs.get(type);
      if (!set) subs.set(type, (set = new Set()));
      set.add(fn as Fn);
    },
  };
  attachAudio(bus);

  // The current screen (undefined for a standalone ?scene=race) and the last audio scene sent (no restarts).
  let screen: string | undefined;
  let audioScene: string | undefined;
  const scene = (name: string) => {
    if (name === audioScene) return;
    audioScene = name;
    send('scene', { name });
  };
  const attract = () => screen === 'title' || screen === 'hints' || screen === 'register';
  const SCREEN_MUSIC: Record<string, string | null> = { title: 'title', hints: 'title', register: 'title', shop: 'shop', continue: 'silence', gameover: 'silence' };
  game.on('screen', (e) => {
    screen = e.name;
    const music = SCREEN_MUSIC[e.name];
    if (music) scene(music);
  });

  game.on('engine', (e) => !attract() && send('engine', { truck: e.truck, rpm: e.rpm, throttle: e.throttle, x: screenX(e.truck) }));
  game.on('impact', (e) => {
    if (attract()) return;
    // Ground hits are landings; the land event already covers them.
    if (e.with !== 'ground') send('impact', { strength: e.strength, with: e.with, x: screenX(e.truck) });
  });
  game.on('skid', (e) => !attract() && send('skid', { truck: e.truck, amount: e.intensity, x: screenX(e.truck) }));
  game.on('splash', (e) => !attract() && send('splash', { x: screenX(e.truck) }));
  game.on('nitro', (e) => !attract() && send('nitro', { truck: e.truck, x: screenX(e.truck) }));
  // About a second of air is a big landing.
  game.on('land', (e) => !attract() && send('land', { strength: Math.min(1, e.airTime / 1), x: screenX(e.truck) }));
  game.on('countdown', (e) => attract() || (e.n > 0 ? send('countdown', { n: e.n }) : send('go', undefined)));
  game.on('lap', (e) => !attract() && send('lap', { truck: e.truck, lap: e.lap }));
  game.on('finish', (e) => !attract() && send('finish', { truck: e.truck, place: e.place }));
  game.on('pickup', (e) => !attract() && send('pickup', { kind: e.kind }));
  game.on('phase', (e) => {
    if (attract()) return;
    if (e.phase === 'ready') {
      // Every race start picks the next race song, even when the last scene was a race too.
      audioScene = undefined;
      scene('race');
    } else if (e.phase === 'results') scene('podium');
  });
}
