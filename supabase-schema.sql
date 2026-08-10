create extension if not exists pgcrypto;

-- ⚠️ LEGACY（#25）: 旧アカウント表。現行の主アカウントは owners。新規実装は owners / owner_id を使う。
-- 誤削除リスク回避のため DROP せず非破壊で残置（整理方針: ドキュメントで明示し、コードは現行表のみ参照）。
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  plan text not null default 'free' check (plan in ('free', 'pro')),
  invite_code text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists owners (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  avatar_url text,
  slug text not null default 'demo',
  plan text not null default 'free' check (plan in ('free', 'pro', 'premium')),
  invite_code text,
  cat_key_disabled boolean not null default false,
  cat_key_pending boolean not null default false,
  trial_ends_at timestamptz,
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists owners_slug_unique on owners(slug);

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  owner_id uuid references owners(id) on delete cascade,
  display_name text not null default '',
  bio text not null default '',
  profile_url text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists google_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references owners(id) on delete cascade,
  calendar_id text not null default 'primary',
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Zoom 連携（ユーザー個別・user-level OAuth）。ホスト本人の Zoom 名義でミーティングを自動発行する。
-- トークンは暗号化して保存（crypto.js encrypt）。テーブル未適用の環境ではコード側が未連携として動く。
create table if not exists zoom_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references owners(id) on delete cascade,
  zoom_email text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
-- Zoom側でアプリを削除（deauthorize）した際に接続を消すための照合キー（Marketplace公開要件）。
-- 列未適用の環境でもコードは劣化動作する（deauth照合のみ不可）。
alter table zoom_connections add column if not exists zoom_user_id text;

-- ⚠️ LEGACY（#25）: 旧トークン表。現行は google_connections。非破壊で残置。
create table if not exists google_calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  owner_id uuid references owners(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expiry_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists booking_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  owner_id uuid references owners(id) on delete cascade,
  slug text not null unique default 'demo',
  title text not null default 'Kimaru meeting',
  description text not null default '',
  duration_minutes int not null default 30 check (duration_minutes between 30 and 120),
  buffer_before_minutes int not null default 0 check (buffer_before_minutes between 0 and 60),
  buffer_after_minutes int not null default 0 check (buffer_after_minutes between 0 and 60),
  -- 前後バッファをホスト専用のGoogleカレンダー予定として作るときのタイトル（空=予定を作らず空き枠を塞ぐだけ）。
  buffer_before_title text not null default '',
  buffer_after_title text not null default '',
  booking_range_months int not null default 2 check (booking_range_months between 1 and 6),
  location_type text not null default 'google_meet' check (location_type in ('in_person', 'google_meet', 'zoom', 'phone', 'custom_url', 'later')),
  location_value text not null default '',
  timezone text not null default 'Asia/Tokyo',
  accept_holidays boolean not null default true,
  lead_time_hours int not null default 0,
  candidate_days int,
  slot_interval_minutes int,
  active boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 受付可能時間。booking_page_id が付いた行＝その予約ページ専用の受付時間（複数ページで別々に持てる）。
-- booking_page_id が null の行はマイグレーション前の「オーナー共有」レガシー行で、
-- 自前の行を持たない予約ページのフォールバックとして読まれる（_lib/availability-core.js pageAvailability）。
create table if not exists availability_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  owner_id uuid references owners(id) on delete cascade,
  booking_page_id uuid references booking_pages(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references owners(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  booking_page_id uuid references booking_pages(id) on delete set null,
  visitor_name text not null default '',
  visitor_email text not null default '',
  -- ⚠️ LEGACY 重複（#25）: guest_name/guest_email は旧カラム。現行は visitor_*。非破壊で残置。
  guest_name text not null default '',
  guest_email text not null default '',
  topic text not null default '',
  guest_message text not null default '',
  filter_request text not null default 'none',
  visitor_birth_date date,
  visitor_birth_date_private boolean not null default false,
  birthday_message_opt_in boolean not null default false,
  relationship_profile jsonb not null default '{}'::jsonb,
  start_at timestamptz,
  end_at timestamptz,
  -- ⚠️ LEGACY 重複（#25）: start_time/end_time は旧カラム。現行は start_at/end_at。非破壊で残置。
  start_time timestamptz,
  end_time timestamptz,
  meeting_url text not null default '',
  location_type text not null default 'google_meet',
  google_event_id text,
  -- ホスト専用の前後バッファ予定（ゲスト非表示）のGoogleイベントID。キャンセル/日程変更時の削除・作り直しに使う。
  buffer_before_event_id text,
  buffer_after_event_id text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'pending')),
  created_at timestamptz not null default now()
);

create table if not exists birthday_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete cascade,
  delivery_date date not null,
  provider_message_id text not null default '',
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error_message text not null default '',
  created_at timestamptz not null default now(),
  unique (booking_id, delivery_date)
);

