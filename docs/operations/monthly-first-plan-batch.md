# 月次第一案バッチ (Monthly First Plan Batch)

## 目的

毎月1日 9:00 JST に、翌月分の**第一案（FIRST プラン）を「空の募集枠」として自動生成し、
`status='APPROVED'` で登録**する定期バッチ。

- 第一案 (FIRST) = 従業員からシフト希望を集めるための空の募集枠。プラン行のみ存在し、
  `ops.shifts` などの明細テーブルには一切書き込まない。
- 第二案 (SECOND) = 集まった希望を元に作る実データ入りの割当案（本バッチの対象外。
  別プロセスで人手 or 別バッチにより作成する）。
- 新規に作成された（＝前月まで存在しなかった）店舗にのみ LINE 通知（LIFF backend の
  `/api/notification/first-plan-approved`）を送信する。既に APPROVED だった店舗には送らない。

## 実行タイミング

- cron: `0 0 1 * *` (UTC) = 毎月1日 9:00 JST
- GitHub Actions の cron はベストエフォート（数分の遅延あり）。「1日中に承認済みになっていればよい」
  という業務要件のため許容する。

## エンドポイント

```
POST /api/shifts/plans/monthly-first-plan-batch
```

### 認証

`x-batch-api-key` ヘッダに `BATCH_API_KEY` 環境変数と同じ値を設定する。ヘッダ欠如・不一致・
サーバ側で `BATCH_API_KEY` 未設定のいずれの場合も `401 Unauthorized` を返す。

### リクエストボディ

```json
{
  "target_year": 2026,
  "target_month": 9
}
```

- `target_month` は 1〜12 の整数。範囲外・欠如の場合は `400` を返す。

### レスポンス

```json
{
  "success": true,
  "target_year": 2026,
  "target_month": 9,
  "created": [{ "tenant_id": 1, "store_id": 5, "plan_id": 111 }],
  "skipped_already": [{ "tenant_id": 1, "store_id": 6 }],
  "failed": [{ "tenant_id": 1, "store_id": 7, "error": "..." }],
  "failed_notification": [{ "tenant_id": 1, "store_id": 5, "error": "..." }]
}
```

- `created`: 新規に空プランを作成し、LINE 通知も送信した店舗
- `skipped_already`: 既に同月の FIRST プランが存在していたため何もしなかった店舗（通知なし）
- `failed`: DB 処理でエラーになった店舗（他店舗の処理は継続される）
- `failed_notification`: DB へのプラン作成は成功したが、LINE 通知の送信に失敗した店舗
  （DB のロールバックはしない。次回バッチでは `skipped_already` になるため以降通知されない。
  手動で LINE 通知を再送する運用とする）

### 冪等性

`ops.shift_plans` の一意制約 `(tenant_id, store_id, plan_year, plan_month, plan_type)` を利用した
`INSERT ... ON CONFLICT ... DO UPDATE SET plan_id = shift_plans.plan_id ... RETURNING (xmax = 0) AS inserted`
（no-op self-update）により、同月内で何度実行しても新規 INSERT された店舗のみ通知対象になる。
既存プランが存在する場合（`skipped_already`）、その `status` やその他のカラムは一切変更されない
— 手動で `DRAFT` 等に変更済みのプランがあっても、バッチ実行によって `APPROVED` に上書きされることはない。

## 環境変数・シークレット設定手順

### Railway backend（shift-scheduler-ai サービス）

| 変数 | 説明 |
|---|---|
| `BATCH_API_KEY` | バッチ認証用のランダム文字列（`openssl rand -hex 32` などで生成、32文字以上推奨） |
| `LIFF_BACKEND_URL` | LIFF backend のベース URL（既存 `approve-first` と共用） |

設定手順: Railway ダッシュボード → shift-scheduler-ai サービス → **Variables** → **Add Variable**

### GitHub Secrets（MNML-LLC/shift-scheduler-ai リポジトリ）

| Secret | 説明 |
|---|---|
| `BATCH_API_KEY` | Railway 側と同じ値 |
| `SLACK_WEBHOOK_URL` | 通知先 Slack チャンネルの Incoming Webhook URL |
| `RAILWAY_BACKEND_URL` | Railway backend のパブリック URL |

設定手順: GitHub → リポジトリ → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**

## GitHub Actions ワークフロー

> **重要（運用者による追加作業が必要）**: Claude Code の GitHub App は
> `.github/workflows/` 配下のファイルを変更する権限を持たないため、本 PR には
> ワークフローファイルは含まれていません。以下の内容を手動で
> `.github/workflows/monthly-first-plan-batch.yml` として追加してください。

