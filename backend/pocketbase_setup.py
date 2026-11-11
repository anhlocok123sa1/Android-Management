import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "pocketbase_config.json")
PB_EXE = os.path.join(ROOT_DIR, "bin", "pocketbase", "pocketbase.exe")
PB_DATA = os.path.join(ROOT_DIR, "bin", "pocketbase", "pb_data")


def load_config() -> dict:
    if os.path.isfile(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "pocketbase_port": 8090,
        "admin_email": "admin@sgl.local",
        "admin_password": "SglAdminPassword2026!",
        "api_secret": "sgl_secret_token_2026",
        "fixed_domain": "",
        "active_tunnel_url": "",
        "legacy_webhook_enabled": True,
    }


def get_default_templates() -> list[dict]:
    return [
        {
            "template_name": "deploy_radio_36",
            "description": "Cài đặt & Nâng cấp Radio 3.6 (Tải trực tiếp & cài đè qua Root)",
            "steps_json": json.dumps(
                [
                    {
                        "action": "shell_cmd",
                        "params": {
                            "cmd": "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/Radio3.6.apk \"https://drive.usercontent.google.com/download?id=1fU02IfohDL0FnLFmkz1TZ3tlSrpDfRdD&export=download&confirm=t\" && ls -l /data/local/tmp/Radio3.6.apk && pm install -r -g /data/local/tmp/Radio3.6.apk && rm -f /data/local/tmp/Radio3.6.apk"
                        },
                    },
                    {
                        "action": "start_app",
                        "params": {
                            "package": "vn.phitn.app.radiostation",
                            "activity": "vn.phitn.app.radiostation.ui.SplashActivity",
                        },
                    },
                    {
                        "action": "report_field",
                        "params": {"field": "software", "value": "Radio 3.6"},
                    },
                ],
                indent=2,
                ensure_ascii=False,
            ),
            "created_by": "admin",
        },
        {
            "template_name": "deploy_vnpt_ics",
            "description": "Chuyển sang VNPT ICS (Tải trực tiếp, cài ICS, tự động lấy MAC ICS lên Sheet)",
            "steps_json": json.dumps(
                [
                    {
                        "action": "shell_cmd",
                        "params": {
                            "cmd": "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/ics.apk \"https://drive.usercontent.google.com/download?id=1Qozu11xJNhvwSFlTPfC8rpFa8Zy8gLvF&export=download&confirm=t\" && ls -l /data/local/tmp/ics.apk && pm install -r -g /data/local/tmp/ics.apk && rm -f /data/local/tmp/ics.apk"
                        },
                    },
                    {
                        "action": "start_app",
                        "params": {
                            "package": "com.app.ics_content_management",
                            "activity": "vn.vnpt.digo.ics.MainActivity",
                        },
                    },
                    {
                        "action": "extract_ics_mac",
                        "params": {"package": "com.app.ics_content_management"},
                    },
                    {
                        "action": "report_field",
                        "params": {"field": "software", "value": "VNPT ICS"},
                    },
                ],
                indent=2,
                ensure_ascii=False,
            ),
            "created_by": "admin",
        },
        {
            "template_name": "deploy_radio_166",
            "description": "Chuyển sang Radio 1.66 (Tải trực tiếp & cài đè qua Root)",
            "steps_json": json.dumps(
                [
                    {
                        "action": "shell_cmd",
                        "params": {
                            "cmd": "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/radio.apk \"https://drive.usercontent.google.com/download?id=1fa3-qqFUJ6d9sCuLjidHAI6eom1mlxJ5&export=download&confirm=t\" && ls -l /data/local/tmp/radio.apk && pm install -r -d -g /data/local/tmp/radio.apk && rm -f /data/local/tmp/radio.apk"
                        },
                    },
                    {
                        "action": "start_app",
                        "params": {
                            "package": "vn.phitn.app.radiostation",
                            "activity": "vn.phitn.app.radiostation.ui.SplashActivity",
                        },
                    },
                    {
                        "action": "report_field",
                        "params": {"field": "software", "value": "Radio 1.66"},
                    },
                ],
                indent=2,
                ensure_ascii=False,
            ),
            "created_by": "admin",
        },
        {
            "template_name": "deploy_radio_20",
            "description": "Nâng cấp Radio 2.0 (Tải trực tiếp & cài đè sạch qua Root, cấu hình Radio 2.0)",
            "steps_json": json.dumps(
                [
                    {
                        "action": "shell_cmd",
                        "params": {
                            "cmd": "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/Radio2.0.apk \"https://drive.usercontent.google.com/download?id=1bLxqszxg5DficlG02cWZFjmGLxbMhiFT&export=download&confirm=t\" && ls -l /data/local/tmp/Radio2.0.apk && pm install -r -g /data/local/tmp/Radio2.0.apk && rm -f /data/local/tmp/Radio2.0.apk"
                        },
                    },
                    {
                        "action": "start_app",
                        "params": {
                            "package": "vn.phitn.app.radiostation",
                            "activity": "vn.phitn.app.radiostation.ui.SplashActivity",
                        },
                    },
                    {
                        "action": "report_field",
                        "params": {"field": "software", "value": "Radio 2.0"},
                    },
                ],
                indent=2,
                ensure_ascii=False,
            ),
            "created_by": "admin",
        },
    ]


