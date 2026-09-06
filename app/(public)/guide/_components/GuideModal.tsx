"use client";

import { Fragment, useEffect, useRef, type MouseEvent } from "react";

import { resolvePages, textKey, type GuideEntry } from "@/features/guide/entries";
import { useT } from "@/lib/i18n/client";

import s from "./GuideModal.module.css";

// 1 項目ぶんの説明 Modal（#353・#423）。部品（lead / points / steps / fields / note）を並べるだけで、
// 持っていない部品は出さない。文言キーは features/guide/entries.ts の規則（単ページ = <key>.* /
// 複数ページ = <key>.p<n>.*）から機械的に決まる。
// 送りは 1 項目の中のページ間だけ。項目をまたぐ送りは持たない（次の項目は一覧に戻って選ぶ）。

type GuideModalProps = {
  entry: GuideEntry;
  page: number;
  onPage: (page: number) => void;
  onClose: () => void;
};

/** 1..n の配列（部品の件数ぶん繰り返す） */
const times = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

export function GuideModal({ entry, page, onPage, onClose }: GuideModalProps) {
  const t = useT("guide");
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const pages = resolvePages(entry);
  const current = pages[page];
  const multi = pages.length > 1;

  // 開いたら閉じるボタンへフォーカスを移す（背面の一覧に残さない）
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // 送ったら本文の先頭から読ませる（前のページの途中位置が残ると、送った先が空に見える）
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [page]);

  if (!current) return null;

  // 背景（Modal の外側）を押したら閉じる。中身の押下では閉じない
  const onOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    // 背景押下は補助の導線。キーボードからは Esc（GuidePage が拾う）と閉じるボタンで閉じられる
    <div className={s.overlay} onClick={onOverlayClick} data-testid="guide-modal">
      <div
        className={s.guide}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-entry-title"
        ref={panelRef}
      >
        <button
          className={s.close}
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          data-testid="guide-close"
          ref={closeRef}
        >
          ✕
        </button>

        {/* 複数ページの項目は、見出しに今のページ名を出し、項目名は上のラベルへ回す
            （見出しが項目名のままだと、送っても同じ画面に見える）。 */}
        <div className={s.head}>
          <p className="eyebrow" data-testid="guide-eyebrow">
            {multi ? t(textKey(entry.key, "title")) : t(`group.${entry.group}`)}
          </p>
          <h2 id="guide-entry-title" data-testid="guide-heading">
            {multi ? t(textKey(current.prefix, "title")) : t(textKey(entry.key, "title"))}
          </h2>
        </div>

        <div className={s.body} data-testid="guide-body">
          <p className={s.lead}>{t(textKey(current.prefix, "lead"))}</p>

          {current.points > 0 ? (
            <ul className={s.points}>
              {times(current.points).map((i) => (
                <li key={i}>{t(textKey(current.prefix, `point${i}`))}</li>
              ))}
            </ul>
          ) : null}

          {current.steps > 0 ? (
            <ol className={s.steps}>
              {times(current.steps).map((i) => (
                <li key={i}>{t(textKey(current.prefix, `step${i}`))}</li>
              ))}
            </ol>
          ) : null}

          {current.fields > 0 ? (
            <dl className={s.fields}>
              {times(current.fields).map((i) => (
                <Fragment key={i}>
                  <dt>{t(textKey(current.prefix, `field${i}.name`))}</dt>
                  <dd>{t(textKey(current.prefix, `field${i}.desc`))}</dd>
                </Fragment>
              ))}
            </dl>
          ) : null}

          {current.note ? (
            <p className={s.note}>
              <span className={s.tag}>{t("note")}</span>
              <span>{t(textKey(current.prefix, "note"))}</span>
            </p>
          ) : null}
        </div>

        {entry.href ? (
          // 旧ページ（.html）と Next のページが混ざるので <a>（段階5 で全部 Next になったら Link にできる）
          <a className={`button secondary btn-sm ${s.cta}`} href={entry.href}>
            {t("open")}
          </a>
        ) : null}

        {multi ? (
          <div className={s.foot}>
            <button
              className="button secondary btn-sm"
              type="button"
              onClick={() => onPage(page - 1)}
              disabled={page === 0}
              data-testid="guide-prev"
            >
              {t("prev")}
            </button>
            <span className={s.count} data-testid="guide-count">
              {page + 1} / {pages.length}
            </span>
            <button
              className="button primary btn-sm"
              type="button"
              onClick={() => onPage(page + 1)}
              disabled={page === pages.length - 1}
              data-testid="guide-next"
            >
              {t("next")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
