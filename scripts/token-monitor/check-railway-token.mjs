#!/usr/bin/env node
/**
 * Railway APIトークン有効期限チェック & Slack通知スクリプト
 *
 * 動作:
 *   1. Railway GraphQL API に対してトークンの有効性を確認（projects クエリ。
 *      ワークスペーストークンでは me クエリが Not Authorized になるため）
 *   2. RAILWAY_TOKEN_EXPIRES_AT（YYYY-MM-DD）から残り日数を計算
 *   3. トークンが無効、または残り日数が閾値（デフォルト30日）以下なら
 *      Slack Incoming Webhook へアラートを送信
 *
 * 注意: Railwayの公開APIはトークン自体の有効期限を返さないため、
 * 期限日はトークン発行時にオペレーターが RAILWAY_TOKEN_EXPIRES_AT に記録する。
 *
 * 環境変数:
 *   RAILWAY_TOKEN            - Railway APIトークン（必須）
 *   RAILWAY_TOKEN_EXPIRES_AT - トークン期限日 YYYY-MM-DD（必須）
 *   SLACK_WEBHOOK_URL        - Slack Incoming Webhook URL（必須。--dry-run時は不要）
 *   ALERT_THRESHOLD_DAYS     - アラート閾値日数（デフォルト: 30）
 *
 * 使用方法:
 *   node scripts/token-monitor/check-railway-token.mjs           # 通常実行
 *   node scripts/token-monitor/check-railway-token.mjs --dry-run # Slack送信せず内容表示
 *
 * 終了コード:
 *   0 - 正常（期限接近アラート送信済みの場合も含む）
 *   1 - トークン無効/期限切れ、または設定・通知エラー
 */

const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2'
const RENEWAL_GUIDE_URL = 'https://github.com/MNML-LLC/shift-scheduler-ai/issues/13'
const DEFAULT_THRESHOLD_DAYS = 30

const isDryRun = process.argv.includes('--dry-run')

function parseDateString(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? '')
  if (!m) return null
  const [, y, mo, d] = m
  return Date.UTC(Number(y), Number(mo) - 1, Number(d))
}

function daysUntil(expiresAtStr) {
  const expiresUtc = parseDateString(expiresAtStr)
  if (expiresUtc === null) return null
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.floor((expiresUtc - todayUtc) / (24 * 60 * 60 * 1000))
}

async function checkTokenValidity(token) {
  try {
    const res = await fetch(RAILWAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ query: '{ projects { edges { node { id } } } }' })
    })
    if (res.status === 401 || res.status === 403) {
      return { valid: false, reason: `認証エラー (HTTP ${res.status})` }
    }
    if (!res.ok) {
      return { valid: false, reason: `APIエラー (HTTP ${res.status})` }
    }
    const json = await res.json()
    if (json.errors?.length) {
      const message = json.errors.map((e) => e.message).join('; ')
      if (/not authorized|unauthorized|invalid token/i.test(message)) {
        return { valid: false, reason: `認証エラー: ${message}` }
      }
      return { valid: false, reason: `GraphQLエラー: ${message}` }
    }
    return { valid: true, projectCount: json.data?.projects?.edges?.length ?? null }
  } catch (err) {
    return { valid: false, reason: `接続エラー: ${err.message}` }
  }
}

function buildSlackPayload({ status, expiresAt, daysRemaining, detail }) {
  const lines = [
    status === 'invalid'
      ? ':rotating_light: *Railway APIトークンが無効です（期限切れの可能性）*'
      : ':warning: *Railway APIトークンの有効期限が近づいています*',
    '',
    `• *期限日*: ${expiresAt ?? '未設定（RAILWAY_TOKEN_EXPIRES_AT を確認してください）'}`,
    daysRemaining !== null ? `• *残り日数*: ${daysRemaining}日` : null,
    detail ? `• *詳細*: ${detail}` : null,
    `• *更新手順*: <${RENEWAL_GUIDE_URL}|Issue #13 - Railwayトークン更新手順>`,
    '',
    'トークン更新後は GitHub の `RAILWAY_TOKEN` シークレットと `RAILWAY_TOKEN_EXPIRES_AT` 変数を必ず更新してください。'
  ].filter((line) => line !== null)

  return { text: lines.join('\n') }
}

async function sendSlackAlert(payload) {
  if (isDryRun) {
    console.log('--- [dry-run] Slack送信内容 ---')
    console.log(payload.text)
    console.log('-------------------------------')
    return
  }
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL が設定されていません')
  }
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    throw new Error(`Slack通知に失敗しました (HTTP ${res.status})`)
  }
  console.log('✅ Slack通知を送信しました')
}

async function main() {
  const token = process.env.RAILWAY_TOKEN
  if (!token) {
    console.error('❌ RAILWAY_TOKEN が設定されていません')
    process.exit(1)
  }

  const expiresAt = process.env.RAILWAY_TOKEN_EXPIRES_AT ?? null
  const thresholdDays = Number(process.env.ALERT_THRESHOLD_DAYS) || DEFAULT_THRESHOLD_DAYS
  const daysRemaining = daysUntil(expiresAt)

  console.log(`🔍 Railway APIトークンの有効性を確認中...`)
  const validity = await checkTokenValidity(token)

  if (!validity.valid) {
    console.error(`❌ トークンが無効です: ${validity.reason}`)
    await sendSlackAlert(
      buildSlackPayload({ status: 'invalid', expiresAt, daysRemaining, detail: validity.reason })
    )
    process.exit(1)
  }

  const { projectCount } = validity
  console.log(`✅ トークンは有効です${projectCount !== null ? `（プロジェクト数: ${projectCount}）` : ''}`)

  if (daysRemaining === null) {
    console.error('❌ RAILWAY_TOKEN_EXPIRES_AT が未設定または形式不正です（YYYY-MM-DD で設定してください）')
    await sendSlackAlert(
      buildSlackPayload({
        status: 'expiring',
        expiresAt,
        daysRemaining: null,
        detail: '期限日が記録されていないため残り日数を確認できません'
      })
    )
    process.exit(1)
  }

  console.log(`📅 期限日: ${expiresAt}（残り ${daysRemaining}日 / 閾値 ${thresholdDays}日）`)

  if (daysRemaining <= thresholdDays) {
    await sendSlackAlert(
      buildSlackPayload({
        status: 'expiring',
        expiresAt,
        daysRemaining,
        detail: daysRemaining <= 0 ? '期限日を過ぎています。至急更新してください' : null
      })
    )
  } else {
    console.log('✅ 期限まで十分な余裕があります。通知は送信しません')
  }
}

main().catch((err) => {
  console.error(`❌ 予期しないエラー: ${err.message}`)
  process.exit(1)
})
