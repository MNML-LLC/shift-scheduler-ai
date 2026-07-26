// テスト実行前のセットアップ
// OpenAI API keyがない場合はテスト用のダミーkeyを設定
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = 'test-api-key-for-testing'
}

// database.js の import 経路で env.js が必須環境変数を検証するため
// テストからも `vi.importActual('../../src/config/database.js')` が安全に呼べるよう
// ダミー値を注入する。
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
}
if (!process.env.PORT) {
  process.env.PORT = '3001'
}
