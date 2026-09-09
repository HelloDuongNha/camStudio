const root = document.documentElement;
const themeToggle = document.querySelector('#themeToggle');
const themeMeta = document.querySelector('meta[name="theme-color"]');
const snackbar = document.querySelector('#snackbar');
const snackbarText = document.querySelector('#snackbarText');
let snackbarTimer;
let expiryTimer;
let relayInfo;
let activeStream;
let activeRelaySession;
let relayRunning = false;
let relayGeneration = 0;
let publishedFrames = 0;

function showSnackbar(message) {
  window.clearTimeout(snackbarTimer);
  snackbarText.textContent = message;
  snackbar.hidden = false;
  snackbarTimer = window.setTimeout(() => { snackbar.hidden = true; }, 3800);
}

function setTheme(theme) {
  root.dataset.theme = theme;
  themeMeta.content = theme === 'dark' ? '#111116' : '#f8f7fc';
  localStorage.setItem('camvirtual-theme', theme);
}

const storedTheme = localStorage.getItem('camvirtual-theme');
const preferredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
setTheme(storedTheme || preferredTheme);

themeToggle.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
  showSnackbar(next === 'dark' ? 'Đã bật giao diện tối' : 'Đã bật giao diện sáng');
});

document.querySelectorAll('.segmented-control button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.segmented-control button').forEach((item) => item.classList.remove('selected'));
    button.classList.add('selected');
    showSnackbar(`Khung hình: ${button.dataset.mode}`);
  });
});

const zoomRange = document.querySelector('#zoomRange');
const rotateRange = document.querySelector('#rotateRange');
const zoomValue = document.querySelector('#zoomValue');
const rotateValue = document.querySelector('#rotateValue');
zoomRange.addEventListener('input', () => { zoomValue.value = `${zoomRange.value}%`; });
rotateRange.addEventListener('input', () => { rotateValue.value = `${rotateRange.value}°`; });

document.querySelector('#resetFrame').addEventListener('click', () => {
  zoomRange.value = 100;
  rotateRange.value = 0;
  zoomValue.value = '100%';
  rotateValue.value = '0°';
  document.querySelectorAll('.segmented-control button').forEach((item) => item.classList.toggle('selected', item.dataset.mode === 'Fit'));
  showSnackbar('Đã đặt lại khung hình');
});

document.querySelectorAll('.source-row').forEach((row) => {
  row.addEventListener('click', () => {
    if (row.querySelector('.tag')) {
      showSnackbar(`${row.dataset.source} sẽ được triển khai ở goal sau`);
      return;
    }
    document.querySelectorAll('.source-row').forEach((item) => {
      item.classList.remove('selected');
      item.setAttribute('aria-checked', 'false');
    });
    row.classList.add('selected');
    row.setAttribute('aria-checked', 'true');
    document.querySelector('#desktopSourceControls').hidden = row.id !== 'computerSource';
    showSnackbar(`Đã chọn ${row.dataset.source}`);
  });
});

const sheet = document.querySelector('#componentSheet');
const pairingSheet = document.querySelector('#pairingSheet');
const backdrop = document.querySelector('#sheetBackdrop');
const closeSheet = document.querySelector('#closeSheet');
const closePairing = document.querySelector('#closePairing');

function setSheet(activeSheet) {
  const open = Boolean(activeSheet);
  sheet.hidden = activeSheet !== sheet;
  pairingSheet.hidden = activeSheet !== pairingSheet;
  backdrop.hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';
  if (activeSheet === sheet) closeSheet.focus();
  if (activeSheet === pairingSheet) closePairing.focus();
}

document.querySelectorAll('.catalog-trigger').forEach((button) => button.addEventListener('click', () => setSheet(sheet)));
closeSheet.addEventListener('click', () => setSheet(null));
closePairing.addEventListener('click', () => setSheet(null));
backdrop.addEventListener('click', () => setSheet(null));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && (!sheet.hidden || !pairingSheet.hidden)) setSheet(null); });
document.querySelector('#snackbarAction').addEventListener('click', () => { snackbar.hidden = true; });

const PAIRING_STORAGE_KEY = 'camvirtual-pairing-session-v1';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SESSION_LIFETIME_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2500;
const PUBLISH_INTERVAL_MS = 67;

