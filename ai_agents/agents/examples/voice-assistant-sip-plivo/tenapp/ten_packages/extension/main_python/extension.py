import asyncio
import json
import time
import base64
import os
import re
import audioop
import aiohttp
from datetime import datetime
from typing import Literal, Dict, Any, Optional
from .server import PlivoCallServer

from .agent.decorators import agent_event_handler
from ten_runtime import (
    AsyncExtension,
    AsyncTenEnv,
    Cmd,
    Data,
    AudioFrame,
    Loc,
)
from ten_runtime.audio_frame import AudioFrameDataFmt

from .agent.agent import Agent
from .agent.events import (
    ASRResultEvent,
    LLMResponseEvent,
    ToolRegisterEvent,
    UserJoinedEvent,
    UserLeftEvent,
)
from .helper import _send_cmd, _send_data, parse_sentences
from .config import MainControlConfig
from .memory import CallMemory

from ten_ai_base.struct import LLMMessageContent

import uuid


SUPPORTED_INTENT_KEYWORDS = {
    "order",
    "delivery",
    "deliver",
    "delivered",
    "status",
    "track",
    "tracking",
    "courier",
    "shipment",
    "refund",
    "return",
    "replace",
    "replacement",
    "missing",
    "wrong",
    "damaged",
    "product",
    "flavour",
    "flavor",
    "protein",
    "price",
    "help",
    "support",
    "assistant",
    "human",
    "agent",
    "person",
    "representative",
    "hear",
    "listen",
    "voice",
    "audio",
    "cancel",
    "payment",
    "item",
    "items",
    "stop",
    "wait",
    "pause",
    "hold",
    "रुको",
    "रुकिए",
    "ठहरो",
    "ऑर्डर",
    "डिलीवरी",
    "स्टेटस",
    "कूरियर",
    "रिफंड",
    "रिटर्न",
    "प्रोडक्ट",
    "मदद",
    "सामान",
}

FILLER_ONLY_UTTERANCES = {
    "haan",
    "han",
    "ha",
    "hmm",
    "hm",
    "uh",
    "umm",
    "um",
    "yes",
    "yeah",
    "yup",
    "ok",
    "okay",
    "hello",
    "hi",
    "हाँ",
    "हां",
    "हा",
    "जी",
}

UNSUPPORTED_TV_SCRIPT_RE = re.compile(r"[\u0980-\u09FF\u0A80-\u0AFF\u0B00-\u0B7F]")
DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
ASCII_LETTER_RE = re.compile(r"[A-Za-z]")
WORD_RE = re.compile(r"[\w\u0900-\u097F]+", re.UNICODE)


