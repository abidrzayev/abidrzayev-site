// Run: node tests/calc.test.js
const assert = require("assert");
const C = require("../assets/js/calc.js");
let n = 0;
function ok(name, fn) { fn(); n++; console.log("ok -", name); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ${b}, got ${a}`);

ok("normal cdf / inverse round trip", () => {
  near(C.normCdf(1.96), 0.975, 1e-4, "cdf(1.96)");
  near(C.normInv(0.975), 1.959964, 1e-5, "inv(0.975)");
  [0.001, 0.05, 0.5, 0.9, 0.99, 0.999].forEach(p => near(C.normCdf(C.normInv(p)), p, 1e-6, "roundtrip " + p));
  near(C.normLoss(0), 0.398942, 1e-5, "L(0)");
});

ok("inventory: safety stock, ROP, fill rate behave", () => {
  const P = { z: C.normInv(0.95), L: 4, C: 7, h: 0.2, cr: 0.7, p: 0.3, N: 312 };
  const s = { mu: 5000, sigma: 800 };
  const r = C.inv.perStore(s, P);
  near(r.ss, 1.6449 * 800 * 2, 2, "ss = z*sigma*sqrt(L)");
  near(r.rop, 5000 * 4 + r.ss, 1e-6, "rop");
  const r2 = C.inv.perStore(s, Object.assign({}, P, { z: C.normInv(0.99) }));
  assert.ok(r2.ss > r.ss && r2.fillRate > r.fillRate && r2.stockout < r.stockout && r2.holding > r.holding);
  assert.ok(r.fillRate > 0.98 && r.fillRate < 1);
});

ok("inventory: optimalZ minimises total cost (first-order condition)", () => {
  const P = { L: 4, C: 7, h: 0.25, cr: 0.7, p: 0.5, N: 312 };
  const z = C.inv.optimalZ(P);
  assert.ok(z > 0, "z* positive in this parameter set");
  const s = { mu: 5000, sigma: 800 };
  const cost = (zz) => C.inv.perStore(s, Object.assign({}, P, { z: zz })).total;
  assert.ok(cost(z) <= cost(z - 0.1) && cost(z) <= cost(z + 0.1));
  near(cost(z), C.inv.costAtZ(z, s.sigma * Math.sqrt(P.L), P), 1e-6, "costAtZ matches perStore");
  assert.strictEqual(C.inv.optimalZ({ L: 4, C: 7, h: 0.5, cr: 1, p: 0.01, N: 312 }), 0); // holding dominates -> no safety stock
});

ok("ABC / XYZ classification", () => {
  const mus = [100, 50, 30, 10, 5, 3, 2];
  const cls = C.inv.abc(mus);
  assert.deepStrictEqual(cls.slice(0, 2), ["A", "A"]); // cumBefore: 0, .5 (<.8)
  assert.strictEqual(cls[6], "C");
  const covs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const cuts = C.inv.xyzCuts(covs);
  const x = C.inv.xyz(covs, cuts);
  assert.strictEqual(x[0], "X"); assert.strictEqual(x[5], "Z");
});

ok("sourcing: scorecard, TCO, pareto, make-vs-buy, dual sourcing", () => {
  const sup = [{ id: "a", scores: { price: 100, quality: 0 } }, { id: "b", scores: { price: 0, quality: 100 } }];
  let r = C.src.scorecard(sup, { price: 3, quality: 1 });
  near(r[0].score, 75, 1e-9); near(r[1].score, 25, 1e-9);
  r = C.src.scorecard(sup, { price: 0, quality: 0 }); // degenerate weights -> equal
  near(r[0].score, 50, 1e-9);
  const t = C.src.tco({ price: 10, freight: 0.5, dutyPct: 0.04, defectPct: 0.02, leadDays: 30, payDays: 60, qualCost: 36000 },
    { holdRate: 0.2, capCost: 0.08, defectMult: 3, safetyDays: 10, volume: 100000, years: 3 });
  near(t.duty, 0.4, 1e-9); near(t.quality, 0.6, 1e-9);
  near(t.inventory, 10 * 0.2 * 40 / 365, 1e-9); assert.ok(t.financing < 0);
  near(t.total, t.price + t.freight + t.duty + t.quality + t.inventory + t.financing + t.qualification, 1e-9);
  const p = C.src.pareto([{ label: "a", value: 80 }, { label: "b", value: 10 }, { label: "c", value: 6 }, { label: "d", value: 4 }]);
  assert.strictEqual(p.nA, 1); near(p.cumShare[3], 1, 1e-12);
  const m = C.src.makeVsBuy({ fixed: 100000, varCost: 6, buyPrice: 10, volume: 30000 });
  near(m.breakEven, 25000, 1e-9); assert.strictEqual(m.decision, "make");
  assert.strictEqual(C.src.makeVsBuy({ fixed: 1, varCost: 10, buyPrice: 9, volume: 5 }).breakEven, Infinity);
  const P = { volume: 100000, p1: 10, p2Premium: 0.08, q: 0.1, weeks: 8, kappa: 2, lossMult: 2 };
  const d0 = C.src.dualSourcing(P, 0), d3 = C.src.dualSourcing(P, 0.3), d5 = C.src.dualSourcing(P, 0.5);
  assert.ok(d0.loss > d3.loss && d3.loss > d5.loss && d5.unmet === 0);
  assert.ok(d5.base > d0.base);
});

ok("operations: queue approximation and Monte Carlo are sane and reproducible", () => {
  near(C.wqApprox(0.5, 1, 1, 1, 1), 1.0, 0.05, "M/M/1 rho=.5 -> Wq = 1*ES");
  assert.ok(C.wqApprox(0.9, 4, 1, 1, 1) > C.wqApprox(0.5, 4, 1, 1, 1));
  const stages = [
    { key: "proc", ES: 0.2, cv: 0.6, c: 4, queue: true, phase: "pre" },
    { key: "pick", ES: 1.0, cv: 0.7, c: 12, queue: true, phase: "pre" },
    { key: "transit", ES: 24, cv: 0.5, c: 1, queue: false, phase: "transit" }
  ];
  const a = C.ops.simulate(stages, 10, 2000, 42), b = C.ops.simulate(stages, 10, 2000, 42);
  assert.deepStrictEqual(a.total.slice(0, 20), b.total.slice(0, 20)); // same seed -> same numbers
  const sm = C.ops.summary(a.total, 48);
  assert.ok(sm.p50 > 20 && sm.p50 < 40 && sm.p95 > sm.p90 && sm.p90 > sm.p50);
  const hi = C.ops.simulate(stages, 11.5, 2000, 42);
  assert.ok(C.ops.summary(hi.total, 48).mean > sm.mean, "more load -> longer lead time");
  const e0 = C.ops.expedite(a, { sla: 30, thr: 1e9, beta: 0.4, costExp: 8, penalty: 25 });
  const e1 = C.ops.expedite(a, { sla: 30, thr: 0, beta: 0.4, costExp: 8, penalty: 25 });
  assert.strictEqual(e0.expediteRate, 0); assert.ok(e1.expediteRate === 1 && e1.breachRate < e0.breachRate);
  const h = C.ops.histogram([1, 2, 3, 11], 5, 10); assert.deepStrictEqual(h, [3, 1]);
});

console.log(`\n${n} test groups passed`);
