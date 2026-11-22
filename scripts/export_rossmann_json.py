#!/usr/bin/env python3
"""
export_rossmann_json.py -- turn the Rossmann pipeline into compact JSON files for the website.

Reads  : train.csv, test.csv, store.csv (Kaggle) + your submission.csv
Writes : data/rossmann_dashboard.json   (Project 1 dashboard)
         data/inventory_stores.json     (Project 2: per-store demand + forecast-error statistics)

Only AGGREGATES are written (weekly means, per-store statistics). The raw Kaggle files are never copied.

What it does
  1. Rebuilds the validation split (last 48 days) with the same features as solution_final.py
  2. Refits model B (raw Sales target, 1/Sales^2 weights) for a FIXED number of rounds (no early stopping)
     on the training part and predicts the validation part  -> real out-of-sample errors per store/day
  3. Joins your submission.csv to test.csv for the forecast section
  4. Writes the JSON files

Usage (PowerShell, from the repository root):
  python scripts/export_rossmann_json.py --data "C:\\path\\to\\rossmann" --sub "C:\\path\\to\\submission.csv"
  (without --data the files are fetched with kagglehub, as in solution_final.py)

Typical runtime on the full data: roughly as long as one validation fit of model B (several minutes).
Put solution_final.py in the same folder as this script (it is imported).
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import solution_final as sf  # noqa: E402  (prep, make_params, fit_b, predict_b, EVENT_STORES, BASE_FEATS)

TOP_STORES = 30          # stores offered in the dashboard's store selector (plus the event stores)
LOOKBACK_DAYS = 84       # history shown before the validation window for the exception stores


# --------------------------------------------------------------------------- helpers
def clean(o):
    """Make an object JSON-safe: numpy -> python, NaN/inf -> None, dates -> ISO strings."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(o, (pd.Timestamp, dt.date, dt.datetime)):
        return str(o)[:10]
    return o


def r(x, n=4):
    if x is None:
        return None
    x = float(x)
    return None if (math.isnan(x) or math.isinf(x)) else round(x, n)


def week_start(dates):
    """Monday of the week for a datetime Series."""
    return dates - pd.to_timedelta(dates.dt.dayofweek, unit="D")


