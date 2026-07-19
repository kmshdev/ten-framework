import importlib.util
import signal
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "process_supervisor.py"
SPEC = importlib.util.spec_from_file_location("process_supervisor", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {MODULE_PATH}")
SUPERVISOR_MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SUPERVISOR_MODULE
SPEC.loader.exec_module(SUPERVISOR_MODULE)

ProcessSpec = SUPERVISOR_MODULE.ProcessSpec
ProcessSupervisor = SUPERVISOR_MODULE.ProcessSupervisor


class ProcessSupervisorTests(unittest.TestCase):
    def setUp(self):
        self.specs = (
            ProcessSpec("frontend", ("frontend",), "/frontend"),
            ProcessSpec("launcher", ("launcher",), "/launcher"),
        )

    @patch.object(SUPERVISOR_MODULE.subprocess, "Popen")
    def test_starts_every_required_process_in_its_own_session(self, popen):
        popen.side_effect = [Mock(pid=101), Mock(pid=202)]
        supervisor = ProcessSupervisor(self.specs)

        supervisor.start()

        self.assertEqual(set(supervisor.processes), {"frontend", "launcher"})
        popen.assert_any_call(("frontend",), cwd="/frontend", start_new_session=True)
        popen.assert_any_call(("launcher",), cwd="/launcher", start_new_session=True)

    @patch.object(SUPERVISOR_MODULE.time, "sleep")
    def test_any_child_exit_fails_the_supervisor(self, _sleep):
        frontend = Mock(pid=101)
        launcher = Mock(pid=202)
        frontend.poll.return_value = None
        launcher.poll.return_value = 0
        supervisor = ProcessSupervisor(self.specs)
        supervisor.processes = {"frontend": frontend, "launcher": launcher}

        self.assertEqual(supervisor.wait(), 1)

    @patch.object(SUPERVISOR_MODULE.os, "killpg")
    def test_shutdown_terminates_every_running_child(self, killpg):
        frontend = Mock(pid=101)
        launcher = Mock(pid=202)
        frontend.poll.return_value = None
        launcher.poll.return_value = None
        supervisor = ProcessSupervisor(self.specs)
        supervisor.processes = {"frontend": frontend, "launcher": launcher}

        supervisor.stop()

        self.assertEqual(
            killpg.call_args_list,
            [unittest.mock.call(101, signal.SIGTERM), unittest.mock.call(202, signal.SIGTERM)],
        )
        frontend.wait.assert_called_once()
        launcher.wait.assert_called_once()

    @patch.object(SUPERVISOR_MODULE.os, "killpg")
    def test_shutdown_force_kills_a_child_after_deadline(self, killpg):
        process = Mock(pid=101)
        process.poll.return_value = None
        process.wait.side_effect = [SUPERVISOR_MODULE.subprocess.TimeoutExpired("x", 1), 0]
        supervisor = ProcessSupervisor(self.specs, shutdown_timeout=0)
        supervisor.processes = {"frontend": process}

        supervisor.stop()

        self.assertEqual(
            killpg.call_args_list,
            [unittest.mock.call(101, signal.SIGTERM), unittest.mock.call(101, signal.SIGKILL)],
        )


if __name__ == "__main__":
    unittest.main()
