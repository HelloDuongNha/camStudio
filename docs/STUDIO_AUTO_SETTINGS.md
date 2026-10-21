# Studio: tự áp dụng nguồn và đo FPS — 21/10/2026

Chọn camera/micro, hướng khung hoặc FPS sẽ tự áp dụng sau 200 ms; đổi liên tiếp chỉ giữ lựa chọn cuối. Giữ room, mã ghép nối và kết nối Cloud; canvas track tiếp tục phát, audio track thay bằng API LiveKit. Camera mới được chuẩn bị trước khi dừng nguồn cũ; lỗi mở nguồn giữ preview cũ và có nút thử lại. Lựa chọn thay đổi trong lúc chờ cấp quyền không bị enumerateDevices ghi đè.

Dropdown dùng mũi tên SVG bên trong, padding riêng, kích thước và focus đồng bộ. Preview dọc nằm giữa card, giới hạn theo viewport; đã kiểm tra desktop 1440px và mobile 390px không tràn ngang. Mặc định theo camera/OBS; ngang/dọc đặt đúng kích thước đầu ra, fit toàn bộ hình thay vì crop mất nội dung.

Tuỳ chọn 60 FPS đã bỏ: Android hiện có nhịp giới hạn USB khoảng 15 FPS, Cloud khoảng 30 FPS; không thể gọi đường này là 60 FPS đầu cuối. Studio hiển thị FPS đo riêng ở nguồn (video frame callbacks), canvas và gửi (USB upload thành công hoặc outbound WebRTC stats). Khi không có số đo không dùng FPS mục tiêu để thay thế. Chỉ vẽ/gửi khung mới theo callback nếu trình duyệt hỗ trợ, không bơm lại cùng canvas trong vòng USB.

Kiểm chứng: 60 test qua gồm auth/room, Redis/Mongo tạm, queue đổi nguồn, giữ phiên, thay audio, rollback, permission race và đo FPS; kiểm tra lại sau thay đổi cuối. Browser test dùng Chrome profile riêng với Y4M chuyển động giả lập, API account giả chỉ trong HTTP fixture loopback, cầu CORS chỉ trong test vì relay thật chỉ nhận origin production. Không dùng camera cá nhân hay chỉnh OBS. Preview USB được phát qua relay thật, Android pump và Cam Browser thật trên OPPO CPH2025. Trong 30,1119 giây ở đầu ra 1920×1080: 380 callbacks (12,62 FPS), 371 khung thay đổi fingerprint (12,32 FPS). Nguồn thử 640×360 được upscale trong Studio; đây không phải phép đo camera/OBS gốc 1080p hay bảo đảm FPS mọi nội dung. Fingerprint 64×36 đo thay đổi giữa các frame, không phải đối chiếu đầy đủ từng pixel.

Chưa kiểm lại phiên LiveKit production thật; giữ/thay track Cloud được kiểm qua harness và API SDK hiện có. Không tuyên bố Cloud đạt 30 FPS thực tế chỉ vì cấu hình tối đa là 30. Bốn media và toàn bộ preferences điện thoại khôi phục byte-identical; room và reverse 4190 test đã dọn, giữ 4173. Bằng chứng local ở `artifacts/studio-auto-settings/` (ignored), không có credentials trong báo cáo.

Chưa thực hiện Goal 3 (USB audio thành microphone website). Chờ người dùng kiểm tra Studio trước khi chuyển goal.
