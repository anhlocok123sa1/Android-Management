import json
import os
import subprocess
import sys
import time
import unittest
import urllib.request
import urllib.error

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PB_EXE = os.path.join(ROOT_DIR, "bin", "pocketbase", "pocketbase.exe")
HOOKS_DIR = os.path.join(ROOT_DIR, "bin", "pocketbase", "pb_hooks")
TEST_PORT = 8098
TEST_DATA_DIR = os.path.join(ROOT_DIR, "bin", "pocketbase", "test_hook_pb_data")


class TestLegacyHook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Clean any prior test dir
        if os.path.exists(TEST_DATA_DIR):
            try:
                import shutil
                shutil.rmtree(TEST_DATA_DIR)
            except Exception:
                pass

        # Create collections in test db
        sys.path.insert(0, ROOT_DIR)
        from backend.pocketbase_setup import PocketBaseSetup, get_schema_definitions
        setup = PocketBaseSetup(base_url=f"http://127.0.0.1:{TEST_PORT}")
        setup.admin_email = "test@sgl.local"
        setup.admin_password = "TestPassword2026!"

        # Initialize superuser in test data dir
        cmd_su = [PB_EXE, "superuser", "upsert", setup.admin_email, setup.admin_password, "--dir", TEST_DATA_DIR]
        subprocess.run(cmd_su, capture_output=True, check=True)

        # Start PB server on TEST_PORT
        cmd_serve = [
            PB_EXE, "serve",
            f"--http=127.0.0.1:{TEST_PORT}",
            "--dir", TEST_DATA_DIR,
            "--hooksDir", HOOKS_DIR
        ]
        cls.pb_proc = subprocess.Popen(cmd_serve, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # Wait for PB to start
        ready = False
        for _ in range(30):
            time.sleep(0.3)
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{TEST_PORT}/api/health", timeout=1) as resp:
                    if resp.status == 200:
                        ready = True
                        break
            except Exception:
                pass
        if not ready:
            cls.pb_proc.kill()
            raise RuntimeError(f"PocketBase failed to start on port {TEST_PORT}")

        # Sync schema to test instance
        setup.sync_collections()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "pb_proc") and cls.pb_proc:
            cls.pb_proc.terminate()
            try:
                cls.pb_proc.wait(timeout=3)
            except Exception:
                cls.pb_proc.kill()

        if os.path.exists(TEST_DATA_DIR):
            time.sleep(0.5)
            try:
                import shutil
                shutil.rmtree(TEST_DATA_DIR)
            except Exception:
                pass

    def _post_webhook(self, payload: dict) -> dict:
        url = f"http://127.0.0.1:{TEST_PORT}/api/sgl_webhook"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            return json.loads(resp.read().decode("utf-8"))

    def test_legacy_register_device(self):
        payload = {
            "action": "register_device",
            "mac": "112233445566",
            "anydesk_id": "999888777",
            "project": "Dự án Hà Nội"
        }
        res = self._post_webhook(payload)
        self.assertEqual(res.get("status"), "ok")

    def test_legacy_heartbeat(self):
        payload = {
            "action": "heartbeat",
            "mac": "112233445566",
            "ram_mb": 1024,
            "storage_mb": 4096,
            "app_version": "3.6",
            "ip": "10.0.0.5"
        }
        res = self._post_webhook(payload)
        self.assertEqual(res.get("status"), "ok")

    def test_heartbeat_returns_pending_task_when_available(self):
        # Tạo task pending cho MAC A1B2C3D4E5F6
        test_mac = "A1B2C3D4E5F6"
        url = f"http://127.0.0.1:{TEST_PORT}/api/collections/tasks/records"
        task_data = {
            "task_id": "TASK_HB_TEST",
            "template_name": "deploy_radio_36",
            "target_mac": test_mac,
            "status": "pending"
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(task_data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)

        # Gửi heartbeat từ box
        hb_res = self._post_webhook({"action": "heartbeat", "mac": test_mac})
        self.assertEqual(hb_res.get("status"), "ok")
        # Phải trả về pending_task cho Android Box AgentService.java
        self.assertIsNotNone(hb_res.get("pending_task"))
        self.assertEqual(hb_res["pending_task"].get("task_id"), "TASK_HB_TEST")

    def test_complete_task_with_success_false(self):
        # Tạo task
        test_mac = "223344556677"
        task_id = "TASK_FAIL_TEST"
        url = f"http://127.0.0.1:{TEST_PORT}/api/collections/tasks/records"
        req = urllib.request.Request(
            url,
            data=json.dumps({"task_id": task_id, "template_name": "deploy_radio_36", "target_mac": test_mac, "status": "claimed"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)

        # Android Box gửi action complete_task với success: false
        comp_res = self._post_webhook({
            "action": "complete_task",
            "task_id": task_id,
            "success": False,
            "result": "APK corrupted"
        })
        self.assertEqual(comp_res.get("status"), "ok")

        # Kiểm tra trạng thái trong CSDL phải là failed
        query = urllib.parse.quote(f"task_id='{task_id}'")
        check_url = f"http://127.0.0.1:{TEST_PORT}/api/collections/tasks/records?filter=({query})"
        with urllib.request.urlopen(check_url, timeout=5) as resp:
            records = json.loads(resp.read().decode("utf-8")).get("items", [])
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["status"], "failed")

    def test_legacy_claim_and_complete_task(self):
        # 1. Tao task pending bang REST
        url = f"http://127.0.0.1:{TEST_PORT}/api/collections/tasks/records"
        task_data = {
            "task_id": "TASK_TEST_001",
            "template_name": "deploy_radio_36",
            "target_mac": "112233445566",
            "status": "pending"
        }
        req = urllib.request.Request(url, data=json.dumps(task_data).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)

        # 2. Claim task qua webhook
        claim_res = self._post_webhook({"action": "claim_task", "mac": "112233445566"})
        self.assertEqual(claim_res.get("status"), "ok")
        self.assertEqual(claim_res.get("task_id"), "TASK_TEST_001")

        # 3. Complete task qua webhook
        comp_res = self._post_webhook({
            "action": "complete_task",
            "task_id": "TASK_TEST_001",
            "status": "completed",
            "result": "Success installed 3.6"
        })
        self.assertEqual(comp_res.get("status"), "ok")


if __name__ == "__main__":
    unittest.main()
