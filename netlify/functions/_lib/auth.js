const { verifySession, verifyAdminSession } = require("./crypto");
const { findOwnerById } = require("./supabase");

async function currentOwner(event) {
  const session = verifySession(event);
  if (!session?.ownerId) return null;
  const owner = await findOwnerById(session.ownerId);
  // 利用停止（cat_key_disabled）アカウントは未認証として扱う＝ログイン状態を無効化し、保護APIを全て拒否する。
  if (owner && owner.cat_key_disabled) return null;
  return owner;
}

async function requireOwner(event) {
  const owner = await currentOwner(event);
  if (!owner) {
    const error = new Error("ログインが必要です");
    error.statusCode = 401;
    throw error;
  }
  return owner;
}

// プラン判定ヘルパ。premium は pro の全機能を含む上位プランなので、pro 判定では premium も真。
const isPro = (plan) => plan === "pro" || plan === "premium";
const isPremium = (plan) => plan === "premium";

// 有料(Pro)限定の機能・APIで使う。無料ユーザーは 403。Cat Key 承認済みは plan='pro' になるため通る。
// プレミアム会員も Pro 機能をすべて使えるため通す。
async function requireProOwner(event) {
  const owner = await requireOwner(event);
  if (!isPro(owner.plan)) {
    const error = new Error("この機能はPro版でご利用いただけます。");
    error.statusCode = 403;
    throw error;
  }
  return owner;
}

// プレミアムプラン（AIアシスト等の上位機能）限定。free/pro は 403。
async function requirePremiumOwner(event) {
  const owner = await requireOwner(event);
  if (!isPremium(owner.plan)) {
    const error = new Error("この機能はプレミアムプランでご利用いただけます。");
    error.statusCode = 403;
    throw error;
  }
  return owner;
}

// 運営セッション（kimaru_admin_session）。ユーザー認証とは独立。
function currentOperator(event) {
  return verifyAdminSession(event);
}

function requireOperator(event) {
  const operator = currentOperator(event);
  if (!operator) {
    const error = new Error("運営ログインが必要です");
    error.statusCode = 401;
    throw error;
  }
  return operator;
}

module.exports = { currentOwner, requireOwner, requireProOwner, requirePremiumOwner, isPro, isPremium, currentOperator, requireOperator };
