import os
import subprocess
import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk

from .config import (
    BG_MAIN, BG_PANEL, BG_INPUT, BG_TABLE,
    FG_MATRIX, FG_CYAN, FG_AMBER, FG_RED, FG_DIM, FG_TEXT, BORDER_NEON,
    DEFAULT_ANYDESK_PASS, APK_AUTOSETUP, BASE_DIR,
    open_anydesk_session, open_anydesk_file_transfer, open_explorer_select_file
)

class OnboarderDialog(tk.Toplevel):
    """
    Cửa sổ Onboard 1-Click: Hỗ trợ nạp 00_AutoSetup.apk và kích hoạt AgentService
    cho các Android Box cũ đang chạy ngoài thực địa (chỉ có AnyDesk).
    """
    def __init__(self, parent, target_device=None, device_list=None, webhook_client=None, on_success_cb=None):
        super().__init__(parent)
        self.title("⚡ SGL // ONBOARD BOX CŨ QUẢN LÝ TỪ XA")
        self.configure(bg=BG_MAIN)
        self.geometry("640x580")
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()

        self.webhook = webhook_client
        self.on_success_cb = on_success_cb
        self.device_list = device_list or []
        self.current_idx = 0

        # Nếu có device_list, tìm index của target_device
        if target_device and self.device_list:
            t_mac = target_device.get("mac", "")
            for i, d in enumerate(self.device_list):
                if d.get("mac") == t_mac:
                    self.current_idx = i
                    break
        elif target_device:
            self.device_list = [target_device]

        self.target = self.device_list[self.current_idx] if self.device_list else (target_device or {})
        self.is_monitoring = True
        self.apk_path = os.path.join(BASE_DIR, APK_AUTOSETUP)

        self.setup_ui()
        self.load_target_data()
        self.start_status_monitor()

    def setup_ui(self):
        # 1. HEADER
        head_frame = tk.Frame(self, bg=BG_PANEL, padx=14, pady=10, highlightthickness=1, highlightbackground=BORDER_NEON)
        head_frame.pack(fill=tk.X, padx=12, pady=(10, 6))

        tk.Label(head_frame, text=">_ CÔNG CỤ ONBOARD BOX CŨ // 1-CLICK ANYDESK TO AGENT",
                 font=("Consolas", 11, "bold"), bg=BG_PANEL, fg=FG_MATRIX).pack(anchor="w")
        tk.Label(head_frame, text="Nạp file AutoSetup.apk & kích hoạt ngầm AgentService cho box ngoài thực địa",
                 font=("Consolas", 9), bg=BG_PANEL, fg=FG_CYAN).pack(anchor="w", pady=(2, 0))

        # 2. THÔNG TIN THIẾT BỊ MỤC TIÊU
        info_frame = tk.LabelFrame(self, text=" [ THÔNG TIN THIẾT BỊ MỤC TIÊU ] ", font=("Consolas", 9, "bold"),
                                   bg=BG_PANEL, fg=FG_AMBER, padx=12, pady=8, highlightthickness=1, highlightbackground="#0E3A1A")
        info_frame.pack(fill=tk.X, padx=12, pady=4)

        row1 = tk.Frame(info_frame, bg=BG_PANEL)
        row1.pack(fill=tk.X, pady=2)
        tk.Label(row1, text="MAC ANDROID:", font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_DIM, width=14, anchor="w").pack(side=tk.LEFT)
        self.lbl_mac = tk.Label(row1, text="--", font=("Consolas", 10, "bold"), bg=BG_INPUT, fg=FG_MATRIX, padx=6)
        self.lbl_mac.pack(side=tk.LEFT, padx=(0, 16))

        tk.Label(row1, text="ANYDESK ID:", font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_DIM, width=12, anchor="w").pack(side=tk.LEFT)
        self.lbl_anydesk = tk.Label(row1, text="--", font=("Consolas", 10, "bold"), bg=BG_INPUT, fg=FG_CYAN, padx=6)
        self.lbl_anydesk.pack(side=tk.LEFT)

        row2 = tk.Frame(info_frame, bg=BG_PANEL)
        row2.pack(fill=tk.X, pady=2)
        tk.Label(row2, text="DỰ ÁN:", font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_DIM, width=14, anchor="w").pack(side=tk.LEFT)
        self.lbl_project = tk.Label(row2, text="--", font=("Consolas", 9), bg=BG_PANEL, fg=FG_TEXT)
        self.lbl_project.pack(side=tk.LEFT, padx=(0, 16))

        tk.Label(row2, text="TRẠNG THÁI:", font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_DIM, width=12, anchor="w").pack(side=tk.LEFT)
        self.lbl_live_status = tk.Label(row2, text="🔴 Offline (Chưa có Agent)", font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_RED)
        self.lbl_live_status.pack(side=tk.LEFT)

        # 3. PHƯƠNG ÁN 1: TỰ ĐỘNG 1-CLICK QUA TCP TUNNEL (KHUYÊN DÙNG)
        m1_frame = tk.LabelFrame(self, text=" [ CÁCH 1: TỰ ĐỘNG 1-CLICK QUA ANYDESK TUNNEL (KHUYÊN DÙNG) ] ",
                                 font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_MATRIX, padx=12, pady=8,
                                 highlightthickness=1, highlightbackground=BORDER_NEON)
        m1_frame.pack(fill=tk.X, padx=12, pady=4)

        tk.Label(m1_frame, text="Cách nhanh nhất: Bật TCP Tunnel trên AnyDesk (Local 5555 -> 127.0.0.1:5555).\nCông cụ sẽ tự động đẩy APK, cài đặt ngầm và khởi chạy Agent trong 5 giây.",
                 font=("Consolas", 8), bg=BG_PANEL, fg=FG_TEXT, justify="left").pack(anchor="w", pady=(0, 6))

        btn_row1 = tk.Frame(m1_frame, bg=BG_PANEL)
        btn_row1.pack(fill=tk.X)

        self.btn_auto_tunnel = tk.Button(
            btn_row1, text="[ 🚀 01 // KÍCH HOẠT 1-CLICK (ADB TUNNEL) ]", font=("Consolas", 10, "bold"),
            bg="#0D3B1A", fg=FG_MATRIX, activebackground="#165B2A", activeforeground="#FFFFFF",
            relief="flat", bd=0, padx=12, pady=7, cursor="hand2", command=self.run_1click_tunnel_onboard
        )
        self.btn_auto_tunnel.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 4))

        btn_open_ad = tk.Button(
            btn_row1, text="[ 💻 MỞ ANYDESK ]", font=("Consolas", 9, "bold"),
            bg="#0F2D3A", fg=FG_CYAN, activebackground="#154B60", activeforeground="#FFFFFF",
            relief="flat", bd=0, padx=10, pady=7, cursor="hand2", command=self.open_anydesk
        )
        btn_open_ad.pack(side=tk.RIGHT)

        # 4. PHƯƠNG ÁN 2: TRỢ LÝ TRUYỀN FILE ANYDESK (DỰ PHÒNG)
        m2_frame = tk.LabelFrame(self, text=" [ CÁCH 2: KÉO THẢ TRUYỀN FILE TRỰC TIẾP QUA ANYDESK ] ",
                                 font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_CYAN, padx=12, pady=8,
                                 highlightthickness=1, highlightbackground="#007A85")
        m2_frame.pack(fill=tk.X, padx=12, pady=4)

        tk.Label(m2_frame, text="Nếu chưa bật Tunnel: Bấm mở truyền file -> Kéo 00_AutoSetup.apk vào /sdcard/Download/ -> Mở app cài đặt.",
                 font=("Consolas", 8), bg=BG_PANEL, fg=FG_TEXT, justify="left").pack(anchor="w", pady=(0, 6))

        btn_row2 = tk.Frame(m2_frame, bg=BG_PANEL)
        btn_row2.pack(fill=tk.X)

        btn_transfer = tk.Button(
            btn_row2, text="[ 📂 02 // MỞ CỬA SỔ TRUYỀN FILE ]", font=("Consolas", 9, "bold"),
            bg="#0F2D3A", fg=FG_CYAN, activebackground="#154B60", activeforeground="#FFFFFF",
            relief="flat", bd=0, padx=10, pady=5, cursor="hand2", command=self.open_file_transfer
        )
        btn_transfer.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 4))

        btn_copy_cmd = tk.Button(
            btn_row2, text="[ 📋 03 // CHÉP LỆNH ROOT CÀI ]", font=("Consolas", 9, "bold"),
            bg=BG_PANEL, fg=FG_AMBER, activebackground="#3A2805", activeforeground="#FFFFFF",
            relief="flat", bd=0, highlightthickness=1, highlightbackground=FG_AMBER,
            padx=10, pady=5, cursor="hand2", command=self.copy_root_install_cmd
        )
        btn_copy_cmd.pack(side=tk.RIGHT)

        # 5. LOG CONSOLE NHỎ
        self.txt_log = tk.Text(self, height=4, bg=BG_INPUT, fg=FG_TEXT, font=("Consolas", 8),
                               relief="flat", padx=8, pady=4, insertbackground=FG_MATRIX)
        self.txt_log.pack(fill=tk.BOTH, expand=True, padx=12, pady=4)

        # 6. FOOTER & NAVIGATION NẾU CÓ NHIỀU THIẾT BỊ
        foot_frame = tk.Frame(self, bg=BG_MAIN, padx=12, pady=6)
        foot_frame.pack(fill=tk.X)

        self.btn_prev = tk.Button(
            foot_frame, text="[ ◀ BOX TRƯỚC ]", font=("Consolas", 8, "bold"),
            bg=BG_PANEL, fg=FG_TEXT, relief="flat", bd=0, highlightthickness=1, highlightbackground=FG_DIM,
            padx=8, pady=4, cursor="hand2", command=self.prev_device
        )
        self.btn_prev.pack(side=tk.LEFT)

        self.lbl_counter = tk.Label(foot_frame, text="Mục: 1 / 1", font=("Consolas", 9), bg=BG_MAIN, fg=FG_DIM)
        self.lbl_counter.pack(side=tk.LEFT, padx=10)

        self.btn_next = tk.Button(
            foot_frame, text="[ BOX TIẾP THEO ▶ ]", font=("Consolas", 8, "bold"),
            bg=BG_PANEL, fg=FG_TEXT, relief="flat", bd=0, highlightthickness=1, highlightbackground=FG_DIM,
            padx=8, pady=4, cursor="hand2", command=self.next_device
        )
        self.btn_next.pack(side=tk.LEFT)

        btn_close = tk.Button(
            foot_frame, text="[ ĐÓNG ]", font=("Consolas", 9, "bold"),
            bg="#2A070E", fg=FG_RED, activebackground="#3D0B14", activeforeground="#FFFFFF",
            relief="flat", bd=0, padx=12, pady=4, cursor="hand2", command=self.on_close
        )
        btn_close.pack(side=tk.RIGHT)

        self.protocol("WM_DELETE_WINDOW", self.on_close)

    def log(self, text):
        t_str = time.strftime("%H:%M:%S")
        self.txt_log.insert(tk.END, f"[{t_str}] {text}\n")
        self.txt_log.see(tk.END)

    def load_target_data(self):
        if not self.target: return
        mac = self.target.get("mac", "")
        ad_id = self.target.get("anydesk_id", "")
        proj = self.target.get("project", "Chưa gán")

        self.lbl_mac.config(text=mac if mac else "(Chưa có MAC)")
        self.lbl_anydesk.config(text=ad_id if ad_id else "(Chưa có AnyDesk)")
        self.lbl_project.config(text=proj)

        tot = len(self.device_list)
        self.lbl_counter.config(text=f"Thiết bị: {self.current_idx + 1} / {tot}" if tot > 1 else "")
        self.btn_prev.config(state=tk.NORMAL if self.current_idx > 0 else tk.DISABLED)
        self.btn_next.config(state=tk.NORMAL if self.current_idx < tot - 1 else tk.DISABLED)

        self.log(f"Mục tiêu hiện tại: AnyDesk ID {ad_id} | MAC: {mac}")

    def prev_device(self):
        if self.current_idx > 0:
            self.current_idx -= 1
            self.target = self.device_list[self.current_idx]
            self.load_target_data()

    def next_device(self):
        if self.current_idx < len(self.device_list) - 1:
            self.current_idx += 1
            self.target = self.device_list[self.current_idx]
            self.load_target_data()

    def open_anydesk(self):
        ad_id = self.target.get("anydesk_id", "")
        ok, msg = open_anydesk_session(ad_id, password=DEFAULT_ANYDESK_PASS, clipboard_fn=self._set_clipboard)
        self.log(msg)

    def open_file_transfer(self):
        ad_id = self.target.get("anydesk_id", "")
        ok, msg = open_anydesk_file_transfer(ad_id)
        self.log(msg)
        # Mở luôn File Explorer tới file APK
        if os.path.exists(self.apk_path):
            open_explorer_select_file(self.apk_path)
            self.log(f"Đã mở Windows Explorer trỏ sẵn vào file: {APK_AUTOSETUP}")
        else:
            self.log(f"⚠️ Không tìm thấy file {APK_AUTOSETUP} trong thư mục chạy.")

    def copy_root_install_cmd(self):
        cmd = f"su -c 'pm install -r /sdcard/Download/{APK_AUTOSETUP} && am start-foreground-service com.sgl.autosetup/.service.AgentService'"
        self._set_clipboard(cmd)
        self.log("✔ Đã chép lệnh root cài đặt vào Clipboard. Bạn chỉ cần dán (Ctrl+V) vào Terminal trên box.")

    def _set_clipboard(self, text):
        self.clipboard_clear()
        self.clipboard_append(text)

    def run_1click_tunnel_onboard(self):
        ad_id = self.target.get("anydesk_id", "")
        if not ad_id:
            messagebox.showwarning("Cảnh báo", "Thiết bị này không có AnyDesk ID!")
            return

        self.btn_auto_tunnel.config(text="[ ⏳ ĐANG KẾT NỐI ADB TUNNEL... ]", state=tk.DISABLED)
        self.log("Bắt đầu tiến trình Onboard 1-Click qua ADB Tunnel...")

        def _worker():
            # Bước 1: Mở AnyDesk nếu chưa mở
            open_anydesk_session(ad_id, password=DEFAULT_ANYDESK_PASS, clipboard_fn=self._set_clipboard)

            # Bước 2: Thử kết nối ADB tới cổng 5555 trên localhost (Cổng AnyDesk Tunnel)
            tunnel_host = "127.0.0.1:5555"
            self.log(f"Đang kiểm tra kết nối ADB tới {tunnel_host}...")
            
            subprocess.run(f"adb connect {tunnel_host}", shell=True, capture_output=True, text=True)
            time.sleep(1)

            # Kiểm tra trạng thái thiết bị adb
            res = subprocess.run("adb devices", shell=True, capture_output=True, text=True)
            out = res.stdout or ""

            if tunnel_host not in out or "offline" in out:
                self.log(f"⚠️ Chưa kết nối được {tunnel_host}.")
                self.log("👉 HƯỚNG DẪN: Trên cửa sổ AnyDesk vừa mở, chọn [Cài đặt / Sét] -> Bật 'TCP Tunnel' (Cổng Local: 5555 -> Remote: 127.0.0.1:5555).")
                self.after(0, lambda: self.btn_auto_tunnel.config(text="[ 🚀 01 // THỬ LẠI KÍCH HOẠT 1-CLICK ]", state=tk.NORMAL))
                return

            self.log(f"✔ Đã thông cổng ADB Tunnel {tunnel_host}!")
            self.log(f"Đang đẩy và cài đặt {APK_AUTOSETUP}...")

            # Cài đặt APK
            if not os.path.exists(self.apk_path):
                self.log(f"❌ Không tìm thấy file {self.apk_path}!")
                self.after(0, lambda: self.btn_auto_tunnel.config(text="[ 🚀 01 // KÍCH HOẠT 1-CLICK ]", state=tk.NORMAL))
                return

            cmd_install = f'adb -s {tunnel_host} install -r "{self.apk_path}"'
            r_install = subprocess.run(cmd_install, shell=True, capture_output=True, text=True)
            self.log(f"Kết quả cài APK: {(r_install.stdout or '').strip()}")

            # Khởi động AgentService
            self.log("Đang kích hoạt AgentService chạy nền...")
            cmd_svc = f"adb -s {tunnel_host} shell am start-foreground-service com.sgl.autosetup/.service.AgentService"
            subprocess.run(cmd_svc, shell=True, capture_output=True)

            cmd_act = f"adb -s {tunnel_host} shell am start -n com.sgl.autosetup/.MainActivity"
            subprocess.run(cmd_act, shell=True, capture_output=True)

            self.log("🎉 [THÀNH CÔNG] Đã kích hoạt AgentService! Thiết bị đang gửi nhịp tim về Google Sheet...")
            self.after(0, lambda: self.btn_auto_tunnel.config(text="[ ✔ HOÀN TẤT // ĐÃ KÍCH HOẠT ]", state=tk.NORMAL, bg="#165B2A"))

        threading.Thread(target=_worker, daemon=True).start()

    def start_status_monitor(self):
        """Luồng kiểm tra thời gian thực xem thiết bị đã Online trên Sheet chưa."""
        def _poller():
            while self.is_monitoring:
                time.sleep(4)
                if not self.target or not self.webhook:
                    continue
                mac = self.target.get("mac", "")
                ad_id = self.target.get("anydesk_id", "")
                if not mac and not ad_id:
                    continue

                try:
                    devs = self.webhook.get_devices()
                    for d in devs:
                        d_mac = d.get("mac", "")
                        d_ad = d.get("anydesk_id", "")
                        if (mac and d_mac == mac) or (ad_id and d_ad == ad_id):
                            last_seen = d.get("last_seen", "")
                            if last_seen and last_seen != "Chưa có":
                                self.after(0, self._on_device_online)
                                return
                except Exception:
                    pass

        threading.Thread(target=_poller, daemon=True).start()

    def _on_device_online(self):
        self.lbl_live_status.config(text="🟢 ONLINE THÀNH CÔNG! (Đã kết nối)", fg=FG_MATRIX)
        self.log("🎉 ĐÃ XÁC NHẬN: Box đã xuất hiện Online trên Google Sheet!")
        if self.on_success_cb:
            self.on_success_cb(self.target)

    def on_close(self):
        self.is_monitoring = False
        self.destroy()
