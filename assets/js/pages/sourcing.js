/* sourcing.js – Project 3. ALL inputs here are illustrative/simulated (fixed seed), not company data.
   Calculations live in assets/js/calc.js (unit-tested in tests/calc.test.js). */
(function () {
  "use strict";
  var t = Site.t, F = Charts.fmt, P = Charts.P, C = Calc, el = Charts.el;

  /* ---------------- illustrative supplier table (change these to your own case) ---------------- */
  var CRIT = ["price", "quality", "delivery", "lead", "risk", "esg"];
  var SUP = [
    { id: "A", scores: { price: 55, quality: 92, delivery: 95, lead: 95, risk: 85, esg: 80 }, price: 10.80, freight: 0.20, dutyPct: 0,     defectPct: 0.005, leadDays: 7,  payDays: 30, qualCost: 0 },
    { id: "B", scores: { price: 72, quality: 82, delivery: 85, lead: 85, risk: 80, esg: 75 }, price: 10.10, freight: 0.35, dutyPct: 0,     defectPct: 0.010, leadDays: 14, payDays: 45, qualCost: 12000 },
    { id: "C", scores: { price: 95, quality: 55, delivery: 60, lead: 35, risk: 45, esg: 50 }, price: 7.90,  freight: 0.95, dutyPct: 0.04,  defectPct: 0.028, leadDays: 45, payDays: 60, qualCost: 40000 },
    { id: "D", scores: { price: 85, quality: 70, delivery: 72, lead: 70, risk: 65, esg: 68 }, price: 8.70,  freight: 0.55, dutyPct: 0,     defectPct: 0.018, leadDays: 21, payDays: 45, qualCost: 25000 },
    { id: "E", scores: { price: 88, quality: 65, delivery: 68, lead: 55, risk: 55, esg: 60 }, price: 8.40,  freight: 0.70, dutyPct: 0.015, defectPct: 0.020, leadDays: 28, payDays: 60, qualCost: 30000 },
    { id: "F", scores: { price: 65, quality: 88, delivery: 90, lead: 90, risk: 78, esg: 85 }, price: 9.60,  freight: 0.30, dutyPct: 0,     defectPct: 0.007, leadDays: 10, payDays: 60, qualCost: 20000 }
  ];
  var PRESETS = {
    balanced: { price: 5, quality: 5, delivery: 5, lead: 5, risk: 5, esg: 5 },
    cost:     { price: 10, quality: 4, delivery: 3, lead: 3, risk: 3, esg: 2 },
    risk:     { price: 3, quality: 5, delivery: 7, lead: 5, risk: 10, esg: 4 },
    quality:  { price: 3, quality: 10, delivery: 6, lead: 4, risk: 4, esg: 6 }
  };
  var CRIT_COLORS = [P.blue, P.green, P.amber, P.violet, P.red, P.grey];
  function supName(id) { return t("src.sup." + id); }

  /* ---------------- 1. weighted scorecard ---------------- */
  var scoreCtl = Charts.controls("ctl-score", CRIT.map(function (k) {
    return { id: k, label: t("src.crit." + k), min: 0, max: 10, step: 1, value: 5 };
  }), renderScore);
  document.querySelectorAll("#presets button").forEach(function (b) {
    b.addEventListener("click", function () {
      var pr = PRESETS[b.dataset.preset];
      CRIT.forEach(function (k) { scoreCtl.set(k, pr[k]); });
      renderScore(scoreCtl.vals);
    });
  });

  function renderScore() {
    var w = {}; CRIT.forEach(function (k) { w[k] = scoreCtl.vals[k]; });
    var nw = C.src.normWeights(w), res = C.src.scorecard(SUP, w).sort(function (a, b) { return b.score - a.score; });
    Charts.make("ch-score", {
      type: "bar",
      data: {
        labels: res.map(function (r) { return supName(r.id); }),
        datasets: CRIT.map(function (k, i) { return { label: t("src.crit." + k), data: res.map(function (r) { return r.parts[k]; }), backgroundColor: CRIT_COLORS[i] }; })
      },
      options: { indexAxis: "y", scales: { x: { stacked: true, max: 100, title: { display: true, text: t("src.score.x") } }, y: { stacked: true } },
        plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + F.dec(c.parsed.x, 1); }, footer: function (it) { var s = 0; it.forEach(function (x) { s += x.parsed.x; }); return t("src.score.total") + ": " + F.dec(s, 1); } } } } }
    });
    var cheapest = SUP.slice().sort(function (a, b) { return a.price - b.price; })[0];
    document.getElementById("score-note").textContent = t("src.score.note").replace("{top}", supName(res[0].id)).replace("{s}", F.dec(res[0].score, 1)).replace("{cheap}", supName(cheapest.id));
    var h = "<thead><tr><th>" + t("src.tbl.supplier") + "</th>" + CRIT.map(function (k) { return "<th>" + t("src.crit." + k) + "</th>"; }).join("") + "</tr></thead><tbody>";
    SUP.forEach(function (s) { h += "<tr><td>" + supName(s.id) + "</td>" + CRIT.map(function (k) { return "<td>" + s.scores[k] + "</td>"; }).join("") + "</tr>"; });
    h += "<tr class='sel'><td>" + t("src.tbl.weight") + "</td>" + CRIT.map(function (k) { return "<td>" + F.pct(nw[k], 0) + "</td>"; }).join("") + "</tr>";
    document.getElementById("tbl-score").innerHTML = h + "</tbody>";
  }

  /* ---------------- 2. total cost of ownership ---------------- */
  var tcoCtl = Charts.controls("ctl-tco", [
    { id: "volume", label: t("src.tco.vol"), min: 20000, max: 1000000, step: 10000, value: 200000, fmt: function (v) { return F.int(v); } },
    { id: "hold", label: t("src.tco.hold"), min: 5, max: 40, step: 1, value: 20, fmt: function (v) { return v + " %"; }, hint: t("src.tco.hold.h") },
    { id: "cap", label: t("src.tco.cap"), min: 2, max: 15, step: 1, value: 8, fmt: function (v) { return v + " %"; }, hint: t("src.tco.cap.h") },
    { id: "defx", label: t("src.tco.defx"), min: 1, max: 10, step: 0.5, value: 3, fmt: function (v) { return "×" + F.dec(v, 1); }, hint: t("src.tco.defx.h") },
    { id: "safe", label: t("src.tco.safe"), min: 0, max: 30, step: 1, value: 10, fmt: function (v) { return v + " " + t("unit.days"); } },
    { id: "years", label: t("src.tco.years"), min: 1, max: 5, step: 1, value: 3, fmt: function (v) { return v + " " + t("unit.years"); }, hint: t("src.tco.years.h") }
  ], renderTco);
  var TCO_PARTS = [["price", P.slate], ["freight", P.amber], ["duty", P.violet], ["quality", P.red], ["inventory", P.blue], ["qualification", P.grey], ["financing", P.green]];

  function renderTco() {
    var v = tcoCtl.vals, Pm = { holdRate: v.hold / 100, capCost: v.cap / 100, defectMult: v.defx, safetyDays: v.safe, volume: v.volume, years: v.years };
    var rows = SUP.map(function (s) { return { s: s, c: C.src.tco(s, Pm) }; }).sort(function (a, b) { return a.c.total - b.c.total; });
    Charts.make("ch-tco", {
      type: "bar",
      data: { labels: rows.map(function (r) { return supName(r.s.id); }),
        datasets: TCO_PARTS.map(function (p) { return { label: t("src.tco." + p[0]), data: rows.map(function (r) { return r.c[p[0]]; }), backgroundColor: p[1] }; }) },
      options: { scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: t("src.tco.y") }, ticks: { callback: function (x) { return F.dec(x, 1); } } } },
        plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + F.dec(c.parsed.y, 2); }, footer: function (it) { var s = 0; it.forEach(function (x) { s += x.parsed.y; }); return t("src.tco.total") + ": " + F.dec(s, 2); } } } } }
    });
    var best = rows[0].c.total;
    var h = "<thead><tr><th>" + t("src.tbl.supplier") + "</th><th>" + t("src.tco.unitprice") + "</th><th>TCO / " + t("unit.unit") + "</th><th>" + t("src.tco.annual") + "</th><th>Δ</th></tr></thead><tbody>";
    rows.forEach(function (r, i) {
      h += "<tr class='" + (i === 0 ? "sel" : "") + "'><td>" + supName(r.s.id) + "</td><td>" + F.dec(r.s.price, 2) + "</td><td>" + F.dec(r.c.total, 2) + "</td><td>" + F.eur(r.c.total * v.volume) + "</td><td>" + (i === 0 ? "–" : "+" + F.pct(r.c.total / best - 1, 1)) + "</td></tr>";
    });
    document.getElementById("tbl-tco").innerHTML = h + "</tbody>";
  }

  /* ---------------- 3. Pareto spend analysis (simulated spend lines, seed 11) ---------------- */
  var CATS = ["pack", "raw", "comp", "log", "mro", "it"], NSUP = 12;
  var rng = C.rng.mulberry32(11), SPEND = [];
  for (var i = 0; i < 140; i++) {
    SPEND.push({
      item: "Item " + String(i + 1).padStart(3, "0"),
      cat: CATS[Math.floor(rng() * CATS.length)],
      sup: "S" + String(1 + Math.floor(Math.pow(rng(), 1.6) * NSUP)).padStart(2, "0"),
      value: Math.round(C.rng.lognormal(rng, 18000, 2) / 100) * 100
    });
  }
  var paSel = document.getElementById("pa-group");
  paSel.addEventListener("change", renderPareto);

  function renderPareto() {
    var g = paSel.value, map = {};
    SPEND.forEach(function (s) { var k = g === "item" ? s.item : g === "cat" ? t("src.cat." + s.cat) : s.sup; map[k] = (map[k] || 0) + s.value; });
    var items = Object.keys(map).map(function (k) { return { label: k, value: map[k] }; });
    var p = C.src.pareto(items), n = p.sorted.length;
    var h = document.getElementById("pa-kpis"); h.innerHTML = "";
    Charts.kpi(h, F.eur(p.total), t("src.pa.k1"), t("src.pa.k1.s"), "blue");
    Charts.kpi(h, F.int(n), t("src.pa.k2"), "", "");
    Charts.kpi(h, F.int(p.nA), t("src.pa.k3"), t("src.pa.k3.s"), "warn");
    Charts.kpi(h, F.pct(p.nA / n, 0), t("src.pa.k4"), t("src.pa.k4.s").replace("{n}", F.pct(0.8, 0)), "");
    Charts.make("ch-pareto", {
      type: "bar",
      data: { labels: p.sorted.map(function (x) { return x.label; }), datasets: [
        { label: t("src.pa.spend"), data: p.sorted.map(function (x) { return x.value; }), backgroundColor: p.sorted.map(function (x, i) { return i < p.nA ? P.amber : P.slate; }), yAxisID: "y", order: 2, borderRadius: 2 },
        { label: t("src.pa.cum"), type: "line", data: p.cumShare, borderColor: P.blue, backgroundColor: P.blue, pointRadius: 0, borderWidth: 2.5, yAxisID: "y2", order: 1 }
      ] },
      options: { scales: { x: { ticks: { maxTicksLimit: 14, autoSkip: true } },
        y: { title: { display: true, text: t("src.pa.spend") }, ticks: { callback: function (v) { return F.int(v); } } },
        y2: { position: "right", min: 0, max: 1, grid: { drawOnChartArea: false }, ticks: { callback: function (v) { return F.pct(v, 0); } } } },
        plugins: { tooltip: { callbacks: { label: function (c) { return c.datasetIndex === 1 ? c.dataset.label + ": " + F.pct(c.parsed.y, 1) : c.dataset.label + ": " + F.eur(c.parsed.y); } } } } }
    });
  }

  /* ---------------- 4. make vs buy ---------------- */
  var mvbCtl = Charts.controls("ctl-mvb", [
    { id: "vol", label: t("src.mvb.vol"), min: 1000, max: 500000, step: 1000, value: 120000, fmt: function (v) { return F.int(v); } },
    { id: "buy", label: t("src.mvb.buy"), min: 5, max: 20, step: 0.1, value: 10, fmt: function (v) { return F.dec(v, 2); } },
    { id: "var", label: t("src.mvb.var"), min: 3, max: 15, step: 0.1, value: 6.5, fmt: function (v) { return F.dec(v, 2); } },
    { id: "fix", label: t("src.mvb.fix"), min: 50000, max: 1000000, step: 10000, value: 300000, fmt: function (v) { return F.eur(v); } }
  ], renderMvb);

  function renderMvb() {
    var v = mvbCtl.vals, Pm = { fixed: v.fix, varCost: v["var"], buyPrice: v.buy, volume: v.vol };
    var r = C.src.makeVsBuy(Pm), be = r.breakEven, xmax = Math.max(v.vol * 1.6, isFinite(be) ? be * 1.6 : 0, 10000), pts = [], i;
    for (i = 0; i <= 40; i++) {
      var q = xmax * i / 40;
      pts.push({ q: q, make: Pm.fixed + Pm.varCost * q, buy: Pm.buyPrice * q });
    }
    var cur = [{ x: v.vol, y: Math.min(r.makeCost, r.buyCost) }];
    var ds = [
      { label: t("src.mvb.make"), data: pts.map(function (p) { return { x: p.q, y: p.make }; }), borderColor: P.amber, backgroundColor: P.amber, pointRadius: 0, borderWidth: 2.5, parsing: false },
      { label: t("src.mvb.buyc"), data: pts.map(function (p) { return { x: p.q, y: p.buy }; }), borderColor: P.blue, backgroundColor: P.blue, pointRadius: 0, borderWidth: 2.5, parsing: false },
      { label: t("src.mvb.cur"), data: cur, showLine: false, pointRadius: 7, pointStyle: "rectRot", borderColor: P.white, backgroundColor: P.white, parsing: false }
    ];
    if (isFinite(be)) ds.push({ label: t("src.mvb.be"), data: [{ x: be, y: Pm.buyPrice * be }], showLine: false, pointRadius: 7, borderColor: P.green, backgroundColor: P.green, parsing: false });
    Charts.make("ch-mvb", { type: "line", data: { datasets: ds }, options: {
      interaction: { mode: "nearest", intersect: false },
      scales: { x: { type: "linear", title: { display: true, text: t("src.mvb.x") }, ticks: { callback: function (x) { return F.int(x); } } },
        y: { beginAtZero: true, title: { display: true, text: t("src.mvb.y") }, ticks: { callback: function (y) { return F.int(y); } } } },
      plugins: { tooltip: { callbacks: { title: function (it) { return F.int(it[0].parsed.x) + " " + t("unit.units"); }, label: function (c) { return c.dataset.label + ": " + F.eur(c.parsed.y); } } } } } });
    var k = document.getElementById("mvb-kpis"); k.innerHTML = "";
    Charts.kpi(k, isFinite(be) ? F.int(be) : "–", t("src.mvb.k1"), t("src.mvb.k1.s"), "blue");
    Charts.kpi(k, F.eur(r.makeCost), t("src.mvb.k2"), "", "");
    Charts.kpi(k, F.eur(r.buyCost), t("src.mvb.k3"), "", "");
    Charts.kpi(k, F.eur(Math.abs(r.makeCost - r.buyCost)), t("src.mvb.k4"), r.decision === "make" ? t("src.mvb.make.better") : t("src.mvb.buy.better"), r.decision === "make" ? "warn" : "good");
    var lo = C.src.makeVsBuy({ fixed: v.fix, varCost: v["var"], buyPrice: v.buy * 0.9, volume: v.vol }).breakEven;
    var hi = C.src.makeVsBuy({ fixed: v.fix, varCost: v["var"], buyPrice: v.buy * 1.1, volume: v.vol }).breakEven;
    document.getElementById("mvb-note").textContent = isFinite(be)
      ? t("src.mvb.note").replace("{d}", r.decision === "make" ? t("src.mvb.d.make") : t("src.mvb.d.buy")).replace("{lo}", isFinite(lo) ? F.int(lo) : "∞").replace("{hi}", isFinite(hi) ? F.int(hi) : "∞")
      : t("src.mvb.never");
  }

  /* ---------------- 5. dual sourcing ---------------- */
  var dualCtl = Charts.controls("ctl-dual", [
    { id: "vol", label: t("src.d.vol"), min: 50000, max: 1000000, step: 10000, value: 300000, fmt: function (v) { return F.int(v); } },
    { id: "p1", label: t("src.d.p1"), min: 5, max: 20, step: 0.1, value: 10, fmt: function (v) { return F.dec(v, 2); } },
    { id: "prem", label: t("src.d.prem"), min: 0, max: 30, step: 1, value: 8, fmt: function (v) { return v + " %"; } },
    { id: "q", label: t("src.d.q"), min: 0, max: 40, step: 1, value: 15, fmt: function (v) { return v + " %"; }, hint: t("src.d.q.h") },
    { id: "wk", label: t("src.d.wk"), min: 1, max: 26, step: 1, value: 8, fmt: function (v) { return v + " " + t("unit.weeks"); } },
    { id: "kappa", label: t("src.d.kappa"), min: 1, max: 4, step: 0.1, value: 2, fmt: function (v) { return "×" + F.dec(v, 1); }, hint: t("src.d.kappa.h") },
    { id: "loss", label: t("src.d.loss"), min: 1, max: 5, step: 0.5, value: 2.5, fmt: function (v) { return "×" + F.dec(v, 1); }, hint: t("src.d.loss.h") }
  ], renderDual);

  function renderDual() {
    var v = dualCtl.vals, Pm = { volume: v.vol, p1: v.p1, p2Premium: v.prem / 100, q: v.q / 100, weeks: v.wk, kappa: v.kappa, lossMult: v.loss };
    var pts = [], best = null, i;
    for (i = 0; i <= 50; i++) {
      var s = i / 100, r = C.src.dualSourcing(Pm, s);
      pts.push({ s: s, e: r.expected, d: r.disruptionYear });
      if (!best || r.expected < best.e - 1e-9) best = { s: s, e: r.expected, d: r.disruptionYear };
    }
    var single = C.src.dualSourcing(Pm, 0);
    Charts.make("ch-dual", { type: "line", data: { datasets: [
      { label: t("src.d.exp"), data: pts.map(function (p) { return { x: p.s * 100, y: p.e }; }), borderColor: P.blue, backgroundColor: P.blue, pointRadius: 0, borderWidth: 3, parsing: false },
      { label: t("src.d.dis"), data: pts.map(function (p) { return { x: p.s * 100, y: p.d }; }), borderColor: P.red, backgroundColor: P.red, pointRadius: 0, borderWidth: 2, borderDash: [6, 4], parsing: false },
      { label: t("src.d.opt"), data: [{ x: best.s * 100, y: best.e }], showLine: false, pointRadius: 7, borderColor: P.green, backgroundColor: P.green, parsing: false }
    ] }, options: {
      interaction: { mode: "nearest", intersect: false },
      scales: { x: { type: "linear", min: 0, max: 50, title: { display: true, text: t("src.d.x") }, ticks: { callback: function (x) { return x + " %"; } } },
        y: { title: { display: true, text: t("src.d.y") }, ticks: { callback: function (y) { return F.int(y / 1000) + " k"; } } } },
      plugins: { tooltip: { callbacks: { title: function (it) { return F.dec(it[0].parsed.x, 0) + " %"; }, label: function (c) { return c.dataset.label + ": " + F.eur(c.parsed.y); } } } } } });
    var k = document.getElementById("dual-kpis"); k.innerHTML = "";
    Charts.kpi(k, F.pct(best.s, 0), t("src.d.k1"), t("src.d.k1.s"), "good");
    Charts.kpi(k, F.eur(best.e), t("src.d.k2"), "", "");
    Charts.kpi(k, F.eur(single.expected), t("src.d.k3"), t("src.d.k3.s"), "");
    Charts.kpi(k, F.eur(single.expected - best.e), t("src.d.k4"), t("src.d.k4.s"), single.expected - best.e > 0 ? "good" : "warn");
    document.getElementById("dual-note").textContent = best.s === 0 ? t("src.d.note.single") : t("src.d.note.dual").replace("{s}", F.pct(best.s, 0)).replace("{x}", F.eur(single.disruptionYear - best.d));
  }

  renderScore(); renderTco(); renderPareto(); renderMvb(); renderDual();
})();
