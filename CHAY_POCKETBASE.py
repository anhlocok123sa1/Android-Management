import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(ROOT_DIR, "pocketbase_config.json")
PB_EXE = os.path.join(ROOT_DIR, "bin", "pocketbase", "pocketbase.exe")
PB_DATA = os.path.join(ROOT_DIR, "bin", "pocketbase", "pb_data")
PB_HOOKS = os.path.join(ROOT_DIR, "bin", "pocketbase", "pb_hooks")
CF_BIN = os.path.join(ROOT_DIR, "bin", "cloudflared.exe")

ACTIVE_TUNNEL_URL = ""
pb_process = None
cf_process = None


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
    }


def save_config(cfg: dict):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def start_pocketbase(port: int = 8090) -> subprocess.Popen:
    if not os.path.isfile(PB_EXE):
        print(f"[!] Khong tim thay {PB_EXE}. Dang tu dong tai...")
        ps_script = os.path.join(ROOT_DIR, "bin", "pocketbase", "download_pb.ps1")
        subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-File", ps_script], check=True)

    os.makedirs(PB_DATA, exist_ok=True)
    os.makedirs(PB_HOOKS, exist_ok=True)

    cmd = [
        PB_EXE,
        "serve",
        f"--http=127.0.0.1:{port}",
        f"--dir={PB_DATA}",
        f"--hooksDir={PB_HOOKS}"
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return proc


def wait_for_health(port: int, max_retries: int = 30) -> bool:
    url = f"http://127.0.0.1:{port}/api/health"
    for _ in range(max_retries):
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def start_cloudflare_tunnel(port: int):
    global ACTIVE_TUNNEL_URL, cf_process
    if not os.path.isfile(CF_BIN):
        print("[-] Khong tim thay bin/cloudflared.exe, bo qua Cloudflare Tunnel.")
        return

    cmd = [CF_BIN, "tunnel", "--url", f"http://localhost:{port}"]
    cf_process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        encoding="utf-8",
        errors="ignore"
    )

    def _monitor():
        global ACTIVE_TUNNEL_URL
        for line in iter(cf_process.stdout.readline, ""):
            match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
            if match and match.group(0) != ACTIVE_TUNNEL_URL:
                ACTIVE_TUNNEL_URL = match.group(0)
                cfg = load_config()
                cfg["active_tunnel_url"] = ACTIVE_TUNNEL_URL
                save_config(cfg)
                print(f"\n=======================================================")
                print(f"🌐 LINK CLOUDFLARE TUNNEL (CONG KHAI CHO BOX 4G):")
                print(f"   {ACTIVE_TUNNEL_URL}")
                print(f"=======================================================\n")

    t = threading.Thread(target=_monitor, daemon=True)
    t.start()


def cleanup(sig=None, frame=None):
    global pb_process, cf_process
    print("\n[*] Dang tat he thong PocketBase...")
    if pb_process:
        try:
            pb_process.terminate()
        except Exception:
            pass
    if cf_process:
        try:
            cf_process.terminate()
        except Exception:
            pass
    sys.exit(0)


def main():
    global pb_process
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    cfg = load_config()
    port = cfg.get("pocketbase_port", 8090)
    admin_email = cfg.get("admin_email", "admin@sgl.local")
    admin_pass = cfg.get("admin_password", "SglAdminPassword2026!")

    print("=======================================================")
    print("      SGL SMART BROADCAST - POCKETBASE BACKEND         ")
    print("=======================================================")
    print(f"[*] Dang khoi dong PocketBase tai cong {port}...")

    pb_process = start_pocketbase(port)
    if not wait_for_health(port):
        print("[!] Loi: PocketBase khong the khoi dong.")
        cleanup()
        return

    print("[✔] PocketBase Engine da san sang!")

    # Tu dong khoi tao Superuser & Collections
    print("[*] Dang kiem tra va khoi tao CSDL (Collections & Admin)...")
    from backend.pocketbase_setup import PocketBaseSetup
    setup = PocketBaseSetup(base_url=f"http://127.0.0.1:{port}", config=cfg)
    setup.ensure_superuser()
    setup.sync_collections()
    setup.seed_templates()

    # Khoi dong Cloudflare Tunnel neu chua co domain co dinh
    fixed_domain = cfg.get("fixed_domain", "").strip()
    if fixed_domain:
        print(f"[✔] Su dung Domain co dinh: {fixed_domain}")
    else:
        print("[*] Dang khoi tao Cloudflare Tunnel cong khai...")
        start_cloudflare_tunnel(port)

    # Mo Web UI
    web_file = os.path.join(ROOT_DIR, "web", "index.html")
    web_url = f"file:///{web_file.replace(os.sep, '/')}"
    print(f"\n[✔] HETHONG DA HOAN TAT KHOI DONG:")
    print(f"    - PocketBase REST API: http://127.0.0.1:{port}")
    print(f"    - PocketBase Admin UI: http://127.0.0.1:{port}/_/")
    print(f"      (Email: {admin_email} | Mat khau: {admin_pass})")
    print(f"    - Giao dien Web quan tri: {web_url}")
    print(f"-------------------------------------------------------")
    print("Nhan Ctrl+C de dung he thong.\n")

    try:
        webbrowser.open(web_url)
    except Exception:
        pass

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        cleanup()


if __name__ == "__main__":
    main()
