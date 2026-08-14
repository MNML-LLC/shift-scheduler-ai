import express from 'express'
import cors from 'cors'
import { authenticate, isPublicPath } from './middleware/authenticate.js'
import {
  createOpenaiLimiter,
  createGeneralLimiter,
  createAuthFailureLimiter
} from './middleware/rateLimit.js'
import { corsOptions, corsErrorHandler } from './config/corsOptions.js'
import openaiRoutes from './routes/openai.js'
import csvRoutes from './routes/csv.js'
import masterRoutes from './routes/master.js'
import shiftsRoutes from './routes/shifts.js'
import analyticsRoutes from './routes/analytics.js'
import tenantsRoutes from './routes/tenants.js'
import vectorStoreRoutes from './routes/vector-store.js'
import holidaysRoutes from './routes/holidays.js'
import liffRoutes from './routes/liff.js'
import healthRoutes from './routes/health.js'
import { appendLog } from './utils/logger.js'
import { ensureShiftPlansUniqueConstraint } from './migrations/ensureShiftPlansUniqueConstraint.js'
import { DatabaseUnavailableError } from './config/database.js'

const app = express()
const PORT = process.env.PORT || 3001

// Railway のプロキシ配下でクライアントの実IPを req.ip に反映させる（レート制限のIP単位カウントに必要）
app.set('trust proxy', 1)

// Middleware
app.use(cors(corsOptions))
app.use(corsErrorHandler)
app.use(express.json({ limit: '50mb' }))

// Health check endpoint
app.use('/api/health', healthRoutes)

// 認証失敗（401）だけを IP 単位でカウントするブルートフォース対策のリミッター。
// authenticate より前段に配置し、閾値超過 IP は authenticate 実行前に 429 で弾く。
// 単一インスタンスを起動時に生成して共有する（MemoryStore を跨いだカウントを保つため）。
const authFailureLimiter = createAuthFailureLimiter()

app.use((req, res, next) => {
  if (isPublicPath(req.path)) {
    return next()
  }
  return authFailureLimiter(req, res, next)
})

// API認証（/api/health・/api/liff・バッチ専用エンドポイントは除外）
app.use((req, res, next) => {
  if (isPublicPath(req.path)) {
    return next()
  }
  return authenticate(req, res, next)
})

// Routes（レート制限は認証後に適用。/api/openai は OpenAI 利用料保護のため厳しめ）
app.use('/api/openai', createOpenaiLimiter(), openaiRoutes)
app.use('/api', createGeneralLimiter())
app.use('/api', csvRoutes)
app.use('/api/master', masterRoutes)
app.use('/api/shifts', shiftsRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/tenants', tenantsRoutes)
app.use('/api/vector-store', vectorStoreRoutes)
app.use('/api/holidays', holidaysRoutes)
app.use('/api/liff', liffRoutes)

// グローバルエラーハンドラ: DB リトライ枯渇時は 503 Service Unavailable を返却
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof DatabaseUnavailableError) {
    console.error('Database unavailable after retries:', err.cause)
    return res.status(503).json({
      error: 'サービスを一時的に利用できません。しばらく待ってから再度お試しください。'
    })
  }
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'サーバー内部エラーが発生しました' })
})

// Server startup
async function startServer() {
  try {
    // 本番DBのスキーマドリフト補完（起動時に冪等実行、失敗しても起動は継続）
    await ensureShiftPlansUniqueConstraint()

    // サーバー起動
    app.listen(PORT, '0.0.0.0', () => {
      const startupMsg = `🚀 Backend server running on port ${PORT}`
      const proxyMsg = `📡 OpenAI API Proxy enabled`

      console.log(startupMsg)
      console.log(proxyMsg)

      appendLog(startupMsg)
      appendLog(proxyMsg)
      appendLog('=====================================')
    })
  } catch (error) {
    console.error('❌ Failed to start server:', error)
    process.exit(1)
  }
}

startServer()
