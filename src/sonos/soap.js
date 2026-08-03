'use strict';

const http = require('node:http');
const { parseXml, escapeXml, find, text } = require('./xml');
const { t } = require('../i18n');

/** Sonos players always answer on this port. */
const SONOS_PORT = 1400;

/**
 * One pooled, keep-alive agent for every player.
 *
 * A scene can fire thirty commands in a burst; without pooling each one pays a
 * fresh TCP handshake. Reusing sockets cuts a full house scene from hundreds of
 * milliseconds of pure connection setup to almost none.
 */
const agent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 15000,
  maxSockets: 8,
  maxFreeSockets: 4,
  timeout: 30000,
});

/**
 * The UPnP services we talk to, and where they live on a player.
 * Keeping this in one table means a typo shows up once, not everywhere.
 */
const SERVICES = {
  AVTransport: {
    type: 'urn:schemas-upnp-org:service:AVTransport:1',
    control: '/MediaRenderer/AVTransport/Control',
    events: '/MediaRenderer/AVTransport/Event',
  },
  RenderingControl: {
    type: 'urn:schemas-upnp-org:service:RenderingControl:1',
    control: '/MediaRenderer/RenderingControl/Control',
    events: '/MediaRenderer/RenderingControl/Event',
  },
  GroupRenderingControl: {
    type: 'urn:schemas-upnp-org:service:GroupRenderingControl:1',
    control: '/MediaRenderer/GroupRenderingControl/Control',
    events: '/MediaRenderer/GroupRenderingControl/Event',
  },
  ContentDirectory: {
    type: 'urn:schemas-upnp-org:service:ContentDirectory:1',
    control: '/MediaServer/ContentDirectory/Control',
    events: '/MediaServer/ContentDirectory/Event',
  },
  ZoneGroupTopology: {
    type: 'urn:schemas-upnp-org:service:ZoneGroupTopology:1',
    control: '/ZoneGroupTopology/Control',
    events: '/ZoneGroupTopology/Event',
  },
  DeviceProperties: {
    type: 'urn:schemas-upnp-org:service:DeviceProperties:1',
    control: '/DeviceProperties/Control',
    events: '/DeviceProperties/Event',
  },
  AlarmClock: {
    type: 'urn:schemas-upnp-org:service:AlarmClock:1',
    control: '/AlarmClock/Control',
    events: '/AlarmClock/Event',
  },
  MusicServices: {
    type: 'urn:schemas-upnp-org:service:MusicServices:1',
    control: '/MusicServices/Control',
    events: '/MusicServices/Event',
  },
  SystemProperties: {
    type: 'urn:schemas-upnp-org:service:SystemProperties:1',
    control: '/SystemProperties/Control',
    events: '/SystemProperties/Event',
  },
};

/** Error thrown when a player answers, but with a UPnP fault. */
class SonosError extends Error {
  constructor(message, { host, service, action, statusCode, upnpErrorCode } = {}) {
    super(message);
    this.name = 'SonosError';
    this.host = host;
    this.service = service;
    this.action = action;
    this.statusCode = statusCode;
    this.upnpErrorCode = upnpErrorCode;
  }
}

/**
 * Human-readable meanings for the UPnP error codes we actually hit in the wild.
 * Anything unmapped falls back to the raw code, which is still better than
 * "Request failed with status 500".
 */
const UPNP_ERRORS = {
  400: 'Bad request',
  401: 'Invalid action',
  402: 'Invalid arguments',
  404: 'Invalid variable',
  412: 'Precondition failed',
  501: 'Action failed',
  600: 'Argument value invalid',
  601: 'Argument value out of range',
  701: 'Transition not available (the player is not in a state where this makes sense)',
  702: 'No contents',
  704: 'Playback speed not supported',
  705: 'Transport is locked',
  711: 'Illegal seek target',
  712: 'Play mode not supported',
  714: 'Unsupported or malformed URI',
  716: 'Resource not found',
  718: 'Invalid instance ID',
  740: 'Not a group coordinator',
  800: 'Command not supported by this player',
  1023: 'Sonos: playback failed',
};

