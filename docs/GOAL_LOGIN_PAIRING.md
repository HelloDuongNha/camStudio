# Goal: tài khoản, MongoDB và ghép nối gọn cho Cam Studio

## Yêu cầu đã chốt

- Login/signup Google trước Studio, logout bên trong; mọi tài khoản Google được đăng ký.
- MongoDB Atlas, phòng theo chủ sở hữu; mã riêng/password tự tạo, chống trùng/giành phòng/lộ JWT trong QR.
- Tạo mã tự mở và phát camera/microphone; không có nút phát thứ hai.
- Đóng modal hủy phiên chưa có thiết bị kết nối; đã kết nối thì giữ. Tạo mới loại bỏ mã cũ.
- Link chỉ hiển thị gọn, sao chép đúng chỗ; nút tạo mới nổi bật.
- Bỏ nguồn thư viện điện thoại rỗng, crop/rotate/zoom/reset, quyền camera/mic demo, component/design-system demo trên web.
- Redis cho rate limits/presence, MongoDB giữ quyền và trạng thái thật. Giữ camera hook/nguồn local Android hiện có.

## Hoàn thành ở mã và kiểm thử cục bộ

- Trang login/signup và server gate, logout; không hỏi access key.
- MongoDB driver/collections/indexes thay PostgreSQL, unique codes và khóa thao tác theo tài khoản.
- Password hash/encryption, credential receiver có thể thu hồi, JWT media ngắn hạn, mã media riêng.
- Vòng đời modal/create/replace/cancel, khóa request trùng và loại kết quả trả muộn.
- Giao diện đã dọn; có ảnh UI QA dùng video/tài khoản giả lập.
- Redis đã kiểm thử bằng redis-server thật cục bộ; fallback MongoDB khi Redis ngắt.
- Android nhận QR v3/mã/password và đổi lease qua HTTPS trước khi nối LiveKit. Build cả hai flavor, harness, unit tests và lint đều đạt sau chỉnh sửa cuối.
- Browser APK đã nhúng module mới, xác minh hash trùng module standalone; giữ nguyên origin APK và chứng thư LSPatch 487. Artifact nằm trong `VirtualCamPoC/app/build/outputs/camstudio-account-pairing/`.
- Kiểm thử cuối: 47/47 bài Node, 7/7 bài USB HTTP; kiểm tra cú pháp và `git diff --check` đạt.
- Google OAuth Web client đã được người dùng tạo; JSON đã kiểm tra callback và nạp `.env` bị Git ignore.
- Atlas: đã tạo project CamStudio và cluster Free ở Singapore. Đã quan sát database user do người dùng tạo, quyền `readWrite` trên database `camstudio`; chưa có URI trong `.env`.
- Google Audience đã kiểm tra: External nhưng Testing; Publish bị khóa do Branding chưa đầy đủ. Đã chuẩn bị trang `/privacy` và link từ login trong mã, chưa triển khai.
- Render CamPOC ở Singapore, Free; outbound IP hiện hiển thị `74.220.52.0/24`, `74.220.60.0/24`. Đã chuẩn bị form Atlas IP đầu tiên, chờ xác nhận mở quyền mạng; chưa thay đổi allowlist hoặc Render secrets.
- Trang quyền riêng tư đã xem và kiểm tra bố cục trong trình duyệt cục bộ; chưa công bố online.

## Còn phải hoàn tất để đóng goal

- Atlas URI và network allowlist, kiểm chứng kết nối thật.
- Google Audience/Branding phù hợp public signup.
- Render Environment, Redis triển khai nếu đủ cấu hình, cập nhật web và hash kiểm chứng.
- Google login/room/QR thật sau deploy. ADB hiện không có thiết bị, không được ghi nhận đã test/cài trên điện thoại.

Goal vẫn active cho đến khi công việc còn lại hoàn thành hoặc có blocker cần người dùng xử lý. Không tính test OAuth/media giả lập là đăng nhập Google hoặc kết nối điện thoại thật.
