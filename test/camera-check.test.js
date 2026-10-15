import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraCheck } from '../camera-check.js';
import { cameraConstraints, safeSettings, summarize } from '../camera-metrics.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(acquireOverride) {
  let now = 1000, callback, nextTimer = 0, acquisitions = 0;
  const events = [], timers = new Map();
  const track = { stopped: 0, listeners: new Map(), stop() { this.stopped++; }, getSettings: () => ({ width: 1920, height: 1080, frameRate: 30, deviceId: 'private-device', groupId: 'private-group' }), addEventListener(type, listener) { this.listeners.set(type, listener); }, removeEventListener(type) { this.listeners.delete(type); } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { srcObject: null, play: async () => {}, requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() { callback = undefined; } };
  const check = new CameraCheck({ video, acquire: (...args) => { acquisitions++; return acquireOverride ? acquireOverride(...args) : Promise.resolve(stream); }, update: (event) => events.push(event), now: () => now, timers: { setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } } });
  return { check, events, track, stream, video, timers, acquisitions: () => acquisitions, tick(ms) { now += ms; }, frame(metadata) { callback(now, metadata); } };
}

test('metadata export omits device identity and unrelated settings', () => {
  assert.deepEqual(safeSettings({ width: 640, deviceId: 'private', groupId: 'private', label: 'private' }), { width: 640 });
});

test('default and exact size requests stay distinct', () => {
  assert.deepEqual(cameraConstraints('default'), { facingMode: 'user' });
  assert.equal(cameraConstraints('hd').width.exact, 1920);
  assert.equal(cameraConstraints('portrait').height.exact, 1920);
  assert.throws(() => cameraConstraints('unknown'));
});

test('summary distinguishes declared settings, rotated callbacks and full-window FPS', () => {
  const result = summarize({ samples: [
    { now: 1100, mediaTime: 1, presented: 3, width: 1080, height: 1920 },
    { now: 1200, mediaTime: 1, presented: 5, width: 1080, height: 1920 },
    { now: 1300, mediaTime: 1.2, presented: 6, width: 1080, height: 1920 },
  ], startedAt: 1000, endedAt: 1500, profile: 'hd', requested: cameraConstraints('hd'), settings: { width: 1920, height: 1080, deviceId: 'private' }, reason: 'user-stopped' });
  assert.equal(result.wallWindowCallbackFps, 6);
  assert.equal(result.callbackIntervalFps, 10);
  assert.deepEqual(result.callbackDimensions, ['1080×1920']);
  assert.equal(result.nonIncreasingMediaTime, 1);
  assert.equal(result.presentedCounterGaps, 1);
  assert.equal(result.uniqueImageContentMeasured, false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('cancel while permission is pending closes a stream that arrives late', async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  const running = f.check.start('default');
  f.check.stop();
  pending.resolve(f.stream);
  await running;
  assert.equal(f.track.stopped, 1);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.events.at(-1).phase, 'idle');
  assert.equal(f.timers.size, 0);
});

test('double start does not request two streams', async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  const running = f.check.start('hd');
  await f.check.start('default');
  assert.equal(f.acquisitions(), 1);
  f.check.stop(); pending.resolve(f.stream); await running;
});

test('30-second deadline stops tracks and reports actual observed callbacks', async () => {
  const f = fixture();
  await f.check.start('hd');
  f.tick(100); f.frame({ mediaTime: 1, presentedFrames: 1, width: 1080, height: 1920 });
  f.tick(100); f.frame({ mediaTime: 1.1, presentedFrames: 2, width: 1080, height: 1920 });
  f.tick(29800);
  [...f.timers.values()].find((timer) => timer.delay === 30000).fn();
  assert.equal(f.track.stopped, 1);
  assert.equal(f.check.busy, false);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.timers.size, 0);
  assert.equal(f.events.at(-1).result.callbacks, 2);
  assert.equal(f.events.at(-1).result.wallElapsedMs, 30000);
});

test('permission failure releases buttons and does not silently retry', async () => {
  const error = new Error('denied'); error.name = 'NotAllowedError';
  const f = fixture(() => Promise.reject(error));
  await f.check.start('portrait');
  assert.equal(f.check.busy, false);
  assert.equal(f.events.at(-1).error, 'NotAllowedError');
  assert.equal(f.acquisitions(), 1);
  assert.equal(f.timers.size, 0);
});

test('acquisition timeout closes late stream and permits a new run', async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  const running = f.check.start('default');
  [...f.timers.values()].find((timer) => timer.delay === 15000).fn();
  assert.equal(f.events.at(-1).error, 'TimeoutError');
  assert.equal(f.check.busy, false);
  pending.resolve(f.stream); await running;
  assert.equal(f.track.stopped, 1);
  assert.equal(f.video.srcObject, null);
});

test('cancel during video.play does not resurrect camera after play resolves', async () => {
  const pendingPlay = deferred();
  const f = fixture(); f.video.play = () => pendingPlay.promise;
  const running = f.check.start('default');
  await Promise.resolve();
  f.check.stop('page-hidden');
  pendingPlay.resolve(); await running;
  assert.equal(f.check.active, false);
  assert.equal(f.track.stopped, 1);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.timers.size, 0);
});

test('ending the track closes the observation and allows another run', async () => {
  const f = fixture();
  await f.check.start('default');
  f.track.listeners.get('ended')();
  assert.equal(f.events.at(-1).result.reason, 'track-ended');
  assert.equal(f.check.busy, false);
  assert.equal(f.track.listeners.size, 0);
  assert.equal(f.timers.size, 0);
});
