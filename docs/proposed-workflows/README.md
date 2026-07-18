# Proposed workflow changes for Issue #41

claude-code-action は GitHub App の `workflows` 権限がないため `.github/workflows/` を直接変更できません。
このディレクトリの内容を M 層が `.github/workflows/` へコピーして適用してください。

## 適用手順

```bash
cp docs/proposed-workflows/deploy.yml .github/workflows/deploy.yml
cp docs/proposed-workflows/ci.yml .github/workflows/ci.yml
rm -rf docs/proposed-workflows
git add .github/workflows docs/proposed-workflows
git commit -m "ci: restrict production deploy to main and gate deploys on CI pass"
```

## 変更内容

### deploy.yml

- トリガーを `push: branches: [main, staging]` のみに限定（`pull_request` トリガーを削除し、PR でのデプロイジョブ実行を廃止）
- `deploy-production` ジョブ: `main` への push のみ実行（`vercel deploy --prod`）
- `deploy-staging` ジョブ: `staging` への push のみ実行（`vercel deploy`、Vercel の preview デプロイを STG として使用)
- 両ジョブとも `needs: [ci]` で CI 通過を前提条件に設定

### ci.yml

- `on:` に `workflow_call:` を追加し、deploy.yml から再利用可能ワークフローとして呼び出せるようにした（既存のトリガーは変更なし）

## 補足

- `main` / `staging` への push 時は、従来どおり ci.yml 単体でも CI が走るため、deploy.yml 内の `ci` ジョブと合わせて CI が 2 回実行されます。重複を避けたい場合は ci.yml の `push:` トリガーから `main` / `staging` を外すことも検討できますが、branch protection の required checks に影響しないよう本提案では既存トリガーを維持しています。
- 必要なシークレット（`VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`）は変更ありません。