def get_schema_definitions() -> dict:
    # Quy tắc bảo mật: Thao tác tạo/sửa task & template yêu cầu Secret Key hoặc Superuser
    # DeleteRule = None (chỉ Superuser mới có quyền xóa dữ liệu, chặn triệt để xóa từ bên ngoài)
    SECRET_RULE = "@request.headers.x_sgl_secret = 'sgl_secret_token_2026' || @request.auth.id != ''"

    return {
        "devices": {
            "name": "devices",
            "type": "base",
            "listRule": "",
            "viewRule": "",
            "createRule": "",
            "updateRule": "",
            "deleteRule": None,
            "fields": [
                {"name": "mac", "type": "text", "required": True},
                {"name": "anydesk_id", "type": "text", "required": False},
                {"name": "project", "type": "text", "required": False},
                {"name": "status", "type": "text", "required": False},
                {"name": "last_seen", "type": "text", "required": False},
                {"name": "app_version", "type": "text", "required": False},
                {"name": "storage_mb", "type": "text", "required": False},
                {"name": "task_id", "type": "text", "required": False},
                {"name": "notes", "type": "text", "required": False},
            ],
            "indexes": [
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_mac ON devices (mac)"
            ],
        },
        "tasks": {
            "name": "tasks",
            "type": "base",
            "listRule": "",
            "viewRule": "",
            "createRule": SECRET_RULE,
            "updateRule": SECRET_RULE,
            "deleteRule": None,
            "fields": [
                {"name": "task_id", "type": "text", "required": True},
                {"name": "template_name", "type": "text", "required": True},
                {"name": "target_mac", "type": "text", "required": True},
                {"name": "status", "type": "text", "required": False},
                {"name": "created_at", "type": "text", "required": False},
                {"name": "claimed_at", "type": "text", "required": False},
                {"name": "completed_at", "type": "text", "required": False},
                {"name": "result", "type": "text", "required": False},
            ],
            "indexes": [
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_task_id ON tasks (task_id)",
                "CREATE INDEX IF NOT EXISTS idx_tasks_target_mac ON tasks (target_mac)",
            ],
        },
        "templates": {
            "name": "templates",
            "type": "base",
            "listRule": "",
            "viewRule": "",
            "createRule": SECRET_RULE,
            "updateRule": SECRET_RULE,
            "deleteRule": None,
            "fields": [
                {"name": "template_name", "type": "text", "required": True},
                {"name": "steps_json", "type": "text", "required": True},
                {"name": "description", "type": "text", "required": False},
                {"name": "created_by", "type": "text", "required": False},
            ],
            "indexes": [
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_name ON templates (template_name)"
            ],
        },
        "heartbeats": {
            "name": "heartbeats",
            "type": "base",
            "listRule": "",
            "viewRule": "",
            "createRule": "",
            "updateRule": None,
            "deleteRule": None,
            "fields": [
                {"name": "mac", "type": "text", "required": True},
                {"name": "timestamp", "type": "text", "required": True},
                {"name": "ram_mb", "type": "number", "required": False},
                {"name": "storage_mb", "type": "number", "required": False},
                {"name": "current_task", "type": "text", "required": False},
                {"name": "app_version", "type": "text", "required": False},
                {"name": "ip", "type": "text", "required": False},
            ],
            "indexes": [
                "CREATE INDEX IF NOT EXISTS idx_heartbeats_mac ON heartbeats (mac)"
            ],
        },
    }


