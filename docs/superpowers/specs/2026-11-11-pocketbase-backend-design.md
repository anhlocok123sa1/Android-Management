# Thiết kế Hệ thống Backend PocketBase cho Radio Device Manager

> **Trạng thái:** Chờ phê duyệt (Draft for Approval)  
> **Ngày:** 11/11/2026  
> **Tác giả:** Antigravity & User  
> **Tài liệu liên quan:** `docs/THIET_KE_KIEN_TRUC.md`, `backend/setup_instructions.md`

---

## 1. Mục tiêu & Lý do (Intent and the Why)

### 1.1. Bối cảnh
Hệ thống **Radio Device Manager** hiện đang sử dụng **Google Sheets + Google Apps Script (GAS) Web App** làm cơ sở dữ liệu và máy chủ xử lý tác vụ cho:
1. Hàng loạt Android Box gắn ngoài thực địa (kết nối 4G) gửi nhịp tim (heartbeat) và nhận lệnh từ xa (deploy kịch bản, đổi app).
2. Desktop App (Python Tkinter trong `sgl_manager/`) quản lý thiết bị, cấu hình kịch bản và theo dõi trạng thái.
3. Web App (`web/` - giao diện HTML/JS) chạy trên trình duyệt / GitHub Pages để giám sát và in tem nhãn nhiệt.

### 1.2. Vấn đề thực tế
- **Độ trễ cao:** Mỗi request đến Apps Script mất từ 2 đến 6 giây do cơ chế cold start của sandbox V8 và chuỗi redirect HTTP 302.
- **Nghẽn lock (`LockService`):** Khi nhiều thiết bị ngoài thực địa gửi xung nhịp cùng thời điểm, cơ chế khóa hàng đợi của Apps Script khiến các yêu cầu bị tắc nghẽn, sinh lỗi timeout hoặc rớt kết nối.
- **Giới hạn bảng tính:** Google Sheets không phải là cơ sở dữ liệu, việc đọc/ghi hàng ngàn ô trên giao diện bảng tính tạo áp lực I/O rất lớn.

### 1.3. Mục đích thiết kế
Thay thế lớp lưu trữ và xử lý Google Sheets bằng **PocketBase** trên một bản sao độc lập (isolated branch / worktree / clone), mang lại:
- Tốc độ phản hồi cực nhanh (< 30ms).
- Khả năng xử lý hàng trăm kết nối đồng thời từ thiết bị IoT.
- Tính năng Realtime SSE (Server-Sent Events) đẩy lệnh tức thì thay vì Android Box phải HTTP polling mỗi 60s gây hao tốn data 4G.
- Giữ nguyên các chức năng cốt lõi: Quản lý thiết bị, phân phối kịch bản (Task Template), gửi nhịp tim, in nhãn nhiệt và mở AnyDesk.

---

## 2. Mục tiêu, Giới hạn & Chống mục tiêu (Goals, Non-goals, Anti-goals)

### 2.1. Goals (Mục tiêu đạt được)
- **Bản sao độc lập (Workspace Isolation):** Tạo nhánh riêng `feat/pocketbase` (hoặc git worktree) để toàn bộ code Google Sheet hiện tại ở nhánh `main` không bị ảnh hưởng, có thể chuyển đổi qua lại bất kỳ lúc nào.
- **Hạ tầng PocketBase tự động hóa:**
  - Tích hợp binary `pocketbase.exe` (Windows x64) đặt trong `bin/pocketbase/`.
  - Cung cấp script tự động khởi tạo Schema (`pocketbase_setup.py`) tạo 4 Collections: `devices`, `tasks`, `templates`, `heartbeats` và nạp sẵn kịch bản mẫu mặc định.
  - Script nạp dữ liệu 1-click (`import_sheets_to_pb.py`): Sao chép toàn bộ danh sách thiết bị và kịch bản hiện có từ Google Sheet sang PocketBase CSDL ban đầu.
- **Bảo mật & Quản trị:**
  - Thiết lập API Rules an toàn: Thao tác nhạy cảm (tạo task, đổi dự án, xóa template) yêu cầu Admin Token hoặc Secret Header (`X-SGL-Secret`). Ngăn chặn rủi ro lộ link tunnel bị inject lệnh root độc hại.
- **Nâng cấp Web App (`web/`):**
  - Hỗ trợ switch cấu hình chuyển đổi linh hoạt (`PocketBase` hoặc `Google Sheet`).
  - Lắng nghe Realtime SSE trên Web Dashboard: Box cập nhật trạng thái hoặc hoàn thành task thì web hiển thị ngay tức thì mà không cần F5/polling.
- **Nâng cấp Android Agent & Desktop App:**
  - Android Agent duy trì cơ chế REST Polling/Heartbeat nhẹ để tương thích mạng 4G NAT, trỏ endpoint về PocketBase.
  - Desktop App (`sgl_manager/`): Tích hợp client PocketBase trực tiếp.

