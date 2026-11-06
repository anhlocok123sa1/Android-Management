import os
import re
import socket
import subprocess
import threading
import time
import json
import shutil
import traceback
import urllib.request
from .config import (
    BASE_DIR, ADB_PORT, DEBUG_LOG_FILE,
    APK_AUTOSETUP, APK_ANYDESK, APK_ADCONTROL, APK_RADIO_36,
    APK_RADIO_166, APK_ICS, LOCAL_BACKUP_DIR
)

# Cố định thư mục làm việc tại BASE_DIR
os.chdir(BASE_DIR)

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
log_lock = threading.Lock()

class AdbEngine:
    def __init__(self, adb_bin=None, webhook_client=None, log_callback=None):
        self.adb_bin = adb_bin or (
            os.path.join(BASE_DIR, "adb.exe")
            if os.path.isfile(os.path.join(BASE_DIR, "adb.exe"))
            else "adb"
        )
        self.webhook = webhook_client
        self.log_cb = log_callback or (lambda msg: None)

        # Khởi động ADB Server
        threading.Thread(
            target=lambda: subprocess.run(
                [self.adb_bin, "start-server"],
                capture_output=True,
                cwd=BASE_DIR,
                creationflags=CREATE_NO_WINDOW,
            ),
            daemon=True,
        ).start()

    def write_debug(self, text):
        with log_lock:
            try:
                with open(DEBUG_LOG_FILE, "a", encoding="utf-8") as f:
                    ts = time.strftime("%Y-%m-%d %H:%M:%S")
                    f.write(f"[{ts}] {text}\n")
            except Exception:
                pass

    def log(self, msg):
        self.write_debug(f"[ENGINE_LOG] {msg}")
        self.log_cb(msg)

    def get_apk_full_path(self, apk_filename):
        """
        Tìm và trả về đường dẫn tuyệt đối chuẩn xác của file APK.
        Nếu thiếu 00_AutoSetup.apk, tự động đồng bộ từ bản build của AutoSetup sang.
        """
        # 1. Thử trực tiếp tại BASE_DIR
        candidate = os.path.join(BASE_DIR, os.path.basename(apk_filename))
        if os.path.isfile(candidate):
            return candidate

        # 2. Thử đường dẫn truyền vào nếu là tuyệt đối
        if os.path.isabs(apk_filename) and os.path.isfile(apk_filename):
            return apk_filename

        # 3. Fallback đặc biệt cho 00_AutoSetup.apk nếu vừa build xong
        if "autosetup" in apk_filename.lower():
            build_apk = r"D:\Code\AutoSetup\app\build\outputs\apk\debug\app-debug.apk"
            if os.path.isfile(build_apk):
                try:
                    shutil.copyfile(build_apk, candidate)
                    self.log(f"✔ Đã tự động sao chép APK mới build sang: {candidate}")
                    return candidate
                except Exception as e:
                    self.write_debug(f"Loi copy build_apk: {e}")
                    return build_apk

        # 4. Tìm kiếm đệm ở thư mục cha nếu có
        parent_candidate = os.path.join(os.path.dirname(BASE_DIR), os.path.basename(apk_filename))
        if os.path.isfile(parent_candidate):
            return parent_candidate

        return candidate

    def ensure_device_online(self, ip):
        target = f"{ip}:{ADB_PORT}"
        for attempt in range(1, 4):
            res = subprocess.run(
                [self.adb_bin, "devices", "-l"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                cwd=BASE_DIR,
                creationflags=CREATE_NO_WINDOW,
            )
            out = res.stdout or ""
            self.write_debug(f"[{ip}] ensure_device_online (try {attempt}):\n{out.strip()}")

            if re.search(rf"{re.escape(target)}\s+device\b", out):
                return True

            if target in out:
                r_rec = subprocess.run(
                    [self.adb_bin, "-s", target, "reconnect"],
                    capture_output=True,
                    text=True,
                    timeout=6,
                    cwd=BASE_DIR,
                    creationflags=CREATE_NO_WINDOW,
                )
                self.write_debug(f"[{ip}] adb reconnect: {r_rec.stdout} {r_rec.stderr}")
                time.sleep(1.2)
                res2 = subprocess.run(
                    [self.adb_bin, "devices"],
                    capture_output=True,
                    text=True,
                    cwd=BASE_DIR,
                    creationflags=CREATE_NO_WINDOW,
                )
                if re.search(rf"{re.escape(target)}\s+device\b", res2.stdout or ""):
                    return True

            subprocess.run(
                [self.adb_bin, "disconnect", target],
                capture_output=True,
                text=True,
                timeout=5,
                cwd=BASE_DIR,
                creationflags=CREATE_NO_WINDOW,
            )
            time.sleep(0.5)
            subprocess.run(
                [self.adb_bin, "connect", target],
                capture_output=True,
                text=True,
                timeout=6,
                cwd=BASE_DIR,
                creationflags=CREATE_NO_WINDOW,
            )
            time.sleep(1.2)
        return False

    def run_adb(self, ip, args_list, timeout=60, step_name="ADB_CMD"):
        target = f"{ip}:{ADB_PORT}"
        for attempt in range(1, 3):
            self.ensure_device_online(ip)
            cmd = [self.adb_bin, "-s", target] + args_list
            t0 = time.time()
            try:
                res = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=timeout,
                    cwd=BASE_DIR,
                    creationflags=CREATE_NO_WINDOW,
                )
                elapsed = time.time() - t0
                out = ((res.stdout or "") + "\n" + (res.stderr or "")).strip()
                self.write_debug(
                    f"[{ip}] [{step_name}] (try {attempt}, {elapsed:.2f}s, rc={res.returncode}) CMD: {' '.join(cmd)}\n"
                    f"   -> OUTPUT: {out}"
                )
                if (
                    "device offline" in out
                    or "device not found" in out
                    or "Error: closed" in out
                    or "protocol fault" in out
                ) and attempt == 1:
                    self.log(f"🔄 [{ip}] ADB báo '{out[:60]}', đang khôi phục kết nối...")
                    subprocess.run(
                        [self.adb_bin, "disconnect", target],
                        capture_output=True,
                        cwd=BASE_DIR,
                        creationflags=CREATE_NO_WINDOW,
                    )
                    time.sleep(0.8)
                    subprocess.run(
                        [self.adb_bin, "connect", target],
                        capture_output=True,
                        cwd=BASE_DIR,
                        creationflags=CREATE_NO_WINDOW,
                    )
                    time.sleep(1.2)
                    continue
                return out
            except Exception as e:
                self.write_debug(f"[{ip}] [{step_name}] EXCEPTION (try {attempt}): {e}\n{traceback.format_exc()}")
                if attempt == 1:
                    time.sleep(1.0)
                    continue
                return f"ERR: {e}"
        return "ERR: device offline"

    def run_adb_root(self, ip, shell_cmd, timeout=60, step_name="ROOT_CMD"):
        target = f"{ip}:{ADB_PORT}"
        self.ensure_device_online(ip)
        script = (
            'if [ "$(id -u)" = "0" ]; then\n'
            "  if command -v nsenter >/dev/null 2>&1; then\n"
            "    nsenter -t 1 -m -- /system/bin/sh << 'EOF_SGL_ROOT'\n"
            f"{shell_cmd}\n"
            "EOF_SGL_ROOT\n"
            "  else\n"
            f"{shell_cmd}\n"
            "  fi\n"
            "else\n"
            "  su << 'EOF_SGL_SU'\n"
            "if command -v nsenter >/dev/null 2>&1; then\n"
            "  nsenter -t 1 -m -- /system/bin/sh << 'EOF_SGL_NS'\n"
            f"{shell_cmd}\n"
            "EOF_SGL_NS\n"
            "else\n"
            f"{shell_cmd}\n"
            "fi\n"
            "exit\n"
            "EOF_SGL_SU\n"
            "fi\n"
            "exit\n"
        )
        t0 = time.time()
        try:
            res = subprocess.run(
                [self.adb_bin, "-s", target, "shell"],
                input=script,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                cwd=BASE_DIR,
                creationflags=CREATE_NO_WINDOW,
            )
            elapsed = time.time() - t0
            out = ((res.stdout or "") + "\n" + (res.stderr or "")).strip()
            self.write_debug(
                f"[{ip}] [{step_name}] ({elapsed:.2f}s, rc={res.returncode}) SCRIPT:\n{shell_cmd}\n"
                f"   -> OUTPUT: {out}"
            )
            return out
        except Exception as e:
            self.write_debug(f"[{ip}] [{step_name}] EXCEPTION: {e}\n{traceback.format_exc()}")
            return f"ERR: {e}"

    def collect_device_diagnostics(self, ip, reason=""):
        self.write_debug(f"\n--- CHAN DOAN CHO MACH [{ip}] (Ly do: {reason}) ---")
        diag_cmd = (
            "echo '=== ID & WHOAMI ===' ; id ; "
            "echo '=== DEVICE PROPS ===' ; getprop ro.product.model ; getprop ro.build.version.release ; "
            "echo '=== DISK SPACE ===' ; df -h /data /data/local/tmp /sdcard 2>&1 ; "
            "echo '=== PACKAGES ===' ; pm list packages | grep -iE 'sgl|anydesk|radio|audio|ics' 2>&1"
        )
        out = self.run_adb_root(ip, diag_cmd, timeout=25, step_name="DIAGNOSTICS")
        self.write_debug(f"--- KET QUA CHAN DOAN [{ip}] ---\n{out}\n------------------------\n")

    def install_apk_safe(self, ip, apk_filename, timeout=180):
        # Lấy đường dẫn tuyệt đối đầy đủ và đảm bảo file tồn tại
        full_apk_path = self.get_apk_full_path(apk_filename)
        if not os.path.isfile(full_apk_path):
            err_msg = f"Không tìm thấy file APK trên PC: {full_apk_path}"
            self.log(f"❌ [{ip}] {err_msg}")
            return err_msg

        remote_tmp = f"/data/local/tmp/sgl_tmp_{ip.split('.')[-1]}.apk"
        self.write_debug(f"[{ip}] === CAI APK: {full_apk_path} ===")

        self.run_adb(ip, ["shell", f"rm -f {remote_tmp}"], timeout=10, step_name="CLEAN_TMP")

        # 1. Push + pm install Root
        push_res = self.run_adb(ip, ["push", full_apk_path, remote_tmp], timeout=timeout, step_name=f"PUSH_{os.path.basename(apk_filename)}")
        if "error:" not in push_res.lower() and "offline" not in push_res.lower():
            install_cmd = f"chmod 644 {remote_tmp} ; pm install -r -g {remote_tmp} 2>&1 ; rm -f {remote_tmp}"
            res_root = self.run_adb_root(ip, install_cmd, timeout=timeout, step_name=f"PM_INSTALL_ROOT_{os.path.basename(apk_filename)}")
            if "Success" in res_root:
                return res_root

            # 2. pm install Shell thường
            self.run_adb(ip, ["push", full_apk_path, remote_tmp], timeout=timeout, step_name=f"RE_PUSH_{os.path.basename(apk_filename)}")
            res_shell = self.run_adb(ip, ["shell", f"chmod 644 {remote_tmp} ; pm install -r -g {remote_tmp} 2>&1 ; rm -f {remote_tmp}"], timeout=timeout, step_name=f"PM_INSTALL_SHELL_{os.path.basename(apk_filename)}")
            if "Success" in res_shell:
                return res_shell
        else:
            res_root = f"Push that bai: {push_res}"
            res_shell = ""

        # 3. adb install trực tiếp với đường dẫn tuyệt đối
        res_no_stream = self.run_adb(ip, ["install", "--no-streaming", "-r", "-g", full_apk_path], timeout=timeout, step_name=f"ADB_INSTALL_{os.path.basename(apk_filename)}")
        if "Success" in res_no_stream:
            return res_no_stream

        combined_err = f"Root: {res_root} | Shell: {res_shell} | NoStream: {res_no_stream}"
        self.collect_device_diagnostics(ip, reason=f"Loi cai {apk_filename}: {combined_err}")
        return combined_err

    def read_mac_address(self, ip):
        cmd = (
            "cat /sys/class/net/eth0/address 2>/dev/null ; "
            "cat /sys/class/net/wlan0/address 2>/dev/null ; "
            "ip link show eth0 2>/dev/null ; "
            "ifconfig eth0 2>/dev/null ; "
            "getprop ro.boot.mac 2>/dev/null"
        )
        out = self.run_adb(ip, ["shell", cmd], timeout=8, step_name="READ_MAC")
        m = re.search(r"([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})", out)
        if m:
            mac_clean = m.group(1).replace(":", "").upper()
            if mac_clean != "000000000000":
                return mac_clean
        m2 = re.search(r"\b([0-9A-Fa-f]{12})\b", out)
        if m2:
            return m2.group(1).upper()
        return "KHÔNG_RÕ_MAC"

    def read_anydesk_id(self, ip):
        cmd = (
            "for base in "
            "/data_mirror/data_de/null/0/com.anydesk.anydeskandroid "
            "/data_mirror/data_ce/null/0/com.anydesk.anydeskandroid "
            "/data/user_de/0/com.anydesk.anydeskandroid "
            "/data/user/0/com.anydesk.anydeskandroid "
            "/data/data/com.anydesk.anydeskandroid; do "
            '  for f in "$base/files/.anydesk/system.conf" "$base/files/.anydesk/service.conf" "$base/files/system.conf"; do '
            '    if [ -f "$f" ]; then '
            "      grep 'ad.anynet.id=' \"$f\" 2>/dev/null | head -n 1 ; "
            "    fi; "
            "  done; "
            "done 2>/dev/null"
        )
        out = self.run_adb_root(ip, cmd, timeout=8, step_name="READ_ANYDESK_ID")
        m = re.search(r"ad\.anynet\.id=(\d{7,12})", out)
        if m:
            return m.group(1)
        return ""

    def check_anydesk_installed(self, ip):
        pkg_out = self.run_adb(ip, ["shell", "pm list packages com.anydesk.anydeskandroid 2>/dev/null"], timeout=8, step_name="CHECK_ANYDESK_PKG")
        has_pkg = "package:com.anydesk.anydeskandroid" in pkg_out
        ad_id = self.read_anydesk_id(ip)
        if has_pkg or bool(ad_id):
            return True, (ad_id if ad_id else "Đã cài APK")
        return False, ""

    def install_stage1_flow(self, ip, radio_user, radio_pass, copy_backup, status_cb=None):
        def upd(msg, state="running"):
            if status_cb:
                status_cb(msg, state)

        self.write_debug(f"\n==================== BAT DAU CAI DAT MACH [{ip}] ====================")
        mac = self.read_mac_address(ip)

        # 1. Cài APK
        apks = [APK_AUTOSETUP, APK_ANYDESK, APK_ADCONTROL, APK_RADIO_36]
        for idx, apk in enumerate(apks, start=1):
            upd(f"⏳ [1/7] Đang cài APK ({idx}/4): {apk} ...")
            res = self.install_apk_safe(ip, apk, timeout=180)
            if "Success" not in res:
                self.log(f"❌ [{ip}] Lỗi cài {apk}: {res[:80]}")
                upd(f"❌ Lỗi cài {apk}: {res[:80]}", "error")
                return False, mac, ""

        # Tạm đóng Radio
        self.run_adb_root(ip, "am force-stop com.radiostation", step_name="STOP_RADIO")

        # 2. Chép bộ cài dự phòng
        if copy_backup:
            upd("⏳ [2/7] Đang chép bộ cài dự phòng vào mạch...")
            self.run_adb_root(ip, f"mkdir -p {LOCAL_BACKUP_DIR}", step_name="MKDIR_BACKUP")
            for b_apk in [APK_RADIO_36, APK_RADIO_166, APK_ICS]:
                full_b_path = self.get_apk_full_path(b_apk)
                if os.path.isfile(full_b_path):
                    self.run_adb(ip, ["push", full_b_path, f"{LOCAL_BACKUP_DIR}/{b_apk}"], timeout=180, step_name=f"PUSH_{b_apk}")

        # 3. Cấp quyền AnyDesk
        upd("⏳ [3/7] Cấp quyền Root & hệ thống cho AnyDesk...")
        perm_cmd = (
            "appops set com.anydesk.anydeskandroid PROJECT_MEDIA allow ; "
            "appops set com.anydesk.anydeskandroid SYSTEM_ALERT_WINDOW allow ; "
            "settings put secure enabled_accessibility_services com.anydesk.adcontrol.aosp/com.anydesk.adcontrol.AccService:com.anydesk.adcontrol.ad1/com.anydesk.adcontrol.AccService ; "
            "settings put secure accessibility_enabled 1"
        )
        self.run_adb_root(ip, perm_cmd, step_name="GRANT_PERMS")

        # 4. Khởi tạo AnyDesk
        upd("⏳ [4/7] Khởi tạo mã AnyDesk & nạp cấu hình...")
        self.run_adb_root(ip, "monkey -p com.anydesk.anydeskandroid -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1", step_name="LAUNCH_ANYDESK")
        time.sleep(3)
        anydesk_id = self.read_anydesk_id(ip)

        # 5. Đăng ký lên Sheet / Webhook
        upd("⏳ [5/7] Đang ghi AnyDesk & MAC lên Sheet...")
        self.register_device_data("Android Mới", anydesk_id, mac)

        # 6. Múi giờ GMT+7
        upd("⏳ [6/7] Đặt múi giờ GMT+7 (Asia/Bangkok)...")
        epoch_sec = int(time.time())
        tz_cmd = (
            "settings put global auto_time_zone 0 ; "
            "setprop persist.sys.timezone Asia/Bangkok ; "
            "cmd alarm set-timezone Asia/Bangkok 2>/dev/null ; "
            f"date @{epoch_sec} >/dev/null 2>&1"
        )
        self.run_adb_root(ip, tz_cmd, step_name="SET_TZ")

        # 7. Đăng nhập Radio 3.6
        upd(f"⏳ [7/7] Mở Radio 3.6 & đăng nhập ({radio_user})...")
        self.run_adb_root(ip, "monkey -p com.radiostation -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1", step_name="LAUNCH_RADIO")
        time.sleep(4)

        upd(f"🎉 [PWNED_OK] HOÀN TẤT GĐ1! (AnyDesk: {anydesk_id} | MAC: {mac})", "done")
        self.log(f"✔ [{ip}] Cài đặt GĐ1 thành công -> AnyDesk: {anydesk_id} | MAC: {mac}")
        return True, mac, anydesk_id

    def register_device_data(self, sheet_name, anydesk_id, mac):
        # 1. Ghi CSV cục bộ
        csv_file = os.path.join(BASE_DIR, "Danh_sach_Android_Moi_LAN.csv")
        with log_lock:
            write_header = not os.path.isfile(csv_file)
            with open(csv_file, "a", encoding="utf-8") as f:
                if write_header:
                    f.write("Thoi_Gian,AnyDesk_ID,MAC\n")
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')},{anydesk_id},{mac}\n")

        # 2. Gửi Webhook nếu có
        if self.webhook:
            try:
                self.webhook.register_device(mac, anydesk_id)
            except Exception as e:
                self.log(f"⚠ Lỗi Webhook register_device: {e}")
