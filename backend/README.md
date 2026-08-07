# AIシフト管理システム - バックエンドAPI

OpenAI Assistants APIをプロキシし、シフト管理データのCSV処理を行うNode.js/Expressバックエンドサーバー。

## 特徴

- 🔐 **セキュアなAPIプロキシ**: OpenAI APIキーをバックエンドで管理
- 📄 **CSV→JSON自動変換**: Papa Parseでシームレスな変換
- 🤖 **Assistants API完全サポート**: Vector Stores、Threads、Runs等の全機能
- ✅ **テスト完備**: 30テストケース (Vitest + supertest)
- 📚 **APIドキュメント**: OpenAPI 3.0スペック + 詳細ドキュメント
- 🏗️ **クリーンアーキテクチャ**: Routes → Services → Utils

## クイックスタート

### 1. インストール

```bash
cd backend
npm install
```

### 2. 環境変数設定

`.env.local`ファイルを作成（サンプルからコピー）:

```bash
cp .env.local.example .env.local
```

`.env.local`を編集:

```env
# Railway PostgreSQL接続情報
DATABASE_URL=postgresql://postgres:your-password@your-host:port/railway

# サーバー設定
PORT=3001

# CORS設定
CORS_ORIGIN=http://localhost:5173

# OpenAI API Key
OPENAI_API_KEY=sk-proj-your-api-key-here
```

**環境ファイルの優先順位:**
1. `.env.local` (ローカル開発用、gitignore対象)
2. `.env.staging` / `.env.production` (参考用、コミット対象)
3. `.env` (デフォルト、非推奨)

### 3. サーバー起動

```bash
# 開発モード (ホットリロード)
npm run dev

# 本番モード
npm start
```

サーバーは `http://localhost:3001` で起動します。

## API使用例

### Chat Completions

```bash
curl -X POST http://localhost:3001/api/openai/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "シフトを作成してください"}
    ]
  }'
```

### CSVファイル保存

```bash
curl -X POST http://localhost:3001/api/save-csv \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "shift_2024_11.csv",
    "content": "name,date,shift\nJohn,2024-11-01,Morning"
  }'
```

### CSV→JSONアップロード

```bash
curl -X POST http://localhost:3001/api/openai/files \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "data/master/staff.csv"
  }'
```

## API エンドポイント

