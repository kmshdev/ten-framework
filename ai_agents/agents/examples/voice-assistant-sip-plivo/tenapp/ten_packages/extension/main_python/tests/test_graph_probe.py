import importlib.util
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "graph_probe.py"
SPEC = importlib.util.spec_from_file_location("main_python_graph_probe", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {MODULE_PATH}")
GRAPH_PROBE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = GRAPH_PROBE
SPEC.loader.exec_module(GRAPH_PROBE)


class GraphProbeTests(unittest.TestCase):
    def test_defaults_to_minimal_probe(self):
        self.assertEqual(
            GRAPH_PROBE.resolve_graph_probe(None),
            ("minimal", "graph_lifecycle_smoke"),
        )

    def test_legacy_full_flag_selects_full_probe(self):
        self.assertEqual(
            GRAPH_PROBE.resolve_graph_probe(None, full=True),
            ("full", "va_in_hybrid_stack"),
        )

    def test_all_declared_probes_are_resolvable(self):
        for probe, graph_name in GRAPH_PROBE.GRAPH_PROBES.items():
            with self.subTest(probe=probe):
                self.assertEqual(
                    GRAPH_PROBE.resolve_graph_probe(probe),
                    (probe, graph_name),
                )

    def test_rejects_arbitrary_predefined_graph_name(self):
        with self.assertRaisesRegex(ValueError, "unsupported graph probe"):
            GRAPH_PROBE.resolve_graph_probe("plivo_coordinator")


if __name__ == "__main__":
    unittest.main()
