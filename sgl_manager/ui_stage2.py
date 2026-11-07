import json
import threading
import time
import tkinter as tk
from tkinter import messagebox, simpledialog, ttk

from .config import (
    BG_MAIN, BG_PANEL, BG_INPUT, BG_TABLE,
    FG_MATRIX, FG_CYAN, FG_AMBER, FG_RED, FG_DIM, FG_TEXT, BORDER_NEON,
    DEFAULT_ANYDESK_PASS, open_anydesk_session
)
from .ui_onboarder import OnboarderDialog

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

        tk.Label(top_left_bar, text="DỰ ÁN:",
                 font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_MATRIX).pack(side=tk.LEFT)

        self.var_filter_project = tk.StringVar(value="TẤT CẢ")
        self.cbo_filter_project = ttk.Combobox(top_left_bar, textvariable=self.var_filter_project,
                                               values=["TẤT CẢ"], width=16, state="readonly")
        self.cbo_filter_project.pack(side=tk.LEFT, padx=(4, 8))
        self.cbo_filter_project.bind("<<ComboboxSelected>>", lambda _: self._render_devices())

        btn_assign_proj = tk.Button(
            top_left_bar, text="[ 📁 GÁN DỰ ÁN ]", font=("Consolas", 8, "bold"),
            bg="#0F2D3A", fg=FG_CYAN, activebackground="#154B60", activeforeground="#FFFFFF",
            relief="flat", bd=0, highlightthickness=1, highlightbackground=FG_CYAN,
            padx=6, pady=2, command=self.assign_project_selected
        )
        btn_assign_proj.pack(side=tk.LEFT, padx=4)

        btn_onboard = tk.Button(
            top_left_bar, text="[ 🔌 ONBOARD ]", font=("Consolas", 8, "bold"),
            bg="#2E1800", fg=FG_AMBER, activebackground="#5E3200", activeforeground="#FFFFFF",
            relief="flat", bd=0, highlightthickness=1, highlightbackground=FG_AMBER,
            padx=6, pady=2, command=self.open_onboarder_dialog
        )
        btn_onboard.pack(side=tk.LEFT, padx=4)

        btn_select_all = tk.Button(
            top_left_bar, text="[ ☑ CHỌN HẾT ]", font=("Consolas", 8, "bold"),
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

        columns = ("select", "mac", "anydesk", "project", "software", "mac_ics", "last_seen", "task")
        self.tree_devs = ttk.Treeview(left_frame, columns=columns, show="headings", height=12)
        self.tree_devs.heading("select", text="[X]")
        self.tree_devs.heading("mac", text="MAC ADDRESS")
        self.tree_devs.heading("anydesk", text="ANYDESK ID")
        self.tree_devs.heading("project", text="DỰ ÁN HIỆN TẠI")
        self.tree_devs.heading("software", text="PHẦN MỀM")
        self.tree_devs.heading("mac_ics", text="MÃ ICS")
        self.tree_devs.heading("last_seen", text="PING CUỐI")
        self.tree_devs.heading("task", text="TRẠNG THÁI TASK")

        self.tree_devs.column("select", width=35, anchor="center", stretch=False)
        self.tree_devs.column("mac", width=140, anchor="center", stretch=False)
        self.tree_devs.column("anydesk", width=115, anchor="center", stretch=False)
        self.tree_devs.column("project", width=130, anchor="w", stretch=False)
        self.tree_devs.column("software", width=100, anchor="center", stretch=False)
        self.tree_devs.column("mac_ics", width=115, anchor="center", stretch=False)
        self.tree_devs.column("last_seen", width=140, anchor="center", stretch=False)
        self.tree_devs.column("task", width=160, anchor="w", stretch=True)

        self.tree_devs.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.tree_devs.bind("<ButtonRelease-1>", self.on_device_click)
        self.tree_devs.bind("<Double-1>", lambda _: self.open_selected_anydesk())
        self.tree_devs.bind("<Button-3>", self.show_context_menu)

        # Context Menu chuột phải
        self.menu = tk.Menu(self, tearoff=0, bg=BG_PANEL, fg=FG_TEXT, activebackground="#0F381E", activeforeground="#FFFFFF")
        self.menu.add_command(label="💻 Mở AnyDesk (Tự động nạp Pass: 12345678j)", command=self.open_selected_anydesk)
        self.menu.add_command(label="📋 Sao chép Mật khẩu (12345678j)", command=lambda: self._set_clipboard(DEFAULT_ANYDESK_PASS, "Đã sao chép mật khẩu AnyDesk (12345678j)"))
        self.menu.add_command(label="📋 Sao chép AnyDesk ID", command=self.copy_selected_anydesk)
        self.menu.add_command(label="📋 Sao chép MAC Address", command=self.copy_selected_mac)
        self.menu.add_command(label="📋 Sao chép Mã ICS", command=self.copy_selected_ics)
        self.menu.add_separator()
        self.menu.add_command(label="📁 Gán / Đổi Dự Án...", command=self.assign_project_selected)
        self.menu.add_command(label="🔌 Onboard Box này qua AnyDesk (1-Click)", command=self.open_onboarder_dialog)

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
            # Mẫu mặc định nếu Sheet chưa có -> đồng bộ luôn lên Google Sheet
            if not tpls:
                tpls = [
                    {
                        "template_name": "deploy_radio_36",
                        "description": "Chốt dự án Radio 3.6 (Đăng xuất tài khoản test, giữ app 3.6)",
                        "steps_json": json.dumps([
                            {"action": "shell_cmd", "params": {"cmd": "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation"}},
                            {"action": "report_field", "params": {"field": "software", "value": "Radio 3.6"}}
                        ], indent=2)
                    },
                    {
                        "template_name": "deploy_vnpt_ics",
                        "description": "Chuyển sang VNPT ICS (Gỡ 3.6, cài ICS, tự động lấy MAC ICS lên Sheet)",
                        "steps_json": json.dumps([
                            {"action": "uninstall_pkg", "params": {"package": "vn.phitn.app.radiostation"}},
                            {"action": "install_apk", "params": {"file": "ics-android-box (2.0.0).apk"}},
                            {"action": "start_app", "params": {"package": "com.app.ics_content_management", "fallback_package": "vnpt.smartcomm.radio", "activity": "vnpt.smartcomm.radio.activity.SplashActivity"}},
                            {"action": "extract_ics_mac", "params": {"package": "com.app.ics_content_management", "fallback_package": "vnpt.smartcomm.radio"}},
                            {"action": "report_field", "params": {"field": "software", "value": "VNPT ICS"}}
                        ], indent=2)
                    },
                    {
                        "template_name": "deploy_radio_166",
                        "description": "Chuyển sang Radio 1.66 (Gỡ 3.6, cài Radio 1.66)",
                        "steps_json": json.dumps([
                            {"action": "uninstall_pkg", "params": {"package": "vn.phitn.app.radiostation"}},
                            {"action": "install_apk", "params": {"file": "radio.apk"}},
                            {"action": "report_field", "params": {"field": "software", "value": "Radio 1.66"}}
                        ], indent=2)
                    },
                    {
                        "template_name": "deploy_radio_20",
                        "description": "Nâng cấp Radio 2.0 (Đọc thông tin 14 input từ Google Sheet)",
                        "steps_json": json.dumps([
                            {"action": "uninstall_pkg", "params": {"package": "vn.phitn.app.radiostation"}},
                            {"action": "install_apk", "params": {"file": "Radio2.0.apk"}},
                            {"action": "fetch_config", "params": {"sheet": "Config_Radio20", "key": "mac"}},
                            {"action": "report_field", "params": {"field": "software", "value": "Radio 2.0"}}
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
                if self.webhook:
                    for dt in tpls:
                        try:
                            self.webhook.save_template(dt["template_name"], dt["steps_json"], dt.get("description", ""))
                        except Exception:
                            pass
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
        # Cập nhật danh sách dự án động vào bộ lọc
        projects = set()
        for d in self.devices:
            p = str(d.get("project", "")).strip()
            if p and p != "None":
                projects.add(p)
        sorted_projs = ["TẤT CẢ"] + sorted(list(projects))
        self.cbo_filter_project["values"] = sorted_projs
        if self.var_filter_project.get() not in sorted_projs:
            self.var_filter_project.set("TẤT CẢ")

        filter_proj = self.var_filter_project.get()

        for item in self.tree_devs.get_children():
            self.tree_devs.delete(item)

        for d in self.devices:
            mac = d.get("mac", "")
            ad_id = d.get("anydesk_id", "")
            proj = d.get("project") or "Chưa gán"
            soft = d.get("software") or "Radio 3.6"
            mac_ics = d.get("mac_ics") or "-"
            last_seen = d.get("last_seen", "Chưa có")
            task = d.get("task_id", "idle")

            # Lọc theo dự án nếu có chọn
            if filter_proj != "TẤT CẢ" and filter_proj != proj:
                continue

            is_sel = mac in self.selected_macs

            vals = ("[X]" if is_sel else "[ ]", mac, ad_id, proj, soft, mac_ics, last_seen, task)
            self.tree_devs.insert("", tk.END, iid=mac, values=vals)

        self.update_summary()

    def _set_clipboard(self, text, notify_msg=None):
        self.clipboard_clear()
        self.clipboard_append(text)
        if notify_msg:
            messagebox.showinfo("Đã sao chép", notify_msg)

    def show_context_menu(self, event):
        item = self.tree_devs.identify_row(event.y)
        if item:
            self.tree_devs.selection_set(item)
            self.menu.post(event.x_root, event.y_root)

    def open_selected_anydesk(self):
        sel = self.tree_devs.selection()
        if not sel: return
        vals = self.tree_devs.item(sel[0], "values")
        if not vals or len(vals) < 3: return
        ad_id = vals[2]
        if not ad_id or "Chưa" in ad_id:
            messagebox.showwarning("Cảnh báo", f"Thiết bị {vals[1]} chưa có AnyDesk ID!")
            return
        ok, msg = open_anydesk_session(
            ad_id,
            password=DEFAULT_ANYDESK_PASS,
            clipboard_fn=lambda p: self._set_clipboard(p)
        )
        if not ok:
            messagebox.showwarning("AnyDesk", msg)

    def copy_selected_anydesk(self):
        sel = self.tree_devs.selection()
        if not sel: return
        vals = self.tree_devs.item(sel[0], "values")
        if vals and len(vals) >= 3:
            self._set_clipboard(vals[2], f"Đã chép AnyDesk ID: {vals[2]}")

    def copy_selected_mac(self):
        sel = self.tree_devs.selection()
        if not sel: return
        vals = self.tree_devs.item(sel[0], "values")
        if vals and len(vals) >= 2:
            self._set_clipboard(vals[1], f"Đã chép MAC: {vals[1]}")

    def copy_selected_ics(self):
        sel = self.tree_devs.selection()
        if not sel: return
        vals = self.tree_devs.item(sel[0], "values")
        if vals and len(vals) > 5:
            ics = vals[5]
            if ics and ics != "-":
                self._set_clipboard(ics, f"Đã chép Mã ICS: {ics}")
            else:
                messagebox.showinfo("Thông báo", "Thiết bị này chưa có mã ICS")

    def assign_project_selected(self):
        target_macs = list(self.selected_macs)
        # Nếu chưa tick ô chọn nào thì lấy row đang focus
        if not target_macs:
            sel = self.tree_devs.selection()
            if sel:
                vals = self.tree_devs.item(sel[0], "values")
                if vals and len(vals) > 1:
                    target_macs = [vals[1]]

        if not target_macs:
            messagebox.showinfo("Thông báo", "Vui lòng tick chọn [X] các thiết bị cần gán dự án!")
            return

        prompt_text = f"Nhập tên Dự án mới cho {len(target_macs)} thiết bị được chọn:\n(Ví dụ: Xã Xuyên Mộc (102 box), Huyện Châu Đức, Kho thiết bị...)"
        new_proj = simpledialog.askstring("Gán Dự Án Hàng Loạt", prompt_text, initialvalue="Kho thiết bị")
        if new_proj is None:
            return
        new_proj = new_proj.strip()
        if not new_proj:
            messagebox.showwarning("Cảnh báo", "Tên dự án không được để trống!")
            return

        def _worker():
            ok = False
            if self.webhook:
                ok = self.webhook.assign_project(target_macs, new_proj)
            def _done():
                if ok:
                    messagebox.showinfo("Thành công", f"✔ Đã gán {len(target_macs)} thiết bị vào dự án:\n'{new_proj}'")
                    self.load_devices()
                else:
                    messagebox.showwarning("Lỗi", "Không thể cập nhật dự án lên Google Sheet. Vui lòng kiểm tra lại mạng!")
            self.after(0, _done)

        threading.Thread(target=_worker, daemon=True).start()

    def open_onboarder_dialog(self):
        sel = self.tree_devs.selection()
        target_dev = None
        if sel:
            vals = self.tree_devs.item(sel[0], "values")
            if vals and len(vals) > 1:
                sel_mac = vals[1]
                for d in self.devices:
                    if d.get("mac") == sel_mac:
                        target_dev = d
                        break

        # Tìm các thiết bị chưa Online hoặc được chọn
        offline_devs = []
        for d in self.devices:
            st = str(d.get("status", "")).lower()
            if "online" not in st:
                offline_devs.append(d)

        if not offline_devs and not target_dev:
            offline_devs = self.devices

        OnboarderDialog(
            self,
            target_device=target_dev or (offline_devs[0] if offline_devs else None),
            device_list=offline_devs,
            webhook_client=self.webhook,
            on_success_cb=lambda _: self.load_devices()
        )

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
                tpl_obj = next((t for t in self.templates if t.get("template_name") == tpl_name), {})
                task_ids = self.webhook.create_task(
                    tpl_name,
                    mac_list,
                    steps_json=tpl_obj.get("steps_json", "[]"),
                    description=tpl_obj.get("description", "")
                )

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
