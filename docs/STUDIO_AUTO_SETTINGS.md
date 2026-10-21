# Studio: tự đổi nguồn và FPS theo khả năng thực tế — 21/10/2026

Chọn camera/micro và hướng khung tự áp dụng sau 200 ms; đổi liên tiếp chỉ giữ lựa chọn cuối. Giữ room, mã ghép nối và canvas track; audio track thay bằng API LiveKit. Camera mới được chuẩn bị trước khi dừng nguồn cũ; lỗi mở nguồn giữ preview cũ. Lựa chọn thay đổi trong lúc chờ quyền không bị enumerateDevices ghi đè.

Dropdown có mũi tên nằm trong nút, padding/focus đồng bộ. Preview dọc nằm giữa card, kiểm tra desktop 1440px và mobile 390px không tràn ngang. Mặc định theo camera/OBS; ngang/dọc fit toàn bộ hình. Bỏ selector FPS cùng cột trống, bỏ thông báo giới hạn USB15/Cloud30.

Không đặt mức khóa FPS trong Studio: xin frameRate tối đa mà camera công bố qua getCapabilities, vẽ theo từng video frame callback, canvas requestFrame sau khi vẽ, không truyền maxFramerate vào encoder. Trình duyệt thiếu requestFrame dùng captureStream không tham số. USB chỉ gửi canvas mới, không ngủ để ép 15/30 FPS; giữ backoff khi lỗi. Bitrate theo kích thước/tốc độ nguồn, WebRTC tự điều chỉnh theo mạng. Điều này không làm phần cứng, website đích hay decoder có tốc độ vô hạn.

Studio hiển thị số đo riêng: nguồn (presentedFrames), canvas đã vẽ và gửi (upload USB thành công / outbound WebRTC stats). Cam hiển thị Nhận và Xem trước dưới preview; nguồn Cloud đếm callback nhận, preview đếm lần cập nhật UI. Số đo nguồn cũ quá 2,5 giây chuyển thành dấu —; preview không có khung mới tự về 0. Không dùng số FPS yêu cầu làm số đo thực tế.

Android bỏ vòng chờ USB66ms, Surface80ms, Cloud33ms, Cloud preview66ms. Các vòng LiveKit chờ khung mới qua queue chỉ giữ một khung đang chờ; không lặp hình cũ để tăng bộ đếm. USB YUV tải/giải mã song song với chuyển/ghi YUV, bỏ khung chờ cũ để giữ độ trễ thấp. Chuyển màu BT.601 limited giữ nguyên hệ số, ghi bulk theo hàng và giữ nguyên padding/các plane U/V chồng nhau. Hình cùng kích thước/hướng không vẽ lại RGB (USB) hoặc ánh xạ từng pixel (Cloud I420); zoom/pan/rotate vẫn đi đường xử lý hình. Chỉ preview Cloud lấy mẫu; hình cấp cho Browser giữ độ phân giải nguồn/consumer.

Kiểm chứng hiện tại: 61 test web qua, có kiểm tra nguồn 120 FPS giả lập được vẽ đủ callback, yêu cầu capability tối đa, không đặt maxFramerate, auth/room, Redis/Mongo tạm, đổi nguồn và permission race. Hai biến thể Android, camera-consumer, unit test/lint qua. Hai instrumented test trên OPPO CPH2025 kiểm tra màu preview lấy mẫu với kích thước lẻ và xoay 90/180/270. Không dùng connectedAndroidTest vì cài lại target có thể xóa dữ liệu; test APK cài bằng install-r.

Đo động: nguồn testsrc2 Y4M 640×360 60 FPS được Studio upscale 1920×1080, Chrome profile riêng, relay USB thật, Cam/Browser thật. Baseline cùng lượt: Studio USB nhận14,5 / vẽ13,6 / gửi13,9 FPS; Browser 380 callback trong30,0444s (12,65 FPS), 363 fingerprint đổi (12,08 FPS). Sau bỏ khóa: Studio nguồn/vẽ60, gửi59,8 FPS. Các lượt Browser USB trước tối ưu trực tiếp đạt khoảng26–29 callback FPS và26–28,8 FPS có nội dung đổi. Website vẫn công bố track30 FPS ngay cả khi yêu cầu ideal120; đây là giới hạn đường nhận hiện tại, không gọi là60 FPS đầu cuối. Pump YUV tăng khoảng14 lên35–38 FPS; thời gian chuyển/ghi giảm khoảng40 xuống23ms.

Cloud kiểm tra bằng phòng LiveKit thật tạm với JWT10phút, API account/session giả chỉ trong fixture loopback; không dùng camera cá nhân hoặc phòng người dùng. Studio gửi60 FPS/1920×1080 khoảng12,4 Mb/s; Cam nhận60,2 FPS, preview43–45 FPS. Kết quả cuối Browser và USB được ghi thêm trong báo cáo `app/build/outputs/cam-unlimited-fps/VALIDATION.md` ở project Android. Không dùng phép đo này để đảm bảo FPS cho mọi camera/OBS/mạng hoặc kết luận chất lượng từng pixel; fingerprint64×36 chỉ đếm thay đổi nội dung liền kề.

Goal3 (audio USB thành microphone website) chưa bắt đầu. Chờ người dùng kiểm tra bản FPS này.
