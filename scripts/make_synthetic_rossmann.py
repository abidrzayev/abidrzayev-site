#!/usr/bin/env python3
"""
make_synthetic_rossmann.py -- builds a tiny SYNTHETIC dataset with the same file layout as the Kaggle data
(train.csv, test.csv, store.csv). It exists so that
  * the export script and the site can be tested without the real data, and
  * the JSON files shipped in data/ can be regenerated (they are labelled "synthetic-sample").

It contains made-up numbers only. Store ids 292, 782 and 909 get artificial events (spike/closure/dip) so the
"exception stores" view has something to show in sample mode.

Usage: python scripts/make_synthetic_rossmann.py --out some/folder [--seed 0]
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(a.seed)

    ids = list(range(1, 58)) + [292, 782, 909]
    n = len(ids)
    stores = pd.DataFrame({
        "Store": ids,
        "StoreType": rng.choice(list("abcd"), n, p=[.55, .05, .15, .25]),
        "Assortment": rng.choice(list("abc"), n, p=[.5, .05, .45]),
        "CompetitionDistance": rng.integers(100, 20000, n).astype(float),
        "CompetitionOpenSinceMonth": rng.integers(1, 13, n).astype(float),
        "CompetitionOpenSinceYear": rng.integers(2005, 2014, n).astype(float),
        "Promo2": rng.integers(0, 2, n),
    })
    stores["Promo2SinceWeek"] = np.where(stores.Promo2 == 1, rng.integers(1, 50, n), np.nan)
    stores["Promo2SinceYear"] = np.where(stores.Promo2 == 1, rng.integers(2009, 2014, n), np.nan)
    stores["PromoInterval"] = np.where(
        stores.Promo2 == 1, rng.choice(["Jan,Apr,Jul,Oct", "Feb,May,Aug,Nov", "Mar,Jun,Sept,Dec"], n), None)
    stores.loc[[3, 7], "CompetitionDistance"] = np.nan
    stores.loc[[2, 5], ["CompetitionOpenSinceMonth", "CompetitionOpenSinceYear"]] = np.nan
    stores.to_csv(out / "store.csv", index=False)

    level = pd.Series(rng.lognormal(np.log(6000), 0.35, n), index=ids)
    dow_f = {1: 1.12, 2: 1.00, 3: 0.97, 4: 1.00, 5: 1.08, 6: 0.88, 7: 1.0}

    def frame(dates, with_sales):
        df = pd.MultiIndex.from_product([ids, dates], names=["Store", "Date"]).to_frame(index=False)
        df["DayOfWeek"] = df.Date.dt.dayofweek + 1
        df["Promo"] = ((df.DayOfWeek <= 5) & (rng.random(len(df)) < 0.45)).astype(int)
        df["Open"] = (df.DayOfWeek != 7).astype(int)
        df["StateHoliday"] = np.where(rng.random(len(df)) < 0.01, "a", "0")
        df["SchoolHoliday"] = (rng.random(len(df)) < 0.2).astype(int)
        if with_sales:
            doy = df.Date.dt.dayofyear
            season = 1 + 0.06 * np.sin(2 * np.pi * (doy - 80) / 365) + np.where(doy > 330, 0.10, 0)
            s = (df.Store.map(level) * df.DayOfWeek.map(dow_f) * (1 + 0.28 * df.Promo) * season
                 * rng.lognormal(0, 0.09, len(df)))
            df["Sales"] = np.where(df.Open == 1, s, 0).round().astype(int)
            # artificial events (synthetic!)
            d = df.Date
            m = (df.Store == 292) & (d >= "2015-06-29") & (d <= "2015-07-05"); df.loc[m, "Sales"] = (df.loc[m, "Sales"] * 2.4).round().astype(int)
            m = (df.Store == 292) & (d >= "2015-07-06") & (d <= "2015-07-12"); df.loc[m, "Sales"] = (df.loc[m, "Sales"] * 0.55).round().astype(int)
            m = (df.Store == 909) & (d >= "2015-07-06") & (d <= "2015-07-19"); df.loc[m, ["Sales", "Open"]] = 0
            m = (df.Store == 782) & (d >= "2015-06-22") & (d <= "2015-06-28"); df.loc[m, "Sales"] = (df.loc[m, "Sales"] * 0.55).round().astype(int)
            df["Customers"] = (df.Sales / 9 * rng.uniform(0.9, 1.1, len(df))).round().astype(int)
            df.loc[rng.random(len(df)) < 0.002, "Sales"] = 0   # a few open days with zero sales (dropped by the pipeline)
        return df

    train = frame(pd.date_range("2013-01-01", "2015-07-31"), True)
    train[["Store", "DayOfWeek", "Date", "Sales", "Customers", "Open", "Promo", "StateHoliday", "SchoolHoliday"]].to_csv(out / "train.csv", index=False)

    test = frame(pd.date_range("2015-08-01", "2015-09-17"), False)
    test.insert(0, "Id", np.arange(1, len(test) + 1))
    test = test[["Id", "Store", "DayOfWeek", "Date", "Open", "Promo", "StateHoliday", "SchoolHoliday"]].astype({"Open": float})
    test.loc[test.index[:3], "Open"] = np.nan
    test.sample(frac=1, random_state=1).to_csv(out / "test.csv", index=False)
    print(f"synthetic data written to {out}: train {len(train):,} rows, test {len(test):,} rows, {n} stores")


if __name__ == "__main__":
    main()
