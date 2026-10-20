# Cam Studio

Studio phát camera/OBS từ máy tính tới CamPOC qua LiveKit Cloud hoặc relay USB. Người dùng đăng nhập/đăng ký Google trước khi vào Studio; có Đăng xuất trong giao diện. Không sử dụng khóa truy cập nhập tay.

## Hành vi ghép nối

- Bấm **Tạo mã ghép nối** sẽ mở nguồn camera/microphone và bắt đầu phát. Không có nút phát thứ hai trong modal.
- Cloud dùng mã phòng 6 ký tự và mật khẩu ngẫu nhiên 10 ký tự. QR/link ngắn chứa thông tin mời ghép nối; không chứa JWT LiveKit.
- MongoDB giữ chủ sở hữu, mã duy nhất, phiên bản phòng, trạng thái và hạn dùng. Mật khẩu được hash bằng scrypt và mã hóa AES-GCM để chủ tài khoản mở lại QR. Không lưu video hoặc mật khẩu Google vào database.
- Mỗi phòng cho một thiết bị nhận ghép nối. Cùng thiết bị có thể thử lại; các tiến trình preview/Browser trên thiết bị có thể nhận media độc lập qua credential riêng.
- Tạo mã mới khóa mã/password/credential cũ trong database trước khi xóa phòng media cũ. Phòng media dùng ID riêng ngẫu nhiên, không trùng mã công khai. Lock theo tài khoản và unique indexes bảo vệ thao tác đồng thời.
- Đóng modal khi chưa có thiết bị kết nối sẽ hủy phòng và dừng nguồn. Phòng đã kết nối được giữ khi đóng modal. Trạng thái kết nối Cloud được đối chiếu qua LiveKit, không chỉ dựa vào việc phát nguồn.
- QR còn hạn được khôi phục theo tài khoản nhưng không tự mở camera khi tải trang. Thời hạn mặc định: đăng nhập 30 ngày, ghép nối 1 giờ.

## Máy chủ

Render chạy **Node Web Service**, không phải Static Site. Node >=22.9.0. Google OAuth được xác minh ở server; cookie đăng nhập HttpOnly/Secure. `/`, `/index.html`, `/studio` yêu cầu đăng nhập từ server. `/login` và `/signup` là cửa vào công khai. Các API chủ phòng kiểm tra quyền riêng, không dựa vào chặn giao diện.

| Biến môi trường | Nội dung |
| --- | --- |
| `APP_ORIGIN` | `https://campoc.onrender.com` |
| `MONGODB_URI` | Connection string MongoDB Atlas, chỉ ở server |
| `MONGODB_DATABASE` | `camstudio` |
| `ROOM_SECRET_KEY` | 32 byte ngẫu nhiên, biểu diễn 64 ký tự hex; giữ ổn định và sao lưu riêng |
| `GOOGLE_CLIENT_ID` | OAuth client loại Web application |
| `GOOGLE_CLIENT_SECRET` | Secret của OAuth client |
| `LIVEKIT_URL` | URL wss LiveKit Cloud hiện tại |
| `LIVEKIT_API_KEY` | Key LiveKit ở server |
| `LIVEKIT_API_SECRET` | Secret LiveKit ở server |
| `REDIS_URL` | Tùy chọn, kết nối Redis riêng cho dịch vụ |
| `TRUST_PROXY_HOPS` | Số proxy được tin cậy khi lấy IP rate-limit; Render đặt `1`, local `0` |

Không đưa `.env`, file `client_secret*.json` hoặc secret vào Git. `npm start` nạp `.env` cục bộ nếu có; biến Render Environment được ưu tiên. Đã bỏ PostgreSQL và `CAMSTUDIO_ACCESS_KEY`.

Server tự tạo indexes MongoDB khi cần. User Atlas chỉ cần `readWrite` trên database `camstudio`. Giới hạn IP truy cập Atlas theo máy quản trị/địa chỉ outbound của Render; không mở toàn Internet nếu không có quyết định rõ ràng của chủ hệ thống.

Redis dùng cho giới hạn lượt thử và cache presence 1,5 giây. MongoDB vẫn kiểm tra giới hạn/quyền thực tế. Khi Redis ngắt hoặc chưa cấu hình, server quay về MongoDB; hủy phòng luôn kiểm tra presence mới, không dựa vào cache. Không truyền frame camera qua Redis. Điều này giảm truy vấn trạng thái/abuse overhead, không phải bằng chứng tăng FPS video.

## Google OAuth

Mọi tài khoản Google có email được xác minh đều có thể đăng nhập; lần đầu tự tạo tài khoản. Chỉ yêu cầu `openid email profile`. Callback chính xác:

`https://campoc.onrender.com/api/auth?route=callback`

Audience chọn External; phát hành Production để người dùng ngoài nhóm Test users có thể đăng nhập. OAuth client Android hiện có không bị thay đổi. Xem [hướng dẫn thiết lập](docs/GOOGLE_ACCOUNT_SETUP.md).

## USB

Giao diện: `https://campoc.onrender.com/?transport=usb` (cũng yêu cầu đăng nhập Studio). API relay chạy riêng ở `127.0.0.1:4173`.

```sh
./start_usb_mode.sh
```

Để tự chạy sau đăng nhập macOS:

```sh
./install_usb_autostart.sh
```

CamPOC nhận phiên qua ADB reverse. USB không dùng mật khẩu Cloud; mã/receiver token được quản lý bởi relay cục bộ. Modal USB đóng khi chưa có consumer sẽ hủy phiên; đã có consumer yêu cầu frame thì giữ. Mã trùng với token khác bị từ chối thay vì ghi đè. Cần cập nhật/chạy lại relay sau thay đổi `server.py`.

## Android tương thích

Cần APK CamPOC mới cho QR `camvirtual://connect` và nhập mã/password Cloud. App đổi lời mời thành credential nhận có thể thu hồi, sau đó lấy JWT ngắn hạn qua server. JWT chỉ nằm trong RAM trong lúc nối LiveKit. Browser LSPatch cũng phải nhúng module mới; chỉ cập nhật controller không cập nhật module trong Browser.

Không thay hook Camera2 hoặc nguồn video/ảnh local của Android. Các điều khiển thừa chỉ được bỏ khỏi giao diện web.

## Kiểm thử

```sh
npm ci
npm test
```

MongoDB integration tests chạy mongod thật tạm thời qua `mongodb-memory-server`; Redis test dùng `redis-server` riêng nếu được cài. Không dùng database Atlas thật trong unit/integration tests. OAuth và LiveKit ở ranh giới ngoài được giả lập; cần kiểm thử Google/Atlas/LiveKit thật sau triển khai.

```sh
python3 -m unittest test/relay_http_test.py
```

Bản UI QA cô lập (tài khoản, OAuth, video và media transport giả lập):

```sh
node test/preview-server.js
```

Trang đo camera độc lập `/camera-check.html` và bảng `/camera-pattern.html` vẫn có sẵn. Không lấy preview/screenshot làm bằng chứng chất lượng buffer camera hoặc FPS nội dung khác nhau.

## Giới hạn thu hồi media

Mã/password và lease cũ bị từ chối ngay sau khi database chuyển sang closing/xóa. JWT LiveKit được cấp ngắn tối đa 120 giây; server ngắt phòng cũ khi thay mã. JWT đã phát không thể được xem là thu hồi chữ ký tức thì, nhưng không cấp quyền vào phòng media mới và không còn được đổi lease cũ lấy JWT mới. Cần kết quả trên thiết bị thật trước khi khẳng định hành vi reconnect hoàn chỉnh.
