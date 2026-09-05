# STT PoC（faster-whisper・CPU）— #393 T-301〜305 のうち手元の PC でできる範囲

> 使い捨ての PoC。本番の STT ワーカーは新スタック（`docs/ai-bot/system-spec.md` の T-302）で別に作る。
> ここでは **「Bot が会議に入って文字起こしだけ出す」** の後半＝文字起こしを、手元の CPU で成立させて数字を取る。

## 目的

1. 音声 1 本を **faster-whisper（CTranslate2・CPU・int8）** で日本語の文字起こしにできることを確かめる（T-302 の最小形）
2. **完了判定**（`completed` / `completed_with_gaps` / `incomplete`）のルールをコードにして固定する（T-303 の STT 側）
3. **CPU ベンチマーク**（RTF・モデル読込＝固定起動費・ピークメモリ・日本語品質・固有名詞の誤り数）を同じ音声で取り、
   spec 7.2.2.1 の「想定 RTF」を実測に置き換える材料にする（T-304 の CPU 部分）

## 前提（この PC）

| 項目 | 値 |
|---|---|
| CPU | Intel Core i5-8265U（4 コア 8 スレッド・1.6 GHz・ノート PC 向け） |
| RAM | 7.7 GB（他の作業と同居。計測中の空きは 4〜4.7 GB） |
| GPU | **なし**（GPU 計測は未実施） |
| OS | WSL2（Linux）。`ffmpeg` / `open_jtalk` / `espeak-ng` のバイナリなし・sudo なし |
| Python | システムは 3.8 なので使わず、`uv` で入れた **3.12** の仮想環境（指示は 3.11 だったが、3.12 が既に手元にあり全依存に wheel があるのでそのまま使った） |
| 方針 | **外部 STT API は実装しない**（決定済み・未決定 No.19）。faster-whisper を CPU で回す。モデルは `.models/` に落として使う（本番はイメージ同梱） |

**計測時は別の重い作業（Next.js のビルド＋Playwright）が同時に走っていた。** RTF は悲観側の値で、静かな環境ではもう少し速い。
スレッドは **4 本に固定**（`--threads 4`。8 論理コアだが同居のため半分にした）。

## セットアップ

```bash
cd poc/stt
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python make_samples.py          # テスト音声を samples/ に合成（初回は Open JTalk 辞書 23 MB を DL）
.venv/bin/python -m unittest test_check_complete -v
```

- モデルは初回実行時に Hugging Face から `.models/` へ落ちる（small 約 460 MB・medium 約 1.5 GB）。`.gitignore` 済み
- `ffmpeg` は要らない。faster-whisper は **PyAV** で復号するので WAV / M4A / MP3 / MP4 音声をそのまま読める（M4A は実際に確かめた。下記）

## 使い方

### 文字起こし（Zoom / Meet の録音をそのまま渡す）

```bash
.venv/bin/python transcribe.py path/to/zoom.m4a                 # small / int8 / 4 スレッド / 日本語
.venv/bin/python transcribe.py path/to/zoom.m4a --model medium  # 精度を見たいとき（RAM 2.3 GB 以上・遅い）
```

書き出し（音声と同じ場所。`--out-dir` で変更・`--tag small` で名前にモデルを挟む）:

- `<name>.segments.json` — 区間ごとの `start` / `end` / `text` / `avg_logprob` / `no_speech_prob` と、計測値（音声長・モデル読込秒・文字起こし秒・RTF・ピーク RSS）
- `<name>.txt` — 本文だけ（1 区間 1 行）

stderr に経過時間と RTF（実時間比＝処理時間 ÷ 音声長）を出す。

### 完了判定

```bash
.venv/bin/python check_complete.py path/to/zoom.m4a path/to/zoom.segments.json [--expected-duration 3600]
# 終了コード 0 = completed / 1 = completed_with_gaps / 2 = incomplete
```

### ベンチマーク

```bash
.venv/bin/python bench.py --models small medium \
  --samples samples/meeting_short.wav samples/meeting_gap.wav --out bench_result.md
```

モデルごとに `transcribe.py` を **別プロセス**で起動する（ピーク RSS はプロセスの最大値なので、同じプロセスで続けて回すと混ざる）。
空きメモリが足りないモデル（medium は 3 GB 未満）は飛ばして表に理由を書く。

## テスト音声と品質の数え方（T-304「品質評価の手順を先に決める」）

実会議の録音は手元に無いので、**pyopenjtalk（Open JTalk 同梱・オフライン TTS）** で会議風の 6 発話（2 話者を声の高さで区別）を合成した。
正解テキストが分かるので精度を数えられる。音声は決定的に再生成できるため commit せず、`make_samples.py` と期待テキスト・固有名詞リストだけ置く。