async function fetchWithTimeout(input, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function getRelayInfo() {
  if (relayInfo) return relayInfo;
  const response = await fetchWithTimeout('/api/info', { cache: 'no-store' });
  if (!response.ok) throw new Error('relay_unavailable');
  relayInfo = await response.json();
  return relayInfo;
}

function randomString(length, alphabet) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function registerPairingSession(session) {
  const response = await fetchWithTimeout('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room: session.room,
      token: session.token,
      expires: Math.floor(session.expiresAt / 1000),
    }),
  });
  if (!response.ok) throw new Error('session_registration_failed');
  const registered = await response.json();
  session.origin = registered.receiverOrigin;
  session.pairCode = registered.pairCode;
  session.pairExpiresAt = registered.pairExpires * 1000;
  activeRelaySession = session;
  localStorage.setItem(PAIRING_STORAGE_KEY, JSON.stringify(session));
  return session;
}

async function makePairingSession() {
  const info = await getRelayInfo();
  const session = {
    version: 1,
    room: randomString(6, ROOM_ALPHABET),
    token: randomToken(),
    expiresAt: Date.now() + SESSION_LIFETIME_MS,
    origin: info.receiverOrigin,
  };
  return registerPairingSession(session);
}

function pairingUri(session) {
  const query = new URLSearchParams({
    v: String(session.version),
    room: session.room,
    token: session.token,
    expires: String(Math.floor(session.expiresAt / 1000)),
    origin: session.origin,
  });
  return `camvirtual://pair?${query.toString()}`;
}

function readPairingSession() {
  try {
    const session = JSON.parse(localStorage.getItem(PAIRING_STORAGE_KEY));
    if (session?.version === 1 && session.expiresAt > Date.now()) return session;
  } catch (_) {
    // Corrupt local state is treated as revoked.
  }
  localStorage.removeItem(PAIRING_STORAGE_KEY);
  return null;
}

