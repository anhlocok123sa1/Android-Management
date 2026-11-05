import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# URL Google Apps Script Web App
# Thay đổi URL này thành Web App URL mới sau khi deploy backend/Code.gs
WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxqawYpW8SebK0EK21Cl7C2uw6vN3-Jr7vQIHSAbNxtwXA5H7c_lYRNhXuB7104P0NN/exec"

# Cổng kết nối ADB qua mạng LAN
ADB_PORT = 5555

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
