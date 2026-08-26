(function () {
  // 運営コンソールの共通サイドメニュー（#343）。
  //
  // なぜ必要か: 画面ごとにメニューを直書きしていたため、ページを移るとメニューの中身が入れ替わり、
  // 「いまどこにいるのか」「次にどこへ行けるのか」が分からなくなっていた。項目は1か所で持つ。
  // 何をしているか: 全画面ぶんの項目を描画し、現在地（パス＋ハッシュ）から選択状態を付ける。
  // 分析ダッシュボードは中に4つのビューがあるので、アコーディオンで子項目まで出す
  // （他の画面からでも「課金・転換」へ直接飛べる）。
  //
  // defer にせず <nav> の直後で同期実行するのは、各ページ下部のスクリプトが
  // #nav-pending-badge の存在を前提にしているため（描画前に触ると null 参照になる）。
  var NAV = [
    { href: '/cat-key-admin.html#owners', label: 'ユーザー一覧' },
    { href: '/cat-key-admin.html#log', label: 'Cat Key認証', badge: 'nav-pending-badge' },
    { href: '/cat-key-admin.html#history', label: '操作履歴' },
    {
      label: '分析ダッシュボード',
      // 並びは「知る → 登録する → 使い始める → 使い続ける → 払う」という実際の道筋（#343 の設計）。
      // 落ちている段を上から順に探せるようにするため、この順番自体に意味がある。
      children: [
        { href: '/analytics.html#overview', label: 'サマリー' },
        { href: '/analytics.html#acquisition', label: '獲得' },
        { href: '/analytics.html#retention', label: '定着' },
        { href: '/analytics.html#revenue', label: '収益' },
        { href: '/analytics.html#features', label: '機能' },
      ],
    },
    { href: '/operators.html', label: '運営者管理' },
  ];

  var nav = document.querySelector('[data-operator-nav]');
  if (!nav) return;

  function item(entry, className) {
    var badge = entry.badge ? ' <span class="op-badge" id="' + entry.badge + '" hidden></span>' : '';
    return '<a class="' + className + '" href="' + entry.href + '" data-nav-href="' + entry.href + '">' + entry.label + badge + '</a>';
  }

  nav.innerHTML = NAV.map(function (entry) {
    if (!entry.children) return item(entry, 'op-nav-item');
    return '<details class="op-nav-group">'
      + '<summary class="op-nav-item">' + entry.label + '</summary>'
      + '<div class="op-nav-subs">' + entry.children.map(function (child) { return item(child, 'op-nav-sub'); }).join('') + '</div>'
      + '</details>';
  }).join('');

  var links = Array.prototype.slice.call(nav.querySelectorAll('[data-nav-href]'));

  function markActive() {
    var path = location.pathname;
    var hash = location.hash;
    var matched = null;
    links.forEach(function (link) {
      var parts = link.getAttribute('data-nav-href').split('#');
      if (parts[0] !== path) return;
      // ハッシュが無いとき（初回表示）は、その画面の先頭の項目を選択状態にする。
      // 各ページの showView も同じく先頭のビューから始まるので、表示と選択がずれない。
      if (!matched) matched = link;
      if (hash && parts[1] && '#' + parts[1] === hash) matched = link;
    });
    links.forEach(function (link) { link.classList.toggle('is-active', link === matched); });
    nav.querySelectorAll('.op-nav-group').forEach(function (group) {
      var inside = Boolean(matched) && group.contains(matched);
      if (inside) group.open = true; // 現在地が中にあるときは開いたままにする（閉じると迷子になる）
      group.querySelector('summary').classList.toggle('is-current', inside);
    });
  }

  nav.addEventListener('click', function (event) {
    var link = event.target.closest ? event.target.closest('a[data-nav-href]') : null;
    if (!link) return;
    var parts = link.getAttribute('data-nav-href').split('#');
    // 別の画面へはそのまま遷移させる。同じ画面の中の移動だけ、リロードせずビューを切り替える。
    if (parts[0] !== location.pathname || !parts[1]) return;
    event.preventDefault();
    if (location.hash === '#' + parts[1]) { markActive(); return; }
    location.hash = '#' + parts[1]; // hashchange → 各ページの showView が拾う
  });

  window.addEventListener('hashchange', markActive);
  markActive();
})();
