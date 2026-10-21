import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../studio-runtime.js', import.meta.url), 'utf8');
function load(extra = {}) {
  const context = vm.createContext({ URLSearchParams, URL, ...extra });
  vm.runInContext(code, context);
  return context.CamStudioRuntime;
}

test('blocked and full storage cannot abort Studio bootstrap', () => {
  const runtime = load();
  const blocked = runtime.safeStorage(() => { throw new Error('blocked'); });
  assert.equal(blocked.getItem('theme'), null);
  assert.equal(blocked.setItem('theme', 'dark'), false);
  assert.equal(blocked.removeItem('theme'), false);
  const full = runtime.safeStorage(() => ({ setItem() { throw new Error('full'); } }));
  assert.equal(full.setItem('theme', 'dark'), false);
});

test('explicit transport wins; saved USB survives reload; unknown values remain cloud', () => {
  const runtime = load();
  assert.equal(runtime.selectedTransport('?transport=usb', 'cloud'), 'usb');
  assert.equal(runtime.selectedTransport('', 'usb'), 'usb');
  assert.equal(runtime.selectedTransport('?transport=cloud', 'usb'), 'cloud');
  assert.equal(runtime.selectedTransport('?transport=other', 'invalid'), 'cloud');
});

test('replacement closes old tracks and room before acquiring the new source', async () => {
  const runtime = load();
  const order = [];
  const old = { getTracks: () => [{ stop() { order.push('stop-video'); } }, { stop() { order.push('stop-audio'); } }] };
  const next = { getTracks: () => [] };
  const result = await runtime.replaceSource({ previous: old, disconnect: async () => { order.push('disconnect'); }, acquire: async () => { order.push('acquire'); return next; }, isCurrent: () => true });
  assert.equal(result, next);
  assert.deepEqual(order, ['stop-video', 'stop-audio', 'disconnect', 'acquire']);
});

test('source arriving after a source switch is closed and cannot become active', async () => {
  const runtime = load();
  let current = true, resolve, signalStarted, stopped = 0;
  const started = new Promise((yes) => { signalStarted = yes; });
  const pending = new Promise((yes) => { resolve = yes; });
  const run = runtime.replaceSource({ previous: null, disconnect: async () => {}, acquire: () => { signalStarted(); return pending; }, isCurrent: () => current });
  await started;
  current = false;
  resolve({ getTracks: () => [{ stop() { stopped++; } }] });
  assert.equal(await run, null);
  assert.equal(stopped, 1);
});

test('cancellation during room cleanup does not open another device', async () => {
  const runtime = load();
  let current = true, acquired = 0;
  const result = await runtime.replaceSource({ previous: null, disconnect: async () => { current = false; }, acquire: async () => { acquired++; }, isCurrent: () => current });
  assert.equal(result, null);
  assert.equal(acquired, 0);
});

test('cleanup attempts every track even if one stop fails', () => {
  const runtime = load();
  let stopped = false;
  runtime.stopStream({ getTracks: () => [{ stop() { throw Error('closed'); } }, { stop() { stopped = true; } }] });
  assert.equal(stopped, true);
});

test('output orientation is explicit and source mode preserves native aspect', () => {
  const runtime = load();
  assert.equal(JSON.stringify(runtime.outputSize('portrait-source',1920,1080)), JSON.stringify({width:1080,height:1920}));
  assert.equal(JSON.stringify(runtime.outputSize('landscape-1080',1080,1920)), JSON.stringify({width:1920,height:1080}));
  assert.equal(JSON.stringify(runtime.outputSize('source',1280,720)), JSON.stringify({width:1280,height:720}));
});

test('FPS reports observations over elapsed time rather than the requested target', () => {
  const meter = load().frameMeter(0);
  for (let n=1;n<=60;n++) meter.source(n);
  for (let n=0;n<15;n++) meter.drawn();
  assert.equal(meter.sample(500),null);
  const observed=meter.sample(2000);
  assert.equal(observed.source,30);assert.equal(observed.drawn,7.5);
  meter.source(63);meter.drawn();
  assert.equal(meter.sample(3000).source,3);
});

test('responses are explicitly released on every simulated request', async () => {
  const runtime = load();
  let closed = 0;
  for (let i = 0; i < 5000; i++) await runtime.discardResponse({ body: { cancel: async () => { closed++; } } });
  assert.equal(closed, 5000);
  await runtime.discardResponse({ body: { cancel: async () => { throw Error('already closed'); } } });
  await runtime.discardResponse({ body: null });
});

test('UI error diagnostics never copy messages, query tokens, or arbitrary storage data', () => {
  const listeners = new Map(), data = new Map(), nodes = new Map();
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, { hidden: true, addEventListener() {}, textContent: '' }); return nodes.get(id); };
  data.set('camstudio-health-v1', JSON.stringify([{ at: 'private-token', kind: 'boot', extra: 'secret' }]));
  const runtime = load({ document: { getElementById: node }, sessionStorage: { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) }, location: { href: 'https://campoc.onrender.com/' }, addEventListener: (name, fn) => listeners.set(name, fn), setTimeout() {} });
  runtime.markReady();
  listeners.get('error')({ error: { name: 'TypeError', message: 'private-token' }, filename: 'https://campoc.onrender.com/app.js?token=private-token', lineno: 435 });
  const saved = data.get('camstudio-health-v1');
  assert.equal(saved.includes('private-token'), false);
  assert.equal(saved.includes('https://'), false);
  assert.equal(saved.includes('secret'), false);
  assert.equal(JSON.parse(saved).at(-1).file, 'app.js');
  assert.equal(JSON.parse(saved).at(-1).line, 435);
  assert.equal(node('studioRecovery').hidden, false);
});
