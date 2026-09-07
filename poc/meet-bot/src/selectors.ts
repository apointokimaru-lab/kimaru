// Meet の UI 文言・aria-label に依存する場所は、すべてこのファイルに集める。
//
// なぜ壊れやすいか: Meet の DOM はクラス名が難読化されていて、手がかりになるのは role / aria-label / 表示文言だけ。
// それも Google の UI 更新と、Bot アカウントの表示言語（アカウントの言語設定に従う）で変わる。
// そのため (1) 日本語と英語の両方を 1 つの正規表現で受ける、(2) role で探し、無ければ属性・文言に落とす、
// (3) 実機で新しい文言に出会ったら events.jsonl の `page_text` と shots/*.png を見てここに足す、という運用にする。
// 選択子を join.ts や end-detect.ts に散らすと、Meet の変更 1 つで直す場所が何か所にもなる。
//
// ここで「しないこと」: Bot 検知を避けるための細工（UA 偽装・navigator.webdriver の隠蔽・人間らしいマウス移動）は
// 一切入れない。Google の規約の「保護措置の回避」に当たる（docs/ai-bot/platform-research.md 7.3・7.4）。

import type { Locator, Page } from "playwright";

/** 画面に出る文言の分類。end-detect.ts と join.ts が共有する */
export type TextClass = "removed" | "ended" | "denied" | "waiting" | "invalid_url" | "not_logged_in";

/**
 * 画面文言の正規表現。順番に意味がある（classifyText は上から順に最初に当たったものを返す）。
 * - removed: ホストに退出させられた
 * - ended: 会議自体が終わった／自分が退出した後の画面
 * - denied: 参加リクエストが拒否された・参加できない（Meet が第三者 Bot を自動拒否したときもここに出るはず）
 * - waiting: 「参加をリクエスト」を押した後の待機
 * - invalid_url: 会議コードが無効
 * - not_logged_in: Google のログイン画面に飛ばされた（プロファイルが未ログイン。Bot は自分でログインしない）
 */
