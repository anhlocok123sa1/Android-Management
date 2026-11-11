import unittest
import json
import os
import sys

# Add project root to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.pocketbase_setup import (
    get_schema_definitions,
    get_default_templates,
    PocketBaseSetup
)


class TestPocketBaseSetup(unittest.TestCase):
    def test_schema_definitions_has_four_collections(self):
        schemas = get_schema_definitions()
        self.assertIn("devices", schemas)
        self.assertIn("tasks", schemas)
        self.assertIn("templates", schemas)
        self.assertIn("heartbeats", schemas)

    def test_devices_schema_fields(self):
        schemas = get_schema_definitions()
        dev_fields = [f["name"] for f in schemas["devices"]["fields"]]
        expected = ["mac", "anydesk_id", "project", "status", "last_seen", "app_version", "storage_mb", "task_id", "notes"]
        for exp in expected:
            self.assertIn(exp, dev_fields)

    def test_tasks_schema_fields(self):
        schemas = get_schema_definitions()
        task_fields = [f["name"] for f in schemas["tasks"]["fields"]]
        expected = ["task_id", "template_name", "target_mac", "status", "created_at", "claimed_at", "completed_at", "result"]
        for exp in expected:
            self.assertIn(exp, task_fields)

    def test_default_templates_contain_standard_deployments(self):
        templates = get_default_templates()
        names = [t["template_name"] for t in templates]
        self.assertIn("deploy_radio_36", names)
        self.assertIn("deploy_vnpt_ics", names)
        self.assertIn("deploy_radio_166", names)
        self.assertIn("deploy_radio_20", names)
        # Verify steps_json is valid JSON
        for t in templates:
            parsed = json.loads(t["steps_json"])
            self.assertIsInstance(parsed, list)
            self.assertGreater(len(parsed), 0)


if __name__ == "__main__":
    unittest.main()
