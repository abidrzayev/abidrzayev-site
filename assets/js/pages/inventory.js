/* inventory.js – Project 2. Real: store demand level and forecast-error spread (data/inventory_stores.json,
   from scripts/export_rossmann_json.py). Modeled: lead time, order cycle, holding rate, cost ratio, stockout penalty. */
(function () {
  "use strict";
  var t = Site.t, F = Charts.fmt, P = Charts.P, C = Calc, el = Charts.el;
  var CLS = ["A", "B", "C"], XYZ = ["X", "Y", "Z"];

  Site.loadJSON("data/inventory_stores.json").then(init).catch(function (e) { Site.fail(e, document.getElementById("inv-kpis")); });

  function init(d) {
    Site.banner(document.getElementById("sample-banner"), d.meta.source);
    var stores = d.stores, N = d.meta.trading_days_per_year;
    var mus = stores.map(function (s) { return s.mu; });
    var covs = stores.map(function (s) { return s.sigma / s.mu; });
    var abc = C.inv.abc(mus), cuts = C.inv.xyzCuts(covs), xyz = C.inv.xyz(covs, cuts);
    stores.forEach(function (s, i) { s.abc = abc[i]; s.xyz = xyz[i]; s.cov = covs[i]; });
    var byId = {}; stores.forEach(function (s) { byId[s.id] = s; });

    var st = { csl: 0.95, L: 4, C: 7, h: 0.20, cr: 0.70, p: 0.30, scope: "network", diff: false, pol: { A: 0.98, B: 0.95, C: 0.90 } };

    /* scope selector */
    var sel = document.getElementById("scope");
    sel.appendChild(el("option", { value: "network" }, t("inv.scope.network").replace("{n}", F.int(stores.length))));
    stores.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (s) {
      sel.appendChild(el("option", { value: String(s.id) }, t("inv.scope.store").replace("{n}", s.id).replace("{c}", s.abc + s.xyz)));
    });
    sel.addEventListener("change", function () { st.scope = sel.value; render(); });

    /* sliders */
    Charts.slider("s-csl", function (v) { return F.dec(v, 1) + " %"; }, function (v) { st.csl = v / 100; render(); });
    Charts.slider("s-L", function (v) { return v + " " + t("unit.days"); }, function (v) { st.L = v; render(); });
    Charts.slider("s-C", function (v) { return v + " " + t("unit.days"); }, function (v) { st.C = v; render(); });
    Charts.slider("s-h", function (v) { return v + " %"; }, function (v) { st.h = v / 100; render(); });
    Charts.slider("s-cr", function (v) { return v + " %"; }, function (v) { st.cr = v / 100; render(); });
    Charts.slider("s-p", function (v) { return v + " %"; }, function (v) { st.p = v / 100; render(); });
    document.getElementById("diff").addEventListener("change", function (e) { st.diff = e.target.checked; render(); });
    [["pol-a", "A"], ["pol-b", "B"], ["pol-c", "C"]].forEach(function (x) {
      document.getElementById(x[0]).addEventListener("input", function (e) {
        var v = parseFloat(e.target.value);
        if (v >= 50 && v < 100) { st.pol[x[1]] = v / 100; render(); }
      });
    });

    function params() { return { L: st.L, C: st.C, h: st.h, cr: st.cr, p: st.p, N: N }; }
    function zFor(s, uniform) { return st.diff && !uniform ? C.normInv(st.pol[s.abc]) : C.normInv(st.csl); }

    /* aggregate over a set of stores */
    function aggregate(list, uniform) {
      var a = { ss: 0, hold: 0, stock: 0, lost: 0, mu: 0, sigmaL: 0, byClass: {}, n: list.length };
      list.forEach(function (s) {
        var r = C.inv.perStore(s, Object.assign({ z: zFor(s, uniform) }, params()));
        a.ss += r.ss; a.hold += r.holding; a.stock += r.stockout; a.lost += r.shortCycle * (N / st.C);
        a.mu += s.mu; a.sigmaL += r.sigmaL;
        var k = s.abc + s.xyz; a.byClass[k] = (a.byClass[k] || 0) + r.ss;
      });
      a.total = a.hold + a.stock;
      a.fill = a.mu > 0 ? 1 - a.lost / (a.mu * N) : 1;
      a.days = a.mu > 0 ? a.ss / a.mu : 0;
      return a;
    }

    function render() {
      var list = st.scope === "network" ? stores : [byId[st.scope]];
      var a = aggregate(list, false), u = aggregate(list, true);
      document.getElementById("scope-label").textContent = st.scope === "network" ? t("inv.scope.network").replace("{n}", F.int(stores.length)) : t("inv.scope.store").replace("{n}", st.scope).replace("{c}", list[0].abc + list[0].xyz);
      kpis(a, list);
      costChart(list);
      classChart(a);
      matrix(stores, mus);
      diffNote(list, a, u);
      storeTable(list);
    }

    function kpis(a, list) {
      var h = document.getElementById("inv-kpis"); h.innerHTML = "";
      var zopt = C.inv.optimalZ(params()), cslOpt = C.normCdf(zopt);
      Charts.kpi(h, F.eur(a.ss), t("inv.k.ss"), t("inv.k.ss.s"), "blue");
      Charts.kpi(h, F.dec(a.days, 2) + " " + t("unit.days"), t("inv.k.days"), t("inv.k.days.s"), "");
      Charts.kpi(h, F.pct(a.fill, 2), t("inv.k.fill"), t("inv.k.fill.s"), a.fill < 0.97 ? "warn" : "good");
      Charts.kpi(h, F.eur(a.total), t("inv.k.cost"), t("inv.k.cost.s").replace("{h}", F.eur(a.hold)).replace("{s}", F.eur(a.stock)), "");
      Charts.kpi(h, F.pct(cslOpt, 1), t("inv.k.opt"), t("inv.k.opt.s"), "good");
      if (list.length === 1) {
        var r = C.inv.perStore(list[0], Object.assign({ z: zFor(list[0], false) }, params()));
        Charts.kpi(h, F.eur(r.rop), t("inv.k.rop"), t("inv.k.rop.s"), "");
      }
    }

    function costChart(list) {
      var sumSigmaL = 0; list.forEach(function (s) { sumSigmaL += s.sigma * Math.sqrt(st.L); });
      var pr = params(), pts = [], z0 = C.normInv(0.80), z1 = C.normInv(0.999), n = 70, i;
      for (i = 0; i <= n; i++) {
        var z = z0 + (z1 - z0) * i / n, x = C.normCdf(z) * 100;
        pts.push({ z: z, x: x, hold: sumSigmaL * pr.h * pr.cr * z, stock: sumSigmaL * pr.p * (pr.N / pr.C) * C.normLoss(z) });
      }
      var zc = C.normInv(st.csl), zo = C.inv.optimalZ(pr);
      function tot(z) { return C.inv.costAtZ(z, sumSigmaL, pr); }
      Charts.make("ch-cost", {
        type: "line",
        data: { datasets: [
          { label: t("inv.l.total"), data: pts.map(function (q) { return { x: q.x, y: q.hold + q.stock }; }), borderColor: P.blue, backgroundColor: P.blue, pointRadius: 0, borderWidth: 3, parsing: false },
          { label: t("inv.l.hold"), data: pts.map(function (q) { return { x: q.x, y: q.hold }; }), borderColor: P.amber, backgroundColor: P.amber, pointRadius: 0, borderWidth: 2, parsing: false },
          { label: t("inv.l.stock"), data: pts.map(function (q) { return { x: q.x, y: q.stock }; }), borderColor: P.red, backgroundColor: P.red, pointRadius: 0, borderWidth: 2, parsing: false },
          { label: t("inv.l.chosen"), data: [{ x: C.normCdf(zc) * 100, y: tot(zc) }], showLine: false, pointRadius: 7, pointStyle: "rectRot", borderColor: P.white, backgroundColor: P.white, parsing: false },
          { label: t("inv.l.optimum"), data: [{ x: C.normCdf(zo) * 100, y: tot(zo) }], showLine: false, pointRadius: 7, borderColor: P.green, backgroundColor: P.green, parsing: false }
        ] },
        options: {
          interaction: { mode: "nearest", intersect: false },
          scales: {
            x: { type: "linear", min: 80, max: 100, title: { display: true, text: t("inv.x.csl") }, ticks: { callback: function (v) { return v + " %"; } } },
            y: { beginAtZero: true, title: { display: true, text: t("inv.y.cost") }, ticks: { callback: function (v) { return F.int(v); } } }
          },
          plugins: { tooltip: { callbacks: {
            title: function (it) { return F.dec(it[0].parsed.x, 1) + " %"; },
            label: function (c) { return c.dataset.label + ": " + F.eur(c.parsed.y); } } } }
        }
      });
    }

    function classChart(a) {
      var ds = XYZ.map(function (x, i) {
        return { label: "XYZ = " + x, data: CLS.map(function (c) { return a.byClass[c + x] || 0; }), backgroundColor: [P.green, P.blue, P.violet][i], borderRadius: 3 };
      });
      Charts.make("ch-class", {
        type: "bar",
        data: { labels: CLS.map(function (c) { return t("inv.l.abc").replace("{c}", c); }), datasets: ds },
        options: { scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: t("inv.y.ss") }, ticks: { callback: function (v) { return F.int(v); } } } },
          plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + F.eur(c.parsed.y); } } } } }
      });
    }

    function matrix(all, mu) {
      var total = C.sum(mu), cnt = {}, sh = {};
      all.forEach(function (s) { var k = s.abc + s.xyz; cnt[k] = (cnt[k] || 0) + 1; sh[k] = (sh[k] || 0) + s.mu / total; });
      var h = "<thead><tr><th>" + t("inv.seg.corner") + "</th>" + XYZ.map(function (x) { return "<th style='text-align:center'>" + x + "</th>"; }).join("") + "</tr></thead><tbody>";
      CLS.forEach(function (c) {
        h += "<tr><td><strong>" + c + "</strong></td>";
        XYZ.forEach(function (x) {
          var k = c + x;
          h += "<td class='cellv'><div class='big'>" + F.int(cnt[k] || 0) + "</div><div class='sub'>" + F.pct(sh[k] || 0, 1) + "</div></td>";
        });
        h += "</tr>";
      });
      document.getElementById("tbl-matrix").innerHTML = h + "</tbody>";
      document.getElementById("seg-note").textContent = t("inv.seg.note").replace("{x}", F.dec(cuts[0], 3)).replace("{y}", F.dec(cuts[1], 3));
    }

    function diffNote(list, a, u) {
      var n = document.getElementById("diff-note");
      if (!st.diff) { n.textContent = t("inv.diff.off"); n.className = "muted"; return; }
      var delta = u.ss > 0 ? a.ss / u.ss - 1 : 0;
      n.className = "";
      n.textContent = t("inv.diff.res").replace("{a}", F.eur(a.ss)).replace("{u}", F.eur(u.ss)).replace("{d}", F.pct(delta, 1))
        .replace("{fa}", F.pct(a.fill, 2)).replace("{fu}", F.pct(u.fill, 2));
    }

    function storeTable(list) {
      var rows = list.map(function (s) {
        var r = C.inv.perStore(s, Object.assign({ z: zFor(s, false) }, params()));
        return { s: s, r: r };
      });
      if (list.length > 1) rows.sort(function (x, y) { return y.r.ss - x.r.ss; });
      rows = rows.slice(0, 10);
      var h = "<thead><tr><th>" + t("inv.tbl.store") + "</th><th>" + t("inv.tbl.class") + "</th><th>μ</th><th>σ<sub>e</sub></th><th>CoV</th><th>SS</th><th>" + t("inv.tbl.days") + "</th><th>ROP</th><th>" + t("inv.tbl.fill") + "</th></tr></thead><tbody>";
      rows.forEach(function (x) {
        h += "<tr><td>" + t("ros.sel.storeN").replace("{n}", x.s.id) + "</td><td>" + x.s.abc + x.s.xyz + "</td><td>" + F.int(x.s.mu) + "</td><td>" + F.int(x.s.sigma) + "</td><td>" + F.pct(x.s.cov, 1) + "</td><td>" + F.int(x.r.ss) + "</td><td>" + F.dec(x.r.daysCover, 2) + "</td><td>" + F.int(x.r.rop) + "</td><td>" + F.pct(x.r.fillRate, 2) + "</td></tr>";
      });
      document.getElementById("tbl-stores").innerHTML = h + "</tbody>";
    }

    render();
  }
})();
