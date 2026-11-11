import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import List, Dict, Optional, Any

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "pocketbase_config.json")


def clean_mac(raw_mac: str) -> str:
    if not raw_mac:
        return ""
    return re.sub(r"[^a-fA-F0-9]", "", str(raw_mac)).upper()


def clean_anydesk(raw_ad: str) -> str:
    if not raw_ad:
        return ""
    return re.sub(r"\s+", "", str(raw_ad)).strip()


class PocketBaseClient:
    """Client giao tiếp trực tiếp với PocketBase REST API hiệu năng cao."""

    def __init__(self, base_url: Optional[str] = None, secret: Optional[str] = None):
        cfg = {}
        if os.path.isfile(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
            except Exception:
                pass

        port = cfg.get("pocketbase_port", 8090)
        self.base_url = (base_url or f"http://127.0.0.1:{port}").rstrip("/")
        self.secret = secret or cfg.get("api_secret", "sgl_secret_token_2026")

    def _headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "SGL-Manager-Python/2.0",
        }
        if self.secret:
            headers["X-SGL-Secret"] = self.secret
        return headers

    def _request(
        self, endpoint: str, method: str = "GET", data: Optional[Dict] = None, timeout: int = 5
    ) -> Optional[Any]:
        url = f"{self.base_url}{endpoint}"
        payload = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=payload, headers=self._headers(), method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except Exception:
            return None

    def get_devices(self, page: int = 1, per_page: int = 500) -> List[Dict]:
        """Lay toan bo danh sach thiet bi tu PocketBase."""
        res = self._request(f"/api/collections/devices/records?page={page}&perPage={per_page}&sort=-last_seen")
        if res and isinstance(res, dict) and "items" in res:
            return res["items"]
        return []

    def register_device(
        self,
        mac: str,
        anydesk_id: str = "",
        project: str = "",
        software: str = "",
        mac_ics: str = "",
        iot_id: str = "",
    ) -> Dict:
        """Dang ky hoac cap nhat thiet bi tren PocketBase (tuong thich signature WebhookClient)."""
        c_mac = clean_mac(mac)
        c_ad = clean_anydesk(anydesk_id)
        if not c_mac:
            return {"status": "error", "message": "Thiếu MAC"}

        # Kiem tra neu thiet bi da co
        query = urllib.parse.quote(f"mac='{c_mac}'")
        existing = self._request(f"/api/collections/devices/records?filter=({query})")
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        notes = []
        if software:
            notes.append(f"App: {software}")
        if mac_ics:
            notes.append(f"ICS MAC: {mac_ics}")
        if iot_id:
            notes.append(f"IoT: {iot_id}")
        notes_str = "; ".join(notes)

        payload = {
            "mac": c_mac,
            "anydesk_id": c_ad,
            "project": project.strip(),
            "status": "new",
            "last_seen": now,
        }
        if software:
            payload["app_version"] = software.strip()
        if notes_str:
            payload["notes"] = notes_str

        if existing and existing.get("items"):
            rec_id = existing["items"][0]["id"]
            res = self._request(f"/api/collections/devices/records/{rec_id}", method="PATCH", data=payload)
            if res:
                return {"status": "ok", "message": "Cập nhật thiết bị thành công", "id": rec_id}
        else:
            res = self._request("/api/collections/devices/records", method="POST", data=payload)
            if res:
                return {"status": "ok", "message": "Đăng ký thiết bị mới thành công", "id": res.get("id")}

        return {"status": "error", "message": "Không thể lưu thiết bị lên PocketBase"}

    def get_tasks(self, mac: Optional[str] = None) -> List[Dict]:
        """Lay danh sach cac task (co the loc theo MAC)."""
        endpoint = "/api/collections/tasks/records?perPage=200&sort=-created"
        if mac:
            c_mac = clean_mac(mac)
            query = urllib.parse.quote(f"target_mac='{c_mac}'")
            endpoint += f"&filter=({query})"
        res = self._request(endpoint)
        if res and isinstance(res, dict) and "items" in res:
            return res["items"]
        return []

    def assign_project(self, macs: List[str], project: str) -> bool:
        """Gan du an cho danh sach cac thiet bi."""
        success = True
        for m in macs:
            c_mac = clean_mac(m)
            if not c_mac:
                continue
            query = urllib.parse.quote(f"mac='{c_mac}'")
            existing = self._request(f"/api/collections/devices/records?filter=({query})")
            if existing and existing.get("items"):
                rec_id = existing["items"][0]["id"]
                res = self._request(
                    f"/api/collections/devices/records/{rec_id}",
                    method="PATCH",
                    data={"project": project.strip()}
                )
                if not res:
                    success = False
        return success

    def create_task(self, template_name: str, target_macs: List[str]) -> List[str]:
        """Tao cac task trong PocketBase cho danh sach target_macs."""
        created_ids = []
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        ts = int(time.time() * 1000)

        for i, m in enumerate(target_macs):
            c_mac = clean_mac(m)
            if not c_mac:
                continue
            task_id = f"TASK_{ts}_{i + 1}"
            payload = {
                "task_id": task_id,
                "template_name": template_name.strip(),
                "target_mac": c_mac,
                "status": "pending",
                "created_at": now,
            }
            res = self._request("/api/collections/tasks/records", method="POST", data=payload)
            if res:
                created_ids.append(task_id)

        return created_ids

    def claim_task(self, mac: str) -> Dict:
        """Box goi de nhan task dang cho."""
        c_mac = clean_mac(mac)
        if not c_mac:
            return {"status": "error", "message": "Thiếu MAC"}

        # Su dung webhook hook neu co hoac REST API
        res = self._request(
            "/api/sgl_webhook",
            method="POST",
            data={"action": "claim_task", "mac": c_mac}
        )
        if res:
            return res

        # Fallback query REST API
        query = urllib.parse.quote(f"target_mac='{c_mac}' && status='pending'")
        tasks_res = self._request(f"/api/collections/tasks/records?filter=({query})&sort=created")
        if tasks_res and tasks_res.get("items"):
            t = tasks_res["items"][0]
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            self._request(f"/api/collections/tasks/records/{t['id']}", method="PATCH", data={"status": "claimed", "claimed_at": now})
            return {
                "status": "ok",
                "has_task": True,
                "task_id": t["task_id"],
                "template_name": t["template_name"],
            }
        return {"status": "ok", "has_task": False}

    def complete_task(self, task_id: str, result: str = "", is_error: bool = False) -> bool:
        """Box bao cao ket qua task."""
        status = "failed" if is_error else "completed"
        res = self._request(
            "/api/sgl_webhook",
            method="POST",
            data={"action": "complete_task", "task_id": task_id, "status": status, "result": result}
        )
        return res is not None and res.get("status") == "ok"

    def send_heartbeat(self, mac: str, info: Optional[Dict] = None) -> bool:
        """Gui xung nhip tu box."""
        payload = {"action": "heartbeat", "mac": clean_mac(mac)}
        if info:
            payload.update(info)
        res = self._request("/api/sgl_webhook", method="POST", data=payload)
        return res is not None and res.get("status") == "ok"

    def get_templates(self) -> List[Dict]:
        """Lay danh sach templates."""
        res = self._request("/api/collections/templates/records?perPage=200")
        if res and isinstance(res, dict) and "items" in res:
            return res["items"]
        return []

    def save_template(self, name: str, steps_json: str, description: str = "", created_by: str = "admin") -> bool:
        """Luu hoac cap nhat template."""
        query = urllib.parse.quote(f"template_name='{name.strip()}'")
        existing = self._request(f"/api/collections/templates/records?filter=({query})")
        payload = {
            "template_name": name.strip(),
            "steps_json": steps_json.strip(),
            "description": description.strip(),
            "created_by": created_by.strip(),
        }
        if existing and existing.get("items"):
            rec_id = existing["items"][0]["id"]
            res = self._request(f"/api/collections/templates/records/{rec_id}", method="PATCH", data=payload)
            return res is not None
        else:
            res = self._request("/api/collections/templates/records", method="POST", data=payload)
            return res is not None
