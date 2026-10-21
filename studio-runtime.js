(function (root) {
  'use strict';

  function safeStorage(getStorage) {
    return {
      getItem(key) { try { return getStorage().getItem(key); } catch { return null; } },
      setItem(key, value) { try { getStorage().setItem(key, value); return true; } catch { return false; } },
      removeItem(key) { try { getStorage().removeItem(key); return true; } catch { return false; } },
    };
  }

  function selectedTransport(search, saved) {
    const requested = new URLSearchParams(search).get('transport');
    if (requested === 'usb' || requested === 'cloud') return requested;
    return saved === 'usb' ? 'usb' : 'cloud';
  }

  function stopStream(stream) {
    stream?.getTracks().forEach((track) => { try { track.stop(); } catch { /* Close other tracks too. */ } });
  }

  async function replaceSource({ previous, disconnect, acquire, isCurrent }) {
    // Release the old device before requesting the next capture session.
    stopStream(previous);
    await disconnect();
    if (!isCurrent()) return null;
    const next = await acquire();
    if (isCurrent()) return next;
    stopStream(next);
    return null;
  }

  async function discardResponse(response) {
    try { await response.body?.cancel(); } catch { /* Response is already closed. */ }
  }

  function outputSize(mode, width, height) {
    if (mode.startsWith('portrait-')) return { width: 1080, height: 1920 };
    if (mode.startsWith('landscape-')) return { width: 1920, height: 1080 };
    return { width: Math.max(2, Math.round(width / 2) * 2), height: Math.max(2, Math.round(height / 2) * 2) };
  }

  function frameMeter(start) {
    let since = start, source = 0, drawn = 0, lastPresented;
    return {
      source(presented) {
        source += Number.isFinite(presented) && Number.isFinite(lastPresented) ? Math.max(0, presented - lastPresented) : 1;
        lastPresented = presented;
      },
      drawn() { drawn++; },
      sample(now) {
        const elapsed = (now - since) / 1000;
        if (elapsed < 1) return null;
        const result = { source: source / elapsed, drawn: drawn / elapsed };
        since = now; source = 0; drawn = 0;
        return result;
      },
    };
  }

  const api = { safeStorage, selectedTransport, stopStream, replaceSource, discardResponse, outputSize, frameMeter };
  root.CamStudioRuntime = api;
  if (!root.document) return;

  const storage = safeStorage(() => root.sessionStorage);
  const key = 'camstudio-health-v1';
  const kinds = /^(boot|ready|script-error|resource-error|promise-error|source-start|source-start-failed|source-ended|page-hidden)$/;
  const errorNames = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'SecurityError', 'QuotaExceededError', 'NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError', 'OverconstrainedError'];
  const sourceFiles = ['app.js', 'studio-runtime.js', 'styles.css', 'qrcode.js', 'livekit-client.umd.js'];
  let records;
  try { records = JSON.parse(storage.getItem(key)) || []; } catch { records = []; }
  if (!Array.isArray(records)) records = [];
  // Previous records are never trusted or copied wholesale into diagnostics.
  records = records.filter((item) => item && typeof item.at === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item.at) && kinds.test(item.kind))
    .map((item) => {
      const entry = { at: item.at, kind: item.kind };
      if (errorNames.includes(item.error)) entry.error = item.error;
      if (sourceFiles.includes(item.file)) {
        entry.file = item.file;
        if (Number.isSafeInteger(item.line) && item.line > 0) entry.line = item.line;
      }
      return entry;
    }).slice(-20);
  const banner = root.document.getElementById('studioRecovery');
  let ready = false;
  function record(kind, error, event) {
    if (!kinds.test(kind)) return;
    const entry = { at: new Date().toISOString(), kind };
    if (errorNames.includes(error?.name)) entry.error = error.name;
    try {
      const source = event?.filename || event?.target?.src || event?.target?.href;
      const file = new URL(source || '', root.location.href).pathname.split('/').pop();
      if (source && sourceFiles.includes(file)) {
        entry.file = file;
        if (Number.isSafeInteger(event.lineno) && event.lineno > 0) entry.line = event.lineno;
      }
    } catch { /* Never export a raw URL or error message. */ }
    records.push(entry); records = records.slice(-20);
    storage.setItem(key, JSON.stringify(records));
  }
  function showRecovery() { if (banner) banner.hidden = false; }
  api.record = record;
  api.markReady = () => { ready = true; record('ready'); };
  record('boot');
  root.addEventListener('error', (event) => {
    record(event.target?.tagName === 'SCRIPT' || event.target?.tagName === 'LINK' ? 'resource-error' : 'script-error', event.error, event);
    showRecovery();
  }, true);
  root.addEventListener('unhandledrejection', (event) => { record('promise-error', event.reason); showRecovery(); });
  root.setTimeout(() => { if (!ready) showRecovery(); }, 15000);
  root.document.getElementById('studioReload')?.addEventListener('click', () => root.location.reload());
  root.document.getElementById('studioDismiss')?.addEventListener('click', () => { banner.hidden = true; });
  root.document.getElementById('studioCopyHealth')?.addEventListener('click', async () => {
    const status = root.document.getElementById('studioHealthStatus');
    try {
      await root.navigator.clipboard.writeText(JSON.stringify({ version: 1, records }, null, 2));
      status.textContent = 'Đã sao chép mốc lỗi giao diện; không có ảnh, token hoặc URL phiên.';
    } catch { status.textContent = 'Chưa sao chép được. Giữ trang mở để kiểm tra; không cần gửi khóa truy cập.'; }
  });
}(globalThis));
