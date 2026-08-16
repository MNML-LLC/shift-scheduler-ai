#!/usr/bin/env node
/**
 * ops.shift_plans.status に 'CONFIRMED' を追加するマイグレーション
 *
 * Issue #242 / #249: 管理者シフト確定機能
 *   状態遷移: DRAFT → APPROVED → CONFIRMED
 *
 * 既存の CHECK 制約 `shift_plans_status_check` は
 *   CHECK (status IN ('DRAFT', 'APPROVED'))
 * となっているため、これを削除して
 *   CHECK (status IN ('DRAFT', 'APPROVED', 'CONFIRMED'))
 * に張り直す。
 *
 * 冪等: すでに CONFIRMED が制約に含まれている場合はスキップする。
 * このスクリプトは自動実行されない。M層が手動で実行する。
 *
 * 実行方法:
 *   cd shift-scheduler-ai
 *   node scripts/migrations/add_shift_plan_confirmed_status.mjs
 */
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });

const pool = new Pool({
  host: process.env.DB_HOST || process.env.PGHOST,
  port: process.env.DB_PORT || process.env.PGPORT || 5432,
  database: process.env.DB_NAME || process.env.PGDATABASE,
  user: process.env.DB_USER || process.env.PGUSER,
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
});

const CONSTRAINT_NAME = 'shift_plans_status_check';
const REQUIRED_VALUES = ['DRAFT', 'APPROVED', 'CONFIRMED'];

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔧 ops.shift_plans.status に CONFIRMED を追加');
  console.log('='.repeat(60) + '\n');

  const client = await pool.connect();
  try {
    // 現在の制約定義を取得
    const currentConstraint = await client.query(`
      SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'ops'
        AND t.relname = 'shift_plans'
        AND c.conname = $1
    `, [CONSTRAINT_NAME]);

    const currentDefinition = currentConstraint.rows[0]?.definition || null;

    // 冪等性チェック: すでに CONFIRMED を含んでいればスキップ
    const alreadyIncludesAll = currentDefinition &&
      REQUIRED_VALUES.every(v => currentDefinition.includes(`'${v}'`));

    if (alreadyIncludesAll) {
      console.log('✅ 制約はすでに CONFIRMED を含んでいます。スキップします。');
      console.log(`   現在の制約: ${currentDefinition}\n`);
      return;
    }

    if (currentDefinition) {
      console.log(`📋 現在の制約: ${currentDefinition}`);
    } else {
      console.log(`ℹ️  制約 ${CONSTRAINT_NAME} は存在しません。新規作成します。`);
    }

    await client.query('BEGIN');

    // 既存の CHECK 制約を削除（存在する場合のみ）
    console.log(`\n🔓 既存の制約 ${CONSTRAINT_NAME} を削除...`);
    await client.query(`
      ALTER TABLE ops.shift_plans
      DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}
    `);
    console.log('  ✅ 削除完了');

    // 新しい CHECK 制約を追加
    console.log('\n🔒 新しい制約を追加（DRAFT / APPROVED / CONFIRMED）...');
    await client.query(`
      ALTER TABLE ops.shift_plans
      ADD CONSTRAINT ${CONSTRAINT_NAME}
      CHECK (status IN ('DRAFT', 'APPROVED', 'CONFIRMED'))
    `);
    console.log('  ✅ 追加完了');

    await client.query('COMMIT');

    // 結果確認
    const verify = await client.query(`
      SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'ops'
        AND t.relname = 'shift_plans'
        AND c.conname = $1
    `, [CONSTRAINT_NAME]);

    console.log('\n📋 新しい制約定義:');
    console.log(`   ${verify.rows[0].definition}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ マイグレーション完了');
    console.log('='.repeat(60) + '\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ エラー:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
