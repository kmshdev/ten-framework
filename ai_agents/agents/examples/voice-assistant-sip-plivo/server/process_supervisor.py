#!/usr/bin/env python3
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class ProcessSpec:
    name: str
    command: tuple[str, ...]
    cwd: str


class ProcessSupervisor:
    def __init__(self, specs: tuple[ProcessSpec, ...], shutdown_timeout: float = 10.0):
        if not specs:
            raise ValueError("at least one process is required")
        self.specs = specs
        self.shutdown_timeout = shutdown_timeout
        self.processes: dict[str, subprocess.Popen] = {}
        self.shutdown_requested = False

    def request_shutdown(self, _signum=None, _frame=None) -> None:
        self.shutdown_requested = True

    def start(self) -> None:
        for spec in self.specs:
            process = subprocess.Popen(
                spec.command,
                cwd=spec.cwd,
                start_new_session=True,
            )
            self.processes[spec.name] = process
            print(f"Started {spec.name} with PID {process.pid}", flush=True)

    def wait(self, poll_interval: float = 0.2) -> int:
        while not self.shutdown_requested:
            for name, process in self.processes.items():
                return_code = process.poll()
                if return_code is not None:
                    print(
                        f"Required process {name} exited unexpectedly with code {return_code}",
                        file=sys.stderr,
                        flush=True,
                    )
                    return 1
            time.sleep(poll_interval)
        return 0

    def stop(self) -> None:
        running = [process for process in self.processes.values() if process.poll() is None]
        for process in running:
            os.killpg(process.pid, signal.SIGTERM)

        deadline = time.monotonic() + self.shutdown_timeout
        for process in running:
            remaining = max(0.0, deadline - time.monotonic())
            try:
                process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()

    def run(self) -> int:
        previous_handlers = {
            signum: signal.signal(signum, self.request_shutdown)
            for signum in (signal.SIGTERM, signal.SIGINT)
        }
        try:
            self.start()
            return self.wait()
        finally:
            self.stop()
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)


def main() -> int:
    supervisor = ProcessSupervisor(
        (
            ProcessSpec(
                name="frontend",
                command=("bun", "start", "--port", "3000"),
                cwd="/app/frontend",
            ),
            ProcessSpec(
                name="launcher",
                command=(
                    "python3",
                    "/app/server/main.py",
                    "--tenapp-dir",
                    "/app/agents",
                    "--port",
                    "8080",
                ),
                cwd="/app",
            ),
        )
    )
    return supervisor.run()


if __name__ == "__main__":
    raise SystemExit(main())
