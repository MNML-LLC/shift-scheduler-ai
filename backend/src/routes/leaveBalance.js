import express from 'express';
import { query, DatabaseUnavailableError } from '../config/database.js';

const router = express.Router();

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseNonNegativeInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/**
 * GET /api/master/leave-balance?tenant_id=&staff_id=&fiscal_year=
 * スタッフ休暇残日数取得
 * - fiscal_year は任意
 * - 該当行なしでも 200 で空配列を返す
 */
router.get('/', async (req, res, next) => {
  try {
    const tenantId = parsePositiveInt(req.query.tenant_id);
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenant_id は必須です（正の整数）'
      });
    }

    const staffId = req.query.staff_id !== undefined ? parsePositiveInt(req.query.staff_id) : null;
    if (req.query.staff_id !== undefined && !staffId) {
      return res.status(400).json({
        success: false,
        error: 'staff_id は正の整数で指定してください'
      });
    }

    const fiscalYear = req.query.fiscal_year !== undefined
      ? parsePositiveInt(req.query.fiscal_year)
      : null;
    if (req.query.fiscal_year !== undefined && !fiscalYear) {
      return res.status(400).json({
        success: false,
        error: 'fiscal_year は正の整数で指定してください'
      });
    }

    const conditions = ['tenant_id = $1'];
    const params = [tenantId];

    if (staffId) {
      conditions.push(`staff_id = $${params.length + 1}`);
      params.push(staffId);
    }
    if (fiscalYear) {
      conditions.push(`fiscal_year = $${params.length + 1}`);
      params.push(fiscalYear);
    }

    const result = await query(
      `
      SELECT
        id,
        tenant_id,
        staff_id,
        fiscal_year,
        granted_days,
        consumed_days,
        remaining_days,
        notes,
        created_at,
        updated_at
      FROM hr.leave_balance
      WHERE ${conditions.join(' AND ')}
      ORDER BY staff_id, fiscal_year
      `,
      params
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return next(error);
    console.error('Error fetching leave balance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/master/leave-balance/grant
 * 休暇日数を付与（granted_days に加算）
 * body: { tenant_id, staff_id, fiscal_year, days, notes? }
 */
router.post('/grant', async (req, res, next) => {
  try {
    const tenantId = parsePositiveInt(req.body.tenant_id);
    const staffId = parsePositiveInt(req.body.staff_id);
    const fiscalYear = parsePositiveInt(req.body.fiscal_year);
    const days = parseNonNegativeInt(req.body.days);
    const notes = req.body.notes ?? null;

    if (!tenantId || !staffId || !fiscalYear || days === null) {
      return res.status(400).json({
        success: false,
        error: 'tenant_id, staff_id, fiscal_year, days は必須です（正の整数、days は 0 以上の整数）'
      });
    }

    if (days === 0) {
      return res.status(400).json({
        success: false,
        error: 'days は 1 以上を指定してください'
      });
    }

    const result = await query(
      `
      INSERT INTO hr.leave_balance
        (tenant_id, staff_id, fiscal_year, granted_days, consumed_days, notes)
      VALUES ($1, $2, $3, $4, 0, $5)
      ON CONFLICT (tenant_id, staff_id, fiscal_year) DO UPDATE SET
        granted_days = hr.leave_balance.granted_days + EXCLUDED.granted_days,
        notes = COALESCE(EXCLUDED.notes, hr.leave_balance.notes),
        updated_at = NOW()
      RETURNING id, tenant_id, staff_id, fiscal_year,
                granted_days, consumed_days, remaining_days, notes,
                created_at, updated_at
      `,
      [tenantId, staffId, fiscalYear, days, notes]
    );

    res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return next(error);
    // FK 制約違反（存在しない tenant/staff）
    if (error.code === '23503') {
      return res.status(400).json({
        success: false,
        error: '指定された tenant_id または staff_id が存在しません'
      });
    }
    console.error('Error granting leave balance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/master/leave-balance/consume
 * 休暇日数を取得（consumed_days に加算）
 * body: { tenant_id, staff_id, fiscal_year, days, notes? }
 * - 残日数超過は HTTP 400（DB 未変更）
 */
router.post('/consume', async (req, res, next) => {
  try {
    const tenantId = parsePositiveInt(req.body.tenant_id);
    const staffId = parsePositiveInt(req.body.staff_id);
    const fiscalYear = parsePositiveInt(req.body.fiscal_year);
    const days = parseNonNegativeInt(req.body.days);
    const notes = req.body.notes ?? null;

    if (!tenantId || !staffId || !fiscalYear || days === null) {
      return res.status(400).json({
        success: false,
        error: 'tenant_id, staff_id, fiscal_year, days は必須です（正の整数、days は 0 以上の整数）'
      });
    }

    if (days === 0) {
      return res.status(400).json({
        success: false,
        error: 'days は 1 以上を指定してください'
      });
    }

    // 現在の残高を取得。存在しない、または残高不足なら 400 で返す（DB 変更なし）。
    const current = await query(
      `
      SELECT id, granted_days, consumed_days, remaining_days
      FROM hr.leave_balance
      WHERE tenant_id = $1 AND staff_id = $2 AND fiscal_year = $3
      `,
      [tenantId, staffId, fiscalYear]
    );

    if (current.rowCount === 0) {
      return res.status(400).json({
        success: false,
        error: '対象スタッフ・年度の残高レコードが存在しません（先に付与を行ってください）'
      });
    }

    const row = current.rows[0];
    if (days > row.remaining_days) {
      return res.status(400).json({
        success: false,
        error: `残日数を超える取得はできません（残: ${row.remaining_days} 日、要求: ${days} 日）`
      });
    }

    const updated = await query(
      `
      UPDATE hr.leave_balance
      SET consumed_days = consumed_days + $1,
          notes = COALESCE($2, notes),
          updated_at = NOW()
      WHERE tenant_id = $3 AND staff_id = $4 AND fiscal_year = $5
      RETURNING id, tenant_id, staff_id, fiscal_year,
                granted_days, consumed_days, remaining_days, notes,
                created_at, updated_at
      `,
      [days, notes, tenantId, staffId, fiscalYear]
    );

    res.status(200).json({
      success: true,
      data: updated.rows[0]
    });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return next(error);
    // CHECK 制約違反（残高マイナス防止の最終防衛線）
    if (error.code === '23514') {
      return res.status(400).json({
        success: false,
        error: '残日数がマイナスになる更新は許可されていません'
      });
    }
    console.error('Error consuming leave balance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
