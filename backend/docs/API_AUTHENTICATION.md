# API認証 設定ガイド

## 概要

これまで `/api/liff` 以外の全APIルート（`/api/shifts`・`/api/analytics`・`/api/master` 等）は
認証なしでアクセス可能だった。本ドキュメントは、その全ルートに適用される共有APIキー方式の
認証ミドルウェア（`backend/src/middleware/authenticate.js`）の設定方法を説明する。

## アーキテクチャ

```
┌──────────────┐
│ Request      │
└──────┬───────┘
       ▼
┌─────────────────────────────┐
│ server.js グローバルミドルウェア │
│  1. isPublicPath() で除外パス判定 │
│  2. 除外対象外なら authenticate() │
└──────┬───────────────────────┘
       ▼
   有効な x-api-key ヘッダー？
   ├─ Yes → 次のルートハンドラへ
   └─ No  → 401 Unauthorized
```

### 除外リスト（認証不要のパス）

`backend/src/middleware/authenticate.js` の `PUBLIC_PATH_PREFIXES`:

| パス | 理由 |
|---|---|
| `/api/health` | ヘルスチェック用。認証情報を持たない監視ツールからも呼ばれる |
| `/api/liff` | LINE ID Token（`verifyLineToken` ミドルウェア）でルート単位に認証済み |
| `/api/shifts/plans/monthly-first-plan-batch` | 既存の `x-batch-api-key`（`BATCH_API_KEY`）による専用認証済み。GitHub Actionsから呼び出される |

上記以外の全 `/api/*` ルートは `x-api-key` ヘッダーの検証が必須になる。

## 環境変数

| 変数名 | 説明 | デフォルト |
|---|---|---|
| `API_AUTH_ENABLED` | `'true'` で認証を有効化。それ以外は無効（全リクエスト許可） | 無効 |
| `API_AUTH_KEYS` | カンマ区切りの有効なAPIキー一覧（ローテーション用に複数設定可） | 未設定 |

キーの生成例:

```bash
openssl rand -hex 32
```

`API_AUTH_ENABLED=true` かつ `API_AUTH_KEYS` が未設定の場合、全リクエストが 401 で拒否される
（フェイルクローズ）。

## フロントエンドの設定

`frontend/src/config/api.js` の `getAuthHeaders()` が `VITE_BACKEND_API_KEY` から
`x-api-key` ヘッダーを生成し、`frontend/src/utils/http.js`（`fetchJSON`/`getJSON`/`postJSON`）
経由のリクエストに自動付与する。

```bash
# frontend/.env
VITE_BACKEND_API_KEY=<API_AUTH_KEYS と同じ値>
```

**注意:** `VITE_` プレフィックスの環境変数はビルド後のJSに埋め込まれ、ブラウザから閲覧可能になる。
そのため `VITE_BACKEND_API_KEY` は真の意味での秘密情報ではなく、`VITE_PASSWORD_PROTECTION_CREDENTIALS`
（`frontend/docs/BASIC_AUTH_SETUP.md` 参照）と同様、無差別なスクリプト/ボットからのアクセスを
防ぐための軽量な対策である。

**既知の制約:** `frontend/src/utils/http.js` の共通ラッパーを経由しない一部の `fetch()` 呼び出し
（`frontend/src/utils/assistantClient.js` など）には、本対応時点ではまだ `x-api-key` ヘッダーが
付与されていない。バックエンド側で `API_AUTH_ENABLED=true` に切り替える前に、これらの呼び出しにも
認証ヘッダーを付与するフォローアップ対応が必要。

## ロールアウト手順（本番環境）

デグレを避けるため、まず staging 環境で以下の手順を一通り検証してから本番に適用すること。

1. バックエンドに `API_AUTH_KEYS` を設定した状態でデプロイする（`API_AUTH_ENABLED=false` のまま）。
2. フロントエンドに同じ値を `VITE_BACKEND_API_KEY` として設定し、デプロイする。
3. 「既知の制約」に挙げた `http.js` を経由しない呼び出しにも認証ヘッダーを付与する。
4. 動作確認後、バックエンドの `API_AUTH_ENABLED` を `true` に変更し、再デプロイする。

## 動作確認

```bash
# 認証なし → 401
curl -i http://localhost:3001/api/shifts

# 認証あり → 200
curl -i -H "x-api-key: <API_AUTH_KEYSの値>" http://localhost:3001/api/shifts

# 除外リスト対象は認証不要
curl -i http://localhost:3001/api/health
```

## 関連ファイル

- `backend/src/middleware/authenticate.js` — 認証ミドルウェア本体
- `backend/src/server.js` — グローバルミドルウェアとしての適用箇所
- `backend/src/middleware/verifyLineToken.js` — `/api/liff` 用のLINE ID Token検証
- `frontend/src/config/api.js` — `getAuthHeaders()`
- `frontend/src/utils/http.js` — 共通fetchラッパーへの認証ヘッダー付与
- `frontend/middleware.js` / `frontend/docs/BASIC_AUTH_SETUP.md` — フロントエンドSPA自体を守る
  Vercel Edge Middleware（本ドキュメントの対象とは別レイヤー）
