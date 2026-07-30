import express from 'express'
import { saveCSV, loadCSV } from '../services/fileService.js'

const router = express.Router()

// CSVファイル保存エンドポイント
router.post('/save-csv', async (req, res) => {
  try {
    const { filename, content } = req.body

    if (!filename || !content) {
      return res.status(400).json({
        success: false,
        error: 'ファイル名とコンテンツは必須です',
        code: 'VALIDATION_ERROR',
      })
    }

    const result = await saveCSV(filename, content)
    res.json(result)
  } catch (error) {
    console.error('CSV保存エラー:', error)
    res.status(500).json({
      success: false,
      error: 'ファイル処理でエラーが発生しました',
      code: 'CSV_ERROR',
    })
  }
})

// CSVファイル読み込みエンドポイント
router.get('/load-csv', async (req, res) => {
  try {
    const { path } = req.query

    if (!path) {
      return res.status(400).json({
        success: false,
        error: 'パスパラメータは必須です',
        code: 'VALIDATION_ERROR',
      })
    }

    const data = loadCSV(path)
    res.json({
      success: true,
      data: data,
    })
  } catch (error) {
    console.error('CSV読み込みエラー:', error)
    res.status(500).json({
      success: false,
      error: 'ファイル処理でエラーが発生しました',
      code: 'CSV_ERROR',
    })
  }
})

export default router
