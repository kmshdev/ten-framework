#!/usr/bin/env python3
"""
Main Python Server for Plivo Integration
Handles call creation, media streaming, and webhook status
"""

import asyncio
import json
import os
import signal
import sys
from datetime import datetime
from typing import Any, Dict, Optional

import plivo
import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from plivo import plivoxml

from .config import MainControlConfig


class PlivoCallServer:
    """Server for handling Plivo calls, media streaming, and webhooks"""

    def __init__(self, config: MainControlConfig, ten_env=None):
        self.config = config
        # Normalize public server URL to a bare host (protocols are prepended
        # when building webhook/media URLs).
        if self.config.plivo_public_server_url:
            self.config.plivo_public_server_url = (
                self.config.plivo_public_server_url.replace("https://", "")
                .replace("http://", "")
                .rstrip("/")
            )
        self.ten_env = ten_env
        self.app = FastAPI(title="Plivo Call Server")

        # Add CORS middleware
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],  # Allow all origins
            allow_credentials=True,
            allow_methods=["*"],  # Allow all methods
            allow_headers=["*"],  # Allow all headers
        )

        # Plivo client
        self.plivo_client = plivo.RestClient(
            config.plivo_auth_id, config.plivo_auth_token
        )

        # Active call sessions (keyed by call_uuid)
        self.active_call_sessions: Dict[str, Dict[str, Any]] = {}

        # Setup routes
        self._setup_routes()

    # Statuses that mean "this call is still using the line" for the
    # purposes of the single-active-call guard below.
    _NON_TERMINAL_STATUSES = ("initiated", "ringing", "in-progress", "answered")
    # A lost hangup webhook must never permanently deadlock new calls or
    # transfers - ignore sessions that have looked non-terminal for too long.
    _ACTIVE_SESSION_TTL_S = 300

    def _find_active_call_uuid(
        self, require_websocket: bool = False
    ) -> Optional[str]:
        """Best-effort pick of the single in-flight call.

        The demo runs one call at a time, so this is the shared source of
        truth for: rejecting a second concurrent /api/call, choosing which
        call /api/transfer escalates, and answering /api/call/current for
        the order-status tool's context_phone fallback.
        """
        now = datetime.now()
        for cid, session in self.active_call_sessions.items():
            if session.get("status") not in self._NON_TERMINAL_STATUSES:
                continue
            if require_websocket and session.get("websocket") is None:
                continue
            created_at = session.get("created_at")
            if created_at:
                try:
                    age = (
                        now - datetime.fromisoformat(created_at)
                    ).total_seconds()
                    if age > self._ACTIVE_SESSION_TTL_S:
                        continue
                except ValueError:
                    pass
            return cid
        return None

    def _log_info(self, message: str):
        """Log info message using ten_env if available"""
        if self.ten_env:
            self.ten_env.log_info(message)
        else:
            print(f"INFO: {message}")

    def _log_error(self, message: str):
        """Log error message using ten_env if available"""
        if self.ten_env:
            self.ten_env.log_error(message)
        else:
            print(f"ERROR: {message}")

    def _log_debug(self, message: str):
        """Log debug message using ten_env if available"""
        if self.ten_env:
            self.ten_env.log_debug(message)
        else:
            print(f"DEBUG: {message}")

    def _setup_routes(self):
        """Setup FastAPI routes"""

        @self.app.post("/api/call")
        async def create_call(request: Request):
            """Create a new outbound call"""
            try:
                body = await request.json()
                phone_number = body.get("phone_number")
                message = body.get("message", "Hello from Plivo!")
                # Demo console: dial the operator's real phone number, but
                # have the agent treat the session as if this seeded
                # customer (from cloudflare/seed.sql) were calling in.
                persona_phone = body.get("persona_phone")
                persona_name = body.get("persona_name")

                if not phone_number:
                    raise HTTPException(
                        status_code=400, detail="phone_number is required"
                    )

                existing_uuid = self._find_active_call_uuid()
                if existing_uuid:
                    existing = self.active_call_sessions.get(existing_uuid, {})
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "message": (
                                "A call is already in progress. End it "
                                "before starting another."
                            ),
                            "call_uuid": existing_uuid,
                            "phone_number": existing.get("phone_number"),
                            "persona_name": existing.get("persona_name"),
                        },
                    )

                self._log_info(
                    f"Creating call to {phone_number} with message: {message}"
                )

                # Configure webhook URL for answering the call
                if self.config.plivo_public_server_url:
                    http_protocol = "https" if self.config.plivo_use_https else "http"
                    answer_url = f"{http_protocol}://{self.config.plivo_public_server_url}/webhook/answer"
                    status_url = f"{http_protocol}://{self.config.plivo_public_server_url}/webhook/status"
                else:
                    raise HTTPException(
                        status_code=400,
                        detail="plivo_public_server_url is required for outbound calls",
                    )

                self._log_info(f"Using answer URL: {answer_url}")
                self._log_info(f"Using status URL: {status_url}")

                # Create the call using Plivo API (sync SDK — off the loop).
                # Plivo's India trunk rejects E.164 '+' prefixes on `from`.
                response = await asyncio.to_thread(
                    self.plivo_client.calls.create,
                    from_=self.config.plivo_from_number.lstrip("+"),
                    to_=phone_number.lstrip("+"),
                    answer_url=answer_url,
                    answer_method="POST",
                    hangup_url=status_url,
                    hangup_method="POST",
                )

                call_uuid = response.request_uuid

                # Store call session
                self.active_call_sessions[call_uuid] = {
                    "phone_number": phone_number,
                    "message": message,
                    "persona_phone": persona_phone,
                    "persona_name": persona_name,
                    "call_uuid": call_uuid,
                    "status": "initiated",
                    "created_at": datetime.now().isoformat(),
                }

                self._log_info(f"Call created successfully: {call_uuid}")

                return JSONResponse(
                    content={
                        "success": True,
                        "call_uuid": call_uuid,
                        "status": "initiated",
                        "phone_number": phone_number,
                        "message": message,
                        "persona_phone": persona_phone,
                        "persona_name": persona_name,
                    }
                )

            except Exception as e:
                self._log_error(f"Failed to create call: {str(e)}")
                raise HTTPException(status_code=500, detail=str(e))

        @self.app.delete("/api/call/{call_uuid}")
        async def end_call(call_uuid: str):
            """End a call by UUID"""
            try:
                if call_uuid not in self.active_call_sessions:
                    raise HTTPException(status_code=404, detail="Call not found")

                self._log_info(f"Ending call: {call_uuid}")

                # Hangup the call using Plivo API (sync SDK — off the loop)
                await asyncio.to_thread(self.plivo_client.calls.delete, call_uuid)

                # Update session status
                if call_uuid in self.active_call_sessions:
                    self.active_call_sessions[call_uuid]["status"] = "completed"
                    self.active_call_sessions[call_uuid]["ended_at"] = (
                        datetime.now().isoformat()
                    )

                self._log_info(f"Call {call_uuid} ended successfully")

                return JSONResponse(
                    content={
                        "success": True,
                        "call_uuid": call_uuid,
                        "status": "completed",
                    }
                )

            except Exception as e:
                self._log_error(f"Failed to end call {call_uuid}: {str(e)}")
                raise HTTPException(status_code=500, detail=str(e))

        @self.app.get("/api/call/{call_uuid}")
        async def get_call_status(call_uuid: str):
            """Get call status by UUID"""
            try:
                if call_uuid not in self.active_call_sessions:
                    raise HTTPException(status_code=404, detail="Call not found")

                session = self.active_call_sessions[call_uuid]

                return JSONResponse(
                    content={
                        "success": True,
                        "call_uuid": call_uuid,
                        "status": session["status"],
                        "phone_number": session["phone_number"],
                        "message": session["message"],
                        "created_at": session["created_at"],
                        "ended_at": session.get("ended_at"),
                    }
                )

            except Exception as e:
                self._log_error(f"Failed to get call status {call_uuid}: {str(e)}")
                raise HTTPException(status_code=500, detail=str(e))

        @self.app.get("/api/calls")
        async def list_calls():
            """List all active calls"""
            return JSONResponse(
                content={
                    "success": True,
                    "active_calls": len(self.active_call_sessions),
                    "calls": list(self.active_call_sessions.keys()),
                }
            )

        @self.app.post("/api/transfer")
        async def transfer_call(request: Request):
            """Escalate the active call to a human agent (Plivo call transfer)."""
            try:
                try:
                    body = await request.json()
                except Exception:
                    body = {}
                reason = (body or {}).get("reason", "")

                # The demo runs one call at a time: pick the session with a
                # live media websocket (stale sessions are cleaned on hangup,
                # but never trust a session that can't be talking).
                call_uuid = self._find_active_call_uuid(require_websocket=True)

                self._log_info(
                    f"Transfer requested (reason: {reason}) for call {call_uuid}"
                )

                if not call_uuid:
                    return JSONResponse(
                        content={
                            "transferred": False,
                            "message": "No active call found to transfer.",
                        }
                    )

                if not self.config.human_agent_number:
                    # Demo mode: no human agent number configured. Log the
                    # escalation so the flow is still visible on the dashboard.
                    # NOTE: "transferred" stays true-ish for the LLM: a false
                    # flag here made the model apologize for a failed transfer
                    # instead of promising the callback.
                    return JSONResponse(
                        content={
                            "escalation_registered": True,
                            "demo_mode": True,
                            "message": (
                                "Escalation registered successfully. Tell the "
                                "caller a human support agent will call them "
                                "back within 15 minutes. Do NOT apologize or "
                                "say the transfer failed."
                            ),
                            "reason": reason,
                        }
                    )

                http_protocol = "https" if self.config.plivo_use_https else "http"
                xml_url = (
                    f"{http_protocol}://{self.config.plivo_public_server_url}"
                    "/webhook/transfer-xml"
                )
                await asyncio.to_thread(
                    self.plivo_client.calls.transfer,
                    call_uuid,
                    legs="aleg",
                    aleg_url=xml_url,
                    aleg_method="POST",
                )
                self.active_call_sessions[call_uuid]["status"] = "transferred"
                return JSONResponse(
                    content={
                        "transferred": True,
                        "message": ("Call is being connected to a human agent now."),
                        "reason": reason,
                    }
                )
            except Exception as e:
                self._log_error(f"Failed to transfer call: {str(e)}")
                return JSONResponse(
                    content={
                        "transferred": False,
                        "message": (
                            "Transfer failed. Apologize and promise a "
                            "call-back from a human agent."
                        ),
                        "error": str(e),
                    }
                )

        @self.app.get("/api/call/current")
        async def get_current_call():
            """Identity of the single in-flight call, if any.

            Fallback source of context_phone for the order-status tool when
            the LLM's tool call omits both `phone` and `order_number` (see
            superyou_tools_python/extension.py::_get_order_status).
            """
            call_uuid = self._find_active_call_uuid()
            if not call_uuid:
                return JSONResponse(content={"active": False})
            session = self.active_call_sessions.get(call_uuid, {})
            phone = session.get("persona_phone") or session.get("phone_number") or ""
            return JSONResponse(
                content={
                    "active": True,
                    "call_uuid": call_uuid,
                    "phone": phone,
                    "persona_phone": session.get("persona_phone"),
                    "persona_name": session.get("persona_name"),
                }
            )

        @self.app.post("/api/memory/search")
        async def memory_search(request: Request):
            """Targeted mem0 recall for the recall_customer_memory tool."""
            try:
                try:
                    body = await request.json()
                except Exception:
                    body = {}
                query = str((body or {}).get("query", "")).strip()
                ext = getattr(self, "extension_instance", None)
                if not query or not ext or not getattr(ext, "memory", None):
                    return JSONResponse(content={"results": []})
                results = await ext.memory.search(query)
                return JSONResponse(content={"results": results})
            except Exception as e:
                self._log_error(f"memory search failed: {str(e)}")
                return JSONResponse(content={"results": [], "error": str(e)})

        @self.app.post("/webhook/transfer-xml")
        @self.app.get("/webhook/transfer-xml")
        async def transfer_xml():
            """Plivo XML that bridges the caller to the human agent."""
            response = plivoxml.ResponseElement()
            response.add(
                plivoxml.SpeakElement(
                    "Please hold while we connect you to a support agent."
                )
            )
            dial = plivoxml.DialElement(caller_id=self.config.plivo_from_number or None)
            dial.add(plivoxml.NumberElement(self.config.human_agent_number))
            response.add(dial)
            return Response(content=response.to_string(), media_type="application/xml")

        @self.app.post("/webhook/answer")
        @self.app.get("/webhook/answer")
        async def handle_answer_webhook(request: Request):
            """Handle Plivo answer webhook - returns XML to start media stream"""
            try:
                # Get call UUID from request
                if request.method == "GET":
                    call_uuid = request.query_params.get("CallUUID", "")
                    caller = request.query_params.get("From", "")
                    to_number = request.query_params.get("To", "")
                    direction = request.query_params.get("Direction", "")
                    request_uuid = request.query_params.get("RequestUUID", "")
                else:
                    form_data = await request.form()
                    call_uuid = form_data.get("CallUUID", "")
                    caller = form_data.get("From", "")
                    to_number = form_data.get("To", "")
                    direction = form_data.get("Direction", "")
                    request_uuid = form_data.get("RequestUUID", "")

                self._log_info(
                    f"Answer webhook received for call {call_uuid} "
                    f"from {caller} to {to_number} ({direction})"
                )

                # Record the customer's number so the agent can personalize
                # the session (order lookups by phone, mem0 memory,
                # transcripts). On OUTBOUND legs Plivo's `From` is our own
                # Plivo number — the customer is `To`.
                is_outbound = direction.lower().startswith("outbound")
                customer = to_number if is_outbound else caller
                # Normalize to E.164-ish so mem0/D1 identity is stable
                # regardless of whether Plivo sends '+91...' or '91...'.
                if customer and not customer.startswith("+"):
                    customer = "+" + customer
                if call_uuid:
                    session = self.active_call_sessions.setdefault(
                        call_uuid,
                        {
                            "call_uuid": call_uuid,
                            "status": "in-progress",
                            "created_at": datetime.now().isoformat(),
                        },
                    )
                    # Re-key the pending outbound session (stored under
                    # Plivo's RequestUUID by create_call) onto the real
                    # CallUUID so its metadata isn't stranded forever.
                    if (
                        request_uuid
                        and request_uuid in self.active_call_sessions
                        and request_uuid != call_uuid
                    ):
                        pending = self.active_call_sessions.pop(request_uuid)
                        for key in (
                            "phone_number",
                            "message",
                            "persona_phone",
                            "persona_name",
                        ):
                            if pending.get(key):
                                session.setdefault(key, pending[key])
                    if customer:
                        session["caller"] = customer
                    session["direction"] = direction

                # Build media stream WebSocket URL
                ws_protocol = "wss" if self.config.plivo_use_wss else "ws"
                media_ws_url = (
                    f"{ws_protocol}://{self.config.plivo_public_server_url}/media"
                )

                self._log_info(f"Media stream URL: {media_ws_url}")

                # Create Plivo XML response with bidirectional stream
                response = plivoxml.ResponseElement()
                response.add(
                    plivoxml.StreamElement(
                        media_ws_url,
                        bidirectional=True,
                        keepCallAlive=True,
                        contentType="audio/x-mulaw;rate=8000",
                    )
                )

                xml_response = response.to_string()
                self._log_info(f"Plivo XML response: {xml_response}")

                return Response(content=xml_response, media_type="application/xml")

            except Exception as e:
                self._log_error(f"Failed to handle answer webhook: {str(e)}")
                raise HTTPException(status_code=500, detail=str(e))

        @self.app.post("/webhook/status")
        @self.app.get("/webhook/status")
        async def handle_status_webhook(request: Request):
            """Handle Plivo status webhook"""
            try:
                # Handle both GET and POST requests
                if request.method == "GET":
                    call_uuid = request.query_params.get("CallUUID")
                    call_status = request.query_params.get("CallStatus")
                    duration = request.query_params.get("Duration")
                    direction = request.query_params.get("Direction")
                else:
                    form_data = await request.form()
                    call_uuid = form_data.get("CallUUID")
                    call_status = form_data.get("CallStatus")
                    duration = form_data.get("Duration")
                    direction = form_data.get("Direction")

                self._log_info(
                    f"Status webhook received for call {call_uuid}: {call_status}"
                )

                # Update call session status
                if call_uuid in self.active_call_sessions:
                    self.active_call_sessions[call_uuid]["status"] = call_status

                    terminal_statuses = (
                        "completed",
                        "hangup",
                        "failed",
                        "busy",
                        "no-answer",
                        "timeout",
                        "cancelled",
                    )
                    if call_status in terminal_statuses:
                        self.active_call_sessions[call_uuid]["ended_at"] = (
                            datetime.now().isoformat()
                        )
                        # Let the extension flush per-call state (mem0 save)
                        if (
                            hasattr(self, "extension_instance")
                            and self.extension_instance
                        ):
                            try:
                                await self.extension_instance.on_call_ended(call_uuid)
                            except Exception as e:
                                self._log_error(f"on_call_ended hook failed: {e}")
                        # Drop the session so stale entries never accumulate
                        # (audio broadcast + transfer selection rely on this).
                        self.active_call_sessions.pop(call_uuid, None)
                        self._log_info(f"Session {call_uuid} cleaned up")

                return JSONResponse(content={"success": True})

            except Exception as e:
                self._log_error(f"Failed to handle status webhook: {str(e)}")
                raise HTTPException(status_code=500, detail=str(e))

        @self.app.get("/health")
        async def health_check():
            """Health check endpoint"""
            return JSONResponse(
                content={
                    "status": "healthy",
                    "active_calls": len(self.active_call_sessions),
                    "server_time": datetime.now().isoformat(),
                }
            )

        @self.app.get("/api/config")
        async def get_config():
            """Get server configuration"""
            # Build URLs with configurable protocols
            media_ws_url = None
            webhook_url = None

            if self.config.plivo_public_server_url:
                ws_protocol = "wss" if self.config.plivo_use_wss else "ws"
                http_protocol = "https" if self.config.plivo_use_https else "http"
                media_ws_url = (
                    f"{ws_protocol}://{self.config.plivo_public_server_url}/media"
                )
                webhook_url = f"{http_protocol}://{self.config.plivo_public_server_url}/webhook/status"

            return JSONResponse(
                content={
                    "plivo_from_number": self.config.plivo_from_number,
                    "server_port": self.config.plivo_server_port,
                    "public_server_url": (
                        self.config.plivo_public_server_url
                        if self.config.plivo_public_server_url
                        else None
                    ),
                    "use_https": self.config.plivo_use_https,
                    "use_wss": self.config.plivo_use_wss,
                    "media_stream_enabled": bool(self.config.plivo_public_server_url),
                    "media_ws_url": media_ws_url,
                    "webhook_enabled": bool(self.config.plivo_public_server_url),
                    "webhook_url": webhook_url,
                }
            )

        # WebSocket endpoint for media streaming
        @self.app.websocket("/media")
        async def websocket_endpoint(websocket: WebSocket):
            """WebSocket endpoint for Plivo media streaming"""
            self._log_info(f"WebSocket connection attempt from: {websocket.client}")

            try:
                # Log connection attempt
                self._log_info(f"WebSocket connection attempt from: {websocket.client}")

                # Check for required query parameters (Plivo sends these)
                query_params = websocket.query_params
                self._log_info(f"WebSocket query parameters: {dict(query_params)}")

                # Accept the connection immediately
                await websocket.accept()
                self._log_info(f"WebSocket connection established: {websocket.client}")

                # Send initial message to confirm connection
                await websocket.send_text(
                    '{"type": "connected", "message": "WebSocket connection established"}'
                )

                # Initialize call_uuid to None to prevent NameError
                call_uuid = None

                while True:
                    # Receive message from Plivo
                    data = await websocket.receive_text()
                    self._log_debug(f"Received WebSocket message: {data[:100]}...")

                    # Parse Plivo media stream message
                    try:
                        message = json.loads(data)

                        if message.get("event") == "media":
                            # Extract audio payload
                            # Plivo format: {"event": "media", "media": {"payload": "base64...", "track": "inbound"}}
                            audio_payload = message.get("media", {}).get("payload", "")
                            stream_id = message.get("streamId", "")

                            if audio_payload and call_uuid:
                                # Forward audio to TEN framework
                                if (
                                    hasattr(self, "extension_instance")
                                    and self.extension_instance
                                ):
                                    await self.extension_instance._forward_audio_to_ten(
                                        audio_payload, stream_id
                                    )
                                else:
                                    self._log_debug(
                                        "Extension instance not available for audio forwarding"
                                    )

                        elif message.get("event") == "start":
                            self._log_info(f"Media stream started: {message}")
                            # Plivo format: {"event": "start", "start": {"streamId": "...", "callId": "..."}}
                            stream_id = message.get("streamId", "")
                            start = message.get("start", {})
                            call_uuid = start.get("callId", "")

                            # Create session if it doesn't exist (for inbound calls)
                            if call_uuid not in self.active_call_sessions:
                                self.active_call_sessions[call_uuid] = {
                                    "call_uuid": call_uuid,
                                    "status": "in-progress",
                                    "created_at": datetime.now().isoformat(),
                                }

                            self.active_call_sessions[call_uuid]["stream_id"] = (
                                stream_id
                            )
                            self.active_call_sessions[call_uuid]["websocket"] = (
                                websocket
                            )

                            # Notify extension that websocket is connected
                            if (
                                hasattr(self, "extension_instance")
                                and self.extension_instance
                            ):
                                await self.extension_instance.on_websocket_connected(
                                    call_uuid
                                )
                        elif message.get("event") == "stop":
                            self._log_info(f"Media stream stopped: {message}")

                    except json.JSONDecodeError:
                        self._log_debug(f"Received non-JSON message: {data[:100]}...")
                    except Exception as e:
                        self._log_error(f"Error processing media message: {e}")

            except Exception as e:
                self._log_error(f"WebSocket error: {e}")
                # Try to close the connection gracefully
                try:
                    await websocket.close()
                except:
                    pass
            finally:
                # Detach this websocket from any session so the audio
                # broadcaster never writes to a dead socket.
                for session in self.active_call_sessions.values():
                    if session.get("websocket") is websocket:
                        session.pop("websocket", None)
                self._log_info("WebSocket connection closed")

    async def start_server(self, host: str = "0.0.0.0", port: int = 9000):
        """Start the server with both HTTP and WebSocket support"""
        self._log_info(f"Starting Plivo Call Server on {host}:{port}")
        self._log_info(
            "Server supports both HTTP API and WebSocket media streaming on the same port"
        )

        # Check if SSL is required
        use_ssl = self.config.plivo_use_https or self.config.plivo_use_wss

        if use_ssl:
            # For development with ngrok, we'll use HTTP but let ngrok handle SSL
            self._log_info(
                "SSL/WSS requested - using HTTP server (ngrok will handle SSL termination)"
            )
            ssl_keyfile = None
            ssl_certfile = None
        else:
            ssl_keyfile = None
            ssl_certfile = None

        # Start server with HTTP and WebSocket support
        config = uvicorn.Config(
            app=self.app,
            host=host,
            port=port,
            log_level="info",
            ssl_keyfile=ssl_keyfile,
            ssl_certfile=ssl_certfile,
        )

        server = uvicorn.Server(config)
        await server.serve()

    def cleanup(self):
        """Cleanup resources"""
        self._log_info("Cleaning up Plivo Call Server")
        # End all active calls
        for call_uuid in list(self.active_call_sessions.keys()):
            try:
                self.plivo_client.calls.delete(call_uuid)
                self._log_info(f"Ended call {call_uuid}")
            except Exception as e:
                self._log_error(f"Failed to end call {call_uuid}: {str(e)}")


