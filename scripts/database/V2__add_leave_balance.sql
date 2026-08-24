-- ============================================
-- Migration V2: スタッフ休暇残日数管理テーブル追加 (Issue #51)
-- ============================================
-- 対象: PostgreSQL 15+
-- 依存: hr スキーマ、core.tenants、hr.staff、update_updated_at_column() 関数
-- 実行方法（オペレータ手動）:
--   psql "$DATABASE_URL" -f scripts/database/V2__add_leave_balance.sql
-- ============================================

BEGIN;

CREATE TABLE IF NOT EXISTS hr.leave_balance (
    id             SERIAL PRIMARY KEY,
    tenant_id      INTEGER NOT NULL,
    staff_id       INTEGER NOT NULL,
    fiscal_year    INTEGER NOT NULL,
    granted_days   INTEGER NOT NULL DEFAULT 0,
    consumed_days  INTEGER NOT NULL DEFAULT 0,
    remaining_days INTEGER GENERATED ALWAYS AS (granted_days - consumed_days) STORED,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_leave_balance_tenant_staff_year
        UNIQUE (tenant_id, staff_id, fiscal_year),
    CONSTRAINT fk_leave_balance_tenant
        FOREIGN KEY (tenant_id) REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_leave_balance_staff
        FOREIGN KEY (staff_id) REFERENCES hr.staff(staff_id) ON DELETE CASCADE,
    CONSTRAINT chk_leave_balance_granted_nonneg
        CHECK (granted_days >= 0),
    CONSTRAINT chk_leave_balance_consumed_nonneg
        CHECK (consumed_days >= 0),
    CONSTRAINT chk_leave_balance_no_overdraw
        CHECK (consumed_days <= granted_days)
);

CREATE INDEX IF NOT EXISTS idx_leave_balance_tenant
    ON hr.leave_balance(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leave_balance_staff
    ON hr.leave_balance(staff_id);
CREATE INDEX IF NOT EXISTS idx_leave_balance_fiscal_year
    ON hr.leave_balance(fiscal_year);

COMMENT ON TABLE hr.leave_balance IS 'スタッフ有給/休暇残日数（年度単位・残高集約）';
COMMENT ON COLUMN hr.leave_balance.tenant_id IS 'テナントID';
COMMENT ON COLUMN hr.leave_balance.staff_id IS 'スタッフID';
COMMENT ON COLUMN hr.leave_balance.fiscal_year IS '会計年度（例: 2026）';
COMMENT ON COLUMN hr.leave_balance.granted_days IS '付与日数（累計）';
COMMENT ON COLUMN hr.leave_balance.consumed_days IS '取得日数（累計）';
COMMENT ON COLUMN hr.leave_balance.remaining_days IS '残日数（granted_days - consumed_days、生成列）';
COMMENT ON COLUMN hr.leave_balance.notes IS '備考';

DROP TRIGGER IF EXISTS trg_leave_balance_updated_at ON hr.leave_balance;
CREATE TRIGGER trg_leave_balance_updated_at
    BEFORE UPDATE ON hr.leave_balance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
