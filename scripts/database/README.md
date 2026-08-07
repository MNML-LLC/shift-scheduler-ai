# データベースセットアップ

このディレクトリには、データベースのスキーマ定義とセットアップスクリプトが含まれています。

## ディレクトリ構造

```
database/
├── ddl/
│   └── schema.sql                    # DDL（スキーマ定義）
│
├── dml/
│   └── STAND_BANH_MI/
│       └── 00_initialize/
│           ├── 01_core_master_stand-banh-mi.sql   # coreスキーママスターデータ
│           ├── 02_hr_master_stand-banh-mi.sql     # hrスキーママスターデータ
│           └── 03_ops_master_stand-banh-mi.sql    # opsスキーママスターデータ
│
└── setup/
    ├── setup.mjs                     # メインセットアップスクリプト
    ├── setup_tenant3_test_data.mjs   # Tenant3シフトデータ登録
    └── README.md                     # このファイル
```

## セットアップ方法

### 前提条件

- Node.js `>=22.0.0`（リポジトリルートの `package.json` `engines` に準拠）
- PostgreSQL 15+ がインストールされ、ローカルに空 DB を作成済みであること
  ```bash
  # 例: ローカル DB を作成する
  createdb shift_scheduler
  ```
- `backend/.env` に `DATABASE_URL` が設定されていること
  - 形式: `postgresql://<user>:<password>@<host>:<port>/<database>`
  - 例（ローカル）: `postgresql://postgres:postgres@localhost:5432/shift_scheduler`
  - `backend/.env.example` をコピーして編集してください

### 開発環境セットアップ

最小限のマスターデータのみ登録します。

```bash
cd scripts/database/setup
node setup.mjs --env dev
```

**実行内容:**
1. DDL: `schema.sql` - 全テーブル作成
2. DML: `STAND_BANH_MI/00_initialize/01_core_master_stand-banh-mi.sql` - coreスキーママスター
3. DML: `STAND_BANH_MI/00_initialize/02_hr_master_stand-banh-mi.sql` - hrスキーママスター
4. DML: `STAND_BANH_MI/00_initialize/03_ops_master_stand-banh-mi.sql` - opsスキーママスター

### 動作確認

セットアップ後、テーブルが作成されていることを確認します。

```bash
# スキーマとテーブル数を確認（psql を使う場合）
psql "$DATABASE_URL" -c "\dn"                     # スキーマ一覧（core / hr / ops が並ぶ）
psql "$DATABASE_URL" -c "\dt core.*"              # core スキーマのテーブル一覧
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM core.tenants;"  # マスターデータ件数
```

バックエンドの `/api/health` エンドポイントでも DB 接続を確認できます。

```bash
cd backend && npm run dev
# 別ターミナルで
curl http://localhost:3001/api/health
# → {"status":"ok","database":{"connected":true, ...}}
```

### デモ環境セットアップ

マスターデータ + Tenant3の充実したシフトデータを登録します。

```bash
cd scripts/database/setup
node setup.mjs --env demo
```

**実行内容:**
1. DDL: `schema.sql`
2. DML: `STAND_BANH_MI/00_initialize/01_core_master_stand-banh-mi.sql`, `02_hr_master_stand-banh-mi.sql`, `03_ops_master_stand-banh-mi.sql`
3. Script: `setup_tenant3_test_data.mjs` - 51名のスタッフ + 3077件のシフト登録

## ファイル詳細

### DDL

#### `ddl/schema.sql`

全てのテーブル定義が含まれています:
- Part 1: マスターテーブル定義
- Part 2: トランザクションテーブル定義
- Part 3: インデックスと制約
- Part 4: トリガー
- **Part 5: マイグレーション** (後から追加されたテーブル)
  - LINE連携テーブル
  - plan_typeカラム追加

#### 2025-11-27 スキーマ変更

**ops.shifts テーブル**
- `start_time`: TIME → VARCHAR(5) （24時超過対応: "25:00"形式）
- `end_time`: TIME → VARCHAR(5)
- `pattern_id`: NOT NULL → NULL許可

**ops.shift_preferences テーブル** - 完全再設計
- 旧: 1ヶ月1レコード（year, month, preferred_days, ng_days）
- 新: 1日1レコード（preference_date, is_ng, start_time, end_time）
- 詳細: `docs/design-docs/20251126_shift_preferences_schema_change.html`

### DML

#### `dml/STAND_BANH_MI/00_initialize/01_core_master_stand-banh-mi.sql` - coreスキーマ

- テナント (tenant_id=3, Stand Banh Mi)
- 事業部 (デフォルト部門)
- 雇用形態 (正社員、アルバイト)
- 役職 (アルバイト、社員)
- 店舗 (COME、Atelier、SHIBUYA、Stand Banh Mi、Stand Bo Bun)
- シフトパターン (早番、中番、遅番、通し)
- スキル (調理基礎、調理上級、接客、レジ、マネジメント)

#### `dml/STAND_BANH_MI/00_initialize/02_hr_master_stand-banh-mi.sql` - hrスキーマ

- 税率区分 (7段階の累進課税)
- 社会保険料率 (健康保険、厚生年金、雇用保険、労災保険)
- 通勤手当 (距離別5段階)
- スタッフ (簡易版: テストスタッフのみ)

#### `dml/STAND_BANH_MI/00_initialize/03_ops_master_stand-banh-mi.sql` - opsスキーマ

- 労働法制約 (7種類: 週間労働時間、日労働時間等)
- 労務管理ルール (5種類: 残業アラート、連続勤務等)
- 店舗制約 (各店舗の営業時間・最低人数)
- シフト検証ルール (6種類: 重複チェック、休憩時間等)
- シフト種別 (通常、早番、遅番、中番)

