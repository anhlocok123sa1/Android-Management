# Phần mềm Quản lý Thiết bị Truyền thanh Thông minh — Design Doc

> [!IMPORTANT]
> Ràng buộc cứng: Sau khi box được lắp ngoài trụ điện, **AnyDesk là kênh duy nhất** để tương tác với thiết bị. ADB qua LAN chỉ dùng được trong giai đoạn cài đặt tại kho/văn phòng.

---

## Vấn đề cần giải quyết & Quyết định

### Vấn đề 1: Làm thế nào thực thi lệnh trên thiết bị đã triển khai ngoài thực địa?

**Thực tế:** AnyDesk là remote desktop — bạn thấy màn hình và điều khiển tay. Không có SSH, không có ADB trực tiếp.

**Quyết định — Kiến trúc Agent trên thiết bị:**

App `AutoSetup.apk` (đã cài sẵn ở Giai đoạn 1) sẽ được nâng cấp thành một **on-device agent** chạy nền. Agent này:
- **Polling Google Sheet** mỗi ~60 giây để nhận lệnh mới
- Thực thi lệnh cục bộ (cài APK từ URL, gỡ app, login, v.v.)
- Báo cáo kết quả và trạng thái ngược lại Google Sheet
- **AnyDesk chỉ dùng để can thiệp thủ công** khi agent gặp lỗi không xử lý được

```
PC (Management App)
        │  writes task
        ▼
  Google Sheet  ←── agent reads every 60s ───  Android Box (AutoSetup Agent)
        │                                               │
        └────────────── agent writes status ───────────┘
```

> [!NOTE]
> Điều này có nghĩa: **không cần người ngồi AnyDesk click tay** cho các tác vụ định kỳ. AnyDesk chỉ là fallback.

---

### Vấn đề 2: Giai đoạn 2 — Triển khai theo dự án khi box đã ngoài thực địa

**Thực tế:** Mỗi dự án cần quy trình khác nhau:
- `1.66`: Cài radio 1.66 → xóa 3.6
- `ics`: Cài ICS → xóa 3.6 → đọc MAC của ICS → ghi lên sheet
- `3.6`: Đăng xuất tài khoản test → đăng nhập tài khoản thật

**Quyết định — Task Template System:**

Management App cho phép admin **soạn Task Template** = một chuỗi bước có thứ tự (JSON), ví dụ:

```json
{
  "template_name": "deploy_1.66",
  "steps": [
    {"action": "download_apk", "url": "{{sheet_url_col_B}}", "save_as": "radio166.apk"},
    {"action": "install_apk", "file": "radio166.apk"},
    {"action": "uninstall_pkg", "package": "com.sgl.radio36"},
    {"action": "report_status", "field": "project", "value": "1.66"}
  ]
}
```

Admin gán template cho một hoặc nhiều thiết bị → agent trên thiết bị nhận và thực thi tuần tự → báo cáo từng bước.

---

### Vấn đề 3: Nâng cấp logic từ xa (Remote Code Update)

**Thực tế:** Mỗi dự án có thể yêu cầu logic không lường trước (đọc sheet để lấy thông tin đăng nhập, flow màn hình đặc biệt, v.v.)

**Quyết định — Hybrid: Static Core + Dynamic Script:**

- **Core app** (`.exe`): Không đổi — chỉ gồm ADB engine, UI, kết nối Sheet
- **Task Templates**: Lưu trên Google Sheet, management app đọc và phân phối cho agent. Admin chỉnh trực tiếp trên Sheet, không cần deploy lại
- **Script nâng cao**: Nếu bước nào cần Python tùy biến, management app có thể push một file `.py` nhỏ lên `/sdcard/` và agent gọi `exec()` — đây là escape hatch cho trường hợp phức tạp

> [!TIP]
> Cập nhật tính năng mới: chỉ cần chỉnh nội dung Google Sheet — không cần phân phối lại file `.exe` đến từng máy tính văn phòng.

---

### Vấn đề 4: Theo dõi trạng thái thiết bị thực địa

**Thực tế:** Box treo trên trụ điện — không biết nó đang hoạt động hay chết.

**Quyết định — Heartbeat + Status Report:**

Agent gửi "nhịp tim" lên Sheet mỗi 5 phút:
- Thời gian ping cuối
- Phiên bản app đang cài
- RAM/Storage còn trống
- Trạng thái nhiệm vụ hiện tại

Management App tính:
- **Online** = ping trong vòng 10 phút
- **Offline** = không ping > 10 phút → cảnh báo đỏ
- **Task Failed** = agent báo lỗi

---

### Vấn đề 5: Bảo mật — Agent nhận lệnh từ Sheet, ai cũng có thể sửa Sheet?

**Quyết định:**
- Sheet chia sẻ **chỉ-ghi** cho agent (ghi trạng thái), **chỉ-đọc** phần lệnh thông qua Apps Script
- Google Apps Script webhook đóng vai trò middleware: xác thực request, chống spam
- Lệnh nguy hiểm (factory reset, uninstall hệ thống) yêu cầu xác nhận 2 lớp trong management app

---

### Vấn đề 6: Giai đoạn 1 vẫn cần ADB qua LAN — làm sao tích hợp vào tool mới?

