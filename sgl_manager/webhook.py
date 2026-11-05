import json
import urllib.request
import urllib.parse
import urllib.error
import ssl
from .config import WEBHOOK_URL

class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Xử lý theo dõi redirect an toàn kể cả khi Google Apps Script chuyển 302 POST sang GET."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Google Apps Script 302 redirect Web App tới script.googleusercontent.com
        # Khi đó chuyển thành GET request tới target URL mới
        new_req = urllib.request.Request(
            newurl,
            headers={
                "User-Agent": "SGL-Device-Manager/2.0",
                "Accept": "application/json"
            },
            method="GET"
        )
        return new_req

class WebhookClient:
    def __init__(self, url: str = WEBHOOK_URL):
        self.url = url
        self.timeout = 15
        
        # Bỏ qua SSL verification nếu môi trường mạng nội bộ hoặc chứng chỉ trung gian
        self.ssl_context = ssl.create_default_context()
        self.ssl_context.check_hostname = False
        self.ssl_context.verify_mode = ssl.CERT_NONE

        # Opener hỗ trợ redirect của Google Apps Script
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=self.ssl_context),
            NoRedirectHandler()
        )

    def _post(self, payload: dict) -> dict:
        if not self.url or "DAN_LINK_GOOGLE_SCRIPT" in self.url:
            return {"status": "error", "message": "Chưa cấu hình URL Webhook"}
        try:
            data_bytes = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                self.url,
                data=data_bytes,
                headers={
                    "Content-Type": "application/json; charset=UTF-8",
                    "User-Agent": "SGL-Device-Manager/2.0"
                },
                method="POST"
            )
            with self.opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                return json.loads(raw)
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def _get(self, params: dict) -> dict:
        if not self.url or "DAN_LINK_GOOGLE_SCRIPT" in self.url:
            return {"status": "error", "message": "Chưa cấu hình URL Webhook"}
        try:
            query = urllib.parse.urlencode(params)
            sep = "&" if "?" in self.url else "?"
            full_url = f"{self.url}{sep}{query}"
            req = urllib.request.Request(
                full_url,
                headers={
                    "User-Agent": "SGL-Device-Manager/2.0",
                    "Accept": "application/json"
                },
                method="GET"
            )
            with self.opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                return json.loads(raw)
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def get_devices(self) -> list:
        res = self._get({"action": "get_devices"})
        if isinstance(res, dict) and "devices" in res:
            return res.get("devices", [])
        return []

    def get_templates(self) -> list:
        res = self._get({"action": "get_templates"})
        if isinstance(res, dict) and "templates" in res:
            return res.get("templates", [])
        return []

    def get_tasks(self, mac: str = None) -> list:
        params = {"action": "get_tasks"}
        if mac:
            params["mac"] = mac
        res = self._get(params)
        if isinstance(res, dict) and "tasks" in res:
            return res.get("tasks", [])
        return []

    def create_task(self, template_name: str, target_macs: list) -> list:
        payload = {
            "action": "create_task",
            "template_name": template_name,
            "target_macs": target_macs
        }
        res = self._post(payload)
        if isinstance(res, dict) and res.get("status") == "ok":
            return res.get("task_ids", [])
        return []

    def save_template(self, name: str, steps_json: str, description: str = "") -> bool:
        payload = {
            "action": "save_template",
            "template_name": name,
            "steps_json": steps_json,
            "description": description
        }
        res = self._post(payload)
        return isinstance(res, dict) and res.get("status") == "ok"

    def register_device(self, mac: str, anydesk_id: str) -> bool:
        payload = {
            "action": "register_device",
            "mac": mac,
            "anydesk_id": anydesk_id
        }
        res = self._post(payload)
        return isinstance(res, dict) and res.get("status") == "ok"
