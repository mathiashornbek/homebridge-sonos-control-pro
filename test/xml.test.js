'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseXml, decodeEntities, escapeXml, find, findAll, children, text } = require('../src/sonos/xml');
const { parseDidl, classify, cdudnFor } = require('../src/sonos/didl');
const { looksLikeSonos, parseResponse } = require('../src/sonos/ssdp');

test('parses elements, attributes and text', () => {
  const document = parseXml('<a x="1" y=\'two\'><b>hello</b><c/></a>');
  const a = find(document, 'a');
  assert.equal(a.attrs.x, '1');
  assert.equal(a.attrs.y, 'two');
  assert.equal(text(document, 'b'), 'hello');
  assert.ok(find(document, 'c'));
  assert.equal(children(a, 'b').length, 1);
});

test('handles namespace prefixes on both sides', () => {
  const document = parseXml('<r:root xmlns:r="urn:x"><r:item id="7">v</r:item></r:root>');
  assert.equal(text(document, 'item'), 'v');
  assert.equal(find(document, 'r:item').attrs.id, '7');
});

test('decodes the predefined entities and numeric references', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'), `a & b <c> "d" 'e'`);
  assert.equal(decodeEntities('&#65;&#x42;'), 'AB');
  assert.equal(decodeEntities('&#128561;'), '\u{1F631}');
  assert.equal(decodeEntities('no entities here'), 'no entities here');
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
});

test('round-trips escaping', () => {
  const value = `Late Night Mix 🫣🔥 & "co" <x>`;
  const document = parseXml(`<t>${escapeXml(value)}</t>`);
  assert.equal(text(document, 't'), value);
});

test('CDATA is taken verbatim, not entity-decoded', () => {
  const document = parseXml('<t><![CDATA[raw &amp; text]]></t>');
  assert.equal(text(document, 't'), 'raw &amp; text');
});

test('survives an unclosed tag without throwing', () => {
  const document = parseXml('<a><b>text</a>');
  assert.equal(text(document, 'b'), 'text');
});

test('does not mistake > inside an attribute for the end of a tag', () => {
  const document = parseXml('<a title="a > b"><b>ok</b></a>');
  assert.equal(find(document, 'a').attrs.title, 'a > b');
  assert.equal(text(document, 'b'), 'ok');
});

test('findAll reaches every descendant', () => {
  const document = parseXml('<r><g><m id="1"/><m id="2"/></g><g><m id="3"/></g></r>');
  assert.deepEqual(
    findAll(document, 'm').map((node) => node.attrs.id),
    ['1', '2', '3'],
  );
});

test('classifies streams and containers the way Sonos does', () => {
  assert.deepEqual(classify('x-sonosapi-hls:abc', ''), { isStream: true, isContainer: false });
  assert.deepEqual(classify('x-rincon-mp3radio://x', ''), { isStream: true, isContainer: false });
  assert.deepEqual(classify('x-rincon-cpcontainer:1006', ''), { isStream: false, isContainer: true });
  assert.deepEqual(classify('file:///jffs/settings/savedqueues.rsq#5', ''), {
    isStream: false,
    isContainer: true,
  });
  assert.deepEqual(classify('http://x/y.mp3', 'object.container.album'), {
    isStream: false,
    isContainer: true,
  });
});

test('parses a real-shaped favourites payload, taking the class from resMD', () => {
  const inner =
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item id="i" parentID="p" restricted="true"><dc:title>Chill</dc:title>' +
    '<upnp:class>object.container.playlistContainer</upnp:class></item></DIDL-Lite>';
  const didl =
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item id="FV:2/24" parentID="FV:2" restricted="false">' +
    '<dc:title>Chill Romantic Dinner Mix</dc:title>' +
    '<r:description>Spotify</r:description>' +
    '<res protocolInfo="x">x-rincon-cpcontainer:1006206cspotify</res>' +
    `<r:resMD>${escapeXml(inner)}</r:resMD>` +
    '<upnp:albumArtURI>http://art/1.jpg</upnp:albumArtURI>' +
    '<upnp:class>object.itemobject.item.sonos-favorite</upnp:class>' +
    '</item></DIDL-Lite>';

  const [item] = parseDidl(didl);
  assert.equal(item.title, 'Chill Romantic Dinner Mix');
  assert.equal(item.description, 'Spotify');
  assert.equal(item.uri, 'x-rincon-cpcontainer:1006206cspotify');
  assert.equal(item.albumArt, 'http://art/1.jpg');
  assert.equal(item.upnpClass, 'object.container.playlistContainer');
  assert.equal(item.isContainer, true);
  assert.ok(item.metadata.includes('<dc:title>Chill</dc:title>'));
});

