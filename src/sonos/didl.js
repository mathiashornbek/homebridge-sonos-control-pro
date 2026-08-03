'use strict';

const { parseXml, escapeXml, find, findAll, text } = require('./xml');

/**
 * URI schemes that Sonos plays as a live stream: you hand them to
 * SetAVTransportURI directly and never touch the queue.
 */
const STREAM_PREFIXES = [
  'x-sonosapi-stream:',
  'x-sonosapi-radio:',
  'x-sonosapi-hls:',
  'x-sonosapi-hls-static:',
  'x-sonosprog-http:',
  'x-rincon-mp3radio:',
  'x-rincon-stream:',
  'x-sonos-htastream:',
  'x-sonos-vli:',
  'hls-radio:',
  'aac:',
  'mms:',
  'rtsp:',
];

/**
 * URI schemes that represent a *container* (album, playlist, station list).
 * These have to be pushed onto the queue before they will play.
 */
const CONTAINER_PREFIXES = ['x-rincon-cpcontainer:', 'x-rincon-playlist:', 'file:'];

/**
 * @typedef {object} DidlItem
 * @property {string} id
 * @property {string} parentId
 * @property {string} title
 * @property {string} description   Sonos favourites carry the source here ("Spotify", "DR LYD").
 * @property {string} uri           The playable `res` value.
 * @property {string} metadata      Raw DIDL-Lite to hand back to the player.
 * @property {string} upnpClass     Class of the *target*, not the favourite wrapper.
 * @property {string} albumArt
 * @property {boolean} isContainer
 * @property {boolean} isStream
 */

/**
 * Decide how a resource has to be played.
 * @param {string} uri
 * @param {string} upnpClass
 */
function classify(uri, upnpClass) {
  const lower = (uri || '').toLowerCase();
  const isStream = STREAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
  const isContainer =
    !isStream &&
    (CONTAINER_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
      (upnpClass || '').includes('object.container'));
  return { isStream, isContainer };
}

/**
 * Parse a DIDL-Lite document into flat items.
 *
 * Sonos favourites nest the real metadata inside `<r:resMD>`, so the class we
 * report is taken from there when present — that is what decides queue vs stream.
 *
 * @param {string} didl
 * @returns {DidlItem[]}
 */
function parseDidl(didl) {
  if (!didl) return [];
  const document = parseXml(didl);
  const nodes = [...findAll(document, 'item'), ...findAll(document, 'container')];
  const items = [];

  for (const node of nodes) {
    const resNode = find(node, 'res');
    const uri = resNode ? resNode.text : '';
    const metadata = text(node, 'resMD', '');
    let upnpClass = text(node, 'class', '');
    if (metadata) {
      const inner = parseXml(metadata);
      const innerClass = text(inner, 'class', '');
      if (innerClass) upnpClass = innerClass;
    }
    const { isStream, isContainer } = classify(uri, upnpClass);

    items.push({
      id: node.attrs.id || '',
      parentId: node.attrs.parentID || '',
      title: text(node, 'title', ''),
      description: text(node, 'description', ''),
      creator: text(node, 'creator', ''),
      album: text(node, 'album', ''),
      uri,
      metadata,
      upnpClass,
      albumArt: text(node, 'albumArtURI', ''),
      isContainer,
      isStream,
    });
  }

  return items;
}

/**
 * Pick the UPnP class Sonos expects for a URI we have no metadata for.
 * Getting this wrong makes a player refuse the item or file it as the wrong
 * kind of content, so it is worth deriving rather than guessing one value.
 */
function classFor(uri, isContainer) {
  if (isContainer) return 'object.container.playlistContainer';
  const lower = String(uri || '').toLowerCase();
  const broadcast =
    STREAM_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
    lower.startsWith('http://') ||
    lower.startsWith('https://');
  return broadcast ? 'object.item.audioItem.audioBroadcast' : 'object.item.audioItem.musicTrack';
}

/**
 * The "content directory unique device name" tells Sonos which service the item
 * belongs to. Anything we hand over ourselves is either local/generic content
 * or a plain internet radio stream — never a music-service item, because those
 * always arrive with their own metadata that we pass through untouched.
 */
function cdudnFor(uri) {
  const lower = String(uri || '').toLowerCase();
  if (lower.startsWith('x-sonosapi-stream:') || lower.startsWith('x-sonosapi-radio:')) {
    return 'SA_RINCON65031_';
  }
  return 'RINCON_AssociatedZPUDN';
}

/**
 * Build minimal DIDL-Lite for a bare URI we were given without metadata.
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.uri]          Used to derive the class and service token.
 * @param {boolean} [options.isContainer]
 * @param {string} [options.upnpClass]    Overrides the derived class.
 * @param {string} [options.id]
 * @param {string} [options.parentId]
 * @returns {string}
 */
function buildDidl({ title, uri = '', isContainer = false, upnpClass, id = '-1', parentId = '-1' }) {
  const resolvedClass = upnpClass || classFor(uri, isContainer);
  return (
    `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ` +
    `xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" ` +
    `xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">` +
    `<item id="${escapeXml(id)}" parentID="${escapeXml(parentId)}" restricted="true">` +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    `<upnp:class>${escapeXml(resolvedClass)}</upnp:class>` +
    `<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">${cdudnFor(uri)}</desc>` +
    `</item></DIDL-Lite>`
  );
}

module.exports = { parseDidl, buildDidl, classify, classFor, cdudnFor, STREAM_PREFIXES, CONTAINER_PREFIXES };
