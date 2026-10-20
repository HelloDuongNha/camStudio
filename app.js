const runtime = window.CamStudioRuntime;
const localStore = runtime.safeStorage(() => localStorage);
const sessionStore = runtime.safeStorage(() => sessionStorage);
const $ = (selector) => document.querySelector(selector);
const USB_ORIGIN = 'http://127.0.0.1:4173';
const USB_STORAGE = 'camstudio-usb-session-v2';
const videoPreview = $('#sourcePreview'), relayCanvas = $('#relayCanvas'), dialog = $('#pairingDialog');
const outputResolution = $('#outputResolution'), outputFps = $('#outputFps');
const videoDevice = $('#videoDevice'), audioDevice = $('#audioDevice');
let isUsbMode = runtime.selectedTransport(location.search, localStore.getItem('camstudio-transport-v1')) === 'usb';
let account, activeStream, liveKitRoom, canvasStream, session;
let previewTimer, statusTimer, qualityTimer, expiryTimer, snackbarTimer;
let generation = 0, opening = false, closing = false, publishTask, relayRunning = false;
let sourceFrameRate = 30, previewFrameCallback;
let previewOpening = false;
const actualFps = () => Math.min(Number(outputFps.value) || 30, sourceFrameRate || 30);

function showSnackbar(text) {
  clearTimeout(snackbarTimer); $('#snackbarText').textContent = text; $('#snackbar').hidden = false;
  snackbarTimer = setTimeout(() => { $('#snackbar').hidden = true; }, 4500);
}
async function request(url, init = {}, timeout = 12000) {
  const control = new AbortController(), timer = setTimeout(() => control.abort(), timeout);
  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init, signal: control.signal });
    if (response.status === 401 && url.startsWith('/api/')) {
      stopSource(); location.replace(`/login?transport=${isUsbMode ? 'usb' : 'cloud'}`);
      throw new Error('login_required');
    }
    return response;
  } finally { clearTimeout(timer); }
}
async function jsonRequest(url, method, data) {
  const response = await request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) {
    if (response.status === 409) throw new Error('room_busy');
    if (response.status === 429) throw new Error('too_many_attempts');
    throw new Error('server_unavailable');
  }
  return response.json();
}
function updateTransport() {
  $('#computerSource').classList.toggle('selected', !isUsbMode); $('#nearSource').classList.toggle('selected', isUsbMode);
  $('#computerSource').setAttribute('aria-pressed', String(!isUsbMode)); $('#nearSource').setAttribute('aria-pressed', String(isUsbMode));
  $('#audioField').hidden = isUsbMode;
  $('#transportHint').textContent = isUsbMode ? 'USB trực tiếp. Mở dịch vụ USB trên máy tính và cắm điện thoại.' : 'Cloud phát hình và tiếng qua LiveKit.';
  $('#passwordCard').hidden = isUsbMode;
  $('#pairButton').textContent = isUsbMode ? 'Kết nối USB' : 'Tạo mã ghép nối ↗';
  $('#connectHint').textContent = isUsbMode ? 'Cắm cáp và mở CamPOC. USB tự ghép nối, không cần QR hay mật khẩu.' : 'Xem trước nguồn rồi tạo mã Cloud. Đóng mã không tắt nguồn xem trước.';
  localStore.setItem('camstudio-transport-v1', isUsbMode ? 'usb' : 'cloud');
  const url = new URL(location.href); url.searchParams.set('transport', isUsbMode ? 'usb' : 'cloud'); history.replaceState(null, '', url);
}
function busy(value) {
  $('#previewButton').disabled = value;
  $('#pairButton').disabled = value; $('#newPairing').disabled = value; $('#restartSource').disabled = value;
  $('#computerSource').disabled = value; $('#nearSource').disabled = value;
  for (const selector of ['#copyCode', '#copyPassword', '#copyPairing']) $(selector).disabled = value;
  $('#qrCode').setAttribute('aria-busy', String(value));
}
function hasSource() { return activeStream?.getVideoTracks().some((track) => track.readyState === 'live'); }
function stopPublishing() {
  relayRunning = false;
  clearInterval(statusTimer); statusTimer = undefined;
  clearInterval(qualityTimer); qualityTimer = undefined;
  runtime.stopStream(canvasStream); canvasStream = undefined;
  const room = liveKitRoom; liveKitRoom = undefined;
  if (room) void room.disconnect(false).catch(() => {});
}
function stopSource() {
  generation++;
  stopPublishing();
  clearInterval(previewTimer); previewTimer = undefined;
  if (previewFrameCallback !== undefined) videoPreview.cancelVideoFrameCallback?.(previewFrameCallback);
  previewFrameCallback = undefined;
  $('#previewButton').hidden = false;
  runtime.stopStream(activeStream); activeStream = undefined;
  videoPreview.srcObject = null; relayCanvas.hidden = true;
  $('.preview-empty').hidden = false; $('#restartSource').hidden = true;
  $('#previewResolution').textContent = 'Chưa có nguồn'; $('#relayStatus').textContent = 'Chưa phát dữ liệu';
}
function drawRelayFrame() {
  if (!videoPreview.videoWidth || !videoPreview.videoHeight) return;
  const context = relayCanvas.getContext('2d', { alpha: false });
  const scale = Math.max(relayCanvas.width / videoPreview.videoWidth, relayCanvas.height / videoPreview.videoHeight) * 1.001;
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, relayCanvas.width, relayCanvas.height);
  context.drawImage(videoPreview, (relayCanvas.width - videoPreview.videoWidth * scale) / 2,
    (relayCanvas.height - videoPreview.videoHeight * scale) / 2, videoPreview.videoWidth * scale, videoPreview.videoHeight * scale);
}
function configureCanvas(track) {
  const settings = track.getSettings(), width = videoPreview.videoWidth || settings.width, height = videoPreview.videoHeight || settings.height;
  if (!width || !height) throw new Error('source_resolution_unavailable');
  sourceFrameRate = Number(settings.frameRate) || 30;
  if (outputResolution.value.startsWith('portrait-')) { relayCanvas.width = 1080; relayCanvas.height = 1920; }
  else {
    const scale = outputResolution.value === 'source' ? 1 : Math.min(1, 1080 / Math.min(width, height));
    relayCanvas.width = Math.max(2, Math.round(width * scale / 2) * 2); relayCanvas.height = Math.max(2, Math.round(height * scale / 2) * 2);
  }
  $('#previewStage').classList.toggle('landscape', relayCanvas.width >= relayCanvas.height);
  $('#previewStage').style.aspectRatio = `${relayCanvas.width} / ${relayCanvas.height}`;
  $('#previewResolution').textContent = `${width}×${height} → ${relayCanvas.width}×${relayCanvas.height}`;
  drawRelayFrame(); clearInterval(previewTimer);
  if (previewFrameCallback !== undefined) videoPreview.cancelVideoFrameCallback?.(previewFrameCallback);
  if (videoPreview.requestVideoFrameCallback) {
    let lastDraw = 0;
    const drawNext = (now) => {
      if (!hasSource()) return;
      if (now - lastDraw >= 1000 / actualFps() - 2) { drawRelayFrame(); lastDraw = now; }
      previewFrameCallback = videoPreview.requestVideoFrameCallback(drawNext);
    };
    previewFrameCallback = videoPreview.requestVideoFrameCallback(drawNext);
  } else previewTimer = setInterval(drawRelayFrame, 1000 / actualFps());
}
async function populateDevices(videoId = '', audioId = '') {
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDevice.replaceChildren(new Option('Tự động chọn camera', ''));
  audioDevice.replaceChildren(new Option('Tự động chọn micro', ''));
  devices.filter((device) => device.kind === 'videoinput').forEach((device, index) => videoDevice.add(new Option(device.label || `Camera ${index + 1}`, device.deviceId)));
  devices.filter((device) => device.kind === 'audioinput').forEach((device, index) => audioDevice.add(new Option(device.label || `Micro ${index + 1}`, device.deviceId)));
  videoDevice.value = videoId; audioDevice.value = audioId;
}
async function ensureSource(run) {
  if (hasSource()) return;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('media_unsupported');
  const videoId = videoDevice.value, audioId = audioDevice.value;
  const portrait = outputResolution.value.startsWith('portrait-');
  const constraints = (mode) => ({ video: {
    ...(mode === 'none' ? {} : { width: { [mode]: portrait ? 1080 : 1920 }, height: { [mode]: portrait ? 1920 : 1080 } }),
    ...(videoId ? { deviceId: { exact: videoId } } : {}), frameRate: { ideal: Number(outputFps.value) },
    resizeMode: portrait && mode === 'exact' ? { exact: 'none' } : { ideal: 'none' },
  }, audio: isUsbMode ? false : audioId ? { deviceId: { exact: audioId } } : true });
  let next;
  try { next = await navigator.mediaDevices.getUserMedia(constraints(outputResolution.value === 'source' ? 'none' : 'exact')); }
  catch (error) {
    if (outputResolution.value === 'source' || !['OverconstrainedError', 'NotFoundError'].includes(error.name)) throw error;
    next = await navigator.mediaDevices.getUserMedia(constraints(portrait ? 'none' : 'ideal'));
  }
  if (run !== generation) { runtime.stopStream(next); throw new Error('cancelled'); }
  activeStream = next;
  next.getTracks().forEach((track) => track.addEventListener?.('ended', () => {
    if (activeStream === next) { stopSource(); showSnackbar('Nguồn đã dừng. Tạo mã ghép nối để mở lại.'); }
  }));
  videoPreview.srcObject = next; await videoPreview.play();
  if (run !== generation) { runtime.stopStream(next); throw new Error('cancelled'); }
  configureCanvas(next.getVideoTracks()[0]); relayCanvas.hidden = false; $('.preview-empty').hidden = true;
  $('#restartSource').hidden = false; $('#previewButton').hidden = true;
  await populateDevices(next.getVideoTracks()[0]?.getSettings().deviceId || videoId, next.getAudioTracks()[0]?.getSettings().deviceId || audioId);
}
function invitation(value) {
  if (value.transport === 'livekit') return `camvirtual://connect?${new URLSearchParams({ code: value.code, password: value.password, origin: location.origin })}`;
  return `camvirtual://pair?${new URLSearchParams({ v: '1', room: value.room, token: value.token, expires: String(value.expires), origin: USB_ORIGIN })}`;
}
function renderPairing(value) {
  $('#pairingCode').textContent = value.code || value.room;
  $('#pairingPassword').textContent = value.password || '';
  $('#passwordCard').hidden = value.transport !== 'livekit';
  $('#pairingInstructions').textContent = value.transport === 'livekit'
    ? 'Quét QR bằng CamPOC, hoặc nhập mã phòng và mật khẩu trên điện thoại.'
    : 'Cắm điện thoại qua USB và chọn nguồn USB trong CamPOC. Có thể quét QR bằng chính điện thoại đang cắm cáp.';
  const qr = qrcode(0, 'M'); qr.addData(invitation(value), 'Byte'); qr.make();
  $('#qrCode').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
  $('#pairButton').textContent = value.transport === 'livekit' ? 'Mở mã ghép nối ↗' : 'USB đang chạy';
  $('#sessionBadge').textContent = value.connected ? 'Thiết bị đã kết nối' : `Phòng ${value.code || value.room}`;
  clearInterval(expiryTimer);
  const tick = () => {
    const remaining = Math.max(0, value.expires * 1000 - Date.now());
    $('#pairingExpiry').textContent = `${Math.floor(remaining / 60000)}:${String(Math.floor(remaining / 1000) % 60).padStart(2, '0')}`;
    if (!remaining) { clearInterval(expiryTimer); $('#pairingConnection').textContent = 'Mã đã hết hạn. Tạo mã mới để tiếp tục.'; }
  };
  tick(); expiryTimer = setInterval(tick, 1000);
}
function setConnection(connected) {
  if (!session) return;
  session.connected = connected || session.connected;
  $('#pairingConnection').textContent = session.connected ? '● Thiết bị đã kết nối' : '● Nguồn sẵn sàng · chờ điện thoại';
  $('#sessionBadge').textContent = session.connected ? 'Thiết bị đã kết nối' : `Phòng ${session.code || session.room}`;
}
async function pollStatus(value, run) {
  try {
    const url = value.transport === 'livekit' ? '/api/session?action=status' : `${USB_ORIGIN}/api/rooms/${value.room}/status?token=${encodeURIComponent(value.token)}`;
    const response = await request(url);
    if (!response.ok || run !== generation || session !== value) return;
    const data = await response.json();
    if (value.transport === 'livekit' && data.revision !== value.revision) return;
    setConnection(Boolean(data.connected));
  } catch { /* Transient presence failure cannot turn a connected room into an unused one. */ }
}
async function publishCloud(value, run) {
  const credentials = await jsonRequest('/api/session', 'POST', { action: 'publisher', revision: value.revision });
  if (run !== generation) return;
  const sdk = window.LivekitClient;
  const room = new sdk.Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true });
  liveKitRoom = room;
  room.on(sdk.RoomEvent.ParticipantConnected, () => { if (run === generation) void pollStatus(value, run); });
  room.on(sdk.RoomEvent.Reconnecting, () => { if (run === generation) $('#relayStatus').textContent = 'Mạng gián đoạn · đang kết nối lại…'; });
  room.on(sdk.RoomEvent.Reconnected, () => { if (run === generation) $('#relayStatus').textContent = 'Đang phát qua Cloud'; });
  room.on(sdk.RoomEvent.Disconnected, () => { if (run === generation) $('#relayStatus').textContent = 'Nguồn Cloud đã ngắt. Bấm khởi động lại nguồn để thử lại.'; });
  await room.connect(credentials.livekitUrl, credentials.token);
  if (run !== generation) { await room.disconnect(); return; }
  canvasStream = relayCanvas.captureStream(actualFps());
  const video = canvasStream.getVideoTracks()[0], audio = activeStream?.getAudioTracks()[0];
  if (video) {
    video.contentHint = 'motion';
    const publication = await room.localParticipant.publishTrack(video, {
      source: sdk.Track.Source.Camera, simulcast: false, videoCodec: 'h264',
      videoEncoding: { maxBitrate: Math.min(12000000, Math.max(2500000, Math.round(relayCanvas.width * relayCanvas.height * actualFps() * .10))), maxFramerate: actualFps() },
      degradationPreference: 'balanced',
    });
    const sender = publication?.track?.sender;
    if (sender?.getStats && run === generation) {
      let previous, reading = false;
      qualityTimer = setInterval(async () => {
        if (reading || run !== generation) return;
        reading = true;
        try {
          const stats = await sender.getStats();
          if (run !== generation) return;
          stats.forEach((report) => {
            if (report.type !== 'outbound-rtp' || report.kind !== 'video' || report.isRemote) return;
            const elapsed = previous ? (report.timestamp - previous.timestamp) / 1000 : 0;
            if (elapsed > 0 && report.framesEncoded >= previous.framesEncoded) {
              const fps = (report.framesEncoded - previous.framesEncoded) / elapsed;
              const mbps = (report.bytesSent - previous.bytesSent) * 8 / elapsed / 1000000;
              $('#relayStatus').textContent = `Cloud · ${report.frameWidth || relayCanvas.width}×${report.frameHeight || relayCanvas.height} · ${fps.toFixed(0)} fps · ${mbps.toFixed(1)} Mb/s`;
            }
            previous = report;
          });
        } catch { /* A missing stats sample must not interrupt video. */ }
        finally { reading = false; }
      }, 2000);
    }
  }
  if (audio && run === generation) await room.localParticipant.publishTrack(audio, { source: sdk.Track.Source.Microphone });
  if (run !== generation) { await room.disconnect(); return; }
  relayRunning = true; $('#relayStatus').textContent = 'Đang phát qua Cloud';
  setConnection(value.state === 'connected');
  void pollStatus(value, run); statusTimer = setInterval(() => { void pollStatus(value, run); }, 3000);
}
async function publishUsb(value, run) {
  relayRunning = true; let frames = 0, measuredAt = performance.now(), consecutiveFailures = 0;
  setConnection(false); statusTimer = setInterval(() => { void pollStatus(value, run); }, 3000);
  while (relayRunning && run === generation && hasSource()) {
    const started = performance.now();
    try {
      if (Date.now() >= value.expires * 1000) { $('#relayStatus').textContent = 'Phiên USB hết hạn. Tạo mã mới để tiếp tục.'; break; }
      const blob = await new Promise((resolve) => relayCanvas.toBlob(resolve, 'image/jpeg', .96));
      if (run !== generation || !blob) break;
      const response = await request(`${USB_ORIGIN}/api/rooms/${value.room}/frame?token=${encodeURIComponent(value.token)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      await runtime.discardResponse(response);
      if (response.status === 404 && run === generation) {
        // The local relay may have restarted; restore this tab's unexpired session.
        await jsonRequest(`${USB_ORIGIN}/api/sessions`, 'POST', { room: value.room, token: value.token, expires: value.expires });
        continue;
      }
      if (!response.ok) throw new Error('usb_publish_failed');
      consecutiveFailures = 0; frames++;
      if (performance.now() - measuredAt >= 1000) {
        $('#relayStatus').textContent = `Đang phát qua USB · ${(frames * 1000 / (performance.now() - measuredAt)).toFixed(1)} fps`;
        measuredAt = performance.now(); frames = 0;
      }
    } catch { consecutiveFailures++; $('#relayStatus').textContent = 'Chưa gửi được qua USB · đang thử lại…'; }
    await new Promise((resolve) => setTimeout(resolve, consecutiveFailures ? 500 : Math.max(0, 1000 / actualFps() - (performance.now() - started))));
  }
}
async function usbSession(replace) {
  const info = await request(`${USB_ORIGIN}/api/info`, {}, 30000);
  if (!info.ok || (await info.json()).transport !== 'lan-jpeg-v1') throw new Error('usb_unavailable');
  let previous;
  try { previous = JSON.parse(sessionStore.getItem(USB_STORAGE)); } catch {}
  if (previous?.expires * 1000 > Date.now() && !replace) return previous;
  if (previous) await request(`${USB_ORIGIN}/api/rooms/${previous.room}?token=${encodeURIComponent(previous.token)}`, { method: 'DELETE' });
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const expires = Math.floor(Date.now() / 1000) + 3600;
  for (let attempt = 0; attempt < 10; attempt++) {
    const room = Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => alphabet[n % alphabet.length]).join('');
    const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try {
      const registered = await jsonRequest(`${USB_ORIGIN}/api/sessions`, 'POST', { room, token, expires });
      const value = { room, code: registered.pairCode || room, token, expires, transport: 'usb' };
      sessionStore.setItem(USB_STORAGE, JSON.stringify(value)); return value;
    } catch (error) {
      if (error.message !== 'room_busy') throw error;
    }
  }
  throw new Error('room_busy');
}
async function cancelUnused(value) {
  if (!value) return { removed: false };
  if (value.transport === 'livekit') return jsonRequest('/api/session', 'DELETE', { mode: 'if-unconnected', revision: value.revision });
  const response = await jsonRequest(`${USB_ORIGIN}/api/rooms/${value.room}/close`, 'POST', { token: value.token });
  if (response.removed) sessionStore.removeItem(USB_STORAGE);
  return response;
}
function errorMessage(error) {
  return error.name === 'NotAllowedError' ? 'Hãy cấp quyền camera và micro để tạo mã ghép nối.'
    : error.message === 'room_busy' ? 'Phòng vừa thay đổi hoặc đang được xử lý. Hãy thử lại.'
    : error.message === 'too_many_attempts' ? 'Bạn thao tác hơi nhanh. Vui lòng chờ một phút.'
    : isUsbMode ? 'Chưa nối được USB. Kiểm tra dịch vụ USB và quyền truy cập mạng cục bộ.' : 'Chưa mở được nguồn hoặc phòng Cloud. Hãy thử lại.';
}
async function openPairing(replace = false, restart = false) {
  if (opening || closing || previewOpening || !account) return false;
  opening = true; busy(true);
  const run = ++generation;
  if (!isUsbMode && !dialog.open) dialog.showModal();
  $('#pairingConnection').textContent = 'Đang chuẩn bị nguồn…';
  let obtained;
  try {
    stopPublishing();
    if (restart) { clearInterval(previewTimer); runtime.stopStream(activeStream); activeStream = undefined; }
    await ensureSource(run);
    if (run !== generation) throw new Error('cancelled');
    obtained = isUsbMode ? await usbSession(replace) : await jsonRequest('/api/session', 'POST', { action: replace ? 'replace' : 'create', revision: session?.revision });
    if (obtained.transport === 'livekit' && obtained.ownerId !== account.id) throw new Error('login_required');
    if (run !== generation) { await cancelUnused(obtained); return false; }
    session = obtained;
    if (!isUsbMode) renderPairing(session);
    else { $('#pairButton').textContent = 'USB đang chạy'; $('#sessionBadge').textContent = 'USB · chờ điện thoại'; }
    if (isUsbMode) { publishTask = publishUsb(session, run); }
    else { publishTask = publishCloud(session, run); await publishTask; }
    return true;
  } catch (error) {
    if (error.message === 'login_required') location.replace('/login');
    if (error.message !== 'cancelled' && run === generation) { showSnackbar(errorMessage(error)); $('#pairingConnection').textContent = errorMessage(error); }
    if (run === generation) {
      stopPublishing();
      if (hasSource()) $('#relayStatus').textContent = 'Đang xem trước · chưa phát';
      if (obtained) { try { const outcome = await cancelUnused(obtained); if (!outcome.kept) session = undefined; } catch {} }
    }
    return false;
  } finally { opening = false; busy(false); }
}
async function closePairing() {
  if (closing) return;
  if (opening) generation++;
  closing = true; $('#closePairing').disabled = true;
  try {
    const value = session;
    const result = value ? await cancelUnused(value) : { removed: true };
    if (!result.kept) { stopPublishing(); session = undefined; clearInterval(expiryTimer); $('#pairButton').textContent = isUsbMode ? 'Kết nối USB' : 'Tạo mã ghép nối ↗'; $('#sessionBadge').textContent = 'Chưa kết nối'; if (hasSource()) $('#relayStatus').textContent = 'Đang xem trước · chưa phát'; }
    else setConnection(true);
    dialog.close();
  } catch { showSnackbar('Chưa xác nhận được trạng thái phòng. Hãy thử đóng lại.'); }
  finally { closing = false; $('#closePairing').disabled = false; }
}
async function startPreview(restart = false) {
  if (opening || closing || previewOpening || !account) return false;
  if (session && restart) return openPairing(false, true);
  previewOpening = true; busy(true);
  const run = ++generation;
  try {
    if (restart) { stopSource(); }
    await ensureSource(restart ? generation : run);
    $('#relayStatus').textContent = 'Đang xem trước · chưa phát';
    return true;
  } catch (error) { if (error.message !== 'cancelled') showSnackbar(errorMessage(error)); return false; }
  finally { previewOpening = false; busy(false); }
}
$('#previewButton').addEventListener('click', () => { void startPreview(); });
$('#pairButton').addEventListener('click', () => { void openPairing(); });
$('#newPairing').addEventListener('click', () => { void openPairing(true); });
$('#restartSource').addEventListener('click', () => { void startPreview(true); });
$('#closePairing').addEventListener('click', () => { void closePairing(); });
dialog.addEventListener('cancel', (event) => { event.preventDefault(); void closePairing(); });
dialog.addEventListener('click', (event) => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) void closePairing(); } });
for (const [selector, kind] of [['#copyCode', 'code'], ['#copyPassword', 'password'], ['#copyPairing', 'link']]) {
  $(selector).addEventListener('click', async () => {
    if (!session) return;
    try { await navigator.clipboard.writeText(kind === 'link' ? invitation(session) : session[kind] || session.room); showSnackbar('Đã sao chép'); }
    catch { showSnackbar('Chưa sao chép được. Bạn có thể quét QR.'); }
  });
}
for (const [selector, usb] of [['#computerSource', false], ['#nearSource', true]]) {
  $(selector).addEventListener('click', async () => {
    if (opening || closing || isUsbMode === usb) return;
    if (session) { try { await cancelUnused(session); } catch { showSnackbar('Chưa đổi được đường truyền. Hãy thử lại.'); return; } }
    stopSource(); session = undefined; clearInterval(expiryTimer); isUsbMode = usb; updateTransport();
    if (dialog.open) dialog.close();
    $('#pairButton').textContent = usb ? 'Kết nối USB' : 'Tạo mã ghép nối ↗'; $('#sessionBadge').textContent = 'Chưa kết nối';
    if (usb) await openPairing(); else await startPreview();
  });
}
for (const control of [outputResolution, outputFps, videoDevice, audioDevice]) control.addEventListener('change', () => { if (hasSource()) showSnackbar('Bấm Đổi / khởi động lại nguồn để áp dụng thay đổi.'); });
$('#logoutButton').addEventListener('click', async () => {
  if (opening || closing) return;
  $('#logoutButton').disabled = true;
  try {
    if (session) await cancelUnused(session);
    const response = await request('/api/auth?route=logout', { method: 'POST' });
    if (!response.ok) throw new Error();
    stopSource(); session = undefined; location.replace('/login');
  } catch { showSnackbar('Chưa đăng xuất được. Hãy thử lại.'); $('#logoutButton').disabled = false; }
});
$('#snackbarAction').addEventListener('click', () => { $('#snackbar').hidden = true; });
function setTheme(theme) { document.documentElement.dataset.theme = theme; localStore.setItem('camvirtual-theme', theme); }
setTheme(localStore.getItem('camvirtual-theme') || 'dark');
$('#themeToggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
updateTransport();
sessionStore.removeItem('camstudio-access-key'); localStore.removeItem('camvirtual-pairing-session-v1');
void (async () => {
  try {
    const response = await request('/api/auth?route=me'); if (!response.ok) throw new Error();
    account = (await response.json()).user;
    if (!account) { location.replace('/login'); return; }
    $('#accountEmail').textContent = account.email;
    busy(false);
    if (!isUsbMode) {
      const restored = await request('/api/session');
      if (restored.ok) { session = await restored.json(); renderPairing(session); }
    }
    if (isUsbMode) void openPairing();
    else if (navigator.permissions?.query) {
      // Reopen the preview automatically only when the user already granted camera access.
      try { if ((await navigator.permissions.query({ name: 'camera' })).state === 'granted') void startPreview(); } catch {}
    }
  } catch { busy(true); showSnackbar('Chưa kiểm tra được tài khoản. Vui lòng tải lại trang.'); }
})();
busy(true);
window.addEventListener('pagehide', () => {
  if (session && !session.connected && session.transport === 'livekit') {
    const body = JSON.stringify({ action: 'cancel', mode: 'if-unconnected', revision: session.revision });
    navigator.sendBeacon?.('/api/session', new Blob([body], { type: 'application/json' }));
  }
  stopSource(); clearInterval(expiryTimer); runtime.record('page-hidden');
});
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistrations().then((items) => items.forEach((item) => { if (new URL(item.scope).origin === location.origin) void item.unregister(); })).catch(() => {});
runtime.markReady();
