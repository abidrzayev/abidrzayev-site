"""
Rossmann store sales: final training + submission script.

Pipeline (same features you validated, no Store ID, no lag/dow experiments):
  1. Load + clean (drop closed days and zero sales), shared feature function for train and test
  2. Validation run on the last 48 days -> best iteration for model A and model B
  3. Refit A and B on ALL training data (aggregates recomputed on the full data)
  4. Blend 50/50, predict test, closed days = 0, write submission.csv

  Model A: log1p(Sales) target, RMSPE early stopping
  Model B: raw Sales target, 1/Sales^2 sample weights, RMSPE early stopping

Usage (PowerShell):
  python solution_final.py                    # downloads data with kagglehub
  python solution_final.py --data "C:\\path\\to\\folder"   # folder with train/test/store csv
  python solution_final.py --lr 0.1           # faster, slightly worse
  python solution_final.py --iters-a 3227 --iters-b 4250 --w-b 1.0   # skip validation, reuse iterations
"""
import argparse
import os

import lightgbm as lgb
import numpy as np
import pandas as pd

BASE_FEATS = [
    "DayOfWeek", "Promo", "StateHoliday", "SchoolHoliday",
    "StoreType", "Assortment", "CompetitionDistance", "CompetitionOpenMonths",
    "CompetitionKnown", "Promo2", "IsPromo2Active", "PromoInterval",
    "Year", "Month", "Day", "WeekOfYear",
    "store_mean_log_sales", "store_median_log_sales", "store_mean_customers",
]
CAT_FEATS = ["StoreType", "Assortment", "StateHoliday", "PromoInterval"]
EVENT_STORES = [292, 909, 782]  # stores with unpredictable events in the validation window

