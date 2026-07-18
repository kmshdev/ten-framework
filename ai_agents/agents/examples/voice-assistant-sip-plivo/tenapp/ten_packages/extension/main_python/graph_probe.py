"""Allowlisted graph lifecycle probes for coordinator diagnostics."""

GRAPH_PROBES = {
    "minimal": "graph_lifecycle_smoke",
    "worker": "graph_probe_worker",
    "asr": "graph_probe_asr",
    "llm": "graph_probe_llm",
    "tts": "graph_probe_tts",
    "full": "va_in_hybrid_stack",
}


def resolve_graph_probe(requested_probe: str | None, full: bool = False) -> tuple[str, str]:
    """Return the normalized probe and predefined graph name.

    ``full=true`` remains supported for compatibility with the staging workflow.
    Explicit probe names are restricted to ``GRAPH_PROBES``.
    """
    probe = requested_probe or ("full" if full else "minimal")
    graph_name = GRAPH_PROBES.get(probe)
    if graph_name is None:
        allowed = ", ".join(sorted(GRAPH_PROBES))
        raise ValueError(f"unsupported graph probe '{probe}'; allowed: {allowed}")
    return probe, graph_name
