# Hướng dẫn Thiết lập Google Sheet & Triển khai Apps Script Backend
## Dự án: Radio Device Manager (Hệ thống Quản lý Thiết bị Truyền thanh Android)

Tài liệu này hướng dẫn chi tiết cách thiết lập Google Spreadsheet và triển khai Google Apps Script Web App làm máy chủ trung gian (middleware backend) kết nối giữa **PC Management App** và **Android Box Agent** (treo ngoài trụ điện kết nối 4G).

---

## 1. Cấu trúc Google Sheet

Tạo một file Google Spreadsheet mới (ví dụ đặt tên: `Radio_Device_Manager`).

Hệ thống yêu cầu **4 Sheet** với cấu trúc cột (header row 1) chính xác như sau:

### Sheet 1: `Devices`
Quản lý trạng thái và danh sách tất cả các Android Box ngoài trụ.
- **Tên Sheet:** `Devices`
- **Các cột (Row 1):**
  1. `mac` *(Địa chỉ MAC của thiết bị - Khóa chính)*
  2. `anydesk_id` *(Mã AnyDesk để hỗ trợ điều khiển từ xa)*
  3. `project` *(Tên cụm / dự án / địa bàn quản lý)*
  4. `status` *(Trạng thái: `online`, `offline`, `busy`, `new`)*
  5. `last_seen` *(Thời gian gửi xung nhịp gần nhất - ISO 8601)*
  6. `app_version` *(Phiên bản Android Agent đang chạy)*
  7. `storage_mb` *(Dung lượng bộ nhớ trống MB)*
  8. `task_id` *(Nhiệm vụ đang thực thi nếu có)*
  9. `notes` *(Ghi chú bổ sung)*

### Sheet 2: `Tasks`
Hàng đợi các nhiệm vụ cần thực thi trên thiết bị (cài đặt ứng dụng, cập nhật, chạy script...).
- **Tên Sheet:** `Tasks`
- **Các cột (Row 1):**
  1. `task_id` *(Mã nhiệm vụ duy nhất, ví dụ: `TASK_1730850000000_123`)*
  2. `template_name` *(Tên kịch bản cần chạy)*
  3. `target_mac` *(Địa chỉ MAC của thiết bị nhận nhiệm vụ)*
  4. `status` *(Trạng thái: `pending`, `claimed`, `completed`, `failed`)*
  5. `created_at` *(Thời điểm tạo nhiệm vụ)*
  6. `claimed_at` *(Thời điểm box xác nhận nhận nhiệm vụ)*
  7. `completed_at` *(Thời điểm hoàn tất)*
  8. `result` *(Kết quả hoặc chi tiết lỗi trả về từ box)*

### Sheet 3: `Templates`
Lưu trữ các kịch bản mẫu (các bước thao tác JSON) để tái sử dụng.
- **Tên Sheet:** `Templates`
- **Các cột (Row 1):**
  1. `template_name` *(Tên mẫu kịch bản, ví dụ: `INSTALL_RADIO_APP_V2`)*
  2. `steps_json` *(Chuỗi JSON mô tả các bước thực thi)*
  3. `description` *(Mô tả mục đích kịch bản)*
  4. `created_by` *(Người tạo)*
  5. `created_at` *(Thời điểm tạo)*

### Sheet 4: `Heartbeat`
Nhật ký kiểm tra xung nhịp định kỳ (mỗi 5 phút) từ các box ngoài trụ điện.
- **Tên Sheet:** `Heartbeat`
- **Các cột (Row 1):**
  1. `mac` *(Địa chỉ MAC thiết bị)*
  2. `timestamp` *(Thời điểm gửi xung nhịp)*
  3. `ram_mb` *(RAM trống hoặc RAM hệ thống MB)*
  4. `storage_mb` *(Bộ nhớ lưu trữ trống MB)*
  5. `current_task` *(Task đang chạy nếu có)*
  6. `app_version` *(Phiên bản ứng dụng agent)*
  7. `ip` *(Địa chỉ IP 4G hoặc mạng nội bộ)*

> **Mẹo tạo nhanh:** Trong file `Code.gs` đã tích hợp sẵn hàm `setupSheets()`. Bạn chỉ cần dán code vào Apps Script rồi bấm **Run** hàm `setupSheets()` là toàn bộ 4 sheet trên cùng định dạng in đậm, tô màu tiêu đề sẽ được tự động tạo ngay lập tức mà không cần gõ tay!

---

## 2. Mở Google Apps Script Editor

1. Trên giao diện Google Spreadsheet vừa tạo, nhìn lên thanh menu trên cùng.
2. Chọn **Tiện ích mở rộng (Extensions)** → **Apps Script**.
3. Tab trình biên dịch Google Apps Script sẽ được mở ra.

---

## 3. Cài đặt mã nguồn `Code.gs`

