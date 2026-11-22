/* calc.js – pure calculation helpers. Browser: window.Calc. Node: module.exports (see tests/). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- normal distribution ---------- */
  function erfc(x) { // Numerical Recipes erfcc, fractional error < 1.2e-7
    var z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  function normCdf(z) { return 0.5 * erfc(-z / Math.SQRT2); }
  function normPdf(z) { return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI); }
  function normLoss(z) { return normPdf(z) - z * (1 - normCdf(z)); } // standard normal loss function L(z)
  function normInv(p) { // Acklam's algorithm + one Halley step
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pl = 0.02425, ph = 1 - pl, q, r, x;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= ph) {
      q = p - 0.5; r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    var e = normCdf(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  /* ---------- small stats ---------- */
  function quantile(sortedAsc, q) {
    if (!sortedAsc.length) return NaN;
    var pos = (sortedAsc.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
  }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }

  /* ---------- inventory: continuous review (s, Q), normal demand over lead time ----------
     P: {z, L (trading days), C (order cycle, trading days), h (annual holding rate),
         cr (cost/sales ratio), p (stockout penalty, share of lost sales value), N (trading days per year)}
     s: {mu (sales per trading day), sigma (std dev of daily forecast error)}                        */
  var inv = {
    perStore: function (s, P) {
      var sigmaL = s.sigma * Math.sqrt(P.L);
      var ss = P.z * sigmaL;
      var Q = s.mu * P.C;
      var shortCycle = sigmaL * normLoss(P.z);          // expected units short per order cycle
      var holding = P.h * P.cr * ss;                     // annual cost of holding the safety stock (valued at cost)
      var stockout = P.p * (P.N / P.C) * shortCycle;     // annual penalty on expected lost sales
      return {
        sigmaL: sigmaL, ss: ss, rop: s.mu * P.L + ss, Q: Q, shortCycle: shortCycle,
        csl: normCdf(P.z), fillRate: Q > 0 ? Math.max(0, 1 - shortCycle / Q) : 1,
        holding: holding, stockout: stockout, total: holding + stockout, daysCover: s.mu > 0 ? ss / s.mu : 0
      };
    },
    /* cost-minimising z:  1 - Phi(z*) = h*cr*C / (p*N)  (clamped at z >= 0) */
    optimalZ: function (P) {
      var r = P.h * P.cr * P.C / (P.p * P.N);
      if (r >= 0.5) return 0;
      return Math.max(0, normInv(1 - r));
    },
    /* total annual cost curve of a scope with total sigmaL = sumSigmaL */
    costAtZ: function (z, sumSigmaL, P) {
      return sumSigmaL * (P.h * P.cr * z + P.p * (P.N / P.C) * normLoss(z));
    },
    abc: function (mus, cuts) { // classes in input order; A = items needed to reach cuts[0] of total, B up to cuts[1]
      cuts = cuts || [0.8, 0.95];
      var idx = mus.map(function (_, i) { return i; }).sort(function (a, b) { return mus[b] - mus[a]; });
      var total = sum(mus), cum = 0, out = new Array(mus.length);
      idx.forEach(function (i) {
        var before = total > 0 ? cum / total : 0;
        out[i] = before < cuts[0] ? "A" : before < cuts[1] ? "B" : "C";
        cum += mus[i];
      });
      return out;
    },
    xyzCuts: function (covs) { // tertiles of the forecast-error CoV
      var s = covs.slice().sort(function (a, b) { return a - b; });
      return [quantile(s, 1 / 3), quantile(s, 2 / 3)];
    },
    xyz: function (covs, cuts) {
      return covs.map(function (v) { return v <= cuts[0] ? "X" : v <= cuts[1] ? "Y" : "Z"; });
    }
  };

  /* ---------- sourcing ---------- */
  var src = {
    normWeights: function (w) {
      var t = 0, k, out = {};
      for (k in w) t += w[k];
      for (k in w) out[k] = t > 0 ? w[k] / t : 1 / Object.keys(w).length;
      return out;
    },
    scorecard: function (suppliers, weights) {
      var nw = src.normWeights(weights);
      return suppliers.map(function (s) {
        var tot = 0, parts = {};
        for (var k in nw) { parts[k] = nw[k] * s.scores[k]; tot += parts[k]; }
        return { id: s.id, score: tot, parts: parts };
      });
    },
    /* cost per unit. s: {price, freight, dutyPct, defectPct, leadDays, payDays, qualCost}
       P: {holdRate, capCost, defectMult, safetyDays, volume, years} */
    tco: function (s, P) {
      var c = {
        price: s.price,
        freight: s.freight,
        duty: s.price * s.dutyPct,
        quality: s.defectPct * s.price * P.defectMult,
        inventory: s.price * P.holdRate * (s.leadDays + P.safetyDays) / 365,
        financing: -s.price * P.capCost * s.payDays / 365,
        qualification: s.qualCost / (P.volume * P.years)
      };
      c.total = c.price + c.freight + c.duty + c.quality + c.inventory + c.financing + c.qualification;
      return c;
    },
    pareto: function (items) { // items: [{label, value}]
      var sorted = items.slice().sort(function (a, b) { return b.value - a.value; });
      var total = sum(sorted.map(function (x) { return x.value; })), cum = 0, nA = 0;
      var cumShare = sorted.map(function (x) { cum += x.value; return total > 0 ? cum / total : 0; });
      for (var i = 0; i < cumShare.length; i++) { if (cumShare[i] >= 0.8) { nA = i + 1; break; } }
      return { sorted: sorted, cumShare: cumShare, nA: nA, total: total };
    },
    makeVsBuy: function (P) { // {fixed, varCost, buyPrice, volume}
      var be = P.buyPrice > P.varCost ? P.fixed / (P.buyPrice - P.varCost) : Infinity;
      var makeCost = P.fixed + P.varCost * P.volume, buyCost = P.buyPrice * P.volume;
      return { makeCost: makeCost, buyCost: buyCost, breakEven: be, decision: P.volume > be ? "make" : "buy" };
    },
    /* dual sourcing: share s (0..1) goes to the secondary supplier.
       P: {volume (units/yr), p1, p2Premium, q (annual prob. of a primary outage), weeks (outage length),
           kappa (how far the secondary can scale up vs its normal share), lossMult (loss per unmet unit, x p1)} */
    dualSourcing: function (P, s) {
      var V = P.volume, p2 = P.p1 * (1 + P.p2Premium);
      var base = V * ((1 - s) * P.p1 + s * p2);
      var unmet = 1 - Math.min(1, P.kappa * s);
      var loss = P.weeks * (V / 52) * unmet * P.lossMult * P.p1;
      return { base: base, loss: loss, expected: base + P.q * loss, disruptionYear: base + loss, unmet: unmet };
    }
  };

  /* ---------- operations: queueing approximation + Monte Carlo ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normalSample(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function lognormalSample(r, mean, cv) {
    var s2 = Math.log(1 + cv * cv), mu = Math.log(mean) - s2 / 2;
    return Math.exp(mu + Math.sqrt(s2) * normalSample(r));
  }
  /* Sakasegawa / Allen-Cunneen approximation of the mean wait in a G/G/c queue */
  function wqApprox(rho, c, ca2, cs2, ES) {
    if (rho >= 1) return Infinity;
    var e = Math.sqrt(2 * (c + 1)) - 1;
    return (Math.pow(rho, e) / (c * (1 - rho))) * ((ca2 + cs2) / 2) * ES;
  }
  var ops = {
    /* stages: [{key, ES (hours), cv, c (servers), queue (bool), phase: "pre"|"transit"}], lambda in orders/hour */
    stageStats: function (stages, lambda) {
      return stages.map(function (s) {
        var rho = s.queue ? Math.min(0.995, lambda * s.ES / s.c) : 0;
        var unstable = s.queue && lambda * s.ES / s.c >= 0.995;
        var wq = s.queue ? wqApprox(rho, s.c, 1, s.cv * s.cv, s.ES) : 0;
        return { key: s.key, rho: rho, wq: wq, service: s.ES, unstable: unstable, phase: s.phase };
      });
    },
    simulate: function (stages, lambda, N, seed) {
      var r = mulberry32(seed), st = ops.stageStats(stages, lambda);
      var total = new Array(N), pre = new Array(N), transit = new Array(N);
      for (var i = 0; i < N; i++) {
        var a = 0, b = 0;
        for (var j = 0; j < stages.length; j++) {
          var t = lognormalSample(r, stages[j].ES, stages[j].cv);
          if (stages[j].queue && st[j].wq > 0) t += -Math.log(1 - r()) * st[j].wq; // exponential wait with the approximated mean
          if (stages[j].phase === "pre") a += t; else b += t;
        }
        pre[i] = a; transit[i] = b; total[i] = a + b;
      }
      return { total: total, pre: pre, transit: transit, stats: st };
    },
    summary: function (total, sla) {
      var s = total.slice().sort(function (a, b) { return a - b; }), within = 0;
      for (var i = 0; i < total.length; i++) if (total[i] <= sla) within++;
      return { p50: quantile(s, 0.5), p90: quantile(s, 0.9), p95: quantile(s, 0.95), mean: sum(total) / total.length, withinSla: within / total.length };
    },
    /* expedite orders whose pre-handover time exceeds threshold: transit time shrinks by beta */
    expedite: function (sim, P) { // P: {sla, thr, beta, costExp, penalty}
      var n = sim.total.length, exp = 0, breach = 0;
      for (var i = 0; i < n; i++) {
        var e = sim.pre[i] > P.thr;
        var t = sim.pre[i] + sim.transit[i] * (e ? 1 - P.beta : 1);
        if (e) exp++;
        if (t > P.sla) breach++;
      }
      var er = exp / n, br = breach / n;
      return { expediteRate: er, breachRate: br, costPer1000: 1000 * (er * P.costExp + br * P.penalty) };
    },
    histogram: function (values, binWidth, maxVal) {
      var nb = Math.ceil(maxVal / binWidth), h = new Array(nb).fill(0);
      for (var i = 0; i < values.length; i++) { var b = Math.min(nb - 1, Math.floor(values[i] / binWidth)); h[b]++; }
      return h;
    }
  };

  return {
    normCdf: normCdf, normPdf: normPdf, normInv: normInv, normLoss: normLoss, quantile: quantile, sum: sum,
    inv: inv, src: src, ops: ops,
    rng: { mulberry32: mulberry32, normal: normalSample, lognormal: lognormalSample }, wqApprox: wqApprox
  };
});
