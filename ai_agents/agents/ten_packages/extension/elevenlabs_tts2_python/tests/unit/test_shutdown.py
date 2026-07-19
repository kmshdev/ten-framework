import asyncio
import importlib.util
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[2] / "shutdown.py"
SPEC = importlib.util.spec_from_file_location(
    "elevenlabs_shutdown", MODULE_PATH
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {MODULE_PATH}")
SHUTDOWN = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SHUTDOWN
SPEC.loader.exec_module(SHUTDOWN)


class ShutdownTests(unittest.IsolatedAsyncioTestCase):
    def test_sample_rate_is_safe_before_initialization(self):
        self.assertEqual(SHUTDOWN.sample_rate_or_default(None), 16000)

    def test_sample_rate_uses_initialized_config(self):
        config = type("Config", (), {"sample_rate": 24000})()
        self.assertEqual(SHUTDOWN.sample_rate_or_default(config), 24000)

    async def test_cancelled_task_finishes_within_deadline(self):
        task = asyncio.create_task(asyncio.sleep(60))

        self.assertTrue(await SHUTDOWN.cancel_and_wait(task, timeout=0.1))
        self.assertTrue(task.cancelled())

    async def test_cancellation_resistant_task_does_not_block_shutdown(self):
        release = asyncio.Event()

        async def resistant_task():
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                await release.wait()

        task = asyncio.create_task(resistant_task())
        await asyncio.sleep(0)

        self.assertFalse(await SHUTDOWN.cancel_and_wait(task, timeout=0.01))
        self.assertFalse(task.done())

        release.set()
        await task

    async def test_teardown_coroutine_is_bounded(self):
        release = asyncio.Event()

        async def stalled_close():
            await release.wait()

        self.assertFalse(
            await SHUTDOWN.run_with_deadline(stalled_close(), timeout=0.01)
        )


if __name__ == "__main__":
    unittest.main()