1. Tại khung soạn thảo code bên trái, nhấp vào file `Code.gs` (nếu chưa có thì bấm dấu `+` chọn Script).
2. Xóa toàn bộ nội dung mặc định (`function myFunction() { ... }`).
3. Mở file `d:\Code\AndroidProject\backend\Code.gs` trên máy tính, copy toàn bộ nội dung và dán vào Apps Script Editor.
4. **Lưu ý biến `SPREADSHEET_ID`:**
   - Nếu bạn mở Apps Script trực tiếp từ menu Google Sheet như Bước 2, script đã được gắn kèm (bound script) → bạn hãy để nguyên `var SPREADSHEET_ID = "";`.
   - Nếu bạn tạo Standalone Apps Script từ Google Drive, hãy lấy ID từ URL của Sheet:
     `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit` và dán vào:
     ```javascript
     var SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE";
     ```
5. Nhấn tổ hợp phím **Ctrl + S** (hoặc biểu tượng đĩa mềm 💾) để lưu script.
6. *(Tùy chọn tiện ích)*: Trên thanh công cụ, chọn hàm `setupSheets` trong danh sách dropdown và nhấn nút **Run** (Chạy). Khi hộp thoại yêu cầu cấp quyền hiện ra, chọn **Review Permissions** → Chọn tài khoản của bạn → **Advanced** → **Go to Untitled project (unsafe)** → **Allow**. Cả 4 Sheet sẽ được tạo tự động chuẩn 100%.

---

## 4. Triển khai (Deploy) Web App

Để Android Agent và PC App có thể gửi nhận HTTP request, bạn cần triển khai Script dưới dạng Web App:

1. Bấm vào nút màu xanh **Deploy (Triển khai)** ở góc trên bên phải → chọn **New deployment (Triển khai mới)**.
2. Ở mục "Select type (Chọn loại)", bấm biểu tượng bánh răng ⚙️ và chọn **Web App (Ứng dụng web)**.
3. Thiết lập các thông số chính xác như sau:
   - **Description (Mô tả):** `Radio Device Manager API v1`
   - **Execute as (Thực thi dưới dạng):** `Me (your_email@gmail.com)` *(Đảm bảo script chạy với quyền của bạn để có quyền đọc/ghi vào Sheet)*
   - **Who has access (Ai có quyền truy cập):** `Anyone (Bất kỳ ai)` *(Bắt buộc chọn Anyone để thiết bị Android ngoài trụ và PC App gọi được không cần đăng nhập Google OAuth)*
4. Nhấn nút **Deploy (Triển khai)**.
5. Nếu đây là lần deploy đầu tiên, Google sẽ yêu cầu ủy quyền (Authorize Access). Bạn thực hiện ủy quyền tương tự như bước trên.
6. Sau khi hoàn tất, hệ thống sẽ cấp một đường dẫn **Web App URL**, có định dạng:
   ```text
   https://script.google.com/macros/s/AKfycbx.../exec
   ```
7. Bấm **Copy** để lưu lại URL này.

> **QUAN TRỌNG KHI CẬP NHẬT CODE:**  
> Mỗi lần sửa đổi code trong `Code.gs`, để thay đổi có hiệu lực ra bên ngoài, bạn PHẢI:  
> Bấm **Deploy** → **Manage deployments** → Chọn deployment hiện tại → Bấm biểu tượng cây bút (Edit) → Tại mục **Version**, chọn **New version (Phiên bản mới)** → Bấm **Deploy**. (Nếu không tạo New version, Google vẫn giữ nguyên code phiên bản cũ).

---

## 5. Điền Web App URL vào các thành phần hệ thống

### 5.1. Cấu hình trong Android Agent
Trong mã nguồn Android Agent (ví dụ file `Constants.java` hoặc `app.properties`):
```java
package com.radio.agent;

public class Constants {
    // URL Web App Google Apps Script
    public static final String BACKEND_URL = "https://script.google.com/macros/s/AKfycbx.../exec";
    
    // Tần suất gửi heartbeat (5 phút)
    public static final long HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
}
```

### 5.2. Cấu hình trong PC Management App
Trong file cấu hình (ví dụ `config.json` hoặc màn hình Settings của PC App):
```json
{
  "backend_url": "https://script.google.com/macros/s/AKfycbx.../exec",
  "request_timeout_seconds": 30
}
```

---

## 6. Kiểm tra nhanh (Quick Test Plan) với cURL

> **LƯU Ý CỰC KỲ QUAN TRỌNG VỚI CURL:**  
> Google Apps Script Web App luôn phản hồi bằng mã `HTTP 302 Found` (Redirect) đến máy chủ CDN `script.googleusercontent.com`. Do đó khi dùng `curl`, **BẮT BUỘC** phải có cờ `-L` (hoặc `--location`) để theo đường dẫn chuyển hướng!

