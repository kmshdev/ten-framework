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
from typing import Optional

import plivo
import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from plivo import plivoxml

from .call_state import (
    TERMINAL_PROVIDER_STATUSES,
    CallCapacityError,
    CallRegistry,
)
from .graph_probe import resolve_graph_probe
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

        # The registry owns call identity transitions and serializes capacity
        # reservations. It remains mapping-compatible while the media pipeline
        # is migrated to per-call TEN graphs.
        self.active_call_sessions = CallRegistry(capacity=1)

        # Setup routes
        self._setup_routes()

    def _find_active_call_uuid(
        self, require_websocket: bool = False
    ) -> Optional[str]:
        """Return the canonical identity of the active call, if present."""
        sessions = self.active_call_sessions.active(require_websocket)
        return sessions[0].canonical_id if sessions else None

    async def _terminate_call(self, call_uuid: str, reason: str) -> bool:
        """Converge every terminal signal on one idempotent cleanup path."""
        session, transitioned = await self.active_call_sessions.terminate(
            call_uuid, reason
        )
        if session is None:
            return False
        if not transitioned:
            return True

        extension = getattr(self, "extension_instance", None)
        if extension:
            try:
                await extension.on_call_ended(call_uuid)
            except Exception as exc:
                self._log_error(f"on_call_ended hook failed: {exc}")

        await self.active_call_sessions.remove_terminal(call_uuid)
        self._log_info(f"Session {call_uuid} terminated ({reason})")
        return True

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
                opening_message = body.get("opening_message")
                campaign_context = body.get("campaign_context")

                if not phone_number:
                    raise HTTPException(
                        status_code=400, detail="phone_number is required"
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

                try:
                    reserved = await self.active_call_sessions.reserve(
                        phone_number=phone_number,
                        message=message,
                        persona_phone=persona_phone,
                        persona_name=persona_name,
                        opening_message=opening_message,
                        campaign_context=campaign_context,
                    )
                except CallCapacityError as exc:
                    existing = exc.session
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "call_capacity_reached",
                            "message": (
                                "A call is already in progress. End it "
                                "before starting another."
                            ),
                            "call_uuid": existing.canonical_id,
                            "phone_number": existing.phone_number,
                            "persona_name": existing.persona_name,
                        },
                    ) from exc

                # Create the call using Plivo API (sync SDK — off the loop).
                # Plivo's India trunk rejects E.164 '+' prefixes on `from`.
                try:
                    response = await asyncio.to_thread(
                        self.plivo_client.calls.create,
                        from_=self.config.plivo_from_number.lstrip("+"),
                        to_=phone_number.lstrip("+"),
                        answer_url=answer_url,
                        answer_method="POST",
                        hangup_url=status_url,
                        hangup_method="POST",
                    )
                except Exception:
                    await self.active_call_sessions.release_reservation(
                        reserved.operation_id
                    )
                    raise

                call_uuid = response.request_uuid
                await self.active_call_sessions.bind_request_uuid(
                    reserved.operation_id, call_uuid
                )

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
                        "opening_message": opening_message,
                        "campaign_context": campaign_context,
                    }
                )

            except HTTPException:
                raise
            except Exception as e:
                self._log_error(f"Failed to create call: {str(e)}")
                raise HTTPException(
                    status_code=502,
                    detail={"code": "plivo_call_creation_failed"},
                ) from e

        @self.app.get("/api/call/current")
        async def get_current_call_before_dynamic_route():
            """Identity of the single in-flight call, if any.

            Register before /api/call/{call_uuid}; otherwise FastAPI treats
            "current" as a call UUID and returns a misleading 500-wrapped 404.
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

        @self.app.delete("/api/call/{call_uuid}")
        async def end_call(call_uuid: str):
            """End a call by UUID"""
            try:
                if call_uuid not in self.active_call_sessions:
                    raise HTTPException(status_code=404, detail="Call not found")

                self._log_info(f"Ending call: {call_uuid}")

                # Hangup the call using Plivo API (sync SDK — off the loop)
                await asyncio.to_thread(self.plivo_client.calls.delete, call_uuid)

                await self._terminate_call(call_uuid, "api:hangup")
                self._log_info(f"Call {call_uuid} ended successfully")

                return JSONResponse(
                    content={
                        "success": True,
                        "call_uuid": call_uuid,
                        "status": "completed",
                    }
                )

            except HTTPException:
                raise
            except Exception as e:
                self._log_error(f"Failed to end call {call_uuid}: {str(e)}")
                raise HTTPException(
                    status_code=502,
                    detail={"code": "plivo_call_hangup_failed"},
                ) from e

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

            except HTTPException:
                raise
            except Exception as e:
                self._log_error(f"Failed to get call status {call_uuid}: {str(e)}")
                raise HTTPException(status_code=500, detail={"code": "internal_error"}) from e

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
                    await self.active_call_sessions.bind_call_uuid(
                        call_uuid,
                        request_uuid=request_uuid or None,
                        caller=customer,
                        direction=direction,
                    )

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

            except HTTPException:
                raise
            except Exception as e:
                self._log_error(f"Failed to handle answer webhook: {str(e)}")
                raise HTTPException(status_code=500, detail={"code": "answer_webhook_failed"}) from e

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

                if call_uuid in self.active_call_sessions:
                    if call_status in TERMINAL_PROVIDER_STATUSES:
                        await self._terminate_call(
                            call_uuid, f"status:{call_status}"
                        )
                    elif call_status:
                        self.active_call_sessions[call_uuid].status = call_status

                return JSONResponse(content={"success": True})

            except HTTPException:
                raise
            except Exception as e:
                self._log_error(f"Failed to handle status webhook: {str(e)}")
                raise HTTPException(status_code=500, detail={"code": "status_webhook_failed"}) from e

        @self.app.post("/api/admin/graph-smoke")
        async def graph_smoke(request: Request):
            if request.headers.get("x-admin-token") != self.config.plivo_auth_token:
                raise HTTPException(status_code=401, detail="unauthorized")
            extension = getattr(self, "extension_instance", None)
            if not extension:
                raise HTTPException(status_code=503, detail="coordinator unavailable")
            try:
                full = request.query_params.get("full") == "true"
                probe, graph_name = resolve_graph_probe(
                    request.query_params.get("graph"), full=full
                )
                graph_id = await extension.graph_smoke_test(graph_name=graph_name)
                return JSONResponse(
                    content={
                        "ok": True,
                        "graph_id": graph_id,
                        "stopped": True,
                        "full": probe == "full",
                        "probe": probe,
                        "graph_name": graph_name,
                    }
                )
            except Exception as exc:
                self._log_error(f"Graph smoke failed: {type(exc).__name__}: {exc}")
                return JSONResponse(
                    status_code=500,
                    content={
                        "ok": False,
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                    },
                )

        @self.app.get("/livez")
        async def liveness_check():
            return JSONResponse(
                content={
                    "status": "alive",
                    "server_time": datetime.now().isoformat(),
                }
            )

        @self.app.get("/readyz")
        async def readiness_check():
            extension = getattr(self, "extension_instance", None)
            ready = bool(extension and extension.is_ready())
            return JSONResponse(
                status_code=200 if ready else 503,
                content={
                    "status": "ready" if ready else "starting",
                    "active_calls": len(self.active_call_sessions),
                    "server_time": datetime.now().isoformat(),
                },
                headers={} if ready else {"Retry-After": "2"},
            )

        @self.app.get("/health")
        async def health_check():
            """Compatibility health endpoint with semantic readiness state."""
            extension = getattr(self, "extension_instance", None)
            ready = bool(extension and extension.is_ready())
            return JSONResponse(
                status_code=200 if ready else 503,
                content={
                    "status": "healthy" if ready else "starting",
                    "active_calls": len(self.active_call_sessions),
                    "server_time": datetime.now().isoformat(),
                },
                headers={} if ready else {"Retry-After": "2"},
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

                # Do not send arbitrary server->Plivo messages here. Plivo's
                # bidirectional stream protocol only documents playAudio,
                # checkpoint, and clearAudio as outbound events; sending a
                # non-protocol "connected" message can make playback behavior
                # undefined on stricter gateways.

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
                                        audio_payload, stream_id, call_uuid
                                    )
                                else:
                                    self._log_debug(
                                        "Extension instance not available for audio forwarding"
                                    )

                        elif message.get("event") in ("playedStream", "clearedAudio"):
                            self._log_info(f"Plivo playback event: {message}")
                            if (
                                hasattr(self, "extension_instance")
                                and self.extension_instance
                            ):
                                await self.extension_instance.on_plivo_playback_event(
                                    message
                                )

                        elif message.get("event") == "start":
                            self._log_info(f"Media stream started: {message}")
                            # Plivo format: {"event": "start", "start": {"streamId": "...", "callId": "..."}}
                            start = message.get("start", {})
                            stream_id = start.get("streamId") or message.get("streamId", "")
                            call_uuid = start.get("callId", "")

                            if not call_uuid or not stream_id:
                                raise ValueError(
                                    "Plivo start event requires callId and streamId"
                                )
                            await self.active_call_sessions.mark_streaming(
                                call_uuid, stream_id, websocket
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
                            if call_uuid:
                                await self._terminate_call(call_uuid, "media:stop")
                            break

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
                await self.active_call_sessions.detach_websocket(websocket)
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
