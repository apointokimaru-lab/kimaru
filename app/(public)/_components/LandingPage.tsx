import Image from "next/image";
import Link from "next/link";

import aki2 from "@/public/aki2.jpg";
import kimaruHyou from "@/public/kimaru-hyou.jpg";

import s from "./LandingPage.module.css";

// トップ（LP）。public/index.html（#366 の別案 LP・既存プレビューの再現）を、文言・構造・見た目を変えずに移した（#418）。
// - 日本語のみ（旧 LP も data-i18n を持たない）。3 言語化はポジショニングの判断（docs/positioning-brief.md）と一緒に別 issue で
// - 共通ヘッダー（SITE_HEADER）は使わない（旧と同じ。LP 単体で完結する）
// - 画像は next/image（寸法をビルド時に取り CLS を防ぐ。Netlify の Image CDN で幅ごとに最適化）
// - 旧ページへのリンク（/login.html 等）は <a>（next/link はプリフェッチで旧 HTML を取りに行く）。/ と /plan は Next のページなので Link（#419）
// - 文節ごとの折り返し（.nb・#366）はそのまま。クラス名は旧 lp.css のまま（kebab-case）なので s["..."] で引く

const c = (...names: string[]) =>
  names
    .map((n) => s[n])
    .filter(Boolean)
    .join(" ");

