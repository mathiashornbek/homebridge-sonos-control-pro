'use strict';

/**
 * The settings page builds its HTML by pasting strings together, and every
 * value that goes into one has to be escaped by hand at the place it is used.
 * That is nearly three thousand lines of remembering, and forgetting once is
 * enough: scene names, speaker names, track titles and album art all arrive
 * from outside — a hand-edited scenes.json, an imported file, whatever the
 * household is playing.
 *
 * Reviewing it is not a guard, because a guard has to survive the next change.
 * So the file is read here and every value pasted into an HTML attribute is
 * checked for having gone through something that makes it safe. A new one that
 * has not fails this test, by name and line, rather than becoming a bug.
 *
 * The check is deliberately about attributes. That is where a missed escape is
 * worst — a value can close the quote and open an event handler — and it is
 * the position that can be recognised reliably without parsing JavaScript.
 * Values pasted between tags are covered by the fragments they are built from,
 * which are themselves assembled from escaped parts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const UI_FILE = path.join(__dirname, '..', 'homebridge-ui', 'public', 'index.js');

/**
 * Values that are safe to paste into an attribute:
 *
 *   escapeHtml(…)  turns the quote characters into entities
 *   num(…)         refuses anything that is not a number
 *   safeUrl(…)     refuses a scheme we would not follow (always escaped too)
 *   fmtMs(…)       formats a number into a duration
 *
 * A conditional is fine as long as both of its branches are, and a nested
 * template is fine as long as everything inside it is — both are checked by
 * looking at every call the expression makes, rather than its shape.
 */
const SAFE_CALLS = /\b(escapeHtml|num|safeUrl|fmtMs)\s*\(/;

/** A quoted string with nothing interpolated into it. */
function isStringLiteral(expression) {
  return /^'[^'\\]*'$/.test(expression) || /^"[^"\\]*"$/.test(expression) || /^`[^`$\\]*`$/.test(expression);
}

/**
 * Can this expression only ever produce a string that is written here?
 *
 * `state.running.has(id) ? 'is-running' : ''` decides between two class names.
 * Whatever the condition looks at, neither answer came from outside, so there
 * is nothing to escape. A conditional counts when both of its branches do.
 */
function producesOnlyLiterals(expression) {
  const text = expression.trim();
  if (isStringLiteral(text)) return true;
  // A bare `player.name` is not one of these. It is the whole problem.

  const question = topLevelIndex(text, '?');
  if (question === -1) return false;
  const colon = topLevelIndex(text, ':', question + 1);
  if (colon === -1) return false;
  return (
    producesOnlyLiterals(text.slice(question + 1, colon)) && producesOnlyLiterals(text.slice(colon + 1))
  );
}

/** Where `character` appears outside any bracket, quote or template. */
function topLevelIndex(text, character, from = 0) {
  let depth = 0;
  let quote = null;
  for (let index = from; index < text.length; index += 1) {
    const here = text[index];
    if (quote) {
      if (here === '\\') index += 1;
      else if (here === quote) quote = null;
      continue;
    }
    if (here === "'" || here === '"' || here === '`') quote = here;
    else if ('([{'.includes(here)) depth += 1;
    else if (')]}'.includes(here)) depth -= 1;
    else if (depth === 0 && here === character) return index;
  }
  return -1;
}

/**
 * Every value pasted into a quoted attribute in the file, with its line.
 *
 * Walks the text rather than matching a regular expression against it, so that
 * a `"` inside the expression — `entry.attrs["x"]` — does not look like the end
 * of the attribute, and a nested `${…}` is taken whole.
 */
