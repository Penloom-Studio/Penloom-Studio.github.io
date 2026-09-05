// Forge Log — browser glue: IndexedDB storage + DOM wiring around logic.mjs.
import {
  makeEntry, deleteEntry, repeatList, dailyTotals, toCSV, fromCSV, toJSON, fromJSON,
  decodeEAN13FromModules, pixelsToModules, parseOpenFoodFactsProduct
} from './logic.mjs';

const DB_NAME = 'forge-log';
const STORE = 'entries';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function putAll(entries) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    entries.forEach((e) => store.put(e));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function replaceAll(entries) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    entries.forEach((e) => store.put(e));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function removeOne(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const $ = (sel) => document.querySelector(sel);

async function render() {
  const entries = await getAll();
  const totals = dailyTotals(entries, new Date().toISOString());
  $('#tCalories').textContent = totals.calories;
  $('#tBurned').textContent = totals.burned;

  const repeats = repeatList(entries, 10);
  const repeatEl = $('#repeatList');
  repeatEl.innerHTML = '';
  if (!repeats.length) {
    repeatEl.innerHTML = '<p class="empty">Nothing logged yet.</p>';
  } else {
    for (const r of repeats) {
      const btn = document.createElement('button');
      btn.textContent = r.type === 'meal' ? `${r.name} · ${r.calories} cal` : `${r.name} · ${r.weight}x${r.reps}`;
      btn.addEventListener('click', async () => {
        const copy = makeEntry(r.type, r);
        await putAll([copy]);
        render();
      });
      repeatEl.appendChild(btn);
    }
  }

  const listEl = $('#entries');
  listEl.innerHTML = '';
  const sorted = [...entries].sort((a, b) => b.ts - a.ts);
  if (!sorted.length) {
    listEl.innerHTML = '<p class="empty">Log a meal or a set below.</p>';
  } else {
    for (const e of sorted) {
      const row = document.createElement('div');
      row.className = 'row';
      const label = e.type === 'meal'
        ? `${e.name}<span class="badge">${e.calories} cal</span>`
        : `${e.name}<span class="badge">${e.weight}x${e.reps}${e.burned ? ` · ${e.burned} cal` : ''}</span>`;
      row.innerHTML = `<div>${label}<div class="meta">${new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>`;
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.setAttribute('aria-label', `Delete ${e.name}`);
      del.addEventListener('click', async () => {
        await removeOne(e.id);
        render();
      });
      row.appendChild(del);
      listEl.appendChild(row);
    }
  }
}

function wireDialog(dialogId, openBtnId, formId, onSubmit) {
  const dialog = $(dialogId);
  if (openBtnId) $(openBtnId).addEventListener('click', () => dialog.showModal());
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  const form = $(formId);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await onSubmit();
    form.reset();
    dialog.close();
    render();
  });
}

wireDialog('#mealDialog', '#addMeal', '#mealForm', async () => {
  const entry = makeEntry('meal', { name: $('#mealName').value, calories: $('#mealCalories').value });
  await putAll([entry]);
});

wireDialog('#setDialog', '#addSet', '#setForm', async () => {
  const entry = makeEntry('set', {
    name: $('#setName').value,
    weight: $('#setWeight').value,
    reps: $('#setReps').value,
    burned: $('#setBurned').value
  });
  await putAll([entry]);
});

// --- F1 barcode scan: BarcodeDetector, home-grown decode fallback, then
// manual entry — free, on-device, against the open Open Food Facts dataset. ---
let scanStream = null;
let scanTimer = null;

async function lookupBarcode(code) {
  const status = $('#scanStatus');
  status.textContent = `Looking up ${code}…`;
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
    const json = await res.json();
    const product = parseOpenFoodFactsProduct(json);
    if (!product) {
      status.textContent = 'Not found in Open Food Facts. Enter it manually.';
      return;
    }
    $('#mealName').value = product.name;
    $('#mealCalories').value = product.calories;
    stopScan();
    $('#scanDialog').close();
    status.textContent = 'Point the camera at a barcode.';
  } catch {
    status.textContent = 'No signal — type the barcode or fill in the meal by hand.';
  }
}

function stopScan() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
}

async function scanFrameNative(detector, video) {
  try {
    const codes = await detector.detect(video);
    if (codes.length) return codes[0].rawValue;
  } catch { /* frame not ready yet */ }
  return null;
}

function scanFrameFallback(video, canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  if (!canvas.width || !canvas.height) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const y = Math.floor(canvas.height / 2);
  const row = ctx.getImageData(0, y, canvas.width, 1).data;
  const gray = [];
  for (let i = 0; i < row.length; i += 4) {
    gray.push((row[i] + row[i + 1] + row[i + 2]) / 3);
  }
  const moduleWidth = Math.max(1, Math.floor(gray.length / 95));
  const modules = pixelsToModules(gray, moduleWidth);
  return modules ? decodeEAN13FromModules(modules) : null;
}

async function openScanner() {
  const dialog = $('#scanDialog');
  const video = $('#scanVideo');
  const canvas = $('#scanCanvas');
  const status = $('#scanStatus');
  dialog.showModal();
  status.textContent = 'Point the camera at a barcode.';

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    status.textContent = 'No camera available — type the barcode below.';
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    status.textContent = 'Camera permission denied — type the barcode below.';
    return;
  }
  video.srcObject = scanStream;
  await video.play().catch(() => {});

  const hasNative = 'BarcodeDetector' in window;
  const detector = hasNative ? new window.BarcodeDetector({ formats: ['ean_13', 'upc_a'] }) : null;

  scanTimer = setInterval(async () => {
    const code = hasNative ? await scanFrameNative(detector, video) : scanFrameFallback(video, canvas);
    if (code) lookupBarcode(code);
  }, 400);
}

$('#openScan').addEventListener('click', openScanner);
$('#closeScan').addEventListener('click', stopScan);
$('#scanDialog').addEventListener('close', stopScan);
$('#lookupManual').addEventListener('click', () => {
  const code = $('#manualBarcode').value.trim();
  if (code) lookupBarcode(code);
});

$('#openSettings').addEventListener('click', () => $('#settingsDialog').showModal());
$('#settingsDialog').querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $('#settingsDialog').close()));

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

$('#exportJson').addEventListener('click', async () => {
  const entries = await getAll();
  download('forge-log.json', toJSON(entries), 'application/json');
});

$('#exportCsv').addEventListener('click', async () => {
  const entries = await getAll();
  download('forge-log.csv', toCSV(entries), 'text/csv');
});

$('#importFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const text = await file.text();
  const entries = file.name.endsWith('.csv') ? fromCSV(text) : fromJSON(text);
  if (entries.length) {
    await replaceAll(entries);
    render();
  }
  ev.target.value = '';
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

render();
