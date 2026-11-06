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
from concurrent.futures import ThreadPoolExecutor, as_completed

from .config import (
    BASE_DIR, ADB_PORT, DEBUG_LOG_FILE,
    APK_AUTOSETUP, APK_ANYDESK, APK_ADCONTROL, APK_RADIO_36,
    BG_MAIN, BG_PANEL, BG_INPUT, BG_TABLE,
    FG_MATRIX, FG_CYAN, FG_AMBER, FG_RED, FG_DIM, FG_TEXT, BORDER_NEON,
    DEFAULT_ANYDESK_PASS, open_anydesk_session
)
from .adb_engine import AdbEngine

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

class Stage1Frame(tk.Frame):
    def __init__(self, parent, webhook_client=None):
        super().__init__(parent, bg=BG_MAIN)
        self.webhook = webhook_client

        self.engine = AdbEngine(webhook_client=self.webhook, log_callback=self.log)

        # Trạng thái mạch theo thời gian thực (Thread-safe)
        self.state_lock = threading.Lock()
        self.devices = {}  # ip -> {"stt", "mac", "anydesk", "selected", "state"}
        self.active_installing_ips = set()
        self.installed_macs = set()
        self.skipped_macs = set()

        self.scan_mode = "OFF"
        self.is_scanning_now = False
        self.install_executor = ThreadPoolExecutor(max_workers=10)
        self.radar_frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
        self.radar_idx = 0

        self.setup_ui()
        self.auto_detect_subnet()
        self.tick_hud_clock()

    def _make_cyber_button(self, parent, text, fg_color, border_color, hover_bg, command, width=None):
        btn = tk.Button(
            parent, text=text, font=("Consolas", 9, "bold"),
            bg=BG_PANEL, fg=fg_color, activebackground=hover_bg, activeforeground="#FFFFFF",
            relief="flat", bd=0, highlightthickness=1, highlightbackground=border_color, highlightcolor=fg_color,
            padx=10, pady=8, cursor="hand2", command=command
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
        header_frame = tk.Frame(self, bg=BG_PANEL, pady=8, padx=14, highlightthickness=1, highlightbackground=BORDER_NEON)
        header_frame.pack(fill=tk.X, padx=10, pady=(8, 4))

        title_box = tk.Frame(header_frame, bg=BG_PANEL)
        title_box.pack(side=tk.LEFT)

        tk.Label(title_box, text=">_ GIAI ĐOẠN 1 // CÀI TỰ ĐỘNG MẠCH MỚI QUA LAN (ADB MASS INSTALLER)",
                 font=("Consolas", 12, "bold"), bg=BG_PANEL, fg=FG_MATRIX).pack(anchor="w")

        tk.Label(title_box, text="Tự động cài Radio 3.6, AnyDesk, ADControl, cấp quyền Accessibility & đẩy MAC/AnyDesk lên Sheet",
                 font=("Consolas", 9), bg=BG_PANEL, fg=FG_CYAN).pack(anchor="w", pady=(2, 0))

        hud_box = tk.Frame(header_frame, bg=BG_PANEL)
        hud_box.pack(side=tk.RIGHT)

        self.lbl_hud_stats = tk.Label(hud_box, text="[NODES: 00]  [SELECTED: 00]  [INSTALLING: 00]  [DONE: 00]",
                                      font=("Consolas", 10, "bold"), bg=BG_PANEL, fg=FG_CYAN)
        self.lbl_hud_stats.pack(anchor="e")

        self.lbl_summary = tk.Label(hud_box, text="⚡ STATE: STANDBY // SẴN SÀNG",
                                    font=("Consolas", 10, "bold"), bg=BG_PANEL, fg=FG_AMBER)
        self.lbl_summary.pack(anchor="e", pady=(2, 0))

        # 2. THANH CẤU HÌNH THAM SỐ
        cfg_frame = tk.Frame(self, bg=BG_PANEL, padx=12, pady=6, highlightthickness=1, highlightbackground="#0E3A1A")
        cfg_frame.pack(fill=tk.X, padx=10, pady=3)

        tk.Label(cfg_frame, text="SUBNET_LAN:", bg=BG_PANEL, fg=FG_MATRIX, font=("Consolas", 9, "bold")).pack(side=tk.LEFT)
        self.ent_subnet = tk.Entry(cfg_frame, width=13, font=("Consolas", 10, "bold"), justify="center",
                                   bg=BG_INPUT, fg=FG_MATRIX, insertbackground=FG_MATRIX, relief="flat",
                                   highlightthickness=1, highlightbackground=BORDER_NEON)
        self.ent_subnet.pack(side=tk.LEFT, padx=(4, 12), ipady=2)

        tk.Label(cfg_frame, text="RADIO_USER:", bg=BG_PANEL, fg=FG_CYAN, font=("Consolas", 9, "bold")).pack(side=tk.LEFT)
        self.ent_user = tk.Entry(cfg_frame, width=10, font=("Consolas", 10, "bold"), justify="center",
                                 fg=FG_AMBER, bg=BG_INPUT, insertbackground=FG_AMBER, relief="flat",
                                 highlightthickness=1, highlightbackground="#007A85")
        self.ent_user.insert(0, "z755-01")
        self.ent_user.pack(side=tk.LEFT, padx=(4, 10), ipady=2)

        tk.Label(cfg_frame, text="PASS:", bg=BG_PANEL, fg=FG_CYAN, font=("Consolas", 9, "bold")).pack(side=tk.LEFT)
        self.ent_pass = tk.Entry(cfg_frame, width=5, font=("Consolas", 10, "bold"), justify="center",
                                 fg=FG_AMBER, bg=BG_INPUT, insertbackground=FG_AMBER, relief="flat",
                                 highlightthickness=1, highlightbackground="#007A85")
        self.ent_pass.insert(0, "2")
        self.ent_pass.pack(side=tk.LEFT, padx=(4, 10), ipady=2)

        tk.Label(cfg_frame, text="CHU KỲ (S):", bg=BG_PANEL, fg=FG_MATRIX, font=("Consolas", 9, "bold")).pack(side=tk.LEFT)
        self.ent_interval = tk.Entry(cfg_frame, width=4, font=("Consolas", 10, "bold"), justify="center",
                                     fg=FG_MATRIX, bg=BG_INPUT, insertbackground=FG_MATRIX, relief="flat",
                                     highlightthickness=1, highlightbackground=BORDER_NEON)
        self.ent_interval.insert(0, "4")
        self.ent_interval.pack(side=tk.LEFT, padx=(4, 12), ipady=2)

        self.var_copy_backup = tk.BooleanVar(value=True)
        cb_backup = tk.Checkbutton(cfg_frame, text="Chép bộ cài dự phòng (1.66 / ICS)", variable=self.var_copy_backup,
                                   bg=BG_PANEL, fg=FG_TEXT, font=("Consolas", 9), selectcolor=BG_INPUT,
                                   activebackground=BG_PANEL, activeforeground=FG_MATRIX)
        cb_backup.pack(side=tk.LEFT, padx=4)

        # 3. THANH NÚT ĐIỀU KHIỂN
        btn_frame = tk.Frame(self, bg=BG_MAIN, padx=10, pady=4)
        btn_frame.pack(fill=tk.X)

        self.btn_auto_install = self._make_cyber_button(
            btn_frame, text="[ 🔁 01 // AUTO DÒ & CÀI: OFF ]", fg_color=FG_MATRIX, border_color=FG_MATRIX,
            hover_bg="#0D3B1A", command=self.toggle_auto_install_mode
        )
        self.btn_auto_install.pack(side=tk.LEFT, padx=(0, 4))

        self.btn_auto_scan_only = self._make_cyber_button(
            btn_frame, text="[ 📡 02 // CHỈ AUTO DÒ: OFF ]", fg_color=FG_CYAN, border_color=FG_CYAN,
            hover_bg="#073642", command=self.toggle_scan_only_mode
        )
        self.btn_auto_scan_only.pack(side=tk.LEFT, padx=4)

        self.btn_install_selected = self._make_cyber_button(
            btn_frame, text="[ 🚀 03 // CÀI MẠCH ĐÃ CHỌN ]", fg_color=FG_AMBER, border_color=FG_AMBER,
            hover_bg="#3A2805", command=self.start_manual_install_selected
        )
        self.btn_install_selected.pack(side=tk.LEFT, padx=4)

        self.btn_scan_once = self._make_cyber_button(
            btn_frame, text="[ 🔍 DÒ 1 LẦN ]", fg_color=FG_TEXT, border_color=BORDER_NEON,
            hover_bg="#102A18", command=self.trigger_manual_scan_once
        )
        self.btn_scan_once.pack(side=tk.LEFT, padx=4)

        self.btn_rescan = self._make_cyber_button(
            btn_frame, text="[ ♻ LÀM MỚI BẢNG ]", fg_color="#FF7043", border_color="#FF7043",
            hover_bg="#3B160C", command=self.reset_for_new_batch
        )
        self.btn_rescan.pack(side=tk.LEFT, padx=4)

        self.btn_toggle_all = self._make_cyber_button(
            btn_frame, text="[ ☑ CHỌN TẤT CẢ ]", fg_color=FG_TEXT, border_color=FG_DIM,
            hover_bg="#14291A", command=self.toggle_select_all
        )
        self.btn_toggle_all.pack(side=tk.RIGHT)

        # 4. BẢNG DANH SÁCH MỤC TIÊU
        table_frame = tk.Frame(self, bg=BG_PANEL, padx=2, pady=2, highlightthickness=1, highlightbackground=BORDER_NEON)
        table_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=3)

        columns = ("select", "stt", "ip", "mac", "anydesk", "status")
        self.tree = ttk.Treeview(table_frame, columns=columns, show="headings", height=8)
        self.tree.heading("select", text="[X]")
        self.tree.heading("stt", text="ID#")
        self.tree.heading("ip", text="IP MẠCH")
        self.tree.heading("mac", text="MAC ADDRESS")
        self.tree.heading("anydesk", text="ANYDESK ID")
        self.tree.heading("status", text="TIẾN TRÌNH THỰC THI")

        self.tree.column("select", width=45, anchor="center", stretch=False)
        self.tree.column("stt", width=45, anchor="center", stretch=False)
        self.tree.column("ip", width=130, anchor="center", stretch=False)
        self.tree.column("mac", width=155, anchor="center", stretch=False)
        self.tree.column("anydesk", width=140, anchor="center", stretch=False)
        self.tree.column("status", width=550, anchor="w", stretch=True)

        self.tree.tag_configure("ready", foreground=FG_TEXT, background=BG_TABLE)
        self.tree.tag_configure("running", foreground=FG_CYAN, background="#061D24")
        self.tree.tag_configure("done", foreground=FG_MATRIX, background="#072610")
        self.tree.tag_configure("skipped", foreground=FG_AMBER, background="#1F1705")
        self.tree.tag_configure("error", foreground=FG_RED, background="#2A070E")

        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.tree.bind("<ButtonRelease-1>", self.on_tree_click)
        self.tree.bind("<Double-1>", lambda _: self.open_selected_anydesk())
        self.tree.bind("<Button-3>", self.show_context_menu)

        # Context Menu chuột phải
        self.menu = tk.Menu(self, tearoff=0, bg=BG_PANEL, fg=FG_TEXT, activebackground="#0F381E", activeforeground="#FFFFFF")
        self.menu.add_command(label="💻 Mở AnyDesk (Tự động nạp Pass: 12345678j)", command=self.open_selected_anydesk)
        self.menu.add_command(label="📋 Sao chép Mật khẩu (12345678j)", command=lambda: self._set_clipboard(DEFAULT_ANYDESK_PASS, "Đã sao chép mật khẩu AnyDesk (12345678j)"))
        self.menu.add_command(label="📋 Sao chép AnyDesk ID", command=self.copy_selected_anydesk)
        self.menu.add_command(label="📋 Sao chép MAC Address", command=self.copy_selected_mac)
        self.menu.add_command(label="📋 Sao chép IP Mạch", command=self.copy_selected_ip)

        scrollbar = ttk.Scrollbar(table_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscroll=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # 5. TERMINAL LOG
        log_frame = tk.Frame(self, bg=BG_PANEL, padx=8, pady=4, highlightthickness=1, highlightbackground="#0E3A1A")
        log_frame.pack(fill=tk.BOTH, expand=False, padx=10, pady=(2, 8))

        self.txt_log = tk.Text(log_frame, height=6, bg=BG_INPUT, fg=FG_TEXT, font=("Consolas", 9),
                               relief="flat", padx=8, pady=4, insertbackground=FG_MATRIX)
        self.txt_log.tag_config("log_ok", foreground=FG_MATRIX)
        self.txt_log.tag_config("log_err", foreground=FG_RED)
        self.txt_log.tag_config("log_warn", foreground=FG_AMBER)
        self.txt_log.tag_config("log_scan", foreground=FG_CYAN)
        self.txt_log.tag_config("log_normal", foreground=FG_TEXT)
        self.txt_log.pack(fill=tk.BOTH, expand=True)

    def log(self, msg):
        def _append():
            t = time.strftime("%H:%M:%S")
            tag = "log_normal"
            if any(k in msg for k in ["✔", "🎉", "HOÀN TẤT", "thành công"]):
                tag = "log_ok"
            elif any(k in msg for k in ["❌", "Lỗi", "ERR"]):
                tag = "log_err"
            elif any(k in msg for k in ["⏭", "⚠", "SKIPPED", "Bỏ qua"]):
                tag = "log_warn"
            elif any(k in msg for k in ["🔍", "🎯", "🚀", "⚡", "📡"]):
                tag = "log_scan"
            self.txt_log.insert(tk.END, f"[{t}] {msg}\n", tag)
            self.txt_log.see(tk.END)
        self.after(0, _append)

    def tick_hud_clock(self):
        self.radar_idx = (self.radar_idx + 1) % len(self.radar_frames)
        spinner = self.radar_frames[self.radar_idx]
        with self.state_lock:
            total = len(self.devices)
            selected = sum(1 for d in self.devices.values() if d["selected"])
            installing = len(self.active_installing_ips)
            done = sum(1 for d in self.devices.values() if d["state"] == "done")

        self.lbl_hud_stats.config(
            text=f"[NODES: {total:02d}]  [CHỌN: {selected:02d}]  [ĐANG CÀI: {installing:02d}]  [XONG: {done:02d}]"
        )
        if self.scan_mode == "AUTO_INSTALL":
            self.lbl_summary.config(text=f"{spinner} MODE: AUTO DÒ & CÀI | ĐANG CÀI: {installing}", fg=FG_MATRIX)
        elif self.scan_mode == "SCAN_ONLY":
            self.lbl_summary.config(text=f"{spinner} MODE: CHỈ AUTO DÒ | ĐÃ CHỌN: {selected}", fg=FG_CYAN)
        elif installing > 0:
            self.lbl_summary.config(text=f"{spinner} ĐANG CÀI ĐẶT ({installing} MẠCH)...", fg=FG_AMBER)
        else:
            self.lbl_summary.config(text="⚡ STATE: STANDBY // SẴN SÀNG", fg=FG_AMBER)

        self.after(250, self.tick_hud_clock)

    def upsert_device_row(self, ip, mac=None, anydesk=None, status=None, selected=None, state=None):
        def _upd():
            with self.state_lock:
                if ip not in self.devices:
                    stt = len(self.devices) + 1
                    self.devices[ip] = {
                        "stt": f"{stt:02d}", "mac": mac or "ĐANG_ĐỌC...",
                        "anydesk": anydesk or "ĐANG_KIỂM_TRA...",
                        "selected": False if selected is None else selected,
                        "state": state or "ready",
                    }
                else:
                    if mac is not None: self.devices[ip]["mac"] = mac
                    if anydesk is not None: self.devices[ip]["anydesk"] = anydesk
                    if selected is not None: self.devices[ip]["selected"] = selected
                    if state is not None: self.devices[ip]["state"] = state

                d = self.devices[ip]
                tag = d["state"] if d["state"] in ("ready", "running", "done", "skipped", "error") else "ready"
                vals = (
                    "[X]" if d["selected"] else "[ ]", d["stt"], ip, d["mac"], d["anydesk"],
                    status if status is not None else (self.tree.item(ip, "values")[5] if self.tree.exists(ip) else "")
                )
            if self.tree.exists(ip):
                self.tree.item(ip, values=vals, tags=(tag,))
            else:
                self.tree.insert("", tk.END, iid=ip, values=vals, tags=(tag,))
                self.tree.see(ip)
        self.after(0, _upd)

    def toggle_select_all(self):
        with self.state_lock:
            candidates = [ip for ip, d in self.devices.items() if d["state"] in ("ready", "error") and ip not in self.active_installing_ips]
            if not candidates:
                candidates = [ip for ip in self.devices.keys() if ip not in self.active_installing_ips]
            any_unselected = any(not self.devices[ip]["selected"] for ip in candidates)
        for ip in candidates:
            self.upsert_device_row(ip, selected=any_unselected)

    def on_tree_click(self, event):
        region = self.tree.identify("region", event.x, event.y)
        if region == "cell" and self.tree.identify_column(event.x) == "#1":
            row_id = self.tree.identify_row(event.y)
            if row_id and row_id in self.devices and row_id not in self.active_installing_ips:
                curr = self.devices[row_id]["selected"]
                self.upsert_device_row(row_id, selected=not curr)

    def _set_clipboard(self, text, notify_msg=None):
        self.clipboard_clear()
        self.clipboard_append(text)
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
        ok, msg = open_anydesk_session(
            ad_id,
            password=DEFAULT_ANYDESK_PASS,
            clipboard_fn=lambda p: self._set_clipboard(p)
        )
        if not ok:
            messagebox.showwarning("AnyDesk", msg)
        else:
            self.log(f"💻 {msg}")

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

    def toggle_auto_install_mode(self):
        if self.scan_mode == "AUTO_INSTALL":
            self.scan_mode = "OFF"
            self.btn_auto_install.config(text="[ 🔁 01 // AUTO DÒ & CÀI: OFF ]", fg=FG_MATRIX, bg=BG_PANEL)
            self.log("⏸ Đã TẮT [AUTO DÒ & CÀI].")
            return
        self.scan_mode = "AUTO_INSTALL"
        self.btn_auto_install.config(text="[ 🟢 01 // AUTO DÒ & CÀI: ON ]", fg="#FFFFFF", bg="#0A471C")
        self.btn_auto_scan_only.config(text="[ 📡 02 // CHỈ AUTO DÒ: OFF ]", fg=FG_CYAN, bg=BG_PANEL)
        self.log("⚡ Đã BẬT [AUTO DÒ & CÀI]: Phát hiện mạch mới -> Cài luôn.")
        threading.Thread(target=self._scan_daemon, daemon=True).start()

    def toggle_scan_only_mode(self):
        if self.scan_mode == "SCAN_ONLY":
            self.scan_mode = "OFF"
            self.btn_auto_scan_only.config(text="[ 📡 02 // CHỈ AUTO DÒ: OFF ]", fg=FG_CYAN, bg=BG_PANEL)
            self.log("⏸ Đã TẮT [CHỈ AUTO DÒ].")
            return
        self.scan_mode = "SCAN_ONLY"
        self.btn_auto_scan_only.config(text="[ 🟢 02 // CHỈ AUTO DÒ: ON ]", fg="#FFFFFF", bg="#074352")
        self.btn_auto_install.config(text="[ 🔁 01 // AUTO DÒ & CÀI: OFF ]", fg=FG_MATRIX, bg=BG_PANEL)
        self.log("📡 Đã BẬT [CHỈ AUTO DÒ]: Tự dò đưa lên bảng, bạn tích [X] để cài.")
        threading.Thread(target=self._scan_daemon, daemon=True).start()

    def _scan_daemon(self):
        while self.scan_mode != "OFF":
            if not self.is_scanning_now:
                subnet = self.ent_subnet.get().strip()
                if subnet:
                    self._execute_scan(subnet, auto_install=(self.scan_mode == "AUTO_INSTALL"))
            try:
                interval = max(2, int(self.ent_interval.get().strip()))
            except Exception:
                interval = 4
            for _ in range(interval * 4):
                if self.scan_mode == "OFF": return
                time.sleep(0.25)

    def trigger_manual_scan_once(self):
        subnet = self.ent_subnet.get().strip()
        if not subnet:
            messagebox.showwarning("Thông báo", "Vui lòng nhập dải mạng LAN")
            return
        self.log(f"🔍 Đang dò 1 lần dải mạng {subnet}.1 -> .254...")
        threading.Thread(target=self._execute_scan, args=(subnet, False), daemon=True).start()

    def _execute_scan(self, subnet, auto_install=False):
        if self.is_scanning_now: return
        self.is_scanning_now = True
        try:
            ips = [f"{subnet}.{i}" for i in range(1, 255)]
            discovered = []
            with ThreadPoolExecutor(max_workers=64) as pool:
                futures = {pool.submit(self._probe_ip, ip): ip for ip in ips}
                for f in as_completed(futures):
                    res = f.result()
                    if res: discovered.append(res)

            discovered.sort(key=lambda x: int(x[0].split(".")[-1]))
            for ip, mac, has_anydesk, ad_id in discovered:
                with self.state_lock:
                    if ip in self.active_installing_ips: continue
                    already_done = (mac != "KHÔNG_RÕ_MAC" and mac in self.installed_macs)

                if already_done or has_anydesk:
                    self.upsert_device_row(ip, mac=mac, anydesk=ad_id if ad_id else "Đã có AnyDesk",
                                           selected=False, state="skipped",
                                           status=f"⏭ [SKIPPED] Đã có AnyDesk ({ad_id or 'OK'})")
                else:
                    if auto_install:
                        self.upsert_device_row(ip, mac=mac, anydesk="Chưa cài", selected=True, state="running",
                                               status="🎯 [MẠCH MỚI] Đang tự động chạy GĐ1...")
                        self._dispatch_install(ip)
                    else:
                        self.upsert_device_row(ip, mac=mac, anydesk="Chưa cài", selected=False, state="ready",
                                               status="🎯 [MẠCH MỚI] Tích chọn [X] để cài đặt")
        finally:
            self.is_scanning_now = False

    def _probe_ip(self, ip):
        with self.state_lock:
            if ip in self.active_installing_ips: return None
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.30)
        res = sock.connect_ex((ip, ADB_PORT))
        sock.close()
        if res != 0: return None

        subprocess.run([self.engine.adb_bin, "connect", f"{ip}:{ADB_PORT}"],
                       capture_output=True, timeout=6, creationflags=CREATE_NO_WINDOW)
        time.sleep(0.25)
        mac = self.engine.read_mac_address(ip)
        has_anydesk, ad_id = self.engine.check_anydesk_installed(ip)
        return (ip, mac, has_anydesk, ad_id)

    def start_manual_install_selected(self):
        with self.state_lock:
            selected_ips = [ip for ip, d in self.devices.items() if d["selected"] and ip not in self.active_installing_ips]
        if not selected_ips:
            messagebox.showinfo("Thông báo", "Chưa có mạch nào được tích [X]")
            return
        self.log(f"🚀 Bắt đầu cài đặt cho {len(selected_ips)} mạch đã chọn...")
        for ip in selected_ips:
            self._dispatch_install(ip)

    def _dispatch_install(self, ip):
        with self.state_lock:
            if ip in self.active_installing_ips: return
            self.active_installing_ips.add(ip)

        user = self.ent_user.get().strip()
        passwd = self.ent_pass.get().strip()
        backup = self.var_copy_backup.get()

        def _worker():
            try:
                def _status_cb(msg, state="running"):
                    self.upsert_device_row(ip, status=msg, state=state)
                ok, mac, ad_id = self.engine.install_stage1_flow(ip, user, passwd, backup, _status_cb)
                if ok:
                    with self.state_lock:
                        if mac and mac != "KHÔNG_RÕ_MAC": self.installed_macs.add(mac)
                    self.upsert_device_row(ip, mac=mac, anydesk=ad_id, selected=False, state="done",
                                           status=f"🎉 [PWNED_OK] Xong GĐ1! AnyDesk: {ad_id} | MAC: {mac}")
            except Exception as e:
                self.log(f"❌ [{ip}] Lỗi ngoại lệ: {e}")
                self.upsert_device_row(ip, status=f"❌ Lỗi: {e}", state="error")
            finally:
                with self.state_lock:
                    self.active_installing_ips.discard(ip)

        self.install_executor.submit(_worker)

    def reset_for_new_batch(self):
        with self.state_lock:
            if self.active_installing_ips:
                messagebox.showwarning("Cảnh báo", "Còn mạch đang cài đặt!")
                return
            self.devices.clear()
        for item in self.tree.get_children():
            self.tree.delete(item)
        self.log("♻ Đã làm mới bảng danh sách.")
