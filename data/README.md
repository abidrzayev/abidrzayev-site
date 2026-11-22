# Data files

All files are plain JSON read by the pages in the browser. Nothing here is a raw Kaggle file – only aggregates.

| File | Written by | Used by | `meta.source` |
|---|---|---|---|
| `model_card.json` | by hand (numbers recorded from your own runs and the Kaggle leaderboard) | home, Rossmann | `recorded` |
| `rossmann_dashboard.json` | `scripts/export_rossmann_json.py` | Rossmann page | `real` or `synthetic-sample` |
| `inventory_stores.json` | `scripts/export_rossmann_json.py` | Inventory page | `real` or `synthetic-sample` |

**Sample vs. real.** The files shipped in this folder were generated from a small synthetic data set so the layout can be tested. Pages show a yellow "Sample data" banner whenever `meta.source` is not `real`. Run the export script on the real Kaggle data (see the main README) and the banner disappears.

## `rossmann_dashboard.json`
- `meta` – source, row counts, validation window, model settings
- `validation` – `rmspe_all`, `rmspe_excl_event_stores`, `baseline_store_dow_mean`, `by_weekday[]`, `by_promo[]`
- `history_weekly`, `forecast_weekly` – calendar-complete Monday–Sunday weekly network totals (`week`, `sales`)
- `val_daily_total`, `val_dates` – network actual/predicted per validation day
- `val_by_store` – top 30 stores by sales plus stores 292, 909, 782: dates, actual, predicted, `rmspe`
- `weekday_promo_profile`, `storetype_promo` – mean sales by weekday × promotion and by store type
- `feature_importance` – gain share per feature
- `closed_days` – counts and the checks shown on the page
- `exceptions` – weekly series, `val_rmspe`, `n_val_rows`, `share_sq_err` for stores 292, 909, 782

## `inventory_stores.json`
`meta.trading_days_per_year` plus `stores[]` with `id, type, assortment, mu` (mean daily sales before validation, currency not units), `sigma` (std. dev. of the daily forecast error in validation), `bias`, `n_val`.

## `model_card.json`
Recorded real values (validation, Kaggle, model settings), the feature and loss experiment tables with EN/DE labels, and notes about stores 292/909/782. Edit by hand if you re-run experiments. The feature-experiment rows were run at learning rate 0.1 before the "Sept" spelling fix – the page says so.
