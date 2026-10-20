(() => {
  const loginTab = document.querySelector('#loginTab'), signupTab = document.querySelector('#signupTab');
  const action = document.querySelector('#googleSignIn'), message = document.querySelector('#authMessage');
  const params = new URLSearchParams(location.search);
  const transport = params.get('transport') === 'usb' ? 'usb' : 'cloud';
  let enabled = false;
  function select(signup) {
    loginTab.classList.toggle('selected', !signup); signupTab.classList.toggle('selected', signup);
    loginTab.setAttribute('aria-pressed', String(!signup)); signupTab.setAttribute('aria-pressed', String(signup));
    document.querySelector('#authTitle').textContent = signup ? 'Tạo không gian của bạn' : 'Đăng nhập để tiếp tục';
    document.querySelector('#authDescription').textContent = signup ? 'Tạo tài khoản bằng Google và bắt đầu ghép nối thiết bị.' : 'Chọn tài khoản Google để mở không gian Studio của bạn.';
    document.querySelector('#googleActionText').textContent = signup ? 'Đăng ký với Google' : 'Tiếp tục với Google';
    const url = new URL(location.href); url.searchParams.set('mode', signup ? 'signup' : 'login'); history.replaceState(null, '', url);
  }
  loginTab.addEventListener('click', () => select(false)); signupTab.addEventListener('click', () => select(true));
  action.addEventListener('click', (event) => { if (!enabled) event.preventDefault(); });
  action.href = `/api/auth?route=login&transport=${transport}`;
  select(params.get('mode') === 'signup' || location.pathname === '/signup');
  void (async () => {
    try {
      const response = await fetch('/api/auth?route=me', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error();
      const account = await response.json();
      if (account.user) { location.replace(`/?transport=${transport}`); return; }
      enabled = account.configured;
      action.setAttribute('aria-disabled', String(!enabled));
      message.textContent = !enabled ? 'Đăng nhập đang được thiết lập. Vui lòng quay lại sau.' : params.has('error') ? 'Chưa đăng nhập được. Bạn có thể chọn Google để thử lại.' : 'Sẵn sàng đăng nhập bằng tài khoản Google của bạn.';
    } catch { message.textContent = 'Chưa kết nối được máy chủ. Vui lòng tải lại trang.'; }
  })();
})();
