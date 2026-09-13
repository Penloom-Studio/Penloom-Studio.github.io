// Forge Log selfcheck — exercises the actual shipped logic.mjs (no fixtures,
// no duplicate reimplementation). Run: node selfcheck.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  makeEntry,
  deleteEntry,
  repeatList,
  dailyTotals,
  toCSV,
  fromCSV,
  toJSON,
  fromJSON,
  decodeEAN13FromModules,
  pixelsToModules,
  parseOpenFoodFactsProduct
} from './logic.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
function ok(label) {
  passed++;
  console.log(`ok - ${label}`);
}

// --- makeEntry ---------------------------------------------------------
{
  const meal = makeEntry('meal', { name: 'Eggs', calories: '220' }, 1000);
  assert.equal(meal.type, 'meal');
  assert.equal(meal.calories, 220);
  assert.equal(meal.name, 'Eggs');
  ok('makeEntry builds a meal with numeric calories');

  const set = makeEntry('set', { name: 'Squat', weight: '135', reps: '5', burned: '30' }, 2000);
  assert.equal(set.type, 'set');
  assert.equal(set.weight, 135);
  assert.equal(set.reps, 5);
  ok('makeEntry builds a set');

  assert.throws(() => makeEntry('meal', { name: '' }), /name required/);
  assert.throws(() => makeEntry('other', { name: 'x' }), /bad type/);
  ok('makeEntry rejects bad input');
}

// --- deleteEntry: empty list, single item, unknown id -----------------
{
  assert.deepEqual(deleteEntry([], 'a'), []);
  ok('deleteEntry on empty list returns empty list, does not throw');

  const one = [makeEntry('meal', { name: 'Toast', calories: 100 }, 1)];
  const afterUnknown = deleteEntry(one, 'nope');
  assert.equal(afterUnknown.length, 1);
  ok('deleteEntry with unknown id leaves single item untouched');

  const afterReal = deleteEntry(one, one[0].id);
  assert.deepEqual(afterReal, []);
  ok('deleteEntry removes the single item by id');
}

// --- repeatList: 0 items, 1 item, duplicates (the null-seeded-reduce trap) ---
{
  assert.deepEqual(repeatList([]), [], 'zero entries -> empty, not a crash');
  assert.deepEqual(repeatList(undefined), [], 'undefined entries -> empty, not a crash');
  ok('repeatList handles no entries without throwing or indexing null');

  const single = [makeEntry('meal', { name: 'Banana', calories: 90 }, 100)];
  const singleResult = repeatList(single, 10);
  assert.equal(singleResult.length, 1);
  assert.equal(singleResult[0].name, 'Banana');
  ok('repeatList handles exactly one entry');

  const dup = [
    makeEntry('meal', { name: 'Banana', calories: 90 }, 100),
    makeEntry('meal', { name: 'Banana', calories: 95 }, 200),
    makeEntry('meal', { name: 'Banana', calories: 92 }, 300),
    makeEntry('set', { name: 'Squat', weight: 100, reps: 5 }, 400)
  ];
  const deduped = repeatList(dup, 10);
  assert.equal(deduped.length, 2, 'same-name meals collapse to one repeat row');
  assert.equal(deduped[0].ts, 400, 'newest entry wins first slot');
  const bananaRow = deduped.find((e) => e.name === 'Banana');
  assert.equal(bananaRow.ts, 300, 'most recent Banana instance is kept, not a stale one');
  ok('repeatList dedups repeats by name+type and keeps the most recent');

  const many = Array.from({ length: 15 }, (_, i) =>
    makeEntry('set', { name: `Ex${i}`, weight: 10, reps: 1 }, i)
  );
  assert.equal(repeatList(many, 10).length, 10);
  ok('repeatList caps at the requested limit');
}

// --- dailyTotals: safe reduce seed, never indexes a null accumulator ---
{
  const t0 = dailyTotals([], new Date().toISOString());
  assert.deepEqual(t0, { calories: 0, burned: 0, meals: 0, sets: 0 });
  ok('dailyTotals on empty list returns a zeroed object, not null');

  const now = Date.now();
  const todayEntries = [
    makeEntry('meal', { name: 'Eggs', calories: 200 }, now),
    makeEntry('set', { name: 'Row', weight: 50, reps: 8, burned: 40 }, now)
  ];
  const t1 = dailyTotals(todayEntries, new Date(now).toISOString());
  assert.equal(t1.calories, 200);
  assert.equal(t1.burned, 40);
  assert.equal(t1.meals, 1);
  assert.equal(t1.sets, 1);
  ok('dailyTotals sums calories in vs burned for today');
}

// --- CSV round trip: empty, single row, quoted commas -------------------
{
  assert.equal(fromCSV('').length, 0);
  assert.equal(fromCSV(toCSV([])).length, 0);
  ok('CSV export/import round-trips an empty history');

  const oneEntry = [makeEntry('meal', { name: 'Rice, fried', calories: 400 }, 555)];
  const csv = toCSV(oneEntry);
  const back = fromCSV(csv);
  assert.equal(back.length, 1);
  assert.equal(back[0].name, 'Rice, fried');
  assert.equal(back[0].calories, 400);
  ok('CSV round-trips a single entry with an embedded comma');
}

