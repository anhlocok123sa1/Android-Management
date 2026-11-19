import atexit
import http.server
import json
import os
import re
import socketserver
import subprocess
import threading
import webbrowser
from sgl_manager.config import DEFAULT_ANYDESK_PASS, WEBHOOK_URL, open_anydesk_session
from sgl_manager.printer_engine import print_box_label
from sgl_manager.webhook import WebhookClient

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
TOKEN_FILE = os.path.join(BASE_DIR, ".sgl_local_token")
ACTIVE_TUNNEL_URL = ""
TUNNEL_CLOUD_SYNCED = False


def load_local_admin_tokens() -> dict:
    """Đọc token xác thực Admin cục bộ (.sgl_local_token) để tự đẩy link Tunnel lên Cloud."""
    if not os.path.isfile(TOKEN_FILE):
        return {}
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_local_admin_tokens(auth_token: str, legacy_token: str = "", webhook_url: str = "") -> bool:
    """Lưu token Admin cục bộ (không đẩy lên Git) để các lần bật sau tự đồng bộ Tunnel."""
    if not auth_token and not legacy_token:
        return False
    payload = {
        "auth_token": str(auth_token or "").strip(),
        "legacy_token": str(legacy_token or "").strip(),
        "webhook_url": str(webhook_url or WEBHOOK_URL).strip() or WEBHOOK_URL,
    }
    try:
        with open(TOKEN_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def push_tunnel_url_to_cloud(tunnel_url: str) -> tuple:
    """Tự động đẩy link Cloudflare Tunnel mới lên Google Apps Script (sgl_printer_config) để GitHub Pages tự nhận."""
    global TUNNEL_CLOUD_SYNCED
    clean_url = str(tunnel_url or "").strip().rstrip("/")
    if not clean_url.startswith("http"):
        return False, "Link Tunnel không hợp lệ"

    tokens = load_local_admin_tokens()
    auth_token = tokens.get("auth_token", "")
    legacy_token = tokens.get("legacy_token", "")
    webhook_url = tokens.get("webhook_url") or WEBHOOK_URL

    if not auth_token and not legacy_token:
        print("  ℹ️ Chưa có token cục bộ (.sgl_local_token). Chỉ cần mở Web GitHub 1 lần ở máy này,")
        print("     hệ thống sẽ tự lưu token và các lần bật sau sẽ TỰ ĐỘNG đẩy link Tunnel lên Cloud!")
        return False, "Chưa có token cục bộ"

    try:
        client = WebhookClient(webhook_url)
        res = client._post({
            "action": "save_template",
            "template_name": "sgl_printer_config",
            "steps_json": json.dumps([{"action": "printer_server", "params": {"url": clean_url}}]),
            "description": "Cấu hình máy in nhãn nhiệt AiYin D11S từ xa (Cloudflare Tunnel - Auto Sync)",
            "auth_token": auth_token,
            "legacy_token": legacy_token,
        })
        if isinstance(res, dict) and res.get("status") == "ok":
            TUNNEL_CLOUD_SYNCED = True
            print("  ☁️ ĐÃ TỰ ĐỘNG ĐẨY LINK TUNNEL LÊN CLOUD! Web GitHub Pages sẽ tự cập nhật.")
            return True, "Đã đồng bộ Tunnel lên Cloud"
        msg = res.get("message", "Không rõ lỗi") if isinstance(res, dict) else str(res)
        print(f"  ⚠️ Chưa thể tự đẩy Tunnel lên Cloud: {msg}")
        return False, msg
    except Exception as e:
        print(f"  ⚠️ Lỗi khi tự đẩy Tunnel lên Cloud: {e}")
        return False, str(e)


class SGLWebHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_OPTIONS(self):
        """Xử lý CORS & Private Network Access preflight cho Web từ xa (GitHub Pages) gọi về localhost."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/tunnel_info":
            self._send_json_resp({
                "status": "ok",
                "tunnel_url": ACTIVE_TUNNEL_URL,
                "local_url": f"http://localhost:{PORT}",
                "cloud_synced": TUNNEL_CLOUD_SYNCED,
            })
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/sync_admin_token":
            client_ip = self.client_address[0] if self.client_address else ""
            if client_ip not in ("127.0.0.1", "::1", "localhost"):
                self._send_json_resp({"status": "error", "message": "Chỉ cho phép đồng bộ token từ localhost"}, status_code=403)
                return
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8", errors="ignore")
            try:
                data = json.loads(raw_body) if raw_body else {}
                ok = save_local_admin_tokens(
                    auth_token=data.get("auth_token", ""),
                    legacy_token=data.get("legacy_token", ""),
                    webhook_url=data.get("webhook_url", ""),
                )
                synced = False
                if ok:
                    print("  🔐 ĐÃ LƯU TOKEN CỤC BỘ (.sgl_local_token) THÀNH CÔNG!")
                    if ACTIVE_TUNNEL_URL and not TUNNEL_CLOUD_SYNCED:
                        synced, _ = push_tunnel_url_to_cloud(ACTIVE_TUNNEL_URL)
                resp = {
                    "status": "ok" if ok else "error",
                    "tunnel_url": ACTIVE_TUNNEL_URL,
                    "cloud_synced": TUNNEL_CLOUD_SYNCED or synced,
                }
            except Exception as e:
                resp = {"status": "error", "message": str(e)}
            self._send_json_resp(resp)
            return

        if self.path == "/api/open_anydesk":
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8", errors="ignore")
            try:
                data = json.loads(raw_body)
                ad_id = data.get("anydesk_id", "")
                password = data.get("password", DEFAULT_ANYDESK_PASS)
                ok, msg = open_anydesk_session(ad_id, password=password)
                resp = {"status": "ok" if ok else "error", "message": msg}
            except Exception as e:
                resp = {"status": "error", "message": str(e)}

            self._send_json_resp(resp)
            return

        elif self.path == "/api/print_label":
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8", errors="ignore")
            try:
                data = json.loads(raw_body) if raw_body else {}
                ad_id = str(data.get("anydesk_id", "")).strip()
                iot_id = str(data.get("iot_id", "")).strip()
                if not ad_id:
                    resp = {"status": "error", "message": "Thiếu AnyDesk ID để in nhãn"}
                else:
                    ok, msg = print_box_label(anydesk_id=ad_id, iot_id=iot_id)
                    resp = {"status": "ok" if ok else "error", "message": msg}
            except Exception as e:
                resp = {"status": "error", "message": str(e)}

            self._send_json_resp(resp)
            return

        self.send_error(404, "Endpoint not found")

    def _send_json_resp(self, data: dict, status_code: int = 200):
        body_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(body_bytes)

    def log_message(self, format, *args):
        pass


def start_cloudflared_tunnel(port: int = PORT):
    """Tự động kích hoạt Cloudflare Tunnel tạo link HTTPS công khai miễn phí."""
    global ACTIVE_TUNNEL_URL
    cf_bin = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "cloudflared.exe")
    if not os.path.isfile(cf_bin):
        return

    def _monitor():
        global ACTIVE_TUNNEL_URL
        try:
            CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0
            proc = subprocess.Popen(
                [cf_bin, "tunnel", "--url", f"http://127.0.0.1:{port}"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                creationflags=CREATE_NO_WINDOW
            )
            atexit.register(lambda: proc.kill() if proc.poll() is None else None)
            for line in proc.stderr:
                m = re.search(r"https://[a-zA-Z0-9\-]+\.trycloudflare\.com", line)
                if m:
                    ACTIVE_TUNNEL_URL = m.group(0)
                    print("\n" + "=" * 64)
                    print("  ⚡ CLOUDFLARE TUNNEL DA HOAT DONG (IN TU XA QUA WEB GITHUB)")
                    print(f"  👉 LINK HTTPS: {ACTIVE_TUNNEL_URL}")
                    print("=" * 64)
                    push_tunnel_url_to_cloud(ACTIVE_TUNNEL_URL)
                    print("")
                    break
        except Exception:
            pass

    t = threading.Thread(target=_monitor, daemon=True)
    t.start()


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    start_cloudflared_tunnel(PORT)
    with socketserver.TCPServer(("", PORT), SGLWebHandler) as httpd:
        url = f"http://localhost:{PORT}"
        print("============================================================")
        print("  SGL SMART BROADCAST CLOUD — WEB SERVER QUAN TRI ANDROID")
        print(f"  Dang chay tai: {url}")
        print("  Bam Ctrl+C de dung server.")
        print("============================================================")
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nDa dung Web Server.")


if __name__ == "__main__":
    main()
