export const shorthands = undefined

export async function up(pgm) {
  pgm.addConstraint(
    { schema: 'ops', name: 'shift_plans' },
    'unique_plan_per_store_month_type',
    {
      unique: ['tenant_id', 'store_id', 'plan_year', 'plan_month', 'plan_type'],
    }
  )
}

export async function down(pgm) {
  pgm.dropConstraint(
    { schema: 'ops', name: 'shift_plans' },
    'unique_plan_per_store_month_type'
  )
}
