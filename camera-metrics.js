export function cameraConstraints(profile) {
  const sizes = { hd: [1920, 1080], portrait: [1080, 1920] };
  if (profile === 'default') return { facingMode: 'user' };
  const size = sizes[profile];
  if (!size) throw new Error('Unknown camera test profile');
  return { facingMode: 'user', width: { exact: size[0] }, height: { exact: size[1] }, frameRate: { ideal: 30 } };
}

export function safeSettings(settings) {
  return Object.fromEntries(['width', 'height', 'frameRate', 'aspectRatio', 'facingMode', 'resizeMode']
    .filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]]));
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) * fraction)] : null;
}

export function summarize({ samples, startedAt, endedAt, profile, requested, settings, reason }) {
  const intervals = samples.slice(1).map((sample, i) => sample.now - samples[i].now);
  const mediaIntervals = samples.slice(1).map((sample, i) => (sample.mediaTime - samples[i].mediaTime) * 1000);
  const observedMs = samples.length > 1 ? samples.at(-1).now - samples[0].now : 0;
  const wallMs = Math.max(0, endedAt - startedAt);
  return {
    schemaVersion: 1, profile, reason, requested, settings: safeSettings(settings),
    wallElapsedMs: wallMs, callbacks: samples.length,
    wallWindowCallbackFps: wallMs ? samples.length * 1000 / wallMs : null,
    callbackIntervalFps: observedMs ? (samples.length - 1) * 1000 / observedMs : null,
    callbackDimensions: [...new Set(samples.map((sample) => `${sample.width}×${sample.height}`))],
    callbackIntervalMs: { p5: percentile(intervals, .05), median: percentile(intervals, .5), p95: percentile(intervals, .95), max: intervals.length ? Math.max(...intervals) : null },
    nonIncreasingMediaTime: mediaIntervals.filter((value) => value <= 0).length,
    presentedCounterGaps: samples.slice(1).reduce((sum, sample, i) => sum + Math.max(0, sample.presented - samples[i].presented - 1), 0),
    uniqueImageContentMeasured: false,
  };
}
