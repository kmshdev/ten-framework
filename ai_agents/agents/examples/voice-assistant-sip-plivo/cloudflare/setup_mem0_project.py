#!/usr/bin/env python3
"""One-time mem0 project configuration for the SuperYou voice agent.

Sets project-level custom_instructions (the documented mechanism for
domain-specific memory extraction - see
https://docs.mem0.ai/cookbooks/essentials/controlling-memory-ingestion).
Per-call custom_instructions/includes/excludes were tested against the live
v3 API on 2026-07-04 and are unreliable (excludes suppressed valid facts),
so the project level is the single source of truth.

Usage:
  MEM0_API_KEY=... python3 setup_mem0_project.py
"""

import json
import os
import urllib.request

MEM0_BASE = "https://api.mem0.ai"

INSTRUCTIONS = """These conversations are customer support calls for SuperYou, an Indian protein-snacks brand.

Store:
- Order numbers with their issue and resolution status (delays, missing/wrong/damaged items, refunds, claims)
- Product and flavour preferences, repeat purchases
- Dietary restrictions and allergies
- Delivery city or address changes
- Preferred language (Hindi / English / Hinglish)
- Escalations to human agents and promised follow-ups or callbacks
- Strong sentiment about the brand or a product (praise or complaint)

Ignore:
- Greetings, sign-offs and pleasantries
- Small talk (weather, general chit-chat)
- Filler words and incomplete fragments
- The agent's own boilerplate phrases
"""


def req(method: str, path: str, body: dict | None = None):
    r = urllib.request.Request(
        f"{MEM0_BASE}{path}",
        method=method,
        headers={
            "Authorization": f"Token {os.environ['MEM0_API_KEY']}",
            "Content-Type": "application/json",
        },
        data=json.dumps(body).encode() if body else None,
    )
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read())


def main():
    orgs = req("GET", "/api/v1/orgs/organizations/")
    org_id = orgs[0]["org_id"]
    projects = req("GET", f"/api/v1/orgs/organizations/{org_id}/projects/")
    proj_id = projects[0]["project_id"]
    print(f"org={org_id} project={proj_id}")

    req(
        "PATCH",
        f"/api/v1/orgs/organizations/{org_id}/projects/{proj_id}/",
        {"custom_instructions": INSTRUCTIONS},
    )
    proj = req(
        "GET", f"/api/v1/orgs/organizations/{org_id}/projects/{proj_id}/"
    )
    assert proj.get("custom_instructions"), "custom_instructions not set"
    print("custom_instructions set OK")


if __name__ == "__main__":
    main()