export const TEXT: Record<TextClass, RegExp> = {
  // 実機の文言は「この会議からあなたが削除されました」（2026-09-07・#478）。「通話/会議から削除されました」だけだと
  // 間に「あなたが」が入るこの形に当たらず、退出理由が signal_lost に落ちていた。間の語を許す形にする。
  removed:
    /(?:通話|会議)から(?:あなたが)?削除されました|ホストによって削除されました|You(?:'|’)ve been removed from the meeting|You have been removed/i,
  ended:
    /通話が終了しました|この通話は終了しました|会議は終了しました|通話から退出しました|The meeting has ended|This call has ended|The call ended|Your call has ended|Your host ended|You(?:'|’)ve left the meeting|You left the meeting/i,
  denied:
    /参加できませんでした|参加リクエストは拒否されました|参加が拒否されました|この通話には参加できません|参加リクエストに誰も応答しませんでした|denied your request|Your request to join was denied|No one responded to your request to join|You can(?:'|’)t join this (?:video )?call|You(?:'|’)re not allowed to join|There is a problem connecting to this video call/i,
  waiting:
    /参加をリクエストしました|参加をリクエストしています|参加の承認を待っています|承認されると通話に参加できます|主催者が参加を許可するまでお待ちください|会議の主催者が通話への参加を許可するまでお待ちください|参加を許可するまでお待ちください|Asking to join|Asking to be let in|Waiting for someone to let you in|You(?:'|’)ll join the call when someone lets you in|Someone will let you in soon|Please wait until a meeting host/i,
  invalid_url:
    /会議コードが無効|会議コードを確認|この会議は見つかりません|Invalid video call name|Check your meeting code|couldn(?:'|’)t find the meeting|The meeting code you entered doesn(?:'|’)t work/i,
  not_logged_in: /ログイン\s*Google アカウント|Sign in\s*to continue to Google Meet|Google アカウントでログイン|Use your Google Account/i,
};

// 拒否の画面にも「ホーム画面に戻る」のような退出後と共通の部品が出るので、denied は ended より先に見る。
// 「ホーム画面に戻る／Return to home screen」自体は removed・denied・ended のどの画面にも出るため、どの分類にも入れない
// （その画面は退出ボタンが消えたことで signal_lost として拾う）。
const TEXT_ORDER: TextClass[] = ["removed", "denied", "ended", "waiting", "invalid_url", "not_logged_in"];

/** 画面全文（innerText）を分類する。どれにも当たらなければ null */
export function classifyText(text: string): TextClass | null {
  for (const key of TEXT_ORDER) {
    if (TEXT[key].test(text)) return key;
  }
  return null;
}

// ---- 入室前の画面（プレビュー） ----

export const preJoin = {
  /**
   * ゲスト（未ログイン）用の名前欄。これが見えたらプロファイルは未ログイン。
   * Bot は自分でログインしないので、--guest-name が無ければここで止まる。
   */
  nameInput: (page: Page): Locator =>
    page
      .getByRole("textbox", { name: /名前|Your name/i })
      .or(page.locator('input[aria-label*="名前"], input[aria-label*="Your name"], input[placeholder*="名前"], input[placeholder*="Your name"]'))
      .first(),

  /**
   * マイク／カメラの切り替え。aria-label が「マイクをオフにする (Ctrl + D)」＝いまオン、「マイクをオンにする」＝いまオフ。
   * label に「オン／on」が含まれていれば既にオフなので押さない（押すと逆にオンになる）。
   * Meet は data-is-muted 属性も付けるので、名前で取れないときの予備にする。
   */
  micToggle: (page: Page): Locator =>
    page.getByRole("button", { name: /マイクを(?:オン|オフ)にする|Turn (?:on|off) microphone/i }).first(),
  camToggle: (page: Page): Locator =>
    page.getByRole("button", { name: /カメラを(?:オン|オフ)にする|Turn (?:on|off) camera/i }).first(),
  /** aria-label から「いまオンか」を読む。判断できなければ null */
  isDeviceOn: (label: string | null): boolean | null => {
    if (!label) return null;
    if (/オフにする|Turn off/i.test(label)) return true;
    if (/オンにする|Turn on/i.test(label)) return false;
    return null;
  },

  /** 端末にマイク・カメラが無いときに Meet が出す確認。押さないと参加ボタンが出ないことがある */
  continueWithoutDevices: (page: Page): Locator =>
    page
      .getByRole("button", {
        name: /マイクとカメラを使用せずに続行|マイクを使用せずに続行|カメラを使用せずに続行|Continue without (?:microphone|camera)/i,
      })
      // 実機ではボタンではなくリンクとして出た（2026-09-07・#478。押せずに参加ボタンが覆われたままになった）
      .or(
        page.getByRole("link", {
          name: /マイクとカメラを使用せずに続行|マイクを使用せずに続行|カメラを使用せずに続行|Continue without (?:microphone|camera)/i,
        }),
      )
      .first(),

  /**
   * 「今すぐ参加」＝招待済み（または同じ組織）で直接入室できるときのボタン。
   * 「参加をリクエスト」＝ホストの承認が要るときのボタン。
   * 英語の別表記（Join the call now / Join anyway / Join here too / Ask to join anyway）は Attendee の選択子
   * （bots/google_meet_bot_adapter/google_meet_ui_methods.py）に出ていたもの。
   * どちらが出たかが #478 の仮説（招待済みなら直接入室できる）の判定そのもの。前後空白は許すが、
   * 「参加をリクエスト」に「参加」が含まれるため ^$ で厳密に分ける。
   */
  // 語そのものが入っていれば拾う（前方一致・後方一致を許す）。厳密一致（^$）にしていたら、マイク／カメラの
  // 権限警告が出たときにボタンの読み上げ名へアイコンの文字（"error" など）が混ざって外れ、画面には
  // 「参加をリクエスト」が出ているのに 50 秒間見つけられなかった（2026-09-07 の実機・#478）。
  // 「参加する」「Join」の 1 語だけは、他の語に含まれてしまうので従来どおり厳密一致で分ける。
  // 隠れた同名要素（ダイアログの裏に残るもの）を掴まないよう、可視のものだけに絞る。
  joinNow: (page: Page): Locator =>
    page
      .getByRole("button", { name: /今すぐ参加|Join now|Join the call now|Join anyway|Join here too/ })
      .or(page.getByRole("button", { name: /^\s*(?:参加する|Join)\s*$/ }))
      .filter({ visible: true })
      .first(),
  askToJoin: (page: Page): Locator =>
    page
      .getByRole("button", { name: /参加をリクエスト|Ask to join/ })
      .filter({ visible: true })
      .first(),
};

// ---- 会議中の画面 ----

export const inMeeting = {
  /** 会議中にだけ存在するボタン。これが見えたら in_meeting、消えたら会議画面ではない */
  leaveButton: (page: Page): Locator =>
    page.getByRole("button", { name: /通話から退出|通話を終了|Leave call|End call/i }).first(),
};

/**
 * 参加者数を DOM から読む。読めなければ null（0 ではない。「0 人」と「分からない」を区別しないと、
 * DOM が変わっただけで「全員退出」と誤判定して退出してしまう）。
 *
 * 候補を上から順に試す:
 *  1. `[data-participant-id]` の一意な数 — Meet はタイルと参加者リストにこの属性を付ける。もっとも安定しているが、
 *     グリッドに出ないぶん（大人数）は数えられない。1 on 1 面談の「Bot だけ残った」判定には足りる
 *  2. aria-label／文言に「N 人の参加者」「N participants」を含む要素
 * 擬似ページ（test/fake-meet）も同じ属性を出すので、判定ロジックはオフラインで固定できる。
 */
export async function readParticipantCount(page: Page): Promise<number | null> {
  try {
    return await page.evaluate(() => {
      const ids = new Set<string>();
      document.querySelectorAll("[data-participant-id]").forEach((el) => {
        const id = el.getAttribute("data-participant-id");
        if (id) ids.add(id);
      });
      if (ids.size > 0) return ids.size;
      // ScreenApp（screenappai/meeting-bot）が使っている属性。意味は「参加者ボタンの人数」と読める
      const avatar = document.querySelector("[data-avatar-count]")?.getAttribute("data-avatar-count");
      if (avatar && /^\d+$/.test(avatar)) return Number(avatar);
      const re = /(\d+)\s*(?:人の参加者|人が参加|participants?)|(?:参加者|participants?)\D{0,6}(\d+)/i;
      for (const el of Array.from(document.querySelectorAll("[aria-label]"))) {
        const m = re.exec(el.getAttribute("aria-label") ?? "");
        if (m) return Number(m[1] ?? m[2]);
      }
      return null;
    });
  } catch {
    return null;
  }
}

/** 画面の見える文言（innerText）。分類と記録に使う。長すぎる場合は先頭だけ */
export async function readPageText(page: Page, limit = 20000): Promise<string> {
  try {
    const t = await page.evaluate(() => document.body?.innerText ?? "");
    return t.length > limit ? t.slice(0, limit) : t;
  } catch {
    return "";
  }
}

/** Locator が今見えているか（例外は「見えていない」に丸める） */
export async function isVisible(locator: Locator, timeoutMs = 300): Promise<boolean> {
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
