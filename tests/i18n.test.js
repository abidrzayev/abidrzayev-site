// node tests/i18n.test.js – every key used in HTML/JS exists in both languages, placeholders match.
const fs = require("fs"), path = require("path"), assert = require("assert");
global.window = {}; global.document = { body: { getAttribute: () => "", insertBefore() {}, appendChild() {} }, documentElement: {}, querySelectorAll: () => [], createElement: () => ({ setAttribute() {} }) };
global.location = { search: "", pathname: "/", hash: "" }; global.navigator = { language: "en" };
require("../assets/js/i18n.js");
const D = window.Site.dict, root = path.join(__dirname, "..");
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!/node_modules|vendor|\.git|tests|scripts/.test(f)) walk(p); } else if (/\.(html|js)$/.test(f) && f !== "i18n.js" && f !== "calc.js") files.push(p); } })(root);
const used = new Set(), prefixes = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, "utf8"); let m;
  const re1 = /data-i18n(?:-html)?="([^"]+)"/g, re2 = /\bt\(\s*"([^"]+)"\s*(\+)?/g, re3 = /data-title="([^"]+)"/g;
  while ((m = re1.exec(s))) used.add(m[1]);
  while ((m = re3.exec(s))) used.add(m[1]);
  while ((m = re2.exec(s))) (m[2] ? prefixes : used).add(m[1]);
}
const missing = [...used].filter(k => !D[k]);
assert.deepStrictEqual(missing, [], "missing keys: " + missing.join(", "));
for (const p of prefixes) assert.ok(Object.keys(D).some(k => k.startsWith(p)), "no keys for dynamic prefix " + p);
// dynamic key sets
const dyn = { "dow.": [1,2,3,4,5,6,7], "src.sup.": "ABCDEF".split(""), "src.crit.": ["price","quality","delivery","lead","risk","esg"],
  "src.tco.": ["price","freight","duty","quality","inventory","qualification","financing"], "src.cat.": ["pack","raw","comp","log","mro","it"], "ops.st.": ["proc","pick","pack","hand","haul","last"] };
for (const [p, ks] of Object.entries(dyn)) for (const k of ks) assert.ok(D[p + k], "missing dynamic key " + p + k);
let bad = [];
for (const [k, v] of Object.entries(D)) {
  assert.ok(Array.isArray(v) && v.length === 2 && v[0] && v[1], "bad entry " + k);
  const ph = s => (s.match(/\{[a-z]+\}/g) || []).sort().join();
  if (ph(v[0]) !== ph(v[1])) bad.push(k);
}
assert.deepStrictEqual(bad, [], "placeholder mismatch: " + bad.join(", "));
const unused = Object.keys(D).filter(k => !used.has(k) && ![...prefixes].some(p => k.startsWith(p)) && !/^(nav|foot|skip|site|err|banner|unit|chip|legal)/.test(k));
console.log("keys:", Object.keys(D).length, "| used:", used.size, "| unused (info):", unused.join(" ") || "none");
console.log("i18n OK");
