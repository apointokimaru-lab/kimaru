// Netlify Scheduled Function。期限切れのピンポイントリンクの押さえ予定を片付ける（#326）。
// スケジュールは netlify.toml の [functions."pinpoint-expire-scheduled"]。
// リマインダーと違って分単位の精度は要らない（押さえが数十分残っても実害が無い）ので1時間ごと。
// HTTP からは叩けない（dry_run 確認は /api/pinpoint-expire?dry_run=1 を使う）。
const { run } = require("./pinpoint-expire");

exports.handler = async () => {
  try {
    const result = await run(false);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