**全 API 仕様の Single Source of Truth は [`openapi.yaml`](./openapi.yaml)**（80 パス / 112 オペレーション）です。
[Swagger Editor](https://editor.swagger.io/) や [Redocly Preview](https://redocly.github.io/redoc/) に貼り付けてブラウザで参照できます。

### マウントプレフィクス概要 (`src/server.js`)

| プレフィクス | ルーター | 用途 |
|---|---|---|
| `/api/health` | `health.js` | ヘルスチェック (DB 到達性) |
| `/api/tenants` | `tenants.js` | テナント一覧 / 詳細 |
| `/api/master` | `master.js` | マスタ CRUD (staff / roles / stores / skills / employment-types / shift-patterns / divisions / commute / insurance / tax など) |
| `/api/shifts` | `shifts.js` | シフト計画・シフト・希望シフトの CRUD, AI 生成, 承認, バッチ |
| `/api/analytics` | `analytics.js` | 給与・売上・労働時間・ダッシュボード指標 |
| `/api/liff` | `liff.js` | LINE LIFF (希望シフト / 月次提出 / スタッフ登録) |
| `/api/holidays` | `holidays.js` | 日本の祝日 (内閣府 CSV 由来、24h キャッシュ) |
| `/api/openai` | `openai.js` | OpenAI API プロキシ (Chat / Assistants / Vector Stores) |
| `/api/vector-store` | `vector-store.js` | DB マスタから Vector Store を構築 |
| `/api` | `csv.js` | `save-csv` / `load-csv` |

エンドポイントごとの詳細 (メソッド / パラメータ / リクエスト・レスポンス / エラーコード) は `openapi.yaml` を参照してください。

## テスト

```bash
# テスト実行
npm test

# ウォッチモード
npm run test:watch

# カバレッジ計測
npm run test:coverage
```

**テストカバレッジ:** 30テスト全通過

- fileService: CSV保存、変換、削除 (9テスト)
- openaiService: API設定、ヘッダー (7テスト)
- OpenAI routes: 全11エンドポイント (10テスト)
- CSV routes: ファイル保存 (4テスト)

## プロジェクト構成

```
backend/
├── src/
│   ├── server.js              # Expressサーバー (29行)
│   ├── routes/
│   │   ├── openai.js          # OpenAI APIルート (11エンドポイント)
│   │   ├── openai.test.js     # OpenAIルートテスト
│   │   ├── csv.js             # CSVルート
│   │   └── csv.test.js        # CSVルートテスト
│   ├── services/
│   │   ├── openaiService.js   # OpenAI SDK設定
│   │   ├── openaiService.test.js
│   │   ├── fileService.js     # ファイル処理
│   │   └── fileService.test.js
│   └── utils/
│       └── logger.js          # ログ管理
├── openapi.yaml               # OpenAPI 3.0スペック
├── API.md                     # 廃止マーカー (openapi.yaml を参照)
├── vitest.config.js           # テスト設定
├── package.json
└── README.md                  # このファイル
```

### レイヤー構成

- **Routes**: HTTPリクエスト処理、エンドポイント定義
- **Services**: ビジネスロジック、OpenAI SDK、ファイル操作
- **Utils**: ログ管理等のユーティリティ

## 主要機能

### 1. CSV→JSON自動変換

```javascript
// frontend/public/data/master/staff.csv を自動変換
const file = await client.uploadFile('data/master/staff.csv')
// → OpenAIにstaff.jsonとしてアップロード
```

**処理フロー:**
1. CSVファイル読み込み (`frontend/public/`から)
2. Papa Parseで解析してJSON化
3. 一時JSONファイル作成 (`backend/src/temp/`)
4. OpenAIにアップロード
5. 一時ファイル削除

### 2. セキュアなAPIキー管理

- APIキーは`.env`でバックエンド管理
- フロントエンドからは直接OpenAIにアクセスしない
- CORSはデフォルトで全許可 (本番環境では制限推奨)

### 3. ログ管理

全てのAPI操作を `src/server.log` に記録:

```
[2024-11-05T10:30:00.000Z] 🚀 Backend server running on http://localhost:3001
[2024-11-05T10:30:15.123Z] ✅ ファイルアップロード成功: staff.json → file-xyz789
[2024-11-05T10:30:20.456Z] ✅ CSVファイルを保存しました: shift_2024_11.csv
```

## フロントエンドとの連携

### OpenAIClientの使用

```javascript
import { OpenAIClient } from '@/infrastructure/api/OpenAIClient'

const client = new OpenAIClient('http://localhost:3001')

// Vector Store & Assistantセットアップ
const vectorStore = await client.createVectorStore('Staff Data')
const file = await client.uploadFile('data/master/staff.csv')
await client.addFileToVectorStore(vectorStore.id, file.id)

const assistant = await client.createAssistant({
  name: 'Shift Assistant',
  model: 'gpt-4-turbo-preview',
  tools: [{ type: 'file_search' }],
  tool_resources: {
    file_search: { vector_store_ids: [vectorStore.id] }
  }
})

// Thread & Run
const thread = await client.createThread()
await client.addMessage(thread.id, 'user', 'シフトを作成')
const run = await client.createRun(thread.id, assistant.id)

// 完了待機
while (true) {
  const status = await client.getRunStatus(thread.id, run.id)
  if (status.status === 'completed') break
  await new Promise(r => setTimeout(r, 1000))
}

const messages = await client.getMessages(thread.id)
```

## トラブルシューティング

### ポート競合エラー

```bash
Error: Port 3001 is already in use
```

**解決:**
```bash
lsof -ti:3001 | xargs kill
```

### ファイルアップロードエラー

```bash
Error: ファイルが見つかりません: /path/to/file.csv
```

**確認事項:**
- ファイルパスが`frontend/public/`からの相対パスか
- ファイルが実際に存在するか

### OpenAI APIエラー

```bash
Error: 401 Unauthorized
```

**確認事項:**
- `.env`ファイルの`VITE_OPENAI_API_KEY`が正しいか
- APIキーが有効か

## 開発

### 依存関係

```json
{
  "dependencies": {
    "express": "^5.1.0",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3",
    "openai": "^6.1.0",
    "papaparse": "^5.5.3"
  },
  "devDependencies": {
    "vitest": "^3.2.4",
    "supertest": "^7.1.4",
    "@vitest/coverage-v8": "^3.2.4"
  }
}
```

### スクリプト

```bash
npm start              # 本番サーバー起動
npm run dev            # 開発サーバー起動 (ホットリロード)
npm test               # テスト実行
npm run test:watch     # テストウォッチモード
npm run test:coverage  # カバレッジ計測
```

## ドキュメント

- [openapi.yaml](./openapi.yaml) - **API 仕様の Single Source of Truth (OpenAPI 3.0)**
- [API.md](./API.md) - 廃止マーカー (openapi.yaml を参照)
- [フロントエンドREADME](../frontend/README.md)
- [プロジェクトREADME](../README.md)

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。

## Vercelデプロイ

### 環境変数の設定

Vercelダッシュボードで以下の環境変数を設定してください：

#### ステージング環境 (staging)

```
DATABASE_URL=postgresql://postgres:BWmHYBbEZqnptZRYmptockuomkHRWNPO@switchyard.proxy.rlwy.net:26491/railway
PORT=3001
CORS_ORIGIN=https://your-staging-frontend.vercel.app
OPENAI_API_KEY=sk-proj-your-openai-api-key-here
NODE_ENV=staging
```

#### 本番環境 (production)

```
DATABASE_URL=postgresql://postgres:gkfRVoPvcoLdoDHjCabWcBWhYYBONYfe@mainline.proxy.rlwy.net:50142/railway
PORT=3001
CORS_ORIGIN=https://your-production-frontend.vercel.app
OPENAI_API_KEY=sk-proj-your-openai-api-key-here
NODE_ENV=production
```

### 自動デプロイ

- `staging`ブランチへのpush → STG環境に自動デプロイ
- `main`ブランチへのマージ → PRD環境に自動デプロイ

### デプロイ設定

`vercel.json`でビルドとルーティングを設定:

```json
{
  "version": 2,
  "builds": [{ "src": "src/server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "src/server.js" }],
  "env": { "NODE_ENV": "production" }
}
```

## 貢献

バグ報告や機能リクエストはIssueでお願いします。

---

**Built with ❤️ using Node.js, Express, OpenAI SDK, and Vitest**