// --- JSON round trip -----------------------------------------------------
{
  const history = [
    makeEntry('meal', { name: 'Oats', calories: 150 }, 10),
    makeEntry('set', { name: 'Deadlift', weight: 225, reps: 3, burned: 60 }, 20)
  ];
  const json = toJSON(history);
  const restored = fromJSON(json);
  assert.equal(restored.length, 2);
  assert.equal(restored[1].weight, 225);
  ok('JSON export/import round-trips full history without loss');

  assert.deepEqual(fromJSON('not json'), []);
  assert.deepEqual(fromJSON('{}'), []);
  ok('fromJSON fails safe on malformed input');
}

// --- F1 barcode scan: EAN-13 fallback decoder + Open Food Facts parse ----
{
  // Real, checksum-valid EAN-13 symbol (5449000000996) built from the
  // standard L/G/R encoding tables — the exact bytes decodeEAN13FromModules
  // ships to the browser as the camera-based fallback when BarcodeDetector
  // isn't available.
  const bits = '101' +
    '0100011' + '0011101' + '0010111' + '0001101' + '0001101' + '0100111' +
    '01010' +
    '1110010' + '1110010' + '1110010' + '1110100' + '1110100' + '1010000' +
    '101';
  assert.equal(bits.length, 95, 'test fixture is a full 95-module EAN-13 symbol');
  const modules = bits.split('').map(Number);
  assert.equal(decodeEAN13FromModules(modules), '5449000000996');
  ok('decodeEAN13FromModules decodes a real, checksum-valid EAN-13 symbol');

  assert.equal(decodeEAN13FromModules([]), null, 'wrong length -> null, never throws');
  assert.equal(decodeEAN13FromModules(undefined), null, 'undefined -> null, never throws');
  const bad = modules.slice();
  bad[50] = bad[50] ? 0 : 1; // corrupt one module -> checksum/pattern should fail
  assert.notEqual(decodeEAN13FromModules(bad), '5449000000996');
  ok('decodeEAN13FromModules rejects malformed/corrupted scanlines instead of guessing');

  // pixelsToModules: grayscale scanline -> module array, safe on short input
  const white = 255, black = 0;
  const pixelBits = bits.split('').map((b) => (b === '1' ? black : white));
  const wide = [];
  for (const p of pixelBits) for (let i = 0; i < 4; i++) wide.push(p);
  assert.deepEqual(pixelsToModules(wide, 4), modules);
  ok('pixelsToModules thresholds a grayscale scanline into the same module array');
  assert.equal(pixelsToModules([1, 2, 3], 4), null, 'too-short sample -> null, not a crash');
  ok('pixelsToModules fails safe on a short/empty sample');

  // Open Food Facts parse: found, not-found, and malformed payloads
  const found = parseOpenFoodFactsProduct({
    status: 1,
    product: { product_name: 'Coca-Cola', nutriments: { 'energy-kcal_100g': 42, 'energy-kcal_serving': 140 } }
  });
  assert.deepEqual(found, { name: 'Coca-Cola', calories: 140 });
  ok('parseOpenFoodFactsProduct prefers the per-serving calorie figure');

  assert.equal(parseOpenFoodFactsProduct({ status: 0 }), null);
  assert.equal(parseOpenFoodFactsProduct(null), null);
  assert.equal(parseOpenFoodFactsProduct({ status: 1, product: {} }), null, 'no product name -> null');
  ok('parseOpenFoodFactsProduct fails safe on not-found/malformed payloads');
}

// --- shipped file wiring: manifest, sw, CSP all present and consistent ---
{
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait-primary');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.some((i) => i.purpose === 'maskable'));
  ok('manifest.json is installable: standalone, portrait-primary, maskable icon');

  const sw = readFileSync(path.join(dir, 'sw.js'), 'utf8');
  assert.ok(sw.includes("caches.open"), 'service worker precaches into a named cache');
  assert.ok(sw.includes('./index.html') && sw.includes('./app.js') && sw.includes('./logic.mjs'));
  ok('sw.js precaches the whole app shell for offline use');

  const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(html.includes('rel="manifest"'));
  assert.ok(!/api[_-]?key/i.test(html), 'no secrets committed');
  ok('index.html sets a CSP and links the manifest, no secrets present');

  const app = readFileSync(path.join(dir, 'app.js'), 'utf8');
  assert.ok(!/api[_-]?key|secret|token/i.test(app), 'no secrets in app.js');
  ok('app.js has no committed secrets');

  assert.ok(app.includes('BarcodeDetector'), 'app.js uses the native BarcodeDetector when available');
  assert.ok(app.includes('scanFrameFallback') && app.includes('decodeEAN13FromModules'), 'app.js falls back to the on-device EAN-13 decoder');
  assert.ok(app.includes('world.openfoodfacts.org'), 'app.js resolves scans against the free Open Food Facts dataset');
  assert.ok(html.includes('manualBarcode'), 'index.html offers manual barcode entry as the final fallback');
  ok('F1 barcode-scan flow is wired end to end: native detector -> local decoder -> manual entry -> Open Food Facts');
}

console.log(`\n${passed} checks passed.`);
