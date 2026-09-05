"use client";

import { CatKeyForm } from "@/features/pricing/CatKeyForm";
import { useT } from "@/lib/i18n/client";

import s from "./PlanPage.module.css";

// 料金・プラン（#419）。旧 public/plan.html を文言・構造・見た目を変えずに移した。
// - 文言は pricing.* / home.*（比較表の見出しと「無料で始める」）から。3 言語は StaticI18nProvider が Cookie で差し替える
// - 出し分け（.guest-only / .app-only / .plan-free-only / .plan-paid-only）は旧と同じクラス（body[data-auth] と body.plan-*）
// - 旧ページへのリンク（/signup.html /square.html /dashboard.html /ai-assist.html /login.html）は <a>
// Client Component なのは、言語切替で文言を差し替えるため

export function PlanPage() {
  const t = useT("pricing");
  const th = useT("home");

  return (
    <main>
      <section className="section">
        <div className="shell">
          <div className="pagehead">
            <span className="eyebrow">{t("eyebrow")}</span>
            <h1>{t("heading")}</h1>
            <p className="sub">{t("lead")}</p>
          </div>

          <div className="actions">
            <a className="button primary guest-only" href="/signup.html">
              {th("hero.startFree")}
            </a>
            <a className="button primary app-only plan-free-only" href="/square.html">
              {t("startPro")}
            </a>
            <a className="button primary app-only plan-paid-only" href="/dashboard.html">
              {t("toHome")}
            </a>
            <a className="button secondary" href="#compare">
              {t("compareCta")}
            </a>
          </div>

          {/* 3 プラン */}
          <div className="plans">
            <article className="plan">
              <span className="plan-tag">{t("free.tag")}</span>
              <div className="plan-name">{t("free.name")}</div>
              <div className="plan-price">
                ¥0<span>{t("priceUnit")}</span>
              </div>
              <p className="muted plan-sub">{t("free.subdesc")}</p>
              <ul>
                <li>{t("free.f1")}</li>
                <li>{t("free.f2")}</li>
                <li>{t("free.f3")}</li>
                <li>{t("free.f4")}</li>
                <li>{t("free.f5")}</li>
                <li>{t("free.f6")}</li>
              </ul>
              <a className="button secondary guest-only" href="/signup.html">
                {th("hero.startFree")}
              </a>
              <a className="button secondary app-only" href="/dashboard.html">
                {t("toHome")}
              </a>
            </article>

            <article className="plan is-pop">
              {/* 先着100名の先行価格（#377）。札を「人気」から「先着100名限定」に替え、価格の下に通常価格を出す。
                  条件（数え方・終わり方）はカードの外の #presale に 1 か所で書く */}
              <span className="plan-tag">{t("presale.tag")}</span>
              <div className="plan-name">{t("pro.name")}</div>
              <div className="plan-price">
                ¥980<span>{t("priceUnit")}</span>
              </div>
              <p className={`muted ${s.regular}`}>{t("presale.regular")}</p>
              <p className="muted plan-sub">{t("pro.subdesc")}</p>
              <ul>
                <li>{t("pro.f1")}</li>
                <li>{t("pro.f2")}</li>
                <li>{t("pro.f3")}</li>
                <li>{t("pro.f4")}</li>
                <li>{t("pro.f5")}</li>
                <li>{t("pro.f6")}</li>
              </ul>
              <a className="button primary guest-only" href="/signup.html">
                {th("hero.startFree")}
              </a>
              <a className="button primary app-only plan-free-only" href="/square.html">
                {t("startPro")}
              </a>
              <a className="button primary app-only plan-paid-only" href="/dashboard.html">
                {t("toHome")}
              </a>
            </article>

            <article className="plan is-ai">
              <span className="plan-tag">{t("premium.comingSoon")}</span>
              <div className="plan-name">{t("premium.name")}</div>
              <div className="plan-price">
                ¥4,800<span>{t("priceUnit")}</span>
              </div>
              <p className="plan-sub plan-sub-ai">{t("premium.subdesc")}</p>
              <ul>
                <li>{t("premium.f1")}</li>
                <li>{t("premium.f2")}</li>
                <li>{t("premium.f3")}</li>
                <li>{t("premium.f4")}</li>
                <li>{t("premium.f5")}</li>
              </ul>
              <a className="button btn-aurora guest-only" href="/signup.html">
                {t("premium.ctaGuest")}
              </a>
              <a className="button btn-aurora app-only" href="/ai-assist.html">
                {t("premium.ctaApp")}
              </a>
            </article>
          </div>
          {/* 先行価格の条件（#377）。プレミアムに先行価格が無いことも含めて明示する（ユーザー決定 2026-09-05） */}
          <div className={`panel ${s.presale}`} id="presale">
            <h3>{t("presale.heading")}</h3>
            <ul>
              <li>{t("presale.l1")}</li>
              <li>{t("presale.l2")}</li>
              <li>{t("presale.l3")}</li>
              <li>{t("presale.l4")}</li>
            </ul>
          </div>
          <p className="muted plan-allnote">{t("allplans.note")}</p>
          <p className="muted plan-allnote">{t("note")}</p>
        </div>
      </section>

      {/* 比較表 */}
      <section className={`section ${s.tight}`} id="compare">
        <div className="shell">
          <div className="sec-head">
            <span className="eyebrow">{t("compare.eyebrow")}</span>
            <h2>{t("compare.heading")}</h2>
          </div>
          <div className={`panel ${s.panelGap}`}>
            <div className={`table-wrap ${s.flatWrap}`}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{th("plan.th.feature")}</th>
                    <th>{th("plan.th.free")}</th>
                    <th>{th("plan.th.pro")}</th>
                    <th>{th("plan.th.premium")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{th("plan.price.label")}</td>
                    <td>¥0</td>
                    <td>
                      ¥980<small className={s.cmpNote}>{t("presale.cmpNote")}</small>
                    </td>
                    <td>¥4,800</td>
                  </tr>
                  <tr>
                    <td>{t("cmp.pages.label")}</td>
                    <td>{t("cmp.pages.free")}</td>
                    <td>{t("cmp.pages.pro")}</td>
                    <td>{t("cmp.pages.premium")}</td>
                  </tr>
                  <tr>
                    <td>{t("cmp.range.label")}</td>
                    <td>{t("cmp.range.free")}</td>
                    <td>{t("cmp.range.pro")}</td>
                    <td>{t("cmp.range.premium")}</td>
                  </tr>
                  <tr>
                    <td>{t("cmp.survey.label")}</td>
                    <td>{t("cmp.survey.free")}</td>
                    <td>{t("cmp.survey.pro")}</td>
                    <td>{t("cmp.survey.premium")}</td>
                  </tr>
                  {/* ピンポイント日程調整は全プラン。差は本数・候補数・期限・押さえの有無（#338） */}
                  <tr>
                    <td>{t("cmp.pinpoint.label")}</td>
                    <td>{t("cmp.pinpoint.free")}</td>
                    <td>{t("cmp.pinpoint.pro")}</td>
                    <td>{t("cmp.pinpoint.premium")}</td>
                  </tr>
                  <tr>
                    <td>{t("cmp.meet.label")}</td>
                    <td>✓</td>
                    <td>{t("cmp.meet.pro")}</td>
                    <td>{t("cmp.meet.premium")}</td>
                  </tr>
                  <tr>
                    <td>{t("cmp.contacts.label")}</td>
                    <td>{t("cmp.contacts.free")}</td>
                    <td>{t("cmp.contacts.pro")}</td>
                    <td>{t("cmp.contacts.premium")}</td>
                  </tr>
                  <tr>
                    <td>{t("cmp.profile.label")}</td>
                    <td>—</td>
                    <td>✓</td>
                    <td>✓</td>
                  </tr>
                  <tr>
                    <td>{t("cmp.fortune.label")}</td>
                    <td>—</td>
                    <td>✓</td>
                    <td>✓</td>
                  </tr>
                  <tr>
                    <td>{t("cmp.ai.label")}</td>
                    <td>—</td>
                    <td>—</td>
                    <td>{t("cmp.ai.premium")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted plan-allnote">{t("cmp.note")}</p>
          </div>
          <div className="actions">
            <a className="button primary guest-only" href="/signup.html">
              {th("hero.startFree")}
            </a>
            <a className="button primary app-only plan-free-only" href="/square.html">
              {t("startPro")}
            </a>
            <a className="button primary app-only plan-paid-only" href="/dashboard.html">
              {t("toHome")}
            </a>
            <a className="button secondary app-only" href="#cat-key">
              {t("catkeyCta")}
            </a>
          </div>
        </div>
      </section>

      {/* Cat Key */}
      <section className={`section ${s.tight}`} id="cat-key">
        <div className="shell">
          <div className="panel">
            <span className="eyebrow">{t("catkey.eyebrow")}</span>
            <h2>{t("catkey.heading")}</h2>
            <p className="muted">{t("catkey.desc")}</p>
            {/* Cat Key の Pro は先着100名の人数に入らない（#377）。申請する人が「自分で枠を使う」と誤解しないように */}
            <p className="muted">{t("presale.catkeyNote")}</p>
            <p className="message guest-only">
              <span>{t("catkey.loginNote")}</span>
              <a href="/signup.html">{t("catkey.signupLink")}</a>
              <span>{t("catkey.or")}</span>
              <a href="/login.html">{t("catkey.loginLink")}</a>
              <span>{t("catkey.afterLogin")}</span>
            </p>
            <CatKeyForm />
          </div>
        </div>
      </section>
    </main>
  );
}
