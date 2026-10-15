import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../studio-runtime.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

// Minimal DOM fixture using the real HTML IDs/classes. No real device, browser,
// image capture, credentials, or network is used by these bootstrap tests.
function fixture({ query = '', deniedStorage = false, acquire } = {}) {
  const nodes = [], ids = new Map(), windowEvents = new Map(), timers = new Map();
  let nextTimer = 0;
  for (const match of html.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...match[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]));
    const classes = new Set((attrs.class || '').split(/\s+/));
    const events = new Map();
    const node = { id: attrs.id || '', tagName: match[1].toUpperCase(), attrs, events, style: {}, dataset: {}, hidden: false, value: attrs.value || '', textContent: '', innerHTML: '', options: [], selectedOptions: [],
      classList: { add: (...items) => items.forEach((item) => classes.add(item)), remove: (...items) => items.forEach((item) => classes.delete(item)), contains: (item) => classes.has(item), toggle(item, force) { const on = force ?? !classes.has(item); if (on) classes.add(item); else classes.delete(item); return on; } },
      addEventListener(name, fn) { events.set(name, fn); }, click() { events.get('click')?.(); }, setAttribute(name, value) { attrs[name] = value; }, getAttribute(name) { return attrs[name]; }, focus() {}, closest() { return null; },
      querySelector() { return null; }, replaceChildren(...items) { this.options = items; }, add(item) { this.options.push(item); },
      pause() {}, async play() {}, videoWidth: 1080, videoHeight: 1920,
      getContext: () => ({ setTransform() {}, clearRect() {}, translate() {}, rotate() {}, scale() {}, drawImage() {} }),
    };
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    nodes.push(node); if (attrs.id) ids.set(attrs.id, node);
  }
  ids.get('outputResolution').value = 'portrait-source';
  ids.get('outputFps').value = '30'; ids.get('zoomRange').value = '100'; ids.get('rotateRange').value = '0';
  const queryAll = (selector) => {
    if (selector === '.segmented-control button') return nodes.filter((node) => node.tagName === 'BUTTON' && node.attrs['data-mode']);
    if (selector.startsWith('.')) return nodes.filter((node) => node.classList.contains(selector.slice(1)));
    return [];
  };
  const document = { documentElement: { dataset: {} }, body: { style: {} },
    getElementById: (id) => ids.get(id) || null,
    querySelector(selector) { if (selector.startsWith('#')) return ids.get(selector.slice(1)) || null; if (selector.startsWith('.')) return queryAll(selector)[0] || null; if (selector.startsWith('meta[')) return nodes.find((node) => node.tagName === 'META' && node.attrs.name === 'theme-color'); return null; },
    querySelectorAll: queryAll, addEventListener() {},
  };
  const local = new Map(), session = new Map();
  const storage = (map) => ({ getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) });
  const location = new URL('https://campoc.onrender.com/' + query);
  const context = vm.createContext({ document, URL, URLSearchParams, AbortController, performance, location,
    navigator: { mediaDevices: { getUserMedia: acquire || (async () => { throw new Error('No synthetic source configured'); }), enumerateDevices: async () => [] } },
    localStorage: storage(local), sessionStorage: storage(session),
    history: { replaceState(_state, _title, url) { location.href = String(url); } },
    matchMedia: () => ({ matches: false }), prompt: () => '', Option: function (text, value) { this.textContent = text; this.value = value; },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearInterval(id) { timers.delete(id); },
    addEventListener: (name, fn) => windowEvents.set(name, fn), fetch: async () => ({ ok: true, json: async () => ({ transport: 'livekit-v2' }) }),
  });
  context.window = context;
  if (deniedStorage) Object.defineProperty(context, 'localStorage', { get() { throw new Error('Storage denied'); } });
  vm.runInContext(runtime, context); vm.runInContext(app, context);
  return { context, ids, local, session, windowEvents, run: (expression) => vm.runInContext(expression, context) };
}

function stream() {
  const track = { readyState: 'live', stops: 0, stop() { this.stops++; this.readyState = 'ended'; }, getSettings: () => ({ width: 1080, height: 1920, frameRate: 30 }) };
  return { track, getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
}

test('real Studio scripts bootstrap with USB query and select the correct controls', () => {
  const f = fixture({ query: '?transport=usb' });
  assert.equal(f.run('isUsbMode'), true);
  assert.equal(f.ids.get('nearSource').classList.contains('selected'), true);
  assert.equal(f.ids.get('desktopSourceControls').hidden, false);
  assert.ok(JSON.parse(f.session.get('camstudio-health-v1')).some((entry) => entry.kind === 'ready'));
});

test('blocked browser storage does not stop real Studio bootstrap', () => {
  const f = fixture({ deniedStorage: true });
  assert.ok(JSON.parse(f.session.get('camstudio-health-v1')).some((entry) => entry.kind === 'ready'));
});

test('rapid source-start requests result in a single getUserMedia request', async () => {
  let resolve, calls = 0;
  const pending = new Promise((yes) => { resolve = yes; });
  const f = fixture({ acquire: () => { calls++; return pending; } });
  const first = f.run('startDesktopSource()');
  assert.equal(await f.run('startDesktopSource()'), false);
  await new Promise((done) => setImmediate(done));
  assert.equal(calls, 1);
  const source = stream(); resolve(source);
  assert.equal(await first, true);
  f.windowEvents.get('pagehide')();
  assert.equal(source.track.stops, 1);
  assert.equal(f.run('activeStream'), undefined);
});

test('changing source while acquisition is pending disposes the late stream', async () => {
  let resolve;
  const pending = new Promise((yes) => { resolve = yes; });
  const f = fixture({ acquire: () => pending });
  const first = f.run('startDesktopSource()');
  await new Promise((done) => setImmediate(done));
  f.ids.get('nearSource').click();
  const source = stream(); resolve(source);
  assert.equal(await first, false);
  assert.equal(source.track.stops, 1);
  assert.equal(f.run('activeStream'), undefined);
  assert.equal(f.ids.get('startRelay').disabled, false);
});
