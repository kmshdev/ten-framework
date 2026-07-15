"""SuperYou support tools for the voice agent.

Three LLM tools backed by the Cloudflare Worker /demo API and the local
Plivo call server:

- get_order_status:    real-time WISMO lookups against D1 (Shopify-shaped data)
- search_superyou_kb:  brand knowledge base search (Vectorize + Workers AI)
- transfer_to_human:   escalates the live call to a human agent via Plivo
"""

import json
from urllib.parse import urlencode

import aiohttp
from dataclasses import dataclass

from ten_runtime import Cmd
from ten_runtime.async_ten_env import AsyncTenEnv
from ten_ai_base.config import BaseConfig
from ten_ai_base.types import (
    LLMToolMetadata,
    LLMToolMetadataParameter,
    LLMToolResult,
    LLMToolResultLLMResult,
)
from ten_ai_base.llm_tool import AsyncLLMToolBaseExtension

ORDER_TOOL_NAME = "get_order_status"
ORDER_TOOL_DESCRIPTION = (
    "Look up a SuperYou customer's order status, courier tracking and expected "
    "delivery date. Use for questions like 'where is my order'. Provide the "
    "order number if the caller gave one, otherwise the caller's phone number."
)

KB_TOOL_NAME = "search_superyou_kb"
KB_TOOL_DESCRIPTION = (
    "Search SuperYou's official knowledge base for brand and company history, "
    "founders, product details, prices, flavours, nutrition, allergens, protein "
    "content, and shipping/return/payment policies. Always use this before "
    "answering any question about SuperYou, its products, or its policies."
)

TRANSFER_TOOL_NAME = "transfer_to_human"
TRANSFER_TOOL_DESCRIPTION = (
    "Transfer the current call to a human support agent. Use when the caller "
    "asks for a human, is upset, or the issue cannot be resolved (e.g. claims "
    "needing manual approval). Tell the caller you are transferring them "
    "BEFORE calling this tool."
)

MEMORY_TOOL_NAME = "recall_customer_memory"
MEMORY_TOOL_DESCRIPTION = (
    "Search this caller's history from previous calls: past order issues, "
    "complaints, claims, preferences, promised follow-ups. Use when the "
    "caller references something from before ('my last order', 'the complaint "
    "I raised', 'as I told you last time') or when their history would "
    "change how you respond."
)


@dataclass
class SuperYouToolsConfig(BaseConfig):
    # Base URL of the Cloudflare Worker serving the /demo API
    demo_api_base: str = ""
    # Local Plivo call server (same tenapp process)
    plivo_server_port: int = 9000