Thay thế `<WEB_APP_URL>` bằng URL Web App bạn vừa copy ở Bước 4:

### 6.1. Test Ping kiểm tra dịch vụ sẵn sàng (GET)
```bash
curl -L -X GET "<WEB_APP_URL>"
```
**Kết quả mong đợi:**
```json
{"status":"ok","message":"Radio Device Manager Backend API is online","timestamp":"2026-11-06T..."}
```

---

### 6.2. Test Đăng ký thiết bị (action=register_device)
```bash
curl -L -X POST "<WEB_APP_URL>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "register_device",
    "mac": "00:1A:2B:3C:4D:5E",
    "anydesk_id": "987654321",
    "project": "Cum_Tru_Dien_01"
  }'
```
**Kết quả mong đợi:**
```json
{"status":"ok","is_new":true}
```

---

### 6.3. Test Gửi Heartbeat định kỳ (action=heartbeat)
Mô phỏng Android box gửi thông tin tài nguyên và nhận nhiệm vụ mới:
```bash
curl -L -X POST "<WEB_APP_URL>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "heartbeat",
    "mac": "00:1A:2B:3C:4D:5E",
    "anydesk_id": "987654321",
    "ram_mb": 1024,
    "storage_mb": 4096,
    "current_task": "",
    "app_version": "1.0.0",
    "ip": "100.85.12.34"
  }'
```
**Kết quả mong đợi (khi chưa có task nào):**
```json
{"status":"ok","pending_task":null}
```

---

### 6.4. Test Lưu Template kịch bản (action=save_template)
```bash
curl -L -X POST "<WEB_APP_URL>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "save_template",
    "template_name": "INSTALL_APP_RADIO_V1",
    "description": "Kịch bản cài đặt tự động app radio",
    "created_by": "admin",
    "steps_json": [
      {"step": 1, "action": "download", "url": "https://example.com/app.apk"},
      {"step": 2, "action": "install", "path": "/sdcard/app.apk"},
      {"step": 3, "action": "start_service", "service": "com.radio.app/.RadioService"}
    ]
  }'
```
**Kết quả mong đợi:**
```json
{"status":"ok"}
```

---

### 6.5. Test Tạo nhiệm vụ cho thiết bị (action=create_task)
```bash
curl -L -X POST "<WEB_APP_URL>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create_task",
    "template_name": "INSTALL_APP_RADIO_V1",
    "target_macs": ["00:1A:2B:3C:4D:5E"]
  }'
```
**Kết quả mong đợi:**
```json
{"status":"ok","task_ids":["TASK_..."]}
```

---

### 6.6. Test Nhận task khi Heartbeat lại
Gửi lại heartbeat với MAC `00:1A:2B:3C:4D:5E`:
```bash
curl -L -X POST "<WEB_APP_URL>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "heartbeat",
    "mac": "00:1A:2B:3C:4D:5E",
    "anydesk_id": "987654321",
    "ram_mb": 1024,
    "storage_mb": 4096,
    "current_task": "",
    "app_version": "1.0.0",
    "ip": "100.85.12.34"
  }'
```
**Kết quả mong đợi:**
```json
{
  "status": "ok",
  "pending_task": {
    "task_id": "TASK_...",
    "template_name": "INSTALL_APP_RADIO_V1",
    "steps_json": "[{\"step\":1,...}]"
  }
}
```

---

### 6.7. Test Nhận quyền thực thi task (action=claim_task)
```bash
curl -L -X POST "<WEB_APP_URL>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "claim_task",
    "task_id": "TASK_...",
    "mac": "00:1A:2B:3C:4D:5E"
  }'
```
**Kết quả mong đợi:**
```json
{"status":"ok"}
```
*(Nếu gọi lại lần 2 với cùng `task_id`, sẽ trả về `{"status":"already_claimed"}` để chống race condition).*

---

### 6.8. Test Báo cáo hoàn thành task (action=complete_task)
```bash
curl -L -X POST "<WEB_APP_URL>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "complete_task",
    "task_id": "TASK_...",
    "mac": "00:1A:2B:3C:4D:5E",
    "success": true,
    "result": "Cài đặt ứng dụng thành công, RadioService đã khởi động."
  }'
```
**Kết quả mong đợi:**
```json
{"status":"ok"}
```

---

### 6.9. Test Lấy dữ liệu trên PC App (GET)
```bash
# Lấy danh sách thiết bị
curl -L -X GET "<WEB_APP_URL>?action=get_devices"

# Lấy danh sách template
curl -L -X GET "<WEB_APP_URL>?action=get_templates"

# Lấy 50 task gần nhất
curl -L -X GET "<WEB_APP_URL>?action=get_tasks"

# Lấy task của một MAC cụ thể
curl -L -X GET "<WEB_APP_URL>?action=get_tasks&mac=00:1A:2B:3C:4D:5E"
```
