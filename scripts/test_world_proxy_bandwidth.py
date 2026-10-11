"""Verify the guard's scope and refusal to replace another service's objects."""

import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "bandwidth", Path(__file__).with_name("world-proxy-bandwidth.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class GuardTests(unittest.TestCase):
    def execute(self, link=None, filters=None, qdiscs=None):
        calls = []

        def fake_run(*args, check=True):
            calls.append(args)
            data = []
            status = 0
            if args[:4] == ("ip", "-d", "-j", "link"):
                status = 1 if link is None else 0
                data = [link] if link else []
            elif args[:4] == ("tc", "-j", "filter", "show"):
                data = filters or []
            elif args[:4] == ("tc", "-j", "qdisc", "show"):
                data = qdiscs or [{"kind": "mq", "root": True}]
            return subprocess.CompletedProcess(args, status, json.dumps(data), "")

        with patch.object(guard, "run", side_effect=fake_run):
            guard.apply("eth0", "ifb-world-vpn", "192.0.2.1", 15318, 1)
        return calls

    def test_matches_only_selected_tcp_upstream_and_preserves_host_root(self):
        calls = self.execute()
        classifier = next(c for c in calls if c[:3] == ("tc", "filter", "replace"))
        self.assertEqual(classifier, (
            "tc", "filter", "replace", "dev", "eth0", "ingress", "protocol", "ip",
            "pref", "49500", "handle", "1", "flower", "src_ip", "192.0.2.1/32",
            "ip_proto", "tcp", "src_port", "15318", "action", "mirred", "egress",
            "redirect", "dev", "ifb-world-vpn"))
        roots = [c for c in calls if c[:3] == ("tc", "qdisc", "replace")]
        self.assertEqual(len(roots), 1)
        self.assertEqual(roots[0][3:6], ("dev", "ifb-world-vpn", "root"))
        self.assertIn("1mbit", roots[0])

    def test_reapplication_reuses_owned_interface_and_existing_ingress(self):
        calls = self.execute(
            link={"ifalias": guard.OWNER, "linkinfo": {"info_kind": "ifb"}},
            filters=[{"kind": "flower"}, {"kind": "flower", "options": {
                "actions": [{"kind": "mirred", "to_dev": "ifb-world-vpn"}]}}],
            qdiscs=[{"kind": "mq", "root": True}, {"kind": "ingress"}])
        self.assertFalse(any(c[:3] == ("ip", "link", "add") for c in calls))
        self.assertFalse(any(c[:3] == ("tc", "qdisc", "add") for c in calls))

    def test_refuses_foreign_ifb(self):
        with self.assertRaisesRegex(RuntimeError, "IFB owned by another"):
            self.execute(link={"linkinfo": {"info_kind": "ifb"}})

    def test_refuses_foreign_filter(self):
        with self.assertRaisesRegex(RuntimeError, "another service's ingress filter"):
            self.execute(filters=[{"kind": "flower", "options": {
                "actions": [{"to_dev": "another-ifb"}]}}])

    def test_rejects_invalid_target_before_network_mutation(self):
        with patch.object(guard, "run") as runner:
            for ip, port, rate in [("::1", 15318, 1), ("192.0.2.1", 0, 1),
                                   ("192.0.2.1", 15318, 0)]:
                with self.assertRaises(ValueError):
                    guard.apply("eth0", "ifb-world-vpn", ip, port, rate)
            runner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
