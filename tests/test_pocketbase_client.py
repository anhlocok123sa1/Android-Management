import json
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sgl_manager.pocketbase_client import PocketBaseClient


class TestPocketBaseClient(unittest.TestCase):
    def setUp(self):
        self.client = PocketBaseClient(
            base_url="http://127.0.0.1:8090",
            secret="test_secret"
        )

    @patch("urllib.request.urlopen")
    def test_get_devices(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "items": [
                {"mac": "AABBCCDDEEFF", "anydesk_id": "111222333", "project": "Hà Nội", "status": "online"}
            ]
        }).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        devices = self.client.get_devices()
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0]["mac"], "AABBCCDDEEFF")

    @patch("urllib.request.urlopen")
    def test_register_device(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"id": "rec_123"}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        ok = self.client.register_device("11:22:33:44:55:66", "444555666", "Dự án HCM")
        self.assertTrue(ok)

    @patch("urllib.request.urlopen")
    def test_create_task(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"id": "rec_task"}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        task_ids = self.client.create_task("deploy_radio_36", ["112233445566", "AABBCCDDEEFF"])
        self.assertEqual(len(task_ids), 2)
        self.assertTrue(task_ids[0].startswith("TASK_"))

    @patch("urllib.request.urlopen")
    def test_get_templates(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "items": [
                {"template_name": "deploy_radio_36", "steps_json": "[]"}
            ]
        }).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        templates = self.client.get_templates()
        self.assertEqual(len(templates), 1)
        self.assertEqual(templates[0]["template_name"], "deploy_radio_36")

    @patch("urllib.request.urlopen")
    def test_get_tasks(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "items": [
                {"task_id": "TASK_1", "status": "pending", "target_mac": "112233445566"}
            ]
        }).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        tasks = self.client.get_tasks(mac="11:22:33:44:55:66")
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["task_id"], "TASK_1")

    @patch("urllib.request.urlopen")
    def test_register_device_returns_dict(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"id": "rec_123"}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        res = self.client.register_device(
            mac="AA:BB:CC:11:22:33",
            anydesk_id="123456",
            project="Dự án Test",
            software="Radio 3.6",
            mac_ics="AABBCC112233",
            iot_id="IOT_999"
        )
        self.assertIsInstance(res, dict)
        self.assertEqual(res.get("status"), "ok")


if __name__ == "__main__":
    unittest.main()