async def main():
    """Main function to run the server"""
    # Load configuration from environment variables
    config = MainControlConfig(
        plivo_auth_id=os.getenv("PLIVO_AUTH_ID", ""),
        plivo_auth_token=os.getenv("PLIVO_AUTH_TOKEN", ""),
        plivo_from_number=os.getenv("PLIVO_FROM_NUMBER", ""),
        plivo_server_port=int(os.getenv("PLIVO_SERVER_PORT", "9000")),
        plivo_public_server_url=os.getenv("PLIVO_PUBLIC_SERVER_URL", ""),
        plivo_use_https=os.getenv("PLIVO_USE_HTTPS", "true").lower() == "true",
        plivo_use_wss=os.getenv("PLIVO_USE_WSS", "true").lower() == "true",
    )

    # Validate required configuration
    if (
        not config.plivo_auth_id
        or not config.plivo_auth_token
        or not config.plivo_from_number
    ):
        print("Error: Missing required Plivo configuration")
        print("Please set PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, and PLIVO_FROM_NUMBER")
        sys.exit(1)

    # Create and start server
    server = PlivoCallServer(config)

    # Setup signal handlers for graceful shutdown
    def signal_handler(signum, frame):
        print(f"Received signal {signum}, shutting down...")
        server.cleanup()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        await server.start_server()
    except KeyboardInterrupt:
        print("Server interrupted, shutting down...")
        server.cleanup()
    except Exception as e:
        print(f"Server error: {e}")
        server.cleanup()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