create table if not exists reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete cascade unique,
  provider_message_id text not null default '',
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error_message text not null default '',
  created_at timestamptz not null default now()
);

-- サンキュー＋登録案内メールの重複送信防止（#181）。booking 単位で1回だけ送る。
create table if not exists thankyou_deliveries (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete cascade unique,
  recipient_email text not null default '',
  provider_message_id text not null default '',
  status text not null default 'sent' check (status in ('sent', 'failed', 'skipped')),
  error_message text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists questionnaire_questions (
  id uuid primary key default gen_random_uuid(),
  booking_page_id uuid not null references booking_pages(id) on delete cascade,
  question_text text not null,
  is_required boolean not null default false,
  -- 回答形式（決定27）: 無料=text のみ / Pro・プレミアム=select(プルダウン)・checkbox も可。
  answer_type text not null default 'text' check (answer_type in ('text','select','checkbox')),
  options jsonb not null default '[]'::jsonb, -- select/checkbox の選択肢（文字列配列）
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- 事前アンケートの回答。
-- question_text は非正規化（#304）。予約ページを保存するたび questionnaire_questions は
-- 全削除→再作成されるため、on delete set null で question_id が抜け、質問文を引けなくなる。
-- 「その回答が何に対するものか」は回答の一部なので、回答時点の文言をここに控える。
create table if not exists questionnaire_answers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  question_id uuid references questionnaire_questions(id) on delete set null,
  question_text text not null default '',
  answer_text text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists appointment_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  visitor_email text not null,
  keywords text not null default '',
  notes text not null default '',
  next_action text not null default '',
  scores jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- 印象スコアの構造化保存（#175）。相手ごとの集約・平均算出に使う。
alter table appointment_logs add column if not exists scores jsonb not null default '{}'::jsonb;

-- 手動で追加した相手（決定27・2026-06-19）。プレミアム限定。予約していない相手も相手一覧に登録できる。
create table if not exists manual_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  topic text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

-- 会話記録（Pro）: 予約(会った1回)と1対1。相手一覧の各行から作成/編集・閲覧する（決定・行↔記録=1:1）。
-- notes/next_action/keywords＋印象スコア(scores jsonb)。列/テーブル欠如時はコード側で degrade。
create table if not exists booking_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  notes text not null default '',
  next_action text not null default '',
  keywords text not null default '',
  scores jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (booking_id)
);
-- 会話記録を「手動追加の相手」にも残せるように（決定27 拡張）: booking_id を任意化し manual_contact_id を追加。
-- 既存の予約ベースの会話記録はそのまま。手動相手は manual_contact_id に紐づく（どちらか一方が入る）。
alter table booking_notes alter column booking_id drop not null;
alter table booking_notes add column if not exists manual_contact_id uuid references manual_contacts(id) on delete cascade;
create unique index if not exists booking_notes_manual_contact_uidx on booking_notes(manual_contact_id) where manual_contact_id is not null;

create table if not exists free_signups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  purpose text not null default '',
  invite_code text not null default '',
  language text not null default 'ja',
  created_at timestamptz not null default now()
);

