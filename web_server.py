import http.server
import json
import os
import re
import socketserver
import subprocess
import threading
import webbrowser
from sgl_manager.config import DEFAULT_ANYDESK_PASS, open_anydesk_session
from sgl_manager.printer_engine import print_box_label

PORT = 8080
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
ACTIVE_TUNNEL_URL = ""


class SGLWebHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_OPTIONS(self):
        """Xử lý CORS preflight request cho Web từ xa gọi về (GitHub Pages)."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/tunnel_info":
            self._send_json_resp({
                "status": "ok",
                "tunnel_url": ACTIVE_TUNNEL_URL,
                "local_url": f"http://localhost:{PORT}"
            })
            return
        super().do_GET()

    def do_POST(self):
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
            for line in proc.stderr:
                m = re.search(r"https://[a-zA-Z0-9\-]+\.trycloudflare\.com", line)
                if m:
                    ACTIVE_TUNNEL_URL = m.group(0)
                    print("\n" + "=" * 64)
                    print("  ⚡ CLOUDFLARE TUNNEL DA HOAT DONG (IN TU XA QUA WEB GITHUB)")
                    print(f"  👉 LINK HTTPS: {ACTIVE_TUNNEL_URL}")
                    print("  (Chi can dan link nay vao muc Cai Dat tren Web GitHub de in)")
                    print("=" * 64 + "\n")
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
