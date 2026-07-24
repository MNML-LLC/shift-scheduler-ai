# staging 検証フロー (Staging Verification Flow)

## 目的

「修正は本番反映前に必ず staging で検証する」という**本番影響ゼロ原則**を、
ドキュメントではなく仕組みとして担保するランブック。Issue #84（設計: architect W層 2026-07-21）に基づく。

- 本ドキュメントが本フローの SoT（Source of Truth）。
- main 宛 PR には `.github/pull_request_template.md` により検証エビデンス欄が必須表示される。

## 用語の区別

本ドキュメントで「Railway」「Vercel」が指すものは次の通り:

- **Railway staging / production (backend)** — アプリサーバー（Express API）。
- **Railway staging / production (DB / PostgreSQL)** — Postgres インスタンス（staging: `switchyard:26491` / 本番: `mainline:50142`）。
- **Vercel staging / Production (frontend)** — React SPA。**frontend のみ** Vercel にデプロイされる（`backend/vercel.json` はレガシーで、backend は Vercel にデプロイされない）。

## ブランチ → 環境の対応（一方向昇格）

| ブランチ | デプロイ先 | DB | デプロイ方法 |
|---|---|---|---|
| `feature/*` / `fix/*` 等 | Vercel Preview（PR 時） | — | PR 作成で自動（既存 deploy.yml） |
| `staging` | Railway staging (backend + DB) + Vercel staging (frontend) | **staging DB `switchyard:26491`** | `staging` push で**自動** |
| `main` | Railway production (backend + DB) + Vercel Production (frontend) | **本番DB `mainline:50142`** | `main` push で自動（`vercel deploy --prod`） |

昇格は一方向のみ: `feature/*` → `staging` → `main`。逆流・スキップは不可
（hotfix は例外的に `main` から切るが、マージ後 `staging` へバックポートする）。

## staging への反映方法 = 自動デプロイ

- **Railway (backend)**: staging 環境のデプロイ元ブランチを `staging` に設定（ダッシュボード設定。deploy.yml では扱わない）。
  `staging` への push で backend が自動デプロイされる。
- **Vercel (frontend)**: `.github/workflows/deploy.yml` の staging job により、`staging` への push で
  `vercel deploy`（非 production）を実行し、staging 固定エイリアスを付与する。

### 手動フォールバック（自動デプロイが未配線・不調のとき）

```bash
# Backend (Railway) — ダッシュボードから staging 環境を選び手動 Redeploy、
# または Railway CLI:
railway up --environment staging

# Frontend (Vercel) — 非 production デプロイ + staging エイリアス付与:
cd frontend
vercel deploy --token=$VERCEL_TOKEN --yes
vercel alias set <deployment-url> <staging-alias-domain> --token=$VERCEL_TOKEN
```

いずれの場合も、デプロイ後に下記チェックリスト 1（環境安全確認）から実施する。

## 検証チェックリスト（staging で実施・本番反映の必須ゲート）

各項目について**実施時刻(JST)・確認URL・結果**を main 宛 PR のテンプレート欄に記録する。

1. **環境安全確認（最重要）**
   `GET {staging}/api/health` が 200 で、レスポンスの
   `database.connected: true` かつ `database.host` に `switchyard` を含むことを確認する。
   **`database.host` に `mainline`（本番DB）が現れたら即中断**し、Railway staging (backend) の
   `DATABASE_URL` / `PGHOST` 設定を修正するまで検証を再開しない（#81 の production ガードと同型）。
2. **主要画面表示**
   トップ / シフトカレンダー / ダッシュボードが描画・操作可能であること。
3. **シフト生成 1回**
   小規模テナント1件・1ヶ月分のシフト生成を実行し、正常完了を確認する
   （OpenAI トークン消費・DB 負荷を最小化するため小規模に留める）。
4. **変更差分の目視**
   当該 PR で触れた機能が意図通り動くこと。バグ修正の場合は、元の再現手順で解消を確認する。

