/* charts.js – Chart.js theme + helpers (Chart.js is self-hosted in assets/js/vendor). */
(function () {
  "use strict";
  var P = { blue: "#38bdf8", green: "#34d399", amber: "#fbbf24", red: "#f87171", violet: "#a78bfa", grey: "#94a3b8", slate: "#64748b", white: "#e6edf7" };
  var reg = {};

  function merge(a, b) {
    for (var k in b) {
      if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) a[k] = merge(a[k] && typeof a[k] === "object" ? a[k] : {}, b[k]);
      else a[k] = b[k];
    }
    return a;
  }

  function setup() {
    if (typeof Chart === "undefined" || setup.done) return;
    setup.done = true;
    Chart.defaults.color = "#9fb0cb";
    Chart.defaults.borderColor = "rgba(148,163,184,.18)";
    Chart.defaults.font.family = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.animation.duration = 250;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.tooltip.backgroundColor = "rgba(15,23,42,.96)";
    Chart.defaults.plugins.tooltip.borderColor = "#2a3a5c";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
  }

  function make(id, cfg) {
    setup();
    var el = document.getElementById(id);
    if (!el || typeof Chart === "undefined") return null;
    if (reg[id]) reg[id].destroy();
    cfg.options = merge({
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } }
    }, cfg.options || {});
    reg[id] = new Chart(el, cfg);
    return reg[id];
  }

  function nf(opts) { return new Intl.NumberFormat(window.Site ? Site.locale : "en-GB", opts); }
  var fmt = {
    int: function (x) { return x == null ? "–" : nf({ maximumFractionDigits: 0 }).format(x); },
    dec: function (x, d) { d = d == null ? 2 : d; return x == null || !isFinite(x) ? "–" : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(x); },
    pct: function (x, d) { d = d == null ? 1 : d; return x == null || !isFinite(x) ? "–" : nf({ style: "percent", minimumFractionDigits: d, maximumFractionDigits: d }).format(x); },
    eur: function (x, d) { d = d == null ? 0 : d; return x == null || !isFinite(x) ? "–" : nf({ style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d }).format(x); },
    rm: function (x) { return x == null ? "–" : nf({ minimumFractionDigits: 5, maximumFractionDigits: 5 }).format(x); }
  };

  /* small DOM helpers shared by the page scripts */
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  }
  function kpi(host, value, label, sub, cls) {
    var d = el("div", { class: "kpi " + (cls || "") });
    d.appendChild(el("div", { class: "v" }, value));
    d.appendChild(el("div", { class: "l" }, label));
    if (sub) d.appendChild(el("div", { class: "s" }, sub));
    host.appendChild(d);
    return d;
  }
  /* bind a range input to an output element; calls cb(value) on input */
  function slider(id, fmtFn, cb) {
    var inp = document.getElementById(id), out = document.getElementById(id + "-out");
    function show() { var v = parseFloat(inp.value); if (out) out.textContent = fmtFn ? fmtFn(v) : v; return v; }
    inp.addEventListener("input", function () { cb(show()); });
    show(); // initial label only; the page calls its own render() once
    return inp;
  }

  /* build a group of range sliders from specs: [{id,label,hint,min,max,step,value,fmt}].
     Returns {vals, set(id,value)}; onChange(vals) fires on every input. */
  function controls(hostId, specs, onChange) {
    var host = document.getElementById(hostId), vals = {}, inputs = {}, shows = {};
    specs.forEach(function (s) {
      vals[s.id] = s.value;
      var wrap = el("div", { class: "ctl" });
      var lab = el("label", { "for": "c-" + hostId + "-" + s.id });
      lab.appendChild(el("span", null, s.label));
      var out = el("output", null, "");
      lab.appendChild(out);
      var inp = el("input", { type: "range", id: "c-" + hostId + "-" + s.id, min: s.min, max: s.max, step: s.step, value: s.value });
      function show() { var v = parseFloat(inp.value); vals[s.id] = v; out.textContent = s.fmt ? s.fmt(v) : v; return v; }
      inp.addEventListener("input", function () { show(); onChange(vals); });
      wrap.appendChild(lab); wrap.appendChild(inp);
      if (s.hint) wrap.appendChild(el("div", { class: "hint" }, s.hint));
      host.appendChild(wrap);
      inputs[s.id] = inp; shows[s.id] = show; show();
    });
    return { vals: vals, set: function (id, v) { inputs[id].value = v; shows[id](); } };
  }

  window.Charts = { P: P, make: make, fmt: fmt, el: el, kpi: kpi, slider: slider, controls: controls, merge: merge };
})();
