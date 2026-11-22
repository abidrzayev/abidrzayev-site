# abidrzayev.com – portfolio and interactive dashboards

Static site: plain HTML, CSS and JavaScript. No backend, no build step, no cookies, no analytics, no CDN (Chart.js is self-hosted). EN/DE switch via `?lang=en|de`.

```
index.html                 home (positioning, 4 project cards, CV link, contact)
projects/rossmann.html     Project 1 – real LightGBM model dashboard
projects/inventory.html    Project 2 – safety stock / service level (real forecast errors + modeled costs)
projects/sourcing.html     Project 3 – scorecard, TCO, Pareto, make-or-buy, dual sourcing (simulated)
projects/operations.html   Project 4 – lead-time Monte Carlo, bottlenecks, SLA, expediting (simulated)
legal/impressum.html, legal/datenschutz.html   templates – fill in the [brackets]
assets/css/style.css  assets/js/{i18n,charts,calc}.js  assets/js/pages/*.js  assets/js/vendor/chart.umd.min.js
data/                      JSON read by the pages (see data/README.md)
scripts/                   solution_final.py, export_rossmann_json.py, make_synthetic_rossmann.py
tests/                     node tests/calc.test.js, node tests/i18n.test.js
CNAME  .nojekyll  404.html
```

## 1. Run locally
Browsers block `fetch()` from `file://`, so use a local server:
```
python -m http.server 8000
```
Open http://localhost:8000 and http://localhost:8000/?lang=de.

## 2. Replace the sample data with the real model output
The JSON files in `data/` are a synthetic sample (yellow banner). Create the real ones:
```
pip install pandas numpy lightgbm scikit-learn
python scripts/solution_final.py --data <folder with train.csv, test.csv, store.csv> --out <output folder>
python scripts/export_rossmann_json.py --data <same data folder> --sub <output folder>/submission.csv
```
This refits the final model B (4,250 rounds, learning rate 0.05, seed 42) on the training split, scores the last 48 days and overwrites `data/rossmann_dashboard.json` and `data/inventory_stores.json` with `meta.source = "real"`. Takes a while on a laptop. The script warns if its validation RMSPE differs from `data/model_card.json` by more than 0.003. Check the Kaggle competition rules before publishing; this site only publishes aggregates.

## 3. Fill in your details
- `assets/js/i18n.js`: brand name (`site.name`), about text (`home.about.p`), and any wording you want to change.
- `index.html`: the contact placeholders `[email@example.com]`, `[LinkedIn URL]`, `[GitHub URL]`, `[City, Country]`; `projects/rossmann.html`: `[GitHub URL]`.
- `legal/impressum.html` and `legal/datenschutz.html`: every `[bracketed]` item. These are templates, not legal advice – have them checked.
- Replace `assets/img/abid.jpg` with your own square photo (at least 600×600 px, under about 200 KB). Keep the file name.
- Projects 3 and 4 use illustrative numbers. Replace the supplier table in `assets/js/pages/sourcing.js` or stage defaults in `assets/js/pages/operations.js` with open data if you have it.

## 4. Test
```
node tests/calc.test.js
node tests/i18n.test.js
```

## 5. Publish on GitHub Pages
1. Create a repository (e.g. `abidrzayev-site`), push all files to `main`.
2. Settings → Pages → Deploy from branch → `main` / root.
3. The `CNAME` file contains `abidrzayev.com`. In Settings → Pages enter the custom domain too.
4. At your DNS provider: `A` records for the apex domain to GitHub Pages' IPs (185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153) and a `CNAME` record `www` → `<your-user>.github.io`. Verify the current values in GitHub's documentation.
5. When the certificate is issued, tick "Enforce HTTPS".
6. Link `https://abidrzayev.com` on your CV.
