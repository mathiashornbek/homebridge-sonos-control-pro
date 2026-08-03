'use strict';

const dgram = require('node:dgram');
const os = require('node:os');

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
/** How soon the second M-SEARCH burst goes out. Must be inside `graceMs`. */
const REBURST_MS = 150;
const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:ZonePlayer:1',
  'urn:smartspeaker-audio:service:SpeakerGroup:1',
];

/**
 * Build an M-SEARCH datagram for one search target.
 * @param {string} target
 * @param {number} mx Seconds a responder may wait before answering.
 */
function searchMessage(target, mx) {
  return Buffer.from(
    [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      `MX: ${mx}`,
      `ST: ${target}`,
      '',
      '',
    ].join('\r\n'),
  );
}

/** Every non-internal IPv4 address on this machine — we search from all of them. */
function localIPv4Addresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      const family = typeof entry.family === 'number' ? entry.family : entry.family === 'IPv4' ? 4 : 6;
      if (family === 4 && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

/**
 * Pull the LOCATION header out of an SSDP response and reduce it to an address.
 *
 * The port is kept as well as the host. Real Sonos always answers on 1400, so
 * this changes nothing in a normal household — but a device behind a port map,
 * and every player in the test household, are then reachable at the address
 * they actually announced instead of the one we assumed.
 *
 * @param {string} message
 * @returns {{ host: string, port: number|null, location: string, usn: string } | null}
 */
function parseResponse(message) {
  const headers = Object.create(null);
  for (const line of message.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  const location = headers.location;
  if (!location) return null;
  // Case-insensitive, because `HTTP://` is legal and used to return null.
  // The bracketed form is IPv6: `http://[fd00::1]:1400/…`. Matching the old
  // way gave `host: "[fd00"`, and every later connection to that "speaker"
  // was an ENOTFOUND that burned a full describe timeout.
  const match = /^https?:\/\/(\[[^\]]+\]|[^:/]+)(?::(\d+))?/i.exec(location);
  if (!match) return null;
  return {
    host: match[1],
    port: match[2] ? Number(match[2]) : null,
    location,
    usn: headers.usn || '',
    st: headers.st || '',
    server: headers.server || '',
  };
}

/**
 * Does this answer come from a Sonos player?
 *
 * Plenty of devices reply to an M-SEARCH regardless of the ST they were asked
 * about — routers, NAS boxes, printers, televisions. Accepting them meant
 * describing a router as a speaker, and with `stopAfterFirst` a router that
 * answered in 20 ms ended discovery before a single real speaker had replied:
 * zero players found, four seconds spent, and a warning that blamed the
 * addresses in `playerIps`, which were not involved.
 *
 * Sonos identifies itself three ways, and any one of them is enough.
 *
 * @param {{usn: string, st: string, server: string, location: string}} hit
 */
function looksLikeSonos(hit) {
  const usn = String(hit.usn || '').toLowerCase();
  const st = String(hit.st || '').toLowerCase();
  const server = String(hit.server || '').toLowerCase();
  return (
    usn.includes('rincon') ||
    usn.includes('zoneplayer') ||
    st.includes('zoneplayer') ||
    st.includes('smartspeaker-audio') ||
    server.includes('sonos')
  );
}

/**
 * Broadcast an SSDP search and collect every Sonos player that answers.
 *
 * Sockets are opened per local interface so discovery still works on machines
 * with several networks (a very common Mac setup: Wi-Fi plus a Thunderbolt dock).
 *
 * One answer is normally enough: a single player can describe the entire
 * household through ZoneGroupTopology. `stopAfterFirst` therefore returns as
 * soon as somebody replies (plus a short grace period to pick up the rest),
 * which turns a four-second startup wait into a few hundred milliseconds.
 *
 * @param {object} [options]
 * @param {number} [options.timeout] Longest we will wait, in ms. Default 3000.
 * @param {boolean} [options.stopAfterFirst] Return early once anyone answers.
 * @param {number} [options.graceMs] Extra listening time after the first hit.
 * @param {(hit: {host: string, location: string, usn: string}) => void} [options.onHit]
 * @returns {Promise<Array<{host: string, location: string, usn: string}>>}
 */
async function discover({ timeout = 3000, stopAfterFirst = false, graceMs = 500, onHit } = {}) {
  const found = new Map();
  const sockets = [];
  let finish = () => {};
  const settled = new Promise((resolve) => {
    finish = resolve;
  });
  let graceTimer = null;
  const interfaces = localIPv4Addresses();
  // Also bind an unspecified socket: on some systems that is the only one the
  // kernel routes multicast from correctly.
  const bindTargets = [undefined, ...interfaces];

  const record = (message) => {
    const hit = parseResponse(message);
    if (!hit || found.has(hit.host)) return;
    // Sonos answers on both search targets, and so do plenty of things that
    // are not speakers. This is the filter the comment used to promise.
    if (!looksLikeSonos(hit)) return;
    found.set(hit.host, hit);
    if (onHit) {
      try {
        onHit(hit);
      } catch {
        /* a listener throwing must never abort discovery */
      }
    }
    if (stopAfterFirst && !graceTimer) {
      graceTimer = setTimeout(finish, graceMs);
      graceTimer.unref?.();
    }
  };

  await Promise.all(
    bindTargets.map(
      (address) =>
        new Promise((resolve) => {
          let socket;
          try {
            socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
          } catch {
            resolve();
            return;
          }
          sockets.push(socket);
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          socket.on('error', done);
          socket.on('message', (buffer) => record(buffer.toString('utf8')));
          try {
            socket.bind(0, address, () => {
              try {
                socket.setBroadcast(true);
                socket.setMulticastTTL(4);
                // Binding to an address is not enough: the kernel picks the
                // egress interface from the routing table unless we say so.
                // Without this, a second VLAN is simply never searched.
                if (address) socket.setMulticastInterface(address);
              } catch {
                /* not fatal — the default route still gets searched */
              }
              // MX is the window a responder may spread its reply over, and it
              // has to agree with how long we actually listen. Asking for 3
              // seconds and then hanging up 400 ms after the first answer told
              // every remaining speaker to reply during a period when nobody
              // was listening. When we mean to stop early, we ask everyone to
              // answer promptly instead.
              const mx = stopAfterFirst ? 1 : Math.max(1, Math.round(timeout / 1000) - 1);
              for (const target of SEARCH_TARGETS) {
                const message = searchMessage(target, mx);
                // Two bursts: UDP is lossy and a missed player is a missing
                // speaker. The second goes out well inside the grace period,
                // or it is a burst nobody hears.
                socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS, () => {});
                setTimeout(() => {
                  try {
                    socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS, () => {});
                  } catch {
                    /* socket already closed */
                  }
                }, REBURST_MS).unref?.();
              }
              done();
            });
          } catch {
            done();
          }
        }),
    ),
  );

  await Promise.race([
    settled,
    new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout);
      timer.unref?.();
    }),
  ]);
  clearTimeout(graceTimer);

  for (const socket of sockets) {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }

  return [...found.values()];
}

module.exports = { discover, looksLikeSonos, parseResponse, localIPv4Addresses, SSDP_ADDRESS, SSDP_PORT };
