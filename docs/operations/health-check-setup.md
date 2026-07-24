# 本番バックエンド死活監視のセットアップ手順

Issue #155 対応。本番バックエンド（Railway）の `/api/health` を GitHub Actions の
scheduled workflow で毎時 ping し、異常時に Slack Incoming Webhook へ通知する。
LIFF リポジトリ（shift-scheduler-ai-liff Issue #18）の `health-check.yml` と同じパターン。

## 前提

claude-code-action は GitHub App の権限制約により `.github/workflows/` 配下を
直接変更できない。そのためワークフロー本体は `docs/operations/health-check.yml` に
テンプレートとして配置してあり、**オペレーターによる配置作業（手順 2）が必要**。

## セットアップ手順

### 1. Repository Secrets の設定

GitHub リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で以下を登録する。

| Secret 名 | 値 | 備考 |
|---|---|---|
| `BACKEND_URL` | `https://shift-scheduler-ai-production.up.railway.app` | 本番バックエンドのベース URL（末尾スラッシュ有無どちらでも可） |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook の URL | 通知先チャンネル用に発行した Webhook |

### 2. ワークフローファイルの配置

```bash
git checkout staging && git pull
git checkout -b chore/health-check-workflow
git mv docs/operations/health-check.yml .github/workflows/health-check.yml
git commit -m "chore: enable production backend health-check workflow"
git push -u origin chore/health-check-workflow
```

その後、通常のフロー（→ `staging` → `main`）で PR をマージする。
scheduled workflow はデフォルトブランチ（`main`）にマージされて初めて動作する点に注意。

### 3. 動作確認（workflow_dispatch）

`main` へのマージ後:

1. **Actions → Health Check → Run workflow** で手動実行する。
2. 正常系: ジョブが成功し、ログに `Healthy: HTTP 200, database.connected=true` が出ること。
3. 異常系の通知確認: 一時的に `BACKEND_URL` を存在しない URL（例: `https://invalid.example.com`）に
   変更して手動実行し、Slack にアラートが届くことを確認したら、値を元に戻す。
4. 確認結果を Issue #155 の「smoke test 結果」欄に記入する。

## ワークフローの動作仕様

- **スケジュール**: 毎時 0 分（UTC）。GitHub Actions の cron は数分〜数十分遅延することがある。
- **手動実行**: `workflow_dispatch` に対応。
- **正常判定**: HTTP 200 かつレスポンス JSON の `database.connected` が `true`
  （`backend/src/routes/health.js` は DB 接続不可時に 503 を返す）。
- **リトライ**: 30 秒間隔で最大 3 回試行し、全滅した場合のみ失敗（一時的な瞬断でのアラート抑制）。
- **通知**: 失敗時のみ Slack Incoming Webhook へ、異常内容・HTTP ステータス・実行ログ URL を含めて通知。
  `SLACK_WEBHOOK_URL` 未設定時は警告を出してスキップ（ジョブ自体は失敗のまま）。

## 受け入れ条件との対応

| 受け入れ条件 | 状態 |
|---|---|
| `.github/workflows/health-check.yml` が追加されている | テンプレート配置済み → 手順 2 の `git mv` で完了 |
| `BACKEND_URL` を Repository Secret で設定済み | 手順 1（オペレーター作業） |
| `SLACK_WEBHOOK_URL` を Repository Secret で設定済み | 手順 1（オペレーター作業） |
| workflow_dispatch でも動作確認済み | 手順 3（オペレーター作業） |
