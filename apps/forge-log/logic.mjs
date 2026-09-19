// Forge Log — core logic. Pure functions only (no DOM, no IndexedDB) so
// selfcheck.mjs can exercise the exact bytes that ship to the browser.

/** Create a new log entry. type: 'meal' | 'set' */
export function makeEntry(type, data, now = Date.now()) {
  if (type !== 'meal' && type !== 'set') throw new Error('bad type');
  if (!data || typeof data.name !== 'string' || !data.name.trim()) {
    throw new Error('name required');
  }
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    name: data.name.trim(),
    calories: type === 'meal' ? Number(data.calories) || 0 : 0,
    weight: type === 'set' ? Number(data.weight) || 0 : 0,
    reps: type === 'set' ? Number(data.reps) || 0 : 0,
    burned: type === 'set' ? Number(data.burned) || 0 : 0,
    ts: now
  };
}

/** Remove an entry by id. Never throws on unknown id or empty list. */
export function deleteEntry(entries, id) {
  return (entries || []).filter((e) => e.id !== id);
}

/**
 * Build the "Repeat" row: most recent distinct entries by name, newest first,
 * capped at `limit`. Correct on 0 entries, 1 entry, and many duplicates of
 * the same name (must not crash and must not duplicate).
 */
export function repeatList(entries, limit = 10) {
  const list = Array.isArray(entries) ? entries : [];
  const sorted = [...list].sort((a, b) => b.ts - a.ts);
  const seen = new Set();
  const out = [];
  for (const e of sorted) {
    const key = `${e.type}:${e.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Sum of the day's calories in vs. calories burned. Safe on an empty list. */
export function dailyTotals(entries, dateStr) {
  const list = Array.isArray(entries) ? entries : [];
  const dayStart = new Date(dateStr).setHours(0, 0, 0, 0);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  return list
    .filter((e) => e.ts >= dayStart && e.ts < dayEnd)
    .reduce(
      (totals, e) => ({
        calories: totals.calories + (e.calories || 0),
        burned: totals.burned + (e.burned || 0),
        meals: totals.meals + (e.type === 'meal' ? 1 : 0),
        sets: totals.sets + (e.type === 'set' ? 1 : 0)
      }),
      { calories: 0, burned: 0, meals: 0, sets: 0 }
    );
}

// --- Barcode decode (EAN-13) --------------------------------------------
// Home-grown, zero-dependency EAN-13 decoder used as the fallback path when
// the native BarcodeDetector API is unavailable. Takes a 95-module 0/1 array
// sampled from one scanline of the camera frame (1 = black bar, 0 = white
// space) and returns the 13-digit barcode string, or null if the scanline
// doesn't hold a valid symbol. Pure function: no DOM, no camera, testable
// with a hand-built module array.
const EAN_L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const EAN_G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const EAN_R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const EAN_FIRST_DIGIT = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

function eanChecksum(digits13) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits13[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits13[12]);
}

export function decodeEAN13FromModules(modules) {
  const m = Array.isArray(modules) ? modules : [];
  if (m.length !== 95) return null;
  const bits = (arr) => arr.join('');
  if (bits(m.slice(0, 3)) !== '101') return null;
  if (bits(m.slice(45, 50)) !== '01010') return null;
  if (bits(m.slice(92, 95)) !== '101') return null;

  let parity = '';
  const leftDigits = [];
  for (let i = 0; i < 6; i++) {
    const pattern = bits(m.slice(3 + i * 7, 10 + i * 7));
    const lIdx = EAN_L.indexOf(pattern);
    if (lIdx !== -1) {
      parity += 'L';
      leftDigits.push(lIdx);
      continue;
    }
    const gIdx = EAN_G.indexOf(pattern);
    if (gIdx === -1) return null;
    parity += 'G';
    leftDigits.push(gIdx);
  }

  const firstDigit = EAN_FIRST_DIGIT.indexOf(parity);
  if (firstDigit === -1) return null;

  const rightDigits = [];
  for (let i = 0; i < 6; i++) {
    const pattern = bits(m.slice(50 + i * 7, 57 + i * 7));
    const rIdx = EAN_R.indexOf(pattern);
    if (rIdx === -1) return null;
    rightDigits.push(rIdx);
  }

  const digits = `${firstDigit}${leftDigits.join('')}${rightDigits.join('')}`;
  return eanChecksum(digits) ? digits : null;
}

/**
 * Threshold a row of grayscale pixel samples (0-255) into a 95-module
 * 0/1 array for decodeEAN13FromModules. Pure, testable without a canvas.
 */
export function pixelsToModules(samples, moduleWidth) {
  const s = Array.isArray(samples) ? samples : [];
  const w = Math.max(1, Math.round(moduleWidth) || 1);
  const modules = [];
  for (let i = 0; i < 95; i++) {
    const start = i * w;
    const slice = s.slice(start, start + w);
    if (!slice.length) return null;
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    modules.push(avg < 128 ? 1 : 0);
  }
  return modules;
}

/**
 * Extract {name, calories} from an Open Food Facts v2 product response.
 * Returns null if the product wasn't found or has no name — never throws
 * on a malformed/partial payload.
 */
export function parseOpenFoodFactsProduct(json) {
  if (!json || json.status !== 1 || !json.product) return null;
  const p = json.product;
  const name = (p.product_name || p.generic_name || '').trim();
  if (!name) return null;
  const n = p.nutriments || {};
  const calories = Math.round(
    Number(n['energy-kcal_serving']) || Number(n['energy-kcal_100g']) || 0
  );
  return { name, calories };
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_FIELDS = ['id', 'type', 'name', 'calories', 'weight', 'reps', 'burned', 'ts'];

/** Whole history -> CSV text. Empty array -> header only, never crashes. */
export function toCSV(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const rows = [CSV_FIELDS.join(',')];
  for (const e of list) {
    rows.push(CSV_FIELDS.map((f) => csvEscape(e[f])).join(','));
  }
  return rows.join('\n');
}

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** CSV text -> entries array. Blank/empty input -> []. Never throws on malformed rows. */
export function fromCSV(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const lines = raw.split('\n').filter((l) => l.length > 0);
  if (lines.length <= 1) return [];
  const header = parseCSVLine(lines[0]);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    if (cells.length !== header.length) continue;
    const row = {};
    header.forEach((h, idx) => (row[h] = cells[idx]));
    out.push({
      id: row.id || `${Date.now()}-${i}`,
      type: row.type === 'set' ? 'set' : 'meal',
      name: row.name || '',
      calories: Number(row.calories) || 0,
      weight: Number(row.weight) || 0,
      reps: Number(row.reps) || 0,
      burned: Number(row.burned) || 0,
      ts: Number(row.ts) || Date.now()
    });
  }
  return out;
}

/** Whole history -> pretty JSON text, restorable with fromJSON. */
export function toJSON(entries) {
  return JSON.stringify({ version: 1, entries: Array.isArray(entries) ? entries : [] }, null, 2);
}

/** JSON text -> entries array. Rejects anything that isn't the expected shape. */
export function fromJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.entries)) return [];
  return parsed.entries.filter((e) => e && typeof e.id === 'string' && typeof e.name === 'string');
}
