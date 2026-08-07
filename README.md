# AIシフトスケジューラー

AIによる自動シフト生成システムです。PostgreSQLデータベースとOpenAI GPT-4を活用した、マルチテナント対応のシフト管理アプリケーションです。

## 📚 ドキュメント

### プロダクト概要
- [プロダクト概要のLP](https://claude.ai/public/artifacts/0f62011c-69c4-4e2f-abfc-01e52b5323a9)
- [アーキテクチャー設計書並びにシステム構成](https://sysdiag-datorr.manus.space)

### 技術ドキュメント
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - システムアーキテクチャ
- [DATABASE_GUIDE.md](docs/DATABASE_GUIDE.md) - データベース接続・セットアップ
- [DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) - データベーススキーマ設計
- [CONFIGURATION.md](docs/CONFIGURATION.md) - 設定ガイド
- [QUICK_START.md](docs/QUICK_START.md) - クイックスタートガイド

## クイックスタート

### 0. 前提条件

- **Node.js**: `>=22.0.0`（`package.json` の `engines` で規定）
- **PostgreSQL**: 15 以上
- **pnpm**: フロントエンド用（`npm install -g pnpm`）

### 1. リポジトリのクローン

```bash
git clone https://github.com/info-mnml/shift-scheduler-ai.git
cd shift-scheduler-ai
```

### 2. バックエンドの環境変数設定

```bash
cd backend
cp .env.example .env
# .env を編集し、少なくとも DATABASE_URL を設定
#   例: DATABASE_URL=postgresql://user:password@localhost:5432/shift_scheduler
cd ..
```

### 3. データベース初期化

`scripts/database/setup/setup.mjs` が DDL → DML の順に実行します。

```bash
# 依存関係をインストール（ルートから backend も自動で入る）
npm install

# 開発環境用データ（マスターのみ）
cd scripts/database/setup
node setup.mjs --env dev

# デモ環境用データ（マスター + Tenant3 のシフトデータ）
# node setup.mjs --env demo
```

実行順序:

1. DDL: `scripts/database/ddl/schema.sql` — 全テーブル作成
2. DML: `scripts/database/dml/STAND_BANH_MI/00_initialize/01_core_master_stand-banh-mi.sql` — core スキーマ
3. DML: `scripts/database/dml/STAND_BANH_MI/00_initialize/02_hr_master_stand-banh-mi.sql` — hr スキーマ
4. DML: `scripts/database/dml/STAND_BANH_MI/00_initialize/03_ops_master_stand-banh-mi.sql` — ops スキーマ

詳細は [scripts/database/README.md](scripts/database/README.md) および [DATABASE_GUIDE.md](docs/DATABASE_GUIDE.md) を参照。

### 4. バックエンドの起動

```bash
cd backend
npm install
npm run dev  # http://localhost:3001 で起動
```

動作確認: `curl http://localhost:3001/api/health` が 200 と `database.connected: true` を返せば OK。

### 5. フロントエンドの起動

```bash
cd frontend
pnpm install
pnpm run dev  # http://localhost:5173 で起動
```

## システム機能

### 主な機能

- **マルチテナント対応**: 複数法人・事業・店舗の階層管理
- **マスターデータ管理**: 17種類のマスターデータAPI（店舗、スタッフ、役職、スキルなど）
- **ダッシュボード**: 売上・人件費・利益の予実分析とグラフ表示
- **シフト管理**: 月別シフトの作成・編集・閲覧
- **スタッフ管理**: スタッフ情報と給与計算
- **店舗管理**: 店舗情報と制約条件の管理
- **制約管理**: 労働基準法などの制約設定
- **予実管理**: 実績データのインポートと分析
- **開発者ツール**: バリデーションチェック、AI対話（GPT-4）、シフト自動生成
- **LINE連携**: シフト希望の収集（実装予定）

## 🛠️ 技術スタック

### Frontend
- **Framework**: React 19, Vite
- **UI**: Tailwind CSS v4, Radix UI
- **Charts**: Recharts
- **Animation**: Framer Motion
- **CSV**: PapaParse

### Backend
- **Runtime**: Node.js, Express
- **Database**: PostgreSQL 15+ (Railway)
- **AI**: OpenAI GPT-4 API, Assistants API v2
- **ORM**: node-postgres (pg)

## 📁 プロジェクト構成

```
shift-scheduler-ai/
├── frontend/                  # フロントエンド（React + Vite）
│   ├── src/
│   │   ├── components/        # Reactコンポーネント
│   │   ├── utils/             # ユーティリティ
│   │   ├── infrastructure/    # リポジトリ層
│   │   └── dev/               # 開発ツール
│   └── public/data/           # CSVデータ（レガシー）
│
├── backend/                   # バックエンド（Express + PostgreSQL）
│   ├── src/
│   │   ├── server.js          # APIサーバー
│   │   ├── config/
│   │   │   └── database.js    # DB接続設定
│   │   ├── routes/
│   │   │   ├── openai.js      # OpenAI APIルート
│   │   │   ├── csv.js         # CSV操作ルート
│   │   │   └── master.js      # マスターデータAPIルート
│   │   └── utils/
│   └── .env                   # 環境変数
│
├── scripts/
│   ├── database/              # データベースセットアップ
│   │   ├── ddl/schema.sql                              # スキーマ定義（全テーブル）
│   │   ├── dml/STAND_BANH_MI/00_initialize/            # マスターデータ DML（01/02/03）
│   │   ├── setup/setup.mjs                             # DB 初期化スクリプト（--env dev/demo）
│   │   └── migrations/        # node-pg-migrate マイグレーション
│   ├── backup/                # 本番 DB バックアップ
│   └── debug/                 # 開発・デバッグ用スクリプト
│
├── docs/                      # ドキュメント
│   ├── ARCHITECTURE.md        # アーキテクチャ設計
│   ├── DATABASE_GUIDE.md      # DB接続・セットアップ
│   ├── DATABASE_SCHEMA.md     # スキーマ設計書
│   └── ...                    # その他ドキュメント
│
└── README.md                  # このファイル
```

詳細な構成は [ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## Git コマンド

```bash
# ブランチ作成
git checkout -b feature/branch-name

# 変更をステージング
git add .

# コミット
git commit -m "commit message"

# プッシュ
git push origin feature/branch-name
```

## ライセンス

MIT License

<!-- auto-deploy test 1779032671 -->
