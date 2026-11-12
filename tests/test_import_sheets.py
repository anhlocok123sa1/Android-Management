import unittest
from unittest.mock import patch, MagicMock
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.import_sheets_to_pb import (
    transform_sheet_device_to_pb,
    transform_sheet_template_to_pb,
    import_from_sheet_data
)


class TestImportSheets(unittest.TestCase):
    def test_transform_sheet_device(self):
        raw = {
            "mac": "AA:BB:CC:DD:EE:FF",
            "anydesk_id": "123 456 789",
            "project": "Dự án Hà Nội",
            "status": "online",
            "last_seen": "2026-11-10T12:00:00Z",
            "app_version": "3.6",
            "storage_mb": 1024,
            "task_id": "TASK_123",
            "notes": "Test Box"
        }
        res = transform_sheet_device_to_pb(raw)
        # MAC should be stripped of colons for consistent search
        self.assertEqual(res["mac"], "AABBCCDDEEFF")
        self.assertEqual(res["anydesk_id"], "123456789")
        self.assertEqual(res["project"], "Dự án Hà Nội")
        self.assertEqual(res["status"], "online")

    def test_transform_sheet_template(self):
        raw = {
            "template_name": "deploy_test",
            "steps_json": '[{"action": "test"}]',
            "description": "Test template",
            "created_by": "tester"
        }
        res = transform_sheet_template_to_pb(raw)
        self.assertEqual(res["template_name"], "deploy_test")
        self.assertEqual(res["steps_json"], '[{"action": "test"}]')

    @patch("urllib.request.urlopen")
    def test_import_from_sheet_data_sends_records(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"status": "ok"}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        devices = [
            {"mac": "11:22:33:44:55:66", "anydesk_id": "111", "project": "Test"},
            {"mac": "77:88:99:00:11:22", "anydesk_id": "222", "project": "Test"}
        ]
        templates = [
            {"template_name": "tmpl_1", "steps_json": "[]"}
        ]

        count_dev, count_tmpl = import_from_sheet_data(
            devices=devices,
            templates=templates,
            pb_url="http://127.0.0.1:8090",
            token="test-token"
        )
        self.assertEqual(count_dev, 2)
        self.assertEqual(count_tmpl, 1)


if __name__ == "__main__":
    unittest.main()
