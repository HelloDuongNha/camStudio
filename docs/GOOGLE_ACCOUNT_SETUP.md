# Đưa đăng nhập Google lên Cam Studio

## Trạng thái bản sửa

- Mọi tài khoản Google có email đã xác minh đều có thể đăng nhập, không giới hạn Gmail.
- Mỗi tài khoản có một phòng Cloud và QR riêng. QR còn hạn được mở lại từ PostgreSQL khi đăng nhập trên máy khác.
- Phiên đăng nhập có hạn 30 ngày; QR Cloud có hạn một giờ. Không kéo dài QR bằng việc mở lại trang.
- Studio không hỏi khóa truy cập. Không lưu mật khẩu Google, token Google, ảnh QR hoặc video trong database.
- USB vẫn dùng relay trên máy tính và không cần đăng nhập Google.

## Cần tạo một lần cho chủ website

### 1. PostgreSQL

Tạo database PostgreSQL riêng tại nhà cung cấp của bạn. Trên Render, dùng kết nối nội bộ nếu database cùng môi trường với Web Service. Đặt connection string vào biến `DATABASE_URL` của Web Service. Với kết nối bên ngoài, giữ TLS và xác minh chứng chỉ theo hướng dẫn nhà cung cấp.

Server sẽ tạo bảng trong `db/schema.sql` khi truy cập database lần đầu; user database cần quyền tạo bảng và index. Không lưu database vào filesystem tạm của Web Service. Kiểm tra chính sách lưu trữ, sao lưu và giới hạn của database trước khi dùng lâu dài.

### 2. Google OAuth

1. Mở Google Cloud Console, tạo/chọn một project cho Cam Studio.
2. Vào Google Auth Platform, cấu hình Branding: tên ứng dụng, email hỗ trợ và thông tin website theo yêu cầu Google hiển thị.
3. Chọn Audience **External** vì website phục vụ nhiều người dùng. Trong giai đoạn thử, thêm Test users để kiểm thử. Khi phát hành, chuyển sang Production và hoàn tất yêu cầu Google nếu có.
4. Tạo OAuth client loại **Web application**.
5. Authorized redirect URI phải khớp chính xác:

   `https://campoc.onrender.com/api/auth?route=callback`

6. Đặt Client ID vào `GOOGLE_CLIENT_ID` và Client Secret vào `GOOGLE_CLIENT_SECRET` trên Render. Đặt `APP_ORIGIN=https://campoc.onrender.com`.

Client ID/secret là cấu hình cho chủ web, không phải khóa mà người dùng cuối phải nhập. Ứng dụng chỉ yêu cầu `openid`, `email`, `profile`, không xin quyền Drive/Gmail.

## Trước khi triển khai

Web Service cần các biến sau:

| Biến | Chức năng |
| --- | --- |
| `APP_ORIGIN` | Origin Studio, không có path/query |
| `DATABASE_URL` | Kết nối PostgreSQL |
| `GOOGLE_CLIENT_ID` | OAuth Web client |
| `GOOGLE_CLIENT_SECRET` | OAuth Web client secret |
| `LIVEKIT_URL` | Giữ cấu hình LiveKit hiện tại |
| `LIVEKIT_API_KEY` | Giữ cấu hình LiveKit hiện tại |
| `LIVEKIT_API_SECRET` | Giữ cấu hình LiveKit hiện tại |

`CAMSTUDIO_ACCESS_KEY` không còn được dùng. Hoàn tất cấu hình trước khi deploy vì bản mới yêu cầu đăng nhập Google cho Cloud.

## Kiểm tra sau triển khai

1. Chọn nút G rồi Tiếp tục với Google. Tài khoản mới tự được tạo sau khi Google xác thực thành công.
2. Tạo QR Cloud, quét bằng CamPOC và kiểm tra phát hình.
3. Đăng nhập cùng tài khoản trên trình duyệt khác: mở lại cùng phòng còn hạn, không tự gia hạn QR.
4. Đăng nhập tài khoản Google khác: không thấy phòng của tài khoản trước.
5. Đăng xuất: trình duyệt đó không còn tạo/xem QR Cloud. USB tiếp tục không cần đăng nhập.

Tạo mới/đóng phòng ngắt phòng cũ qua LiveKit và thay/xóa bản ghi liên kết. JWT đã phát có thể còn hiệu lực đến hạn; đây không phải cơ chế thu hồi JWT tức thời.

## Kiểm chứng trong bản sửa

Đã chạy test bằng PostgreSQL nhúng PGlite cho schema, quyền sở hữu phòng, hash/expiry phiên đăng nhập, state/nonce/PKCE OAuth, đăng xuất và hết hạn QR. Google token exchange/signature verification được giả lập tại ranh giới thư viện trong test; chưa phải lần đăng nhập Google thật. Chưa kiểm chứng Render Postgres hoặc LiveKit Cloud sau triển khai khi chưa có cấu hình ngoài.

Tài liệu gốc: https://developers.google.com/identity/openid-connect/openid-connect