/**
 * How long to wait for an answer.
 *
 * A Sonos player on a local network answers a control command in tens of
 * milliseconds. Waiting six seconds for one buys nothing — it is not coming —
 * and when three such waits land in a row inside one scene, the scene appears
 * to take eighteen seconds. A short wait plus one retry recovers far faster
 * than a long wait ever could.
 *
 * The exceptions are the calls where the player really is doing work: fetching
 * a playlist from a music service, or walking a large library.
 */
const DEFAULT_TIMEOUT = 2500;
const SLOW_ACTIONS = {
  AddURIToQueue: 15000,
  Browse: 8000,
  GetZoneGroupState: 5000,
  SetAVTransportURI: 5000,
};

/**
 * Actions that can safely be sent twice.
 *
 * Reads always can. Absolute sets can — asking for volume 20 twice still means
 * volume 20. Relative and queue-appending actions cannot: repeating them would
 * change the volume twice or add the playlist twice.
 */
const RETRYABLE = new Set([
  'GetVolume',
  'GetMute',
  'GetTransportInfo',
  'GetTransportSettings',
  'GetMediaInfo',
  'GetPositionInfo',
  'GetCrossfadeMode',
  'GetZoneGroupState',
  'GetZoneAttributes',
  'GetGroupVolume',
  'Browse',
  'SetVolume',
  'SetMute',
  'SetGroupVolume',
  'SetGroupMute',
  'SetPlayMode',
  'SetCrossfadeMode',
  'SetBass',
  'SetTreble',
  'SetLoudness',
  'SetAVTransportURI',
  'BecomeCoordinatorOfStandaloneGroup',
  'RemoveAllTracksFromQueue',
  'Play',
  'Pause',
  'Stop',
]);

/**
 * Perform one SOAP action, retrying once when the player simply did not answer.
 *
 * A UPnP fault is a real reply and is never retried — the player has told us
 * no. Only silence and dropped connections get a second chance.
 *
 * @param {object} options See {@link sendSoap}.
 * @returns {Promise<import('./xml').XmlNode>}
 */
async function soapRequest(options) {
  const action = options.action;
  const timeout = options.timeout ?? SLOW_ACTIONS[action] ?? DEFAULT_TIMEOUT;
  try {
    return await sendSoap({ ...options, timeout });
  } catch (error) {
    const noAnswer = error?.upnpErrorCode === undefined && error?.statusCode === undefined;
    if (!noAnswer || error?.aborted || !RETRYABLE.has(action) || options.signal?.aborted) throw error;
    // A player that is actually there answers in tens of milliseconds, so the
    // second attempt gets a short leash: a transient drop recovers at once,
    // and a speaker that is genuinely off costs less than the first wait did.
    return sendSoap({ ...options, timeout: Math.min(timeout, 1500) });
  }
}

/**
 * Perform one SOAP action against a player.
 *
 * @param {object} options
 * @param {string} options.host            Player IP address.
 * @param {keyof typeof SERVICES} options.service
 * @param {string} options.action          SOAP action name, e.g. `Play`.
 * @param {Record<string, unknown>} [options.args] Arguments in the order the action expects.
 * @param {number} [options.timeout]       Milliseconds before we give up. Default 6000.
 * @param {number} [options.port]          Overridable for tests; real players are always 1400.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<import('./xml').XmlNode>} The `<u:...Response>` element.
 */