class SuperYouToolsExtension(AsyncLLMToolBaseExtension):
    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.session: aiohttp.ClientSession | None = None
        self.ten_env: AsyncTenEnv | None = None
        self.config: SuperYouToolsConfig | None = None

    async def on_init(self, ten_env: AsyncTenEnv) -> None:
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=10)
        )

    async def on_start(self, ten_env: AsyncTenEnv) -> None:
        self.config = await SuperYouToolsConfig.create_async(ten_env=ten_env)
        self.ten_env = ten_env
        if not self.config.demo_api_base:
            ten_env.log_warn(
                "SuperYouToolsExtension: demo_api_base not set - "
                "order/KB tools will report unavailability."
            )
        await super().on_start(ten_env)

    async def on_stop(self, ten_env: AsyncTenEnv) -> None:
        if self.session:
            await self.session.close()
            self.session = None

    async def on_cmd(self, ten_env: AsyncTenEnv, cmd: Cmd) -> None:
        await super().on_cmd(ten_env, cmd)

    def get_tool_metadata(self, ten_env: AsyncTenEnv) -> list[LLMToolMetadata]:
        return [
            LLMToolMetadata(
                name=ORDER_TOOL_NAME,
                description=ORDER_TOOL_DESCRIPTION,
                parameters=[
                    LLMToolMetadataParameter(
                        name="order_number",
                        type="string",
                        description=(
                            "The SuperYou order number, e.g. SY10042 or 10042. "
                            "Preferred when the caller knows it."
                        ),
                        required=False,
                    ),
                    LLMToolMetadataParameter(
                        name="phone",
                        type="string",
                        description=(
                            "The caller's phone number with country code, "
                            "e.g. +919876543210. Use when no order number given."
                        ),
                        required=False,
                    ),
                ],
            ),
            LLMToolMetadata(
                name=KB_TOOL_NAME,
                description=KB_TOOL_DESCRIPTION,
                parameters=[
                    LLMToolMetadataParameter(
                        name="query",
                        type="string",
                        description=(
                            "The customer's question rephrased as a clear "
                            "English search query."
                        ),
                        required=True,
                    ),
                ],
            ),
            LLMToolMetadata(
                name=TRANSFER_TOOL_NAME,
                description=TRANSFER_TOOL_DESCRIPTION,
                parameters=[
                    LLMToolMetadataParameter(
                        name="reason",
                        type="string",
                        description="Short reason for the escalation.",
                        required=True,
                    ),
                ],
            ),
            LLMToolMetadata(
                name=MEMORY_TOOL_NAME,
                description=MEMORY_TOOL_DESCRIPTION,
                parameters=[
                    LLMToolMetadataParameter(
                        name="query",
                        type="string",
                        description=(
                            "What to look up in the caller's history, e.g. "
                            "'previous complaint about damaged wafers'."
                        ),
                        required=True,
                    ),
                ],
            ),
        ]

    async def run_tool(
        self, ten_env: AsyncTenEnv, name: str, args: dict
    ) -> LLMToolResult | None:
        ten_env.log_info(f"[superyou_tools] run_tool {name} args={args}")
        try:
            if name == ORDER_TOOL_NAME:
                result = await self._get_order_status(args)
            elif name == KB_TOOL_NAME:
                result = await self._search_kb(args)
            elif name == TRANSFER_TOOL_NAME:
                result = await self._transfer_to_human(args)
            elif name == MEMORY_TOOL_NAME:
                result = await self._recall_memory(args)
            else:
                return None
        except Exception as e:  # tool errors must not kill the call
            ten_env.log_error(f"[superyou_tools] {name} failed: {e}")
            result = {
                "error": (
                    "The tool is temporarily unavailable. Apologize and offer "
                    "to transfer to a human agent."
                )
            }
        return LLMToolResultLLMResult(
            type="llmresult",
            content=json.dumps(result, ensure_ascii=False),
        )

    async def _get_order_status(self, args: dict) -> dict:
        if not self.config.demo_api_base:
            return {"error": "Order system not configured."}
        params = {}
        if args.get("order_number"):
            params["order_number"] = str(args["order_number"])
        if args.get("phone"):
            params["phone"] = str(args["phone"])
        if not params:
            # The LLM didn't carry the caller's phone forward in this tool
            # call. Fall back to the server's single active-call session
            # (same localhost:9000 callback pattern as _transfer_to_human /
            # _recall_memory below) instead of erroring immediately - the
            # backend already knows who's calling.
            fallback_phone = await self._current_call_phone()
            if fallback_phone:
                params["phone"] = fallback_phone
            else:
                return {
                    "error": "Need an order number or the caller's phone number."
                }
        url = f"{self.config.demo_api_base}/demo/order-status?{urlencode(params)}"
        async with self.session.get(url) as resp:
            return await resp.json()

    async def _current_call_phone(self) -> str:
        """Best-effort identity of the single in-flight call (see
        server.py::_find_active_call_uuid / GET /api/call/current)."""
        url = f"http://localhost:{self.config.plivo_server_port}/api/call/current"
        try:
            async with self.session.get(url) as resp:
                data = await resp.json()
        except Exception:
            return ""
        if not data.get("active"):
            return ""
        return str(data.get("phone") or "")

    async def _search_kb(self, args: dict) -> dict:
        if not self.config.demo_api_base:
            return {"error": "Knowledge base not configured."}
        query = str(args.get("query", "")).strip()
        if not query:
            return {"error": "query is required"}
        url = (
            f"{self.config.demo_api_base}/demo/kb/query?"
            f"{urlencode({'q': query, 'top_k': 3})}"
        )
        async with self.session.get(url) as resp:
            return await resp.json()

    async def _transfer_to_human(self, args: dict) -> dict:
        url = (
            f"http://localhost:{self.config.plivo_server_port}/api/transfer"
        )
        payload = {"reason": str(args.get("reason", ""))}
        async with self.session.post(url, json=payload) as resp:
            return await resp.json()

    async def _recall_memory(self, args: dict) -> dict:
        query = str(args.get("query", "")).strip()
        if not query:
            return {"error": "query is required"}
        url = (
            f"http://localhost:{self.config.plivo_server_port}"
            "/api/memory/search"
        )
        async with self.session.post(url, json={"query": query}) as resp:
            data = await resp.json()
        if not data.get("results"):
            return {
                "results": [],
                "note": "No history found for this caller on that topic.",
            }
        return data
