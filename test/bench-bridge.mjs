/**
 * How long does the bridge take to answer the settings page?
 *
 * Two of the things the page asks for mean talking to the speakers: playback
 * state and volume for every room, and the library the first time. This times
 * them against a mock household the size of a real one — first with every
 * speaker awake, then with one that accepts the connection and never answers,
 * which is what an unplugged or sleeping speaker looks like on the network.
 *
 * Until 3.6.0 the page could not draw anything until both had come back. Now
 * `/bootstrap` carries neither; the page draws, then asks for them and fills
 * them in. The numbers below are therefore how long the speaker cards show
 * "–%" for, not how long the page is blank.
 *
 * Run with:  node test/bench-bridge.mjs
 */

import { MockHousehold, quietLog } from './mock-sonos.js';
import { SonosSystem } from '../src/sonos/system.js';

const ROOMS = [
  'Bad 1. Sal', 'Badeværelse', 'Bryggers', 'Garage Soundboks', 'Gæsteværelse', 'Kontor',
  'Køkken', 'Køkkenalrum', 'Makeup Værelse', 'Roses Værelse', 'Soveværelse', 'Spisestue',
  'Stue', 'Stue 1. Sal',
];

async function household(asleep = []) {
  const house = new MockHousehold(ROOMS);
  house.favorites = Array.from({ length: 40 }, (_, i) => ({ title: `Favorit ${i}`, description: 'Spotify', uri: `x-sonos-spotify:${i}`, container: i % 2 === 0 }));
  house.playlists = Array.from({ length: 20 }, (_, i) => ({ title: `Playliste ${i}`, uri: `file:///jffs/settings/savedqueues.rsq#${i}` }));
  house.radio = Array.from({ length: 15 }, (_, i) => ({ title: `Radio ${i}`, uri: `x-sonosapi-stream:s${i}` }));
  await house.listen();
  for (const name of asleep) house.asleep.add(name);
  return house;
}

async function timed(label, fn) {
  const start = performance.now();
  await fn();
  const ms = performance.now() - start;
  console.log(`  ${label.padEnd(46)} ${ms.toFixed(0).padStart(6)} ms`);
  return ms;
}

for (const asleep of [[], ['Garage Soundboks']]) {
  const house = await household(asleep);
  const system = new SonosSystem({
    log: quietLog,
    seedHosts: house.players.map((p) => `${p.host}:${p.port}`),
    discoveryTimeout: 100,
    discoverFn: async () => [],
  });

  console.log(asleep.length ? `\n── ${ROOMS.length} speakers, ${asleep.join(', ')} asleep` : `── ${ROOMS.length} speakers, all awake`);
  await timed('startup: discover + topology', () => system.discover({ force: true }));
  await timed('GET /players (no state)', () => system.snapshot({ withState: false }));
  const players = await timed('GET /players?state=1  (speaker cards fill in)', () => system.snapshot({ withState: true }));
  const library = await timed('GET /library, first time', () => system.getLibrary({ force: true }));
  await timed('GET /library, cached', () => system.getLibrary());
  console.log(`  ${'→ everything on screen after'.padEnd(46)} ${Math.max(players, library).toFixed(0).padStart(6)} ms`);

  system.stop?.();
  house.servers.forEach((s) => s.close());
}