MAPS = {
    "StoreType": {"a": 0, "b": 1, "c": 2, "d": 3},
    "Assortment": {"a": 0, "b": 1, "c": 2},
    "StateHoliday": {"0": 0, "a": 1, "b": 2, "c": 3},
}
PROMO_MAP = {"": 0, "Jan,Apr,Jul,Oct": 1, "Feb,May,Aug,Nov": 2, "Mar,Jun,Sep,Dec": 3}
MONTH_NAMES = {1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
               7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec"}


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
def rmspe(y_true, y_pred):
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mask = y_true != 0
    return float(np.sqrt(np.mean(((y_true[mask] - y_pred[mask]) / y_true[mask]) ** 2)))


def rmspe_eval_log(y_true_log, y_pred_log):
    y_true, y_pred = np.expm1(y_true_log), np.expm1(y_pred_log)
    mask = y_true > 0
    err = np.sqrt(np.mean(((y_true[mask] - y_pred[mask]) / y_true[mask]) ** 2))
    return "rmspe", err, False


def rmspe_eval_raw(y_true, y_pred):
    mask = y_true > 0
    err = np.sqrt(np.mean(((y_true[mask] - y_pred[mask]) / y_true[mask]) ** 2))
    return "rmspe", err, False


# ---------------------------------------------------------------------------
# Features (one function for train AND test, so they cannot drift apart)
# ---------------------------------------------------------------------------
def prep(df, store, comp_distance_median):
    n_rows = len(df)
    df = df.copy()
    df["Date"] = pd.to_datetime(df["Date"])
    df["StateHoliday"] = df["StateHoliday"].astype(str)
    df = df.merge(store, on="Store", how="left")
    if len(df) != n_rows:
        raise ValueError("Merge with store.csv changed the row count")

    df["CompetitionDistance"] = df["CompetitionDistance"].fillna(comp_distance_median)
    for col in ["CompetitionOpenSinceMonth", "CompetitionOpenSinceYear",
                "Promo2SinceWeek", "Promo2SinceYear"]:
        df[col] = df[col].fillna(0)
    # store.csv spells September "Sept" in one interval ("Mar,Jun,Sept,Dec"); normalise to "Sep"
    df["PromoInterval"] = df["PromoInterval"].fillna("").str.replace("Sept", "Sep", regex=False)

    d = df["Date"].dt
    df["Year"], df["Month"], df["Day"] = d.year, d.month, d.day
    df["WeekOfYear"] = d.isocalendar().week.astype(int)

    unknown_comp = df["CompetitionOpenSinceYear"] == 0
    df["CompetitionOpenMonths"] = (
        12 * (df["Year"] - df["CompetitionOpenSinceYear"])
        + (df["Month"] - df["CompetitionOpenSinceMonth"])
    ).clip(lower=0, upper=24)
    df.loc[unknown_comp, "CompetitionOpenMonths"] = 0
    df["CompetitionKnown"] = (~unknown_comp).astype(int)

    month_str = df["Month"].map(MONTH_NAMES)
    started = (df["Year"] > df["Promo2SinceYear"]) | (
        (df["Year"] == df["Promo2SinceYear"]) & (df["WeekOfYear"] >= df["Promo2SinceWeek"])
    )
    in_interval = np.array([m in iv.split(",") for m, iv in zip(month_str, df["PromoInterval"])])
    df["IsPromo2Active"] = ((df["Promo2"] == 1) & started & in_interval).astype(int)

    for col, mapping in MAPS.items():
        df[col] = df[col].map(mapping)
    df["PromoInterval"] = df["PromoInterval"].map(PROMO_MAP)

    unmapped = df[list(MAPS) + ["PromoInterval"]].isna().sum()
    if unmapped.sum() > 0:
        raise ValueError(f"Unexpected category values (NaN after mapping):\n{unmapped}")
    return df


def store_aggregates(fit_df):
    return (
        fit_df.groupby("Store")
        .agg(store_mean_log_sales=("Sales_log", "mean"),
             store_median_log_sales=("Sales_log", "median"),
             store_mean_customers=("Customers", "mean"))
        .reset_index()
    )


# ---------------------------------------------------------------------------
# Model helpers
# ---------------------------------------------------------------------------
def make_params(lr, n_estimators):
    return dict(n_estimators=n_estimators, learning_rate=lr, num_leaves=127,
                subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                random_state=42, metric="None", verbose=-1)


def inverse_sq_weights(sales):
    w = 1.0 / (np.asarray(sales, dtype=float) ** 2)
    return w / w.mean()


def fit_a(params, tr, va=None):
    model = lgb.LGBMRegressor(**params)
    kwargs = dict(categorical_feature=CAT_FEATS)
    if va is not None:
        kwargs.update(eval_set=[(va[BASE_FEATS], va["Sales_log"])], eval_metric=rmspe_eval_log,
                      callbacks=[lgb.early_stopping(100), lgb.log_evaluation(500)])
    model.fit(tr[BASE_FEATS], tr["Sales_log"], **kwargs)
    return model


def fit_b(params, tr, va=None):
    model = lgb.LGBMRegressor(**params)
    kwargs = dict(categorical_feature=CAT_FEATS, sample_weight=inverse_sq_weights(tr["Sales"]))
    if va is not None:
        kwargs.update(eval_set=[(va[BASE_FEATS], va["Sales"])], eval_metric=rmspe_eval_raw,
                      callbacks=[lgb.early_stopping(100), lgb.log_evaluation(500)])
    model.fit(tr[BASE_FEATS], tr["Sales"], **kwargs)
    return model


def predict_a(model, df):
    return np.expm1(model.predict(df[BASE_FEATS]))


def predict_b(model, df):
    return model.predict(df[BASE_FEATS])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=None, help="folder with train.csv, test.csv, store.csv")
    ap.add_argument("--out", default="submission.csv")
    ap.add_argument("--lr", type=float, default=0.05)
    ap.add_argument("--max-rounds", type=int, default=5000)
    ap.add_argument("--iters-a", type=int, default=None, help="skip validation: iterations for model A")
    ap.add_argument("--iters-b", type=int, default=None, help="skip validation: iterations for model B")
    ap.add_argument("--w-b", type=float, default=None, help="blend weight of model B (0..1); default: best on validation")
    args = ap.parse_args()

    if args.data:
        path = args.data
    else:
        import kagglehub
        path = kagglehub.competition_download("rossmann-store-sales")

    train_raw = pd.read_csv(os.path.join(path, "train.csv"), low_memory=False)
    test_raw = pd.read_csv(os.path.join(path, "test.csv"), low_memory=False)
    store = pd.read_csv(os.path.join(path, "store.csv"))
    comp_median = store["CompetitionDistance"].median()

    # ---- train: drop closed days / zero sales, build features ----
    train_raw = train_raw[(train_raw["Open"] != 0) & (train_raw["Sales"] > 0)].reset_index(drop=True)
    train = prep(train_raw, store, comp_median)
    train["Sales_log"] = np.log1p(train["Sales"])
    print(f"Train rows after cleaning: {len(train):,}")

    best_w = None
    # ---- Step 1: validation on the last 48 days -> best iterations ----
    if args.iters_a is None or args.iters_b is None:
        split_date = train["Date"].max() - pd.Timedelta(days=48)
        tr_part = train[train["Date"] <= split_date].copy()
        va_part = train[train["Date"] > split_date].copy()
        aggs = store_aggregates(tr_part)
        tr_part = tr_part.merge(aggs, on="Store", how="left")
        va_part = va_part.merge(aggs, on="Store", how="left")

        print("\n--- Validation: model A (log target) ---")
        model_a = fit_a(make_params(args.lr, args.max_rounds), tr_part, va_part)
        print("\n--- Validation: model B (raw target, 1/Sales^2 weights) ---")
        model_b = fit_b(make_params(args.lr, args.max_rounds), tr_part, va_part)

        y = va_part["Sales"].values
        pa, pb = predict_a(model_a, va_part), predict_b(model_b, va_part)
        clean = ~va_part["Store"].isin(EVENT_STORES).values
        grid = []
        for w in np.round(np.arange(0, 1.01, 0.1), 1):
            p = (1 - w) * pa + w * pb
            grid.append({"w_B": w, "RMSPE_all": rmspe(y, p),
                         "RMSPE_excl_event_stores": rmspe(y[clean], p[clean])})
        grid = pd.DataFrame(grid)
        print("\n=== Validation: blend weight grid (w_B=0 is model A only, 1 is model B only) ===")
        print(grid.round(5).to_string(index=False))
        best_w = float(grid.loc[grid["RMSPE_excl_event_stores"].idxmin(), "w_B"])
        iters_a, iters_b = model_a.best_iteration_, model_b.best_iteration_
        print(f"best iterations: A={iters_a}, B={iters_b} | best blend weight on clean metric: w_B={best_w}")
    else:
        iters_a, iters_b = args.iters_a, args.iters_b

    # ---- Step 2: refit on ALL training data, aggregates from the full data ----
    aggs_full = store_aggregates(train)
    train_full = train.merge(aggs_full, on="Store", how="left")

    test = test_raw.copy()
    test["Open"] = test["Open"].fillna(1).astype(int)   # missing Open (store 622) -> assume open
    test = prep(test, store, comp_median)
    test = test.merge(aggs_full, on="Store", how="left")
    if test[BASE_FEATS].isna().sum().sum() > 0:
        print("WARNING: NaNs in test features (LightGBM handles them):")
        print(test[BASE_FEATS].isna().sum()[lambda s: s > 0])

    if args.w_b is not None:
        w_b = args.w_b
    elif best_w is not None:
        w_b = best_w
    else:
        w_b = 0.5
        print("No validation run and no --w-b given: using a 50/50 blend")
    print(f"\nBlend weight for model B: {w_b} (model A gets {round(1 - w_b, 2)})")

    n_a, n_b = max(50, int(iters_a * 1.1)), max(50, int(iters_b * 1.1))  # a bit more data -> a bit more rounds
    pred_a = np.full(len(test), np.nan)
    pred_b = np.full(len(test), np.nan)
    if w_b < 1.0:
        print(f"\n--- Final fit on full data: model A, {n_a} rounds ---")
        pred_a = predict_a(fit_a(make_params(args.lr, n_a), train_full), test)
    if w_b > 0.0:
        print(f"\n--- Final fit on full data: model B, {n_b} rounds ---")
        pred_b = predict_b(fit_b(make_params(args.lr, n_b), train_full), test)

    pd.DataFrame({"Id": test["Id"].values, "Open": test["Open"].values,
                  "pred_A": pred_a, "pred_B": pred_b}).sort_values("Id").to_csv(
        "test_preds_by_model.csv", index=False)   # re-blend by hand without refitting

    pred = (1 - w_b) * np.nan_to_num(pred_a) + w_b * np.nan_to_num(pred_b)
    pred = np.clip(pred, 0, None)
    pred[test["Open"].values == 0] = 0.0   # closed days -> 0

    sub = pd.DataFrame({"Id": test["Id"].values, "Sales": pred}).sort_values("Id")
    sub.to_csv(args.out, index=False)

    # ---- sanity checks ----
    open_pred = sub.loc[test.set_index("Id").loc[sub["Id"], "Open"].values == 1, "Sales"]
    print(f"\nSaved {os.path.abspath(args.out)}")
    print(f"rows: {len(sub):,} (test rows: {len(test_raw):,}) | NaN: {int(sub['Sales'].isna().sum())} "
          f"| duplicate Ids: {int(sub['Id'].duplicated().sum())}")
    print(f"closed days predicted 0: {int((test['Open'] == 0).sum()):,}")
    print(f"mean predicted sales on open days: {open_pred.mean():,.0f} "
          f"(train mean: {train['Sales'].mean():,.0f})")


if __name__ == "__main__":
    main()
