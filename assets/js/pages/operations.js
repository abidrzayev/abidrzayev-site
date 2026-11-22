/* operations.js – Project 4. Reproducible Monte Carlo (fixed seed 42, N = 20,000 orders); every parameter is an
   illustrative assumption. Maths lives in assets/js/calc.js (unit-tested). */
(function () {
  "use strict";
  var t = Site.t, F = Charts.fmt, P = Charts.P, C = Calc;
  var N = 20000, SEED = 42, BIN = 4, MAXH = 120;

  var BASE = [
    { key: "proc", ES: 0.2, cv: 0.6, c: 4,  queue: true,  phase: "pre" },
    { key: "pick", ES: 1.0, cv: 0.7, c: 12, queue: true,  phase: "pre" },
    { key: "pack", ES: 0.5, cv: 0.6, c: 8,  queue: true,  phase: "pre" },
    { key: "hand", ES: 0.25, cv: 0.5, c: 4, queue: true,  phase: "pre" },
    { key: "haul", ES: 24,  cv: 0.5, c: 1,  queue: false, phase: "transit" },
    { key: "last", ES: 6,   cv: 0.8, c: 1,  queue: false, phase: "transit" }
  ];
  function stages(v) {
    return BASE.map(function (s) {
      var o = Object.assign({}, s);
      if (s.key === "pick") o.c = v.pick;
      if (s.key === "pack") o.c = v.pack;
      return o;
    });
  }

  var ctl = Charts.controls("ctl-ops", [
    { id: "vol", label: t("ops.ctl.vol"), min: 0.5, max: 1.5, step: 0.05, value: 1, fmt: function (v) { return "×" + F.dec(v, 2); }, hint: t("ops.ctl.vol.h") },
    { id: "pick", label: t("ops.ctl.pick"), min: 8, max: 20, step: 1, value: 12, fmt: function (v) { return F.int(v); } },
    { id: "pack", label: t("ops.ctl.pack"), min: 5, max: 14, step: 1, value: 8, fmt: function (v) { return F.int(v); } },
    { id: "sla", label: t("ops.ctl.sla"), min: 24, max: 96, step: 4, value: 36, fmt: function (v) { return v + " h"; } }
  ], render);

  var ectl = Charts.controls("ctl-exp", [
    { id: "thr", label: t("ops.e.thr"), min: 0, max: 24, step: 0.5, value: 1, fmt: function (v) { return F.dec(v, 1) + " h"; }, hint: t("ops.e.thr.h") },
    { id: "beta", label: t("ops.e.beta"), min: 0.1, max: 0.7, step: 0.05, value: 0.6, fmt: function (v) { return F.pct(v, 0); }, hint: t("ops.e.beta.h") },
    { id: "cexp", label: t("ops.e.cexp"), min: 1, max: 30, step: 1, value: 6, fmt: function (v) { return F.eur(v); } },
    { id: "pen", label: t("ops.e.pen"), min: 5, max: 100, step: 5, value: 40, fmt: function (v) { return F.eur(v); } }
  ], renderExp);

  var sim = null;
  function simulate() {
    var v = ctl.vals;
    sim = C.ops.simulate(stages(v), 10 * v.vol, N, SEED);
    return sim;
  }

  function render() {
    var v = ctl.vals, s = simulate(), sm = C.ops.summary(s.total, v.sla);
    var k = document.getElementById("ops-kpis"); k.innerHTML = "";
    Charts.kpi(k, F.dec(sm.p50, 1) + " h", t("ops.k.p50"), "", "blue");
    Charts.kpi(k, F.dec(sm.p95, 1) + " h", t("ops.k.p95"), t("ops.k.p95.s"), "");
    Charts.kpi(k, F.pct(sm.withinSla, 1), t("ops.k.sla"), t("ops.k.sla.s").replace("{h}", v.sla), sm.withinSla >= 0.95 ? "good" : "warn");
    Charts.kpi(k, F.dec(sm.mean, 1) + " h", t("ops.k.mean"), "", "");

    var h = C.ops.histogram(s.total, BIN, MAXH), labels = h.map(function (_, i) { return i * BIN; });
    Charts.make("ch-hist", { type: "bar", data: { labels: labels.map(function (x) { return x + "–" + (x + BIN); }),
      datasets: [{ label: t("ops.c.orders"), data: h.map(function (x) { return x / N; }),
        backgroundColor: labels.map(function (x) { return x + BIN <= v.sla ? P.blue : P.red; }), borderRadius: 2, categoryPercentage: 1, barPercentage: 0.95 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return F.pct(c.parsed.y, 1); } } } },
        scales: { x: { title: { display: true, text: t("ops.c.hours") }, ticks: { maxTicksLimit: 12 } }, y: { title: { display: true, text: t("ops.c.share") }, ticks: { callback: function (y) { return F.pct(y, 0); } } } } } });
    document.getElementById("hist-note").textContent = t("ops.hist.note").replace("{h}", v.sla).replace("{p}", F.pct(1 - sm.withinSla, 1));

    var st = s.stats, names = st.map(function (x) { return t("ops.st." + x.key); });
    Charts.make("ch-stage", { type: "bar", data: { labels: names, datasets: [
      { label: t("ops.c.service"), data: st.map(function (x) { return x.service; }), backgroundColor: P.slate },
      { label: t("ops.c.wait"), data: st.map(function (x) { return isFinite(x.wq) ? x.wq : 0; }), backgroundColor: P.amber }] },
      options: { indexAxis: "y", scales: { x: { stacked: true, title: { display: true, text: t("ops.c.hours") } }, y: { stacked: true } },
        plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + F.dec(c.parsed.x, 2) + " h"; } } } } } });

    var q = st.filter(function (x) { return x.phase === "pre"; }).sort(function (a, b) { return b.rho - a.rho; })[0];
    var unstable = st.some(function (x) { return x.unstable; });
    document.getElementById("stage-note").textContent = unstable ? t("ops.st.unstable") : t("ops.st.note").replace("{s}", t("ops.st." + q.key)).replace("{r}", F.pct(q.rho, 0));

    var tb = "<thead><tr><th>" + t("ops.tbl.stage") + "</th><th>ρ</th><th>" + t("ops.c.service") + " (h)</th><th>" + t("ops.c.wait") + " (h)</th><th>" + t("ops.tbl.status") + "</th></tr></thead><tbody>";
    st.forEach(function (x) {
      var base = BASE.filter(function (b) { return b.key === x.key; })[0];
      var status = !base.queue ? "–" : x.unstable ? "<span class='chip sample'>" + t("ops.tbl.unstable") + "</span>" : x.rho > 0.85 ? "<span class='chip model'>" + t("ops.tbl.tight") + "</span>" : t("ops.tbl.ok");
      tb += "<tr><td>" + t("ops.st." + x.key) + "</td><td>" + (base.queue ? F.pct(x.rho, 0) : "–") + "</td><td>" + F.dec(x.service, 2) + "</td><td>" + (base.queue ? F.dec(x.wq, 2) : "–") + "</td><td>" + status + "</td></tr>";
    });
    document.getElementById("tbl-stage").innerHTML = tb + "</tbody>";
    renderExp();
  }

  function renderExp() {
    if (!sim) return;
    var v = ctl.vals, e = ectl.vals;
    var mk = function (thr) { return C.ops.expedite(sim, { sla: v.sla, thr: thr, beta: e.beta, costExp: e.cexp, penalty: e.pen }); };
    var cur = mk(e.thr), none = mk(1e9), all = mk(0), pts = [], best = null, i;
    for (i = 0; i <= 48; i++) {
      var thr = i * 0.5, r = mk(thr);
      pts.push({ x: thr, y: r.costPer1000, b: r.breachRate, e: r.expediteRate });
      if (!best || r.costPer1000 < best.y) best = { x: thr, y: r.costPer1000 };
    }
    var k = document.getElementById("exp-kpis"); k.innerHTML = "";
    Charts.kpi(k, F.pct(cur.expediteRate, 1), t("ops.ek.rate"), t("ops.ek.rate.s"), "blue");
    Charts.kpi(k, F.pct(cur.breachRate, 1), t("ops.ek.breach"), t("ops.ek.breach.s").replace("{b}", F.pct(none.breachRate, 1)), cur.breachRate < none.breachRate ? "good" : "warn");
    Charts.kpi(k, F.eur(cur.costPer1000), t("ops.ek.cost"), t("ops.ek.cost.s"), "");
    Charts.kpi(k, F.eur(none.costPer1000 - cur.costPer1000), t("ops.ek.save"), t("ops.ek.save.s"), none.costPer1000 - cur.costPer1000 > 0 ? "good" : "warn");
    Charts.make("ch-sweep", { type: "line", data: { datasets: [
      { label: t("ops.sw.cost"), data: pts, parsing: false, borderColor: P.blue, backgroundColor: P.blue, pointRadius: 0, borderWidth: 3 },
      { label: t("ops.sw.opt"), data: [best], parsing: false, showLine: false, pointRadius: 7, borderColor: P.green, backgroundColor: P.green },
      { label: t("ops.sw.cur"), data: [{ x: e.thr, y: cur.costPer1000 }], parsing: false, showLine: false, pointRadius: 7, pointStyle: "rectRot", borderColor: P.white, backgroundColor: P.white }] },
      options: { interaction: { mode: "nearest", intersect: false },
        scales: { x: { type: "linear", min: 0, max: 24, title: { display: true, text: t("ops.sw.x") } }, y: { title: { display: true, text: t("ops.sw.y") }, ticks: { callback: function (y) { return F.int(y); } } } },
        plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + F.eur(c.parsed.y); } } } } } });
    document.getElementById("sweep-note").textContent = t("ops.sw.note").replace("{t}", F.dec(best.x, 1)).replace("{c}", F.eur(best.y)).replace("{n}", F.eur(none.costPer1000)).replace("{a}", F.eur(all.costPer1000));
  }

  render();
})();