export function LandingPage() {
  return (
    <div className={c("lp")}>
      <header className={c("nav")}>
        <div className={c("nav-in")}>
          <Link className={c("brand")} href="/">
            キマル
          </Link>
          <nav className={c("nav-actions")} aria-label="主要導線">
            <a className={c("login")} href="/login.html">
              ログイン
            </a>
            <Link className={c("doc")} href="/plan">
              料金を見る
            </Link>
            <a className={c("consult")} href="/signup.html">
              無料で始める
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className={c("hero")}>
          <div className={c("wrap", "hero-grid")}>
            <div className={c("hero-copy")}>
              <p className={c("sub")}>
                <span>日程調整の、その先へ。</span>
              </p>
              <h1>キマル</h1>
              <p className={c("hero-lead")}>
                <span className={c("nb")}>
                  キマルは、1対1の面談や商談に特化した予約システムです。
                </span>
                <span className={c("nb")}>予約URLを送るだけで、</span>
                <span className={c("nb")}>日程調整、事前アンケート、</span>
                <span className={c("nb")}>Google Meet / Zoom URL発行、</span>
                <span className={c("nb")}>22分前リマインド、</span>
                <span className={c("nb")}>面談後の相手管理までまとめて進みます。</span>
              </p>
              <p className={c("hero-url-copy")}>
                <span className={c("nb")}>相手に送るのは、</span>
                <span className={c("nb")}>予約ページ設定で作成したURLだけ。</span>
              </p>
              <div className={c("value-row")} aria-label="キマルの価値">
                <div className={c("value-badge")}>
                  予定を合わせる
                  <br />
                  <strong>手間を削減</strong>
                </div>
                <div className={c("value-badge")}>
                  会う前から、
                  <br />
                  <strong>差がつく。</strong>
                </div>
                <div className={c("value-badge")}>
                  ご縁を、予定で
                  <br />
                  <strong>終わらせない。</strong>
                </div>
              </div>
              <div className={c("hero-actions")}>
                <div className={c("cta-stack")}>
                  <a className={c("btn", "primary")} href="/signup.html">
                    まずは無料で始める
                  </a>
                  <span className={c("cta-note")}>Google連携で登録30秒</span>
                </div>
                <a className={c("btn", "secondary")} href="#solve">
                  できることを見る
                </a>
              </div>
              <figure className={c("hero-plan-preview")}>
                <Image
                  src={kimaruHyou}
                  alt="キマルのプラン一覧。Free、Pro、Premium、Masterの料金と機能比較。"
                  sizes="(max-width: 680px) 100vw, 620px"
                  priority
                />
                <figcaption>{PLAN_IMAGE_NOTE}</figcaption>
              </figure>
            </div>

            <aside className={c("dashboard")} aria-label="キマルの予約画面イメージ">
              <figure className={c("booking-screenshot")}>
                <Image
                  src={aki2}
                  alt="キマルの予約ページ。所要時間、Google Meet自動発行、5日間の空き枠から選べる予約画面。"
                  sizes="(max-width: 980px) 100vw, 540px"
                  priority
                />
              </figure>
            </aside>
          </div>
        </section>

        <section className={c("section")} id="solve">
          <div className={c("wrap")}>
            <div className={c("head")}>
              <p className={c("label")}>SOLVE</p>
              <h2>
                <span className={c("nb")}>空き枠、事前アンケート、</span>
                <span className={c("nb")}>Web会議URL発行、</span>
                <span className={c("nb")}>顧客管理までひとつに。</span>
              </h2>
              <p>相手は予約ページから空き枠を選ぶだけ。</p>
            </div>
            <div className={c("solve-grid")}>
              <article className={c("card")}>
                <div className={c("icon")}>1</div>
                <h3>空き枠を自動表示</h3>
                <p>
                  <span className={c("nb")}>Googleカレンダーと連携し、</span>
                  <span className={c("nb")}>予定がある時間を避けます。</span>
                  <span className={c("nb")}>ピンポイントで候補日時からの日程調整も可能です。</span>
                </p>
              </article>
              <article className={c("card")}>
                <div className={c("icon")}>2</div>
                <h3>事前アンケートの回収で</h3>
                <p>
                  <span className={c("nb")}>相談内容確認やプロフィールの共有を、</span>
                  <span className={c("nb")}>会う前にできるので、</span>
                  <span className={c("nb")}>関係性の構築や契約率を高める事ができます。</span>
                </p>
              </article>
              <article className={c("card")}>
                <div className={c("icon")}>3</div>
                <h3>Google Meet / Zoom URLを自動発行</h3>
                <p>予約確定と同時にオンライン面談の入口を作ります。</p>
              </article>
              <article className={c("card")}>
                <div className={c("icon")}>4</div>
                <h3>面談後の記録を残す</h3>
                <p>
                  <span className={c("nb")}>メモ、印象スコア、</span>
                  <span className={c("nb")}>次回の打ち手を管理できます。</span>
                  <span className={c("nb")}>※無料版では閲覧のみ。</span>
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className={c("section", "tint")}>
          <div className={c("wrap")}>
            <div className={c("head")}>
              <p className={c("label")}>START FLOW</p>
              <h2>
                <span className={c("nb")}>登録からURL送信まで、</span>
                <span className={c("nb")}>迷わず進める。</span>
              </h2>
              <p>
                <span className={c("nb")}>無料登録から予約用URLの送信まで、</span>
                <span className={c("nb")}>必要な設定を順番に進めるだけです。</span>
              </p>
            </div>
            <div className={c("setup-steps")}>
              <div className={c("setup-step")}>
                <i>1</i>
                <b>無料で始める</b>
                <span>まずは無料で利用を開始できます。</span>
              </div>
              <div className={c("setup-step")}>
                <i>2</i>
                <b>Googleで無料登録</b>
                <span>Google連携で登録。もしくは手入力でも登録できます。</span>
              </div>
              <div className={c("setup-step")}>
                <i>3</i>
                <b>プロフィール設定</b>
                <span>名前、紹介文、公開ページに表示する情報を整えます。</span>
              </div>
              <div className={c("setup-step")}>
                <i>4</i>
                <b>予約ページ設定</b>
                <span>所要時間、受付時間、事前アンケート、Web会議URLを設定します。</span>
              </div>
              <div className={c("setup-step")}>
                <i>5</i>
                <b>予約用のURLを相手に送信</b>
                <span>発行された予約URLを送るだけで、日程調整が始まります。</span>
              </div>
            </div>
          </div>
        </section>

        <section className={c("section")}>
          <div className={c("wrap")}>
            <div className={c("head")}>
              <p className={c("label")}>FEATURES</p>
              <h2>キマルの機能一覧</h2>
              <p>
                <span className={c("nb")}>日程調整、事前準備、</span>
                <span className={c("nb")}>当日の案内、面談後の管理まで。</span>
                <span className={c("nb")}>1対1の面談で起きる細かい手間を、</span>
                <span className={c("nb")}>ひとつの流れで減らします。</span>
              </p>
            </div>
            {/* 機能区分（#377）。表＝現在利用可能、下の枠＝開発予定。未完成の機能を「使える」と読ませない（景表法）ため、
                区分名は issue の語をそのまま使い、開発予定の項目には 1 つずつ「開発予定」の札を付ける */}
            <h3 className={c("group-title")}>
              現在利用可能<small>いま提供している機能です</small>
            </h3>
            <div className={c("feature-table-wrap")}>
              <table className={c("feature-table")}>
                <thead>
                  <tr>
                    <th>機能</th>
                    <th>できること</th>
                    <th>便利になるポイント</th>
                    <th>対応</th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURES.map((f) => (
                    <tr key={f.name}>
                      <td>{f.name}</td>
                      <td>{f.what}</td>
                      <td>{f.why}</td>
                      <td className={c("mark-cell")}>✓</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={c("planned")} id="planned">
              <h3 className={c("group-title")}>
                開発予定<small>まだ提供していない機能です</small>
              </h3>
              <p>
                <span className={c("nb")}>
                  順番や時期は、開発の進み具合で変わることがあります。
                </span>
                <span className={c("nb")}>公開したものから順に、上の表へ移します。</span>
              </p>
              <ul className={c("planned-list")}>
                {PLANNED.map((f) => (
                  <li key={f.name}>
                    <span className={c("tag", "planned-tag")}>開発予定</span>
                    <b>{f.name}</b>
                    <span className={c("planned-desc")}>{f.what}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={c("section")} id="plans">
          <div className={c("wrap")}>
            <div className={c("head")}>
              <p className={c("label")}>PLAN</p>
              <h2>
                <span className={c("nb")}>無料で始めて、</span>
                <span className={c("nb")}>必要な分だけ広げる。</span>
              </h2>
              <p>
                <span className={c("nb")}>高度な相手管理やAIアシスト等が必要になったら、</span>
                <span className={c("nb")}>上位プランへ拡張できます。</span>
              </p>
            </div>
            <figure className={c("pricing-image")}>
              <Image
                src={kimaruHyou}
                alt="キマル プラン一覧。各プランの料金、AIカルテ利用時間、予約ページ数、予約受付期間、事前アンケート、リマインダー、相手管理などの比較表。"
                sizes="(max-width: 1160px) 100vw, 1120px"
              />
              <figcaption>{PLAN_IMAGE_NOTE}</figcaption>
            </figure>
            <div className={c("plans")}>
              <article className={c("card", "plan")}>
                <span className={c("tag")}>無料</span>
                <h3>無料版</h3>
                <div className={c("price")}>
                  ¥0<span> /月</span>
                </div>
                <ul>
                  <li>予約ページ 1つ</li>
                  <li>受付 2ヶ月先まで</li>
                  <li>事前アンケート 2問</li>
                  <li>22分前リマインド</li>
                </ul>
                <a className={c("btn", "secondary")} href="/signup.html">
                  無料で始める
                </a>
              </article>
              <article className={c("card", "plan", "popular")}>
                <span className={c("tag", "limited")}>先着100名限定</span>
                <h3>Pro</h3>
                <div className={c("price")}>
                  ¥980<span> /月</span>
                </div>
                <p className={c("regular-price")}>通常 ¥2,200 /月</p>
                <ul>
                  <li>予約ページ 2つ</li>
                  <li>受付 6ヶ月先まで</li>
                  <li>アンケート 5問</li>
                  <li>相手管理と印象スコア</li>
                </ul>
                <Link className={c("btn", "primary")} href="/plan">
                  Proを見る
                </Link>
              </article>
              <article className={c("card", "plan")}>
                <span className={c("tag")}>近日</span>
                <h3>Premium</h3>
                <div className={c("price")}>
                  ¥4,800<span> /月</span>
                </div>
                <ul>
                  <li>Proの全機能</li>
                  <li>予約ページ 5つ</li>
                  <li>AIアシスト</li>
                  <li>次の一手の提案</li>
                </ul>
                <a className={c("btn", "secondary")} href="/ai-assist.html">
                  AIアシストを見る
                </a>
              </article>
            </div>
            {/* 先着100名の先行価格の条件（#377）。到達の基準・到達後・解約後の扱いをカードの外に 1 か所で書く。
                ユーザー決定（2026-09-05）: 基準は「Pro プランの利用者が 100 名」。数え方の内訳（プレミアム・Cat Key の扱い）や
                「プレミアムに先行価格は無い」といった除外の説明は載せない（読み手に要らない情報で条件文が長くなる） */}
            <div className={c("presale")} id="presale">
              <h3>先着100名の先行価格について</h3>
              <ul>
                {PRESALE_TERMS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={c("final")}>
          <div className={c("wrap")}>
            <h2>
              会う前から、差がつく。
              <br />
              ご縁を、予定で終わらせない。
            </h2>
            <p>
              <span className={c("nb")}>1対1の面談を、</span>
              <span className={c("nb")}>ただの日程調整で終わらせない。</span>
              <span className={c("nb")}>会う前から会った後まで、</span>
              <span className={c("nb")}>キマルで整えましょう。</span>
            </p>
            <div className={c("hero-actions")}>
              <div className={c("cta-stack")}>
                <a className={c("btn", "primary")} href="/signup.html">
                  無料で始める
                </a>
                <span className={c("cta-note")}>Google連携で登録30秒</span>
              </div>
              <Link className={c("btn", "secondary")} href="/plan">
                料金を見る
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className={c("wrap", "footer-in")}>
          <div>
            <a href="/terms.html">利用規約</a>
            <a href="/privacy.html">プライバシーポリシー</a>
            <a href="/tokushoho.html">特定商取引法に基づく表記</a>
          </div>
          <span>© 2026 キマル</span>
        </div>
      </footer>
    </div>
  );
}

// 機能一覧（旧 index.html の表と同じ 9 行・同じ文言）
const FEATURES: ReadonlyArray<{ name: string; what: string; why: string }> = [
  {
    name: "予約ページ作成",
    what: "面談用の予約URLを作成し、相手に送るだけで受付できます。",
    why: "「いつ空いてますか？」の往復を減らし、相手が自分で空き枠を選べます。",
  },
  {
    name: "Googleカレンダー連携",
    what: "既存予定を避けて、予約可能な時間だけを表示します。",
    why: "ダブルブッキングを防ぎ、予定確認の手間を減らせます。",
  },
  {
    name: "予約受付期間設定",
    what: "2ヶ月先、6ヶ月先など、プランに応じた受付期間を設定できます。",
    why: "先すぎる予定や直前すぎる予約をコントロールできます。",
  },
  {
    name: "事前アンケート",
    what: "相談内容、目的、聞きたいことを予約時に回収できます。",
    why: "面談前から相手の状況がわかり、当日の会話が深くなります。",
  },
  {
    name: "Gmailリマインダー",
    what: "面談前にメールで予定を知らせます。",
    why: "うっかり忘れや直前の確認漏れを防げます。",
  },
  {
    name: "Google Meet / Zoom URL発行",
    what: "オンライン面談のURLを予約に紐づけて案内できます。",
    why: "当日に「URLどこですか？」が起きにくくなります。",
  },
  {
    name: "相手管理",
    what: "会った人の情報、面談メモ、履歴を残せます。",
    why: "一度会った人との関係を、次回の提案やフォローにつなげられます。",
  },
  {
    name: "印象スコア・相手分析",
    what: "相手の傾向や相性を整理し、理解を深めます。",
    why: "話し方や提案内容を相手に合わせやすくなります。",
  },
  {
    name: "ピンポイント日程調整",
    what: "候補の日時を数件だけ提示し、相手に選んでもらうURLを発行します。",
    why: "予約ページを公開しなくても、1対1の調整だけを手早く済ませられます。",
  },
  {
    name: "顧客一覧の並び替え",
    what: "会った人の一覧を、面談が近い順・古い順・名前順などで並び替えられます。",
    why: "フォローすべき相手が上から順に見つかります。",
  },
  {
    // 会話の要約はまだ無い（開発予定の「AI要約」）。いまの AI アシストは相手の情報から次の一手を提案する機能なので、その範囲で書く（#377）
    name: "AI連携モード",
    what: "相手の情報と面談メモから、次回アクションのヒントを提案します。",
    why: "面談後の振り返りとフォローが速くなります。",
  },
];

// 開発予定の機能（#377・issue の区分どおり）。未完成のものを「使える」と読ませないため、表とは別の枠に出す。
// 説明は「何を作る予定か」だけを書き、効果や時期は約束しない
const PLANNED: ReadonlyArray<{ name: string; what: string }> = [
  {
    name: "自作会議Bot・自動文字起こし・AI要約",
    what: "オンライン面談にBotが参加して音声を記録し、文字起こしと要約を自動で作る機能を開発しています。",
  },
  {
    name: "タスク管理",
    what: "面談で決まった宿題や、次回までのやることを相手ごとに記録します。",
  },
  {
    name: "24時間前リマインド",
    what: "22分前に加えて、前日にもメールでお知らせします（希望者のみ）。",
  },
  {
    name: "再アポ",
    what: "会った人の画面から、前回の条件を引き継いで次の日程調整を作ります。",
  },
  {
    name: "会員プロフィール共有",
    what: "予約が成立したときに、設定に応じてお互いのプロフィールを共有します。",
  },
  {
    name: "MCP・API連携",
    what: "キマルのデータを、自分の使うAIツールや他のサービスから扱えるようにします。",
  },
];

// 先着100名の先行価格の条件（#377・docs 7章と system-spec の決定 2026-08-06、文言はユーザー決定 2026-09-05）。
// 到達の基準は「Pro プランの利用者が 100 名」と書き、数え方の内訳や除外の説明は載せない。
// 「ずっと据え置き」とは書かない: 解約後の再契約・プラン変更では失効する決定になっている。
// /plan 側の同じ文言は public/i18n.js の pricing.presale.* にある（LP は日本語のみなので直書き）
const PRESALE_TERMS: readonly string[] = [
  "Pro を先行価格 ¥980/月 でご利用いただけるのは、Pro プランのご利用者が100名に達するまでです。",
  "Pro プランが100名に達した後、Pro の新規お申し込みは通常価格 ¥2,200/月 になります。",
  "先行価格で契約された方は、契約を続けている間は ¥980/月 のままです。解約後に再契約した場合やプランを変更した場合は、通常価格になります。",
];

// プラン表の画像に写っている「AIカルテ（会議Bot）」「AI連携モード（自動記録・要約）」「Master」はまだ提供していない。
// 画像は差し替え待ちなので、注記で補う（#377）
const PLAN_IMAGE_NOTE =
  "※ 画像内の「AIカルテ」「AI連携モード（自動記録・要約）」と Master プランは開発予定で、まだ提供していません。";
