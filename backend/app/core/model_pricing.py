"""Model pricing configuration: load, save, and calculate cost from usage."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_PRICING_FILE = Path(__file__).resolve().parent.parent.parent / "model_pricing.json"


def load_model_pricing() -> dict[str, dict[str, float]]:
    """Load per-model pricing config from JSON file.

    Returns a dict mapping model value to {"input_price_per_1m": float, "output_price_per_1m": float}.
    """
    if _PRICING_FILE.exists():
        try:
            return json.loads(_PRICING_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_model_pricing(pricing: dict[str, dict[str, float]]) -> None:
    """Save per-model pricing config to JSON file."""
    _PRICING_FILE.write_text(json.dumps(pricing, indent=2, ensure_ascii=False), encoding="utf-8")


def calculate_cost_from_usage(model: str, usage: dict[str, Any] | None) -> float | None:
    """Calculate cost in USD using custom pricing and token usage.

    Returns None if no custom pricing is configured for the model,
    or if usage data is unavailable.
    """
    if not usage:
        return None

    pricing = load_model_pricing()
    if model not in pricing:
        return None

    entry = pricing[model]
    input_price = entry.get("input_price_per_1m", 0.0)
    output_price = entry.get("output_price_per_1m", 0.0)

    input_tokens = usage.get("input_tokens", 0) or 0
    output_tokens = usage.get("output_tokens", 0) or 0

    return (input_tokens * input_price + output_tokens * output_price) / 1_000_000