class PocketBaseSetup:
    def __init__(self, base_url: str = None, config: dict = None):
        self.config = config or load_config()
        port = self.config.get("pocketbase_port", 8090)
        self.base_url = (base_url or f"http://127.0.0.1:{port}").rstrip("/")
        self.admin_email = self.config.get("admin_email", "admin@sgl.local")
        self.admin_password = self.config.get("admin_password", "SglAdminPassword2026!")
        self.api_secret = self.config.get("api_secret", "sgl_secret_token_2026")
        self.auth_token = None

    def ensure_superuser(self) -> bool:
        """Kích hoạt superuser thông qua CLI của pocketbase.exe."""
        if not os.path.isfile(PB_EXE):
            print(f"[!] Khong tim thay {PB_EXE}")
            return False
        cmd = [
            PB_EXE,
            "superuser",
            "upsert",
            self.admin_email,
            self.admin_password,
            "--dir",
            PB_DATA,
        ]
        try:
            res = subprocess.run(
                cmd, capture_output=True, text=True, check=True
            )
            print(f"[OK] Superuser '{self.admin_email}' da san sang.")
            return True
        except Exception as e:
            print(f"[!] Loi khoi tao superuser: {e}")
            return False

    def get_auth_token(self) -> str:
        """Lay token dang nhap cua superuser."""
        if self.auth_token:
            return self.auth_token

        # Thu endpoint _superusers (PB v0.40+) roi den admins (PB cu)
        endpoints = [
            "/api/collections/_superusers/auth-with-password",
            "/api/admins/auth-with-password",
        ]
        for ep in endpoints:
            url = f"{self.base_url}{ep}"
            payload = json.dumps(
                {"identity": self.admin_email, "password": self.admin_password}
            ).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    self.auth_token = data.get("token")
                    if self.auth_token:
                        return self.auth_token
            except Exception:
                continue

        return ""

    def sync_collections(self) -> bool:
        """Kiem tra va tao cac collection con thieu qua REST API."""
        token = self.get_auth_token()
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = token

        # Lay danh sach collection hien co
        try:
            req = urllib.request.Request(
                f"{self.base_url}/api/collections?perPage=200",
                headers=headers,
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                existing = json.loads(resp.read().decode("utf-8")).get(
                    "items", []
                )
                existing_names = {c["name"]: c for c in existing}
        except Exception as e:
            print(f"[!] Khong the doc collections: {e}")
            return False

        schemas = get_schema_definitions()
        for name, schema in schemas.items():
            if name in existing_names:
                print(f"[OK] Collection '{name}' da ton tai.")
                continue

            # Tao moi collection
            create_url = f"{self.base_url}/api/collections"
            req = urllib.request.Request(
                create_url,
                data=json.dumps(schema).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    print(f"[+] Da tao moi collection '{name}'.")
            except Exception as e:
                print(f"[!] Loi tao collection '{name}': {e}")

        return True

    def seed_templates(self) -> int:
        """Nap cac kich ban mau mac dinh vao collection templates neu chua co."""
        token = self.get_auth_token()
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = token

        templates = get_default_templates()
        added = 0
        for t in templates:
            t_name = t["template_name"]
            filter_query = urllib.parse.quote(f"template_name='{t_name}'")
            check_url = f"{self.base_url}/api/collections/templates/records?filter=({filter_query})"
            req = urllib.request.Request(check_url, headers=headers, method="GET")
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    if data.get("totalItems", 0) > 0:
                        continue
            except Exception:
                pass

            # Insert template
            insert_url = f"{self.base_url}/api/collections/templates/records"
            req = urllib.request.Request(
                insert_url,
                data=json.dumps(t).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    added += 1
                    print(f"[+] Da nap template mac dinh: {t_name}")
            except Exception as e:
                print(f"[!] Loi nap template '{t_name}': {e}")

        return added


if __name__ == "__main__":
    setup = PocketBaseSetup()
    setup.ensure_superuser()
    # Neu server dang chay -> dong bo collection & templates
    setup.sync_collections()
    setup.seed_templates()
