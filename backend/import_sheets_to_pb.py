import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Tuple, List, Dict

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

from backend.pocketbase_setup import PocketBaseSetup, load_config

DEFAULT_GAS_WEBHOOK = "https://script.google.com/macros/s/AKfycbxqawYpW8SebK0EK21Cl7C2uw6vN3-Jr7vQIHSAbNxtwXA5H7c_lYRNhXuB7104P0NN/exec"


def clean_mac(raw_mac: str) -> str:
    """Xoa dau hai cham, dau gach va khoang trang, dua ve chu hoa."""
    if not raw_mac:
        return ""
    return re.sub(r"[^a-fA-F0-9]", "", str(raw_mac)).upper()


def clean_anydesk(raw_ad: str) -> str:
    """Xoa khoang trang trong ma AnyDesk."""
    if not raw_ad:
        return ""
    return re.sub(r"\s+", "", str(raw_ad)).strip()


def transform_sheet_device_to_pb(raw: Dict) -> Dict:
    """Chuan hoa ban ghi thiet bi tu Google Sheet sang dinh dang PocketBase."""
    return {
        "mac": clean_mac(raw.get("mac", "")),
        "anydesk_id": clean_anydesk(raw.get("anydesk_id", "")),
        "project": str(raw.get("project", "")).strip(),
        "status": str(raw.get("status", "new")).strip().lower() or "new",
        "last_seen": str(raw.get("last_seen", "")).strip(),
        "app_version": str(raw.get("app_version", "")).strip(),
        "storage_mb": str(raw.get("storage_mb", "")).strip(),
        "task_id": str(raw.get("task_id", "")).strip(),
        "notes": str(raw.get("notes", "")).strip(),
    }


def transform_sheet_template_to_pb(raw: Dict) -> Dict:
    """Chuan hoa kịch bản mẫu từ Google Sheet sang PocketBase."""
    steps = raw.get("steps_json", "[]")
    if isinstance(steps, (list, dict)):
        steps = json.dumps(steps, ensure_ascii=False)
    return {
        "template_name": str(raw.get("template_name", "")).strip(),
        "steps_json": str(steps).strip(),
        "description": str(raw.get("description", "")).strip(),
        "created_by": str(raw.get("created_by", "admin")).strip() or "admin",
    }


def fetch_from_google_sheets(webhook_url: str) -> Tuple[List[Dict], List[Dict]]:
    """Lay danh sach thiet bi va templates tu Google Apps Script Webhook."""
    devices = []
    templates = []

    # 1. Fetch devices
    try:
        url_dev = f"{webhook_url}?action=get_devices"
        req = urllib.request.Request(url_dev, headers={"User-Agent": "SGL-Migrator"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict) and "devices" in data:
                devices = data["devices"]
            elif isinstance(data, list):
                devices = data
    except Exception as e:
        print(f"[!] Khong the tai devices tu Google Sheet: {e}")

    # 2. Fetch templates
    try:
        url_tmpl = f"{webhook_url}?action=get_templates"
        req = urllib.request.Request(url_tmpl, headers={"User-Agent": "SGL-Migrator"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict) and "templates" in data:
                templates = data["templates"]
            elif isinstance(data, list):
                templates = data
    except Exception as e:
        print(f"[!] Khong the tai templates tu Google Sheet: {e}")

    return devices, templates


def import_from_sheet_data(
    devices: List[Dict],
    templates: List[Dict],
    pb_url: str,
    token: str = ""
) -> Tuple[int, int]:
    """Day danh sach devices va templates da chuan hoa vao PocketBase."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token

    imported_devices = 0
    imported_templates = 0

    # 1. Day devices vao PocketBase
    for raw_dev in devices:
        dev = transform_sheet_device_to_pb(raw_dev)
        if not dev["mac"]:
            continue

        url = f"{pb_url}/api/collections/devices/records"
        payload = json.dumps(dev).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                imported_devices += 1
        except Exception:
            # Co the da ton tai MAC -> thu cap nhat qua filter
            pass

    # 2. Day templates vao PocketBase
    for raw_tmpl in templates:
        tmpl = transform_sheet_template_to_pb(raw_tmpl)
        if not tmpl["template_name"]:
            continue

        url = f"{pb_url}/api/collections/templates/records"
        payload = json.dumps(tmpl).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                imported_templates += 1
        except Exception:
            pass

    return imported_devices, imported_templates


def run_migration():
    config = load_config()
    setup = PocketBaseSetup(config=config)
    setup.ensure_superuser()
    setup.sync_collections()
    setup.seed_templates()

    token = setup.get_auth_token()
    pb_url = setup.base_url

    print(f"[*] Dang ket noi Google Sheets de sao chep du lieu sang {pb_url} ...")
    devices, templates = fetch_from_google_sheets(DEFAULT_GAS_WEBHOOK)
    print(f"[*] Tim thay {len(devices)} thiet bi va {len(templates)} templates tren Google Sheets.")

    dev_count, tmpl_count = import_from_sheet_data(devices, templates, pb_url, token)
    print(f"[✔] HOAN TAT! Da nhap thanh cong {dev_count} thiet bi va {tmpl_count} templates vao PocketBase.")


if __name__ == "__main__":
    run_migration()
