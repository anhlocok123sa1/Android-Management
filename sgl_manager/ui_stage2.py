import json
import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk

from .config import (
    BG_MAIN, BG_PANEL, BG_INPUT, BG_TABLE,
    FG_MATRIX, FG_CYAN, FG_AMBER, FG_RED, FG_DIM, FG_TEXT, BORDER_NEON
)

class Stage2Frame(tk.Frame):
    def __init__(self, parent, webhook_client=None):
        super().__init__(parent, bg=BG_MAIN)
        self.webhook = webhook_client

        self.devices = []
        self.templates = []
        self.selected_macs = set()
        self.is_loading = False

        self.setup_ui()
        self.refresh_all()

    def setup_ui(self):
        # 1. HEADER
        header_frame = tk.Frame(self, bg=BG_PANEL, pady=8, padx=14, highlightthickness=1, highlightbackground=BORDER_NEON)
        header_frame.pack(fill=tk.X, padx=10, pady=(8, 4))

        title_box = tk.Frame(header_frame, bg=BG_PANEL)
        title_box.pack(side=tk.LEFT)

        tk.Label(title_box, text=">_ GIAI ĐOẠN 2 // TRIỂN KHAI DỰ ÁN TỪ XA CHO THIẾT BỊ THỰC ĐỊA",
                 font=("Consolas", 12, "bold"), bg=BG_PANEL, fg=FG_MATRIX).pack(anchor="w")

        tk.Label(title_box, text="Chọn kịch bản dự án (1.66 / ICS / 3.6 / Script tùy biến) -> Gán cho hàng loạt box ngoài trụ điện",
                 font=("Consolas", 9), bg=BG_PANEL, fg=FG_CYAN).pack(anchor="w", pady=(2, 0))

        hud_box = tk.Frame(header_frame, bg=BG_PANEL)
        hud_box.pack(side=tk.RIGHT)

        self.lbl_summary = tk.Label(hud_box, text="[CHỌN: 00 MẠCH]  [KỊCH BẢN: CHƯA CHỌN]",
                                    font=("Consolas", 10, "bold"), bg=BG_PANEL, fg=FG_CYAN)
        self.lbl_summary.pack(anchor="e")

        # 2. MAIN SPLIT CONTAINER
        main_paned = tk.PanedWindow(self, orient=tk.HORIZONTAL, bg=BG_MAIN, sashwidth=4, bd=0)
        main_paned.pack(fill=tk.BOTH, expand=True, padx=10, pady=4)

        # ----------------- PANEL TRÁI: DANH SÁCH MỤC TIÊU -----------------
        left_frame = tk.Frame(main_paned, bg=BG_PANEL, padx=8, pady=6, highlightthickness=1, highlightbackground="#0E3A1A")
        main_paned.add(left_frame, minsize=550)

        top_left_bar = tk.Frame(left_frame, bg=BG_PANEL)
        top_left_bar.pack(fill=tk.X, pady=(0, 4))

        tk.Label(top_left_bar, text="DANH SÁCH THIẾT BỊ ONLINE / CHỜ TRIỂN KHAI:",
                 font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_MATRIX).pack(side=tk.LEFT)

        btn_select_all = tk.Button(
            top_left_bar, text="[ ☑ CHỌN TẤT CẢ ]", font=("Consolas", 8, "bold"),
            bg=BG_PANEL, fg=FG_TEXT, activebackground="#14291A", activeforeground="#FFFFFF",
            relief="flat", bd=0, highlightthickness=1, highlightbackground=FG_DIM,
            padx=6, pady=2, command=self.toggle_select_all
        )
        btn_select_all.pack(side=tk.RIGHT)

        btn_refresh_devs = tk.Button(
            top_left_bar, text="[ 🔄 LÀM MỚI ]", font=("Consolas", 8, "bold"),
            bg="#0D3B1A", fg=FG_MATRIX, activebackground="#165B2A", activeforeground="#FFFFFF",
            relief="flat", bd=0, padx=6, pady=2, command=self.load_devices
        )
        btn_refresh_devs.pack(side=tk.RIGHT, padx=4)

        columns = ("select", "mac", "anydesk", "project", "last_seen", "task")
        self.tree_devs = ttk.Treeview(left_frame, columns=columns, show="headings", height=12)
        self.tree_devs.heading("select", text="[X]")
        self.tree_devs.heading("mac", text="MAC ADDRESS")
        self.tree_devs.heading("anydesk", text="ANYDESK ID")
        self.tree_devs.heading("project", text="DỰ ÁN HIỆN TẠI")
        self.tree_devs.heading("last_seen", text="PING CUỐI")
        self.tree_devs.heading("task", text="TRẠNG THÁI TASK")

        self.tree_devs.column("select", width=40, anchor="center", stretch=False)
        self.tree_devs.column("mac", width=145, anchor="center", stretch=False)
        self.tree_devs.column("anydesk", width=120, anchor="center", stretch=False)
        self.tree_devs.column("project", width=105, anchor="center", stretch=False)
        self.tree_devs.column("last_seen", width=150, anchor="center", stretch=False)
        self.tree_devs.column("task", width=180, anchor="w", stretch=True)

        self.tree_devs.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.tree_devs.bind("<ButtonRelease-1>", self.on_device_click)

        scrollbar_l = ttk.Scrollbar(left_frame, orient=tk.VERTICAL, command=self.tree_devs.yview)
        self.tree_devs.configure(yscroll=scrollbar_l.set)
        scrollbar_l.pack(side=tk.RIGHT, fill=tk.Y)

        # ----------------- PANEL PHẢI: KỊCH BẢN & ĐIỀU KHIỂN -----------------
        right_frame = tk.Frame(main_paned, bg=BG_PANEL, padx=12, pady=8, highlightthickness=1, highlightbackground=BORDER_NEON)
        main_paned.add(right_frame, minsize=420)

        tk.Label(right_frame, text="CHỌN KỊCH BẢN DỰ ÁN (TEMPLATE):",
                 font=("Consolas", 10, "bold"), bg=BG_PANEL, fg=FG_AMBER).pack(anchor="w")

        tpl_bar = tk.Frame(right_frame, bg=BG_PANEL)
        tpl_bar.pack(fill=tk.X, pady=(4, 8))

        self.var_selected_template = tk.StringVar()
        self.cbo_templates = ttk.Combobox(tpl_bar, textvariable=self.var_selected_template, state="readonly", width=30)
        self.cbo_templates.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self.cbo_templates.bind("<<ComboboxSelected>>", self.on_template_selected)

        btn_refresh_tpls = tk.Button(
            tpl_bar, text="🔄", font=("Consolas", 9, "bold"),
            bg="#0D3B1A", fg=FG_MATRIX, relief="flat", bd=0, padx=8, pady=2, command=self.load_templates
        )
        btn_refresh_tpls.pack(side=tk.LEFT, padx=(4, 0))

        tk.Label(right_frame, text="CHI TIẾT CÁC BƯỚC THỰC THI (STEPS JSON):",
                 font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_CYAN).pack(anchor="w")

        self.txt_steps_preview = tk.Text(right_frame, height=10, bg=BG_INPUT, fg=FG_TEXT, font=("Consolas", 9),
                                         relief="flat", padx=8, pady=6, insertbackground=FG_MATRIX)
        self.txt_steps_preview.pack(fill=tk.BOTH, expand=True, pady=4)

        # Action Buttons
        act_box = tk.Frame(right_frame, bg=BG_PANEL)
        act_box.pack(fill=tk.X, pady=8)

        self.btn_deploy = tk.Button(
            act_box, text="[ 🚀 BẮT ĐẦU TRIỂN KHAI CHO CÁC MẠCH ĐÃ CHỌN ]", font=("Consolas", 10, "bold"),
            bg="#A85700", fg="#FFFFFF", activebackground="#D97706", activeforeground="#FFFFFF",
            relief="flat", bd=0, padx=12, pady=10, cursor="hand2", command=self.deploy_selected
        )
        self.btn_deploy.pack(fill=tk.X)

        self.lbl_deploy_result = tk.Label(right_frame, text="", font=("Consolas", 9), bg=BG_PANEL, fg=FG_MATRIX, wraplength=400)
        self.lbl_deploy_result.pack(anchor="w", pady=4)

    def refresh_all(self):
        self.load_templates()
        self.load_devices()

    def load_templates(self):
        def _worker():
            tpls = []
            if self.webhook:
                tpls = self.webhook.get_templates()
            # Mẫu mặc định nếu Sheet chưa có
            if not tpls:
                tpls = [
                    {
                        "template_name": "deploy_radio_166",
                        "description": "Gỡ 3.6, cài Radio 1.66",
                        "steps_json": json.dumps([
                            {"action": "uninstall_pkg", "params": {"package": "com.radiostation"}},
                            {"action": "install_apk", "params": {"file": "radio.apk"}},
                            {"action": "report_field", "params": {"field": "project", "value": "Radio 1.66"}}
                        ], indent=2)
                    },
                    {
                        "template_name": "deploy_vnpt_ics",
                        "description": "Gỡ Radio, cài đặt VNPT ICS",
                        "steps_json": json.dumps([
                            {"action": "uninstall_pkg", "params": {"package": "com.radiostation"}},
                            {"action": "install_apk", "params": {"file": "ics-android-box (2.0.0).apk"}},
                            {"action": "report_field", "params": {"field": "project", "value": "ICS"}}
                        ], indent=2)
                    },
                    {
                        "template_name": "update_autosetup_agent",
                        "description": "Nâng cấp Agent từ xa",
                        "steps_json": json.dumps([
                            {"action": "download_apk", "params": {"url": "https://example.com/00_AutoSetup_v2.apk", "save_as": "AutoSetup_v2.apk"}},
                            {"action": "install_apk", "params": {"file": "AutoSetup_v2.apk"}}
                        ], indent=2)
                    }
                ]
            self.templates = tpls
            names = [t.get("template_name", "") for t in tpls]
            self.after(0, lambda: self._update_cbo_templates(names))

        threading.Thread(target=_worker, daemon=True).start()

    def _update_cbo_templates(self, names):
        self.cbo_templates["values"] = names
        if names:
            self.cbo_templates.current(0)
            self.on_template_selected(None)

    def on_template_selected(self, _):
        sel_name = self.var_selected_template.get()
        for t in self.templates:
            if t.get("template_name") == sel_name:
                raw = t.get("steps_json", "[]")
                try:
                    pretty = json.dumps(json.loads(raw), indent=2, ensure_ascii=False)
                except Exception:
                    pretty = raw
                self.txt_steps_preview.delete("1.0", tk.END)
                self.txt_steps_preview.insert(tk.END, pretty)
                self.update_summary()
                break

    def load_devices(self):
        def _worker():
            data = []
            if self.webhook:
                data = self.webhook.get_devices()
            self.devices = data
            self.after(0, self._render_devices)

        threading.Thread(target=_worker, daemon=True).start()

    def _render_devices(self):
        for item in self.tree_devs.get_children():
            self.tree_devs.delete(item)

        for d in self.devices:
            mac = d.get("mac", "")
            ad_id = d.get("anydesk_id", "")
            proj = d.get("project", "Chưa gán")
            last_seen = d.get("last_seen", "Chưa có")
            task = d.get("task_id", "idle")
            is_sel = mac in self.selected_macs

            vals = ("[X]" if is_sel else "[ ]", mac, ad_id, proj, last_seen, task)
            self.tree_devs.insert("", tk.END, iid=mac, values=vals)

        self.update_summary()

    def on_device_click(self, event):
        region = self.tree_devs.identify("region", event.x, event.y)
        if region == "cell" and self.tree_devs.identify_column(event.x) == "#1":
            mac = self.tree_devs.identify_row(event.y)
            if mac:
                if mac in self.selected_macs:
                    self.selected_macs.remove(mac)
                else:
                    self.selected_macs.add(mac)
                self._update_row_check(mac)
                self.update_summary()

    def _update_row_check(self, mac):
        if self.tree_devs.exists(mac):
            vals = list(self.tree_devs.item(mac, "values"))
            vals[0] = "[X]" if mac in self.selected_macs else "[ ]"
            self.tree_devs.item(mac, values=vals)

    def toggle_select_all(self):
        if len(self.selected_macs) == len(self.devices) and len(self.devices) > 0:
            self.selected_macs.clear()
        else:
            self.selected_macs = {d.get("mac") for d in self.devices if d.get("mac")}
        for d in self.devices:
            mac = d.get("mac")
            if mac: self._update_row_check(mac)
        self.update_summary()

    def update_summary(self):
        tpl = self.var_selected_template.get() or "Chưa chọn"
        cnt = len(self.selected_macs)
        self.lbl_summary.config(text=f"[CHỌN: {cnt:02d} MẠCH]  [KỊCH BẢN: {tpl}]")

    def deploy_selected(self):
        if not self.selected_macs:
            messagebox.showwarning("Thông báo", "Vui lòng chọn ít nhất 1 thiết bị để triển khai!")
            return
        tpl_name = self.var_selected_template.get()
        if not tpl_name:
            messagebox.showwarning("Thông báo", "Vui lòng chọn một kịch bản dự án!")
            return

        cnt = len(self.selected_macs)
        confirm = messagebox.askyesno(
            "Xác nhận triển khai từ xa",
            f"Bạn có chắc muốn giao nhiệm vụ '{tpl_name}' cho {cnt} thiết bị được chọn?\n\n"
            "Các box ngoài trụ điện sẽ nhận lệnh qua SIM 4G và tự động thực thi trong chu kỳ heartbeat tiếp theo (tối đa 5 phút)."
        )
        if not confirm:
            return

        self.btn_deploy.config(text="[ ⏳ ĐANG GỬI LỆNH LÊN SHEET... ]", state=tk.DISABLED)

        def _worker():
            mac_list = list(self.selected_macs)
            task_ids = []
            if self.webhook:
                task_ids = self.webhook.create_task(tpl_name, mac_list)

            def _done():
                self.btn_deploy.config(text="[ 🚀 BẮT ĐẦU TRIỂN KHAI CHO CÁC MẠCH ĐÃ CHỌN ]", state=tk.NORMAL)
                if task_ids:
                    msg = f"✔ Đã tạo thành công {len(task_ids)} tasks trên Google Sheet!\nTask IDs: {', '.join(task_ids[:3])}..."
                    self.lbl_deploy_result.config(text=msg, fg=FG_MATRIX)
                    messagebox.showinfo("Thành công", msg)
                else:
                    self.lbl_deploy_result.config(text="❌ Không thể tạo task trên Sheet. Kiểm tra Webhook!", fg=FG_RED)
                self.load_devices()

            self.after(0, _done)

        threading.Thread(target=_worker, daemon=True).start()
