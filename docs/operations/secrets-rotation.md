# バッチ Secrets ローテーション手順

Issue #402 対応。月次第一案バッチ（`.github/workflows/monthly-first-plan-batch.yml`）および
`health-check.yml` が参照する GitHub Secrets の **ローテーション手順・月次チェック・
失敗通知有効化手順** を規定する。Issue #401（2026-10-01 BATCH_API_KEY 失効）の再発防止が目的。

- **原則**: Railway 側の値（運用の SoT）と GitHub Secrets 側の値（バッチ実行の SoT）を
  必ず同じ値に保つ。片方だけ変更しないこと。
- 関連ドキュメント:
  [`monthly-first-plan-batch.md`](monthly-first-plan-batch.md) /
  [`health-check-setup.md`](health-check-setup.md) /
  [`notification-reactivation.md`](notification-reactivation.md)

---

## 1. 対象 Secrets 一覧（GitHub Actions / `MNML-LLC/shift-scheduler-ai`）

| Secret 名 | 値の参照元 | 用途 | 参照ワークフロー |
|---|---|---|---|
| `BATCH_API_KEY` | Railway → shift-scheduler-ai → Variables → `BATCH_API_KEY` | 月次第一案バッチ API 認証（`x-batch-api-key` ヘッダ） | `monthly-first-plan-batch.yml` |
| `BACKEND_URL` | Railway → shift-scheduler-ai → Settings → Public Domain（例: `https://shift-scheduler-ai-production.up.railway.app`） | バッチ・死活監視の送信先 URL | `monthly-first-plan-batch.yml` / `health-check.yml` |
| `SLACK_WEBHOOK_URL` | Slack App → Incoming Webhooks → Webhook URL | バッチ結果・失敗通知、死活監視異常通知 | `monthly-first-plan-batch.yml` / `health-check.yml` |

> **設定場所**: GitHub → `MNML-LLC/shift-scheduler-ai` → **Settings → Secrets and variables → Actions → Repository secrets**
>
> CLI の場合: `gh secret set <NAME> -R MNML-LLC/shift-scheduler-ai`（stdin に値を貼る）

---

## 2. `SLACK_WEBHOOK_URL` の新規発行・設定手順（Issue #402 時点で未設定）

未設定の間、`Notify Slack (failure)` ステップは skip され **バッチ失敗が検知されない**。
以下の手順で発行・登録する。

### 2.1 Slack Incoming Webhook の発行

