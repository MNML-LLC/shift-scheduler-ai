const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173']

function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS
  if (!raw) return DEFAULT_ALLOWED_ORIGINS
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export const corsOptions = {
  origin(origin, callback) {
    // Origin ヘッダーがないリクエスト（curl 等の非ブラウザクライアント）は許可する
    if (!origin || getAllowedOrigins().includes(origin)) {
      callback(null, true)
      return
    }
    callback(new Error('CORS_NOT_ALLOWED'))
  },
}

export function corsErrorHandler(err, req, res, next) {
  if (err && err.message === 'CORS_NOT_ALLOWED') {
    res.status(403).json({ error: 'CORS ポリシーにより許可されていないオリジンです' })
    return
  }
  next(err)
}