function attributeInterpolations(source) {
  const found = [];
  const lineOf = (index) => source.slice(0, index).split('\n').length;

  // `foo="` or `foo='`, the start of an attribute value in one of these
  // templates. The name is kept for the failure message.
  const opener = /([-\w:]+)=(["'])/g;
  let match;
  while ((match = opener.exec(source))) {
    const [, name, quote] = match;
    let index = match.index + match[0].length;
    let depth = 0;

    while (index < source.length) {
      if (depth === 0 && source[index] === quote) break;
      if (depth === 0 && source[index] === '\n') break; // unterminated: not an attribute
      if (source.startsWith('${', index)) {
        const start = index + 2;
        depth = 1;
        index = start;
        while (index < source.length && depth > 0) {
          if (source[index] === '{') depth += 1;
          else if (source[index] === '}') depth -= 1;
          index += 1;
        }
        found.push({
          attribute: name,
          line: lineOf(start),
          expression: source.slice(start, index - 1).trim(),
        });
        depth = 0;
        continue;
      }
      index += 1;
    }
  }
  return found;
}

test('every value put into an HTML attribute in the settings page is escaped', () => {
  const source = fs.readFileSync(UI_FILE, 'utf8');
  const values = attributeInterpolations(source);

  // If this ever reads zero the walker has stopped finding anything and the
  // test would pass by doing nothing at all.
  assert.ok(values.length > 60, `the walker found only ${values.length} attribute values`);

  const unescaped = values.filter(
    (value) => !SAFE_CALLS.test(value.expression) && !producesOnlyLiterals(value.expression),
  );

  assert.deepEqual(
    unescaped.map((value) => `${path.basename(UI_FILE)}:${value.line}  ${value.attribute}="\${${value.expression}}"`),
    [],
    'wrap these in escapeHtml(), num() or safeUrl() — see the note at the top of this file',
  );
});

test('the escaping helpers themselves do what the rest of the file trusts them to', () => {
  const source = fs.readFileSync(UI_FILE, 'utf8');

  // The helpers are plain functions with no dependencies, so they can be lifted
  // out and exercised directly. The file is a browser script: it cannot be
  // required, and stubbing a DOM to load the whole of it would test the stub.
  const lift = (name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} is still there`);
    let index = source.indexOf('{', start);
    let depth = 1;
    index += 1;
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') depth -= 1;
      index += 1;
    }
    // eslint-disable-next-line no-new-func
    return new Function(`${source.slice(start, index)}; return ${name};`)();
  };

  const escapeHtml = lift('escapeHtml');
  const num = lift('num');
  const safeUrl = lift('safeUrl');

  // The attack this is all for: a value that closes the attribute it sits in.
  assert.equal(
    escapeHtml('" onerror="alert(1)'),
    '&quot; onerror=&quot;alert(1)',
    'a double quote cannot close the attribute it is written into',
  );
  assert.equal(escapeHtml("' onload='x"), '&#39; onload=&#39;x', 'nor a single quote');
  assert.equal(escapeHtml('<img src=x>'), '&lt;img src=x&gt;', 'nor a tag');
  assert.equal(escapeHtml('a & b'), 'a &amp; b', 'and the ampersand goes first, not twice');
  assert.equal(escapeHtml(null), '', 'nothing renders as nothing, not as "null"');
  assert.equal(escapeHtml(undefined), '');

  // Escaping is not enough for a number: `30" onmouseover=…` survives it as
  // text, and the fields these go in are read from a file anyone can edit.
  assert.equal(num('30" onmouseover=x'), '');
  assert.equal(num('30" onmouseover=x', 0), 0);
  assert.equal(num('44'), 44);
  assert.equal(num(44), 44);
  assert.equal(num(Infinity, 0), 0, 'not finite is not a number to render');
  assert.equal(num(NaN, 0), 0);

  // And escaping says nothing about what a URL means.
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('JaVaScRiPt:alert(1)'), '', 'the scheme is not case sensitive');
  assert.equal(safeUrl('data:text/html;base64,PHN2Zw=='), '');
  assert.equal(safeUrl('https://example.com/art.jpg'), 'https://example.com/art.jpg');
  assert.equal(safeUrl('  '), '');
  assert.equal(safeUrl(null), '');
});
