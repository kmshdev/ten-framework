import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

MODULE_PATH = Path(__file__).resolve().parents[1] / "plivo_server.py"
SPEC = importlib.util.spec_from_file_location("plivo_server_health", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {MODULE_PATH}")
SERVER_MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SERVER_MODULE
SPEC.loader.exec_module(SERVER_MODULE)

PlivoServer = SERVER_MODULE.PlivoServer
PlivoServerConfig = SERVER_MODULE.PlivoServerConfig


class PlivoServerHealthTests(unittest.TestCase):
    def setUp(self):
        self.server = PlivoServer(PlivoServerConfig())

    def test_tenapp_is_not_healthy_before_process_start(self):
        self.assertFalse(self.server._tenapp_is_running())

    def test_tenapp_is_healthy_only_while_process_is_running(self):
        process = Mock()
        process.poll.return_value = None
        self.server.tenapp_process = process

        self.assertTrue(self.server._tenapp_is_running())

        process.poll.return_value = 1
        self.assertFalse(self.server._tenapp_is_running())

    def test_shutdown_invalidates_health_before_child_exit(self):
        process = Mock()
        process.poll.return_value = None
        self.server.tenapp_process = process
        self.server.shutdown_event.set()

        self.assertFalse(self.server._tenapp_is_running())


if __name__ == "__main__":
    unittest.main()
