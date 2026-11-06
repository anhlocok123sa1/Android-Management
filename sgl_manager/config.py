import os
import re
import shutil
import subprocess

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# URL Google Apps Script Web App
# Thay đổi URL này thành Web App URL mới sau khi deploy backend/Code.gs
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxqawYpW8SebK0EK21Cl7C2uw6vN3-Jr7vQIHSAbNxtwXA5H7c_lYRNhXuB7104P0NN/exec"

# Cổng kết nối ADB qua mạng LAN
ADB_PORT = 5555

# Mật khẩu AnyDesk mặc định cho thiết bị
DEFAULT_ANYDESK_PASS = "12345678j"

# Tên các file APK tiêu chuẩn
APK_AUTOSETUP = "00_AutoSetup.apk"
APK_ANYDESK = "02_anydesk.apk"
APK_ADCONTROL = "03_adcontrol-aosp.apk"
APK_RADIO_36 = "04_Audio_3.6_productionRelease.apk"
APK_RADIO_166 = "radio.apk"
APK_ICS = "ics-android-box (2.0.0).apk"
LOCAL_BACKUP_DIR = "/sdcard/SGL_Backup_Apks"

# File log debug cho ADB và hệ thống
DEBUG_LOG_FILE = os.path.join(BASE_DIR, "lan_install_debug.log")

# Bảng màu Hacker Cyber-Ops Matrix Theme
BG_MAIN = "#030704"
BG_PANEL = "#07110A"
BG_INPUT = "#020503"
BG_TABLE = "#050C07"
FG_MATRIX = "#00FF41"
FG_CYAN = "#00F0FF"
FG_AMBER = "#FFB300"
FG_RED = "#FF1744"
FG_DIM = "#4E7A5B"
FG_TEXT = "#C8F7D2"
BORDER_NEON = "#008F24"

def get_anydesk_exe():
    """Tìm đường dẫn file AnyDesk.exe trên hệ thống Windows."""
    paths = [
        os.path.expandvars(r"%ProgramFiles(x86)%\AnyDesk\AnyDesk.exe"),
        os.path.expandvars(r"%ProgramFiles%\AnyDesk\AnyDesk.exe"),
        os.path.expandvars(r"%LocalAppData%\AnyDesk\AnyDesk.exe"),
        os.path.expandvars(r"%AppData%\AnyDesk\AnyDesk.exe"),
        "anydesk"
    ]
    for p in paths:
        if os.path.isfile(p):
            return p
    if shutil.which("anydesk"):
        return "anydesk"
    return None

def open_anydesk_session(ad_id: str, password: str = DEFAULT_ANYDESK_PASS, clipboard_fn=None):
    """
    Khởi chạy AnyDesk kết nối tới remote ID và tự động nạp mật khẩu unattended access qua pipe (--with-password).
    Đồng thời sao chép mật khẩu vào Clipboard dự phòng.
    """
    if not ad_id or "Chưa" in str(ad_id) or "KHONG" in str(ad_id):
        return False, "Thiết bị này chưa có AnyDesk ID!"
    
    clean_id = re.sub(r"\D", "", str(ad_id))
    if not clean_id:
        return False, "Mã AnyDesk ID không hợp lệ!"

    # Sao chép sẵn mật khẩu vào Clipboard để người dùng có thể Ctrl+V bất cứ lúc nào
    if clipboard_fn:
        try:
            clipboard_fn(password)
        except Exception:
            pass

    exe = get_anydesk_exe()
    if not exe:
        return False, f"Không tìm thấy file AnyDesk.exe trên máy tính.\nĐã sao chép mật khẩu ({password}) vào Clipboard."

    CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
    cmd = f'echo {password}| "{exe}" {clean_id} --with-password'
    try:
        subprocess.Popen(
            cmd,
            shell=True,
            creationflags=CREATE_NO_WINDOW
        )
        return True, f"Đang kết nối AnyDesk ID: {clean_id} (Đã tự động nạp mật khẩu: {password})"
    except Exception as e:
        return False, f"Lỗi khởi chạy AnyDesk: {e}"
