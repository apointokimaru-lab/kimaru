// 自己紹介などのリッチテキスト共有ユーティリティ。
// 保存は「サニタイズ済みHTML」。許可タグだけを再構築して XSS を防ぐ（属性は原則すべて破棄。
// a は http(s)/mailto の href のみ許可し rel/target を強制）。旧Markdown(# 見出し / **太字**)は後方互換で描画。
// エディタ(profile.html)と公開ページ(public-profile.html)の両方から使う。
(function () {
  if (window.KimaruRichText) return;

  // インライン装飾・見出し・リスト・リンク・改行のみ許可。
  var ALLOWED = { STRONG: 1, B: 1, EM: 1, I: 1, U: 1, S: 1, STRIKE: 1, DEL: 1, H3: 1, UL: 1, OL: 1, LI: 1, A: 1, BR: 1, P: 1, DIV: 1, SPAN: 1 };
  // 中身ごと破棄する危険タグ（テキストとしても残さない）。
  var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1, BASE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, TITLE: 1, FORM: 1, INPUT: 1, TEXTAREA: 1, BUTTON: 1, SELECT: 1, OPTION: 1, SVG: 1, MATH: 1, IMG: 1, VIDEO: 1, AUDIO: 1, SOURCE: 1, CANVAS: 1 };

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // src の子ノードを許可リストに沿って dest に複製する（属性は基本破棄）。
  function walk(src, dest) {
    var kids = src.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      if (node.nodeType === 3) { dest.appendChild(document.createTextNode(node.nodeValue)); continue; }
      if (node.nodeType !== 1) continue; // コメント等は破棄
      var tag = node.nodeName;
      if (DROP[tag]) continue; // 危険タグは中身ごと破棄
      if (tag === "A") {
        var href = String(node.getAttribute("href") || "").trim();
        if (/^(https?:|mailto:)/i.test(href)) {
          var a = document.createElement("a");
          a.setAttribute("href", href);
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "noopener noreferrer nofollow");
          walk(node, a); dest.appendChild(a);
        } else {
          walk(node, dest); // 不正URLはリンクを外して中身だけ残す
        }
        continue;
      }
      if (ALLOWED[tag]) {
        var el = document.createElement(tag.toLowerCase());
        walk(node, el); dest.appendChild(el);
      } else {
        walk(node, dest); // 未知タグはアンラップ（中身のみ）
      }
    }
  }

  // 任意のHTML文字列を安全なHTMLへ。DOMParser はスクリプトを実行しない（パースのみ）。
  function sanitize(html) {
    var doc = new DOMParser().parseFromString(String(html == null ? "" : html), "text/html");
    var out = document.createElement("div");
    walk(doc.body, out);
    return out.innerHTML;
  }

  // 旧Markdownサブセット(# 見出し / **太字** / 改行)を安全なHTMLへ（エスケープ済み）。
  function markdownToHtml(md) {
    var lines = String(md == null ? "" : md).split("\n");
    var html = [], para = [];
    function flush() { if (para.length) { html.push("<p>" + para.join("<br>") + "</p>"); para = []; } }
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = esc(raw).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      if (/^#\s+/.test(raw)) { flush(); html.push("<h3>" + line.replace(/^#\s+/, "") + "</h3>"); }
      else if (raw.trim() === "") { flush(); }
      else { para.push(line); }
    }
    flush();
    return html.join("");
  }

  // 許可タグを含めばHTML、含まなければ旧Markdownとみなす。
  var HTML_RE = /<\/?(strong|b|em|i|u|s|strike|del|h3|ul|ol|li|a|br|p|div|span)\b/i;

  // 保存値 → 表示/編集用の安全なHTML。
  function render(stored) {
    var s = String(stored == null ? "" : stored);
    if (!s.trim()) return "";
    return HTML_RE.test(s) ? sanitize(s) : markdownToHtml(s);
  }

  // エディタが実質空か（テキストも装飾要素も無い。空ブロックの <br> だけは空扱い）。
  function isBlank(html) {
    var doc = new DOMParser().parseFromString(String(html == null ? "" : html), "text/html");
    return doc.body.textContent.trim() === "" && !doc.body.querySelector("h3,ul,ol,li,a,strong,b,em,i,u,s,strike,del,img");
  }

  window.KimaruRichText = { sanitize: sanitize, markdownToHtml: markdownToHtml, render: render, isBlank: isBlank };
})();
