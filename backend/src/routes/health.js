import express from 'express'
import { query } from '../config/database.js'

const router = express.Router()

const DEFAULT_DB_CHECK_TIMEOUT_MS = 3000

function getDbCheckTimeoutMs() {
  const parsed = Number(process.env.HEALTH_DB_CHECK_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DB_CHECK_TIMEOUT_MS
}

async function checkDatabaseConnection() {
  let timeoutId
  try {
    await Promise.race([
      query('SELECT 1'),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Database connection check timed out')),
          getDbCheckTimeoutMs()
        )
      })
    ])
    return true
  } catch (error) {
    console.error('❌ Health check DB connection failed:', error.message)
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

router.get('/', async (req, res) => {
  // 環境変数を取得
  const appEnv = process.env.APP_ENV // local/stg/prd
  const dbEnv = process.env.DB_ENV // stg/prd
  const railwayEnv = process.env.RAILWAY_ENVIRONMENT_NAME

  // BE環境判定: APP_ENVを優先、なければRAILWAY_ENVIRONMENT_NAMEで判定
  const getEnvironment = () => {
    // APP_ENVが明示的に設定されている場合はそれを使用
    if (appEnv) {
      return appEnv.toUpperCase()
    }

    // Railwayの環境変数で判定
    if (!railwayEnv) {
      return 'LOCAL'
    }

    if (railwayEnv === 'production') {
      return 'PRD'
    } else {
      return 'STG'
    }
  }

  // DB環境判定: DB_ENVを優先、なければURLで判定
  const getDbEnvironment = () => {
    // DB_ENVが明示的に設定されている場合はそれを使用
    if (dbEnv) {
      return dbEnv.toUpperCase()
    }

    const dbUrl = process.env.DATABASE_URL || ''

    // ローカルDBの場合（DBはSTG/PRDのみだが念のため）
    if (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) {
      return 'LOCAL'
    }

    // Railway DBの場合
    if (dbUrl.includes('railway.app') || dbUrl.includes('railway') || dbUrl.includes('rlwy.net')) {
      // 明示的に本番DB用の識別子がある場合
      if (dbUrl.includes('-production-') || dbUrl.includes('production.')) {
        return 'PRD'
      }

      // RAILWAY_ENVIRONMENT_NAMEで判定
      if (railwayEnv === 'production') {
        return 'PRD'
      } else if (railwayEnv) {
        return 'STG'
      }

      // デフォルトはSTG（PRDよりSTGの方が安全）
      return 'STG'
    }

    // その他の場合
    return 'UNKNOWN'
  }

  const connected = await checkDatabaseConnection()

  res.status(connected ? 200 : 503).json({
    success: connected,
    status: connected ? 'ok' : 'error',
    backend: {
      environment: getEnvironment(),
      hostname: req.hostname,
      port: process.env.PORT || 3001,
      nodeEnv: process.env.NODE_ENV || 'development'
    },
    database: {
      environment: getDbEnvironment(),
      connected,
      host: process.env.PGHOST || 'unknown'
    }
  })
})

export default router