test('a radio favourite is a stream, not a queue item', () => {
  const inner =
    '<DIDL-Lite xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item><upnp:class>object.item.audioItem.audioBroadcast</upnp:class></item></DIDL-Lite>';
  const didl =
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/">' +
    '<item id="FV:2/18"><dc:title>DR P3</dc:title><res>x-sonosapi-hls:dr-p3</res>' +
    `<r:resMD>${escapeXml(inner)}</r:resMD></item></DIDL-Lite>`;
  const [item] = parseDidl(didl);
  assert.equal(item.isContainer, false);
  assert.equal(item.isStream, true);
});

// ─────────────────────────────────────────── what a hostile answer may cost

test('a document deeper than the call stack is searched, not thrown at', () => {
  // parseXml is iterative and will build a document tens of thousands of
  // elements deep. find and findAll used to recurse into it and overflow —
  // inside a response handler, where a throw was an uncaught exception rather
  // than one failed command.
  const deep = parseXml(`${'<a>'.repeat(50000)}<needle>found</needle>${'</a>'.repeat(50000)}`);
  assert.equal(find(deep, 'needle').text, 'found');
  assert.equal(findAll(deep, 'a').length, 50000);
});

test('searching still walks the document in order', () => {
  // The iterative rewrite has to keep pre-order: the first match in reading
  // order, not the shallowest.
  const doc = parseXml('<r><a><x>deep</x></a><x>shallow</x></r>');
  assert.equal(find(doc, 'x').text, 'deep');
  assert.deepEqual(
    findAll(doc, 'x').map((node) => node.text),
    ['deep', 'shallow'],
  );
});

test('a wall of unclosed tags is parsed in linear time', () => {
  // The closing-tag scan used to walk the whole stack for every close, which
  // is O(1) on well-formed XML and O(n²) on input where nothing is closed.
  // 40 000 HTML void tags took 13.5 seconds of blocked event loop — and HTML
  // is exactly what a device that is not a Sonos speaker returns on port 1400.
  const balanced = `${'<a>x</a>'.repeat(20000)}`;
  const hostile = `${'<br>'.repeat(20000)}${'</p>'.repeat(20000)}`;

  const time = (xml) => {
    const started = process.hrtime.bigint();
    parseXml(xml);
    return Number(process.hrtime.bigint() - started) / 1e6;
  };
  // Warm up, so the first JIT pass is not counted against either.
  time(balanced);
  time(hostile);

  const hostileMs = time(hostile);
  // Quadratic would be thousands of milliseconds; linear is tens. The bound is
  // deliberately loose so a slow CI machine does not fail it.
  assert.ok(hostileMs < 1500, `unclosed tags took ${Math.round(hostileMs)} ms — that looks quadratic again`);
});

// ───────────────────────────────────────────── favourites without metadata

test('a favourite with no resMD is not given the favourites wrapper class', () => {
  // Sonos files everything under "Sonos Favourites" with a wrapper class. It
  // says what the item is *filed as*, not what it *is*, and a player refuses
  // it as an enqueue class. When there is no resMD to read the real class
  // from, the wrapper must be dropped so the class is derived from the URI.
  const didl =
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item id="FV:2/9"><dc:title>Some Album</dc:title>' +
    '<upnp:class>object.itemobject.item.sonos-favorite</upnp:class>' +
    '<res>x-rincon-cpcontainer:1004206cspotify%3aalbum%3axyz?sid=9&amp;flags=8300&amp;sn=7</res>' +
    '</item></DIDL-Lite>';
  const [item] = parseDidl(didl);
  assert.doesNotMatch(item.upnpClass, /sonos-favorite/, 'the wrapper class must not survive');
  // …and the URI still decides correctly.
  assert.equal(item.isContainer, true);
  assert.equal(item.isStream, false);
});

