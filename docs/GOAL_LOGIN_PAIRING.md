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

## Kết quả kiểm chứng phát hành

Các chức năng đã triển khai và kiểm thử; ma trận yêu cầu/bằng chứng và giới hạn ở [RELEASE_VERIFICATION.md](RELEASE_VERIFICATION.md). OPPO đã được cài hai APK mới; Browser qua Cloud hoàn tất bài 30 giây với 29,36 callback/s, qua USB 14,90 callback/s. Không suy ra độ trễ đầu cuối hay tương thích mọi profile từ các lượt đo này.

## Điều chỉnh theo phản hồi thiết bị ngày 20/10

- Người dùng yêu cầu preview độc lập: tự mở nếu quyền camera đã granted, có nút Mở xem trước; hủy mã chưa kết nối chỉ dừng Cloud publish, giữ camera/microphone preview. Đã xác minh trạng thái `Đang xem trước · chưa phát` trên production sau hủy mã.
- USB không QR/modal: chọn transport hoặc vào URL USB tự mở nguồn/relay; đã xác minh production không có dialog, web đo 29,4 fps và CamPOC nhận 1080×1920 qua USB.
- Cloud: trước đổi cấu hình, log Browser có YUV mapping nguồn 180×320 (lớp thấp) lên output 640×480. Bản mới dùng H.264 một encoding, bitrate theo pixel/FPS, balanced, frame callbacks cho canvas. CamPOC thật lên 1080×1920 sau ramp-up; outbound stats tại một mẫu 26 fps/2,0 Mb/s. Chưa đo độ trễ đầu cuối hoặc so sánh frame động trước/sau, không tuyên bố hết lag.
- APK controller và Browser đã cài cập nhật thành công lên OPPO CPH2025. Deeplink payload cùng lời mời QR đã nhận thành công; chưa tính là kiểm thử camera scanner QR. Đóng modal sau điện thoại kết nối giữ stream được xác minh.
- Browser nhận track LiveKit và Camera2 hook dùng network room mới, nhưng bài camera-check gặp timeout 15s ở một lần mở. Còn phải tái hiện và kiểm chứng output Browser với cấu hình mới.
- 51 bài Node đạt sau thay đổi preview/USB/encoder. Các hướng dẫn cũ nói đóng modal dừng preview được thay thế bởi yêu cầu mới ở mục này.

- Kiểm tra tiếp theo: relay cũ thiếu API mới đã được khởi động lại; chuyển USB sang Cloud thành công. Frontend tự đăng ký lại phiên sau relay restart, 52 tests đạt. Browser Cloud hoàn tất 881 callback/30s với nguồn 1080×1920; USB 447 callback/30s.