```yaml
name: Monthly First Plan Batch

permissions:
  contents: none

on:
  schedule:
    - cron: '0 0 1 * *' # UTC 00:00 = JST 09:00 毎月1日
  workflow_dispatch:
    inputs:
      target_year:
        description: '対象年 (未指定時は翌月を自動算出)'
        required: false
        type: string
      target_month:
        description: '対象月 1-12 (未指定時は翌月を自動算出)'
        required: false
        type: string

jobs:
  batch:
    runs-on: ubuntu-latest
    steps:
      - name: Compute target year/month
        id: target
        run: |
          if [ -n "${{ github.event.inputs.target_year }}" ] && [ -n "${{ github.event.inputs.target_month }}" ]; then
            echo "year=${{ github.event.inputs.target_year }}" >> "$GITHUB_OUTPUT"
            echo "month=${{ github.event.inputs.target_month }}" >> "$GITHUB_OUTPUT"
          else
            YEAR=$(TZ=Asia/Tokyo date -d '+1 month' +%Y)
            MONTH=$(TZ=Asia/Tokyo date -d '+1 month' +%-m)
            echo "year=$YEAR" >> "$GITHUB_OUTPUT"
            echo "month=$MONTH" >> "$GITHUB_OUTPUT"
          fi

      - name: Call batch API
        id: batch
        run: |
          set +e
          call_batch_api() {
            curl -sS --max-time 90 -w '\n%{http_code}' -X POST \
              -H "Content-Type: application/json" \
              -H "x-batch-api-key: ${{ secrets.BATCH_API_KEY }}" \
              -d "{\"target_year\": ${{ steps.target.outputs.year }}, \"target_month\": ${{ steps.target.outputs.month }}}" \
              "${{ secrets.RAILWAY_BACKEND_URL }}/api/shifts/plans/monthly-first-plan-batch"
          }

          OUTPUT=$(call_batch_api)
          HTTP_CODE=$(echo "$OUTPUT" | tail -n1)
          BODY=$(echo "$OUTPUT" | sed '$d')

          if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
            echo "First attempt failed (HTTP $HTTP_CODE), retrying once..."
            OUTPUT=$(call_batch_api)
            HTTP_CODE=$(echo "$OUTPUT" | tail -n1)
            BODY=$(echo "$OUTPUT" | sed '$d')
          fi

          echo "$BODY" > response.json

          if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
            echo "Batch API failed after retry (HTTP $HTTP_CODE)"
            echo "batch_failed=true" >> "$GITHUB_OUTPUT"
            exit 1
          fi

      - name: Notify Slack (result)
        if: always() && steps.batch.outputs.batch_failed != 'true'
        run: |
          CREATED=$(jq '.created | length' response.json)
          SKIPPED=$(jq '.skipped_already | length' response.json)
          FAILED=$(jq '.failed | length' response.json)
          NOTIF_FAILED=$(jq '.failed_notification | length' response.json)
          curl -sS -X POST \
            -H "Content-Type: application/json" \
            -d "{\"text\": \"月次第一案バッチ完了 ${{ steps.target.outputs.year }}-${{ steps.target.outputs.month }}\\n作成: ${CREATED}店\\n既存Skip: ${SKIPPED}店\\n失敗: ${FAILED}店\\n通知失敗: ${NOTIF_FAILED}店\"}" \
            "${{ secrets.SLACK_WEBHOOK_URL }}"

      - name: Notify Slack (failure)
        if: failure()
        run: |
          curl -sS -X POST \
            -H "Content-Type: application/json" \
            -d "{\"text\": \":warning: 月次第一案バッチ失敗 ${{ steps.target.outputs.year }}-${{ steps.target.outputs.month }}\\nGitHub Actions Job URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\"}" \
            "${{ secrets.SLACK_WEBHOOK_URL }}"
```

## 手動再実行手順

### GitHub Actions Web UI

1. `Actions` タブ → `Monthly First Plan Batch` ワークフロー
2. `Run workflow` ボタン → `target_year` / `target_month` を入力（未入力なら翌月自動算出）
3. 実行結果を Slack で確認

### `gh` CLI

```bash
gh workflow run monthly-first-plan-batch.yml \
  -R MNML-LLC/shift-scheduler-ai \
  -f target_year=2026 \
  -f target_month=8
```

同月を再実行しても、既に作成済みの店舗は `skipped_already` になり LINE 通知は再送されない
（冪等性）。失敗した店舗のみ再度 INSERT が試行される。

## 失敗時の対応フロー

1. Slack 通知の `failed` / `failed_notification` を確認する。
2. `failed` に店舗がある場合: Railway backend のログを確認し、原因を特定する。単発の店舗失敗
   ならば同月で `workflow_dispatch` を再実行すればよい（副作用なし）。
3. `failed_notification` のみの場合: DB は正常に作成済み。手動で LINE 通知を再送するか、
   影響が軽微なら次月まで待つ（LIFF UI では既に「募集開始」表示になっている）。
4. バッチ全体（HTTP リクエスト自体）が失敗した場合: `workflow_dispatch` で手動再実行する。
   原因不明の場合は Railway backend 側を調査する。

## Slack 通知フォーマット

**成功時:**

```
月次第一案バッチ完了 2026-8
作成: 12店
既存Skip: 0店
失敗: 0店
通知失敗: 0店
```

**バッチ全体失敗時:**

```
:warning: 月次第一案バッチ失敗 2026-8
GitHub Actions Job URL: https://github.com/MNML-LLC/shift-scheduler-ai/actions/runs/XXX
```