class MainControlExtension(AsyncExtension):
    """
    The entry point of the agent module.
    Consumes semantic AgentEvents from the Agent class and drives the runtime behavior.
    """

    def __init__(self, name: str):
        super().__init__(name)
        self.ten_env: AsyncTenEnv = None
        self.agent: Agent = None
        self.config: MainControlConfig = None

        # WebSocket and audio processing
        self.audio_dump_files: Dict[str, str] = {}  # call_uuid -> filepath

        # Server management
        self.server_task: Optional[asyncio.Task] = None
        self.server_instance: Optional[PlivoCallServer] = None
        self.audio_dump_dir: str = ""

        self.stopped: bool = False
        self.runtime_ready: bool = False
        self.sentence_fragment: str = ""
        self.turn_id: int = 0
        self.session_id: str = ""
        self.call_uuid: str = ""
        self.mode: str = "worker"
        self._interrupted_utterance: bool = False
        self._received_user_turn: bool = False
        self.memory: Optional[CallMemory] = None
        # Low-volume production diagnostics for the Plivo playback path.
        # Keyed by call UUID so each call logs only the first few audio chunks
        # plus state transitions, avoiding noisy per-frame logs.
        self._plivo_audio_stats: Dict[str, Dict[str, Any]] = {}

    def is_ready(self) -> bool:
        if self.mode == "coordinator":
            return bool(
                self.runtime_ready
                and not self.stopped
                and self.server_task
                and not self.server_task.done()
            )
        return bool(
            self.runtime_ready and not self.stopped and self.agent and self.memory
        )

    def _current_metadata(self) -> dict:
        return {
            "session_id": self.session_id,
            "call_uuid": self.call_uuid,
            "turn_id": self.turn_id,
        }

    def _is_unsupported_tv_or_noise(self, text: str) -> bool:
        """Reject ASR that is likely background TV/noise, not caller intent.

        The demo is Hindi/English/Hinglish. Deepgram multi-language can
        transcribe background TV into other Indic scripts; feeding those to the
        LLM triggers the prompt's filler fallback ("Haan, boliye?").
        """
        normalized = " ".join(text.strip().lower().split())
        if not normalized:
            return True

        if UNSUPPORTED_TV_SCRIPT_RE.search(normalized):
            return True

        compact = re.sub(r"[^\w\u0900-\u097F]+", "", normalized)
        if compact in FILLER_ONLY_UTTERANCES:
            return True

        words = WORD_RE.findall(normalized)
        has_keyword = any(keyword in normalized for keyword in SUPPORTED_INTENT_KEYWORDS)
        has_devanagari = bool(DEVANAGARI_RE.search(normalized))
        asks_question = "?" in normalized or normalized.startswith(
            ("what", "where", "when", "why", "how", "can", "could", "please", "do you")
        )

        # Non-Hindi/English support calls should contain either a support
        # keyword or a clear question. Otherwise they are commonly background
        # TV, voicemail prompts, or ASR hallucinations (for example "To record
        # your name and reason for" / "All the junior" from the latest calls).
        if not has_devanagari and not has_keyword and not asks_question:
            return True

        # Very short fragments without support intent are usually fillers.
        if len(words) <= 3 and not has_keyword and not asks_question:
            return True

        return False

    def _language_instruction_for(self, text: str) -> str:
        has_devanagari = bool(DEVANAGARI_RE.search(text))
        has_ascii = bool(ASCII_LETTER_RE.search(text))
        if has_ascii and not has_devanagari:
            return "Caller spoke English. Reply in clear English only; do not use Hindi or Hinglish unless the caller switches language."
        if has_devanagari and not has_ascii:
            return "Caller spoke Hindi. Reply in natural Hindi using Devanagari script."
        return "Caller spoke Hinglish. Reply in the same Hinglish mix, using Devanagari for Hindi words."

    async def on_init(self, ten_env: AsyncTenEnv):
        self.ten_env = ten_env

        # Load config from runtime properties
        config_json, _ = await ten_env.get_property_to_json(None)

        self.ten_env.log_info(f"Config12: {config_json}")

        self.config = MainControlConfig.model_validate_json(config_json)
        self.mode = self.config.mode

        self.ten_env.log_info(f"Config11: {self.config}")

        if self.mode == "coordinator":
            await self._start_server()
            return

        self.agent = Agent(ten_env)
        self.memory = CallMemory(
            ten_env,
            mem0_api_key=self.config.mem0_api_key,
            demo_api_base=self.config.demo_api_base,
            demo_api_token=self.config.plivo_auth_token,
        )
        await self.memory.start()

        async def _on_tool_call(_ten_env, name: str, arguments: dict):
            self.memory.record_turn(
                "tool", f"{name}({json.dumps(arguments, ensure_ascii=False)})"
            )

        self.agent.llm_exec.on_tool_call = _on_tool_call

        for attr_name in dir(self):
            fn = getattr(self, attr_name)
            event_type = getattr(fn, "_agent_event_type", None)
            if event_type:
                self.agent.on(event_type, fn)

    async def _start_server(self):
        """Start the Plivo call server in the same process"""
        try:
            # Create server instance with config and ten_env
            self.server_instance = PlivoCallServer(self.config, self.ten_env)

            # Set extension instance reference for audio forwarding
            self.server_instance.extension_instance = self

            # Start the server as a background task using configured port
            self.server_task = asyncio.create_task(
                self.server_instance.start_server(
                    port=self.config.plivo_server_port
                )
            )

            self.ten_env.log_info(
                f"Started Plivo call server on port {self.config.plivo_server_port} (HTTP + WebSocket)"
            )

            # Wait a moment for the server to start
            await asyncio.sleep(1)

            self.ten_env.log_info("Plivo call server started successfully")

        except Exception as e:
            self.ten_env.log_error(f"Failed to start server: {str(e)}")
            raise

    async def _start_call_graph(self, call_uuid: str | None = None) -> str:
        cmd = Cmd.create("start_graph")
        cmd.set_property_string("predefined_graph_name", self.config.call_graph_name)
        result, error = await self.ten_env.send_cmd(cmd)
        if error or not result:
            raise RuntimeError(f"failed to start call graph: {error}")
        graph_id, property_error = result.get_property_string("graph_id")
        if property_error or not graph_id:
            raise RuntimeError(f"start_graph returned no graph_id: {property_error}")
        if call_uuid:
            await self.server_instance.active_call_sessions.bind_graph(
                call_uuid, graph_id
            )
        return graph_id

    async def _stop_call_graph(self, graph_id: str) -> None:
        cmd = Cmd.create("stop_graph")
        cmd.set_property_string("graph_id", graph_id)
        _, error = await self.ten_env.send_cmd(cmd)
        if error:
            raise RuntimeError(f"failed to stop graph {graph_id}: {error}")

    async def graph_smoke_test(self) -> str:
        graph_id = await self._start_call_graph()
        await self._stop_call_graph(graph_id)
        return graph_id

    async def _stop_server(self):
        """Stop the Plivo call server"""
        try:
            if self.server_task and not self.server_task.done():
                self.ten_env.log_info("Stopping Plivo call server")

                # Cancel the server task
                self.server_task.cancel()

                # Wait for task to complete
                try:
                    await asyncio.wait_for(self.server_task, timeout=5.0)
                except asyncio.TimeoutError:
                    self.ten_env.log_warn("Server task didn't stop gracefully")
                except asyncio.CancelledError:
                    pass  # Expected when cancelling

                self.ten_env.log_info("Plivo call server stopped successfully")

            # Cleanup server instance
            if self.server_instance:
                self.server_instance.cleanup()
                self.server_instance = None

            self.server_task = None

        except Exception as e:
            self.ten_env.log_error(f"Error stopping server: {str(e)}")

    async def _end_call_and_cleanup(self, call_uuid: str):
        """End a call and cleanup resources"""
        try:
            # First, try to end the call via API
            if call_uuid in self.server_instance.active_call_sessions:
                self.ten_env.log_info(f"Ending call {call_uuid} via API")

                # Make API call to end the call
                async with aiohttp.ClientSession() as session:
                    async with session.delete(
                        f"http://localhost:{self.config.plivo_server_port}/api/call/{call_uuid}"
                    ) as response:
                        if response.status == 200:
                            self.ten_env.log_info(
                                f"Call {call_uuid} ended successfully"
                            )
                        else:
                            self.ten_env.log_warn(
                                f"Failed to end call {call_uuid} via API: {response.status}"
                            )

            # Cleanup local resources
            if call_uuid in self.server_instance.active_call_sessions:
                del self.server_instance.active_call_sessions[call_uuid]

            if call_uuid in self.audio_dump_files:
                # Clean up audio dump file
                try:
                    os.remove(self.audio_dump_files[call_uuid])
                    del self.audio_dump_files[call_uuid]
                except Exception as e:
                    self.ten_env.log_warn(
                        f"Failed to cleanup audio file for {call_uuid}: {str(e)}"
                    )

        except Exception as e:
            self.ten_env.log_error(
                f"Error during call cleanup for {call_uuid}: {str(e)}"
            )

    # === Register handlers with decorators ===
    @agent_event_handler(ToolRegisterEvent)
    async def _on_tool_register(self, event: ToolRegisterEvent):
        await self.agent.register_llm_tool(event.tool, event.source)

    @agent_event_handler(ASRResultEvent)
    async def _on_asr_result(self, event: ASRResultEvent):
        self.ten_env.log_info(
            f"[MainControlExtension] ASR Result: {event.text}"
        )
        self.session_id = event.metadata.get("session_id", "")
        self.call_uuid = event.metadata.get("call_uuid", self.call_uuid)
        stream_id = self.session_id
        if not event.text:
            return

        normalized_text = " ".join(event.text.strip().lower().split())
        # A greeting is a valid first turn after Maya's opening. It used to be
        # filtered as background filler, leaving callers who said only "hello"
        # with silence even though Plivo had delivered the greeting correctly.
        is_initial_greeting = (
            not self._received_user_turn
            and normalized_text in {"hello", "hi", "namaste", "नमस्ते"}
        )
        if self._is_unsupported_tv_or_noise(event.text) and not is_initial_greeting:
            self.ten_env.log_info(
                f"[MainControlExtension] Ignored ASR noise/filler: {event.text}"
            )
            return

        # Interrupt on the first meaningful partial instead of waiting for an
        # arbitrary transcript length. This makes short commands such as
        # "stop" and "रुकिए" effective and avoids repeatedly flushing for
        # every revision of the same utterance.
        if not self._interrupted_utterance:
            await self._interrupt()
            self._interrupted_utterance = True
        if event.final:
            self.turn_id += 1
            language_instruction = self._language_instruction_for(event.text)
            llm_input = (
                f"[{language_instruction} Questions about SuperYou itself, including "
                "its history, founders, company, and brand, are valid support questions. "
                "Use search_superyou_kb before answering them; do not classify them as "
                f"off-topic.]\nCaller: {event.text}"
            )
            await self.agent.queue_llm_input(llm_input)
            self.memory.record_turn("user", event.text, self.turn_id)
            self._received_user_turn = True
            self._interrupted_utterance = False
        await self._send_transcript("user", event.text, event.final, stream_id)

    @agent_event_handler(LLMResponseEvent)
    async def _on_llm_response(self, event: LLMResponseEvent):
        if not event.is_final and event.type == "message":
            sentences, self.sentence_fragment = parse_sentences(
                self.sentence_fragment, event.delta
            )
            for s in sentences:
                await self._send_to_tts(s, False)

        if event.is_final and event.type == "message":
            remaining_text = self.sentence_fragment or ""
            self.sentence_fragment = ""
            await self._send_to_tts(remaining_text, True)
            self.memory.record_turn("assistant", event.text, self.turn_id)

        await self._send_transcript(
            "assistant",
            event.text,
            event.is_final,
            self.session_id,
            data_type=("reasoning" if event.type == "reasoning" else "text"),
        )

    async def on_start(self, ten_env: AsyncTenEnv):
        ten_env.log_info("[MainControlExtension] on_start")
        self.runtime_ready = True

        # Initialize WebSocket and audio processing
        if self.config:
            self._setup_audio_dump_directory()

            # WebSocket server is now handled by the main server in server.py
            ten_env.log_info(
                "WebSocket server is integrated with the main HTTP server"
            )

    async def on_stop(self, ten_env: AsyncTenEnv):
        ten_env.log_info("[MainControlExtension] on_stop")
        self.stopped = True
        self.runtime_ready = False

        if self.mode == "coordinator":
            if self.server_instance:
                for call_uuid in list(
                    self.server_instance.active_call_sessions.keys()
                ):
                    await self._end_call_and_cleanup(call_uuid)
            await self._stop_server()
            return

        if self.memory:
            await self.memory.save()
            await self.memory.stop()
        if self.agent:
            await self.agent.stop()

    async def on_cmd(self, ten_env: AsyncTenEnv, cmd: Cmd):
        if self.agent:
            await self.agent.on_cmd(cmd)

    async def on_data(self, ten_env: AsyncTenEnv, data: Data):
        if data.get_name() == "call_start" and self.mode == "worker":
            payload_json, _ = data.get_property_to_json(None)
            await self._initialize_call_worker(json.loads(payload_json or "{}"))
            return
        if data.get_name() == "clear_playback" and self.mode == "coordinator":
            payload_json, _ = data.get_property_to_json(None)
            payload = json.loads(payload_json or "{}")
            await self._clear_call_playback(str(payload.get("call_uuid", "")))
            return
        if self.agent:
            await self.agent.on_data(data)

    async def on_audio_frame(
        self, ten_env: AsyncTenEnv, audio_frame: AudioFrame
    ) -> None:
        """Route each TTS frame to exactly one call-owned Plivo stream."""
        try:
            if audio_frame.get_name() != "pcm_frame":
                return
            if self.mode == "worker":
                if not self.call_uuid:
                    ten_env.log_error("Dropping TTS frame before call_start")
                    return
                audio_frame.set_property_string("call_uuid", self.call_uuid)
                audio_frame.set_dests(
                    [Loc("", self.config.coordinator_graph_id, "main_control")]
                )
                await ten_env.send_audio_frame(audio_frame)
                return

            call_uuid, _ = audio_frame.get_property_string("call_uuid")
            if not call_uuid:
                ten_env.log_error("Dropping unowned TTS frame at coordinator")
                return
            await self.send_audio_to_plivo(audio_frame.get_buf(), call_uuid)
        except Exception as e:
            ten_env.log_error(f"Failed to handle audio frame: {e}")

    # === helpers ===
    async def _send_transcript(
        self,
        role: str,
        text: str,
        final: bool,
        stream_id: str,
        data_type: Literal["text", "reasoning"] = "text",
    ):
        """
        Sends the transcript (ASR or LLM output) to the message collector.
        """
        if data_type == "text":
            await _send_data(
                self.ten_env,
                "message",
                "message_collector",
                {
                    "data_type": "transcribe",
                    "role": role,
                    "text": text,
                    "text_ts": int(time.time() * 1000),
                    "is_final": final,
                    "stream_id": stream_id,
                },
            )
        elif data_type == "reasoning":
            await _send_data(
                self.ten_env,
                "message",
                "message_collector",
                {
                    "data_type": "raw",
                    "role": role,
                    "text": json.dumps(
                        {
                            "type": "reasoning",
                            "data": {
                                "text": text,
                            },
                        }
                    ),
                    "text_ts": int(time.time() * 1000),
                    "is_final": final,
                    "stream_id": stream_id,
                },
            )
        self.ten_env.log_info(
            f"[MainControlExtension] Sent transcript: {role}, final={final}, text={text}"
        )

    async def _send_to_tts(self, text: str, is_final: bool):
        """
        Sends a sentence to the TTS system.
        """
        # ElevenLabsTTS2Extension retains completed request IDs for the life of
        # the process and drops duplicates. turn_id resets to zero after each
        # call, so `tts-request-0` made every greeting after the first call
        # silently skip TTS. Scope the ID to the unique Plivo call UUID while
        # keeping it stable across sentence chunks in the same turn.
        call_scope = (
            self.memory.call_uuid
            if self.memory and self.memory.call_uuid
            else self.session_id or "unscoped"
        )
        request_id = f"tts-request-{call_scope}-{self.turn_id}"
        await _send_data(
            self.ten_env,
            "tts_text_input",
            "tts",
            {
                "request_id": request_id,
                "text": text,
                "text_input_end": is_final,
                "metadata": self._current_metadata(),
            },
        )
        self.ten_env.log_info(
            f"[MainControlExtension] Sent to TTS: is_final={is_final}, text={text}"
        )

    async def _interrupt(self):
        """
        Interrupts ongoing LLM and TTS generation. Typically called when user speech is detected.
        """
        self.sentence_fragment = ""
        await self.agent.flush_llm()
        await _send_data(
            self.ten_env, "tts_flush", "tts", {"flush_id": str(uuid.uuid4())}
        )
        data = Data.create("clear_playback")
        data.set_property_from_json(None, json.dumps({"call_uuid": self.call_uuid}))
        data.set_dests(
            [Loc("", self.config.coordinator_graph_id, "main_control")]
        )
        await self.ten_env.send_data(data)
        self.ten_env.log_info("[MainControlExtension] Interrupt signal sent")

    async def _clear_call_playback(self, call_uuid: str) -> None:
        session = self.server_instance.active_call_sessions.get(call_uuid)
        if not session or not session.websocket:
            return
        await session.websocket.send_text(
            json.dumps(
                {"event": "clearAudio", "streamId": session.stream_id or ""}
            )
        )

    # WebSocket and audio processing methods
    def _setup_audio_dump_directory(self):
        """Setup directory for audio dump files"""
        # Use configured directory or default
        self.audio_dump_dir = getattr(
            self.config, "audio_dump_directory", "/tmp/plivo_audio_dumps"
        )
        os.makedirs(self.audio_dump_dir, exist_ok=True)
        if self.ten_env:
            self.ten_env.log_info(
                f"Audio dump directory created: {self.audio_dump_dir}"
            )

    async def _forward_audio_to_ten(
        self, audio_payload: str, stream_id: str, call_uuid: str
    ):
        """Forward audio data to TEN framework and dump PCM audio"""
        try:
            if not self.ten_env:
                return

            # Decode base64 audio data (this is μ-law encoded)
            mulaw_data = base64.b64decode(audio_payload)

            # Convert μ-law to PCM
            pcm_data = audioop.ulaw2lin(
                mulaw_data, 2
            )  # 2 bytes per sample (16-bit)

            # Dump PCM audio to file
            # await self._dump_pcm_audio(pcm_data, stream_id)

            # Create AudioFrame and send to TEN framework
            audio_frame = AudioFrame.create("pcm_frame")
            audio_frame.alloc_buf(len(pcm_data))
            buf = audio_frame.lock_buf()
            buf[:] = pcm_data
            audio_frame.unlock_buf(buf)
            audio_frame.set_sample_rate(8000)  # Plivo's fixed sample rate
            audio_frame.set_number_of_channels(1)
            audio_frame.set_bytes_per_sample(2)
            audio_frame.set_data_fmt(AudioFrameDataFmt.INTERLEAVE)
            audio_frame.set_samples_per_channel(len(pcm_data) // (2 * 1))
            audio_frame.set_property_string("plivo_stream_id", stream_id)
            audio_frame.set_property_string("call_uuid", call_uuid)
            session = self.server_instance.active_call_sessions.get(call_uuid)
            graph_id = session.graph_id if session else None
            if not graph_id:
                self.ten_env.log_warn(
                    f"Dropping inbound audio before graph is ready for {call_uuid}"
                )
                return
            audio_frame.set_dests(
                [
                    Loc(
                        app_uri="",
                        graph_id=graph_id,
                        extension_name="streamid_adapter",
                    )
                ]
            )

            await self.ten_env.send_audio_frame(audio_frame)

        except Exception as e:
            if self.ten_env:
                self.ten_env.log_error(f"Failed to forward audio to TEN: {e}")

    def _init_audio_dump_file(self, call_uuid: str):
        """Initialize audio dump file for a call"""
        try:
            if call_uuid in self.audio_dump_files:
                return  # File already initialized

            # Create filename with timestamp and call_uuid
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"plivo_audio_{call_uuid}_{timestamp}.pcm"
            filepath = os.path.join(self.audio_dump_dir, filename)

            # Create empty file to initialize
            with open(filepath, "wb") as f:
                pass  # Create empty file

            self.audio_dump_files[call_uuid] = filepath

            if self.ten_env:
                self.ten_env.log_info(
                    f"Initialized audio dump file: {filepath}"
                )

        except Exception as e:
            if self.ten_env:
                self.ten_env.log_error(
                    f"Failed to initialize audio dump file: {e}"
                )

    async def _dump_pcm_audio(self, audio_data: bytes, call_uuid: str):
        """Dump PCM audio data to file"""
        try:
            # Initialize file if not exists
            if call_uuid not in self.audio_dump_files:
                self._init_audio_dump_file(call_uuid)

            # Get filepath for this call
            filepath = self.audio_dump_files.get(call_uuid)
            if not filepath:
                return

            # Write PCM audio data to file
            with open(
                filepath, "ab"
            ) as f:  # 'ab' mode for appending binary data
                f.write(audio_data)

            if self.ten_env:
                self.ten_env.log_info(
                    f"Dumped {len(audio_data)} bytes of PCM audio (converted from μ-law) to {filepath}"
                )

        except Exception as e:
            if self.ten_env:
                self.ten_env.log_error(f"Failed to dump PCM audio: {e}")

    def _downsample_audio(
        self, audio_data: bytes, source_rate: int, target_rate: int
    ) -> bytes:
        """Downsample audio data from source rate to target rate"""
        try:
            if source_rate == target_rate:
                return audio_data

            # Convert bytearray to bytes if needed
            if isinstance(audio_data, bytearray):
                audio_data = bytes(audio_data)

            # For 16000 Hz to 8000 Hz, use simple decimation (take every 2nd sample)
            if source_rate == 16000 and target_rate == 8000:
                # Simple decimation: take every 2nd sample (16-bit = 2 bytes per sample)
                decimated_audio = bytearray()
                for i in range(
                    0, len(audio_data), 4
                ):  # Skip every 2nd sample (4 bytes = 2 samples)
                    if i + 1 < len(audio_data):
                        decimated_audio.extend(
                            audio_data[i : i + 2]
                        )  # Take first sample (2 bytes)

                return bytes(decimated_audio)

            # For other conversions, use audioop.ratecv
            import math

            # Calculate the conversion ratio
            gcd_rate = math.gcd(source_rate, target_rate)
            old_rate = source_rate // gcd_rate
            new_rate = target_rate // gcd_rate

            # Convert audio using ratecv
            converted_audio, _ = audioop.ratecv(
                audio_data, 2, 1, old_rate, new_rate, None, None
            )

            return converted_audio

        except Exception as e:
            if self.ten_env:
                self.ten_env.log_error(f"Failed to downsample audio: {e}")
            return audio_data  # Return original data if conversion fails

    async def send_audio_to_plivo(self, audio_data: bytes, call_uuid: str):
        """Send audio data to Plivo via WebSocket"""
        try:
            if not self.server_instance:
                if self.ten_env:
                    self.ten_env.log_error(
                        f"Cannot send Plivo audio for {call_uuid}: server not initialized"
                    )
                return

            if call_uuid not in self.server_instance.active_call_sessions:
                if self.ten_env:
                    self.ten_env.log_error(
                        f"Cannot send Plivo audio for {call_uuid}: no active session"
                    )
                return

            session = self.server_instance.active_call_sessions[call_uuid]
            stats = self._plivo_audio_stats.setdefault(
                call_uuid,
                {
                    "chunks": 0,
                    "bytes": 0,
                    "missing_websocket_logged": False,
                    "checkpoints_sent": [],
                    "played_checkpoints": [],
                },
            )

            websocket = session.get("websocket")
            if not websocket:
                if self.ten_env and not stats.get("missing_websocket_logged"):
                    self.ten_env.log_error(
                        f"Cannot send Plivo audio for {call_uuid}: websocket missing; "
                        f"session_keys={sorted(session.keys())}"
                    )
                    stats["missing_websocket_logged"] = True
                return

            # The Stream XML explicitly declares audio/x-mulaw;rate=8000.
            # Plivo requires each playAudio payload to match that negotiated
            # format. ElevenLabs emits PCM16 at 16 kHz, so convert it to the
            # declared μ-law/8k stream format before sending.
            downsampled_audio = self._downsample_audio(audio_data, 16000, 8000)
            mulaw_data = audioop.lin2ulaw(downsampled_audio, 2)
            audio_base64 = base64.b64encode(mulaw_data).decode("utf-8")

            stream_id = session.get("stream_id")

            message = {
                "event": "playAudio",
                "media": {
                    "contentType": "audio/x-mulaw",
                    "sampleRate": 8000,
                    "payload": audio_base64,
                },
            }

            next_chunk = int(stats.get("chunks", 0)) + 1
            if next_chunk <= 3 and self.memory and self.memory.call_uuid == call_uuid:
                self.memory.record_turn(
                    "tool",
                    (
                        f"plivo_playAudio_attempt(chunk={next_chunk}, "
                        f"contentType=audio/x-mulaw, sampleRate=8000, "
                        f"pcm16_bytes={len(audio_data)}, mulaw_bytes={len(mulaw_data)})"
                    ),
                )

            await websocket.send_text(json.dumps(message))

            stats["chunks"] = next_chunk
            stats["bytes"] = int(stats.get("bytes", 0)) + len(audio_data)

            # Proof instrumentation: ask Plivo to acknowledge that playback
            # reaches early audio chunks. This does not alter audio content; it
            # only emits playedStream when Plivo actually reaches the marker.
            if stats["chunks"] <= 3 and self.memory and self.memory.call_uuid == call_uuid:
                self.memory.record_turn(
                    "tool",
                    f"plivo_playAudio_sent(chunk={stats['chunks']})",
                )

            if stream_id and stats["chunks"] in (1, 3):
                checkpoint_name = f"{call_uuid}:chunk-{stats['chunks']}"
                await websocket.send_text(
                    json.dumps(
                        {
                            "event": "checkpoint",
                            "streamId": stream_id,
                            "name": checkpoint_name,
                        }
                    )
                )
                stats.setdefault("checkpoints_sent", []).append(checkpoint_name)
                if self.memory and self.memory.call_uuid == call_uuid:
                    self.memory.record_turn(
                        "tool", f"plivo_checkpoint_sent({checkpoint_name})"
                    )
                if self.ten_env:
                    self.ten_env.log_info(
                        f"Sent Plivo checkpoint for {call_uuid}: {checkpoint_name}"
                    )

            if self.ten_env and stats["chunks"] <= 3:
                self.ten_env.log_info(
                    f"Sent Plivo playAudio chunk for {call_uuid}: "
                    f"chunk={stats['chunks']} contentType=audio/x-mulaw "
                    f"sampleRate=8000 pcm16_bytes={len(audio_data)} "
                    f"mulaw_bytes={len(mulaw_data)} stream_id={stream_id or '<missing>'}"
                )

        except Exception as e:
            if self.ten_env:
                self.ten_env.log_error(f"Failed to send audio to Plivo: {e}")

    async def on_plivo_playback_event(self, message: dict):
        """Record Plivo playback acknowledgements for proof/debugging."""
        try:
            event = message.get("event", "")
            stream_id = message.get("streamId", "")
            name = message.get("name", "")
            call_uuid = ""
            if name and ":" in name:
                call_uuid = name.split(":", 1)[0]
            else:
                for cid, session in self.server_instance.active_call_sessions.items():
                    if session.get("stream_id") == stream_id:
                        call_uuid = cid
                        break

            if call_uuid:
                stats = self._plivo_audio_stats.setdefault(
                    call_uuid,
                    {
                        "chunks": 0,
                        "bytes": 0,
                        "missing_websocket_logged": False,
                        "checkpoints_sent": [],
                        "played_checkpoints": [],
                    },
                )
                if event == "playedStream" and name:
                    stats.setdefault("played_checkpoints", []).append(name)
                    if self.memory and self.memory.call_uuid == call_uuid:
                        self.memory.record_turn("tool", f"plivo_playedStream({name})")
                elif event == "clearedAudio":
                    stats["cleared_audio"] = int(stats.get("cleared_audio", 0)) + 1

            if self.ten_env:
                self.ten_env.log_info(
                    f"Plivo playback event received: event={event} stream_id={stream_id} name={name} call_uuid={call_uuid}"
                )
        except Exception as e:
            if self.ten_env:
                self.ten_env.log_error(f"Failed to record Plivo playback event: {e}")

    async def _cleanup_call_after_delay(
        self, call_uuid: str, delay_seconds: int
    ):
        """Clean up call session after a delay"""
        await asyncio.sleep(delay_seconds)

        # Use the new cleanup method
        await self._end_call_and_cleanup(call_uuid)

    async def on_websocket_connected(self, call_uuid: str):
        """Start and initialize the isolated TEN graph for this call."""
        session = self.server_instance.active_call_sessions[call_uuid]
        graph_id = await self._start_call_graph(call_uuid)
        payload = {
            "call_uuid": call_uuid,
            "stream_id": session.stream_id,
            "caller": session.caller or session.phone_number or "",
            "persona_phone": session.persona_phone or "",
            "persona_name": session.persona_name or "",
            "opening_message": session.opening_message or "",
            "campaign_context": session.campaign_context or "",
        }
        data = Data.create("call_start")
        data.set_property_from_json(None, json.dumps(payload))
        data.set_dests([Loc("", graph_id, "main_control")])
        error = await self.ten_env.send_data(data)
        if error:
            await self._stop_call_graph(graph_id)
            raise RuntimeError(f"failed to initialize call graph: {error}")
        self.ten_env.log_info(
            f"Started isolated graph {graph_id} for call {call_uuid}"
        )

    async def _initialize_call_worker(self, payload: dict):
        self.call_uuid = str(payload.get("call_uuid", ""))
        self.session_id = str(payload.get("stream_id", ""))
        caller = str(payload.get("caller", ""))
        persona_phone = str(payload.get("persona_phone", ""))
        persona_name = str(payload.get("persona_name", ""))
        opening_message = str(payload.get("opening_message", ""))
        campaign_context = str(payload.get("campaign_context", ""))
        context_phone = persona_phone or caller
        self.memory.begin_call(self.call_uuid, context_phone)

        memory_block = await self.memory.recall()
        if memory_block:
            self.agent.llm_exec.contexts.append(
                LLMMessageContent(
                    role="system",
                    content=(
                        "Known facts about this caller from previous interactions "
                        f"(mem0):\n{memory_block}\nUse them naturally; do not recite them."
                    ),
                )
            )
        if persona_name:
            self.agent.llm_exec.contexts.append(
                LLMMessageContent(
                    role="system",
                    content=f"You are speaking with {persona_name}. Address them by name naturally.",
                )
            )
        if campaign_context:
            self.agent.llm_exec.contexts.append(
                LLMMessageContent(
                    role="system",
                    content=(
                        f"Outbound campaign facts:\n{campaign_context}\n"
                        "Use these facts only for this call. If the recipient is not the "
                        "intended customer, do not disclose private details."
                    ),
                )
            )
        if context_phone:
            self.agent.llm_exec.contexts.append(
                LLMMessageContent(
                    role="system",
                    content=(
                        f"The caller's phone number is {context_phone}. Use it for order "
                        "lookups without asking for it again."
                    ),
                )
            )

        greeting_text = opening_message or self.config.greeting
        await self._send_to_tts(greeting_text, True)
        self.memory.record_turn("assistant", greeting_text, self.turn_id)
        self.ten_env.log_info(
            f"Call worker initialized for {self.call_uuid}; greeting queued"
        )

    async def on_call_ended(self, call_uuid: str):
        """Stop only the TEN graph owned by the completed call."""
        try:
            session = self.server_instance.active_call_sessions.get(call_uuid)
            if session and session.graph_id:
                await self._stop_call_graph(session.graph_id)
                self.ten_env.log_info(
                    f"Stopped isolated graph {session.graph_id} for {call_uuid}"
                )
        except Exception as e:
            self.ten_env.log_error(f"on_call_ended failed: {e}")
