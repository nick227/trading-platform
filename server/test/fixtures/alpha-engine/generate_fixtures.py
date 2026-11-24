"""Generate Alpha Engine research-trace fixtures with Alpha Engine's own code.

TradeLoom must verify the exact canonical bytes Alpha Engine publishes (Python
json.dumps: sorted keys, compact, ensure_ascii=False, floats such as 540.0).
Hand-written fixtures drift; these are produced by `build_prediction_trace`
against a throwaway SQLite database using the production `predictions` schema.

Usage (from an alpha-engine checkout with its virtualenv):
    .venv/bin/python -I <this file> <alpha-engine-root> <output-dir> [commit-label]
"""
from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from pathlib import Path

AE_ROOT = Path(sys.argv[1]).resolve()
OUT = Path(sys.argv[2]).resolve()
sys.path.insert(0, str(AE_ROOT))

from app.internal_read_v1.research_trace import build_prediction_trace  # noqa: E402

# Evaluation evidence: SPY/IWM/DIA carry qualifying (edge + out-of-sample) evidence; QQQ mirrors
# staging's real no-edge publications.
# Shapes mirror staging rows (uppercase BUY/SELL, uncalibrated confidence, 5d/15d horizons).
PREDICTIONS = [
    # id, strategy, ticker, timestamp, prediction, confidence, horizon, entry, rank, features, ranking
    ("pred_spy_buy", "realness_repricer_v1_paper", "SPY", "2026-11-20T14:30:00+00:00", "BUY", 0.82, "5d", 540.0, 0.6,
     {"model_id": "realness_repricer_v1_paper", "rsi_14": 61.5, "momentum_20d": 0.034, "note": "café ✓"},
     {"as_of_date": "2026-11-20", "config": {"pipeline_version": "9f52dc1"}, "rank_score": 0.6, "evaluation": {"edgeOverBaseline": True, "genuineOutOfSample": True, "sufficientHoldout": True, "holdout": {"signals": 420, "precision": 0.57, "baselineRate": 0.5}}}),
    ("pred_qqq_weak", "ownership_vacuum_v1_paper", "QQQ", "2026-11-20T14:30:00+00:00", "BUY", 0.35, "15d", 480.25, 0.41,
     {"model_id": "ownership_vacuum_v1_paper", "rsi_14": 48.0}, {"as_of_date": "2026-11-20", "evaluation": {"edgeOverBaseline": False, "genuineOutOfSample": False, "sufficientHoldout": True, "holdout": {"signals": 630, "precision": 0.484, "baselineRate": 0.499}}}),
    ("pred_iwm_sell", "realness_repricer_v1_paper", "IWM", "2026-11-20T14:30:00+00:00", "SELL", 0.9, "5d", 200.0, 0.55,
     {"model_id": "realness_repricer_v1_paper"}, {"as_of_date": "2026-11-20", "evaluation": {"edgeOverBaseline": True, "genuineOutOfSample": True, "sufficientHoldout": True, "holdout": {"signals": 420, "precision": 0.57, "baselineRate": 0.5}}}),
    # A newer SPY prediction (a later pipeline run) — not in the default ranking index.
    ("pred_spy_buy_next", "realness_repricer_v1_paper", "SPY", "2026-11-20T14:45:00+00:00", "BUY", 0.77, "5d", 541.0, 0.62,
     {"model_id": "realness_repricer_v1_paper", "rsi_14": 63.0}, {"as_of_date": "2026-11-20", "rank_score": 0.62, "evaluation": {"edgeOverBaseline": True, "genuineOutOfSample": True, "sufficientHoldout": True, "holdout": {"signals": 420, "precision": 0.57, "baselineRate": 0.5}}}),
    ("pred_dia_stale", "realness_repricer_v1_paper", "DIA", "2026-11-10T14:30:00+00:00", "BUY", 0.95, "5d", 420.0, 0.7,
     {"model_id": "realness_repricer_v1_paper"}, {"as_of_date": "2026-11-10", "evaluation": {"edgeOverBaseline": True, "genuineOutOfSample": True, "sufficientHoldout": True, "holdout": {"signals": 420, "precision": 0.57, "baselineRate": 0.5}}}),
]


def main() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """CREATE TABLE predictions (
            id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default', strategy_id TEXT NOT NULL,
            scored_event_id TEXT NOT NULL, ticker TEXT NOT NULL, timestamp TEXT NOT NULL,
            prediction TEXT NOT NULL, confidence REAL NOT NULL, horizon TEXT NOT NULL,
            entry_price REAL NOT NULL, mode TEXT NOT NULL, feature_snapshot_json TEXT NOT NULL,
            regime TEXT, trend_strength TEXT, scored_outcome_id TEXT, scored_at TEXT,
            rank_score REAL, ranking_context_json TEXT)"""
    )
    for pid, strat, ticker, ts, pred, conf, hz, entry, rank, feat, rctx in PREDICTIONS:
        conn.execute(
            "INSERT INTO predictions (id, tenant_id, strategy_id, scored_event_id, ticker, timestamp, prediction,"
            " confidence, horizon, entry_price, mode, feature_snapshot_json, rank_score, ranking_context_json)"
            " VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, 'discovery', ?, ?, ?)",
            (pid, strat, "evt_" + pid, ticker, ts, pred, conf, hz, entry, json.dumps(feat), rank, json.dumps(rctx)),
        )

    OUT.mkdir(parents=True, exist_ok=True)
    traces = {pid: build_prediction_trace(conn, tenant_id="default", prediction_id=pid) for pid, *_ in PREDICTIONS}
    commit = sys.argv[3] if len(sys.argv) > 3 else subprocess.run(["git", "-C", str(AE_ROOT), "rev-parse", "--short", "HEAD"],
                            capture_output=True, text=True).stdout.strip()
    payload = {"generatedBy": "alpha-engine build_prediction_trace", "alphaEngineCommit": commit, "traces": traces}
    (OUT / "traces.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(traces)} traces from alpha-engine@{commit}")


if __name__ == "__main__":
    main()
