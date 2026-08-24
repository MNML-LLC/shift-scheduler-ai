import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const shorthands = undefined

export async function up(pgm) {
  const sql = fs.readFileSync(
    path.join(__dirname, '../V2__add_leave_balance.sql'),
    'utf8'
  )
  pgm.sql(sql)
}

export async function down(pgm) {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_leave_balance_updated_at ON hr.leave_balance;
    DROP TABLE IF EXISTS hr.leave_balance;
  `)
}
