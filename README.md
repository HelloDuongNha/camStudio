# camStudio

Studio phát camera/microphone từ trình duyệt máy tính sang VirtualCamPoC trên Android. Khi chạy trên Render/Vercel, Studio dùng LiveKit Cloud để hoạt động qua Internet; khi chạy relay Python trên máy tính, Studio dùng LAN/USB tethering để giảm độ trễ.

## Chạy cục bộ

Để dùng LiveKit giống production, cấu hình `.env` trong shell rồi chạy `npm start`. Để dùng relay LAN/USB cục bộ, chạy:

```bash
npm run lan
```

Giao diện Studio dùng `https://campoc.onrender.com/`. Khi dùng USB, mở
`https://campoc.onrender.com/?transport=usb`. Dịch vụ `127.0.0.1:4173` là
relay API trên máy tính; đường dẫn `/` và `/index.html` của relay chuyển
hướng sang giao diện Render, không duy trì thêm một bản Studio cục bộ.

## Deploy Render

Phải tạo **Web Service**, không dùng Static Site vì `/api/session` cần chạy phía server.

- Runtime: `Node`
- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/healthz`

Khai báo bốn biến môi trường `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` và `CAMSTUDIO_ACCESS_KEY`, sau đó deploy commit mới nhất. Repo có sẵn `render.yaml` nếu tạo dịch vụ bằng Blueprint.

## Deploy Vercel

Khai báo bốn biến môi trường cho Production, Preview và Development rồi redeploy:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `CAMSTUDIO_ACCESS_KEY` — chuỗi bí mật tự chọn, dài ít nhất 24 ký tự

Ba giá trị LiveKit chỉ tồn tại ở Vercel Function và không được gửi xuống trình duyệt. Khi bấm **Tạo mã ghép nối** lần đầu trên Studio, nhập `CAMSTUDIO_ACCESS_KEY`; trình duyệt chỉ giữ khóa trong tab hiện tại. QR chứa token nhận có hạn một giờ, không chứa API secret.

## Luồng sử dụng

1. Mở Studio trên máy tính. Chọn camera/OBS Virtual Camera và microphone muốn phát.
2. Với USB, chạy `./start_usb_mode.sh`, chọn **Kết nối gần** rồi bật camera/OBS. Studio tạo phiên cục bộ và VirtualCamPoC tự nhận qua `adb reverse`; không cần quét QR.
3. Với LAN/Cloud, bấm **Tạo mã ghép nối**, sau đó quét QR hoặc nhập mã trong VirtualCamPoC.
4. Chọn nguồn đã ghép làm nguồn đang chạy, rồi mở Cam Browser/WebTest.

### Nguồn OBS dọc

Studio lấy trực tiếp khung do **OBS Virtual Camera** cấp. Chọn **Ưu tiên dọc 1080×1920** để yêu cầu khung dọc và kiểm tra dòng kích thước thực tế trên preview. Trên bản OBS macOS hiện tại, camera extension có thể chỉ công bố **1920×1080** ngay cả khi canvas OBS là **1080×1920**. Khi đó Studio không thể khôi phục phần trên/dưới đã bị cắt trong camera ảo; phải sửa hoặc thay camera extension xuất dọc thật sự. Đổi tùy chọn chất lượng khi đang phát cần bấm **Đổi / khởi động lại nguồn**.

### Tự động kết nối USB trên macOS

Chạy `./install_usb_autostart.sh` một lần. LaunchAgent sẽ tự mở relay cục bộ
và khôi phục `adb reverse` sau mỗi lần đăng nhập, khởi động lại điện thoại hoặc
rút/cắm lại cáp. Relay USB chỉ lắng nghe trên `127.0.0.1`.

Giao diện Render dùng LiveKit khi chọn Camera / OBS qua Cloud và dùng relay
cục bộ khi chọn Kết nối gần qua USB. Địa chỉ giao diện luôn là Render;
`127.0.0.1:4173` chỉ là dịch vụ truyền qua cáp trên máy tính.

Studio nhớ lựa chọn USB/Cloud qua tải lại trang; `?transport=usb` chọn USB
rõ ràng. Không tự xin quyền camera hoặc bật nguồn khi chỉ mở trang.

### Chẩn đoán giao diện Studio

Nếu script tải/chạy thất bại, Studio hiện thông báo khôi phục với nút tải
lại và sao chép mốc lỗi. Mốc lỗi chỉ nằm trong tab, giới hạn 20 bản ghi;
chỉ chứa thời gian, loại lỗi, tên file mã đã cho phép và số dòng. Không
chứa ảnh, URL phiên, token, khóa truy cập hoặc nội dung request/response.
Nó không thể cứu tiến trình Chrome đã crash; crash native phải đối chiếu
crash report của macOS/Chrome riêng.

## Kiểm tra nhanh bằng UI

### Kiểm tra camera độc lập

- Mở `/camera-check.html` trên thiết bị cần đo, qua HTTPS hoặc localhost.
  Trang phân biệt yêu cầu của trang, settings của track, kích thước callback
  video và callback/giây. Ba chế độ là tự động, exact 1920×1080 và exact
  1080×1920; chế độ không được hỗ trợ sẽ báo lỗi thay vì tự fallback.
- Mỗi lượt tối đa 30 giây. Dừng hoặc rời trang sẽ đóng track, kể cả khi
  người dùng đang chờ hộp thoại quyền camera. Không lưu ảnh/âm thanh và
  không gửi dữ liệu đo tới server; JSON chỉ tải khi người dùng bấm tải.
- `/camera-pattern.html` là bảng thử trung tính 1080×1920 có lưới, vòng
  tròn, dấu TL/TR/BL/BR và bộ đếm ảnh. Dùng để quan sát mất góc, kéo méo
  và hướng gương; nó không phải công cụ đánh giá xác minh danh tính.
- `npm test` kiểm tra cách tính số đo, lọc trường nhận dạng thiết bị và
  vòng đời capture (hủy khi đang chờ quyền, timeout, đóng track, bắt đầu lại).

### Studio

1. Kiểm tra bố cục ở desktop và màn hình hẹp.
2. Đổi sáng/tối và tải lại trang để xác nhận theme được lưu.
3. Thử Fit/Fill/Crop, hai slider và Đặt lại khung.
4. Chọn **Tạo mã ghép nối**, kiểm tra QR, countdown, sao chép, tạo mã mới và thu hồi.
5. Quét QR hoặc dán link vào CamPOC; preview phải chuyển từ “đang kết nối” sang “đang phát”.
6. Đưa CamPOC xuống nền, mở Cam Browser và bật camera; hình phải tiếp tục chạy quá 30 giây mà không cần tắt/bật camera.