create table if not exists invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plan_grant text not null default 'pro' check (plan_grant in ('free', 'pro')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists cat_key_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references owners(id) on delete set null,
  email text not null default '',
  action text not null default '',
  code text not null default '',
  ip_address text not null default '',
  user_agent text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cat_key_events_owner_id_created_at_idx on cat_key_events(owner_id, created_at desc);
create index if not exists cat_key_events_email_created_at_idx on cat_key_events(email, created_at desc);

insert into invite_codes (code, plan_grant, is_active)
values ('NEKO20240222', 'pro', true)
on conflict (code) do update set plan_grant = excluded.plan_grant, is_active = excluded.is_active;

-- AIアシスト（プレミアム）の利用ログ。当月の件数で月300回上限（#190）を判定する。
create table if not exists ai_assist_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  model text not null default '',
  prompt_tokens int,
  completion_tokens int,
  created_at timestamptz not null default now()
);
create index if not exists ai_assist_logs_owner_created_idx on ai_assist_logs(owner_id, created_at desc);

-- メール配信停止リスト（決定13）。営業メールはここに載った宛先には送らない。
-- reason: unsubscribe=本人解除 / bounce=不達 / complaint=苦情(スパム報告)。
create table if not exists email_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  reason text not null default 'unsubscribe' check (reason in ('unsubscribe', 'bounce', 'complaint')),
  created_at timestamptz not null default now()
);

create table if not exists payment_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references owners(id) on delete set null,
  provider text not null default 'square',
  provider_event_id text not null default '',
  event_type text not null default '',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 運営者アカウント（owners=ユーザーとは完全に分離）。運営者管理画面（/operators.html）で一覧・追加・削除。