function sendSoap({ host, service, action, args = {}, timeout = DEFAULT_TIMEOUT, port = SONOS_PORT, signal }) {
  const definition = SERVICES[service];
  if (!definition) throw new Error(`Unknown Sonos service: ${service}`);

  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body>` +
    `<u:${action} xmlns:u="${definition.type}">` +
    Object.entries(args)
      .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
      .join('') +
    `</u:${action}>` +
    `</s:Body></s:Envelope>`;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        Object.assign(new SonosError(t('sonos.aborted'), { host, service, action }), {
          aborted: true,
        }),
      );
      return;
    }
    let settled = false;

    const request = http.request(
      {
        host,
        port,
        agent,
        path: definition.control,
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'Content-Length': Buffer.byteLength(body),
          SOAPACTION: `"${definition.type}#${action}"`,
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));

        // A player that reboots or drops off Wi-Fi mid-reply closes the socket
        // without an `end`. Say so immediately instead of burning the timeout
        // and then blaming the wrong thing.
        const onBroken = (error) => {
          if (!cleanup()) return;
          reject(
            new SonosError(
              t('sonos.lostConnection', {
                service,
                action,
                host,
                detail: error?.message ? `: ${error.message}` : '',
              }),
              { host, service, action },
            ),
          );
        };
        response.on('error', onBroken);
        response.on('aborted', () => onBroken(new Error(t('sonos.replyAborted'))));

        // Everything from here on is wrapped, because this runs inside an
        // EventEmitter callback: a throw here is not a rejected promise, it is
        // an uncaught exception that takes Homebridge down. Whatever a speaker
        // — or a device that merely answers on port 1400 — sends back, the
        // worst it may cost is this one command.
        response.on('end', () => {
          if (settled) return;
          cleanup();
          try {
            const payload = Buffer.concat(chunks).toString('utf8');
            const document = parseXml(payload);

            if (response.statusCode !== 200) {
              const fault = find(document, 'UPnPError');
              const code = fault ? Number(text(fault, 'errorCode')) : undefined;
              const detail = UPNP_ERRORS[code] || text(document, 'faultstring') || 'unknown fault';
              reject(
                new SonosError(`${service}.${action} failed on ${host}: ${detail}`, {
                  host,
                  service,
                  action,
                  statusCode: response.statusCode,
                  upnpErrorCode: code,
                }),
              );
              return;
            }

            const responseNode = find(document, `${action}Response`) || find(document, 'Body');
            resolve(responseNode || document);
          } catch (error) {
            reject(
              new SonosError(`${service}.${action} sent something unreadable from ${host}: ${error.message}`, {
                host,
                service,
                action,
              }),
            );
          }
        });
      },
    );

    const onAbort = () => {
      request.destroy();
      cleanup();
      reject(
        Object.assign(new SonosError(t('sonos.aborted'), { host, service, action }), {
          aborted: true,
        }),
      );
    };
    const cleanup = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      return true;
    };

    const timer = setTimeout(() => {
      request.destroy();
      if (!cleanup()) return;
      reject(
        new SonosError(t('error.soapTimeout', { service, action, timeout, host }), {
          host,
          service,
          action,
        }),
      );
    }, timeout);
    if (timer.unref) timer.unref();

    signal?.addEventListener?.('abort', onAbort, { once: true });

    request.on('error', (error) => {
      if (!cleanup()) return;
      reject(
        new SonosError(t('error.soapUnreachable', { service, action, host, message: error.message }), {
          host,
          service,
          action,
        }),
      );
    });

    request.end(body);
  });
}

/**
 * Plain HTTP GET against a player (used for the device description document).
 * @param {string} host
 * @param {string} path
 * @param {number} [timeout]
 * @param {number} [port]
 * @returns {Promise<string>}
 */
function httpGet(host, path, timeout = 5000, port = SONOS_PORT) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host, port, path, method: 'GET', agent, headers: {} },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        // Same reason as sendSoap: a player that reboots mid-reply closes the
        // socket without an `end`, and waiting out the full timeout for an
        // answer that is never coming makes discovery feel broken.
        const onBroken = (error) => {
          clearTimeout(timer);
          reject(new Error(`GET ${path} on ${host} ${error.message}`));
        };
        response.on('error', onBroken);
        response.on('aborted', () => onBroken(new Error('was cut short')));
        // Wrapped for the same reason as sendSoap's: a throw inside an
        // EventEmitter callback is an uncaught exception, not a rejection.
        response.on('end', () => {
          clearTimeout(timer);
          try {
            if (response.statusCode !== 200) {
              reject(new Error(`GET ${path} on ${host} returned ${response.statusCode}`));
              return;
            }
            resolve(Buffer.concat(chunks).toString('utf8'));
          } catch (error) {
            reject(new Error(`GET ${path} on ${host} could not be read: ${error.message}`));
          }
        });
      },
    );
    const timer = setTimeout(() => {
      request.destroy();
      reject(new Error(`GET ${path} on ${host} timed out`));
    }, timeout);
    if (timer.unref) timer.unref();
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

module.exports = {
  soapRequest,
  sendSoap,
  httpGet,
  SERVICES,
  SONOS_PORT,
  SonosError,
  agent,
  DEFAULT_TIMEOUT,
  SLOW_ACTIONS,
  RETRYABLE,
};
