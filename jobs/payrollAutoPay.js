const { pool } = require('../config/db');
const { DEFAULT_BRANCH_ID } = require('../utils/branchAccess');

/**
 * Runs daily.  For every gym × staff member that has auto_enabled = true
 * and today matches their pay_day, generate a PENDING_APPROVAL payroll
 * entry for the current month — unless one already exists.
 */
async function runPayrollAutoPay() {
  const today = new Date();
  const dayOfMonth = today.getDate();
  const monthLabel = today.toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  try {
    // Find all auto-pay configs where today is the pay day
    const configs = await pool.query(
            `SELECT pac.gym_id, pac.user_id, pac.base_pay, pac.pay_day,
              u.full_name AS staff_name,
              COALESCE(u.branch_id, $2) AS branch_id
       FROM payroll_auto_config pac
       JOIN users u ON u.id = pac.user_id AND u.gym_id = pac.gym_id
       WHERE pac.auto_enabled = TRUE AND pac.pay_day = $1`,
            [dayOfMonth, DEFAULT_BRANCH_ID]
    );

    if (configs.rows.length === 0) return;

    let created = 0;
    let skipped = 0;

    for (const cfg of configs.rows) {
      // Check if a payroll entry already exists for this month
      const existing = await pool.query(
        `SELECT id FROM payroll_entries
         WHERE gym_id = $1 AND user_id = $2 AND pay_period = $3
         LIMIT 1`,
        [cfg.gym_id, cfg.user_id, monthLabel]
      );

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      const netPay = Math.max(0, parseFloat(cfg.base_pay) || 0);

      await pool.query(
        `INSERT INTO payroll_entries
         (gym_id, user_id, pay_period, base_pay, commission, deductions, net_pay, status, notes, branch_id)
         VALUES ($1, $2, $3, $4, 0, 0, $5, 'PENDING_APPROVAL', $6, $7)`,
        [
          cfg.gym_id,
          cfg.user_id,
          monthLabel,
          netPay,
          netPay,
          `Auto-generated payroll for ${cfg.staff_name || 'staff'}`,
          cfg.branch_id || DEFAULT_BRANCH_ID,
        ]
      );
      created++;
    }

    if (created > 0 || skipped > 0) {
      console.log(`[payroll-auto-pay] Created ${created} entries, skipped ${skipped} (already exist).`);
    }
  } catch (err) {
    console.error('[payroll-auto-pay] Error:', err.message);
  }
}

module.exports = { runPayrollAutoPay };