**Quyết định:** Tool mới có **Tab "GĐ1 — Cài tại kho"** giữ nguyên toàn bộ logic của `LAM_MASS_INSTALLER_1_v2.py` hiện tại, chỉ nâng cấp UI và thêm link sang trang quản trị.

---

## Kiến trúc Tổng thể

```
┌─────────────────────────────────────────────────────────┐
│          PC MANAGEMENT APP (Python + Tkinter)           │
│  ┌────────┐ ┌────────┐ ┌──────────────┐ ┌───────────┐  │
│  │ GĐ1   │ │ GĐ2    │ │  Dashboard   │ │  Task     │  │
│  │ ADB   │ │ Deploy │ │  Giám sát    │ │  Builder  │  │
│  │ LAN   │ │ Project│ │  Thực địa    │ │  Từ xa    │  │
│  └────────┘ └────────┘ └──────────────┘ └───────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │  HTTPS (Apps Script Webhook)
                       ▼
         ┌─────────────────────────┐
         │      GOOGLE SHEETS      │
         │  - Sheet "Android Mới"  │
         │  - Sheet "Thiết bị"     │  ← database
         │  - Sheet "Tasks"        │
         │  - Sheet "Heartbeat"    │
         └────────────┬────────────┘
                      │  polling mỗi 60s
          ┌───────────┼───────────┐
          ▼           ▼           ▼
    [Box Dự án A] [Box Dự án B] [Box Dự án C]
    AutoSetup     AutoSetup     AutoSetup
    Agent         Agent         Agent
    (Android)     (Android)     (Android)
```

---

## Các màn hình của Management App

### Tab 1: GĐ1 — Cài tại kho (ADB LAN)
- Giữ nguyên UI hiện tại của `LAM_MASS_INSTALLER_1_v2.py`
- Thêm: sau khi cài xong, thiết bị tự động xuất hiện trong Tab Dashboard

### Tab 2: Dashboard — Thiết bị Thực địa
| Cột | Nội dung |
|-----|----------|
| MAC | Địa chỉ MAC (không dấu `:`) |
| AnyDesk | Mã truy cập AnyDesk |
| Dự án | 1.66 / ICS / 3.6 / Chưa xác định |
| Trạng thái | 🟢 Online / 🔴 Offline / ⚠️ Lỗi |
| Ping cuối | Thời gian heartbeat cuối |
| App | Phiên bản app đang chạy |
| Task hiện tại | Đang rảnh / Đang chạy: `deploy_1.66` |

- Click phải → "Mở AnyDesk" → tự điền AnyDesk ID vào ô kết nối
- Filter theo dự án, trạng thái

### Tab 3: GĐ2 — Triển khai Dự án
1. Chọn template dự án (`1.66` / `ICS` / `3.6`)
2. Chọn thiết bị (tích [X] trên bảng)
3. Bấm "Triển khai" → ghi task vào Sheet → agent nhận và thực thi
4. Thanh tiến trình realtime từ heartbeat của agent

### Tab 4: Task Builder
- Soạn/sửa Task Template (giao diện wizard từng bước)
- Lưu template lên Sheet để dùng cho nhiều dự án
- Cho phép paste Python script cho bước phức tạp

---

## Các thành phần cần phát triển

| Thành phần | Ngôn ngữ | Ghi chú |
|-----------|----------|---------|
| **Management App** | Python + Tkinter | Mở rộng từ file hiện có |
| **AutoSetup Agent (Android)** | Kotlin/Java (Android) | Nâng cấp từ `00_AutoSetup.apk` |
| **Google Apps Script** | JavaScript | Webhook middleware |
| **Task Schema** | JSON | Định nghĩa các bước hợp lệ |

> [!WARNING]
> AutoSetup.apk hiện tại — tôi chưa có source code, chỉ có file `.apk`. Cần biết bạn có source code không để quyết định có nâng cấp được app này hay phải viết agent mới.

---

## Thứ tự phát triển đề xuất

```
Giai đoạn A: Nền tảng (1–2 tuần)
  → Thiết kế cấu trúc Google Sheet
  → Viết Google Apps Script webhook
  → Tích hợp Management App (nâng cấp UI, thêm Dashboard)

Giai đoạn B: Agent trên thiết bị (1–2 tuần)
  → Viết AutoSetup Agent mới (hoặc nâng cấp nếu có source)
  → Polling + Heartbeat + Task execution

Giai đoạn C: GĐ2 + Task Builder (1 tuần)
  → Triển khai 3 loại dự án (1.66, ICS, 3.6)
  → Task Builder UI

Giai đoạn D: Hoàn thiện (1 tuần)
  → Cảnh báo offline
  → Remote script execution
  → Test thực tế với thiết bị thật
```

---

## Quyết định đã xác nhận

| Câu hỏi | Thực tế | Quyết định |
|---------|---------|-----------|
| Source AutoSetup.apk | Project Android rỗng (blank template), chưa có logic | **Viết từ đầu** trên nền có sẵn, package `com.sgl.autosetup` |
| Mạng thực địa | SIM 4G | Polling tốn < 1MB/ngày/box — không đáng kể |
| Sheets quota | 60 req/phút/user | **Dùng Apps Script webhook làm aggregator** — box không gọi thẳng Sheets API |