### 2.2. Non-goals (Không thuộc phạm vi)
- Không bắt buộc Android Box ngoài thực địa duy trì kết nối persistent SSE liên tục qua sóng 4G (để tránh tụt pin, rớt socket do NAT nhà mạng và tốn dung lượng keepalive). SSE chỉ áp dụng cho Web App Dashboard trên máy tính.
- Không đồng bộ 2 chiều liên tục (bi-directional sync) giữa PocketBase và Google Sheets sau khi vận hành. Dữ liệu chạy trên PocketBase là độc lập, có nút bấm "Export CSV/Excel" khi cần báo cáo.

### 2.3. Anti-goals (Điều cần tránh tuyệt đối)
- Không yêu cầu cài đặt Docker, Node.js nặng nề hoặc môi trường phức tạp: PocketBase chỉ là một file thực thi độc lập (`.exe`), khởi chạy bằng 1 click.
- Không để mất mát dữ liệu hoặc làm hỏng mã nguồn đang chạy ổn định của nhánh `main`.

---

## 3. Ràng buộc kỹ thuật & Quyết định lựa chọn (Constraints & Decisions)
- **Hình thức Bản sao (Workspace Isolation):** Triển khai trên nhánh Git riêng `feat/pocketbase` ngay trong thư mục dự án hiện tại. Nhánh `main` (Google Sheet) được bảo tồn nguyên vẹn 100%.
- **Hệ thống mạng & Đường truyền:**
  - **Mục tiêu dài hạn (Lựa chọn C):** Hệ thống được cấu hình sẵn để trỏ về Domain / Named Cloudflare Tunnel cố định (ví dụ `https://pb.domain.com`) khi người dùng trang bị domain.
  - **Giai đoạn chuyển tiếp (Hiện tại chưa có domain):** Hệ thống tự động kích hoạt **Cloudflare Quick Tunnel** (`bin/cloudflared.exe`) tạo link HTTPS công khai tạm thời để test và vận hành ngay lập tức, đồng thời hỗ trợ kết nối trực tiếp qua LAN/Localhost. Cấu hình URL được tập trung hóa trong file cấu hình (`pocketbase_config.json`) và giao diện Web Settings, giúp đổi sang Domain cố định chỉ trong 1 thao tác mà không cần sửa code.
- **Hệ điều hành:** Windows (PowerShell / Batch script).
- **Giao thức:** REST API + Server-Sent Events (SSE) qua HTTPS.

---

## 4. Các phương án kiến trúc đã cân nhắc (Approaches)

1. **Phương án 1 — PocketBase (Phương án được chọn):**
   - *Ưu điểm:* 1 file thực thi duy nhất, tích hợp SQLite hiệu năng cao, phản hồi < 20ms, có sẵn Web Admin UI quản lý dữ liệu trực quan như bảng tính, hỗ trợ Realtime SSE out-of-the-box, hỗ trợ mở rộng qua JS Hooks (`pb_hooks`).
   - *Nhược điểm:* Cần download file binary `pocketbase.exe` tương ứng với OS.
   - *Lý do chọn:* Đáp ứng trọn vẹn tiêu chí nhanh, nhẹ, không cấu hình rườm rà, giao diện Admin quản lý thân thiện tương đương Google Sheets.

2. **Phương án 2 — Tự viết FastAPI + SQLite:**
   - *Ưu điểm:* 100% bằng Python, tái sử dụng trực tiếp các hàm trong `sgl_manager`.
   - *Nhược điểm:* Phải tự viết lại toàn bộ giao diện Admin Dashboard và cơ chế phân quyền, SSE. Tốn nhiều công sức bảo trì.

3. **Phương án 3 — Firebase Realtime Database:**
   - *Ưu điểm:* Cloud sẵn, đẩy push tốt cho Android.
   - *Nhược điểm:* Phụ thuộc hoàn toàn vào tài khoản Google Cloud, không tự host offline/nội bộ được khi mạng chập chờn.

4. **Phương án 4 — Cache Proxy giữ nguyên Google Sheets:**
   - *Ưu điểm:* Vẫn lưu dữ liệu trên Sheet.
   - *Nhược điểm:* Bản chất vẫn bị nghẽn ở bước sync, kiến trúc chắp vá.

---

## 5. Thiết kế Chi tiết Kiến trúc PocketBase (Detailed Design)

### 5.1. Cấu trúc CSDL (Collections Schema)

PocketBase sẽ định nghĩa 4 Collections ánh xạ 1:1 từ 4 Sheet hiện tại:

#### Collection 1: `devices`
| Trường (Field) | Kiểu dữ liệu | Ràng buộc | Mục đích |
| :--- | :--- | :--- | :--- |
| `mac` | Text | Unique, Non-empty, Index | Địa chỉ MAC thiết bị (khóa chính logic) |
| `anydesk_id` | Text | Optional | Mã điều khiển AnyDesk |
| `project` | Text | Optional | Tên dự án/địa bàn |
| `status` | Select (`online`, `offline`, `busy`, `new`) | Default: `new` | Trạng thái thiết bị |
| `last_seen` | Date / Text | Optional | Thời điểm heartbeat cuối |
| `app_version`| Text | Optional | Phiên bản Agent đang cài |
| `storage_mb` | Number | Optional | Dung lượng trống bộ nhớ trong (MB) |
| `task_id` | Text | Optional | ID task đang chạy nếu có |
| `notes` | Text | Optional | Ghi chú kỹ thuật |

