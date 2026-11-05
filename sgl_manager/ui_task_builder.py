import json
import threading
import tkinter as tk
from tkinter import messagebox, ttk

from .config import (
    BG_MAIN, BG_PANEL, BG_INPUT, BG_TABLE,
    FG_MATRIX, FG_CYAN, FG_AMBER, FG_RED, FG_DIM, FG_TEXT, BORDER_NEON
)

SAMPLE_ACTIONS = {
    "1. Tải APK từ URL": {
        "action": "download_apk",
        "params": {
            "url": "https://example.com/app.apk",
            "save_as": "app.apk"
        }
    },
    "2. Cài đặt file APK": {
        "action": "install_apk",
        "params": {
            "file": "app.apk"
        }
    },
    "3. Gỡ ứng dụng": {
        "action": "uninstall_pkg",
        "params": {
            "package": "com.radiostation"
        }
    },
    "4. Cập nhật thuộc tính lên Sheet": {
        "action": "report_field",
        "params": {
            "field": "project",
            "value": "1.66"
        }
    },
    "5. Chạy lệnh Shell (Root)": {
        "action": "shell_cmd",
        "params": {
            "cmd": "am force-stop com.radiostation ; reboot"
        }
    }
}

class TaskBuilderFrame(tk.Frame):
    def __init__(self, parent, webhook_client=None):
        super().__init__(parent, bg=BG_MAIN)
        self.webhook = webhook_client
        self.templates = []

        self.setup_ui()
        self.load_templates()

    def setup_ui(self):
        # 1. HEADER
        header_frame = tk.Frame(self, bg=BG_PANEL, pady=8, padx=14, highlightthickness=1, highlightbackground=BORDER_NEON)
        header_frame.pack(fill=tk.X, padx=10, pady=(8, 4))

        title_box = tk.Frame(header_frame, bg=BG_PANEL)
        title_box.pack(side=tk.LEFT)

        tk.Label(title_box, text=">_ TASK BUILDER // SOẠN THẢO KỊCH BẢN NÂNG CẤP & CÀI ĐẶT TỪ XA",
                 font=("Consolas", 12, "bold"), bg=BG_PANEL, fg=FG_MATRIX).pack(anchor="w")

        tk.Label(title_box, text="Tạo các chuỗi hành động ngẫu nhiên theo dự án (Tải APK, gỡ app cũ, login, nâng cấp code) -> Lưu lên Google Sheet",
                 font=("Consolas", 9), bg=BG_PANEL, fg=FG_CYAN).pack(anchor="w", pady=(2, 0))

        # 2. MAIN 3-PANEL CONTAINER
        main_paned = tk.PanedWindow(self, orient=tk.HORIZONTAL, bg=BG_MAIN, sashwidth=4, bd=0)
        main_paned.pack(fill=tk.BOTH, expand=True, padx=10, pady=4)

        # ----------------- PANEL 1: DANH SÁCH TEMPLATES -----------------
        p1 = tk.Frame(main_paned, bg=BG_PANEL, padx=8, pady=8, highlightthickness=1, highlightbackground="#0E3A1A")
        main_paned.add(p1, minsize=260)

        tk.Label(p1, text="KỊCH BẢN ĐÃ CÓ TRÊN SHEET:", font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_MATRIX).pack(anchor="w")

        self.lst_templates = tk.Listbox(p1, bg=BG_INPUT, fg=FG_TEXT, font=("Consolas", 9),
                                        selectbackground="#0F381E", selectforeground="#FFFFFF",
                                        relief="flat", highlightthickness=1, highlightbackground=BORDER_NEON)
        self.lst_templates.pack(fill=tk.BOTH, expand=True, pady=6)
        self.lst_templates.bind("<<ListboxSelect>>", self.on_list_select)

        p1_btn_box = tk.Frame(p1, bg=BG_PANEL)
        p1_btn_box.pack(fill=tk.X)

        tk.Button(p1_btn_box, text="[ ➕ MỚI ]", font=("Consolas", 8, "bold"),
                  bg="#0D3B1A", fg=FG_MATRIX, relief="flat", bd=0, padx=8, pady=4,
                  command=self.new_template).pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 2))

        tk.Button(p1_btn_box, text="[ 🔄 LÀM MỚI ]", font=("Consolas", 8, "bold"),
                  bg=BG_PANEL, fg=FG_CYAN, relief="flat", bd=0, highlightthickness=1, highlightbackground=FG_CYAN,
                  padx=8, pady=4, command=self.load_templates).pack(side=tk.RIGHT, fill=tk.X, expand=True, padx=(2, 0))

        # ----------------- PANEL 2: SOẠN THẢO STEPS JSON -----------------
        p2 = tk.Frame(main_paned, bg=BG_PANEL, padx=10, pady=8, highlightthickness=1, highlightbackground=BORDER_NEON)
        main_paned.add(p2, minsize=480)

        p2_top = tk.Frame(p2, bg=BG_PANEL)
        p2_top.pack(fill=tk.X, pady=(0, 4))

        tk.Label(p2_top, text="NỘI DUNG CÁC BƯỚC (STEPS JSON ARRAY):", font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_CYAN).pack(side=tk.LEFT)

        # Chèn mẫu nhanh
        tk.Label(p2_top, text="Chèn mẫu nhanh:", font=("Consolas", 8), bg=BG_PANEL, fg=FG_AMBER).pack(side=tk.LEFT, padx=(10, 4))
        self.cbo_quick_sample = ttk.Combobox(p2_top, values=list(SAMPLE_ACTIONS.keys()), state="readonly", width=22)
        self.cbo_quick_sample.pack(side=tk.LEFT)
        self.cbo_quick_sample.bind("<<ComboboxSelected>>", self.insert_quick_sample)

        self.txt_steps = tk.Text(p2, bg=BG_INPUT, fg=FG_MATRIX, font=("Consolas", 10),
                                 relief="flat", padx=10, pady=8, insertbackground=FG_MATRIX)
        self.txt_steps.pack(fill=tk.BOTH, expand=True, pady=4)

        # Format / Validate Button
        p2_bot = tk.Frame(p2, bg=BG_PANEL)
        p2_bot.pack(fill=tk.X)

        tk.Button(p2_bot, text="[ 🔍 KIỂM TRA & FORMAT JSON ]", font=("Consolas", 8, "bold"),
                  bg="#073642", fg=FG_CYAN, relief="flat", bd=0, padx=10, pady=4,
                  command=self.format_json).pack(side=tk.LEFT)

        self.lbl_json_status = tk.Label(p2_bot, text="", font=("Consolas", 8), bg=BG_PANEL, fg=FG_MATRIX)
        self.lbl_json_status.pack(side=tk.LEFT, padx=10)

        # ----------------- PANEL 3: METADATA & LƯU LÊN SHEET -----------------
        p3 = tk.Frame(main_paned, bg=BG_PANEL, padx=10, pady=8, highlightthickness=1, highlightbackground="#0E3A1A")
        main_paned.add(p3, minsize=320)

        tk.Label(p3, text="TÊN KỊCH BẢN (ID):", font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_AMBER).pack(anchor="w")
        self.ent_tpl_name = tk.Entry(p3, bg=BG_INPUT, fg=FG_AMBER, font=("Consolas", 10, "bold"),
                                     relief="flat", insertbackground=FG_AMBER,
                                     highlightthickness=1, highlightbackground=BORDER_NEON)
        self.ent_tpl_name.pack(fill=tk.X, pady=(2, 8), ipady=3)

        tk.Label(p3, text="MÔ TẢ CHI TIẾT:", font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_TEXT).pack(anchor="w")
        self.ent_tpl_desc = tk.Entry(p3, bg=BG_INPUT, fg=FG_TEXT, font=("Consolas", 9),
                                     relief="flat", insertbackground=FG_TEXT,
                                     highlightthickness=1, highlightbackground=BORDER_NEON)
        self.ent_tpl_desc.pack(fill=tk.X, pady=(2, 12), ipady=3)

        self.btn_save = tk.Button(
            p3, text="[ 💾 LƯU KỊCH BẢN LÊN GOOGLE SHEET ]", font=("Consolas", 9, "bold"),
            bg="#0D3B1A", fg=FG_MATRIX, activebackground="#165B2A", activeforeground="#FFFFFF",
            relief="flat", bd=0, padx=10, pady=10, cursor="hand2", command=self.save_to_sheet
        )
        self.btn_save.pack(fill=tk.X, pady=(0, 10))

        tk.Label(p3, text="HƯỚNG DẪN CÁC ACTION HỢP LỆ:", font=("Consolas", 9, "bold"), bg=BG_PANEL, fg=FG_CYAN).pack(anchor="w")

        doc_text = (
            "• download_apk:\n"
            "  params: {url, save_as}\n"
            "  -> Tải APK về /sdcard/SGL_Tasks/\n\n"
            "• install_apk:\n"
            "  params: {file}\n"
            "  -> Cài APK từ /sdcard/SGL_Tasks/\n\n"
            "• uninstall_pkg:\n"
            "  params: {package}\n"
            "  -> Buộc dừng & gỡ ứng dụng\n\n"
            "• report_field:\n"
            "  params: {field, value}\n"
            "  -> Cập nhật field vào Sheet Devices\n\n"
            "• shell_cmd:\n"
            "  params: {cmd}\n"
            "  -> Chạy lệnh Shell với quyền Root"
        )
        txt_doc = tk.Text(p3, bg=BG_INPUT, fg=FG_DIM, font=("Consolas", 8), relief="flat", padx=6, pady=6)
        txt_doc.insert(tk.END, doc_text)
        txt_doc.config(state=tk.DISABLED)
        txt_doc.pack(fill=tk.BOTH, expand=True)

        self.new_template()

    def new_template(self):
        self.ent_tpl_name.delete(0, tk.END)
        self.ent_tpl_name.insert(0, "custom_project_flow")
        self.ent_tpl_desc.delete(0, tk.END)
        self.ent_tpl_desc.insert(0, "Kịch bản tùy biến cho dự án mới")

        default_steps = [
            {"action": "uninstall_pkg", "params": {"package": "com.radiostation"}},
            {"action": "install_apk", "params": {"file": "radio.apk"}},
            {"action": "report_field", "params": {"field": "project", "value": "1.66"}}
        ]
        self.txt_steps.delete("1.0", tk.END)
        self.txt_steps.insert(tk.END, json.dumps(default_steps, indent=2, ensure_ascii=False))
        self.lbl_json_status.config(text="")

    def insert_quick_sample(self, _):
        sample_key = self.cbo_quick_sample.get()
        if sample_key not in SAMPLE_ACTIONS: return
        sample_obj = SAMPLE_ACTIONS[sample_key]

        raw = self.txt_steps.get("1.0", tk.END).strip()
        try:
            arr = json.loads(raw) if raw else []
            if not isinstance(arr, list): arr = [arr]
            arr.append(sample_obj)
            self.txt_steps.delete("1.0", tk.END)
            self.txt_steps.insert(tk.END, json.dumps(arr, indent=2, ensure_ascii=False))
            self.lbl_json_status.config(text="✔ Đã chèn mẫu thành công", fg=FG_MATRIX)
        except Exception as e:
            messagebox.showerror("Lỗi cú pháp JSON hiện tại", f"Không thể chèn vì JSON đang lỗi:\n{e}")

    def format_json(self):
        raw = self.txt_steps.get("1.0", tk.END).strip()
        try:
            parsed = json.loads(raw)
            if not isinstance(parsed, list):
                self.lbl_json_status.config(text="⚠️ Cần là JSON Array []", fg=FG_AMBER)
                return False
            pretty = json.dumps(parsed, indent=2, ensure_ascii=False)
            self.txt_steps.delete("1.0", tk.END)
            self.txt_steps.insert(tk.END, pretty)
            self.lbl_json_status.config(text=f"✔ JSON chuẩn ({len(parsed)} bước)", fg=FG_MATRIX)
            return True
        except Exception as e:
            self.lbl_json_status.config(text=f"❌ Lỗi JSON: {e}", fg=FG_RED)
            return False

    def load_templates(self):
        def _worker():
            data = []
            if self.webhook:
                data = self.webhook.get_templates()
            self.templates = data
            self.after(0, self._render_list)

        threading.Thread(target=_worker, daemon=True).start()

    def _render_list(self):
        self.lst_templates.delete(0, tk.END)
        for t in self.templates:
            self.lst_templates.insert(tk.END, t.get("template_name", "unnamed"))

    def on_list_select(self, _):
        sel_idx = self.lst_templates.curselection()
        if not sel_idx: return
        t = self.templates[sel_idx[0]]

        self.ent_tpl_name.delete(0, tk.END)
        self.ent_tpl_name.insert(0, t.get("template_name", ""))
        self.ent_tpl_desc.delete(0, tk.END)
        self.ent_tpl_desc.insert(0, t.get("description", ""))

        raw = t.get("steps_json", "[]")
        try:
            pretty = json.dumps(json.loads(raw), indent=2, ensure_ascii=False)
        except Exception:
            pretty = raw

        self.txt_steps.delete("1.0", tk.END)
        self.txt_steps.insert(tk.END, pretty)
        self.lbl_json_status.config(text="")

    def save_to_sheet(self):
        if not self.format_json():
            messagebox.showerror("Lỗi", "Vui lòng sửa lỗi cú pháp JSON trước khi lưu!")
            return

        name = self.ent_tpl_name.get().strip()
        desc = self.ent_tpl_desc.get().strip()
        steps = self.txt_steps.get("1.0", tk.END).strip()

        if not name:
            messagebox.showwarning("Thông báo", "Vui lòng nhập tên kịch bản!")
            return

        self.btn_save.config(text="[ ⏳ ĐANG LƯU LÊN SHEET... ]", state=tk.DISABLED)

        def _worker():
            ok = False
            if self.webhook:
                ok = self.webhook.save_template(name, steps, desc)

            def _done():
                self.btn_save.config(text="[ 💾 LƯU KỊCH BẢN LÊN GOOGLE SHEET ]", state=tk.NORMAL)
                if ok:
                    messagebox.showinfo("Thành công", f"Đã lưu kịch bản '{name}' lên Google Sheet!")
                    self.load_templates()
                else:
                    messagebox.showerror("Thất bại", "Không thể lưu kịch bản. Vui lòng kiểm tra lại kết nối Webhook.")

            self.after(0, _done)

        threading.Thread(target=_worker, daemon=True).start()
