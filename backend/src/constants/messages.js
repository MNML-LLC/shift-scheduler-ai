/**
 * バックエンドAPIで使用するメッセージ定義
 */

export const MESSAGES = {
  // 成功メッセージ
  SUCCESS: {
    SHIFT_PLAN_CREATED: 'シフト計画を作成しました',
    SHIFT_CREATED: 'シフトを作成しました',
    SHIFT_UPDATED: 'シフトを更新しました',
    SHIFT_DELETED: 'シフトを削除しました',
    FIRST_PLAN_APPROVED: '第1案を承認しました',
    SHIFT_PREFERENCE_CREATED: '希望を登録しました',
    SHIFT_PREFERENCE_UPDATED: '希望を更新しました',
    SHIFT_PREFERENCE_DELETED: '希望を削除しました',
    DATA_IMPORTED: (count) => `${count}件のデータをインポートしました`,
    WORK_HOURS_IMPORTED: (count) => `労働時間実績データを登録しました（${count}件）`,
    PAYROLL_IMPORTED: (count) => `給与データを登録しました（${count}件）`,
  },

  // バリデーションエラー
  VALIDATION: {
    YEAR_REQUIRED: '年を指定してください',
    MONTH_REQUIRED: '月を指定してください',
    MISSING_FIELDS: '必須項目が入力されていません',
    INVALID_YEAR: '不正な年です。2000〜2100の範囲で指定してください',
    INVALID_MONTH: '不正な月です。1〜12の範囲で指定してください',
    PAST_MONTH: '過去の月のシフトは変更できません',
    INVALID_REFERENCE: '参照先が不正です。関連データが存在しません',
    PLAN_ID_REQUIRED: 'plan_id は必須です',
    MISSING_SHIFT_PARAMS: 'plan_id, year, month, shifts は必須です',
    TENANT_ID_REQUIRED: 'tenant_id はクエリパラメータで必須です',
    INVALID_TIME_RANGE: '休憩時間が勤務時間を超えています',
    STATUS_REQUIRED: 'status は必須です',
    FILENAME_CONTENT_REQUIRED: 'ファイル名とコンテンツは必須です',
    PATH_REQUIRED: 'パスパラメータは必須です',
    DATA_REQUIRED: 'データが指定されていません',
    FUTURE_DATA_NOT_ALLOWED: (year, month, count) =>
      `未来のデータは登録できません。${year}年${month}月以降のデータ（${count}件）が含まれています。`,
  },

  // Not Foundエラー
  NOT_FOUND: {
    PREVIOUS_SHIFT_NOT_FOUND: '前月のシフトデータが存在しません。最初の月は手動でシフトを作成してください。',
    PLAN_NOT_FOUND: 'シフト計画が見つかりません',
    PLAN_NOT_FOUND_JP: 'シフト計画が見つかりません',
    FIRST_PLAN_NOT_FOUND: '第1案が見つかりません',
    FIRST_PLAN_NOT_FOUND_JP: '第1案が見つかりません',
    SHIFT_PLAN_NOT_FOUND: 'シフト計画が見つかりません',
    SHIFT_PREFERENCE_NOT_FOUND: 'シフト希望が見つかりません',
    SHIFT_NOT_FOUND: 'シフトが見つかりません',
    TENANT_NOT_FOUND: 'テナントが見つかりません',
    FILE_NOT_FOUND: (path) => `ファイルが見つかりません: ${path}`,
    CSV_NOT_FOUND: (path) => `CSVファイルが見つかりません: ${path}`,
  },

  // Conflictエラー
  CONFLICT: {
    SHIFT_PLAN_EXISTS: '指定した年月のシフト計画は既に存在します',
    SHIFT_PREFERENCE_EXISTS: '指定したスタッフ・年月のシフト希望は既に存在します',
  },

  // システムエラー
  ERROR: {
    DATABASE_ERROR: 'データベースエラーが発生しました',
    UNEXPECTED_ERROR: '予期しないエラーが発生しました',
    NETWORK_ERROR: 'ネットワークエラーが発生しました',
    OPENAI_API_ERROR: 'OpenAI APIでエラーが発生しました',
    CSV_READ_ERROR: 'CSV読み込みエラー',
    VECTOR_STORE_SETUP_ERROR: 'Vector Storeセットアップエラー',
    FILE_DELETE_ERROR: '一時ファイル削除エラー',
    IMPORT_ERROR: 'データのインポートに失敗しました',
    EXPORT_ERROR: 'データのエクスポートに失敗しました',
  },

  // ログメッセージ
  LOG: {
    SERVER_STARTED: (port) => `Server running on port ${port}`,
    DB_CONNECTED: 'データベース接続成功',
    DB_QUERY_EXECUTED: 'クエリ実行',
    STAFF_NOT_FOUND: (name) => `Staff not found: ${name}`,
    VECTOR_STORE_FILE_ADDED: 'Vector Storeへのファイル追加成功',
  },
}

/**
 * メッセージを取得するヘルパー関数
 * @param {string} path - メッセージのパス（例: 'SUCCESS.SHIFT_CREATED'）
 * @param {any} args - 関数型メッセージの引数
 * @returns {string} メッセージ文字列
 */
export function getMessage(path, ...args) {
  const keys = path.split('.')
  let message = MESSAGES

  for (const key of keys) {
    if (message[key] === undefined) {
      console.warn(`Message not found: ${path}`)
      return path
    }
    message = message[key]
  }

  if (typeof message === 'function') {
    return message(...args)
  }

  return message
}

/**
 * HTTPレスポンス用のメッセージオブジェクトを生成
 * @param {boolean} success - 成功フラグ
 * @param {string} message - メッセージ
 * @param {Object} data - 追加データ
 * @returns {Object} レスポンスオブジェクト
 */
export function createResponse(success, message, data = null) {
  const response = { success, message }
  if (data !== null) {
    Object.assign(response, data)
  }
  return response
}

/**
 * エラーレスポンス用のメッセージオブジェクトを生成
 * @param {string} message - エラーメッセージ
 * @param {Error} error - エラーオブジェクト
 * @returns {Object} エラーレスポンスオブジェクト
 */
export function createErrorResponse(message, error = null) {
  const response = {
    success: false,
    message,
  }

  if (error) {
    response.error = error.message
    if (process.env.NODE_ENV === 'development') {
      response.stack = error.stack
    }
  }

  return response
}
