# HỆ THỐNG QUẢN LÝ THIẾT BỊ TRUYỀN THANH THÔNG MINH (SGL // RADIO DEVICE MANAGER)

Hệ thống quản lý hàng loạt thiết bị Android Box truyền thanh thông minh ngoài thực địa (treo trụ điện, kết nối SIM 4G), hỗ trợ cài đặt tự động giai đoạn 1 qua mạng LAN và điều khiển / nâng cấp / chốt dự án từ xa thông qua Google Sheet mà không cần can thiệp thủ công qua AnyDesk.

---

## 🏗️ CẤU TRÚC HỆ THỐNG

Dự án gồm 3 phân hệ chính:

```
Android-Management/
├── main.py                     # Entry point khởi động ứng dụng PC Management
├── sgl_manager/                # Module lõi PC App (Python + Tkinter)
│   ├── config.py               # Cấu hình Webhook, IP, Theme Matrix
│   ├── webhook.py              # HTTP client giao tiếp với Google Apps Script Web App
│   ├── adb_engine.py           # Bộ máy giao tiếp ADB LAN & Root shell
│   ├── ui_stage1.py            # Tab 1: Cài tự động mạch mới tại kho qua LAN
│   ├── ui_dashboard.py         # Tab 2: Dashboard giám sát nhịp tim (Heartbeat) thực địa
│   ├── ui_stage2.py            # Tab 3: Chốt dự án từ xa hàng loạt (Radio 1.66 / ICS / 3.6)
│   └── ui_task_builder.py      # Tab 4: Soạn thảo kịch bản nâng cấp code từ xa (JSON)
├── backend/                    # Google Apps Script Webhook (Middleware & Database)
│   ├── Code.gs                 # Mã nguồn backend xử lý 4 Sheet (Devices, Tasks, Templates, Heartbeat)
│   └── setup_instructions.md   # Hướng dẫn chi tiết tạo Sheet và Deploy Web App
├── android_agent/              # Mã nguồn Android App Agent (00_AutoSetup)
│   ├── app/src/main/java/com/sgl/autosetup/
│   │   ├── AgentService.java   # Foreground Service chạy ngầm bất tử gửi heartbeat mỗi 5 phút
│   │   ├── BootReceiver.java   # Tự khởi động ngầm ngay khi cắm nguồn box ngoài trụ điện
│   │   ├── TaskExecutor.java   # Thực thi kịch bản (Tải APK, cài APK root, gỡ app, chạy shell)
│   │   ├── WebhookClient.java  # HTTP client OkHttp3 gửi nhận lệnh với Google Sheet
│   │   ├── DeviceInfo.java     # Trích xuất MAC (không dấu :), RAM, bộ nhớ trống, IP
│   │   └── MainActivity.java   # Giao diện cài đặt GĐ1/GĐ2 tại bàn kỹ thuật
│   └── build.gradle.kts
└── docs/                       # Tài liệu hướng dẫn vận hành chuẩn
    ├── HUONG_DAN_SU_DUNG_SOP.md
    └── THIET_KE_KIEN_TRUC.md
```

---

## 🚀 TÍNH NĂNG NỔI BẬT

1. **Giai đoạn 1 (Cài tại kho qua LAN):**
   - Tự động quét IP qua cổng 5555.
   - Tự động nạp 4 APK: `00_AutoSetup`, `02_anydesk`, `03_adcontrol-aosp`, `04_Audio_3.6`.
   - Tự cấp quyền Root & Accessibility cho AnyDesk / ADControl.
   - Tự nạp cấu hình mật khẩu AnyDesk nội bộ (không cần gõ tay).
   - Tự đồng bộ giờ GMT+7 Asia/Bangkok và đăng nhập tài khoản test âm thanh.
   - Tự động đẩy AnyDesk ID và địa chỉ MAC (VIẾT HOA TOÀN BỘ, không dấu `:`) lên Google Sheet.

2. **Giám sát thực địa (Dashboard Tab 2):**
   - Theo dõi trạng thái Online/Offline theo thời gian thực qua sóng 4G.
   - Xem AnyDesk ID, MAC, RAM, dung lượng trống, thời gian ping cuối.
   - Mở AnyDesk 1-click trực tiếp từ Dashboard.

3. **Giai đoạn 2 (Chốt dự án từ xa hàng loạt Tab 3):**
   - Tích chọn hàng loạt thiết bị (10 - 100 box cùng lúc).
   - Chọn kịch bản: `deploy_radio_166`, `deploy_vnpt_ics`, `deploy_radio_36` hoặc kịch bản mới.
   - Bấm nút triển khai: Các box ngoài trụ điện tự nhận lệnh qua 4G, tự tải APK, tự cài đặt và đổi dự án mà không cần mở AnyDesk thao tác tay.

4. **Nâng cấp code & Tác vụ ngẫu nhiên từ xa (Task Builder Tab 4):**
   - Soạn thảo chuỗi hành động JSON: `download_apk`, `install_apk`, `uninstall_pkg`, `shell_cmd`, `report_field`.
   - Lưu trực tiếp lên Google Sheet để đồng bộ cho toàn bộ hệ thống.

---

## 🛠️ HƯỚNG DẪN KHỞI CHẠY

### 1. Khởi chạy PC Management App
Yêu cầu Python 3.8+ (chỉ sử dụng thư viện tiêu chuẩn Tkinter, không cần cài đặt thêm pip package ngoài):
```powershell
python main.py
```

### 2. Xem quy trình vận hành chi tiết
Đọc file [HUONG_DAN_SU_DUNG_SOP.md](docs/HUONG_DAN_SU_DUNG_SOP.md) trong thư mục `docs/`.
