from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import re
import socket
import subprocess
import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk
import traceback
import urllib.request

# =========================================================================
# CỐ ĐỊNH THƯ MỤC LÀM VIỆC TẠI NƠI CHỨA FILE PYTHON (D:\Auto_Install_LAN)
# =========================================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)
ADB_BIN = (
    os.path.join(BASE_DIR, "adb.exe")
    if os.path.isfile(os.path.join(BASE_DIR, "adb.exe"))
    else "adb"
)
DEBUG_LOG_FILE = os.path.join(BASE_DIR, "lan_install_debug.log")

# =========================================================================
# DÁN LINK WEB APP GOOGLE SHEET CỦA BẠN VÀO ĐÂY:
# =========================================================================
GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxqawYpW8SebK0EK21Cl7C2uw6vN3-Jr7vQIHSAbNxtwXA5H7c_lYRNhXuB7104P0NN/exec"

ADB_PORT = 5555
APK_AUTOSETUP = "00_AutoSetup.apk"
APK_ANYDESK = "02_anydesk.apk"
APK_ADCONTROL = "03_adcontrol-aosp.apk"
APK_RADIO_36 = "04_Audio_3.6_productionRelease.apk"
APK_RADIO_166 = "radio.apk"
APK_ICS = "ics-android-box (2.0.0).apk"
LOCAL_BACKUP_DIR = "/sdcard/SGL_Backup_Apks"
_SECRET_FILE = os.path.join(BASE_DIR, ".sgl_local_secret")
LOCAL_ANYDESK_PASS = os.environ.get("SGL_ANYDESK_PASS", "")
if not LOCAL_ANYDESK_PASS and os.path.isfile(_SECRET_FILE):
    try:
        with open(_SECRET_FILE, "r", encoding="utf-8") as _f:
            LOCAL_ANYDESK_PASS = _f.read().strip()
    except Exception:
        pass

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
log_lock = threading.Lock()

# =========================================================================
# BẢNG MÀU HACKER / CYBER-OPS MATRIX THEME
# =========================================================================
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


