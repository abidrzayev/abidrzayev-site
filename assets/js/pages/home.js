/* home.js – headline numbers on the home page come from data/model_card.json (recorded real values). */
(function () {
  "use strict";
  var t = Site.t, F = Charts.fmt;
  var host = document.getElementById("home-stats");
  Site.loadJSON("data/model_card.json").then(function (card) {
    Charts.kpi(host, F.dec(card.kaggle.private, 5), t("home.stat.priv"), t("home.stat.priv.s"), "blue");
    Charts.kpi(host, F.dec(card.kaggle.public, 5), t("home.stat.pub"), t("home.stat.pub.s"), "");
    Charts.kpi(host, F.int(1115), t("home.stat.stores"), t("home.stat.stores.s"), "");
    Charts.kpi(host, F.int(card.kaggle.test_rows), t("home.stat.rows"), t("home.stat.rows.s"), "");
  }).catch(function (e) { Site.fail(e, host); });
})();
