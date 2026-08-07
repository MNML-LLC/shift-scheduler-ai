# バックエンド API ドキュメント

**このファイルは廃止されました。API 仕様の Single Source of Truth は [`openapi.yaml`](./openapi.yaml) です。**

- **仕様の閲覧**: `openapi.yaml` を [Swagger Editor](https://editor.swagger.io/) や [Redocly Preview](https://redocly.github.io/redoc/) に貼り付けてブラウザで参照してください。
- **エンドポイント追加時**: 実装コード (`src/routes/*.js`) と一緒に `openapi.yaml` の該当 path を必ず更新してください。
- **README との整合**: [`README.md`](./README.md) のエンドポイント一覧も併せて更新してください。

---

## 更新手順

1. `src/routes/*.js` に新しいルートを追加、または既存ルートを変更する。
2. `openapi.yaml` の `paths:` セクションに同じパス・メソッド・パラメータ・レスポンスを追記／修正する。
3. YAML 構文チェック:
   ```bash
   python3 -c "import yaml; yaml.safe_load(open('backend/openapi.yaml'))"
   ```
   (または `npx @redocly/cli lint backend/openapi.yaml` / `npx swagger-cli validate backend/openapi.yaml`)
4. `README.md` の該当セクションを更新する。

## 履歴

- 従来 `API.md` に手動記載していたエンドポイント一覧は `openapi.yaml` へ完全に移行しました。
  乖離リスクを避けるため、本ファイルは今後編集しません。
