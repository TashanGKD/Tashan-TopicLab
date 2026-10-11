#!/usr/bin/env python3
"""Cap downloads from one proxy upstream without replacing host egress queues.

Run as root on the proxy host. A root-owned systemd ExecStartPost hook can run
this helper after each proxy start; no timer or proxy credentials are needed.
"""

import argparse
import ipaddress
import json
import os
import re
import subprocess


OWNER = "tashan-world-proxy-bandwidth"
FILTER_PRIORITY = "49500"


def run(*args, check=True):
    return subprocess.run(args, check=check, text=True, capture_output=True)


def records(*args):
    return json.loads(run(*args).stdout)


def interface_name(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,15}", value):
        raise argparse.ArgumentTypeError("invalid Linux interface name")
    return value


def apply(interface, ifb, node_ip, node_port, rate_mbps):
    if interface == ifb:
        raise ValueError("the ingress interface and IFB must differ")
    address = str(ipaddress.IPv4Address(node_ip))
    if not 1 <= node_port <= 65535 or not 1 <= rate_mbps <= 1000:
        raise ValueError("invalid port or bandwidth limit")
    records("ip", "-j", "link", "show", "dev", interface)
    existing = run("ip", "-d", "-j", "link", "show", "dev", ifb, check=False)
    if existing.returncode == 0:
        link = json.loads(existing.stdout)[0]
        if link.get("ifalias") != OWNER or link.get("linkinfo", {}).get("info_kind") != "ifb":
            raise RuntimeError("refusing to modify an IFB owned by another service")

    filters = records("tc", "-j", "filter", "show", "dev", interface,
                      "ingress", "pref", FILTER_PRIORITY)
    for entry in filters:
        options = entry.get("options")
        if options is None:
            continue  # tc also emits a classifier header without its options.
        actions = options.get("actions", [])
        if entry.get("kind") != "flower" or len(actions) != 1 or actions[0].get("to_dev") != ifb:
            raise RuntimeError("refusing to replace another service's ingress filter")
        if existing.returncode != 0:
            raise RuntimeError("an ingress filter exists without its owned IFB")

    if existing.returncode != 0:
        run("modprobe", "ifb")
        run("ip", "link", "add", ifb, "type", "ifb")
        run("ip", "link", "set", "dev", ifb, "alias", OWNER)
    run("ip", "link", "set", "dev", ifb, "up")
    # This queue belongs only to our IFB; preserve the physical device root.
    run("tc", "qdisc", "replace", "dev", ifb, "root", "handle", "1:", "tbf",
        "rate", f"{rate_mbps}mbit", "burst", "64kb", "latency", "1000ms")
    qdiscs = records("tc", "-j", "qdisc", "show", "dev", interface)
    if not any(q.get("kind") in ("clsact", "ingress") for q in qdiscs):
        run("tc", "qdisc", "add", "dev", interface, "clsact")
    run("tc", "filter", "replace", "dev", interface, "ingress", "protocol", "ip",
        "pref", FILTER_PRIORITY, "handle", "1", "flower", "src_ip", f"{address}/32",
        "ip_proto", "tcp", "src_port", str(node_port),
        "action", "mirred", "egress", "redirect", "dev", ifb)
    print(f"Proxy download guard active: {rate_mbps} Mbps, {interface} -> {ifb}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interface", type=interface_name, default="eth0")
    parser.add_argument("--ifb", type=interface_name, default="ifb-world-vpn")
    parser.add_argument("--node-ip", required=True)
    parser.add_argument("--node-port", type=int, required=True)
    parser.add_argument("--rate-mbps", type=int, default=1)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("root privileges are required")
    try:
        apply(args.interface, args.ifb, args.node_ip, args.node_port, args.rate_mbps)
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"Proxy download guard failed: {exc}\n")


if __name__ == "__main__":
    main()
