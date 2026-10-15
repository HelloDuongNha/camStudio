import { cameraConstraints, safeSettings, summarize } from './camera-metrics.js';

// Camera acquisition and observation only. Does not wrap browser APIs or process pixels.
export class CameraCheck {
  constructor({ video, acquire, update, now = () => performance.now(), timers = globalThis }) {
    Object.assign(this, { video, acquire, update, now, timers });
    this.generation = 0;
    this.busy = false;
    this.active = false;
    this.samples = [];
  }

  cleanup() {
    this.timers.clearTimeout(this.startupTimer);
    this.timers.clearTimeout(this.deadline);
    if (this.callbackId !== undefined) this.video.cancelVideoFrameCallback?.(this.callbackId);
    this.callbackId = undefined;
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener?.('ended', this.onEnded);
        track.stop();
      }
    }
    this.stream = undefined;
    this.video.srcObject = null;
    this.active = false;
    this.busy = false;
  }

  failure(id, error) {
    if (id !== this.generation) return;
    this.generation++;
    this.cleanup();
    this.update({ phase: 'error', error: error.name, message: error.message });
  }

  async start(profile) {
    if (this.busy) return;
    const id = ++this.generation;
    this.busy = true;
    this.samples = [];
    this.profile = profile;
    try {
      this.requested = cameraConstraints(profile);
      if (!this.video.requestVideoFrameCallback) throw new Error('Trình duyệt không hỗ trợ đo callback video.');
      this.update({ phase: 'acquiring', requested: this.requested });
      this.startupTimer = this.timers.setTimeout(() => {
        const error = new Error('Chưa mở được camera sau 15 giây. Kiểm tra quyền camera và thử lại.');
        error.name = 'TimeoutError';
        this.failure(id, error);
      }, 15000);
      const stream = await this.acquire({ video: this.requested, audio: false });
      if (id !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.settings = safeSettings(stream.getVideoTracks()[0].getSettings());
      this.onEnded = () => this.stop('track-ended');
      stream.getTracks().forEach((track) => track.addEventListener?.('ended', this.onEnded));
      this.video.srcObject = stream;
      await this.video.play();
      if (id !== this.generation) return;
      this.timers.clearTimeout(this.startupTimer);
      this.active = true;
      this.startedAt = this.now();
      this.update({ phase: 'running', requested: this.requested, settings: this.settings, callbacks: 0 });
      const observe = (now, metadata) => {
        if (id !== this.generation || !this.active) return;
        this.callbackId = undefined;
        const sample = { now, mediaTime: metadata.mediaTime, presented: metadata.presentedFrames, width: metadata.width, height: metadata.height };
        this.samples.push(sample);
        if (this.samples.length === 1 || this.samples.length % 15 === 0) {
          const elapsed = Math.max(1, this.now() - this.startedAt);
          this.update({ phase: 'running', settings: this.settings, requested: this.requested, callbacks: this.samples.length, width: sample.width, height: sample.height, fps: this.samples.length * 1000 / elapsed });
        }
        this.callbackId = this.video.requestVideoFrameCallback(observe);
      };
      this.callbackId = this.video.requestVideoFrameCallback(observe);
      this.deadline = this.timers.setTimeout(() => this.stop('completed-30-seconds'), 30000);
    } catch (error) {
      this.failure(id, error);
    }
  }

  stop(reason = 'user-stopped') {
    if (!this.busy) return;
    const result = this.active ? summarize({ samples: this.samples, startedAt: this.startedAt, endedAt: this.now(), profile: this.profile, requested: this.requested, settings: this.settings, reason }) : null;
    this.generation++;
    this.cleanup();
    this.update(result ? { phase: 'result', result } : { phase: 'idle' });
  }
}

if (typeof document !== 'undefined') {
  const find = (id) => document.getElementById(id);
  const start = find('start'), stop = find('stop'), profile = find('profile');
  let latestResult;
  const dimensions = (value) => value?.width && value?.height ? `${value.width}×${value.height}` : 'Không được khai báo';
  const check = new CameraCheck({
    video: find('video'),
    acquire: (constraints) => {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Cần mở trang qua HTTPS hoặc localhost để truy cập camera.');
      return navigator.mediaDevices.getUserMedia(constraints);
    },
    update(state) {
      const busy = state.phase === 'acquiring' || state.phase === 'running';
      start.disabled = profile.disabled = busy;
      stop.disabled = !busy;
      find('preview').hidden = state.phase !== 'running';
      if (state.phase === 'acquiring') {
        latestResult = undefined;
        find('resultPanel').hidden = true;
        find('exportStatus').textContent = '';
        find('received').textContent = 'Chưa có callback';
        find('settings').textContent = 'Đang mở camera';
        find('rate').textContent = 'Chưa đo';
        find('status').textContent = 'Đang xin quyền / mở camera… Có thể bấm Dừng để hủy.';
      }
      if (state.requested) find('requested').textContent = state.requested.width ? `${state.requested.width.exact}×${state.requested.height.exact} • 30 FPS mong muốn` : 'Tự động • không yêu cầu width/height/FPS';
      if (state.settings) find('settings').textContent = `${dimensions(state.settings)} • ${state.settings.frameRate ?? '?'} FPS được khai báo`;
      if (state.phase === 'running') {
        find('status').textContent = 'Đang đo • tự dừng sau 30 giây.';
        if (state.width) find('received').textContent = `${state.width}×${state.height} • ${(state.width / state.height).toFixed(3)} width/height`;
        if (state.fps) find('rate').textContent = `${state.fps.toFixed(2)} callback/giây • ${state.callbacks} callback`;
      }
      if (state.phase === 'idle') {
        find('status').textContent = 'Đã hủy. Camera đã đóng.';
        find('settings').textContent = 'Đã hủy mở camera';
      }
      if (state.phase === 'error') {
        find('status').textContent = `${state.error}: ${state.message} Yêu cầu không được tự đổi sang cấu hình khác.`;
        find('settings').textContent = 'Không mở được camera';
      }
      if (state.phase === 'result') {
        latestResult = state.result;
        find('status').textContent = 'Đã kết thúc. Camera đã đóng.';
        find('received').textContent = state.result.callbackDimensions.join(', ') || 'Không có callback';
        find('rate').textContent = `${(state.result.wallWindowCallbackFps ?? 0).toFixed(2)} callback/giây • ${state.result.callbacks} callback / ${(state.result.wallElapsedMs / 1000).toFixed(2)} giây`;
        find('result').textContent = JSON.stringify(state.result, null, 2);
        find('resultPanel').hidden = false;
      }
    },
  });
  start.onclick = () => check.start(profile.value);
  stop.onclick = () => check.stop();
  addEventListener('pagehide', () => check.stop('page-hidden'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) check.stop('page-hidden'); });
  find('download').onclick = () => {
    if (!latestResult) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(latestResult, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `camera-check-${latestResult.profile}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  find('copy').onclick = async () => {
    if (!latestResult) return;
    const text = JSON.stringify(latestResult, null, 2);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      find('exportStatus').textContent = 'Đã sao chép JSON thông số.';
    } catch {
      const field = document.createElement('textarea');
      field.value = text;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      find('exportStatus').textContent = copied ? 'Đã sao chép JSON thông số.' : 'Không sao chép được. Bạn có thể chọn phần JSON bên dưới để sao chép thủ công.';
    }
  };
}
