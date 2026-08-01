# staging DB へのアクセス（M層 手動手順）

Mac mini から staging PostgreSQL（Railway `humble-manifestation` / `switchyard:26491`）に接続し、
migration の状態確認・実行を行うための恒久的な手順書。

対象読者: shift M層（Mac mini でオペする人）。

---

## なぜこの手順が必要か

- staging DB の DATABASE_URL は機密情報であり、リポジトリにはコミットできない。
- Mac mini のローカル `backend/.env` は開発用（local DB）で埋まっており、staging URL は含まれていない。
- Railway CLI (`railway run`) 経由の実行は、以前 `RAILWAY_TOKEN` 環境変数の残置により認証エラー（`Invalid RAILWAY_TOKEN`）となりブロックした（Issue #189）。
- そのため、**staging 用の DATABASE_URL を gitignore 済みの `.env.staging.local` に配置し、`npm run db:migrate:*:staging` から `--envPath` で明示的に読み込む** 構成を採用している。

責務分界（Issue #189）:

| 主体 | 担当 |
|---|---|
| ベンダー（@claude / GitHub Actions） | リポジトリ内の非機密変更のみ（`.gitignore` / `package.json` / `.env.staging.example` / 本ドキュメント） |
| M層（Mac mini・手動・PR マージ後） | `npm install` / staging URL 取得 / `.env.staging.local` 配置 / migration 実行 / smoke test |

**シークレット配置は必ず M層が手動で行う。** ベンダーは GitHub Actions ランナー上で動くため、Mac mini への書き込みも Railway 認証もできない。

---

## 事前準備（初回のみ）

Mac mini に以下が揃っていること。

```bash
cd ~/Dev/mnml/shift/backend
node --version         # v18 以上
npm --version
```

devDependency の `node-pg-migrate` が未インストールの場合は `npm install` を実行する（`db:migrate:*` スクリプトは devDependency に依存）。

```bash
cd ~/Dev/mnml/shift/backend
npm install
```

---

## 手順

### 1. Railway dashboard から staging DATABASE_URL を取得

Web ブラウザ:

1. https://railway.app にログイン
2. プロジェクト `shift-scheduler-ai` を開く
3. **staging environment**（`humble-manifestation`）を選択
4. backend サービスの **Variables** タブを開く
5. `DATABASE_URL` の値をコピー（`switchyard:26491` を含むホスト名になっているはず）

> **重要**: `mainline:50142` を含む URL は production の DB。絶対に staging 用として使わない。

### 2. `.env.staging.local` を配置

Mac mini のターミナル:

```bash
cd ~/Dev/mnml/shift/backend

# クリップボードから貼るか、下記コマンドで直接書き込む
printf 'DATABASE_URL=%s\n' '<コピーした staging URL>' > .env.staging.local

# パーミッションを絞る
chmod 600 .env.staging.local
```

### 3. `.env.staging.local` が gitignore 済であることを検証

```bash
git check-ignore .env.staging.local
```

**期待される出力**: `.env.staging.local`（パスがそのまま返れば無視対象）

出力が空の場合はコミット可能な状態になっているため、**絶対にコミットせず** `.gitignore` を確認し直すこと。

### 4. staging の migration 状態を確認（dry-run）

```bash
npm run db:migrate:status:staging
```

- pending の migration が一覧表示される。実際には DB を変更しない。
- 接続先が staging（`switchyard`）になっていることをログで確認する。

### 5. 必要に応じて migration 実行

未適用の migration を staging に「適用済み」として記録する（Issue #64 残タスク）:

```bash
npm run db:migrate:fake:staging
```

通常の適用（実際に DDL を実行）:

```bash
npm run db:migrate:up:staging
```

---

## npm スクリプト早見表

`backend/package.json` の staging 用スクリプト。共通で `--envPath .env.staging.local` を渡し、DATABASE_URL をそのファイル経由で読み込む。

| スクリプト | 説明 |
|---|---|
| `db:migrate:status:staging` | dry-run。pending の migration を表示するだけで DB は変更しない |
| `db:migrate:up:staging` | 未適用 migration を staging に適用（実 DDL 実行） |
| `db:migrate:fake:staging` | 未適用 migration を「適用済み」としてマークのみ（DDL は実行しない） |

既存の `db:migrate:up` / `db:migrate:down` / `db:migrate:create` / `db:migrate:status` / `db:migrate:fake` は無変更（local DB 向け、`.env` を参照）。

---

## トラブルシューティング

### `Cannot find module 'node-pg-migrate'`
- `npm install` が未実行。`cd ~/Dev/mnml/shift/backend && npm install` を実行する。

### `ENOENT: no such file or directory, open '.env.staging.local'`
- `.env.staging.local` を配置していない。上記「手順 2」を実施する。

### 接続エラー（`ECONNREFUSED` / `password authentication failed`）
- Railway dashboard から取得した URL が古い or コピーに欠落がある可能性。取り直して `.env.staging.local` を上書きする。
- production URL（`mainline`）を誤って書いていないか確認する。

### `git status` に `.env.staging.local` が表示される
- `.gitignore` が壊れている。`git check-ignore .env.staging.local` の出力が空になったら即中断し、`.gitignore` を修復する（`.env.*` と `!.env.example` / `!.env.staging.example` が正しい順で並んでいるか確認）。

### Railway CLI 経由でやりたい（代替）
本手順書の主案は「手動コピー + `.env.staging.local`」だが、Railway CLI を認証済にしておくと `railway variables` で URL 取得も自動化できる。手順は次の通り:

```bash
# 無効な環境変数を退避
unset RAILWAY_TOKEN

# 対話ログイン（ブラウザが開く）
railway login

# プロジェクト・環境を選択
railway link
railway environment staging

# 現在の環境変数一覧を表示（DATABASE_URL を目視で取得）
railway variables
```

CI/自動化目的では使用しない。あくまで手動オペの補助。

---

## 関連

- Issue #189: staging DB 接続情報を Mac mini に配備（本手順書の起票元）
- Issue #64: node-pg-migrate 導入。`db:migrate:fake:staging` はここの残タスク解消用
- `docs/operations/staging-verification-flow.md`（リポジトリルート）: staging → production 昇格の runbook