### セットアップスクリプト

#### `setup/setup.mjs`

メインセットアップスクリプト。環境に応じてDDL/DMLを順番に実行します。

**オプション:**
- `--env dev` - 開発環境
- `--env demo` - デモ環境
- `--help` - ヘルプ表示

#### `setup/setup_tenant3_test_data.mjs`

Tenant3（Stand Banh Mi）の充実したテストデータを登録します:
- 51名のスタッフ（CSVから抽出）
- 3077件のシフトデータ（CSV: `fixtures/shift_pdfs/csv_output/シフト.csv`）

**使い方:**
```bash
# setup.mjs --env demoの中で自動実行されます

# または単独で実行:
node setup_tenant3_test_data.mjs register
node setup_tenant3_test_data.mjs delete  # データ削除
```

## トラブルシューティング

### データベース接続エラー

```
Error: connect ECONNREFUSED
```

**解決方法:**
1. `backend/.env`のDATABASE_URLを確認
2. PostgreSQLが起動しているか確認

### 既存データとの競合

```
ERROR: duplicate key value violates unique constraint
```

**解決方法:**

既存データを削除してから再実行:

```bash
# Tenant3のデータを削除
node setup_tenant3_test_data.mjs delete

# 再度セットアップ
node setup.mjs --env dev
```

### SQL構文エラー

```
ERROR: syntax error at or near
```

**解決方法:**
1. PostgreSQLのバージョンを確認 (15+推奨)
2. SQLファイルの文法を確認

## データ修正が必要な場合

### マスターデータを修正したい

1. 該当するSQLファイルを編集:
   - `dml/STAND_BANH_MI/00_initialize/01_core_master_stand-banh-mi.sql` - coreスキーマ
   - `dml/STAND_BANH_MI/00_initialize/02_hr_master_stand-banh-mi.sql` - hrスキーマ
   - `dml/STAND_BANH_MI/00_initialize/03_ops_master_stand-banh-mi.sql` - opsスキーマ

2. データベースを再セットアップ:
   ```bash
   node setup.mjs --env dev
   ```

### スキーマを変更したい

1. `ddl/schema.sql`を編集
2. 再セットアップ:
   ```bash
   node setup.mjs --env dev
   ```

## 参照ファイル

セットアップスクリプトが参照する外部ファイル:

1. **backend/.env** - データベース接続文字列 (DATABASE_URL)
2. **fixtures/shift_pdfs/csv_output/シフト.csv** - シフトデータ (3077件)

これらのファイルが存在しない場合、エラーになります。

## データベース変更管理方針

このプロジェクトでは **node-pg-migrate によるマイグレーション方式** でデータベースを管理します（Issue #64 / #181 で移行）。

- **DDL（初期スキーマ）**: `ddl/schema.sql` はベースラインスナップショットとして維持
- **DML（初期データ）**: `dml/*.sql` にマスターデータを記載
- **スキーマ変更**: `scripts/database/migrations/` に `<timestamp>_<name>.js` 形式で追加する
- **マイグレーション履歴**: DB 側の `pgmigrations` テーブルで管理される
- **archive/**: 旧一回限り修正スクリプト（`check_jan2026.mjs` など）を保存。実行対象外

### 新しいマイグレーション作成手順

1. **新しいマイグレーションファイルを作成**:
   ```bash
   cd backend
   npm run db:migrate:create -- my-change-description
   ```
   → `scripts/database/migrations/<timestamp>_my-change-description.js` が生成される

2. **`up` / `down` を実装**:
   ```js
   export const shorthands = undefined

   export async function up(pgm) {
     pgm.addColumn({ schema: 'ops', name: 'shifts' }, {
       note: { type: 'text', notNull: false },
     })
   }

   export async function down(pgm) {
     pgm.dropColumn({ schema: 'ops', name: 'shifts' }, 'note')
   }
   ```
   詳細な API は [node-pg-migrate ドキュメント](https://salsita.github.io/node-pg-migrate/) を参照

3. **ローカル DB に適用**:
   ```bash
   cd backend
   npm run db:migrate:up
   ```

4. **ロールバック（開発中のみ）**:
   ```bash
   cd backend
   npm run db:migrate:down
   ```

5. **未適用マイグレーションの確認（dry-run）**:
   ```bash
   cd backend
   npm run db:migrate:status
   ```

### staging / production への適用

- **staging**: PR マージ → デプロイ後に shift M 層が `npm run db:migrate:up` を手動実行
- **production**: staging での動作確認後、shift M 層が `npm run db:migrate:up` を手動実行
- **既存 DB を新マイグレーション管理下に取り込む場合**: `npm run db:migrate:fake` でベースライン相当分を "適用済み" としてマークする（実 DDL は流さない）
- **本番 DB への破壊的操作は shift M 層のみが実施**。ベンダーやコード生成エージェントは実行しないこと

### スキーマ変更の全体フロー

```
ローカル: マイグレーション作成 → db:migrate:up で検証 → PR
    ↓
マージ後 staging: shift M 層が npm run db:migrate:up を手動実行
    ↓
production: staging で問題なければ shift M 層が同様に手動実行
```

## 注意事項

- **Tenant ID = 3で固定**: 全てのマスターデータはtenant_id=3で登録されます
- **本番環境では実行しないこと**: このスクリプトはテスト/開発環境専用です
- **データ削除機能**: `setup_tenant3_test_data.mjs delete`で削除できますが、本番では使用しないでください
