import importlib.util
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

PACKAGE_PATH = Path(__file__).resolve().parents[1]
PACKAGE = types.ModuleType("readiness_main_python")
PACKAGE.__path__ = [str(PACKAGE_PATH)]
sys.modules[PACKAGE.__name__] = PACKAGE


def load_module(name):
    module_name = f"{PACKAGE.__name__}.{name}"
    spec = importlib.util.spec_from_file_location(module_name, PACKAGE_PATH / f"{name}.py")
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


load_module("call_state")
load_module("graph_probe")
CONFIG = load_module("config")
SERVER = load_module("server")
MainControlConfig = CONFIG.MainControlConfig
PlivoCallServer = SERVER.PlivoCallServer


class ReadinessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.plivo_client = patch.object(SERVER.plivo, "RestClient")
        self.plivo_client.start()
        self.server = PlivoCallServer(MainControlConfig())
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.server.app),
            base_url="http://test",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        self.plivo_client.stop()

    async def test_liveness_does_not_require_semantic_readiness(self):
        response = await self.client.get("/livez")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "alive")

    async def test_open_server_is_unready_without_coordinator(self):
        response = await self.client.get("/readyz")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "starting")
        self.assertEqual(response.headers["Retry-After"], "2")

    async def test_unready_coordinator_returns_controlled_503(self):
        self.server.extension_instance = SimpleNamespace(is_ready=lambda: False)

        response = await self.client.get("/readyz")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "starting")
        self.assertEqual(response.headers["Retry-After"], "2")

    async def test_ready_coordinator_enables_readiness(self):
        self.server.extension_instance = SimpleNamespace(is_ready=lambda: True)

        response = await self.client.get("/readyz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ready")
        self.assertNotIn("Retry-After", response.headers)


if __name__ == "__main__":
    unittest.main()
