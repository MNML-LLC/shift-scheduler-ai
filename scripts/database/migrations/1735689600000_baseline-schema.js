import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const shorthands = undefined

export async function up(pgm) {
  const schema = fs.readFileSync(
    path.join(__dirname, '../ddl/schema.sql'),
    'utf8'
  )
  pgm.sql(schema)
}

export async function down(pgm) {
  // ベースラインの down は実運用では使わない。
  // 全スキーマを DROP する場合は手動で実施すること。
  pgm.sql('-- intentional no-op: baseline rollback must be done manually')
}