#### Collection 2: `tasks`
| Trường (Field) | Kiểu dữ liệu | Ràng buộc | Mục đích |
| :--- | :--- | :--- | :--- |
| `task_id` | Text | Unique, Non-empty, Index | Mã nhiệm vụ duy nhất (VD: `TASK_...`) |
| `template_name`| Text | Required | Tên kịch bản |
| `target_mac` | Text | Required, Index | Thiết bị đích nhận task |
| `status` | Select (`pending`, `claimed`, `completed`, `failed`) | Default: `pending` | Trạng thái hàng đợi task |
| `created_at` | Date / Text | Default: now | Thời điểm tạo lệnh |
| `claimed_at` | Date / Text | Optional | Thời điểm box nhận lệnh |
| `completed_at`| Date / Text | Optional | Thời điểm hoàn thành |
| `result` | Text | Optional | Log kết quả hoặc nguyên nhân lỗi |

#### Collection 3: `templates`
| Trường (Field) | Kiểu dữ liệu | Ràng buộc | Mục đích |
| :--- | :--- | :--- | :--- |
| `template_name`| Text | Unique, Required | Tên định danh kịch bản |
| `steps_json` | JSON / Text | Required | Chuỗi JSON các bước thực thi (shell, install...) |
| `description` | Text | Optional | Mô tả công dụng |
| `created_by` | Text | Optional | Tên người tạo |

#### Collection 4: `heartbeats`
| Trường (Field) | Kiểu dữ liệu | Ràng buộc | Mục đích |
| :--- | :--- | :--- | :--- |
| `mac` | Text | Required, Index | MAC của box gửi nhịp tim |
| `timestamp` | Date / Text | Required | Thời điểm ping |
| `ram_mb` | Number | Optional | RAM khả dụng (MB) |
| `storage_mb` | Number | Optional | Bộ nhớ trống (MB) |
| `current_task`| Text | Optional | Task đang chạy |
| `app_version`| Text | Optional | Phiên bản app |
| `ip` | Text | Optional | IP mạng (4G hoặc LAN) |

### 5.2. Tương thích API (API Endpoints & Hook Gateway)
PocketBase cung cấp sẵn REST API:
- `GET /api/collections/devices/records`: Lấy danh sách thiết bị
- `POST /api/collections/devices/records`: Đăng ký thiết bị mới
- `PATCH /api/collections/devices/records/:id`: Cập nhật trạng thái / dự án
- `GET /api/collections/tasks/records?filter=(target_mac='...' && status='pending')`: Box lấy lệnh cần thực thi
- `PATCH /api/collections/tasks/records/:id`: Box báo cáo nhận lệnh hoặc hoàn thành

**Cơ chế Hook tương thích ngược (`pb_hooks/legacy_compat.pb.js`):**
Tạo 1 endpoint tùy biến `POST /api/sgl_webhook` bằng JS Hook trong PocketBase để đón các request cũ có cấu trúc:
```json
{
  "action": "heartbeat" | "claim_task" | "complete_task" | "register_device",
  "mac": "...",
  ...
}
```
Nhờ vậy, ngay cả khi Android Box đang chạy app cũ chưa kịp nạp URL mới, hoặc script Python cũ chưa đổi hàm, hệ thống vẫn phản hồi tức thì mà không bị gãy vỡ quy trình!

### 5.3. Chiến lược Cách ly Mã nguồn (Git Workspace Isolation)
1. Tạo nhánh mới `feat/pocketbase` từ `main`.
2. Giữ nguyên toàn bộ mã nhánh `main` (Google Sheet).
3. Người dùng có thể khởi chạy server PocketBase bằng một file batch duy nhất: `CHAY_POCKETBASE.bat`. File này:
   - Tải hoặc khởi động `pocketbase.exe serve --http=127.0.0.1:8090`.
   - Tự động kích hoạt `cloudflared.exe tunnel --url http://127.0.0.1:8090` để có link public tức thì.
   - Mở giao diện Admin `http://127.0.0.1:8090/_/` và giao diện Web `web/index.html`.

---

## 6. Phân định công việc cho người thực hiện (What's Left to the Builder)
1. **Thiết lập công cụ:** Tải binary PocketBase Windows amd64 và đặt vào thư mục `bin/pocketbase/`.
2. **Khởi tạo Schema & Dữ liệu mẫu:** Viết script tự động (`pocketbase_setup.py` hoặc schema migration) để tạo sẵn 4 collections với phân quyền API công khai (hoặc khóa Admin).
3. **Cập nhật Web App (`web/app.js`):** Thêm switch chọn Backend (`PocketBase` / `Google Sheet`), kết nối qua PocketBase REST API và lắng nghe Realtime SSE.
4. **Tạo Gateway tương thích:** Viết file hook `pb_hooks/legacy_compat.pb.js` để xử lý các request webhook chuẩn cũ.
5. **Kịch bản khởi chạy 1-click:** Tạo file `CHAY_POCKETBASE.bat` hoàn chỉnh.