class LanMassInstallerApp:

    def __init__(self, root):
        self.root = root
        self.root.title(
            "SGL // CYBER-OPS ANDROID MASS DEPLOYER [AUTO-DISCOVERY & MANUAL/AUTO STAGE-1]"
        )
        self.root.geometry("1280x780")
        self.root.configure(bg=BG_MAIN)

        # Quản lý trạng thái mạch theo thời gian thực (Thread-safe)
        self.state_lock = threading.Lock()
        self.devices = {}  # ip -> {"stt", "mac", "anydesk", "selected", "state"}
        self.active_installing_ips = set()  # Các IP đang trong quá trình cài đặt
        self.installed_macs = set()  # Các MAC đã cài thành công trong phiên
        self.skipped_macs = set()  # Các MAC đã có AnyDesk được bỏ qua

        # Chế độ quét ngầm: "OFF" | "AUTO_INSTALL" (Dò & Cài tự động) | "SCAN_ONLY" (Chỉ tự động dò)
        self.scan_mode = "OFF"
        self.is_scanning_now = False
        self.install_executor = ThreadPoolExecutor(max_workers=10)
        self.radar_frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
        self.radar_idx = 0

        self.write_debug_file(
            "\n"
            + "=" * 80
            + f"\nKHOI DONG PHIEN LAM VIEC MOI: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
            + f"BASE_DIR: {BASE_DIR}\nADB_BIN: {ADB_BIN}\n"
            + "=" * 80
        )

        # Khởi động ADB Server trước
        threading.Thread(
            target=lambda: subprocess.run(
                [ADB_BIN, "start-server"],
                capture_output=True,
                creationflags=CREATE_NO_WINDOW,
            ),
            daemon=True,
        ).start()

        self.setup_styles()
        self.setup_ui()
        self.auto_detect_subnet()
        self.tick_hud_clock()

    def write_debug_file(self, text):
        """Ghi chi tiết mọi lệnh và kết quả vào file lan_install_debug.log"""
        with log_lock:
            try:
                with open(DEBUG_LOG_FILE, "a", encoding="utf-8") as f:
                    ts = time.strftime("%Y-%m-%d %H:%M:%S")
                    f.write(f"[{ts}] {text}\n")
            except Exception:
                pass

    def setup_styles(self):
        style = ttk.Style()
        style.theme_use("clam")
        style.configure(
            "Treeview",
            background=BG_TABLE,
            foreground=FG_TEXT,
            fieldbackground=BG_TABLE,
            rowheight=34,
            font=("Consolas", 10),
            borderwidth=0,
        )
        style.configure(
            "Treeview.Heading",
            background="#0A1F11",
            foreground=FG_MATRIX,
            font=("Consolas", 10, "bold"),
            relief="flat",
            padding=(8, 8),
        )
        style.map(
            "Treeview",
            background=[("selected", "#0F381E")],
            foreground=[("selected", "#FFFFFF")],
        )
        style.map("Treeview.Heading", background=[("active", "#12381F")])

    def _make_cyber_button(
        self, parent, text, fg_color, border_color, hover_bg, command, width=None
    ):
        btn = tk.Button(
            parent,
            text=text,
            font=("Consolas", 9, "bold"),
            bg=BG_PANEL,
            fg=fg_color,
            activebackground=hover_bg,
            activeforeground="#FFFFFF",
            relief="flat",
            bd=0,
            highlightthickness=1,
            highlightbackground=border_color,
            highlightcolor=fg_color,
            padx=10,
            pady=8,
            cursor="hand2",
            command=command,
        )
        if width:
            btn.config(width=width)

        def on_enter(_):
            if btn["state"] != tk.DISABLED and getattr(btn, "_is_active_mode", False) is False:
                btn.config(bg=hover_bg)

        def on_leave(_):
            if btn["state"] != tk.DISABLED and getattr(btn, "_is_active_mode", False) is False:
                btn.config(bg=BG_PANEL)

        btn.bind("<Enter>", on_enter)
        btn.bind("<Leave>", on_leave)
        return btn

    def setup_ui(self):
        # 1. HEADER BANNER & CYBER HUD
        header_frame = tk.Frame(
            self.root,
            bg=BG_PANEL,
            pady=10,
            padx=18,
            highlightthickness=1,
            highlightbackground=BORDER_NEON,
        )
        header_frame.pack(fill=tk.X, padx=14, pady=(12, 6))

        title_box = tk.Frame(header_frame, bg=BG_PANEL)
        title_box.pack(side=tk.LEFT)

        tk.Label(
            title_box,
            text=">_ SGL // ANDROID_BOX_NETRUNNER_V3.5 [DUAL_RADAR_PIPELINE]",
            font=("Consolas", 14, "bold"),
            bg=BG_PANEL,
            fg=FG_MATRIX,
        ).pack(anchor="w")

        tk.Label(
            title_box,
            text="HỖ TRỢ 2 CHẾ ĐỘ: (1) TỰ ĐỘNG DÒ & CÀI LUÔN  |  (2) CHỈ TỰ ĐỘNG DÒ (BẠN TỰ TÍCH CHỌN MẠCH ĐỂ CÀI)",
            font=("Consolas", 9),
            bg=BG_PANEL,
            fg=FG_CYAN,
        ).pack(anchor="w", pady=(2, 0))

        hud_box = tk.Frame(header_frame, bg=BG_PANEL)
        hud_box.pack(side=tk.RIGHT)

        self.lbl_hud_stats = tk.Label(
            hud_box,
            text="[NODES: 00]  [SELECTED: 00]  [INSTALLING: 00]  [PWNED: 00]  [SKIPPED: 00]",
            font=("Consolas", 10, "bold"),
            bg=BG_PANEL,
            fg=FG_CYAN,
        )
        self.lbl_hud_stats.pack(anchor="e")

        self.lbl_summary = tk.Label(
            hud_box,
            text="⚡ STATE: STANDBY // SẴN SÀNG TÁC CHIẾN",
            font=("Consolas", 10, "bold"),
            bg=BG_PANEL,
            fg=FG_AMBER,
        )
        self.lbl_summary.pack(anchor="e", pady=(3, 0))

        # 2. THANH CẤU HÌNH THAM SỐ
        cfg_frame = tk.Frame(
            self.root,
            bg=BG_PANEL,
            padx=14,
            pady=9,
            highlightthickness=1,
            highlightbackground="#0E3A1A",
        )
        cfg_frame.pack(fill=tk.X, padx=14, pady=4)

        tk.Label(
            cfg_frame,
            text="SUBNET_LAN:",
            bg=BG_PANEL,
            fg=FG_MATRIX,
            font=("Consolas", 10, "bold"),
        ).pack(side=tk.LEFT)
        self.ent_subnet = tk.Entry(
            cfg_frame,
            width=13,
            font=("Consolas", 11, "bold"),
            justify="center",
            bg=BG_INPUT,
            fg=FG_MATRIX,
            insertbackground=FG_MATRIX,
            relief="flat",
            highlightthickness=1,
            highlightbackground=BORDER_NEON,
        )
        self.ent_subnet.pack(side=tk.LEFT, padx=(6, 16), ipady=3)

        tk.Label(
            cfg_frame,
            text="RADIO_USER:",
            bg=BG_PANEL,
            fg=FG_CYAN,
            font=("Consolas", 10, "bold"),
        ).pack(side=tk.LEFT)
        self.ent_user = tk.Entry(
            cfg_frame,
            width=11,
            font=("Consolas", 11, "bold"),
            justify="center",
            fg=FG_AMBER,
            bg=BG_INPUT,
            insertbackground=FG_AMBER,
            relief="flat",
            highlightthickness=1,
            highlightbackground="#007A85",
        )
        self.ent_user.insert(0, "z755-01")
        self.ent_user.pack(side=tk.LEFT, padx=(6, 14), ipady=3)

        tk.Label(
            cfg_frame,
            text="PASS:",
            bg=BG_PANEL,
            fg=FG_CYAN,
            font=("Consolas", 10, "bold"),
        ).pack(side=tk.LEFT)
        self.ent_pass = tk.Entry(
            cfg_frame,
            width=6,
            font=("Consolas", 11, "bold"),
            justify="center",
            fg=FG_AMBER,
            bg=BG_INPUT,
            insertbackground=FG_AMBER,
            relief="flat",
            highlightthickness=1,
            highlightbackground="#007A85",
        )
        self.ent_pass.insert(0, "2")
        self.ent_pass.pack(side=tk.LEFT, padx=(6, 14), ipady=3)

        tk.Label(
            cfg_frame,
            text="CHU KỲ DÒ (Giây):",
            bg=BG_PANEL,
            fg=FG_MATRIX,
            font=("Consolas", 10, "bold"),
        ).pack(side=tk.LEFT)
        self.ent_interval = tk.Entry(
            cfg_frame,
            width=4,
            font=("Consolas", 11, "bold"),
            justify="center",
            fg=FG_MATRIX,
            bg=BG_INPUT,
            insertbackground=FG_MATRIX,
            relief="flat",
            highlightthickness=1,
            highlightbackground=BORDER_NEON,
        )
        self.ent_interval.insert(0, "4")
        self.ent_interval.pack(side=tk.LEFT, padx=(6, 16), ipady=3)

        self.var_copy_backup = tk.BooleanVar(value=True)
        cb_backup = tk.Checkbutton(
            cfg_frame,
            text="Chép bộ cài dự phòng (1.66 / ICS) vào mạch",
            variable=self.var_copy_backup,
            bg=BG_PANEL,
            fg=FG_TEXT,
            font=("Consolas", 10),
            selectcolor=BG_INPUT,
            activebackground=BG_PANEL,
            activeforeground=FG_MATRIX,
        )
        cb_backup.pack(side=tk.LEFT, padx=4)

        # 3. THANH NÚT ĐIỀU KHIỂN TÁC CHIẾN
        btn_frame = tk.Frame(self.root, bg=BG_MAIN, padx=14, pady=6)
        btn_frame.pack(fill=tk.X)

        # Nút 1: Tự động dò liên tục & Tự động cài luôn
        self.btn_auto_install = self._make_cyber_button(
            btn_frame,
            text="[ 🔁 01 // AUTO_DÒ_&_CÀI: OFF ]",
            fg_color=FG_MATRIX,
            border_color=FG_MATRIX,
            hover_bg="#0D3B1A",
            command=self.toggle_auto_install_mode,
        )
        self.btn_auto_install.pack(side=tk.LEFT, padx=(0, 6))

        # Nút 2 (MỚI): Chỉ tự động dò liên tục (Người dùng tự tích chọn mạch để bấm cài)
        self.btn_auto_scan_only = self._make_cyber_button(
            btn_frame,
            text="[ 📡 02 // CHỈ_AUTO_DÒ: OFF ]",
            fg_color=FG_CYAN,
            border_color=FG_CYAN,
            hover_bg="#073642",
            command=self.toggle_scan_only_mode,
        )
        self.btn_auto_scan_only.pack(side=tk.LEFT, padx=6)

        # Nút 3: Cài đặt các mạch do người dùng tích chọn [X]
        self.btn_install_selected = self._make_cyber_button(
            btn_frame,
            text="[ 🚀 03 // CÀI_MẠCH_ĐANG_CHỌN ]",
            fg_color=FG_AMBER,
            border_color=FG_AMBER,
            hover_bg="#3A2805",
            command=self.start_manual_install_selected,
        )
        self.btn_install_selected.pack(side=tk.LEFT, padx=6)

        # Nút 4: Quét lẻ 1 lần (Chỉ dò)
        self.btn_scan_once = self._make_cyber_button(
            btn_frame,
            text="[ 🔍 DÒ_1_LẦN ]",
            fg_color=FG_TEXT,
            border_color=BORDER_NEON,
            hover_bg="#102A18",
            command=self.trigger_manual_scan_once,
        )
        self.btn_scan_once.pack(side=tk.LEFT, padx=6)

        # Nút 5: Xóa bảng & Làm lô mới
        self.btn_rescan = self._make_cyber_button(
            btn_frame,
            text="[ ♻ LÀM_MỚI_BẢNG ]",
            fg_color="#FF7043",
            border_color="#FF7043",
            hover_bg="#3B160C",
            command=self.reset_for_new_batch,
        )
        self.btn_rescan.pack(side=tk.LEFT, padx=6)

        # Nút 6: Mở file log lỗi
        self.btn_open_log = self._make_cyber_button(
            btn_frame,
            text="[ 📂 LOG_LỖI ]",
            fg_color="#E040FB",
            border_color="#AA00FF",
            hover_bg="#2B0938",
            command=self.open_debug_log_file,
        )
        self.btn_open_log.pack(side=tk.LEFT, padx=6)

        # Nút 7: Chọn / Bỏ chọn tất cả mạch sẵn sàng
        self.btn_toggle_all = self._make_cyber_button(
            btn_frame,
            text="[ ☑ CHỌN_TẤT_CẢ ]",
            fg_color=FG_TEXT,
            border_color=FG_DIM,
            hover_bg="#14291A",
            command=self.toggle_select_all,
        )
        self.btn_toggle_all.pack(side=tk.RIGHT)

        # 4. BẢNG DANH SÁCH MỤC TIÊU (TREEVIEW)
        table_frame = tk.Frame(
            self.root,
            bg=BG_PANEL,
            padx=2,
            pady=2,
            highlightthickness=1,
            highlightbackground=BORDER_NEON,
        )
        table_frame.pack(fill=tk.BOTH, expand=True, padx=14, pady=4)

        columns = ("select", "stt", "ip", "mac", "anydesk", "status")
        self.tree = ttk.Treeview(
            table_frame, columns=columns, show="headings", height=11
        )
        self.tree.heading("select", text="[X]")
        self.tree.heading("stt", text="ID#")
        self.tree.heading("ip", text="TARGET_IP")
        self.tree.heading("mac", text="MAC_ADDR (HEX)")
        self.tree.heading("anydesk", text="ANYDESK_ID")
        self.tree.heading("status", text="REALTIME_PIPELINE_TELEMETRY (CLICK CỘT [X] ĐỂ CHỌN/BỎ CHỌN)")

        self.tree.column("select", width=55, anchor="center", stretch=False)
        self.tree.column("stt", width=55, anchor="center", stretch=False)
        self.tree.column("ip", width=140, anchor="center", stretch=False)
        self.tree.column("mac", width=175, anchor="center", stretch=False)
        self.tree.column("anydesk", width=155, anchor="center", stretch=False)
        self.tree.column("status", width=580, anchor="w", stretch=True)

        self.tree.tag_configure("ready", foreground=FG_TEXT, background=BG_TABLE)
        self.tree.tag_configure(
            "running", foreground=FG_CYAN, background="#061D24"
        )
        self.tree.tag_configure(
            "done", foreground=FG_MATRIX, background="#072610"
        )
        self.tree.tag_configure(
            "skipped", foreground=FG_AMBER, background="#1F1705"
        )
        self.tree.tag_configure(
            "error", foreground=FG_RED, background="#2A070E"
        )

        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.tree.bind("<ButtonRelease-1>", self.on_tree_click)
        self.tree.bind("<Double-1>", lambda _: self.open_selected_anydesk())
        self.tree.bind("<Button-3>", self.show_context_menu)

        # Context Menu chuột phải
        self.menu = tk.Menu(self.root, tearoff=0, bg=BG_PANEL, fg=FG_TEXT, activebackground="#0F381E", activeforeground="#FFFFFF")
        self.menu.add_command(label="💻 Mở AnyDesk (Tự động nạp mật khẩu)", command=self.open_selected_anydesk)
        self.menu.add_command(label="📋 Sao chép Mật khẩu AnyDesk", command=lambda: self._set_clipboard(LOCAL_ANYDESK_PASS, "Đã sao chép mật khẩu AnyDesk"))
        self.menu.add_command(label="📋 Sao chép AnyDesk ID", command=self.copy_selected_anydesk)
        self.menu.add_command(label="📋 Sao chép MAC Address", command=self.copy_selected_mac)
        self.menu.add_command(label="📋 Sao chép IP Mạch", command=self.copy_selected_ip)

        scrollbar = ttk.Scrollbar(
            table_frame, orient=tk.VERTICAL, command=self.tree.yview
        )
        self.tree.configure(yscroll=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # 5. CỬA SỔ TERMINAL LOG
        log_frame = tk.Frame(
            self.root,
            bg=BG_PANEL,
            padx=10,
            pady=6,
            highlightthickness=1,
            highlightbackground="#0E3A1A",
        )
        log_frame.pack(fill=tk.BOTH, expand=False, padx=14, pady=(4, 12))

        tk.Label(
            log_frame,
            text=f"root@sgl-cyberops:~# tail -f {DEBUG_LOG_FILE}",
            bg=BG_PANEL,
            fg=FG_MATRIX,
            font=("Consolas", 9, "bold"),
            anchor="w",
        ).pack(fill=tk.X, pady=(0, 4))

        self.txt_log = tk.Text(
            log_frame,
            height=8,
            bg=BG_INPUT,
            fg=FG_TEXT,
            font=("Consolas", 10),
            relief="flat",
            padx=10,
            pady=6,
            insertbackground=FG_MATRIX,
        )
        self.txt_log.tag_config("log_ok", foreground=FG_MATRIX)
        self.txt_log.tag_config("log_err", foreground=FG_RED)
        self.txt_log.tag_config("log_warn", foreground=FG_AMBER)
        self.txt_log.tag_config("log_scan", foreground=FG_CYAN)
        self.txt_log.tag_config("log_normal", foreground=FG_TEXT)
        self.txt_log.pack(fill=tk.BOTH, expand=True)

    # =========================================================================
    # CẬP NHẬT HUD, LOG & BẢNG DỮ LIỆU
    # =========================================================================
    def tick_hud_clock(self):
        self.radar_idx = (self.radar_idx + 1) % len(self.radar_frames)
        spinner = self.radar_frames[self.radar_idx]

        with self.state_lock:
            total = len(self.devices)
            selected = sum(1 for d in self.devices.values() if d["selected"])
            installing = len(self.active_installing_ips)
            done = sum(1 for d in self.devices.values() if d["state"] == "done")
            skipped = sum(
                1 for d in self.devices.values() if d["state"] == "skipped"
            )

        self.lbl_hud_stats.config(
            text=(
                f"[NODES: {total:02d}]  "
                f"[SELECTED: {selected:02d}]  "
                f"[INSTALLING: {installing:02d}]  "
                f"[PWNED: {done:02d}]  "
                f"[SKIPPED: {skipped:02d}]"
            )
        )

        scan_state = "ĐANG QUÉT..." if self.is_scanning_now else "CHỜ CHU KỲ TIẾP"
        if self.scan_mode == "AUTO_INSTALL":
            self.lbl_summary.config(
                text=f"{spinner} MODE: AUTO DÒ & CÀI ({scan_state}) | ĐANG CÀI: {installing} MẠCH",
                fg=FG_MATRIX,
            )
        elif self.scan_mode == "SCAN_ONLY":
            self.lbl_summary.config(
                text=f"{spinner} MODE: CHỈ AUTO DÒ ({scan_state}) | ĐÃ CHỌN: {selected} | ĐANG CÀI: {installing}",
                fg=FG_CYAN,
            )
        elif installing > 0:
            self.lbl_summary.config(
                text=f"{spinner} ĐANG CÀI ĐẶT CÁC MẠCH ĐÃ CHỌN ({installing} MẠCH)...",
                fg=FG_AMBER,
            )
        else:
            self.lbl_summary.config(
                text="⚡ STATE: STANDBY // SẴN SÀNG TÁC CHIẾN",
                fg=FG_AMBER,
            )

        self.root.after(250, self.tick_hud_clock)

    def open_debug_log_file(self):
        if os.path.isfile(DEBUG_LOG_FILE):
            os.startfile(DEBUG_LOG_FILE)
        else:
            messagebox.showinfo("Thông báo", "Chưa có file log!")

    def log(self, msg):
        self.write_debug_file(f"[UI_LOG] {msg}")

        def _append():
            t = time.strftime("%H:%M:%S")
            tag = "log_normal"
            if any(k in msg for k in ["✔", "🎉", "HOÀN TẤT", "thành công"]):
                tag = "log_ok"
            elif any(k in msg for k in ["❌", "Lỗi", "ERR"]):
                tag = "log_err"
            elif any(k in msg for k in ["⏭", "⚠", "SKIPPED", "Bỏ qua"]):
                tag = "log_warn"
            elif any(k in msg for k in ["🔍", "🎯", "🚀", "⚡", "📡", "MỚI"]):
                tag = "log_scan"

            self.txt_log.insert(tk.END, f"[{t}] {msg}\n", tag)
            self.txt_log.see(tk.END)

        self.root.after(0, _append)

    def upsert_device_row(
        self, ip, mac=None, anydesk=None, status=None, selected=None, state=None
    ):
        """Thêm mới hoặc cập nhật dòng của IP trên bảng mà KHÔNG làm mất tích chọn của người dùng"""
        if status:
            self.write_debug_file(f"[{ip}] STATUS -> {status}")

        def _upd():
            with self.state_lock:
                if ip not in self.devices:
                    stt = len(self.devices) + 1
                    self.devices[ip] = {
                        "stt": f"{stt:02d}",
                        "mac": mac or "ĐANG_ĐỌC...",
                        "anydesk": anydesk or "ĐANG_KIỂM_TRA...",
                        "selected": False if selected is None else selected,
                        "state": state or "ready",
                    }
                else:
                    if mac is not None:
                        self.devices[ip]["mac"] = mac
                    if anydesk is not None:
                        self.devices[ip]["anydesk"] = anydesk
                    if selected is not None:
                        self.devices[ip]["selected"] = selected
                    if state is not None:
                        self.devices[ip]["state"] = state

                d = self.devices[ip]
                row_tag = (
                    d["state"]
                    if d["state"] in ("ready", "running", "done", "skipped", "error")
                    else "ready"
                )
                vals = (
                    "[X]" if d["selected"] else "[ ]",
                    d["stt"],
                    ip,
                    d["mac"],
                    d["anydesk"],
                    status
                    if status is not None
                    else (
                        self.tree.item(ip, "values")[5]
                        if self.tree.exists(ip)
                        else ""
                    ),
                )

            if self.tree.exists(ip):
                self.tree.item(ip, values=vals, tags=(row_tag,))
            else:
                self.tree.insert("", tk.END, iid=ip, values=vals, tags=(row_tag,))
                self.tree.see(ip)

        self.root.after(0, _upd)

    def toggle_select_all(self):
        """Ưu tiên chọn/bỏ chọn các mạch chưa cài (ready/error) để tránh cài đè nhầm mạch đã xong"""
        with self.state_lock:
            if not self.devices:
                return
            candidate_ips = [
                ip
                for ip, d in self.devices.items()
                if d["state"] in ("ready", "error")
                and ip not in self.active_installing_ips
            ]
            if not candidate_ips:
                candidate_ips = [
                    ip
                    for ip in self.devices.keys()
                    if ip not in self.active_installing_ips
                ]
            any_unselected = any(
                not self.devices[ip]["selected"] for ip in candidate_ips
            )

        for ip in candidate_ips:
            self.upsert_device_row(ip, selected=any_unselected)

    def on_tree_click(self, event):
        region = self.tree.identify("region", event.x, event.y)
        if region == "cell":
            col = self.tree.identify_column(event.x)
            row_id = self.tree.identify_row(event.y)
            if row_id and col == "#1":
                with self.state_lock:
                    if (
                        row_id not in self.devices
                        or row_id in self.active_installing_ips
                    ):
                        return
                    curr = self.devices[row_id]["selected"]
                self.upsert_device_row(row_id, selected=not curr)

    def _set_clipboard(self, text, notify_msg=None):
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        if notify_msg:
            messagebox.showinfo("Đã sao chép", notify_msg)

    def show_context_menu(self, event):
        item = self.tree.identify_row(event.y)
        if item:
            self.tree.selection_set(item)
            self.menu.post(event.x_root, event.y_root)

    def open_selected_anydesk(self):
        sel = self.tree.selection()
        if not sel: return
        vals = self.tree.item(sel[0], "values")
        if not vals or len(vals) < 5: return
        ad_id = vals[4]
        if not ad_id or "Chưa" in ad_id or "DANG" in ad_id:
            messagebox.showwarning("Cảnh báo", f"Mạch {vals[2]} chưa có mã AnyDesk ID!")
            return
        
        clean_id = re.sub(r"\D", "", str(ad_id))
        if LOCAL_ANYDESK_PASS:
            self._set_clipboard(LOCAL_ANYDESK_PASS)
        anydesk_paths = [
            os.path.expandvars(r"%ProgramFiles(x86)%\AnyDesk\AnyDesk.exe"),
            os.path.expandvars(r"%ProgramFiles%\AnyDesk\AnyDesk.exe"),
            os.path.expandvars(r"%LocalAppData%\AnyDesk\AnyDesk.exe"),
            os.path.expandvars(r"%AppData%\AnyDesk\AnyDesk.exe"),
            "anydesk"
        ]
        exe = next((p for p in anydesk_paths if os.path.isfile(p)), "anydesk")
        cmd = f'echo {LOCAL_ANYDESK_PASS}| "{exe}" {clean_id} --with-password' if LOCAL_ANYDESK_PASS else f'"{exe}" {clean_id}'
        try:
            subprocess.Popen(cmd, shell=True, creationflags=CREATE_NO_WINDOW)
            self.log(f"💻 Đang mở AnyDesk {clean_id} (Đã tự nạp mật khẩu bảo mật)...")
        except Exception as e:
            messagebox.showwarning("AnyDesk", f"Lỗi mở AnyDesk: {e}")

    def copy_selected_anydesk(self):
        sel = self.tree.selection()
        if not sel: return
        vals = self.tree.item(sel[0], "values")
        if vals and len(vals) >= 5:
            self._set_clipboard(vals[4], f"Đã chép AnyDesk ID: {vals[4]}")

    def copy_selected_mac(self):
        sel = self.tree.selection()
        if not sel: return
        vals = self.tree.item(sel[0], "values")
        if vals and len(vals) >= 4:
            self._set_clipboard(vals[3], f"Đã chép MAC: {vals[3]}")

    def copy_selected_ip(self):
        sel = self.tree.selection()
        if not sel: return
        vals = self.tree.item(sel[0], "values")
        if vals and len(vals) >= 3:
            self._set_clipboard(vals[2], f"Đã chép IP: {vals[2]}")

    def auto_detect_subnet(self):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            subnet = ".".join(local_ip.split(".")[:3])
        except Exception:
            subnet = "192.168.1"
        self.ent_subnet.delete(0, tk.END)
        self.ent_subnet.insert(0, subnet)

    # =========================================================================
    # HÀM GIAO TIẾP ADB & CHẨN ĐOÁN CHI TIẾT
    # =========================================================================
    def ensure_device_online(self, ip):
        target = f"{ip}:{ADB_PORT}"
        for attempt in range(1, 4):
            res = subprocess.run(
                [ADB_BIN, "devices", "-l"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=CREATE_NO_WINDOW,
            )
            out = res.stdout or ""
            self.write_debug_file(
                f"[{ip}] ensure_device_online (try {attempt}):\n{out.strip()}"
            )

            if re.search(rf"{re.escape(target)}\s+device\b", out):
                return True

            if target in out:
                r_rec = subprocess.run(
                    [ADB_BIN, "-s", target, "reconnect"],
                    capture_output=True,
                    text=True,
                    timeout=6,
                    creationflags=CREATE_NO_WINDOW,
                )
                self.write_debug_file(
                    f"[{ip}] adb reconnect: {r_rec.stdout} {r_rec.stderr}"
                )
                time.sleep(1.2)
                res2 = subprocess.run(
                    [ADB_BIN, "devices"],
                    capture_output=True,
                    text=True,
                    creationflags=CREATE_NO_WINDOW,
                )
                if re.search(
                    rf"{re.escape(target)}\s+device\b", res2.stdout or ""
                ):
                    return True

            r_dis = subprocess.run(
                [ADB_BIN, "disconnect", target],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=CREATE_NO_WINDOW,
            )
            time.sleep(0.5)
            r_con = subprocess.run(
                [ADB_BIN, "connect", target],
                capture_output=True,
                text=True,
                timeout=6,
                creationflags=CREATE_NO_WINDOW,
            )
            self.write_debug_file(
                f"[{ip}] disconnect/connect: dis={r_dis.stdout.strip()} | con={r_con.stdout.strip()}"
            )
            time.sleep(1.2)
        return False

    def run_adb(self, ip, args_list, timeout=60, step_name="ADB_CMD"):
        target = f"{ip}:{ADB_PORT}"
        for attempt in range(1, 3):
            self.ensure_device_online(ip)
            cmd = [ADB_BIN, "-s", target] + args_list
            t0 = time.time()
            try:
                res = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=timeout,
                    creationflags=CREATE_NO_WINDOW,
                )
                elapsed = time.time() - t0
                out = ((res.stdout or "") + "\n" + (res.stderr or "")).strip()
                self.write_debug_file(
                    f"[{ip}] [{step_name}] (try {attempt}, {elapsed:.2f}s, rc={res.returncode}) CMD: {' '.join(cmd)}\n"
                    f"   -> OUTPUT: {out}"
                )
                if (
                    "device offline" in out
                    or "device not found" in out
                    or "Error: closed" in out
                    or "protocol fault" in out
                ) and attempt == 1:
                    self.log(
                        f"🔄 [{ip}] ADB báo '{out[:60]}', đang khôi phục kết nối..."
                    )
                    subprocess.run(
                        [ADB_BIN, "disconnect", target],
                        capture_output=True,
                        creationflags=CREATE_NO_WINDOW,
                    )
                    time.sleep(0.8)
                    subprocess.run(
                        [ADB_BIN, "connect", target],
                        capture_output=True,
                        creationflags=CREATE_NO_WINDOW,
                    )
                    time.sleep(1.2)
                    continue
                return out
            except Exception as e:
                self.write_debug_file(
                    f"[{ip}] [{step_name}] EXCEPTION (try {attempt}): {e}\n{traceback.format_exc()}"
                )
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
                [ADB_BIN, "-s", target, "shell"],
                input=script,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                creationflags=CREATE_NO_WINDOW,
            )
            elapsed = time.time() - t0
            out = ((res.stdout or "") + "\n" + (res.stderr or "")).strip()
            self.write_debug_file(
                f"[{ip}] [{step_name}] ({elapsed:.2f}s, rc={res.returncode}) SCRIPT:\n{shell_cmd}\n"
                f"   -> OUTPUT: {out}"
            )
            return out
        except Exception as e:
            self.write_debug_file(
                f"[{ip}] [{step_name}] EXCEPTION: {e}\n{traceback.format_exc()}"
            )
            return f"ERR: {e}"

    def collect_device_diagnostics(self, ip, reason=""):
        """Thu thập toàn bộ thông số chẩn đoán của mạch khi gặp lỗi"""
        self.write_debug_file(
            f"\n--- BAT DAU CHAN DOAN CHI TIET CHO MACH [{ip}] (Ly do: {reason}) ---"
        )
        diag_cmd = (
            "echo '=== ID & WHOAMI ===' ; id ; "
            "echo '=== DEVICE PROPS ===' ; getprop ro.product.model ; getprop ro.build.version.release ; getprop ro.build.display.id ; "
            "echo '=== DISK SPACE (/data & /sdcard) ===' ; df -h /data /data/local/tmp /sdcard 2>&1 ; "
            "echo '=== LS /data/local/tmp ===' ; ls -la /data/local/tmp 2>&1 ; "
            "echo '=== INSTALLED PACKAGES (SGL/ANYDESK/RADIO/ICS) ===' ; pm list packages | grep -iE 'sgl|anydesk|radio|audio|ics' 2>&1 ; "
            "echo '=== LOGCAT PACKAGE MANAGER (LAST 40 LINES) ===' ; logcat -d -t 40 | grep -iE 'PackageManager|Install|anydesk|autosetup|Finsky|Verify' 2>&1"
        )
        out = self.run_adb_root(
            ip, diag_cmd, timeout=25, step_name="DIAGNOSTICS"
        )
        self.write_debug_file(
            f"--- KET QUA CHAN DOAN [{ip}] ---\n{out}\n--------------------------------------------\n"
        )

    def install_apk_safe(self, ip, apk_filename, timeout=180):
        """
        Thử tuần tự 3 phương pháp cài APK và ghi log từng phương pháp:
        1. Push vào /data/local/tmp/ + pm install qua Root
        2. Push vào /data/local/tmp/ + pm install qua Shell thường
        3. adb install --no-streaming -r -g trực tiếp từ PC
        """
        # Đảm bảo luôn dùng đường dẫn tuyệt đối đầy đủ của APK trên máy tính
        full_apk_path = os.path.join(BASE_DIR, apk_filename) if not os.path.isabs(apk_filename) else apk_filename
        if not os.path.isfile(full_apk_path):
            full_apk_path = os.path.abspath(apk_filename)

        remote_tmp = f"/data/local/tmp/sgl_tmp_{ip.split('.')[-1]}.apk"
        file_size = os.path.getsize(full_apk_path) if os.path.isfile(full_apk_path) else 0
        self.write_debug_file(
            f"[{ip}] === BAT DAU CAI APK: {full_apk_path} (Size: {file_size} bytes) ==="
        )

        self.run_adb(
            ip,
            ["shell", f"rm -f {remote_tmp}"],
            timeout=10,
            step_name="CLEAN_TMP",
        )

        # Phương pháp 1: Push + pm install (Root)
        push_res = self.run_adb(
            ip,
            ["push", full_apk_path, remote_tmp],
            timeout=timeout,
            step_name=f"PUSH_{os.path.basename(apk_filename)}",
        )
        if (
            "error:" not in push_res.lower()
            and "offline" not in push_res.lower()
        ):
            install_cmd = (
                f"chmod 644 {remote_tmp} ; "
                f"ls -la {remote_tmp} ; "
                f"pm install -r -g {remote_tmp} 2>&1 ; "
                f"rm -f {remote_tmp}"
            )
            res_root = self.run_adb_root(
                ip,
                install_cmd,
                timeout=timeout,
                step_name=f"PM_INSTALL_ROOT_{os.path.basename(apk_filename)}",
            )
            if "Success" in res_root:
                return res_root

            # Phương pháp 2: Nếu Root pm install lỗi, thử qua shell thường
            self.run_adb(
                ip,
                ["push", full_apk_path, remote_tmp],
                timeout=timeout,
                step_name=f"RE_PUSH_{os.path.basename(apk_filename)}",
            )
            res_shell = self.run_adb(
                ip,
                [
                    "shell",
                    f"chmod 644 {remote_tmp} ; pm install -r -g {remote_tmp} 2>&1 ; rm -f {remote_tmp}",
                ],
                timeout=timeout,
                step_name=f"PM_INSTALL_SHELL_{os.path.basename(apk_filename)}",
            )
            if "Success" in res_shell:
                return res_shell
        else:
            res_root = f"Push thất bại: {push_res}"
            res_shell = ""

        # Phương pháp 3: Dự phòng gọi adb install --no-streaming
        res_no_stream = self.run_adb(
            ip,
            ["install", "--no-streaming", "-r", "-g", full_apk_path],
            timeout=timeout,
            step_name=f"ADB_INSTALL_NO_STREAM_{os.path.basename(apk_filename)}",
        )
        if "Success" in res_no_stream:
            return res_no_stream

        combined_err = (
            f"Cach1(Root): {res_root} | Cach2(Shell): {res_shell} |"
            f" Cach3(NoStream): {res_no_stream}"
        )
        self.collect_device_diagnostics(
            ip, reason=f"Loi cai {apk_filename}: {combined_err}"
        )
        return combined_err

    def read_mac_address(self, ip):
        cmd = (
            "cat /sys/class/net/eth0/address 2>/dev/null ; "
            "cat /sys/class/net/wlan0/address 2>/dev/null ; "
            "ip link show eth0 2>/dev/null ; "
            "ifconfig eth0 2>/dev/null ; "
            "getprop ro.boot.mac 2>/dev/null ; "
            "getprop ro.mac 2>/dev/null"
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
        """
        Kiểm tra thiết bị đã cài AnyDesk chưa.
        Trả về tuple: (has_anydesk: bool, anydesk_id: str)
        """
        pkg_out = self.run_adb(
            ip,
            ["shell", "pm list packages com.anydesk.anydeskandroid 2>/dev/null"],
            timeout=8,
            step_name="CHECK_ANYDESK_PKG",
        )
        has_pkg = "package:com.anydesk.anydeskandroid" in pkg_out
        ad_id = self.read_anydesk_id(ip)
        if has_pkg or bool(ad_id):
            return True, (ad_id if ad_id else "Đã cài APK")
        return False, ""

    # =========================================================================
    # QUẢN LÝ 2 CHẾ ĐỘ QUÉT NGẦM: (1) AUTO DÒ & CÀI | (2) CHỈ AUTO DÒ
    # =========================================================================
    def _update_mode_buttons_ui(self):
        if self.scan_mode == "AUTO_INSTALL":
            self.btn_auto_install._is_active_mode = True
            self.btn_auto_install.config(
                text="[ 🟢 01 // AUTO_DÒ_&_CÀI: ON ]",
                fg="#FFFFFF",
                bg="#0A471C",
            )
            self.btn_auto_scan_only._is_active_mode = False
            self.btn_auto_scan_only.config(
                text="[ 📡 02 // CHỈ_AUTO_DÒ: OFF ]",
                fg=FG_CYAN,
                bg=BG_PANEL,
            )
        elif self.scan_mode == "SCAN_ONLY":
            self.btn_auto_install._is_active_mode = False
            self.btn_auto_install.config(
                text="[ 🔁 01 // AUTO_DÒ_&_CÀI: OFF ]",
                fg=FG_MATRIX,
                bg=BG_PANEL,
            )
            self.btn_auto_scan_only._is_active_mode = True
            self.btn_auto_scan_only.config(
                text="[ 🟢 02 // CHỈ_AUTO_DÒ: ON ]",
                fg="#FFFFFF",
                bg="#074352",
            )
        else:
            self.btn_auto_install._is_active_mode = False
            self.btn_auto_install.config(
                text="[ 🔁 01 // AUTO_DÒ_&_CÀI: OFF ]",
                fg=FG_MATRIX,
                bg=BG_PANEL,
            )
            self.btn_auto_scan_only._is_active_mode = False
            self.btn_auto_scan_only.config(
                text="[ 📡 02 // CHỈ_AUTO_DÒ: OFF ]",
                fg=FG_CYAN,
                bg=BG_PANEL,
            )

    def toggle_auto_install_mode(self):
        """Bật/tắt chế độ 1: Tự động dò liên tục & Tự động cài GĐ1 ngay khi thấy mạch mới"""
        if self.scan_mode == "AUTO_INSTALL":
            self.scan_mode = "OFF"
            self._update_mode_buttons_ui()
            self.log("⏸ Đã TẮT chế độ [AUTO_DÒ_&_CÀI].")
            return

        missing = [
            f
            for f in [APK_AUTOSETUP, APK_ANYDESK, APK_ADCONTROL, APK_RADIO_36]
            if not os.path.isfile(f)
        ]
        if missing:
            messagebox.showerror(
                "Thiếu file bộ cài GĐ1",
                "Không tìm thấy các file APK sau:\n- " + "\n- ".join(missing),
            )
            return

        was_off = self.scan_mode == "OFF"
        self.scan_mode = "AUTO_INSTALL"
        self._update_mode_buttons_ui()
        self.log(
            "⚡ Đã BẬT [AUTO_DÒ_&_CÀI]: Cắm mạch tới đâu -> Tự động dò & chạy Bộ cài GĐ1 luôn tới đó!"
        )
        if was_off:
            threading.Thread(
                target=self._continuous_scan_daemon, daemon=True
            ).start()

    def toggle_scan_only_mode(self):
        """Bật/tắt chế độ 2: Chỉ tự động dò liên tục đưa lên bảng, để người dùng tự tích chọn mạch cần cài"""
        if self.scan_mode == "SCAN_ONLY":
            self.scan_mode = "OFF"
            self._update_mode_buttons_ui()
            self.log("⏸ Đã TẮT chế độ [CHỈ_AUTO_DÒ].")
            return

        was_off = self.scan_mode == "OFF"
        self.scan_mode = "SCAN_ONLY"
        self._update_mode_buttons_ui()
        self.log(
            "📡 Đã BẬT [CHỈ_AUTO_DÒ]: Tự động phát hiện mọi mạch mới cắm vào mạng & kiểm tra AnyDesk (Không tự cài). Bạn hãy tích [X] các mạch muốn cài rồi bấm [🚀 03 // CÀI_MẠCH_ĐANG_CHỌN]!"
        )
        if was_off:
            threading.Thread(
                target=self._continuous_scan_daemon, daemon=True
            ).start()

    def _continuous_scan_daemon(self):
        """Luồng quét ngầm liên tục, hoạt động cho cả 2 chế độ AUTO_INSTALL và SCAN_ONLY"""
        while self.scan_mode != "OFF":
            if not self.is_scanning_now:
                subnet = self.ent_subnet.get().strip()
                if subnet:
                    auto_install = self.scan_mode == "AUTO_INSTALL"
                    self._execute_scan_pass(
                        subnet, auto_trigger_install=auto_install
                    )

            try:
                interval = max(2, int(self.ent_interval.get().strip()))
            except Exception:
                interval = 4

            for _ in range(interval * 4):
                if self.scan_mode == "OFF":
                    return
                time.sleep(0.25)

    def trigger_manual_scan_once(self):
        """Quét 1 lần duy nhất và chỉ hiển thị lên bảng để người dùng chọn"""
        subnet = self.ent_subnet.get().strip()
        if not subnet:
            messagebox.showwarning(
                "Thiếu thông tin", "Vui lòng nhập dải mạng LAN (VD: 192.168.1)"
            )
            return
        if self.is_scanning_now:
            self.log("⏳ Đang có một chu kỳ quét chạy ngầm, vui lòng đợi vài giây...")
            return
        self.log(
            f"🔍 Đang dò 1 lần dải mạng {subnet}.1 -> .254 (Chế độ chỉ dò - Bạn tự chọn mạch để cài)..."
        )
        threading.Thread(
            target=self._execute_scan_pass,
            args=(subnet, False),
            daemon=True,
        ).start()

    def _probe_single_ip_fast(self, ip, auto_trigger_install):
        """
        Kiểm tra cổng 5555 của IP.
        - Bỏ qua các IP đang cài đặt.
        - Nếu ở chế độ CHỈ_AUTO_DÒ và IP đã nằm trên bảng ở trạng thái 'ready'/'done'/'skipped'
          thì bỏ qua không quét đè lại để giữ nguyên dấu tích [X] của người dùng!
        """
        with self.state_lock:
            if ip in self.active_installing_ips:
                return None
            if ip in self.devices:
                st = self.devices[ip]["state"]
                mac_known = self.devices[ip]["mac"] not in (
                    "KHÔNG_RÕ_MAC",
                    "ĐANG_ĐỌC...",
                )
                if st in ("done", "skipped") and mac_known:
                    return None
                if not auto_trigger_install and st == "ready" and mac_known:
                    return None

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.30)
        result = sock.connect_ex((ip, ADB_PORT))
        sock.close()
        if result != 0:
            return None

        r_con = subprocess.run(
            [ADB_BIN, "connect", f"{ip}:{ADB_PORT}"],
            capture_output=True,
            text=True,
            timeout=6,
            creationflags=CREATE_NO_WINDOW,
        )
        self.write_debug_file(
            f"[{ip}] PROBE_CONNECT: {(r_con.stdout or '').strip()}"
        )
        time.sleep(0.25)

        mac = self.read_mac_address(ip)
        has_anydesk, ad_id = self.check_anydesk_installed(ip)
        return (ip, mac, has_anydesk, ad_id)

    def _execute_scan_pass(self, subnet, auto_trigger_install=False):
        if self.is_scanning_now:
            return
        self.is_scanning_now = True
        try:
            ips = [f"{subnet}.{i}" for i in range(1, 255)]
            newly_discovered = []

            with ThreadPoolExecutor(max_workers=64) as scan_pool:
                futures = {
                    scan_pool.submit(
                        self._probe_single_ip_fast, ip, auto_trigger_install
                    ): ip
                    for ip in ips
                }
                for future in as_completed(futures):
                    res = future.result()
                    if res:
                        newly_discovered.append(res)

            newly_discovered.sort(key=lambda x: int(x[0].split(".")[-1]))

            for ip, mac, has_anydesk, ad_id in newly_discovered:
                with self.state_lock:
                    if ip in self.active_installing_ips:
                        continue
                    already_installed_mac = (
                        mac != "KHÔNG_RÕ_MAC" and mac in self.installed_macs
                    )
                    # Giữ nguyên lựa chọn [X]/[ ] nếu mạch đã có trên bảng
                    prev_selected = (
                        self.devices[ip]["selected"]
                        if ip in self.devices
                        else None
                    )

                # TRƯỜNG HỢP 1: Mạch đã được cài trong phiên hoặc ĐÃ CÓ ANYDESK
                if already_installed_mac or has_anydesk:
                    with self.state_lock:
                        if mac != "KHÔNG_RÕ_MAC":
                            self.skipped_macs.add(mac)
                    self.upsert_device_row(
                        ip,
                        mac=mac,
                        anydesk=ad_id if ad_id else "Đã có AnyDesk",
                        selected=False,
                        state="skipped",
                        status=f"⏭ [SKIPPED] Đã cài AnyDesk ({ad_id or 'OK'}) -> Tự động bỏ qua",
                    )
                    self.log(
                        f"⏭ [{ip}] Mạch MAC={mac} đã có AnyDesk ({ad_id}) -> Bỏ qua."
                    )

                # TRƯỜNG HỢP 2: Mạch ANDROID MỚI (Chưa cài AnyDesk)
                else:
                    if auto_trigger_install:
                        # Chế độ 1: Tự động kích hoạt cài đặt GĐ1 ngay
                        self.upsert_device_row(
                            ip,
                            mac=mac,
                            anydesk="Chưa cài đặt",
                            selected=True,
                            state="running",
                            status="🎯 [MẠCH_MỚI] Chưa có AnyDesk -> Tự động kích hoạt Bộ cài GĐ1 ngay!",
                        )
                        self.log(
                            f"🎯 [{ip}] Phát hiện Android mới (MAC: {mac}) -> Tự động chạy Bộ cài GĐ1!"
                        )
                        self._dispatch_device_install(ip)
                    else:
                        # Chế độ 2 (CHỈ AUTO DÒ): Đưa lên bảng, để người dùng tự tích chọn [X]
                        sel_state = False if prev_selected is None else prev_selected
                        self.upsert_device_row(
                            ip,
                            mac=mac,
                            anydesk="Chưa cài đặt",
                            selected=sel_state,
                            state="ready",
                            status="🎯 [MẠCH_MỚI - CHƯA CÓ ANYDESK] Hãy tích [X] rồi bấm '03 // CÀI MẠCH ĐANG CHỌN'",
                        )
                        if prev_selected is None:
                            self.log(
                                f"📡 [{ip}] Phát hiện mạch mới chưa có AnyDesk (MAC: {mac}) -> Đã thêm vào bảng chờ bạn chọn!"
                            )
        finally:
            self.is_scanning_now = False

    def _dispatch_device_install(self, ip):
        """Đẩy 1 IP vào ThreadPool cài đặt ngay lập tức mà không chặn bộ quét"""
        required_files = [
            APK_AUTOSETUP,
            APK_ANYDESK,
            APK_ADCONTROL,
            APK_RADIO_36,
        ]
        missing = [f for f in required_files if not os.path.isfile(f)]
        if missing:
            self.log(
                f"❌ [{ip}] Không thể cài đặt do thiếu file APK: {', '.join(missing)}"
            )
            self.upsert_device_row(
                ip,
                state="error",
                status=f"❌ Thiếu file APK: {', '.join(missing)}",
            )
            return

        with self.state_lock:
            if ip in self.active_installing_ips:
                return
            self.active_installing_ips.add(ip)

        user = self.ent_user.get().strip()
        passwd = self.ent_pass.get().strip()
        copy_backup = self.var_copy_backup.get()

        self.install_executor.submit(
            self._install_single_device_wrapper, ip, user, passwd, copy_backup
        )

    def _install_single_device_wrapper(self, ip, user, passwd, copy_backup):
        try:
            self._install_single_device(ip, user, passwd, copy_backup)
        except Exception as e:
            tb = traceback.format_exc()
            self.write_debug_file(f"[{ip}] UNHANDLED EXCEPTION:\n{tb}")
            self.log(f"❌ [{ip}] Lỗi ngoại lệ: {e}")
            self.upsert_device_row(
                ip, status=f"❌ Lỗi ngoại lệ: {e}", state="error"
            )
        finally:
            with self.state_lock:
                self.active_installing_ips.discard(ip)

    def start_manual_install_selected(self):
        """Cài đặt các mạch mà người dùng đã tích chọn [X] trên bảng"""
        with self.state_lock:
            selected_ips = [
                ip
                for ip, info in self.devices.items()
                if info["selected"] and ip not in self.active_installing_ips
            ]

        if not selected_ips:
            messagebox.showinfo(
                "Chưa chọn thiết bị",
                "Bạn chưa tích chọn [X] mạch nào trên bảng (hoặc các mạch chọn đang được cài đặt)!\n\nMẹo: Click vào cột [X] ở đầu dòng hoặc bấm nút [☑ CHỌN_TẤT_CẢ].",
            )
            return

        required_files = [
            APK_AUTOSETUP,
            APK_ANYDESK,
            APK_ADCONTROL,
            APK_RADIO_36,
        ]
        missing = [f for f in required_files if not os.path.isfile(f)]
        if missing:
            messagebox.showerror(
                "Thiếu file bộ cài GĐ1",
                "Không tìm thấy các file APK sau:\n- " + "\n- ".join(missing),
            )
            return

        self.log(
            f"🚀 Bắt đầu chạy Bộ cài GĐ1 cho {len(selected_ips)} mạch bạn đã chọn: {', '.join(selected_ips)}"
        )
        for ip in selected_ips:
            self._dispatch_device_install(ip)

    def reset_for_new_batch(self):
        with self.state_lock:
            if self.active_installing_ips:
                messagebox.showwarning(
                    "Đang cài đặt",
                    f"Hiện vẫn còn {len(self.active_installing_ips)} mạch đang trong quá trình cài đặt!\nVui lòng đợi các mạch này cài xong trước khi xóa bảng.",
                )
                return
            self.devices.clear()

        for item in self.tree.get_children():
            self.tree.delete(item)

        self.log("♻ Đã xóa bảng danh sách và ngắt kết nối ADB cũ.")
        subprocess.run(
            [ADB_BIN, "disconnect"],
            capture_output=True,
            creationflags=CREATE_NO_WINDOW,
        )

    # =========================================================================
    # QUY TRÌNH CÀI ĐẶT GIAI ĐOẠN 1 TRÊN TỪNG MẠCH
    # =========================================================================
    def _install_single_device(self, ip, radio_user, radio_pass, copy_backup):
        self.write_debug_file(
            f"\n==================== BAT DAU CAI DAT MACH [{ip}] ===================="
        )
        self.collect_device_diagnostics(ip, reason="Kiem tra truoc khi cai dat")

        with self.state_lock:
            mac = self.devices.get(ip, {}).get("mac", "KHÔNG_RÕ_MAC")

        if mac in ("KHÔNG_RÕ_MAC", "ĐANG_ĐỌC..."):
            mac = self.read_mac_address(ip)
            self.upsert_device_row(ip, mac=mac)

        # BƯỚC 1: CÀI 4 FILE APK
        apks_to_install = [
            APK_AUTOSETUP,
            APK_ANYDESK,
            APK_ADCONTROL,
            APK_RADIO_36,
        ]
        for idx, apk in enumerate(apks_to_install, start=1):
            self.upsert_device_row(
                ip,
                status=f"⏳ [1/7] Đang đẩy & cài APK ({idx}/4): {apk} ...",
                state="running",
            )
            res = self.install_apk_safe(ip, apk, timeout=180)
            if "Success" not in res:
                self.log(
                    f"❌ [{ip}] Lỗi cài {apk} -> Xem chi tiết trong lan_install_debug.log"
                )
                self.upsert_device_row(
                    ip, status=f"❌ Lỗi cài {apk}: {res[:90]}", state="error"
                )
                return

        # Tạm đóng RadioStation nếu tự mở
        radio_pkg = self.run_adb_root(
            ip,
            "pm list packages -3 | cut -d':' -f2 | grep -vE 'autosetup|anydesk' | grep -iE 'radio|audio|station|streamer' | head -n 1",
            step_name="FIND_RADIO_PKG",
        ).splitlines()
        radio_pkg = radio_pkg[0].strip() if radio_pkg else ""
        if radio_pkg:
            self.run_adb_root(
                ip, f"am force-stop {radio_pkg}", step_name="STOP_RADIO"
            )

        # BƯỚC 2: CHÉP BỘ CÀI DỰ PHÒNG
        if copy_backup:
            self.upsert_device_row(
                ip,
                status="⏳ [2/7] Đang đẩy bộ cài dự phòng vào mạch...",
                state="running",
            )
            self.run_adb_root(
                ip, f"mkdir -p {LOCAL_BACKUP_DIR}", step_name="MKDIR_BACKUP"
            )
            for backup_apk in [APK_RADIO_36, APK_RADIO_166, APK_ICS]:
                if os.path.isfile(backup_apk):
                    self.run_adb(
                        ip,
                        [
                            "push",
                            backup_apk,
                            f"{LOCAL_BACKUP_DIR}/{backup_apk}",
                        ],
                        timeout=180,
                        step_name=f"BACKUP_PUSH_{backup_apk}",
                    )

        # BƯỚC 3: CẤP QUYỀN ROOT & ACCESSIBILITY CHO ANYDESK
        self.upsert_device_row(
            ip,
            status="⏳ [3/7] Cấp quyền Root & hệ thống cho AnyDesk...",
            state="running",
        )
        perm_cmd = (
            "appops set com.anydesk.anydeskandroid PROJECT_MEDIA allow ; "
            "appops set com.anydesk.anydeskandroid SYSTEM_ALERT_WINDOW allow ; "
            "settings put secure enabled_accessibility_services com.anydesk.adcontrol.aosp/com.anydesk.adcontrol.AccService:com.anydesk.adcontrol.ad1/com.anydesk.adcontrol.AccService ; "
            "settings put secure accessibility_enabled 1"
        )
        self.run_adb_root(ip, perm_cmd, step_name="GRANT_ANYDESK_PERMS")

        # BƯỚC 4: KHỞI TẠO MÃ ANYDESK & NẠP MẬT KHẨU BẢO MẬT
        self.upsert_device_row(
            ip,
            status="⏳ [4/7] Khởi tạo mã AnyDesk & nạp mật khẩu bảo mật...",
            state="running",
        )
        self.run_adb_root(
            ip,
            "monkey -p com.anydesk.anydeskandroid -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1",
            step_name="LAUNCH_ANYDESK_1",
        )

        anydesk_id = ""
        for _ in range(10):
            time.sleep(1)
            anydesk_id = self.read_anydesk_id(ip)
            if anydesk_id:
                break

        ad_cfg_dir = os.path.join(BASE_DIR, "anydesk_config")
        if not os.path.isdir(ad_cfg_dir) and os.path.isdir("anydesk_config"):
            ad_cfg_dir = os.path.abspath("anydesk_config")

        if os.path.isdir(ad_cfg_dir):
            ad_tmp_dir = f"/data/local/tmp/ad_tpl_{ip.split('.')[-1]}"
            self.run_adb_root(
                ip,
                "am force-stop com.anydesk.anydeskandroid",
                step_name="STOP_ANYDESK",
            )
            time.sleep(0.8)
            self.run_adb(
                ip,
                ["push", ad_cfg_dir, ad_tmp_dir],
                timeout=30,
                step_name="PUSH_ANYDESK_TPL",
            )
            restore_cmd = (
                "for base in /data_mirror/data_de/null/0/com.anydesk.anydeskandroid "
                "/data_mirror/data_ce/null/0/com.anydesk.anydeskandroid "
                "/data/user_de/0/com.anydesk.anydeskandroid "
                "/data/user/0/com.anydesk.anydeskandroid "
                "/data/data/com.anydesk.anydeskandroid; do "
                '  target="$base/files/.anydesk"; '
                '  if [ -d "$target" ]; then '
                "    for f in service.conf system.conf user.conf; do "
                f'      if [ -s "{ad_tmp_dir}/$f" ]; then '
                '        rm -f "$target/$f.new"; '
                '        if [ -f "$target/$f" ]; then '
                "          grep -E '^ad\\.anynet\\.(id|cert|pkey|alias|register)' \"$target/$f\" > \"$target/$f.new\" 2>/dev/null || true; "
                "        fi; "
                f'        cat "{ad_tmp_dir}/$f" >> "$target/$f.new"; '
                '        mv "$target/$f.new" "$target/$f"; '
                "      fi; "
                "    done; "
                '    OWNER=$(stat -c "%u:%g" "$base" 2>/dev/null); '
                '    if [ -n "$OWNER" ]; then chown -R $OWNER "$base/files" 2>/dev/null; fi; '
                '    chmod 600 "$target"/*.conf 2>/dev/null; '
                "  fi; "
                f'  if [ -d "$base" ] && [ -d "{ad_tmp_dir}/shared_prefs" ]; then '
                '    mkdir -p "$base/shared_prefs" 2>/dev/null; '
                f'    cp -f {ad_tmp_dir}/shared_prefs/*.xml "$base/shared_prefs/" 2>/dev/null || true; '
                '    OWNER=$(stat -c "%u:%g" "$base" 2>/dev/null); '
                '    if [ -n "$OWNER" ]; then chown -R $OWNER "$base/shared_prefs" 2>/dev/null; fi; '
                '    chmod 660 "$base/shared_prefs/"*.xml 2>/dev/null; '
                "  fi; "
                "done; "
                f"rm -rf {ad_tmp_dir} ; sync"
            )
            self.run_adb_root(
                ip, restore_cmd, step_name="RESTORE_ANYDESK_CONFIG"
            )
            self.run_adb_root(
                ip,
                "monkey -p com.anydesk.anydeskandroid -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1",
                step_name="LAUNCH_ANYDESK_2",
            )
            time.sleep(2.5)

        # Kích hoạt Agent AutoSetup chạy nền & kết nối Cloud Webhook
        self.run_adb_root(
            ip,
            "am start-foreground-service com.sgl.autosetup/.AgentService ; monkey -p com.sgl.autosetup -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1",
            step_name="START_AGENT_SERVICE",
        )

        if not anydesk_id:
            anydesk_id = self.read_anydesk_id(ip)
        self.upsert_device_row(
            ip, anydesk=anydesk_id if anydesk_id else "Chưa rõ"
        )

        if not anydesk_id:
            self.collect_device_diagnostics(
                ip, reason="Khong lay duoc AnyDesk ID"
            )

        # BƯỚC 5: GHI GOOGLE SHEET
        self.upsert_device_row(
            ip,
            status="⏳ [5/7] Đang ghi AnyDesk & MAC lên Sheet 'Android Mới'...",
            state="running",
        )
        self.send_to_google_sheet("Android Mới", anydesk_id, mac)

        # BƯỚC 6: CÀI NGÀY GIỜ GMT+7 (ASIA/BANGKOK) TRƯỚC KHI ĐĂNG NHẬP RADIO
        self.upsert_device_row(
            ip,
            status="⏳ [6/7] Đặt múi giờ GMT+7 (Asia/Bangkok)...",
            state="running",
        )
        epoch_sec = int(time.time())
        epoch_ms = epoch_sec * 1000
        tz_cmd = (
            "settings put global auto_time_zone 0 ; "
            "settings put global auto_time 1 ; "
            "settings put system time_12_24 24 ; "
            "setprop persist.sys.timezone Asia/Bangkok ; "
            "cmd alarm set-timezone Asia/Bangkok 2>/dev/null ; "
            f"cmd alarm set-time {epoch_ms} 2>/dev/null ; "
            f"date @{epoch_sec} >/dev/null 2>&1 ; "
            "hwclock -w 2>/dev/null || true"
        )
        self.run_adb_root(ip, tz_cmd, step_name="SET_TIMEZONE_GMT7")
        time.sleep(1.5)
        self.ensure_device_online(ip)

        # BƯỚC 7: MỞ RADIO 3.6 & ĐĂNG NHẬP TÀI KHOẢN TEST
        self.upsert_device_row(
            ip,
            status=f"⏳ [7/7] Mở Radio 3.6 & đăng nhập TK test ({radio_user})...",
            state="running",
        )
        if not radio_pkg:
            radio_pkg = "com.radiostation"
        self.run_adb_root(
            ip,
            f"am force-stop {radio_pkg} ; monkey -p {radio_pkg} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1",
            step_name="LAUNCH_RADIO",
        )
        time.sleep(4)

        login_cmd = (
            "SIZE=$(wm size | grep -oE '[0-9]+x[0-9]+' | tail -n 1) ; "
            "W=${SIZE%x*} ; H=${SIZE#*x} ; "
            'if [ -z "$W" ]; then W=1920; H=1080; fi ; '
            "X=$((W / 2)) ; "
            "Y_USER=$((H * 345 / 1000)) ; "
            "Y_PASS=$((H * 475 / 1000)) ; "
            "Y_BTN=$((H * 660 / 1000)) ; "
            "input tap $X $Y_USER ; sleep 0.6 ; "
            "input keyevent 123 ; input keyevent 67 67 67 67 67 67 67 67 67 67 ; "
            f"input text '{radio_user}' ; sleep 0.6 ; "
            "if dumpsys input_method 2>/dev/null | grep -q 'mInputShown=true'; then input keyevent 4; sleep 0.8; fi ; "
            "input tap $X $Y_PASS ; sleep 0.6 ; "
            "input keyevent 123 ; input keyevent 67 67 67 67 67 ; "
            f"input text '{radio_pass}' ; sleep 0.6 ; "
            "if dumpsys input_method 2>/dev/null | grep -q 'mInputShown=true'; then input keyevent 4; sleep 0.8; fi ; "
            "input tap $X $Y_BTN"
        )
        self.run_adb_root(ip, login_cmd, step_name="AUTO_LOGIN_RADIO")
        time.sleep(5)

        with self.state_lock:
            if mac != "KHÔNG_RÕ_MAC":
                self.installed_macs.add(mac)

        self.upsert_device_row(
            ip,
            selected=False,
            state="done",
            status=f"🎉 [PWNED_OK] HOÀN TẤT GĐ1! (AnyDesk: {anydesk_id} | MAC: {mac})",
        )
        self.log(
            f"✔ [{ip}] Cài đặt GĐ1 thành công -> AnyDesk: {anydesk_id} | MAC: {mac}"
        )

    def send_to_google_sheet(self, sheet_name, anydesk_id, mac):
        csv_file = "Danh_sach_Android_Moi_LAN.csv"
        with log_lock:
            write_header = not os.path.isfile(csv_file)
            with open(csv_file, "a", encoding="utf-8") as f:
                if write_header:
                    f.write("Thoi_Gian,AnyDesk_ID,MAC\n")
                f.write(
                    f"{time.strftime('%Y-%m-%d %H:%M:%S')},{anydesk_id},{mac}\n"
                )

        if (
            not GOOGLE_SHEET_WEBHOOK_URL
            or "DAN_LINK_GOOGLE_SCRIPT" in GOOGLE_SHEET_WEBHOOK_URL
        ):
            return

        try:
            payload = json.dumps(
                {
                    "sheet_name": sheet_name,
                    "sheet_type": "MAIN",
                    "anydesk_id": anydesk_id,
                    "mac": mac,
                }
            ).encode("utf-8")
            req = urllib.request.Request(
                GOOGLE_SHEET_WEBHOOK_URL,
                data=payload,
                headers={"Content-Type": "application/json; charset=UTF-8"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                self.write_debug_file(
                    f"GOOGLE_SHEET_RESPONSE ({mac}): HTTP {resp.status} - {body}"
                )
        except Exception as e:
            self.write_debug_file(f"GOOGLE_SHEET_ERROR ({mac}): {e}")
            self.log(f"⚠ Lỗi gửi Google Sheet ({mac}): {e}")


if __name__ == "__main__":
    root = tk.Tk()
    app = LanMassInstallerApp(root)
    root.mainloop()
