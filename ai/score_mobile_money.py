#!/usr/bin/env python3
"""SHE-Fund alternative-data scorecard (SIMULATED data, rule-based model).

Turns simulated mobile-money behaviour into a starting score between 300 and 700
and a SHA-256 hash that commits to the exact inputs. The hash is stored on-chain
with Reputation.setDataHash; the score is applied with Reputation.setStartingScore.

This is a simple, transparent weighted scorecard, not a trained machine-learning
model. Weights are chosen by the team and have NOT been validated on real borrowers.

Fairness design: the model uses behaviour ratios (paying bills, keeping up group
savings, stable inflows, account age). It does NOT use gender, name, location,
phone number or the absolute amount of income, so lower-income women are not
penalised just for earning less.

Usage:
    python ai/score_mobile_money.py --input ai/data/mobile_money_sample.json \
        --output ai/output/scores.json
"""
import argparse
import hashlib
import json
import statistics
from pathlib import Path

MODEL_VERSION = "scorecard-v1"
MIN_SCORE, MAX_SCORE = 300, 700  # must match Reputation.sol limits

WEIGHTS = {
    "payment_reliability": 0.35,        # bills/airtime paid on time
    "group_savings_consistency": 0.30,  # chama contributions made vs expected
    "income_stability": 0.20,           # steadiness of monthly inflows (not their size)
    "account_history": 0.15,            # months of mobile-money activity, capped at 12
}


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


PRIOR_STRENGTH = 4  # pseudo-observations at 0.5: small samples are pulled toward neutral
STABILITY_FULL_MONTHS = 6  # months of inflow data needed to fully trust the stability measure


def ratio(done: float, expected: float) -> float:
    """Share completed, smoothed toward a neutral 0.5 when there is little data.

    No data gives exactly 0.5 (a thin file is not a bad file); a short perfect record
    is trusted less than a long perfect one.
    """
    return clamp01((done + 0.5 * PRIOR_STRENGTH) / (expected + PRIOR_STRENGTH))


def sub_scores(b: dict) -> dict:
    inflows = b["monthly_inflows_kes"]
    mean = statistics.mean(inflows) if inflows else 0
    variation = statistics.pstdev(inflows) / mean if mean > 0 else 1.0
    trust = min(1.0, len(inflows) / STABILITY_FULL_MONTHS)
    stability = clamp01(1.0 - variation)
    return {
        "payment_reliability": ratio(b["bills_paid_on_time"], b["bills_due"]),
        "group_savings_consistency": ratio(
            b["chama_contributions_made"], b["chama_contributions_expected"]
        ),
        "income_stability": trust * stability + (1 - trust) * 0.5,
        "account_history": clamp01(b["months_active"] / 12),
    }


def score(b: dict) -> tuple[dict, int]:
    subs = sub_scores(b)
    weighted = sum(WEIGHTS[k] * v for k, v in subs.items())
    value = MIN_SCORE + round((MAX_SCORE - MIN_SCORE) * weighted)
    return subs, max(MIN_SCORE, min(MAX_SCORE, value))


def commitment_hash(inputs: dict, value: int) -> str:
    """SHA-256 of canonical JSON, as 0x + 64 hex chars (fits bytes32)."""
    payload = {"model_version": MODEL_VERSION, "inputs": inputs, "score": value}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "0x" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    results = []
    for b in data["borrowers"]:
        inputs = {k: v for k, v in b.items() if k not in ("label", "account_index")}
        subs, value = score(inputs)
        results.append(
            {
                "label": b["label"],
                "account_index": b["account_index"],
                "score": value,
                "data_hash": commitment_hash(inputs, value),
                "sub_scores": {k: round(v, 3) for k, v in subs.items()},
            }
        )
        print(f'{b["label"]:<22} score {value}  hash {results[-1]["data_hash"][:18]}...')

    out = {
        "model_version": MODEL_VERSION,
        "weights": WEIGHTS,
        "range": [MIN_SCORE, MAX_SCORE],
        "note": "Simulated data and a team-chosen scorecard. Not validated on real borrowers.",
        "borrowers": results,
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
