import base64
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

try:
    from sarvam_asr_python.config import SarvamASRConfig
    from sarvam_asr_python.extension import SarvamASRExtension
    TEN_RUNTIME_IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    SarvamASRConfig = None
    SarvamASRExtension = None
    TEN_RUNTIME_IMPORT_ERROR = exc


@unittest.skipIf(
    TEN_RUNTIME_IMPORT_ERROR is not None,
    f"TEN runtime dependencies are unavailable: {TEN_RUNTIME_IMPORT_ERROR}",
)
class SarvamVadProtocolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.extension = SarvamASRExtension("stt")
        self.extension.config = SarvamASRConfig(
            api_key="test-key",
            sample_rate=8000,
            vad_signals=True,
            audio_encoding="pcm_s16le",
        )
        self.extension.ten_env = SimpleNamespace(
            log_debug=lambda *args, **kwargs: None,
            log_info=lambda *args, **kwargs: None,
            log_warn=lambda *args, **kwargs: None,
            log_error=lambda *args, **kwargs: None,
        )

    def test_websocket_url_enables_vad_signals(self):
        query = parse_qs(urlparse(self.extension._build_websocket_url()).query)

        self.assertEqual(query["sample_rate"], ["8000"])
        self.assertEqual(query["vad_signals"], ["true"])

    def test_audio_message_declares_raw_pcm(self):
        payload = b"\x01\x02\x03\x04"
        message = self.extension._build_audio_message(
            base64.b64encode(payload).decode("ascii")
        )

        self.assertEqual(message["audio"]["encoding"], "pcm_s16le")
        self.assertEqual(message["audio"]["sample_rate"], 8000)
        self.assertEqual(
            base64.b64decode(message["audio"]["data"]), payload
        )

    async def test_end_speech_flushes_once(self):
        self.extension.finalize = AsyncMock()

        await self.extension._handle_events(
            {"data": {"signal_type": "START_SPEECH"}}
        )
        await self.extension._handle_events(
            {"data": {"signal_type": "END_SPEECH"}}
        )
        await self.extension._handle_events(
            {"data": {"signal_type": "END_SPEECH"}}
        )

        self.assertFalse(self.extension._speaking)
        self.extension.finalize.assert_awaited_once_with(None)


if __name__ == "__main__":
    unittest.main()