| ファイル | 内容 |
|---|---|
| `samples/meeting_short.wav` | 6 発話・55.8 秒・発話間に 1〜2 秒の間 |
| `samples/meeting_gap.wav` | 同じ発話列の 3 発話目の後に **20 秒の無音**（「無音で説明できる隙間」の確認用）・74.0 秒 |
| `samples/*.expected.txt` | 採点用の期待テキスト（Whisper の書き方に寄せてアラビア数字） |
| `samples/*.terms.json` | 固有名詞・数値の採点リスト（7 項目。表記ゆれは候補のどれかが含まれていれば正解） |

- **CER（文字誤り率）** = 句読点・空白を除いた期待テキストとの編集距離 ÷ 期待文字数
- **固有名詞の誤り数** = リストの各項目について、候補表記がどれも出力に無ければ 1（キマル／佐藤／高橋／渋谷／10月15日／火曜日／午後3時）

合成音は雑音も重なりも無い「易しい音声」なので、**実会議の録音では CER はこれより悪くなる**（特に small）。数字は上限の目安として読む。

## 計測結果（2026-09-05・この PC・CPU int8・4 スレッド・別作業と同居）

| 構成 | 音声 | モデル読込 | 文字起こし | RTF | ピーク RSS | 1時間会議の見込み | 完了判定 | 精度 |
|---|---|---:|---:|---:|---:|---:|---|---|
| small / int8 / CPU | meeting_short.wav（56s） | 4.7s | 10.6s | **0.190** | 1296 MB | 11 分 | completed | CER 3.0% / 固有名詞誤り 0/7 |
| medium / int8 / CPU | meeting_short.wav（56s） | 78.0s ※1 | 42.4s | **0.759** | 2971 MB ※1 | 47 分 | completed | CER 2.1% / 固有名詞誤り 1/7（キマル→木丸） |
| small / int8 / CPU | meeting_gap.wav（74s） | 2.2s | 17.0s | **0.230** | 1290 MB | 14 分 | completed | CER 3.0% / 固有名詞誤り 0/7 |
| medium / int8 / CPU | meeting_gap.wav（74s） | 9.9s | 50.1s | **0.677** | 2278 MB | 41 分 | completed | CER 3.0% / 固有名詞誤り 1/7（キマル→木丸） |
| large-v3-turbo / int8 / CPU | — | — | — | — | — | — | — | **未計測**（空き RAM 4 GB では読み込めない） |
| large-v3-turbo / GPU | — | — | — | — | — | — | — | **未計測**（GPU なし） |

※1 初回で 1.5 GB のモデル DL を含む。2 回目（meeting_gap）が読込・RSS の実力値。
※ M4A 入力（`meeting_short.m4a`・AAC 423 KB・PyAV で作成）も small で同じ区間列が出て `completed` になった（RTF 0.37 だったが `npm ci` と同時実行中の値）。

生の出力と全文は [`bench_result.md`](./bench_result.md)。

### 精度の所感

- **small**: 内容は全部拾えている。誤りは「今日は→強恩は」（1 か所）、「押さえて→抑えて」（同音）、区間境界で「ました」が重複。固有名詞は 7/7 正解。
  句読点が途中から落ちる（VAD で切った後半の区間）。
- **medium**: 句読点まで自然で、「今日は」も正しい。ただし **「キマル」を「木丸」にした**（未知のカタカナ語を漢字に寄せる癖）。
  CER の差は 3.0% → 2.1% と小さいのに、処理時間は **4 倍**。
- 固有名詞（サービス名・人名）は、どのモデルでも **ホスト側の語彙を `initial_prompt` に渡す**方が効く。T-305 の実名補正 UI と同じ語彙を流用できる。

## 1 時間の会議をこの PC（CPU のみ）で処理する見込み

`処理時間 ≈ モデル読込 + 3600 秒 × RTF`（読込は 1 回。実測 RTF は同居作業ありの値）

| モデル | RTF（実測） | 1 時間会議 | spec 7.2.2.1 の想定 RTF | 判定 |
|---|---:|---:|---:|---|
| small / int8 | 0.19〜0.23 | **約 12〜14 分** | 0.12 | NFR の **RTF ≤ 0.25 を満たす**。原価に置くと ¥38.2/h × 0.23 ≈ ¥8.8/音声1h（想定 ¥9.6 の範囲内） |
| medium / int8 | 0.68〜0.76 | **約 41〜47 分** | 0.30 | NFR を **3 倍**超える。¥26〜29/音声1h。CPU では成立しない |

Fargate 4 vCPU はこのノート PC の 4 スレッドより速い可能性が高いが、**medium が想定の 0.30 に届く見込みは薄い**。
small は「会議終了から 15 分以内に文字起こし」を CPU 1 タスクで満たせる。

## 完了判定の考え方（`check_complete.py`）

