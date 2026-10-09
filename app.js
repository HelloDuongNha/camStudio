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
let liveKitRoom;
let canvasPumpTimer;
let canvasCaptureStream;
const USB_ORIGIN = 'http://127.0.0.1:4173';
let isUsbMode = false;
const apiUrl = (path) => isUsbMode ? `${USB_ORIGIN}${path}` : path;

function updateTransportUi() {
  document.querySelector('#transportHint').textContent = isUsbMode
    ? 'USB trực tiếp đang chọn. Chạy start_usb_mode.sh trên máy tính rồi bật camera/OBS; QR sẽ nối qua cáp, không qua Render.'
    : 'Camera / OBS từ xa phát qua Cloud Render / LiveKit.';
  document.querySelector('#pairingTransportNote').textContent = isUsbMode
    ? 'USB: quét QR trong CamPOC; mã chữ LAN không hoạt động qua cáp. Luồng này hiện chỉ truyền hình.'
    : 'Cloud: phát camera và micro qua Render / LiveKit.';
  const audioLabel = document.querySelector('#audioDevice')?.closest('label');
  if (audioLabel) audioLabel.hidden = isUsbMode;
}
updateTransportUi();

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
    const nextUsbMode = row.id === 'nearSource';
    if (nextUsbMode !== isUsbMode) {
      if (readPairingSession()) revokePairing('Đã đổi đường truyền; tạo QR mới cho nguồn này');
      relayRunning = false;
      relayGeneration += 1;
      stopCanvasPump();
      activeStream?.getTracks().forEach((track) => track.stop());
      activeStream = undefined;
      relayInfo = undefined;
      isUsbMode = nextUsbMode;
      updateTransportUi();
      document.querySelector('#sourcePreview').hidden = true;
      document.querySelector('.preview-empty').hidden = false;
      document.querySelector('#relayStatus').textContent = 'Chưa phát dữ liệu.';
    }
    document.querySelectorAll('.source-row').forEach((item) => {
      item.classList.remove('selected');
      item.setAttribute('aria-checked', 'false');
    });
    row.classList.add('selected');
    row.setAttribute('aria-checked', 'true');
    document.querySelector('#desktopSourceControls').hidden = row.id !== 'computerSource' && row.id !== 'nearSource';
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
const pairingStorageKey = () => isUsbMode ? `${PAIRING_STORAGE_KEY}-usb` : PAIRING_STORAGE_KEY;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SESSION_LIFETIME_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2500;
const outputResolution = document.querySelector('#outputResolution');
const outputFps = document.querySelector('#outputFps');
const previewResolution = document.querySelector('#previewResolution');
const previewStage = document.querySelector('#previewStage');
const publishIntervalMs = () => 1000 / Number(outputFps.value || 30);
[outputResolution, outputFps].forEach((control) => control.addEventListener('change', () => {
  if (control === outputResolution) {
    previewStage.classList.toggle('landscape', outputResolution.value.startsWith('landscape-'));
    previewStage.style.aspectRatio = '';
  }
  if (hasLiveSource()) showSnackbar('Bấm “Đổi / khởi động lại nguồn” để áp dụng chất lượng mới');
}));

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
  try {
    // The first nearby request may pause for Chrome's Local Network Access permission prompt.
    const response = await fetchWithTimeout(apiUrl('/api/info'), { cache: 'no-store' }, isUsbMode ? 30000 : 1200);
    if (!response.ok) throw new Error('relay_unavailable');
    relayInfo = await response.json();
    if (isUsbMode && relayInfo.transport !== 'lan-jpeg-v1') throw new Error('usb_relay_unavailable');
  } catch (_) {
    if (isUsbMode) throw new Error('usb_relay_unavailable');
    relayInfo = { transport: 'livekit-v2' };
  }
  return relayInfo;
}