-- 認証は当面 共有管理キー ADMIN_SECRET。password_hash は将来の運営者ごとログイン用（現状は未使用・NULL可）。
create table if not exists operators (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  is_active boolean not null default true,
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table owners add column if not exists invite_code text;
alter table owners add column if not exists cat_key_disabled boolean not null default false;
alter table owners add column if not exists cat_key_pending boolean not null default false;
alter table owners add column if not exists trial_ends_at timestamptz;
alter table owners add column if not exists password_hash text;
-- メール確認フラグ（#73）。確認は任意・非ブロッキング（確認しなくても利用可）。
alter table owners add column if not exists email_verified boolean not null default false;
-- MCP接続トークンの再発行用 salt（決定31）。更新すると既存のMCPトークンが無効になる。
-- 列未適用の環境ではコード側が salt="" として動く（トークンは固定＝再発行のみ不可）。
alter table owners add column if not exists mcp_token_salt text;
-- プレミアムプラン（AIアシスト上位・¥2,200/月・無料お試しなし）を許可。既存DBの plan 制約を貼り替える。
alter table owners drop constraint if exists owners_plan_check;
alter table owners add constraint owners_plan_check check (plan in ('free', 'pro', 'premium'));
alter table booking_pages add column if not exists user_id uuid references users(id) on delete cascade;
alter table booking_pages add column if not exists buffer_before_minutes int not null default 0;
alter table booking_pages add column if not exists buffer_after_minutes int not null default 0;
alter table booking_pages add column if not exists booking_range_months int not null default 3;
-- 受付期間: 1〜6ヶ月を許可（3ヶ月以降はアプリ側でPro限定）。日数指定(7/14/21)は candidate_days を使用。
alter table booking_pages drop constraint if exists booking_pages_booking_range_months_check;
alter table booking_pages add constraint booking_pages_booking_range_months_check check (booking_range_months between 1 and 6);
-- 予約時間: 30〜120分の10分刻み（刻みはアプリ側で担保）。前後バッファ: 0〜60分。
alter table booking_pages drop constraint if exists booking_pages_duration_minutes_check;
alter table booking_pages add constraint booking_pages_duration_minutes_check check (duration_minutes between 30 and 120);
alter table booking_pages drop constraint if exists booking_pages_buffer_before_minutes_check;
alter table booking_pages add constraint booking_pages_buffer_before_minutes_check check (buffer_before_minutes between 0 and 60);
alter table booking_pages drop constraint if exists booking_pages_buffer_after_minutes_check;
alter table booking_pages add constraint booking_pages_buffer_after_minutes_check check (buffer_after_minutes between 0 and 60);
-- 前後バッファをホスト専用のGoogleカレンダー予定にするときのタイトル（空=予定を作らない）。列が無い環境ではコード側でタイトルを落として保存する。
alter table booking_pages add column if not exists buffer_before_title text not null default '';
alter table booking_pages add column if not exists buffer_after_title text not null default '';
alter table booking_pages add column if not exists location_type text not null default 'google_meet';
alter table booking_pages add column if not exists location_value text not null default '';
alter table booking_pages add column if not exists is_active boolean not null default true;
-- 日程候補設定（TimeRex相当。issue: 提示期間/祝日/表示間隔）
alter table booking_pages add column if not exists timezone text not null default 'Asia/Tokyo';
alter table booking_pages add column if not exists accept_holidays boolean not null default true;
alter table booking_pages add column if not exists lead_time_hours int not null default 0;
alter table booking_pages add column if not exists candidate_days int;
alter table booking_pages add column if not exists slot_interval_minutes int;
-- 無料降格時の超過ページ凍結フラグ（決定15・#174）。再昇格で復元。
alter table booking_pages add column if not exists frozen boolean not null default false;
-- 受付時間を予約ページ単位に（#263）。未適用の環境ではコード側がオーナー単位の旧挙動へデグレードする。
-- 既存行は booking_page_id=null のまま＝「自前の受付時間を持たないページ」の共有フォールバックとして残る。
alter table availability_settings add column if not exists booking_page_id uuid references booking_pages(id) on delete cascade;
create index if not exists availability_settings_page_idx on availability_settings (booking_page_id);
alter table questionnaire_questions add column if not exists frozen boolean not null default false;
-- 事前アンケートの選択式回答（決定27・2026-06-19）。無料=text 固定、Pro・プレミアムで select/checkbox 可。
alter table questionnaire_questions add column if not exists answer_type text not null default 'text';
alter table questionnaire_questions add column if not exists options jsonb not null default '[]'::jsonb;
alter table bookings add column if not exists user_id uuid references users(id) on delete cascade;
-- ホスト専用の前後バッファ予定（ゲスト非表示）のGoogleイベントID。列が無い環境ではコード側でID保存をスキップする。
alter table bookings add column if not exists buffer_before_event_id text;
alter table bookings add column if not exists buffer_after_event_id text;
alter table bookings add column if not exists guest_name text not null default '';
alter table bookings add column if not exists guest_email text not null default '';
alter table bookings add column if not exists visitor_birth_date date;
alter table bookings add column if not exists visitor_birth_date_private boolean not null default false;
alter table bookings add column if not exists birthday_message_opt_in boolean not null default false;
alter table bookings add column if not exists relationship_profile jsonb not null default '{}'::jsonb;
alter table bookings add column if not exists start_time timestamptz;
alter table bookings add column if not exists end_time timestamptz;
alter table bookings add column if not exists meeting_url text not null default '';
alter table bookings add column if not exists location_type text not null default 'google_meet';
-- ゲスト→ホストへの質問・メッセージ（会員同士の相互質問・#21）。
alter table bookings add column if not exists guest_message text not null default '';
-- 会員同士の相互質問・双方向（#20）: ホスト→予約者への回答。コード側は列欠如時 try/catch で劣化。
alter table bookings add column if not exists host_answer text not null default '';
alter table bookings add column if not exists host_answer_at timestamptz;
alter table profiles add column if not exists data jsonb not null default '{}'::jsonb;
alter table free_signups add column if not exists invite_code text not null default '';
alter table free_signups add column if not exists language text not null default 'ja';

-- レート制限（ブルートフォース/スパム抑止・セキュリティ強化 2026-06）。
-- _lib/rate-limit.js が key="<bucket>:<ident>" 単位でウィンドウ内件数を数える。
-- テーブル未適用時はコード側で fail-open（許可）にデグレードするので、未適用でも機能は壊れない。
-- ※ 行は溜まるので、運用で定期的に古い行を削除するか、Supabase の cron/pg_cron で掃除すること。
create table if not exists rate_limit_hits (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_hits_key_created_idx on rate_limit_hits (key, created_at desc);

-- 事前アンケート回答に質問文を控える（#304）。予約ページ保存のたびに質問行が作り直され、
-- 過去の回答の question_id が null に落ちて質問文を引けなくなるため、回答時点の文言を保持する。
-- 未適用の環境では book.js がこの列を落として保存し、owner-bookings.js は
-- question_id 経由の埋め込みにフォールバックするので、適用前でも壊れない。
alter table questionnaire_answers add column if not exists question_text text not null default '';
