# CamVitualWeb

# camStudio

Nền tảng giao diện mobile-first cho control plane Cam Virtual. G02 bổ sung pairing contract cục bộ với mã phiên, token ngắn hạn, QR/deep link, expiry và revoke. Chưa có media signaling, OBS hoặc media injection.

## Chạy cục bộ

```bash
npm start
```

Sau đó mở `http://localhost:4173`.

## Kiểm tra UI G01

1. Kiểm tra bố cục ở desktop và màn hình hẹp.
2. Đổi sáng/tối và tải lại trang để xác nhận theme được lưu.
3. Thử Fit/Fill/Crop, hai slider và Đặt lại khung.
4. Mở “Xem component”, quan sát button, text field và các trạng thái empty/loading/error.
5. Chọn “Tạo mã ghép nối”, kiểm tra QR, countdown, sao chép, tạo mã mới và thu hồi.
6. Quét QR hoặc dán link vào CamPOC; payload đúng còn hạn phải được nhận, payload sai/hết hạn phải bị từ chối.

Các nút OBS và quyền chỉ mô tả trạng thái roadmap; chức năng thật thuộc goal sau. Revocation trong G02 là trạng thái cục bộ; G03 mới đồng bộ qua signaling server.
