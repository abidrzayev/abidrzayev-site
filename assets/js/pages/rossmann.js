/* rossmann.js – Project 1 dashboard. Data: data/model_card.json (recorded real values) and
   data/rossmann_dashboard.json (written by scripts/export_rossmann_json.py). */
(function () {
  "use strict";
  var t = Site.t, F = Charts.fmt, P = Charts.P, el = Charts.el;

  Promise.all([Site.loadJSON("data/model_card.json"), Site.loadJSON("data/rossmann_dashboard.json")])
    .then(function (r) { init(r[0], r[1]); })
    .catch(function (e) { Site.fail(e, document.getElementById("kpis")); });

  function loc(o) { return o && typeof o === "object" ? (o[Site.lang] || o.en) : o; }
  function dowName(i) { return t("dow." + i); }
  function addDays(iso, n) { var d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  function init(card, d) {
    kpis(card);
    Site.banner(document.getElementById("sample-banner"), d.meta.source);
    histForecast(d);
    validation(d);
    weekday(d);
    storeType(d);
    importance(d);
    experiments(card);
    closedDays(card, d);
    exceptions(card, d);
  }

  /* ---- headline numbers (recorded, real) ---- */
  function kpis(card) {
    var h = document.getElementById("kpis"), v = card.validation, k = card.kaggle, m = card.model;
    Charts.kpi(h, F.dec(v.rmspe_all, 5), t("ros.kpi.val"), t("ros.kpi.val.s"), "blue");
    Charts.kpi(h, F.dec(v.rmspe_excl_event_stores, 5), t("ros.kpi.valclean"), t("ros.kpi.valclean.s"), "");
    Charts.kpi(h, F.dec(k.private, 5), t("ros.kpi.priv"), t("ros.kpi.priv.s"), "good");
    Charts.kpi(h, F.dec(k.public, 5), t("ros.kpi.pub"), t("ros.kpi.pub.s"), "");
    Charts.kpi(h, F.dec(v.baseline_store_dow_mean, 5), t("ros.kpi.base"), t("ros.kpi.base.s"), "warn");
    Charts.kpi(h, F.int(k.test_rows), t("ros.kpi.rows"), t("ros.kpi.rows.s"), "");
    Charts.kpi(h, F.int(k.closed_days_set_to_zero), t("ros.kpi.closed"), t("ros.kpi.closed.s"), "");
    Charts.kpi(h, F.int(m.rounds_full_fit), t("ros.kpi.rounds"), t("ros.kpi.rounds.s").replace("{n}", m.n_features), "");
  }

  /* ---- 1. history and six-week forecast ---- */
  function histForecast(d) {
    var hw = d.history_weekly, fw = d.forecast_weekly;
    var first = hw.weeks[0], last = fw.weeks[fw.weeks.length - 1], all = [], cur = first;
    while (cur <= last) { all.push(cur); cur = addDays(cur, 7); }
    var hm = {}, fm = {};
    hw.weeks.forEach(function (w, i) { hm[w] = hw.mean_sales[i]; });
    fw.weeks.forEach(function (w, i) { fm[w] = fw.mean_sales[i]; });
    var hist = all.map(function (w) { return w in hm ? hm[w] : null; });
    var fc = all.map(function (w) { return w in fm ? fm[w] : null; });
    var btns = document.querySelectorAll("#hist-range button");
    function draw(range) {
      var n = range === "all" ? all.length : Math.min(all.length, 52 + fw.weeks.length + 1), s = all.length - n;
      Charts.make("ch-hist", {
        type: "line",
        data: {
          labels: all.slice(s),
          datasets: [
            { label: t("ros.l.hist"), data: hist.slice(s), borderColor: P.blue, backgroundColor: P.blue, borderWidth: 2, pointRadius: 0, tension: .15, spanGaps: false },
            { label: t("ros.l.fc"), data: fc.slice(s), borderColor: P.amber, backgroundColor: P.amber, borderWidth: 2.5, pointRadius: 3, borderDash: [6, 4], tension: .15, spanGaps: false }
          ]
        },
        options: {
          scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { title: { display: true, text: t("ros.y.sales") }, ticks: { callback: function (v) { return F.int(v); } } } },
          plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + F.int(c.parsed.y); } } } }
        }
      });
      btns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.range === range)); });
    }
    btns.forEach(function (b) { b.addEventListener("click", function () { draw(b.dataset.range); }); });
    draw("52");
  }

  /* ---- 2. validation: actual vs predicted ---- */
  function validation(d) {
    var sel = document.getElementById("val-select");
    sel.appendChild(el("option", { value: "all" }, t("ros.sel.all")));
    Object.keys(d.val_by_store).map(Number).sort(function (a, b) { return a - b; }).forEach(function (id) {
      var ev = d.val_by_store[id].is_event_store;
      sel.appendChild(el("option", { value: String(id) }, (ev ? "★ " : "") + t("ros.sel.storeN").replace("{n}", id)));
    });
    function draw() {
      var v = sel.value, labels, act, pred, note;
      if (v === "all") {
        labels = d.val_daily_total.dates; act = d.val_daily_total.actual; pred = d.val_daily_total.predicted;
        note = t("ros.val.note.all").replace("{r}", F.dec(d.validation.rmspe_all, 5)).replace("{n}", F.int(d.meta.val_rows));
      } else {
        var s = d.val_by_store[v]; labels = d.val_dates; act = s.actual; pred = s.predicted;
        note = t("ros.val.note.store").replace("{r}", F.dec(s.rmspe, 4)).replace("{o}", F.dec(d.validation.rmspe_all, 4)) + (s.is_event_store ? " " + t("ros.val.note.event") : "");
      }
      document.getElementById("val-note").textContent = note;
      Charts.make("ch-val", {
        type: "line",
        data: {
          labels: labels,
          datasets: [
            { label: t("ros.l.actual"), data: act, borderColor: P.blue, backgroundColor: P.blue, borderWidth: 2, pointRadius: 2, spanGaps: false },
            { label: t("ros.l.pred"), data: pred, borderColor: P.amber, backgroundColor: P.amber, borderWidth: 2, pointRadius: 2, borderDash: [5, 3], spanGaps: false }
          ]
        },
        options: { scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { title: { display: true, text: v === "all" ? t("ros.y.total") : t("ros.y.sales") }, ticks: { callback: function (x) { return F.int(x); } } } } }
      });
    }
    sel.addEventListener("change", draw);
    draw();
  }

  /* ---- 3. weekday error + weekday x promo ---- */
  function weekday(d) {
    var bw = d.validation.by_weekday.slice().sort(function (a, b) { return a.key - b.key; });
    var labels = bw.map(function (x) { return dowName(x.key); });
    Charts.make("ch-dow", {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          { label: "RMSPE", data: bw.map(function (x) { return x.rmspe; }), backgroundColor: bw.map(function (x) { return x.key === 6 ? P.red : P.blue; }), borderRadius: 4 },
          { label: t("ros.l.overall"), type: "line", data: bw.map(function () { return d.validation.rmspe_all; }), borderColor: P.amber, borderDash: [5, 4], pointRadius: 0, borderWidth: 2 }
        ]
      },
      options: { scales: { y: { beginAtZero: true, ticks: { callback: function (v) { return F.dec(v, 2); } } } },
        plugins: { tooltip: { callbacks: { afterLabel: function (c) { var x = bw[c.dataIndex]; return c.datasetIndex === 0 ? t("ros.tt.rows").replace("{n}", F.int(x.n)) + " · " + t("ros.tt.share").replace("{s}", F.pct(x.share_sq_err, 0)) : ""; } } } } }
    });
    var prof = d.weekday_promo_profile, days = [1, 2, 3, 4, 5, 6, 7];
    function series(promo) { return days.map(function (k) { var r = prof.filter(function (p) { return p.dow === k && p.promo === promo; })[0]; return r ? r.mean : null; }); }
    Charts.make("ch-promo", {
      type: "bar",
      data: { labels: days.map(dowName), datasets: [
        { label: t("ros.l.nopromo"), data: series(0), backgroundColor: P.slate, borderRadius: 4 },
        { label: t("ros.l.promo"), data: series(1), backgroundColor: P.green, borderRadius: 4 }
      ] },
      options: { scales: { y: { beginAtZero: true, ticks: { callback: function (v) { return F.int(v); } } } } }
    });
  }

  /* ---- 4. promotion uplift by store type ---- */
  function storeType(d) {
    var rows = {};
    d.storetype_promo.forEach(function (r) { (rows[r.store_type] = rows[r.store_type] || {})[r.promo] = r.mean; });
    var h = "<thead><tr><th>" + t("ros.tbl.type") + "</th><th>" + t("ros.l.nopromo") + "</th><th>" + t("ros.l.promo") + "</th><th>" + t("ros.tbl.uplift") + "</th></tr></thead><tbody>";
    Object.keys(rows).sort().forEach(function (k) {
      var a = rows[k][0], b = rows[k][1];
      h += "<tr><td>" + t("ros.type").replace("{k}", k.toUpperCase()) + "</td><td>" + F.int(a) + "</td><td>" + F.int(b) + "</td><td>" + (a && b ? F.pct(b / a - 1, 0) : "–") + "</td></tr>";
    });
    document.getElementById("tbl-type").innerHTML = h + "</tbody>";
  }

  /* ---- 5. feature importance ---- */
  function importance(d) {
    var top = d.feature_importance.slice(0, 12);
    Charts.make("ch-imp", {
      type: "bar",
      data: { labels: top.map(function (x) { return x.feature; }), datasets: [{ label: t("ros.l.gain"), data: top.map(function (x) { return x.gain_share; }), backgroundColor: P.violet, borderRadius: 3 }] },
      options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return F.pct(c.parsed.x, 1); } } } },
        scales: { x: { ticks: { callback: function (v) { return F.pct(v, 0); } } } } }
    });
  }

  /* ---- 6. experiment log ---- */
  function expTable(id, rows, withNote) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.rmspe; }));
    var h = "<thead><tr><th>" + t("ros.tbl.exp") + "</th><th>RMSPE</th><th>" + t("ros.tbl.iter") + "</th></tr></thead><tbody>";
    rows.forEach(function (r) {
      var lbl = loc(r.label) + (r.note ? "<br><small class='muted'>" + loc(r.note) + "</small>" : "");
      h += "<tr class='" + (r.selected ? "sel" : "") + "'><td>" + lbl + (r.selected ? " ✓" : "") + "</td><td class='bar-cell'><div class='bar' style='width:" + (r.rmspe / max * 100).toFixed(0) + "%'></div><span>" + F.dec(r.rmspe, 5) + "</span></td><td>" + (r.best_iter ? F.int(r.best_iter) : "–") + "</td></tr>";
    });
    document.getElementById(id).innerHTML = h + "</tbody>";
  }
  function experiments(card) {
    document.getElementById("feat-note").textContent = loc(card.feature_experiments.note);
    document.getElementById("loss-note").textContent = loc(card.loss_experiments.note);
    expTable("tbl-feat", card.feature_experiments.rows);
    var le = card.loss_experiments;
    var rows = le.lr_0_1.map(function (r) { return { label: { en: "lr 0.1 · " + r.label.en, de: "LR 0,1 · " + r.label.de }, rmspe: r.rmspe, best_iter: r.best_iter }; })
      .concat(le.lr_0_05.map(function (r) { return { label: { en: "lr 0.05 · " + r.label.en, de: "LR 0,05 · " + r.label.de }, rmspe: r.rmspe, best_iter: r.best_iter, selected: r.selected }; }));
    expTable("tbl-loss", rows);
    var g = le.blend_grid;
    Charts.make("ch-blend", {
      type: "line",
      data: { labels: g.map(function (x) { return F.int(x[0] * 100) + " %"; }), datasets: [
        { label: t("ros.l.allrows"), data: g.map(function (x) { return x[1]; }), borderColor: P.blue, backgroundColor: P.blue, pointRadius: 3, borderWidth: 2 },
        { label: t("ros.l.excl3"), data: g.map(function (x) { return x[2]; }), borderColor: P.green, backgroundColor: P.green, pointRadius: 3, borderWidth: 2 }
      ] },
      options: { scales: { x: { title: { display: true, text: t("ros.x.wb") } }, y: { ticks: { callback: function (v) { return F.dec(v, 3); } } } } }
    });
  }

  /* ---- 7. closed days ---- */
  function closedDays(card, d) {
    var c = d.closed_days, h = document.getElementById("closed-kpis");
    Charts.kpi(h, F.int(c.train_closed_rows), t("ros.closed.k1"), t("ros.closed.k1.s"), "");
    Charts.kpi(h, F.int(c.train_open_zero_sales_rows), t("ros.closed.k2"), t("ros.closed.k2.s"), "");
    Charts.kpi(h, F.int(c.test_closed_rows), t("ros.closed.k3"), c.closed_predictions_all_zero ? t("ros.closed.k3.ok") : t("ros.closed.k3.bad"), c.closed_predictions_all_zero ? "good" : "bad");
    Charts.kpi(h, F.int(c.test_open_pred_mean) + " / " + F.int(c.train_open_mean), t("ros.closed.k4"), t("ros.closed.k4.s"), "");
  }

  /* ---- 8. exception stores ---- */
  function exceptions(card, d) {
    var ids = Object.keys(d.exceptions), real = d.meta.source === "real";
    document.getElementById("exc-summary").textContent = loc(card.exception_notes.summary);
    var tabs = document.getElementById("exc-tabs");
    if (!ids.length) { tabs.textContent = t("ros.exc.none"); return; }
    function draw(id) {
      var e = d.exceptions[id];
      tabs.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.id === id)); });
      Charts.make("ch-exc", {
        type: "line",
        data: { labels: e.weeks, datasets: [
          { label: t("ros.l.actual"), data: e.actual, borderColor: P.blue, backgroundColor: P.blue, borderWidth: 2, pointRadius: 3, spanGaps: false },
          { label: t("ros.l.pred"), data: e.predicted, borderColor: P.amber, backgroundColor: P.amber, borderWidth: 2, pointRadius: 3, borderDash: [5, 3], spanGaps: false }
        ] },
        options: { scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { title: { display: true, text: t("ros.y.sales") }, ticks: { callback: function (v) { return F.int(v); } } } },
          plugins: { tooltip: { callbacks: { afterBody: function (it) { var i = it[0].dataIndex; return t("ros.exc.opendays").replace("{n}", e.n_open_days[i]); } } } } }
      });
      var k = document.getElementById("exc-kpis"); k.innerHTML = "";
      Charts.kpi(k, F.dec(e.val_rmspe, 3), t("ros.exc.k1"), t("ros.exc.k1.s").replace("{o}", F.dec(d.validation.rmspe_all, 3)), "warn");
      Charts.kpi(k, F.int(e.n_val_rows), t("ros.exc.k2"), "", "");
      Charts.kpi(k, F.pct(e.share_sq_err, 1), t("ros.exc.k3"), "", "");
      var note = document.getElementById("exc-note");
      note.className = real ? "" : "muted";
      note.textContent = real ? loc(card.exception_notes.stores[id]) : t("ros.exc.samplenote");
    }
    ids.sort(function (a, b) { return a - b; }).forEach(function (id) {
      var b = el("button", { class: "btn small", "data-id": id, "aria-pressed": "false" }, t("ros.sel.storeN").replace("{n}", id));
      b.addEventListener("click", function () { draw(id); });
      tabs.appendChild(b);
    });
    draw(ids[0]);
  }
})();
