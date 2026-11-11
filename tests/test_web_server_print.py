import unittest
import json
import urllib.request
import urllib.error
import threading
import socketserver
import time

from web_server import SGLWebHandler

class TestWebServerPrintEndpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 18081
        socketserver.TCPServer.allow_reuse_address = True
        cls.httpd = socketserver.TCPServer(("127.0.0.1", cls.port), SGLWebHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.3)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def test_options_cors_preflight(self):
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/print_label",
            method="OPTIONS"
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"), "*")
            self.assertIn("POST", resp.headers.get("Access-Control-Allow-Methods", ""))

    def test_post_print_label_success(self):
        payload = json.dumps({"anydesk_id": "1233589246", "iot_id": "11250"}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/print_label",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"), "*")
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data.get("status"), "ok")

if __name__ == "__main__":
    unittest.main()