function studioAccessKey() {
  let value = sessionStorage.getItem('camstudio-access-key') || '';
  if (!value) {
    value = window.prompt('Nhập khóa truy cập Cam Studio đã đặt trên dịch vụ triển khai')?.trim() || '';
    if (value) sessionStorage.setItem('camstudio-access-key', value);
  }
  return value;
}

async function createRemoteSession() {
  const accessKey = studioAccessKey();
  if (!accessKey) throw new Error('access_key_required');
  const response = await fetchWithTimeout('/api/session', {
    method: 'POST',
    headers: { 'X-CamStudio-Access-Key': accessKey },
  }, 8000);
  if (response.status === 401) {
    sessionStorage.removeItem('camstudio-access-key');
    throw new Error('access_denied');
  }
  if (!response.ok) throw new Error('remote_session_failed');
  const remote = await response.json();
  return {
    version: remote.version,
    transport: remote.transport,
    room: remote.room,
    token: remote.receiverToken,
    publisherToken: remote.publisherToken,
    expiresAt: remote.expires * 1000,
    pairExpiresAt: remote.expires * 1000,
    pairCode: 'QR / LINK',
    origin: remote.livekitUrl,
  };
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
  if (session.transport === 'livekit') {
    activeRelaySession = session;
    localStorage.setItem(pairingStorageKey(), JSON.stringify(session));
    return session;
  }
  const response = await fetchWithTimeout(apiUrl('/api/sessions'), {
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
  session.origin = isUsbMode ? USB_ORIGIN : registered.receiverOrigin;
  session.pairCode = registered.pairCode;
  session.pairExpiresAt = registered.pairExpires * 1000;
  activeRelaySession = session;
  localStorage.setItem(pairingStorageKey(), JSON.stringify(session));
  return session;
}

async function makePairingSession() {
  const info = await getRelayInfo();
  if (info.transport === 'livekit-v2') return createRemoteSession();
  const session = {
    version: 1,
    room: randomString(6, ROOM_ALPHABET),
    token: randomToken(),
    expiresAt: Date.now() + SESSION_LIFETIME_MS,
    origin: isUsbMode ? USB_ORIGIN : info.receiverOrigin,
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
  if (session.transport === 'livekit') query.set('transport', 'livekit');
  return `camvirtual://pair?${query.toString()}`;
}

function readPairingSession() {
  try {
    const session = JSON.parse(localStorage.getItem(pairingStorageKey()));
    if ((session?.version === 1 || session?.version === 2) && session.expiresAt > Date.now()) return session;
  } catch (_) {
    // Corrupt local state is treated as revoked.
  }
  localStorage.removeItem(pairingStorageKey());
  return null;
}

function renderPairing(session) {
  const uri = pairingUri(session);
  const qr = qrcode(0, 'M');
  qr.addData(uri, 'Byte');
  qr.make();
  document.querySelector('#qrCode').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
  document.querySelector('#pairingCode').textContent = isUsbMode ? 'Quét QR' : session.pairCode;
  document.querySelector('#pairingLink').value = uri;
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

function setPairingLiveState(message, live = false) {
  const state = document.querySelector('#pairingLiveState');
  state.textContent = message;
  state.classList.toggle('live', live);
}

function hasLiveSource() {
  return Boolean(activeStream?.getVideoTracks().some((track) => track.readyState === 'live'));
}

function publishCurrentSource(session) {
  if (!hasLiveSource()) {
    setPairingLiveState('Đã có QR · bấm “Bật camera / OBS” trước khi mở camera trên điện thoại');
    return;
  }
  const generation = ++relayGeneration;
  relayRunning = false;
  stopCanvasPump();
  setPairingLiveState(isUsbMode ? 'Đang nối camera qua USB…' : 'Đang nối camera/mic với phòng mới…');
  void publishFrames(session, generation);
}

async function ensurePairingSession(forceNew = false) {
  if (forceNew) {
    const previous = readPairingSession();
    if (previous && previous.transport !== 'livekit') {
      await fetch(apiUrl(`/api/rooms/${previous.room}?token=${encodeURIComponent(previous.token)}`), {
        method: 'DELETE',
      }).catch(() => {});
    }
    if (liveKitRoom) {
      await liveKitRoom.disconnect();
      liveKitRoom = undefined;
    }
    return makePairingSession();
  }
  const existing = readPairingSession();
  if (existing) {
    if (existing.transport === 'livekit') return registerPairingSession(existing);
    const info = await getRelayInfo();
    existing.origin = isUsbMode ? USB_ORIGIN : info.receiverOrigin;
    return registerPairingSession(existing);
  }
  return makePairingSession();
}

async function openPairing(forceNew = false) {
  try {
    const session = await ensurePairingSession(forceNew);
    renderPairing(session);
    setSheet(pairingSheet);
    if (forceNew) publishCurrentSource(session);
    else if (relayRunning && hasLiveSource()) setPairingLiveState(isUsbMode ? 'Camera đang phát qua USB' : 'Camera + mic đang phát tới điện thoại', true);
    else setPairingLiveState(isUsbMode ? 'Đã có QR · chưa phát camera' : 'Đã có QR · chưa phát camera/mic');
  } catch (error) {
    const message = error.message === 'access_key_required'
      ? 'Cần khóa truy cập Cam Studio để tạo phiên remote.'
      : error.message === 'access_denied'
        ? 'Khóa truy cập Cam Studio không đúng.'
        : isUsbMode ? 'Không nối được USB. Hãy cho phép Chrome truy cập mạng cục bộ, rồi kiểm tra server.py và adb reverse.' : 'Không tạo được phiên remote. Kiểm tra cấu hình LiveKit trên máy chủ.';
    showSnackbar(message);
  }
}

function revokePairing(message = 'Đã thu hồi phiên ghép nối') {
  const session = readPairingSession();
  if (session && session.transport !== 'livekit') {
    fetch(apiUrl(`/api/rooms/${session.room}?token=${encodeURIComponent(session.token)}`), {
      method: 'DELETE',
    }).catch(() => {});
  }
  relayRunning = false;
  relayGeneration += 1;
  stopCanvasPump();
  if (liveKitRoom) {
    void liveKitRoom.disconnect();
    liveKitRoom = undefined;
  }
  activeRelaySession = undefined;
  localStorage.removeItem(pairingStorageKey());
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
document.querySelector('#startPairingSource').addEventListener('click', () => { void startDesktopSource(true); });
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
const audioDevice = document.querySelector('#audioDevice');
const startRelay = document.querySelector('#startRelay');
const cameraFormatHelp = document.querySelector('#cameraFormatHelp');

function updateCameraFormatHelp() {
  if (!cameraFormatHelp) return;
  const selectedLabel = videoDevice.selectedOptions[0]?.textContent || '';
  cameraFormatHelp.hidden = !/OBS Virtual Camera/i.test(selectedLabel);
  cameraFormatHelp.textContent = 'Studio lấy trực tiếp OBS Virtual Camera. Kích thước thực tế ở preview do camera ảo cấp; cài canvas dọc trong OBS không bảo đảm camera ảo trên macOS xuất dọc.';
}

videoDevice.addEventListener('change', updateCameraFormatHelp);

async function populateDevices(selectedVideoId = '', selectedAudioId = '') {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  const microphones = devices.filter((device) => device.kind === 'audioinput');
  videoDevice.replaceChildren(
    new Option('Tự động chọn camera', ''),
  );
  cameras.forEach((camera, index) => {
    videoDevice.add(new Option(camera.label || `Camera ${index + 1}`, camera.deviceId));
  });
  videoDevice.value = selectedVideoId;
  updateCameraFormatHelp();
  audioDevice.replaceChildren(new Option('Tự động chọn', ''));
  microphones.forEach((microphone, index) => {
    audioDevice.add(new Option(microphone.label || `Microphone ${index + 1}`, microphone.deviceId));
  });
  audioDevice.value = selectedAudioId;
}

function drawRelayFrame() {
  const context = relayCanvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(videoPreview, 0, 0, relayCanvas.width, relayCanvas.height);
}

function frameBlob() {
  drawRelayFrame();
  return new Promise((resolve) => relayCanvas.toBlob(resolve, 'image/jpeg', 0.96));
}

function stopCanvasPump() {
  if (canvasPumpTimer) window.clearInterval(canvasPumpTimer);
  canvasPumpTimer = undefined;
  canvasCaptureStream?.getTracks().forEach((track) => track.stop());
  canvasCaptureStream = undefined;
}

function startCanvasPump(generation) {
  stopCanvasPump();
  drawRelayFrame();
  canvasPumpTimer = window.setInterval(() => {
    if (generation !== relayGeneration || !hasLiveSource()) {
      stopCanvasPump();
      return;
    }
    drawRelayFrame();
  }, publishIntervalMs());
}

function configureRelayCanvas(track) {
  const settings = track.getSettings();
  const sourceWidth = videoPreview.videoWidth || settings.width;
  const sourceHeight = videoPreview.videoHeight || settings.height;
  if (!sourceWidth || !sourceHeight) throw new Error('source_resolution_unavailable');
  const profile = outputResolution.value;
  const maxShortEdge = profile.endsWith('source') ? Infinity : Number(profile.split('-')[1]);
  const scale = Math.min(1, maxShortEdge / Math.min(sourceWidth, sourceHeight));
  relayCanvas.width = Math.max(2, Math.round(sourceWidth * scale / 2) * 2);
  relayCanvas.height = Math.max(2, Math.round(sourceHeight * scale / 2) * 2);
  previewStage.classList.toggle('landscape', relayCanvas.width >= relayCanvas.height);
  previewStage.style.aspectRatio = `${relayCanvas.width} / ${relayCanvas.height}`;
  videoPreview.style.objectFit = 'contain';
  const sourceIsLandscape = sourceWidth >= sourceHeight;
  const portraitMismatch = profile.startsWith('portrait-') && sourceIsLandscape;
  previewResolution.textContent = `${sourceWidth}×${sourceHeight} → ${relayCanvas.width}×${relayCanvas.height} · ${Math.round(settings.frameRate || Number(outputFps.value))} fps${portraitMismatch ? ' · nguồn đang ngang; giữ nguyên toàn khung' : ''}`;
}

function desktopMediaConstraints(videoDeviceId, audioDeviceId, desiredFps, sizeMode) {
  const profile = outputResolution.value;
  const portrait = profile.startsWith('portrait-');
  const shortEdge = profile === 'portrait-source' ? 1080
    : profile === 'source' ? 0 : Number(profile.split('-')[1]);
  const targetWidth = portrait ? shortEdge : Math.round(shortEdge * 16 / 9);
  const targetHeight = portrait ? Math.round(shortEdge * 16 / 9) : shortEdge;
  let dimensions = {};
  if (profile !== 'source' && sizeMode !== 'none') {
    dimensions = sizeMode === 'exact'
      ? { width: { exact: targetWidth }, height: { exact: targetHeight } }
      : { width: { ideal: targetWidth }, height: { ideal: targetHeight } };
  }
  return {
    video: {
      ...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {}),
      ...dimensions,
      frameRate: { ideal: desiredFps },
      resizeMode: portrait && sizeMode === 'exact' ? { exact: 'none' } : { ideal: 'none' },
    },
    audio: isUsbMode ? false : audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
  };
}

async function openDesktopStream(videoDeviceId, audioDeviceId, desiredFps) {
  const profile = outputResolution.value;
  const sizeMode = profile === 'source' ? 'none' : 'exact';
  try {
    return await navigator.mediaDevices.getUserMedia(
      desktopMediaConstraints(videoDeviceId, audioDeviceId, desiredFps, sizeMode),
    );
  } catch (error) {
    if (sizeMode === 'none' || !['OverconstrainedError', 'NotFoundError'].includes(error.name)) throw error;
    const fallbackMode = profile.startsWith('portrait-') ? 'none' : 'ideal';
    return navigator.mediaDevices.getUserMedia(
      desktopMediaConstraints(videoDeviceId, audioDeviceId, desiredFps, fallbackMode),
    );
  }
}

async function recoverRelay(session) {
  relayInfo = null;
  const info = await getRelayInfo();
  session.origin = isUsbMode ? USB_ORIGIN : info.receiverOrigin;
  await registerPairingSession(session);
}

async function publishLiveKit(session, generation) {
  if (!window.LivekitClient) throw new Error('livekit_client_missing');
  if (liveKitRoom) await liveKitRoom.disconnect();
  const room = new window.LivekitClient.Room({
    adaptiveStream: true,
    dynacast: true,
    disconnectOnPageLeave: true,
  });
  liveKitRoom = room;
  room.on(window.LivekitClient.RoomEvent.Reconnecting, () => {
    if (generation === relayGeneration) relayStatus.textContent = 'Mạng gián đoạn • đang tự kết nối lại…';
    if (generation === relayGeneration) setPairingLiveState('Mạng gián đoạn · đang tự kết nối lại…');
  });
  room.on(window.LivekitClient.RoomEvent.Reconnected, () => {
    if (generation === relayGeneration) relayStatus.textContent = 'Đã nối lại • đang phát qua Internet';
    if (generation === relayGeneration) setPairingLiveState('Camera + mic đang phát tới điện thoại', true);
  });
  room.on(window.LivekitClient.RoomEvent.Disconnected, () => {
    if (generation === relayGeneration) stopCanvasPump();
    if (relayRunning && generation === relayGeneration) relayStatus.textContent = 'Đã mất kết nối remote.';
    if (relayRunning && generation === relayGeneration) setPairingLiveState('Đã mất kết nối remote · hãy thử lại');
  });
  await room.connect(session.origin, session.publisherToken);
  if (generation !== relayGeneration) {
    await room.disconnect();
    return;
  }
  startCanvasPump(generation);
  canvasCaptureStream = relayCanvas.captureStream(Number(outputFps.value) || 30);
  const videoTrack = canvasCaptureStream.getVideoTracks()[0];
  const audioTrack = activeStream?.getAudioTracks()[0];
  if (videoTrack) {
    await room.localParticipant.publishTrack(videoTrack, {
      source: window.LivekitClient.Track.Source.Camera,
      simulcast: true,
    });
  }
  if (audioTrack) {
    await room.localParticipant.publishTrack(audioTrack, {
      source: window.LivekitClient.Track.Source.Microphone,
    });
  }
  if (generation !== relayGeneration) return;
  relayStatus.textContent = `Đang phát qua Internet • phòng ${session.room}`;
  setPairingLiveState('Camera + mic đang phát tới điện thoại', true);
}

async function publishFrames(initialSession, generation) {
  if (generation !== relayGeneration) return;
  activeRelaySession = initialSession;
  relayRunning = true;
  publishedFrames = 0;
  if (initialSession.transport === 'livekit') {
    try {
      await publishLiveKit(initialSession, generation);
    } catch (_) {
      if (generation === relayGeneration) stopCanvasPump();
      if (generation === relayGeneration) relayStatus.textContent = 'Không kết nối được LiveKit • kiểm tra mạng và cấu hình.';
      if (generation === relayGeneration) setPairingLiveState('Không phát được lên LiveKit · hãy thử lại');
    }
    return;
  }
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
        apiUrl(`/api/rooms/${session.room}/frame?token=${encodeURIComponent(session.token)}`),
        { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob },
      );
      if (!response.ok) throw new Error(`publish_${response.status}`);
      publishedFrames += 1;
      consecutiveFailures = 0;
      relayStatus.textContent = `Đang phát thật qua ${isUsbMode ? 'USB' : 'LAN'} • ${publishedFrames} frame`;
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
    const retryDelay = consecutiveFailures ? 500 : Math.max(0, publishIntervalMs() - elapsed);
    if (retryDelay > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
    }
  }
}

async function startDesktopSource(showPairingAfter = false) {
  startRelay.disabled = true;
  startRelay.textContent = 'Đang mở nguồn…';
  try {
    const selectedVideoId = videoDevice.value;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('media_unsupported');
    }
    relayRunning = false;
    const generation = ++relayGeneration;
    stopCanvasPump();
    const selectedAudioId = audioDevice.value;
    const desiredFps = Number(outputFps.value);
    const nextStream = await openDesktopStream(selectedVideoId, selectedAudioId, desiredFps);
    if (generation !== relayGeneration) {
      nextStream.getTracks().forEach((track) => track.stop());
      return false;
    }
    try {
      if (liveKitRoom) await liveKitRoom.disconnect();
    } catch (error) {
      nextStream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    liveKitRoom = undefined;
    activeStream?.getTracks().forEach((track) => track.stop());
    activeStream = nextStream;
    await populateDevices(
      activeStream.getVideoTracks()[0]?.getSettings().deviceId || selectedVideoId,
      activeStream.getAudioTracks()[0]?.getSettings().deviceId || selectedAudioId,
    );
    videoPreview.srcObject = activeStream;
    videoPreview.hidden = false;
    document.querySelector('.preview-empty').hidden = true;
    await videoPreview.play();
    configureRelayCanvas(activeStream.getVideoTracks()[0]);
    if (/OBS Virtual Camera/i.test(activeStream.getVideoTracks()[0]?.label || '') &&
      outputResolution.value.startsWith('portrait-') && videoPreview.videoWidth >= videoPreview.videoHeight) {
      showSnackbar(`OBS Virtual Camera đang cấp ${videoPreview.videoWidth}×${videoPreview.videoHeight} ngang; Studio không thể lấy lại phần khung dọc đã bị camera ảo cắt.`);
    }
    let session;
    try {
      session = await ensurePairingSession(false);
    } catch (error) {
      const message = isUsbMode
        ? 'Preview đã mở; chưa nối được đường truyền USB. Kiểm tra cáp và dịch vụ USB trên máy tính rồi bấm lại.'
        : 'Preview đã mở; chưa tạo được phiên Internet. Kiểm tra khóa truy cập rồi bấm lại.';
      relayStatus.textContent = message;
      setPairingLiveState(message);
      startRelay.textContent = 'Thử kết nối lại';
      return true;
    }
    renderPairing(session);
    relayStatus.textContent = session.transport === 'livekit'
      ? 'Nguồn đã mở; đang kết nối Internet…'
      : 'Nguồn đã mở; đang gửi frame đầu tiên qua USB…';
    startRelay.textContent = 'Đổi / khởi động lại nguồn';
    void publishFrames(session, generation);
    if (showPairingAfter) setSheet(pairingSheet);
    return true;
  } catch (error) {
    activeStream?.getTracks().forEach((track) => track.stop());
    activeStream = undefined;
    videoPreview.srcObject = null;
    videoPreview.hidden = true;
    document.querySelector('.preview-empty').hidden = false;
    const errorMessage = error.name === 'NotAllowedError'
        ? 'Bạn chưa cấp quyền truy cập camera.'
        : 'Không mở được camera/OBS hoặc đường truyền.';
    relayStatus.textContent = errorMessage;
    previewResolution.textContent = 'Chưa có nguồn';
    startRelay.textContent = 'Thử lại';
    setPairingLiveState(errorMessage);
    return false;
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
  ensurePairingSession(false).then(renderPairing).catch(() => revokePairing('Phiên cũ không còn hoạt động'));
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      if (new URL(registration.scope).origin === location.origin) registration.unregister();
    });
  }).catch(() => {});
}
