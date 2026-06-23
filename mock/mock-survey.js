// mock 専用：予約設定（booking-settings）のデモ挙動。本番は app.js が同等を担う。
// ・事前アンケート：回答形式に応じて選択肢欄を出し分け＋マーク形状を同期／＋で行追加・×で削除／質問の追加・削除
// ・受付時間：曜日チェックで「時間帯⇔休み」を切替（土日含む）
// ・開催方法：選択カードに応じて詳細欄（自動発行の案内 or 会場・電話番号・URL入力）を出し分け
(function () {
  function rowHtml(value) {
    return (
      '<span class="opt-mark"></span>' +
      '<input type="text" value="' + (value || "") + '" placeholder="選択肢を入力" />' +
      '<button type="button" class="opt-rm" title="この選択肢を削除">×</button>'
    );
  }

  function addRow(block, focus) {
    var card = block.closest(".qcard");
    var type = card ? card.querySelector(".answer-type").value : "select";
    var row = document.createElement("div");
    row.className = "opt-row " + (type === "checkbox" ? "is-check" : "is-radio");
    row.innerHTML = rowHtml("");
    block.querySelector(".opt-list").appendChild(row);
    if (focus) { var i = row.querySelector("input"); if (i) i.focus(); }
  }

  // 回答形式に合わせて選択肢欄の表示とマーク形状を更新
  function syncCard(card) {
    var sel = card.querySelector(".answer-type");
    var block = card.querySelector(".opt-block");
    if (!sel || !block) return;
    var v = sel.value;
    block.classList.toggle("opt-na", v === "text"); // 自由入力なら選択肢欄を隠す
    var check = v === "checkbox";
    block.querySelectorAll(".opt-row").forEach(function (r) {
      r.classList.toggle("is-check", check);
      r.classList.toggle("is-radio", !check);
    });
    if (v !== "text" && !block.querySelector(".opt-row")) addRow(block, false);
  }

  function addQuestion() {
    var stack = document.querySelector(".qstack");
    if (!stack) return;
    var tpl = stack.querySelector(".qcard");
    var clone = tpl.cloneNode(true);
    clone.querySelectorAll("input[type=text]").forEach(function (i) { i.value = ""; });
    var sel = clone.querySelector(".answer-type");
    if (sel) sel.value = "text";
    var list = clone.querySelector(".opt-list");
    if (list) list.innerHTML = '<div class="opt-row is-radio">' + rowHtml("") + "</div>";
    stack.appendChild(clone);
    syncCard(clone);
    var q = clone.querySelector("input[type=text]");
    if (q) q.focus();
  }

  document.addEventListener("click", function (e) {
    var add = e.target.closest(".opt-add");
    if (add) { e.preventDefault(); addRow(add.closest(".opt-block"), true); return; }

    var rm = e.target.closest(".opt-rm");
    if (rm) {
      e.preventDefault();
      var list = rm.closest(".opt-list");
      if (list.querySelectorAll(".opt-row").length > 1) rm.closest(".opt-row").remove();
      return;
    }

    var qadd = e.target.closest(".q-add");
    if (qadd) { e.preventDefault(); addQuestion(); return; }

    var qdel = e.target.closest(".q-del");
    if (qdel) {
      e.preventDefault();
      if (document.querySelectorAll(".qcard").length > 1) qdel.closest(".qcard").remove();
      return;
    }
  });

  // 受付時間：チェックで「時間帯 ⇔ 休み」を切替
  function syncAvail(row) {
    var cb = row.querySelector(".avail-day input[type=checkbox]");
    if (cb) row.classList.toggle("off", !cb.checked);
  }

  // 開催方法：選択に応じて詳細欄を出し分け
  // Google Meet / Zoom は外部連携が必要。未連携なら連携案内を出す（mock デモは未連携状態）。
  // 本番は owner の google_connections 等の連携状況で出し分ける。
  var CONNECTED = { meet: false, zoom: false };
  var PROVIDER = { meet: { name: "Google", svc: "Google Meet" }, zoom: { name: "Zoom", svc: "Zoom" } };
  var METHOD_DETAIL = {
    inperson: { label: "会場・住所", ph: "例：渋谷オフィス 3F ／ 〇〇カフェ など" },
    phone: { label: "電話番号", ph: "例：090-1234-5678（こちらからお電話します）" },
    custom: { label: "会議URL", ph: "https://…（ご自身の会議URL）" },
    later: { hint: "予約確定後に、ホストから個別にご連絡します。" }
  };
  function renderMethod(value) {
    var box = document.getElementById("bs-method-detail");
    if (!box) return;
    if (value === "meet" || value === "zoom") {
      var p = PROVIDER[value];
      if (!CONNECTED[value]) {
        box.innerHTML =
          '<div class="method-connect"><div>' +
          "<b>" + p.name + "連携が必要です</b>" +
          "<p>" + p.svc + " で実施するには " + p.name + " との連携が必要です。連携すると、会議URLが予約確定時に自動発行され、確認メールに記載されます。</p>" +
          '</div><a class="btn btn-primary btn-sm" href="/settings.html">設定で連携する</a></div>';
      } else {
        box.innerHTML = '<div class="method-hint">' + p.svc + " の会議URLは予約確定時に自動発行され、確認メールに記載されます。</div>";
      }
      return;
    }
    var d = METHOD_DETAIL[value] || {};
    box.innerHTML = d.hint
      ? '<div class="method-hint">' + d.hint + "</div>"
      : '<div class="field" style="margin:0"><label>' + d.label + "</label>" +
        '<input type="text" placeholder="' + d.ph + '" /></div>';
  }

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains("answer-type")) {
      syncCard(t.closest(".qcard"));
    } else if (t.matches && t.matches(".avail-day input[type=checkbox]")) {
      syncAvail(t.closest(".avail-row"));
    } else if (t.name === "method") {
      document.querySelectorAll("#bs-method .method-opt").forEach(function (o) {
        o.classList.toggle("sel", o.contains(t));
      });
      renderMethod(t.value);
    }
  });

  // 公開範囲：無料プランは Pro 範囲（3〜6ヶ月）を選べないように disabled。超過選択は2ヶ月にクランプ。
  // 本番は app.js が owner.plan で同等のゲートを行う。プラン切替（mock-plan.js が body.plan-* を更新）に追従する。
  function currentPlan() {
    var c = document.body.classList;
    return c.contains("plan-free") ? "free" : c.contains("plan-premium") ? "premium" : "pro";
  }
  function gateRange() {
    var sel = document.getElementById("bs-range");
    if (!sel) return;
    var free = currentPlan() === "free";
    var opts = sel.options;
    for (var i = 0; i < opts.length; i++) {
      if (/（Pro）/.test(opts[i].text)) opts[i].disabled = free;
    }
    // 無料で Pro 範囲を選択中なら「2ヶ月（無料はここまで）」に戻す
    if (free && sel.selectedOptions[0] && /（Pro）/.test(sel.selectedOptions[0].text)) {
      for (var j = 0; j < opts.length; j++) {
        if (/無料はここまで/.test(opts[j].text)) { sel.selectedIndex = j; break; }
      }
    }
  }

  function init() {
    document.querySelectorAll(".qcard").forEach(syncCard);
    document.querySelectorAll(".avail-row").forEach(syncAvail);
    var m = document.querySelector("#bs-method input[name=method]:checked");
    if (m) renderMethod(m.value);
    gateRange();
    // プラン切替（body.plan-* の変化）に追従
    new MutationObserver(gateRange).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
