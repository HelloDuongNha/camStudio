# camStudio

Studio phát camera/microphone từ trình duyệt máy tính sang VirtualCamPoC trên Android. Khi chạy trên Vercel, Studio dùng LiveKit Cloud để hoạt động qua Internet; khi chạy `npm start` trên máy tính, Studio vẫn dùng relay LAN/USB tethering để giảm độ trễ.

## Chạy cục bộ

```bash
npm start
```

Sau đó mở `http://localhost:4173`.

## Deploy Vercel

Khai báo bốn biến môi trường cho Production, Preview và Development rồi redeploy:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `CAMSTUDIO_ACCESS_KEY` — chuỗi bí mật tự chọn, dài ít nhất 24 ký tự

Ba giá trị LiveKit chỉ tồn tại ở Vercel Function và không được gửi xuống trình duyệt. Khi bấm **Tạo mã ghép nối** lần đầu trên Studio, nhập `CAMSTUDIO_ACCESS_KEY`; trình duyệt chỉ giữ khóa trong tab hiện tại. QR chứa token nhận có hạn một giờ, không chứa API secret.

## Luồng sử dụng

1. Mở Studio trên máy tính. Chọn camera/OBS Virtual Camera và microphone muốn phát.
2. Bấm **Tạo mã ghép nối**, sau đó **Bắt đầu camera/OBS**.
3. Trong VirtualCamPoC trên Android, quét QR hoặc dán toàn bộ link ghép nối.
4. Chọn nguồn đã ghép làm nguồn đang chạy, rồi mở Cam Browser/WebTest.

Studio tự chọn LiveKit trên Vercel và relay cục bộ khi chạy bằng `npm start`; người dùng không phải đổi chế độ thủ công.

## Kiểm tra nhanh bằng UI

1. Kiểm tra bố cục ở desktop và màn hình hẹp.
2. Đổi sáng/tối và tải lại trang để xác nhận theme được lưu.
3. Thử Fit/Fill/Crop, hai slider và Đặt lại khung.
4. Chọn **Tạo mã ghép nối**, kiểm tra QR, countdown, sao chép, tạo mã mới và thu hồi.
5. Quét QR hoặc dán link vào CamPOC; preview phải chuyển từ “đang kết nối” sang “đang phát”.
6. Đưa CamPOC xuống nền, mở Cam Browser và bật camera; hình phải tiếp tục chạy quá 30 giây mà không cần tắt/bật camera.
