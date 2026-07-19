"""Bounded asyncio shutdown helpers for ElevenLabs transport tasks."""

import asyncio


def sample_rate_or_default(config, default: int = 16000) -> int:
    """Return a valid rate even when shutdown races extension initialization."""
    if config is None:
        return default
    return int(getattr(config, "sample_rate", default))


async def cancel_and_wait(task: asyncio.Task | None, timeout: float) -> bool:
    """Cancel a task without allowing resistant cleanup to block shutdown.

    Returns ``True`` when the task finishes within the deadline. The caller may
    continue teardown when ``False``; the task remains cancelled and detached.
    """
    if task is None:
        return True
    if not task.done():
        task.cancel()
    done, _ = await asyncio.wait({task}, timeout=timeout)
    if not done:
        return False
    try:
        task.result()
    except asyncio.CancelledError:
        pass
    return True


async def run_with_deadline(coroutine, timeout: float) -> bool:
    """Run teardown work without waiting indefinitely for cancellation."""
    task = asyncio.create_task(coroutine)
    done, _ = await asyncio.wait({task}, timeout=timeout)
    if not done:
        task.cancel()
        return False
    try:
        task.result()
    except asyncio.CancelledError:
        pass
    return True
