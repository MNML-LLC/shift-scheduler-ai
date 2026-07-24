import express from 'express'
import cors from 'cors'
import { authenticate, isPublicPath } from './middleware/authenticate.js'
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

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors(corsOptions))
app.use(corsErrorHandler)
app.use(express.json({ limit: '50mb' }))

// Health check endpoint
app.use('/api/health', healthRoutes)

// API認証（/api/health・/api/liff・バッチ専用エンドポイントは除外）
app.use((req, res, next) => {
  if (isPublicPath(req.path)) {
    return next()
  }
  return authenticate(req, res, next)
})

// Routes
app.use('/api/openai', openaiRoutes)
app.use('/api', csvRoutes)
app.use('/api/master', masterRoutes)
app.use('/api/shifts', shiftsRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/tenants', tenantsRoutes)
app.use('/api/vector-store', vectorStoreRoutes)
app.use('/api/holidays', holidaysRoutes)
app.use('/api/liff', liffRoutes)

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