spec FR-3.5〜3.7 の「**全区間が成功した会議だけ `completed` にして音声を削除**。一部欠けは `completed_with_gaps`（音声 72 時間保持）。
欠損は `incomplete`（14 日保持）」の **STT 側**。manifest（欠番・ハッシュ）の検証は上流のサーバが行い、ここでは manifest を通った音声に
対して「文字起こしが音声を取りこぼしていないか」を見る。判定は **音声を削除してよいかの門番**なので、迷ったら `completed` 側に倒さない。

1. **音声長**: `--expected-duration`（manifest の `total_seconds`）より 2% 以上短ければ、音声そのものが欠けている → 文字起こしをやり直しても直らないので即 `incomplete`
2. **発話の被覆率**: 音声を 0.5 秒の枠に切り、RMS が雑音床（下位 10% の枠の RMS）の 4 倍を超える枠を「発話あり」とみなす。
   発話ありの枠のうち、どこかの区間（前後 0.3 秒の余裕付き）に入っている割合が coverage。**無音は分母に入れない**——
   VAD が無音を落とすと区間の隙間が自然に生まれるので、「隙間の長さ」だけで判定すると無音の多い会議が全部 `incomplete` になる
3. **説明のつかない隙間**: 5 秒以上の隙間（先頭・末尾を含む）で、その中に 1 秒以上「発話あり」があるもの。無音で説明できる隙間は数えない（`meeting_gap.wav` の 20 秒無音は `completed`）
4. **低信頼区間**: `avg_logprob < -1.0` または `no_speech_prob > 0.6`。幻聴の疑いとして一覧に出すだけで判定は変えない（`--strict` で被覆から外す）

| 判定 | 条件 | サーバの扱い（spec） |
|---|---|---|
| `incomplete` | 音声長が申告より短い／coverage < 90% | 音声 14 日保持・管理者通知・再実行 |
| `completed_with_gaps` | 説明のつかない隙間がある／coverage < 95% | 要約へ回すが欠損を明示・音声 72 時間保持 |
| `completed` | 上記以外 | 音声を即時削除 |

`test_check_complete.py` が「20 秒の無音は completed」「発話 1 つ丸ごと欠けは incomplete」「末尾 2 秒欠けは completed_with_gaps」
「manifest より短ければ完璧な文字起こしでも incomplete」「無音だけの録音で落ちない」を固定している。
閾値（4 倍・95%・90%・5 秒）は合成音で決めた値で、**実会議音声で見直す前提**。

## spec からの逸脱・割り切り

- **音声は 1 本まるごと**処理する。spec の「15 分セグメント単位で処理し失敗セグメントだけ再試行（FR-2.5・FR-3.2）」は、Bot 側の分割アップロードができてから。
  1 本処理でも `segments.json` は時刻付き区間列なので、後で 15 分単位に束ね直せる
- `TranscriptionProvider` インターフェース（T-301）は TypeScript 側の話なのでここでは作っていない。`transcribe_file()` の戻り値（区間列＋計測値）がその `TranscriptionResult` の叩き台
- 話者分離（T-305・`speaker_1/2/unknown`）は未着手。faster-whisper 単体では出ないので、別モデル（pyannote 等）か Zoom/Meet 側の話者別音声が要る
- テスト音声は TTS の合成音。実会議の録音（雑音・かぶり・固有名詞）での検証は残っている
- **large-v3-turbo と GPU は未計測**（RAM・GPU の都合）。spec 7.2.2.1 の表のうち埋まったのは small / medium の CPU 2 行だけ

## 残る課題と次の一手

1. **実会議の録音で測り直す**（T-304 の本題）。Zoom/Meet の m4a をそのまま `transcribe.py` に渡せる。固有名詞リストを会議ごとに用意して誤り数を数える
2. **large-v3-turbo / int8 / CPU** は空き RAM 6 GB 以上の環境で、**GPU（T4）** は EC2 g4dn.xlarge のスポットで 1 回だけ測って表を埋める
3. **`initial_prompt` にホストの語彙**（サービス名・参加者名）を入れて固有名詞の誤りが減るか見る。T-305 の実名補正 UI と語彙を共有できる
4. **完了判定の閾値**を実録音で見直す（雑音床の推定・低信頼の扱い）。`deferred`（STT 障害時の待機）はワーカー側の状態なのでここには無い
5. Bot との接続: Bot が上げた 15 分セグメントを順に `transcribe_file()` に流し、区間の時刻にセグメントの開始オフセットを足して結合する。`check_complete.py` は結合後の 1 本に対して掛ける
6. **判断**: PoC の CPU 構成は **small / int8** で進める（RTF 0.2・1.3 GB・Fargate 4 vCPU/8 GB に収まる）。medium は CPU では成立しない。
   実録音で small の CER が許容を超えるなら、CPU で medium にするのではなく GPU（T4）で large-v3-turbo を測る方が筋がよい