1. [Slack API: Your Apps](https://api.slack.com/apps) → MNML workspace の既存アプリ
   （無ければ `Create New App → From scratch`）を開く
2. **Incoming Webhooks → Activate Incoming Webhooks: On**
3. **Add New Webhook to Workspace** → 投稿先チャンネルを選択（第一候補: `#shift`、第二候補: `#alerts`）
4. 発行された Webhook URL（`https://hooks.slack.com/services/T.../B.../...`）をコピー

### 2.2 GitHub Secrets への登録

```bash
# gh CLI で登録（stdin から値を渡す。履歴に残さない）
gh secret set SLACK_WEBHOOK_URL -R MNML-LLC/shift-scheduler-ai
# 値を貼り付けて Enter → Ctrl-D
```

または GitHub Web UI: **Settings → Secrets and variables → Actions → New repository secret**
→ Name: `SLACK_WEBHOOK_URL` / Secret: 上記 Webhook URL。

### 2.3 動作確認（成功通知・失敗通知の両方）

```bash
# 成功系: 手動で翌月バッチを再実行し、"月次第一案バッチ完了 ..." が Slack に届くことを確認
gh workflow run monthly-first-plan-batch.yml \
  -R MNML-LLC/shift-scheduler-ai \
  -f target_year=2026 \
  -f target_month=11

# 失敗系: 一時的に BATCH_API_KEY を不正な値に差し替えて手動実行し、
# ":warning: 月次第一案バッチ失敗 ..." が Slack に届くことを確認したら元に戻す
# （Railway 側は触らない。GitHub Secrets 側のみ）
```

---

## 3. BATCH_API_KEY ローテーション手順

Railway 側で `BATCH_API_KEY` を再生成した場合、または定期ローテーション時（推奨: 四半期ごと）
に以下の手順を実施する。

### 3.1 Railway 側で新しい値を発行（必要な場合のみ）

新しい値を生成する場合:

```bash
openssl rand -hex 32
```

Railway ダッシュボード → shift-scheduler-ai → **Variables → `BATCH_API_KEY`** を上記値に更新
→ サービスが自動 Restart されるまで待つ（デプロイログで反映を確認）。

### 3.2 GitHub Secrets に同じ値を反映

```bash
gh secret set BATCH_API_KEY -R MNML-LLC/shift-scheduler-ai
# Railway と同じ値を貼り付けて Enter → Ctrl-D
```

### 3.3 手動バッチで疎通確認

```bash
gh workflow run monthly-first-plan-batch.yml \
  -R MNML-LLC/shift-scheduler-ai \
  -f target_year=<当月より未来> \
  -f target_month=<同上>
```

- `Actions → Monthly First Plan Batch → 最新 run` を開き、`Call batch API` ステップが HTTP 200 で終了していることを確認
- Slack に `月次第一案バッチ完了 ...` が届いていることを確認
- 同月を既に処理済みの場合は `created: 0` / `skipped_already: <店舗数>` になる（冪等）

### 3.4 完了記録

- Issue または Slack thread に「`BATCH_API_KEY` ローテーション完了 YYYY-MM-DD / 疎通確認 HTTP 200」
  を残す（shift M層が記録）

---

## 4. `BACKEND_URL` 変更時の手順

Railway サービス移行・独自ドメイン切替等で backend の公開 URL が変わった場合:

1. Railway ダッシュボード → shift-scheduler-ai → **Settings → Public Domain** で新 URL を確認
2. `gh secret set BACKEND_URL -R MNML-LLC/shift-scheduler-ai` で更新
3. `health-check.yml` を手動実行し、`Healthy: HTTP 200, database.connected=true` を確認
4. `monthly-first-plan-batch.yml` を手動実行し、HTTP 200 を確認

---

## 5. 月次チェック（毎月1日バッチ前日 = JST 11/30 等に実施）

shift M層が **毎月末に 5 分で完了する目視チェック** を実施し、翌月1日の自動バッチ失敗を予防する。

- [ ] `BATCH_API_KEY` が Railway の現在値と GitHub Secrets の現在値で一致している
  （Railway UI → GitHub Secrets UI の "Last updated" 日付が齟齬していないか確認。
  値そのものは GitHub Secrets 側では閲覧不可のため、Railway 側で `openssl` 等でローテーションしたなら
  手順 3 に従って必ず GitHub Secrets も更新する）
- [ ] `BACKEND_URL` が Railway Public Domain と一致している（`gh secret list -R MNML-LLC/shift-scheduler-ai`
  で登録有無を確認）
- [ ] `SLACK_WEBHOOK_URL` が設定済みで、通知先チャンネル（`#shift` / `#alerts`）が存在する
- [ ] 直近の `monthly-first-plan-batch.yml` run が成功 or `skipped_already` のみで終わっている
  （`gh run list -R MNML-LLC/shift-scheduler-ai --workflow monthly-first-plan-batch.yml --limit 3`）

チェック結果は Slack thread に残す（記録先: `#shift` チャンネル）。

---

## 6. バッチ失敗時の初動（Slack 通知を受け取ったら）

Slack に `:warning: 月次第一案バッチ失敗 YYYY-MM` が届いた場合:

1. 通知内の `GitHub Actions Job URL` を開き、`Call batch API` ステップのログで **HTTP ステータスコード** を確認
2. ステータスコード別の対応:
   | HTTP | 想定原因 | 一次対応 |
   |---|---|---|
   | `401` | `BATCH_API_KEY` が Railway と GitHub Secrets で不一致 | 手順 3 でローテーション → `workflow_dispatch` で手動再実行 |
   | `404` / `5xx` | `BACKEND_URL` 誤り or backend 停止 | `health-check.yml` 結果 / Railway デプロイ状態を確認 |
   | `400` | リクエストボディ不正（`target_year/month` が無効） | ログの JSON を確認。手動再実行時は `-f target_year=... -f target_month=...` 指定 |
   | 接続タイムアウト | Railway cold start / ネットワーク | 数分おいて `workflow_dispatch` で手動再実行 |
3. 復旧後、`workflow_dispatch` で該当月を手動再実行し成功を確認（冪等なので副作用なし）
4. 原因・対応内容を Issue に残す（恒久的な再発防止が必要なら新規 Issue を起票）

---

## 7. 中期対応（別 Issue 起票候補）

Issue #402 要件 3「バッチ事前チェックステップの追加」は、本ランブックの範囲外（ワークフロー
改修）だが以下を候補として検討する:

- バッチ本体より前に `curl -sS -o /dev/null -w '%{http_code}' -H "x-batch-api-key: $BATCH_API_KEY" "$BACKEND_URL/api/health"`
  のような軽量 ping ステップを追加し、`401` を即検知する
- 月末前日（例: cron `0 0 L-1 * *` 相当）に dry-run / preflight 専用ワークフローを分離する
- `.github/workflows/` の変更は claude-code-action の権限外のため、人手で PR を起票する

本件は別 Issue 化して対応する（Issue #402 からは要件 1・2 のみ本手順書で完結）。

---

## 変更履歴

| 日付 | 変更内容 | 関連 |
|---|---|---|
| 2026-10-01 | 新規作成（SLACK_WEBHOOK_URL 発行手順・BATCH_API_KEY ローテーション手順・月次チェック・失敗時対応を規定） | #402 / #401 |
