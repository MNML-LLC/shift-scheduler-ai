# Railway APIトークン有効期限モニタリング

Railway APIトークン（`RAILWAY_TOKEN`）の期限切れを事前に検知し、Slackへアラート通知する仕組みです。

Issue #13 でトークン期限切れによりDB Password Rotationがブロックされた事象を受けて導入されました（Issue #78）。

## 仕組み

```
GitHub Actions（週次: 毎週月曜 09:00 JST）
  └─ scripts/token-monitor/check-railway-token.mjs
       ├─ 1. Railway GraphQL API で トークンの有効性を確認（projects クエリ）
       ├─ 2. RAILWAY_TOKEN_EXPIRES_AT から残り日数を計算
       └─ 3. 無効 or 残り30日以内なら Slack Webhook へ通知
```

### なぜ期限日を手動記録するのか

Railwayの公開GraphQL API（`backboard.railway.app/graphql/v2`）は、トークン自体の有効期限（expiresAt）を返しません。そのためこの仕組みでは:

- **有効性チェック**: Railway APIへの実リクエストで「今トークンが使えるか」を毎回確認
- **期限日チェック**: トークン発行時にオペレーターがGitHub Variables `RAILWAY_TOKEN_EXPIRES_AT` に期限日を記録し、それを基準に残り日数を計算

の2段構えで監視します。

## セットアップ

### 1. ワークフローの有効化

```bash
cp scripts/token-monitor/railway-token-expiry-check.yml.template .github/workflows/railway-token-expiry-check.yml
git add .github/workflows/railway-token-expiry-check.yml
git commit -m "chore: enable railway token expiry check workflow"
```

※ claude-code-action は `.github/workflows/` を変更できないため、この手順はオペレーターが実施してください。

### 2. GitHub Secrets の設定

リポジトリの Settings > Secrets and variables > Actions > **Secrets**:

| Secret | 内容 |
|---|---|
| `RAILWAY_TOKEN` | Railway APIトークン（既存のものを流用可） |
| `SLACK_WEBHOOK_URL` | 通知先SlackチャンネルのIncoming Webhook URL |

### 3. GitHub Variables の設定

リポジトリの Settings > Secrets and variables > Actions > **Variables**:

| Variable | 内容 | 例 |
|---|---|---|
| `RAILWAY_TOKEN_EXPIRES_AT` | トークンの期限日（YYYY-MM-DD） | `2026-12-31` |

## 通知内容

Slack通知には以下が含まれます:

- 期限日（`RAILWAY_TOKEN_EXPIRES_AT`）
- 残り日数
- トークン更新手順へのリンク（[Issue #13](https://github.com/MNML-LLC/shift-scheduler-ai/issues/13)）

## トークンローテーション時の手順

1. Railwayダッシュボードで新しいAPIトークンを発行
2. GitHub Secrets の `RAILWAY_TOKEN` を新トークンに更新
3. **GitHub Variables の `RAILWAY_TOKEN_EXPIRES_AT` を新しい期限日に更新**（忘れると誤通知の原因になります）
4. 詳細手順は [Issue #13](https://github.com/MNML-LLC/shift-scheduler-ai/issues/13) を参照

## ローカルでの動作確認（smoke test）

```bash
# Slack送信せずに通知内容を確認
RAILWAY_TOKEN=xxx RAILWAY_TOKEN_EXPIRES_AT=2026-08-01 \
  node scripts/token-monitor/check-railway-token.mjs --dry-run

# 閾値を上げて強制的にアラート経路をテスト
RAILWAY_TOKEN=xxx RAILWAY_TOKEN_EXPIRES_AT=2027-12-31 ALERT_THRESHOLD_DAYS=9999 \
  node scripts/token-monitor/check-railway-token.mjs --dry-run
```

GitHub Actions上では workflow_dispatch（手動実行）でいつでもテストできます。

## 終了コード

| コード | 意味 |
|---|---|
| 0 | 正常（期限接近アラート送信済みの場合を含む） |
| 1 | トークン無効/期限切れ、期限日未設定、または通知エラー（ワークフローが失敗として表示される） |
