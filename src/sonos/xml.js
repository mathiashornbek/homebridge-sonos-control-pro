'use strict';

/**
 * A small, dependency-free XML reader tuned for the machine-generated XML that
 * Sonos players emit (SOAP envelopes, DIDL-Lite, ZoneGroupState).
 *
 * It deliberately supports only the subset that matters here:
 *   - elements, attributes, text, CDATA
 *   - XML declarations, comments, doctype (skipped)
 *   - the five predefined entities plus numeric character references
 *
 * Namespace prefixes are preserved on the node name (`r:resMD`) and also
 * exposed without the prefix (`resMD`) so lookups stay readable.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Decode XML entities. Sonos double-escapes metadata, so this gets called
 * more than once on the same payload — it must therefore be safe to run on
 * text that contains no entities at all.
 * @param {string} value
 * @returns {string}
 */
function decodeEntities(value) {
  if (typeof value !== 'string' || value.indexOf('&') === -1) return value || '';
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity.charCodeAt(0) === 35 /* # */) {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[entity];
    return named === undefined ? match : named;
  });
}

/**
 * Escape a value for inclusion in XML text or an attribute.
 * @param {unknown} value
 * @returns {string}
 */
function escapeXml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * @typedef {object} XmlNode
 * @property {string} name       Tag name including any namespace prefix.
 * @property {string} local      Tag name with the namespace prefix stripped.
 * @property {Record<string,string>} attrs
 * @property {XmlNode[]} children
 * @property {string} text       Concatenated direct text content, decoded.
 */

/** @returns {XmlNode} */
function makeNode(name) {
  const colon = name.indexOf(':');
  return {
    name,
    local: colon === -1 ? name : name.slice(colon + 1),
    attrs: Object.create(null),
    children: [],
    text: '',
  };
}

const ATTR_RE = /([^\s=/<>]+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;

function parseAttributes(source) {
  const attrs = Object.create(null);
  if (!source) return attrs;
  ATTR_RE.lastIndex = 0;
  let match;
  while ((match = ATTR_RE.exec(source)) !== null) {
    const key = match[1];
    if (!key) continue;
    const raw = match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : match[5];
    attrs[key] = raw === undefined ? '' : decodeEntities(raw);
    const colon = key.indexOf(':');
    if (colon !== -1) {
      const local = key.slice(colon + 1);
      if (!(local in attrs)) attrs[local] = attrs[key];
    }
  }
  return attrs;
}

/**
 * Parse an XML document into a tree.
 * @param {string} xml
 * @returns {XmlNode} A synthetic root whose children are the document's top-level elements.
 */
function parseXml(xml) {
  const root = makeNode('#document');
  if (typeof xml !== 'string' || xml.length === 0) return root;

  const stack = [root];
  let i = 0;
  const len = xml.length;

  while (i < len) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      appendText(stack[stack.length - 1], xml.slice(i));
      break;
    }
    if (lt > i) appendText(stack[stack.length - 1], xml.slice(i, lt));

    // <![CDATA[ ... ]]> — verbatim, never entity-decoded.
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      const stop = end === -1 ? len : end;
      stack[stack.length - 1].text += xml.slice(lt + 9, stop);
      i = end === -1 ? len : end + 3;
      continue;
    }

    // <!-- comment --> and <!DOCTYPE ...>
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2);
      i = end === -1 ? len : end + 1;
      continue;
    }

    // <?xml ... ?>
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }

    const gt = findTagEnd(xml, lt + 1);
    if (gt === -1) {
      appendText(stack[stack.length - 1], xml.slice(lt));
      break;
    }
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;

    if (raw[0] === '/') {
      // Closing tag: unwind to the matching open element if we can find one.
      const name = raw.slice(1).trim();
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].name === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch) continue;
    const node = makeNode(nameMatch[1]);
    node.attrs = parseAttributes(body.slice(nameMatch[1].length));
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }

  return root;
}

/** Find the `>` that closes a tag, skipping any inside quoted attribute values. */
function findTagEnd(xml, from) {
  let quote = null;
  for (let i = from; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function appendText(node, chunk) {
  if (chunk) node.text += decodeEntities(chunk);
}

/**
 * First direct child with the given (prefix-insensitive) name.
 * @param {XmlNode|null|undefined} node
 * @param {string} name
 * @returns {XmlNode|null}
 */
function child(node, name) {
  if (!node) return null;
  for (const candidate of node.children) {
    if (candidate.name === name || candidate.local === name) return candidate;
  }
  return null;
}

/**
 * All direct children with the given (prefix-insensitive) name.
 * @param {XmlNode|null|undefined} node
 * @param {string} name
 * @returns {XmlNode[]}
 */
function children(node, name) {
  if (!node) return [];
  return node.children.filter((candidate) => candidate.name === name || candidate.local === name);
}

/**
 * Depth-first search for the first descendant with the given name.
 * @param {XmlNode|null|undefined} node
 * @param {string} name
 * @returns {XmlNode|null}
 */
function find(node, name) {
  if (!node) return null;
  for (const candidate of node.children) {
    if (candidate.name === name || candidate.local === name) return candidate;
    const nested = find(candidate, name);
    if (nested) return nested;
  }
  return null;
}

/**
 * Depth-first collection of every descendant with the given name.
 * @param {XmlNode|null|undefined} node
 * @param {string} name
 * @returns {XmlNode[]}
 */
function findAll(node, name) {
  const out = [];
  if (!node) return out;
  const walk = (current) => {
    for (const candidate of current.children) {
      if (candidate.name === name || candidate.local === name) out.push(candidate);
      walk(candidate);
    }
  };
  walk(node);
  return out;
}

/**
 * Text of the first descendant with the given name.
 * @param {XmlNode|null|undefined} node
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string}
 */
function text(node, name, fallback = '') {
  const found = find(node, name);
  return found ? found.text : fallback;
}

module.exports = {
  parseXml,
  decodeEntities,
  escapeXml,
  child,
  children,
  find,
  findAll,
  text,
};
