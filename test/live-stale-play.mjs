// Does Play work on a stream the transport has been sitting on, stopped, for
// over a day — without a fresh SetAVTransportURI? Plays for a few seconds.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SonosPlayer } = require('../src/sonos/player');
const { setLanguage } = require('../src/i18n');
setLanguage('da');

const p = new SonosPlayer({ host: '192.168.167.50', port: 1400 });
await p.describe(4000);
const media = await p.getMediaInfo();
const before = await p.getTransportInfo();
console.log(`${p.name}: ${before.state} on ${media.uri.slice(0, 70)}`);

const t0 = performance.now();
await p.play();
console.log(`Play answered in ${(performance.now() - t0).toFixed(0)} ms`);
for (let i = 1; i <= 8; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  const info = await p.getTransportInfo();
  console.log(`  +${i}s  ${info.state}  status=${info.status}`);
  if (info.state === 'PLAYING') break;
}
await p.stop();
console.log('stopped again');
process.exit(0);
