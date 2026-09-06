"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ENTRIES, GROUPS, findEntry, resolvePages, textKey } from "@/features/guide/entries";
import { useT } from "@/lib/i18n/client";

import { GuideModal } from "./GuideModal";
import s from "./GuidePage.module.css";

// 使い方ガイドの一覧（#353 の /guide.html を #423 で Next に移した）。
// 並べるのは項目名だけ。ここで見せたいのは「どの説明があるか」なので、図や要約が付くと 1 件あたりが縦に伸びて
// 目的の項目を探しにくくなる。要約（lead）は Modal の冒頭にだけ出す。
// 項目名は features/guide/entries.ts の ENTRIES / GROUPS だけが持つ（JSX に直書きしない）。

// ---- 「どの項目が開いているか」は URL の #<key> が持つ（旧 guide.js と同じ）------------------
// なぜ state ではなく URL か: 案内メールからの直リンク（/guide#zoom）と、画面で開いた項目の共有を
// 同じ 1 つの経路で扱うため。state と URL の二重管理にすると、読み込み時の同期を effect で書くことになり、
// 描画のあとにもう一度描き直す（＝一覧が一瞬見えてから Modal が開く）。
// history.replaceState では hashchange が飛ばないので、書き換えたら自分で購読者へ知らせる。
// pushState にしないのは、閉じる操作を「戻る」と二重に持たせないため。
const listeners = new Set<() => void>();

function subscribeHash(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("hashchange", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("hashchange", onChange);
  };
}

const getHash = (): string => decodeURIComponent(window.location.hash.slice(1));
// サーバー描画（静的 HTML）に Modal は無い。hydration をずらさないよう、初回は「開いていない」を返す
const getServerHash = (): string => "";

/** 開いている項目を URL に載せる（null で消す）。ページ番号は載せない——案内したいのは説明の単位で、その何ページ目かではない */
function writeHash(key: string | null): void {
  const { pathname, search } = window.location;
  history.replaceState(null, "", key ? `${pathname}${search}#${key}` : `${pathname}${search}`);
  for (const listener of listeners) listener();
}

export function GuidePage() {
  const t = useT("guide");
  const hash = useSyncExternalStore(subscribeHash, getHash, getServerHash);
  const entry = findEntry(hash);
  const [page, setPage] = useState(0);
  // 閉じたときに、開く前の場所へフォーカスを戻す（キーボードで一覧をたどっている人が迷子にならない）
  const lastFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    writeHash(null);
    setPage(0);
    lastFocus.current?.focus();
  }, []);

  const openEntry = (key: string) => {
    lastFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPage(0);
    writeHash(key);
  };

  // 背面の一覧をスクロールさせない（旧 body.modal-open）
  useEffect(() => {
    if (!entry) return undefined;
    document.body.dataset.modalOpen = "true";
    return () => {
      delete document.body.dataset.modalOpen;
    };
  }, [entry]);

  // Esc で閉じる／左右キーで送る。送りは 1 項目の中だけなので、単ページの項目では何もしない
  useEffect(() => {
    if (!entry) return undefined;
    const total = resolvePages(entry).length;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (total < 2) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setPage((current) => Math.min(total - 1, current + 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPage((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entry, close]);

  return (
    <>
      <main>
        <section className={`section shell ${s.tight}`}>
          <div className="pagehead">
            <span className="eyebrow">{t("index.eyebrow")}</span>
            <h1>{t("index.heading")}</h1>
            <p className="sub">{t("index.lead")}</p>
          </div>

          <div className={s.index} data-testid="guide-index">
            {GROUPS.map((group) => {
              const entries = ENTRIES.filter((item) => item.group === group);
              if (entries.length === 0) return null;
              return (
                <section key={group} data-testid="guide-group">
                  <div className={s.groupHead}>
                    <p className="eyebrow">{t(`group.${group}`)}</p>
                    <p className="muted">{t(`group.${group}.desc`)}</p>
                  </div>
                  <ul className={s.list}>
                    {entries.map((item) => (
                      <li key={item.key}>
                        <button
                          className={s.item}
                          type="button"
                          data-testid={`guide-item-${item.key}`}
                          onClick={() => openEntry(item.key)}
                        >
                          <b>{t(textKey(item.key, "title"))}</b>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </section>
      </main>

      {entry ? (
        // 別の項目へ hash が変わったときに、前の項目のページ番号が残らないようにする
        <GuideModal
          entry={entry}
          page={Math.min(page, resolvePages(entry).length - 1)}
          onPage={setPage}
          onClose={close}
        />
      ) : null}
    </>
  );
}