def write_json(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(clean(obj), f, separators=(",", ":"), allow_nan=False, ensure_ascii=False)
    print(f"  wrote {path}  ({os.path.getsize(path) / 1024:.1f} KB)")


def seg_table(df, col, names=None):
    """RMSPE and share of total squared percentage error by segment."""
    total = df["sq"].sum()
    out = []
    for key, g in df.groupby(col):
        out.append({
            "key": key if names is None else names.get(key, key),
            "n": int(len(g)),
            "rmspe": r(math.sqrt(g["sq"].mean())),
            "share_sq_err": r(g["sq"].sum() / total),
        })
    return out


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=None, help="folder with train.csv, test.csv, store.csv (default: kagglehub)")
    ap.add_argument("--sub", default="submission.csv", help="path to your submission.csv")
    ap.add_argument("--out", default=str(HERE.parent / "data"), help="output folder (default: ../data)")
    ap.add_argument("--iters-b", type=int, default=4250, help="rounds for model B (validation best iteration)")
    ap.add_argument("--lr", type=float, default=0.05)
    ap.add_argument("--source", default="real", help='"real" for the real Kaggle data; use e.g. "synthetic-sample" otherwise')
    args = ap.parse_args()
    t0 = time.time()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    if args.data:
        path = args.data
    else:
        import kagglehub
        path = kagglehub.competition_download("rossmann-store-sales")

    print("Loading data ...")
    train_raw = pd.read_csv(os.path.join(path, "train.csv"), low_memory=False)
    test_raw = pd.read_csv(os.path.join(path, "test.csv"), low_memory=False)
    store = pd.read_csv(os.path.join(path, "store.csv"))
    sub = pd.read_csv(args.sub)
    comp_median = store["CompetitionDistance"].median()
    store_type = store.set_index("Store")["StoreType"]
    store_assort = store.set_index("Store")["Assortment"]

    # ---------------- closed-day facts (raw files)
    test_open = test_raw["Open"].fillna(1) != 0
    tsub = test_raw.merge(sub, on="Id", how="left")
    if tsub["Sales"].isna().any():
        raise SystemExit("submission.csv does not cover every Id in test.csv")
    closed = {
        "train_rows_total": len(train_raw),
        "train_closed_rows": int((train_raw["Open"] == 0).sum()),
        "train_open_zero_sales_rows": int(((train_raw["Open"] != 0) & (train_raw["Sales"] == 0)).sum()),
        "test_rows": len(test_raw),
        "test_closed_rows": int((test_raw["Open"] == 0).sum()),
        "test_open_missing_rows": int(test_raw["Open"].isna().sum()),
        "closed_predictions_all_zero": bool((tsub.loc[test_raw["Open"] == 0, "Sales"] == 0).all()),
    }

    # ---------------- cleaned training data + features (same as solution_final.py)
    train_clean = train_raw[(train_raw["Open"] != 0) & (train_raw["Sales"] > 0)].reset_index(drop=True)
    train = sf.prep(train_clean, store, comp_median)
    train["Sales_log"] = np.log1p(train["Sales"])
    closed["train_rows_used"] = len(train)
    closed["train_open_mean"] = r(train["Sales"].mean(), 1)
    closed["test_open_pred_mean"] = r(tsub.loc[test_open, "Sales"].mean(), 1)

    # ---------------- validation split + model B refit (fixed rounds)
    split_date = train["Date"].max() - pd.Timedelta(days=48)
    tr = train[train["Date"] <= split_date].copy()
    va = train[train["Date"] > split_date].copy()
    aggs = sf.store_aggregates(tr)
    tr = tr.merge(aggs, on="Store", how="left")
    va = va.merge(aggs, on="Store", how="left")

    print(f"Fitting model B on {len(tr):,} rows for {args.iters_b} rounds (lr {args.lr}) ...")
    model = sf.fit_b(sf.make_params(args.lr, args.iters_b), tr)
    va["pred"] = sf.predict_b(model, va)
    va["sq"] = ((va["Sales"] - va["pred"]) / va["Sales"]) ** 2
    va["err"] = va["Sales"] - va["pred"]

    # baseline: store x weekday mean from the training part
    base = tr.groupby(["Store", "DayOfWeek"])["Sales"].mean().rename("base").reset_index()
    vb = va.merge(base, on=["Store", "DayOfWeek"], how="left")
    rm_all = sf.rmspe(va["Sales"].values, va["pred"].values)
    clean_mask = ~va["Store"].isin(sf.EVENT_STORES).values
    rm_clean = sf.rmspe(va["Sales"].values[clean_mask], va["pred"].values[clean_mask])
    rm_base = sf.rmspe(vb["Sales"].values, vb["base"].values)
    print(f"  validation RMSPE: all={rm_all:.5f}  excl. event stores={rm_clean:.5f}  baseline={rm_base:.5f}")

    # compare with the numbers recorded in model_card.json (real data only)
    card_path = out / "model_card.json"
    if args.source == "real" and card_path.exists():
        card = json.loads(card_path.read_text(encoding="utf-8"))
        rec = card["validation"]["rmspe_all"]
        if abs(rec - rm_all) > 0.003:
            print(f"  WARNING: recomputed validation RMSPE {rm_all:.5f} differs from the recorded {rec:.5f} "
                  f"by more than 0.003. Check --iters-b/--lr and that solution_final.py is unchanged.")
        else:
            print(f"  OK: matches the recorded value {rec:.5f} within 0.003")

    va_dates = sorted(va["Date"].unique())
    va_start, va_end = pd.Timestamp(va_dates[0]), pd.Timestamp(va_dates[-1])
    total_sq = va["sq"].sum()

    # ---------------- Project 1: dashboard JSON
    validation = {
        "rmspe_all": r(rm_all, 5), "rmspe_excl_event_stores": r(rm_clean, 5), "baseline_rmspe": r(rm_base, 5),
        "event_stores": sf.EVENT_STORES,
        "by_weekday": seg_table(va, "DayOfWeek"),
        "by_promo": seg_table(va, "Promo"),
    }

    # history and forecast: mean sales per open store-day, calendar-complete Mon-Sun weeks only
    h = train[["Date", "Sales"]].copy()
    h["wk"] = week_start(h["Date"])
    hw = h.groupby("wk").agg(v=("Sales", "mean"))
    f = tsub.loc[test_open, ["Date", "Sales"]].copy()
    f["Date"] = pd.to_datetime(f["Date"])
    f["wk"] = week_start(f["Date"])
    fw = f.groupby("wk").agg(v=("Sales", "mean"))

    def complete_weeks(g, lo, hi):
        """Keep only calendar-complete Mon-Sun weeks inside [lo, hi] (Sundays are mostly closed, so we
        cannot require 7 trading dates)."""
        return g[(g.index >= lo) & (g.index + pd.Timedelta(days=6) <= hi)]

    hw = complete_weeks(hw, pd.to_datetime(train_raw["Date"]).min(), pd.to_datetime(train_raw["Date"]).max())
    fw = complete_weeks(fw, pd.to_datetime(test_raw["Date"]).min(), pd.to_datetime(test_raw["Date"]).max())

    # validation: chain totals per day + selected stores
    daily = va.groupby("Date").agg(actual=("Sales", "sum"), predicted=("pred", "sum"))
    top = list(va.groupby("Store")["Sales"].sum().nlargest(TOP_STORES).index)
    extra = [s for s in sf.EVENT_STORES if s in set(va["Store"]) and s not in top]
    sel_stores = sorted(set(top) | set(extra))
    per_store = {}
    for sid in sel_stores:
        g = va[va["Store"] == sid].set_index("Date")[["Sales", "pred"]].reindex(va_dates)
        per_store[sid] = {
            "actual": [r(x, 1) for x in g["Sales"]],
            "predicted": [r(x, 1) for x in g["pred"]],
            "rmspe": r(math.sqrt(va.loc[va["Store"] == sid, "sq"].mean())),
            "is_event_store": sid in sf.EVENT_STORES,
        }

    # weekday x promo profile and promo effect by store type (training data)
    prof = train.groupby(["DayOfWeek", "Promo"])["Sales"].agg(["mean", "size"]).reset_index()
    t2 = train.assign(StoreTypeL=train["Store"].map(store_type))
    stp = t2.groupby(["StoreTypeL", "Promo"])["Sales"].agg(["mean", "size"]).reset_index()

    # feature importance (gain share)
    gain = model.booster_.feature_importance(importance_type="gain")
    imp = sorted(zip(sf.BASE_FEATS, gain / gain.sum()), key=lambda x: -x[1])

    # exception stores: weekly means, history + validation window
    exceptions = {}
    for sid in sf.EVENT_STORES:
        if sid not in set(train["Store"]):
            print(f"  note: event store {sid} not present in this dataset (ok for sample data)")
            continue
        rows = train[(train["Store"] == sid) & (train["Date"] >= va_start - pd.Timedelta(days=LOOKBACK_DAYS))].copy()
        rows["wk"] = week_start(rows["Date"])
        vrows = va[va["Store"] == sid].copy()
        vrows["wk"] = week_start(vrows["Date"])
        weeks = sorted(set(rows["wk"]) | set(vrows["wk"]))
        actual, pred, n_open = [], [], []
        for wk in weeks:
            allr = rows[rows["wk"] == wk]
            vr = vrows[vrows["wk"] == wk]
            n_open.append(int(len(allr)))
            if len(vr) >= 3:                       # validation week: compare the same rows
                actual.append(r(vr["Sales"].mean(), 1)); pred.append(r(vr["pred"].mean(), 1))
            else:
                actual.append(r(allr["Sales"].mean(), 1) if len(allr) else None); pred.append(None)
        exceptions[sid] = {
            "weeks": [str(w)[:10] for w in weeks], "actual": actual, "predicted": pred, "n_open_days": n_open,
            "val_rmspe": r(math.sqrt(vrows["sq"].mean())) if len(vrows) else None,
            "n_val_rows": int(len(vrows)),
            "share_sq_err": r(vrows["sq"].sum() / total_sq) if len(vrows) else None,
        }
    ev_rows = va[va["Store"].isin(sf.EVENT_STORES)]

    dashboard = {
        "meta": {
            "source": args.source,
            "generated_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "model": f"LightGBM, raw Sales target, 1/Sales^2 weights, lr {args.lr}, {args.iters_b} rounds",
            "val_start": va_start, "val_end": va_end, "val_rows": int(len(va)), "train_rows": int(len(tr)),
            "n_stores": int(train["Store"].nunique()),
            "unit": "mean sales per open store-day (weekly), total sales per day (validation)",
        },
        "validation": validation,
        "event_store_share_sq_err": r(ev_rows["sq"].sum() / total_sq),
        "event_store_val_rows": int(len(ev_rows)),
        "history_weekly": {"weeks": [str(w)[:10] for w in hw.index], "mean_sales": [r(x, 1) for x in hw["v"]]},
        "forecast_weekly": {"weeks": [str(w)[:10] for w in fw.index], "mean_sales": [r(x, 1) for x in fw["v"]]},
        "val_daily_total": {"dates": [str(d)[:10] for d in daily.index],
                            "actual": [r(x, 0) for x in daily["actual"]], "predicted": [r(x, 0) for x in daily["predicted"]]},
        "val_dates": [str(pd.Timestamp(d))[:10] for d in va_dates],
        "val_by_store": per_store,
        "weekday_promo_profile": [{"dow": int(a), "promo": int(b), "mean": r(c, 1), "n": int(d)} for a, b, c, d in prof.itertuples(index=False)],
        "storetype_promo": [{"store_type": a, "promo": int(b), "mean": r(c, 1), "n": int(d)} for a, b, c, d in stp.itertuples(index=False)],
        "feature_importance": [{"feature": a, "gain_share": r(b)} for a, b in imp],
        "closed_days": closed,
        "exceptions": exceptions,
    }
    write_json(dashboard, out / "rossmann_dashboard.json")

    # ---------------- Project 2: per-store demand and forecast error
    recent = tr[tr["Date"] > split_date - pd.Timedelta(days=364)]
    mu = recent.groupby("Store")["Sales"].mean()
    trading_days = recent.groupby("Store").size().mean()
    stats = va.groupby("Store").agg(sigma=("err", lambda x: x.std(ddof=1)), bias=("err", "mean"), n_val=("err", "size"))
    stats = stats[stats["n_val"] >= 5]
    stores_out = []
    for sid, row in stats.join(mu.rename("mu"), how="inner").iterrows():
        stores_out.append({
            "id": int(sid), "type": store_type.get(sid), "assortment": store_assort.get(sid),
            "mu": r(row["mu"], 1), "sigma": r(row["sigma"], 1), "bias": r(row["bias"], 1), "n_val": int(row["n_val"]),
        })
    inventory = {
        "meta": {
            "source": args.source,
            "generated_utc": dashboard["meta"]["generated_utc"],
            "n_stores": len(stores_out),
            "trading_days_per_year": r(trading_days, 1),
            "val_start": va_start, "val_end": va_end,
            "definitions": {
                "mu": "mean sales per trading day over the 364 days before the validation window (currency units, not units sold)",
                "sigma": "standard deviation of the daily forecast error (actual - predicted) in the validation window",
                "bias": "mean daily forecast error (actual - predicted) in the validation window",
            },
        },
        "stores": stores_out,
    }
    write_json(inventory, out / "inventory_stores.json")
    print(f"Done in {time.time() - t0:.0f}s. Source label: {args.source}")


if __name__ == "__main__":
    main()
