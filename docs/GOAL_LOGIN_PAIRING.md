# Goal: tài khoản, MongoDB và ghép nối gọn cho Cam Studio

## Yêu cầu

Google login/signup trước Studio, logout; mọi tài khoản Google được đăng ký. MongoDB Atlas quản lý tài khoản/phòng theo chủ sở hữu, mã duy nhất và mật khẩu tự tạo; thay mã loại bỏ phòng cũ. Tạo mã tự mở nguồn, đóng modal hủy phòng chưa kết nối và giữ phòng đã kết nối. Giao diện gọn theo yêu cầu; giữ camera hook Android hiện có. Redis chỉ dùng cho rate limits/presence khi có cấu hình.

## Đã triển khai và xác minh ngày 20/10/2026

- Web production: https://campoc.onrender.com. Các assets app.js/styles.css/login.html/login.js/privacy.html đã so sánh byte với nguồn sau deploy.
- Google OAuth Web client riêng; Audience External/In production, Branding có trang chủ và quyền riêng tư. Không dùng email allowlist.
- Atlas CamStudio Free, Singapore; database user readWrite trên camstudio. IP Access List gồm hai dải outbound Render đã được người dùng cho phép: 74.220.52.0/24, 74.220.60.0/24.
- Render đã lưu Google OAuth, MongoDB URI, ROOM_SECRET_KEY, APP_ORIGIN, TRUST_PROXY_HOPS. URI đã sửa dấu bao mẫu và so sánh khớp .env mà không in bí mật. OAuth state và tài khoản đã ghi/đọc thành công qua Atlas từ Render.
- Render build command `npm ci --omit=dev`, start `npm start`, health `/healthz`.
- Chrome production: đăng nhập Google thật thành công, Studio hiển thị tài khoản và logout; tạo mã tự khởi động camera/microphone và nguồn sẵn sàng; tạo mới đổi code; đóng khi chưa có điện thoại dừng source và hủy phòng; logout về login, mở trực tiếp Studio bị buộc login.
- Kiểm thử tự động 47 bài Node, 7 bài USB HTTP: phân quyền tài khoản, mã/password, lease, thay mã/hủy phòng, giữ phòng đã kết nối, CSRF, OAuth PKCE/state/nonce, Redis outage fallback và race UI.
- Redis integration đã có và kiểm thử redis-server thật cục bộ; production chưa đặt REDIS_URL, đang dùng MongoDB fallback. Không tuyên bố Redis đã chạy cloud hoặc đã tăng FPS.
- Android QR v3/code/password và lease HTTPS; build hai flavor/harness, unit tests/lint đạt. Browser APK nhúng module mới, hash khớp standalone, giữ origin và signer LSPatch 487.
- APK và verification.json: `VirtualCamPoC/app/build/outputs/camstudio-account-pairing/`.
- UI đã bỏ nguồn thư viện rỗng, crop/rotate/zoom/reset, permissions/component demos, nút start thứ hai/revoke; mã/password thật, QR/link gọn, nút đổi mã nổi bật.

## Còn cần xác minh

- ADB hiện không có thiết bị: chưa cài APK mới, chưa quét QR/thử code/password trên điện thoại thật, chưa đo/phán đoán chất lượng camera hoặc FPS.
- Giữ stream khi đóng modal sau kết nối thật và nhận stream sau đổi mã: đã có test tự động nhưng chưa có bằng chứng điện thoại thật.
- Phân quyền nhiều tài khoản có Mongo integration test; production mới kiểm thử một tài khoản Google.

Goal chưa hoàn tất cho đến khi kiểm thử thiết bị liên quan xong. Không tính OAuth/media giả lập là kết nối thực.
