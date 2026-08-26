import { query as poolQuery } from '../config/database.js'

/**
 * core.stores に対する必要最小限のリポジトリ。
 * ルート層で散らかっていた stores クエリを集約する。
 */

/**
 * tenant のアクティブ店舗を取得
 */
export async function findActiveByTenant(tenantId) {
  const result = await poolQuery(
    `SELECT store_id, store_name
     FROM core.stores
     WHERE tenant_id = $1 AND is_active = TRUE
     ORDER BY store_id`,
    [tenantId]
  )
  return result.rows
}

/**
 * バッチ用: tenants JOIN でアクティブ tenant × store を取得
 */
export async function findActiveStoresForBatch() {
  const result = await poolQuery(
    `SELECT s.tenant_id, s.store_id
     FROM core.stores s
     JOIN core.tenants t ON t.tenant_id = s.tenant_id
     WHERE s.is_active = TRUE AND t.is_active = TRUE
     ORDER BY s.tenant_id, s.store_id`
  )
  return result.rows
}

/**
 * store_id + tenant_id で店舗情報を取得
 */
export async function findByIdAndTenant(storeId, tenantId) {
  const result = await poolQuery(
    `SELECT * FROM core.stores WHERE store_id = $1 AND tenant_id = $2`,
    [storeId, tenantId]
  )
  return result.rows[0] || null
}

/**
 * 一括生成用: tenant のアクティブ店舗 ID のみ
 */
export async function findActiveStoreIdsByTenant(tenantId) {
  const result = await poolQuery(
    `SELECT store_id FROM core.stores
     WHERE tenant_id = $1 AND is_active = TRUE
     ORDER BY store_id`,
    [tenantId]
  )
  return result.rows.map((r) => Number(r.store_id))
}

export default {
  findActiveByTenant,
  findActiveStoresForBatch,
  findByIdAndTenant,
  findActiveStoreIdsByTenant,
}