docs のみの変更等で staging 検証が不要な場合は、PR テンプレートの該当欄に理由を明記する。

## staging → main 昇格手順（手動 PR）

1. staging 環境で上記チェックリストを全通過させる。
2. `staging` → `main` の PR を作成する（自動マージにしない — 人間/M層の判断ゲートを1つ残す）。
3. PR テンプレートの「staging 検証結果」欄に検証エビデンス（URL・実施時刻(JST)・結果）を記入する。
4. shift M層がレビューし、エビデンス欄が空欄でないこと・CI 全通過を確認してマージする。
5. マージ後、本番 smoke test（下記）を実施し、結果を対象 Issue の smoke test 欄へ記録する。

## 本番反映後の確認（smoke test）

- `GET {prod}/api/health` = 200 / `database.connected: true` / `database.host` に `mainline` を含むこと。
- 主要画面が表示されること。
- 結果を Issue の「smoke test 結果」欄に実施日時・内容とともに記録する。

## ロールバック手順（本番で問題が出たとき）

即時性の高い順に実施する:

1. **Railway (backend)**: ダッシュボードから直前の正常リビジョンを Redeploy。
2. **Vercel (frontend)**: Instant Rollback で直前の Production デプロイに切り戻し。
3. **コード**: 問題のコミットを `git revert` し、通常フロー（staging 検証 → main）で反映する。
   ※ 緊急時のみ hotfix ブランチを `main` から切ってよいが、マージ後 `staging` へバックポートする。

## セキュリティ上の注意

- staging / production で DB 認証情報・LINE トークン・OpenAI キーを分離する
  （本番トークンを staging 検証で使わない）。
- 本番DB誤接続の遮断: チェックリスト 1 の `switchyard` 確認を省略しない。
- 検証の非改竄性: PR テンプレートの URL・時刻・結果の記入を必須とし、空欄マージは M層レビューで停止する。

## 前提条件（ダッシュボード/API 側の設定 — コード外）

実装・運用開始前に M層/ops が確認・設定する:

1. Railway staging (backend) のデプロイ元ブランチが `staging` になっているか（未設定なら設定、不可なら手動運用に切替）。
2. Railway staging (backend) の `DATABASE_URL` が staging DB `switchyard:26491` を指しているか
   （#81 で共有変数 `STAGING_DATABASE_URL` 化済み・要再確認）。
3. Vercel staging エイリアスの `VITE_API_URL` に staging backend URL が設定済みか。
4. `main` ブランチ保護（直接 push 禁止・レビュー必須・CI 必須）が有効か。

## 付録: deploy.yml の staging job（要・手動適用）

claude-code-action は GitHub App の権限制約により `.github/workflows/` を変更できないため、
以下の変更は人間が適用する。既存の main=本番 / PR=preview の挙動は維持される。

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install -g vercel@latest
      - name: Deploy to Vercel (Production)
        if: github.ref == 'refs/heads/main'
        run: vercel deploy --prod --token=${{ secrets.VERCEL_TOKEN }} --yes
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      - name: Deploy to Vercel (Staging)
        if: github.ref == 'refs/heads/staging'
        run: |
          DEPLOY_URL=$(vercel deploy --token=${{ secrets.VERCEL_TOKEN }} --yes)
          vercel alias set "$DEPLOY_URL" ${{ vars.VERCEL_STAGING_ALIAS }} --token=${{ secrets.VERCEL_TOKEN }}
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      - name: Deploy to Vercel (Preview)
        if: github.event_name == 'pull_request'
        run: vercel deploy --token=${{ secrets.VERCEL_TOKEN }} --yes
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
```

- `vars.VERCEL_STAGING_ALIAS` に staging 固定エイリアスのドメインを設定する（Repository variables）。
- 既存の Preview 条件 `github.ref != 'refs/heads/main'` は `staging` push にも一致してしまうため、
  `github.event_name == 'pull_request'` に変更している点に注意。
