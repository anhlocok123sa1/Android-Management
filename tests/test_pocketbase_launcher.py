import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from CHAY_POCKETBASE import load_config, wait_for_health, start_pocketbase, PB_EXE


class TestPocketBaseLauncher(unittest.TestCase):
    def test_load_config(self):
        cfg = load_config()
        self.assertIn("pocketbase_port", cfg)
        self.assertIn("admin_email", cfg)
        self.assertIn("api_secret", cfg)

    def test_pocketbase_exe_exists(self):
        self.assertTrue(os.path.isfile(PB_EXE))

    def test_pocketbase_start_and_health(self):
        port = 8097
        proc = start_pocketbase(port)
        try:
            ready = wait_for_health(port, max_retries=20)
            self.assertTrue(ready)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except Exception:
                proc.kill()


if __name__ == "__main__":
    unittest.main()
