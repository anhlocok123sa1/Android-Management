import os
import subprocess
import threading
import time
from datetime import datetime, timezone
import tkinter as tk
from tkinter import messagebox, ttk

from .config import (
    BG_MAIN, BG_PANEL, BG_INPUT, BG_TABLE,
    FG_MATRIX, FG_CYAN, FG_AMBER, FG_RED, FG_DIM, FG_TEXT, BORDER_NEON
)

class DashboardFrame(tk.Frame):
    def __init__(self, parent, webhook_client=None):
        super().__init__(parent, bg=BG_MAIN)
        self.webhook = webhook_client

        self.devices_data = []
        self.is_refreshing = False

        self.setup_ui()
        self.refresh()
        self.auto_refresh_loop()

    def setup_ui(self):
        # 1. HEADER & THỐNG KÊ
        header_frame = tk.Frame(self, bg=BG_PANEL, pady=8, padx=14, highlightthickness=1, highlightbackground=BORDER_NEON)
        header_frame.pack(fill=tk.X, padx=10, pady=(8, 4))

        title_box = tk.Frame(header_frame, bg=BG_PANEL)
        title_box.pack(side=tk.LEFT)

        tk.Label(title_box, text=">_ DASHBOARD // GIÁM SÁT THIẾT BỊ THỰC ĐỊA (TRỤ ĐIỆN / SIM 4G)",
                 font=("Consolas", 12, "bold"), bg=BG_PANEL, fg=FG_MATRIX).pack(anchor="w")

        tk.Label(title_box, text="Theo dõi nhịp tim (Heartbeat), thời gian hoạt động, phiên bản App và trạng thái AnyDesk",
                 font=("Consolas", 9), bg=BG_PANEL, fg=FG_CYAN).pack(anchor="w", pady=(2, 0))

        hud_box = tk.Frame(header_frame, bg=BG_PANEL)
        hud_box.pack(side=tk.RIGHT)

        self.lbl_stats = tk.Label(hud_box, text="[TỔNG: 00]  [🟢 ONLINE: 00]  [🟡 CHẬM: 00]  [🔴 OFFLINE: 00]",
                                  font=("Consolas", 10, "bold"), bg=BG_PANEL, fg=FG_CYAN)
        self.lbl_stats.pack(anchor="e")

        self.lbl_last_sync = tk.Label(hud_box, text="Cập nhật lần cuối: Chưa đồng bộ",
                                      font=("Consolas", 9), bg=BG_PANEL, fg=FG_AMBER)
        self.lbl_last_sync.pack(anchor="e", pady=(2, 0))

        # 2. FILTER & ACTION BAR
        filter_frame = tk.Frame(self, bg=BG_PANEL, padx=12, pady=6, highlightthickness=1, highlightbackground="#0E3A1A")
        filter_frame.pack(fill=tk.X, padx=10, pady=3)

        tk.Label(filter_frame, text="DỰ ÁN:", bg=BG_PANEL, fg=FG_MATRIX, font=("Consolas", 9, "bold")).pack(side=tk.LEFT)
        self.var_filter_project = tk.StringVar(value="TẤT CẢ")
        opt_project = ttk.Combobox(filter_frame, textvariable=self.var_filter_project,
                                   values=["TẤT CẢ", "Android Mới", "1.66", "ICS", "3.6"], width=13, state="readonly")
        opt_project.pack(side=tk.LEFT, padx=(4, 14))
        opt_project.bind("<<ComboboxSelected>>", lambda _: self.apply_filter())

        tk.Label(filter_frame, text="TRẠNG THÁI:", bg=BG_PANEL, fg=FG_CYAN, font=("Consolas", 9, "bold")).pack(side=tk.LEFT)
        self.var_filter_status = tk.StringVar(value="TẤT CẢ")
        opt_status = ttk.Combobox(filter_frame, textvariable=self.var_filter_status,
                                  values=["TẤT CẢ", "🟢 Online", "🟡 Chậm", "🔴 Offline", "⚠️ Lỗi"], width=13, state="readonly")
        opt_status.pack(side=tk.LEFT, padx=(4, 14))
        opt_status.bind("<<ComboboxSelected>>", lambda _: self.apply_filter())

        self.btn_refresh = tk.Button(
            filter_frame, text="[ 🔄 LÀM MỚI ]", font=("Consolas", 9, "bold"),
            bg="#0D3B1A", fg=FG_MATRIX, activebackground="#165B2A", activeforeground="#FFFFFF",
            relief="flat", bd=0, padx=10, pady=4, cursor="hand2", command=self.refresh
        )
        self.btn_refresh.pack(side=tk.LEFT, padx=4)

        self.btn_copy_ad = tk.Button(
            filter_frame, text="[ 📋 SAO CHÉP ANYDESK ]", font=("Consolas", 9, "bold"),
            bg=BG_PANEL, fg=FG_AMBER, activebackground="#3A2805", activeforeground="#FFFFFF",
            relief="flat", bd=0, highlightthickness=1, highlightbackground=FG_AMBER,
            padx=10, pady=4, cursor="hand2", command=self.copy_selected_anydesk
        )
        self.btn_copy_ad.pack(side=tk.LEFT, padx=6)

        self.btn_open_ad = tk.Button(
            filter_frame, text="[ ⚡ MỞ ANYDESK ]", font=("Consolas", 9, "bold"),
            bg=BG_PANEL, fg=FG_CYAN, activebackground="#073642", activeforeground="#FFFFFF",
            relief="flat", bd=0, highlightthickness=1, highlightbackground=FG_CYAN,
            padx=10, pady=4, cursor="hand2", command=self.open_selected_anydesk
        )
        self.btn_open_ad.pack(side=tk.LEFT, padx=6)

        # 3. BẢNG DANH SÁCH THIẾT BỊ
        table_frame = tk.Frame(self, bg=BG_PANEL, padx=2, pady=2, highlightthickness=1, highlightbackground=BORDER_NEON)
        table_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=(3, 8))

        columns = ("stt", "mac", "anydesk", "project", "state_label", "last_seen", "app_ver", "storage", "task")
        self.tree = ttk.Treeview(table_frame, columns=columns, show="headings", height=15)

        self.tree.heading("stt", text="STT")
        self.tree.heading("mac", text="MAC ADDRESS")
        self.tree.heading("anydesk", text="ANYDESK ID")
        self.tree.heading("project", text="DỰ ÁN")
        self.tree.heading("state_label", text="TRẠNG THÁI")
        self.tree.heading("last_seen", text="PING CUỐI (HEARTBEAT)")
        self.tree.heading("app_ver", text="APP VERSION")
        self.tree.heading("storage", text="TRỐNG (MB)")
        self.tree.heading("task", text="TASK HIỆN TẠI")

        self.tree.column("stt", width=45, anchor="center", stretch=False)
        self.tree.column("mac", width=160, anchor="center", stretch=False)
        self.tree.column("anydesk", width=140, anchor="center", stretch=False)
        self.tree.column("project", width=110, anchor="center", stretch=False)
        self.tree.column("state_label", width=120, anchor="center", stretch=False)
        self.tree.column("last_seen", width=170, anchor="center", stretch=False)
        self.tree.column("app_ver", width=95, anchor="center", stretch=False)
        self.tree.column("storage", width=90, anchor="center", stretch=False)
        self.tree.column("task", width=300, anchor="w", stretch=True)

        self.tree.tag_configure("online", foreground=FG_MATRIX, background=BG_TABLE)
        self.tree.tag_configure("slow", foreground=FG_AMBER, background="#1F1705")
        self.tree.tag_configure("offline", foreground=FG_RED, background="#2A070E")
        self.tree.tag_configure("error", foreground="#FF1744", background="#330000")

        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        scrollbar = ttk.Scrollbar(table_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscroll=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Context Menu chuột phải
        self.menu = tk.Menu(self, tearoff=0, bg=BG_PANEL, fg=FG_TEXT, activebackground="#0F381E", activeforeground="#FFFFFF")
        self.menu.add_command(label="Mở AnyDesk", command=self.open_selected_anydesk)
        self.menu.add_command(label="Sao chép AnyDesk ID", command=self.copy_selected_anydesk)
        self.menu.add_command(label="Sao chép MAC Address", command=self.copy_selected_mac)
        self.menu.add_separator()
        self.menu.add_command(label="Làm mới dữ liệu", command=self.refresh)

        self.tree.bind("<Button-3>", self.show_context_menu)

    def show_context_menu(self, event):
        item = self.tree.identify_row(event.y)
        if item:
            self.tree.selection_set(item)
            self.menu.post(event.x_root, event.y_root)

    def parse_time_diff_minutes(self, time_str):
        if not time_str or time_str in ("Chưa có", "None", ""):
            return 999999
        s = str(time_str).strip()
        # 1. Thử ISO-8601 (chứa T và có Z hoặc offset UTC từ Google Apps Script)
        try:
            if "T" in s:
                clean_s = s.replace("Z", "+00:00")
                dt = datetime.fromisoformat(clean_s)
                if dt.tzinfo is not None:
                    diff_sec = (datetime.now(timezone.utc) - dt).total_seconds()
                else:
                    diff_sec = (datetime.now() - dt).total_seconds()
                return max(0.0, diff_sec / 60.0)
        except Exception:
            pass

        # 2. Thử các format thông dụng đối chiếu cả giờ Local lẫn UTC chống lệch múi giờ
        formats = [
            "%Y-%m-%d %H:%M:%S",
            "%d/%m/%Y %H:%M:%S",
            "%Y-%m-%dT%H:%M:%S",
            "%m/%d/%Y %H:%M:%S",
            "%Y/%m/%d %H:%M:%S"
        ]
        now_local = datetime.now()
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        for fmt in formats:
            try:
                base_s = s.split(".")[0]
                dt = datetime.strptime(base_s, fmt)
                diff_l = (now_local - dt).total_seconds()
                diff_u = (now_utc - dt).total_seconds()
                valid = [d for d in (diff_l, diff_u) if d >= -120]
                if valid:
                    return max(0.0, min(valid) / 60.0)
            except Exception:
                continue
        return 999999

    def evaluate_status(self, device):
        dev_status = str(device.get("status", "")).lower()
        if "fail" in dev_status or "error" in dev_status:
            return "⚠️ Lỗi", "error"

        last_seen = device.get("last_seen", "")
        mins = self.parse_time_diff_minutes(last_seen)
        if mins <= 15:
            return "🟢 Online", "online"
        elif mins <= 45:
            return "🟡 Chậm", "slow"
        else:
            return "🔴 Offline", "offline"

    def refresh(self):
        if self.is_refreshing:
            return
        self.is_refreshing = True
        self.btn_refresh.config(text="[ ⏳ ĐANG TẢI... ]")

        def _worker():
            data = []
            if self.webhook:
                data = self.webhook.get_devices()
            self.devices_data = data
            self.after(0, self._render_devices)

        threading.Thread(target=_worker, daemon=True).start()

    def _render_devices(self):
        self.is_refreshing = False
        self.btn_refresh.config(text="[ 🔄 LÀM MỚI ]")
        self.lbl_last_sync.config(text=f"Cập nhật: {time.strftime('%H:%M:%S')} ({len(self.devices_data)} thiết bị)")
        self.apply_filter()

    def apply_filter(self):
        filter_proj = self.var_filter_project.get()
        filter_stat = self.var_filter_status.get()

        for item in self.tree.get_children():
            self.tree.delete(item)

        cnt_total = len(self.devices_data)
        cnt_online = 0
        cnt_slow = 0
        cnt_offline = 0

        stt = 1
        for d in self.devices_data:
            mac = d.get("mac", "")
            ad_id = d.get("anydesk_id", "")
            proj = d.get("project", "Chưa gán")
            last_seen = d.get("last_seen", "Chưa có")
            app_ver = d.get("app_version", "1.0")
            storage = str(d.get("storage_mb", "0"))
            task = d.get("task_id", "idle")

            label, tag = self.evaluate_status(d)

            if tag == "online": cnt_online += 1
            elif tag == "slow": cnt_slow += 1
            else: cnt_offline += 1

            # Lọc theo dự án
            if filter_proj != "TẤT CẢ" and filter_proj != proj:
                continue
            # Lọc theo trạng thái
            if filter_stat != "TẤT CẢ" and filter_stat != label:
                continue

            mins = self.parse_time_diff_minutes(last_seen)
            if mins < 1:
                disp_last = "🟢 Vừa xong"
            elif mins < 60:
                disp_last = f"{int(mins)} phút trước"
            elif mins < 1440:
                disp_last = f"{int(mins / 60)} giờ trước"
            elif last_seen and last_seen != "Chưa có":
                disp_last = str(last_seen).replace("T", " ").split(".")[0]
            else:
                disp_last = "Chưa nhận ping"

            vals = (f"{stt:02d}", mac, ad_id, proj, label, disp_last, app_ver, storage, task)
            self.tree.insert("", tk.END, iid=mac if mac else f"row_{stt}", values=vals, tags=(tag,))
            stt += 1

        self.lbl_stats.config(
            text=f"[TỔNG: {cnt_total:02d}]  [🟢 ONLINE: {cnt_online:02d}]  [🟡 CHẬM: {cnt_slow:02d}]  [🔴 OFFLINE: {cnt_offline:02d}]"
        )

    def auto_refresh_loop(self):
        self.refresh()
        self.after(60000, self.auto_refresh_loop)

    def copy_selected_anydesk(self):
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo("Thông báo", "Vui lòng chọn thiết bị trên bảng")
            return
        vals = self.tree.item(sel[0], "values")
        if vals and len(vals) > 2:
            ad_id = vals[2]
            self.clipboard_clear()
            self.clipboard_append(ad_id)
            messagebox.showinfo("Đã sao chép", f"Đã chép AnyDesk ID: {ad_id}")

    def copy_selected_mac(self):
        sel = self.tree.selection()
        if not sel: return
        vals = self.tree.item(sel[0], "values")
        if vals and len(vals) > 1:
            mac = vals[1]
            self.clipboard_clear()
            self.clipboard_append(mac)
            messagebox.showinfo("Đã sao chép", f"Đã chép MAC: {mac}")

    def open_selected_anydesk(self):
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo("Thông báo", "Vui lòng chọn thiết bị trên bảng")
            return
        vals = self.tree.item(sel[0], "values")
        if not vals or len(vals) <= 2: return
        ad_id = vals[2]
        if not ad_id or "Chưa" in ad_id:
            messagebox.showwarning("Cảnh báo", "Thiết bị này chưa có AnyDesk ID!")
            return

        # Gọi AnyDesk client trên Windows
        anydesk_paths = [
            "anydesk",
            os.path.expandvars(r"%ProgramFiles(x86)%\AnyDesk\AnyDesk.exe"),
            os.path.expandvars(r"%ProgramFiles%\AnyDesk\AnyDesk.exe"),
            os.path.expandvars(r"%LocalAppData%\AnyDesk\AnyDesk.exe")
        ]
        opened = False
        for p in anydesk_paths:
            try:
                subprocess.Popen([p, ad_id])
                opened = True
                break
            except Exception:
                continue

        if not opened:
            self.clipboard_clear()
            self.clipboard_append(ad_id)
            messagebox.showinfo("AnyDesk", f"Không tìm thấy phần mềm AnyDesk trên máy.\nĐã sao chép ID: {ad_id} vào Clipboard!")