test('a music-service URI is given its own service token, not the local one', () => {
  // RINCON_AssociatedZPUDN is the token for content on the speaker itself, so
  // handing it over for a Spotify container asks the player to look for that
  // album locally. The service is named in the URI.
  const spotify = 'x-rincon-cpcontainer:1004206cspotify%3aalbum%3axyz?sid=9&flags=8300&sn=7';
  assert.equal(cdudnFor(spotify), 'SA_RINCON9_X_#Svc9-7-Token');
  // Nothing to go on: the old answer is still the right one.
  assert.equal(cdudnFor('http://example.com/stream.mp3'), 'RINCON_AssociatedZPUDN');
  assert.equal(cdudnFor('x-sonosapi-stream:dr-p3'), 'SA_RINCON65031_');
});

test('a container URI is queued even when the caller says it is not', () => {
  // playItem trusted the caller's isContainer flag and never asked classify().
  // The raw-URI action hardcodes false, so pasting a container URI sent
  // SetAVTransportURI where the player needed a queue.
  assert.equal(classify('x-rincon-cpcontainer:1004206cspotify', '').isContainer, true);
  assert.equal(classify('x-sonosapi-hls:dr-p3', '').isStream, true);
  // A stream stays a stream even if somebody insists otherwise.
  assert.equal(classify('x-sonosapi-hls:dr-p3', 'object.container.playlistContainer').isStream, true);
});

// ────────────────────────────────────────────────────── who answered the search

test('only Sonos is treated as Sonos', () => {
  // Plenty of devices answer an M-SEARCH regardless of the ST they were asked
  // about. Accepting them meant describing a router as a speaker — and with
  // the early exit, a router replying in 20 ms ended discovery before a single
  // real speaker had answered: zero players found, and a warning that blamed
  // addresses which were not involved.
  const router = { usn: 'uuid:abc::upnp:rootdevice', st: 'upnp:rootdevice', server: 'Linux/3.4 UPnP/1.0 MiniUPnPd/1.9' };
  const printer = { usn: 'uuid:printer-1::urn:schemas-upnp-org:device:Printer:1', st: '', server: 'HP/1.0' };
  assert.equal(looksLikeSonos(router), false);
  assert.equal(looksLikeSonos(printer), false);

  assert.equal(looksLikeSonos({ usn: 'uuid:RINCON_804AF2C77B2E01400::urn:schemas-upnp-org:device:ZonePlayer:1' }), true);
  assert.equal(looksLikeSonos({ st: 'urn:schemas-upnp-org:device:ZonePlayer:1' }), true);
  assert.equal(looksLikeSonos({ st: 'urn:smartspeaker-audio:service:SpeakerGroup:1' }), true);
  assert.equal(looksLikeSonos({ server: 'Linux UPnP/1.0 Sonos/96.0-79160 (ZPS39)' }), true);
});

test('an announced address is read whatever shape it arrives in', () => {
  const announce = (location) =>
    parseResponse(`HTTP/1.1 200 OK\r\nLOCATION: ${location}\r\nUSN: uuid:RINCON_1\r\n`);

  // IPv6 used to yield host "[fd00", and every later connection to that
  // "speaker" was an ENOTFOUND that burned a full describe timeout.
  const six = announce('http://[fd00::1]:1400/xml/d.xml');
  assert.equal(six.host, '[fd00::1]');
  assert.equal(six.port, 1400);

  // An uppercase scheme is legal, and used to be rejected outright.
  assert.equal(announce('HTTP://192.168.1.40:1400/x').host, '192.168.1.40');
  assert.equal(announce('http://192.168.1.40/x').port, null);
  assert.equal(parseResponse('HTTP/1.1 200 OK\r\nUSN: x\r\n'), null, 'no LOCATION, no speaker');
});
