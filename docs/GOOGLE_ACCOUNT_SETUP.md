# Thiết lập Google, MongoDB Atlas và Render

1. Tạo/chọn Google Cloud project, tạo OAuth client **Web application** riêng cho Cam Studio. Callback: `https://campoc.onrender.com/api/auth?route=callback`; JavaScript origin: `https://campoc.onrender.com`.
2. Audience External, chỉ xin openid/email/profile. Kiểm tra Branding và các yêu cầu Google hiển thị; chuyển Production khi phát hành cho mọi tài khoản Google.
3. Lưu JSON OAuth ở máy chủ/`.env`, không commit. Người dùng cuối không nhập Client ID, Client Secret hoặc access key.
4. Tạo project/cluster MongoDB Atlas riêng. User database dùng role `readWrite` trên `camstudio`, không cần `atlasAdmin`. Cho phép kết nối từ máy quản trị/Render bằng IP access list phù hợp.
5. Đặt `MONGODB_URI`, `MONGODB_DATABASE=camstudio`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ORIGIN` trong Render Environment. Giữ cấu hình LiveKit hiện có.
6. Sinh `ROOM_SECRET_KEY` bằng 32 byte ngẫu nhiên, lưu 64 ký tự hex. Giữ ổn định; đổi khóa làm lời mời cũ không khôi phục được mật khẩu và cần tạo phòng mới. Sao lưu khóa riêng với database.
7. Redis tùy chọn: đặt `REDIS_URL` nếu có. Không cần Redis để bảo toàn dữ liệu/phân quyền; MongoDB vẫn là nguồn quyết định. Không dùng Redis public không được bảo vệ.
8. Render: build `npm ci`, start `npm start`, health `/healthz`. Cấu hình xong trước khi triển khai để không gián đoạn đăng nhập.
9. Kiểm tra bằng hai tài khoản Google: tạo tài khoản mới, vào Studio, logout, mở link trực tiếp khi chưa login, QR theo chủ sở hữu, thay mã và đóng modal trước/sau kết nối.
10. Cài APK CamPOC và Browser LSPatch có module mới. Kiểm tra quét QR mới hoặc nhập code/password, nguồn tự phát, đổi mã ngắt phòng cũ.

MongoDB tự tạo các collections `users`, `logins`, `oauth_states`, `pairings`, `owner_locks`, `rate_limits` và indexes. Hash phiên đăng nhập, password hash và mật khẩu đã mã hóa không được gửi ra API công khai. Database không lưu video, token Google hoặc JWT media.

Tài liệu chính thức: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [MongoDB TTL](https://www.mongodb.com/docs/manual/core/index-ttl/).
