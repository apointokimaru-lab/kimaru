(function () {
  // 画面表示の記録（#342）。Edge Function が全HTMLの </body> 直前にこの1行を差し込む。
  //
  // なぜ必要か: どの画面が使われているかを知る手段が他に無い。外部の計測SaaSは使わない方針なので自前で送る。
  // なぜファイル名が analytics/track ではないか: 広告ブロッカーの汎用ルールが "analytics.js" や "/track" に
  // 当たるため、その名前だと一部の閲覧者ぶんが黙って欠測する（数字が理由も分からず減る）。
  //
  // 送るもの: 画面のパス・外部リファラ・言語だけ。個人を識別する値はクライアントからは送らず、
  // サーバ側で日次ローテーションのハッシュに潰す（Cookieは増やさない・IPは保存しない）。
  try {
    var path = location.pathname;
    // 同じ画面のリロードやタブ復帰でPVを水増ししない。30分以内の同一パスは送らない。
    // sessionStorage が使えない環境（プライベートモード等）は素通しで送る＝取れるぶんは取る。
    try {
      var key = "km_usage:" + path;
      var last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 1800000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch (e) { /* noop */ }

    var payload = JSON.stringify({
      path: path,
      ref: document.referrer || "",
      lang: document.documentElement.lang || "",
    });
    // Content-Type は application/json 固定。text/plain だとサーバ側 readJson が
    // CSRF対策で本文を捨てる（フォーム由来の content-type は解釈しない）ため、記録が空になる。
    if (navigator.sendBeacon) {
      // sendBeacon はページ遷移中でも取りこぼさない。同一オリジンなので CSP connect-src 'self' の範囲内。
      navigator.sendBeacon("/api/usage", new Blob([payload], { type: "application/json" }));
      return;
    }
    fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(function () {});
  } catch (e) {
    /* 計測が落ちても画面には影響させない */
  }
})();
