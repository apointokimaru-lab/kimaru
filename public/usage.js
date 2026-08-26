(function () {
  // 利用の記録（#342）。Edge Function が全HTMLの </body> 直前にこの1行を差し込む。
  //
  // なぜ必要か: どの画面が使われているか・無料の人がどの上限にぶつかっているか・どこから来て登録したかを
  // 知る手段が他に無い。外部の計測SaaSは使わない方針なので自前で送る。
  // なぜファイル名が analytics/track ではないか: 広告ブロッカーの汎用ルールが "analytics.js" や "/track" に
  // 当たるため、その名前だと一部の閲覧者ぶんが黙って欠測する（数字が理由も分からず減る）。
  //
  // 送るもの: 画面のパス・外部リファラ・言語・（壁に当たったときだけ）機能名。個人を識別する値は
  // クライアントからは送らず、サーバ側で日次ローテーションのハッシュに潰す（Cookieは増やさない・IPは保存しない）。

  // 送信は1か所に寄せる。Content-Type は application/json 固定で、text/plain だとサーバ側 readJson が
  // CSRF対策で本文を捨てる（フォーム由来の content-type は解釈しない）ため、記録が空になる。
  function send(payload) {
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        // sendBeacon はページ遷移中でも取りこぼさない。同一オリジンなので CSP connect-src 'self' の範囲内。
        navigator.sendBeacon("/api/usage", new Blob([body], { type: "application/json" }));
        return;
      }
      fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
    } catch (e) { /* noop */ }
  }

  // ---- 有料の壁に当たった記録（#342 / 2026-08-26 決定）----
  // なぜ必要か: 上限の多くは画面側で止めるのでサーバには届かない。ぶつかった瞬間を残さないと、
  // 価格とプランの境界を推測だけで決め続けることになる。
  // 何をしているか: 機能名だけを送る。プランは送らない（クライアントの申告は偽れるので、
  // サーバ側の判定＝_lib/analytics.js recordLimitHit がぶつかった時点のプランを控える）。
  function limitHit(feature) {
    try {
      var key = "km_limit:" + feature;
      var last = 0;
      // 同じ壁を連打しても1回として数える。回数の多寡より「どの壁に、どれだけの人が」を見たいので5分で足りる。
      try { last = Number(sessionStorage.getItem(key) || 0); } catch (e) { /* noop */ }
      if (Date.now() - last < 300000) return;
      try { sessionStorage.setItem(key, String(Date.now())); } catch (e) { /* noop */ }
      send({ event: "limit_hit", feature: feature, path: location.pathname });
    } catch (e) { /* noop */ }
  }

  // ---- 登録時の流入元（#342 / 2026-08-26 決定）----
  // なぜ必要か: 画面の計測で分かるのは「見た人がどこから来たか」まで。どの流入が登録に至ったかが
  // つながらないと、露出先を選ぶ判断ができない。
  // 何をしているか: 最初に見た外部リファラのホストだけを控え、登録の送信に載せる。Cookie を使わないのは、
  // プライバシーポリシーで「閲覧記録に Cookie は使わない」と書いているため（localStorage で足りる）。
  function firstTouchSource() {
    try { return localStorage.getItem("km_src") || ""; } catch (e) { return ""; }
  }
  try {
    if (!firstTouchSource()) {
      var from = document.referrer ? new URL(document.referrer).hostname : "";
      // 最初の1回だけ控える。上書きすると、最後に踏んだ内部リンクや決済サイトからの戻りが流入元になる。
      if (from && from !== location.hostname) localStorage.setItem("km_src", from.slice(0, 100));
    }
  } catch (e) { /* noop */ }

  // Googleログインはフォーム送信ではなくリダイレクトなので、本文に流入元を載せられない。
  // 開始URLに付けて、state（署名cookieと照合される値）に載せて callback まで運ぶ。
  try {
    var src = firstTouchSource();
    if (src) {
      document.querySelectorAll('a.google-btn[href^="/api/google-auth-start"]').forEach(function (link) {
        var href = link.getAttribute("href");
        if (href.indexOf("src=") >= 0) return;
        link.setAttribute("href", href + (href.indexOf("?") >= 0 ? "&" : "?") + "src=" + encodeURIComponent(src));
      });
    }
  } catch (e) { /* noop */ }

  window.KimaruUsage = { limitHit: limitHit, source: firstTouchSource };

  // ---- 画面表示の記録 ----
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

    send({ path: path, ref: document.referrer || "", lang: document.documentElement.lang || "" });
  } catch (e) {
    /* 計測が落ちても画面には影響させない */
  }
})();
