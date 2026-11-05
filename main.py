import os
import sys
import tkinter as tk
from tkinter import ttk

# Đảm bảo đường dẫn import hoạt động chuẩn
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from sgl_manager.config import (
    BG_MAIN, BG_PANEL, BG_TABLE, FG_MATRIX, FG_CYAN, FG_TEXT, BORDER_NEON
)
from sgl_manager.webhook import WebhookClient
from sgl_manager.ui_stage1 import Stage1Frame
from sgl_manager.ui_dashboard import DashboardFrame
from sgl_manager.ui_stage2 import Stage2Frame
from sgl_manager.ui_task_builder import TaskBuilderFrame

class RadioManagerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("SGL // HỆ THỐNG QUẢN LÝ THIẾT BỊ TRUYỀN THANH THÔNG MINH v2.0")
        self.root.geometry("1420x860")
        self.root.minsize(1100, 700)
        self.root.configure(bg=BG_MAIN)

        self.webhook = WebhookClient()

        self.setup_theme()
        self.setup_tabs()

    def setup_theme(self):
        style = ttk.Style()
        style.theme_use("clam")

        # Style cho Notebook
        style.configure("TNotebook", background=BG_MAIN, borderwidth=0)
        style.configure("TNotebook.Tab",
                        background=BG_PANEL,
                        foreground=FG_TEXT,
                        font=("Consolas", 10, "bold"),
                        padding=(16, 8),
                        borderwidth=0)
        style.map("TNotebook.Tab",
                  background=[("selected", "#0D3B1A"), ("active", "#072610")],
                  foreground=[("selected", FG_MATRIX), ("active", "#FFFFFF")])

        # Style cho Treeview
        style.configure("Treeview",
                        background=BG_TABLE,
                        foreground=FG_TEXT,
                        fieldbackground=BG_TABLE,
                        rowheight=32,
                        font=("Consolas", 9),
                        borderwidth=0)
        style.configure("Treeview.Heading",
                        background="#0A1F11",
                        foreground=FG_MATRIX,
                        font=("Consolas", 9, "bold"),
                        relief="flat",
                        padding=(6, 6))
        style.map("Treeview",
                  background=[("selected", "#0F381E")],
                  foreground=[("selected", "#FFFFFF")])
        style.map("Treeview.Heading", background=[("active", "#12381F")])

    def setup_tabs(self):
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=8, pady=(6, 8))

        # Tab 1: Giai đoạn 1 (ADB LAN)
        self.tab1 = Stage1Frame(self.notebook, self.webhook)
        self.notebook.add(self.tab1, text=" 📡 01 // GĐ1 - CÀI TẠI KHO (LAN) ")

        # Tab 2: Dashboard thực địa
        self.tab2 = DashboardFrame(self.notebook, self.webhook)
        self.notebook.add(self.tab2, text=" 🖥️ 02 // DASHBOARD - THỰC ĐỊA ")

        # Tab 3: Giai đoạn 2 (Triển khai theo dự án)
        self.tab3 = Stage2Frame(self.notebook, self.webhook)
        self.notebook.add(self.tab3, text=" 🚀 03 // GĐ2 - CHỐT DỰ ÁN HÀNG LOẠT ")

        # Tab 4: Task Builder
        self.tab4 = TaskBuilderFrame(self.notebook, self.webhook)
        self.notebook.add(self.tab4, text=" 🛠️ 04 // TASK BUILDER (NÂNG CẤP TỪ XA) ")

        self.notebook.bind("<<NotebookTabChanged>>", self.on_tab_changed)

    def on_tab_changed(self, event):
        sel_idx = self.notebook.index(self.notebook.select())
        if sel_idx == 1:
            self.tab2.refresh()
        elif sel_idx == 2:
            self.tab3.refresh_all()
        elif sel_idx == 3:
            self.tab4.load_templates()

def main():
    root = tk.Tk()
    app = RadioManagerApp(root)
    root.mainloop()

if __name__ == "__main__":
    main()
