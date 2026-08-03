'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseXml, decodeEntities, escapeXml, find, findAll, children, text } = require('../src/sonos/xml');
const { parseDidl, classify } = require('../src/sonos/didl');

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