function renderPairing(session) {
  const uri = pairingUri(session);
  const qr = qrcode(0, 'M');
  qr.addData(uri, 'Byte');
  qr.make();
  document.querySelector('#qrCode').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
  document.querySelector('#pairingCode').textContent = session.pairCode;
  const badge = document.querySelector('#sessionBadge');
  badge.classList.add('success');
  badge.innerHTML = `<span></span>Phiên ${session.room}`;
  document.querySelector('#pairButton').textContent = 'Xem mã ghép nối';
  window.clearInterval(expiryTimer);
  const tick = () => {
    const remaining = Math.max(0, session.pairExpiresAt - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    document.querySelector('#pairingExpiry').textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    if (remaining === 0) {
      window.clearInterval(expiryTimer);
      document.querySelector('#pairingExpiry').textContent = 'Hết hạn';
      showSnackbar('Mã nhập đã hết hạn; tạo mã mới để ghép thiết bị khác');
    }
  };
  tick();
  expiryTimer = window.setInterval(tick, 1000);
}

async function ensurePairingSession(forceNew = false) {
  if (forceNew) {
    const previous = readPairingSession();
    if (previous) {
      await fetch(`/api/rooms/${previous.room}?token=${encodeURIComponent(previous.token)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    return makePairingSession();
  }
  const existing = readPairingSession();
  if (existing) {
    const info = await getRelayInfo();
    existing.origin = info.receiverOrigin;
    return registerPairingSession(existing);
  }
  return makePairingSession();
}

async function openPairing(forceNew = false) {
  try {
    const session = await ensurePairingSession(forceNew);
    renderPairing(session);
    setSheet(pairingSheet);
  } catch (_) {
    showSnackbar('Không khởi tạo được server truyền LAN. Hãy chạy npm start.');
  }
}

function revokePairing(message = 'Đã thu hồi phiên ghép nối') {
  const session = readPairingSession();
  if (session) {
    fetch(`/api/rooms/${session.room}?token=${encodeURIComponent(session.token)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }
  relayRunning = false;
  relayGeneration += 1;
  activeRelaySession = undefined;
  localStorage.removeItem(PAIRING_STORAGE_KEY);
  window.clearInterval(expiryTimer);
  const badge = document.querySelector('#sessionBadge');
  badge.classList.remove('success');
  badge.innerHTML = '<span></span>Chưa ghép nối';
  document.querySelector('#pairButton').textContent = 'Tạo mã ghép nối';
  setSheet(null);
  showSnackbar(message);
}

document.querySelector('#pairButton').addEventListener('click', () => { void openPairing(false); });
document.querySelector('#newPairing').addEventListener('click', async () => {
  await openPairing(true);
  showSnackbar('Đã tạo mã mới; mã cũ không còn dùng trên web này');
});
document.querySelector('#revokePairing').addEventListener('click', () => revokePairing());
document.querySelector('#copyPairing').addEventListener('click', async () => {
  const session = readPairingSession();
  if (!session) {
    revokePairing('Phiên đã hết hạn');
    return;
  }
  try {
    await navigator.clipboard.writeText(pairingUri(session));
    showSnackbar('Đã sao chép link ghép nối');
  } catch (_) {
    showSnackbar('Không thể sao chép; hãy quét QR');
  }
});

const videoPreview = document.querySelector('#sourcePreview');
const relayCanvas = document.querySelector('#relayCanvas');
const relayStatus = document.querySelector('#relayStatus');
const videoDevice = document.querySelector('#videoDevice');
const startRelay = document.querySelector('#startRelay');

async function populateVideoDevices(selectedId = '') {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  videoDevice.replaceChildren(new Option('Tự động chọn', ''));
  cameras.forEach((camera, index) => {
    videoDevice.add(new Option(camera.label || `Camera ${index + 1}`, camera.deviceId));
  });
  videoDevice.value = selectedId;
}

function frameBlob() {
  const context = relayCanvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(videoPreview, 0, 0, relayCanvas.width, relayCanvas.height);
  return new Promise((resolve) => relayCanvas.toBlob(resolve, 'image/jpeg', 0.82));
}

async function recoverRelay(session) {
  relayInfo = null;
  const info = await getRelayInfo();
  session.origin = info.receiverOrigin;
  await registerPairingSession(session);
}

async function publishFrames(initialSession, generation) {
  if (generation !== relayGeneration) return;
  activeRelaySession = initialSession;
  relayRunning = true;
  publishedFrames = 0;
  let consecutiveFailures = 0;
  while (
    relayRunning && generation === relayGeneration && activeStream &&
    activeStream.getVideoTracks().some((track) => track.readyState === 'live')
  ) {
    const session = activeRelaySession;
    if (!session || session.expiresAt <= Date.now()) {
      relayStatus.textContent = 'Phiên đã hết hạn; hãy tạo mã ghép nối mới.';
      break;
    }
    const startedAt = performance.now();
    try {
      const blob = await frameBlob();
      if (!blob) throw new Error('jpeg_failed');
      const response = await fetchWithTimeout(
        `/api/rooms/${session.room}/frame?token=${encodeURIComponent(session.token)}`,
        { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob },
      );
      if (!response.ok) throw new Error(`publish_${response.status}`);
      publishedFrames += 1;
      consecutiveFailures = 0;
      relayStatus.textContent = `Đang phát thật qua LAN • ${publishedFrames} frame`;
    } catch (_) {
      if (generation !== relayGeneration) break;
      consecutiveFailures += 1;
      relayStatus.textContent = `Mất kết nối với relay • đang tự nối lại (${consecutiveFailures})…`;
      try {
        await recoverRelay(session);
      } catch (_) {
        // The bounded retry below keeps the UI responsive while the relay is offline.
      }
    }
    const elapsed = performance.now() - startedAt;
    const retryDelay = consecutiveFailures ? 500 : Math.max(0, PUBLISH_INTERVAL_MS - elapsed);
    if (retryDelay > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
    }
  }
}

async function startDesktopSource() {
  startRelay.disabled = true;
  startRelay.textContent = 'Đang mở nguồn…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('media_unsupported');
    relayRunning = false;
    const generation = ++relayGeneration;
    activeStream?.getTracks().forEach((track) => track.stop());
    const selectedId = videoDevice.value;
    activeStream = await navigator.mediaDevices.getUserMedia({
      video: selectedId ? { deviceId: { exact: selectedId } } : true,
      audio: false,
    });
    await populateVideoDevices(activeStream.getVideoTracks()[0]?.getSettings().deviceId || selectedId);
    videoPreview.srcObject = activeStream;
    videoPreview.hidden = false;
    document.querySelector('.preview-empty').hidden = true;
    await videoPreview.play();
    const session = await ensurePairingSession(false);
    renderPairing(session);
    relayStatus.textContent = 'Nguồn đã mở; đang gửi frame đầu tiên…';
    startRelay.textContent = 'Đổi / khởi động lại nguồn';
    void publishFrames(session, generation);
  } catch (error) {
    relayStatus.textContent = error.name === 'NotAllowedError'
      ? 'Bạn chưa cấp quyền camera cho trang này.'
      : 'Không mở được camera/OBS hoặc relay LAN.';
    startRelay.textContent = 'Thử lại';
  } finally {
    startRelay.disabled = false;
  }
}

startRelay.addEventListener('click', () => { void startDesktopSource(); });
document.querySelectorAll('.permission-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelector('#computerSource').click();
    void startDesktopSource();
  });
});

const activeSession = readPairingSession();
if (activeSession) {
  ensurePairingSession(false).then(renderPairing).catch(() => revokePairing('Server LAN chưa hoạt động'));
}
