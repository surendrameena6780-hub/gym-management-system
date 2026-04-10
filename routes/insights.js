const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requirePermission } = require('../middleware/rbac');
const { getGymTimezone } = require('../utils/gymTime');
const {
    BranchAccessError,
    branchSchemaMiddleware,
    DEFAULT_BRANCH_ID,
    getGymBranchDirectory,
    resolveBranchReadScope,
} = require('../utils/branchAccess');
const { cacheGet, cacheSet, buildCacheKey } = require('../utils/cache');

const INSIGHTS_OVERVIEW_TTL = 30; // seconds
const FRANCHISE_INSIGHTS_TTL = 30; // seconds
const FRANCHISE_PLAN_IDS = new Set(['growth', 'pro']);

const RANGE_TO_MONTHS = {
    '1M': 1,
    '3M': 3,
    '6M': 6,
    '1Y': 12,
};

const normalizeRange = (value) => {
    const key = String(value || '6M').trim().toUpperCase();
    return RANGE_TO_MONTHS[key] ? key : '6M';
};

const normalizePlanId = (value) => String(value || '').trim().toLowerCase();
const hasFranchiseInsightsAccess = (value) => FRANCHISE_PLAN_IDS.has(normalizePlanId(value));

const diffInDays = (endDate, startDate) => {
    const end = new Date(endDate);
    const start = new Date(startDate);
    if (Number.isNaN(end.getTime()) || Number.isNaN(start.getTime())) return null;
    end.setHours(0, 0, 0, 0);
    start.setHours(0, 0, 0, 0);
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
};

const DEFAULT_BRANCH_SQL = `'${DEFAULT_BRANCH_ID}'`;

const getBranchFilterSql = (params, branchId, columnExpression) => {
    if (!branchId) {
        return '';
    }

    params.push(branchId);
    return ` AND ${columnExpression} = $${params.length}`;
};

const sendInsightsRouteError = (res, err, logLabel, fallback) => {
    if (err instanceof BranchAccessError) {
        return res.status(err.statusCode).json({ error: err.message });
    }

    console.error(logLabel, err.message);
    return res.status(500).json({ error: fallback });
};

router.use(auth, saasMiddleware, branchSchemaMiddleware);

router.get('/overview', requirePermission('insights:read'), async (req, res) => {
    const gymId = req.user.gym_id;
    const range = normalizeRange(req.query.range);
    const months = RANGE_TO_MONTHS[range];
    const peakHourDays = Math.min(months * 31, 365);

    try {
        const { branchId } = await resolveBranchReadScope(pool, req);

        const cacheKey = buildCacheKey('insights', 'overview', gymId, range, branchId || 'all');
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const gymTimezone = await getGymTimezone(pool, gymId);
        const memberParams = [gymId];
        const membershipBranchClause = getBranchFilterSql(memberParams, branchId, `COALESCE(ms.branch_id, ${DEFAULT_BRANCH_SQL})`);
        const memberBranchClause = getBranchFilterSql(memberParams, branchId, `COALESCE(m.branch_id, ${DEFAULT_BRANCH_SQL})`);
        const revenueParams = [gymId, months, gymTimezone];
        const revenueBranchClause = getBranchFilterSql(revenueParams, branchId, `COALESCE(pay.branch_id, ${DEFAULT_BRANCH_SQL})`);
        const planRevenueParams = [gymId, months, gymTimezone];
        const planRevenueBranchClause = getBranchFilterSql(planRevenueParams, branchId, `COALESCE(pay.branch_id, ${DEFAULT_BRANCH_SQL})`);
        const topMembersParams = [gymId];
        const topMembershipBranchClause = getBranchFilterSql(topMembersParams, branchId, `COALESCE(ms.branch_id, ${DEFAULT_BRANCH_SQL})`);
        const topPaymentBranchClause = getBranchFilterSql(topMembersParams, branchId, `COALESCE(pay.branch_id, ${DEFAULT_BRANCH_SQL})`);
        const topMemberBranchClause = getBranchFilterSql(topMembersParams, branchId, `COALESCE(m.branch_id, ${DEFAULT_BRANCH_SQL})`);
        const peakHourParams = [gymId, peakHourDays, gymTimezone];
        const peakHourBranchClause = getBranchFilterSql(peakHourParams, branchId, `COALESCE(a.branch_id, ${DEFAULT_BRANCH_SQL})`);
        const last30RevenueParams = [gymId];
        const last30RevenueBranchClause = getBranchFilterSql(last30RevenueParams, branchId, `COALESCE(pay.branch_id, ${DEFAULT_BRANCH_SQL})`);

        const [memberRowsRes, revenueGraphRes, planRevenueRes, topMembersRes, peakHoursRes, last30RevenueRes] = await Promise.all([
            pool.query(
                `WITH latest_memberships AS (
                    SELECT DISTINCT ON (ms.member_id)
                        ms.member_id,
                        ms.status,
                        ms.end_date,
                        p.name AS plan_name,
                        COALESCE(p.price, 0) AS plan_price
                     FROM memberships ms
                     LEFT JOIN plans p ON p.id = ms.plan_id
                     WHERE ms.gym_id = $1
                       AND ms.deleted_at IS NULL
                                             ${membershipBranchClause}
                     ORDER BY ms.member_id, ms.end_date DESC NULLS LAST, ms.id DESC
                 )
                 SELECT
                    m.id,
                    m.full_name,
                    m.phone,
                    m.last_visit,
                    m.joining_date,
                    COALESCE(lm.status, 'UNPAID') AS membership_status,
                    lm.plan_name,
                    lm.end_date,
                                        COALESCE(lm.plan_price, 0) AS plan_price
                 FROM members m
                 LEFT JOIN latest_memberships lm ON lm.member_id = m.id
                 WHERE m.gym_id = $1
                   AND m.deleted_at IS NULL
                                     ${memberBranchClause}
                 ORDER BY m.full_name ASC`,
                                memberParams
            ),
            pool.query(
                `WITH month_series AS (
                    SELECT generate_series(
                                                date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month'),
                                                date_trunc('month', timezone($3, NOW())),
                        INTERVAL '1 month'
                    ) AS month_start
                 ),
                 revenue_by_month AS (
                    SELECT
                                                date_trunc('month', timezone($3, pay.payment_date)) AS month_start,
                        COALESCE(SUM(amount_paid), 0) AS revenue
                                        FROM payments pay
                                        WHERE pay.gym_id = $1
                                            AND pay.deleted_at IS NULL
                                            ${revenueBranchClause}
                                            AND pay.payment_date >= (
                                                date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month')
                                            ) AT TIME ZONE $3
                                        GROUP BY date_trunc('month', timezone($3, pay.payment_date))
                 )
                 SELECT
                    TO_CHAR(ms.month_start, 'Mon') AS name,
                    COALESCE(ROUND(rbm.revenue), 0)::INTEGER AS revenue
                 FROM month_series ms
                 LEFT JOIN revenue_by_month rbm ON rbm.month_start = ms.month_start
                 ORDER BY ms.month_start ASC`,
                                revenueParams
            ),
            pool.query(
                `SELECT
                    COALESCE(p.name, 'Unassigned Plan') AS name,
                    COALESCE(ROUND(SUM(pay.amount_paid)), 0)::INTEGER AS revenue,
                    COUNT(DISTINCT pay.user_id)::INTEGER AS buyers
                 FROM payments pay
                 LEFT JOIN plans p ON p.id = pay.plan_id
                 WHERE pay.gym_id = $1
                   AND pay.deleted_at IS NULL
                   ${planRevenueBranchClause}
                   AND pay.payment_date >= (
                        date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month')
                   ) AT TIME ZONE $3
                 GROUP BY COALESCE(p.name, 'Unassigned Plan')
                 ORDER BY revenue DESC, name ASC
                 LIMIT 8`,
                planRevenueParams
            ),
            pool.query(
                `WITH latest_memberships AS (
                        SELECT DISTINCT ON (ms.member_id)
                            ms.member_id,
                            ms.status
                        FROM memberships ms
                        WHERE ms.gym_id = $1
                            AND ms.deleted_at IS NULL
                            ${topMembershipBranchClause}
                        ORDER BY ms.member_id, ms.end_date DESC NULLS LAST, ms.id DESC
                 ),
                 payment_totals AS (
                        SELECT
                            pay.user_id AS member_id,
                            COALESCE(SUM(pay.amount_paid), 0) AS total_paid
                        FROM payments pay
                        WHERE pay.gym_id = $1
                            AND pay.deleted_at IS NULL
                            ${topPaymentBranchClause}
                        GROUP BY pay.user_id
                 )
                 SELECT
                        m.id,
                        m.full_name,
                        m.profile_pic,
                        COALESCE(pt.total_paid, 0) AS total_paid
                 FROM members m
                 INNER JOIN latest_memberships lm ON lm.member_id = m.id
                 INNER JOIN payment_totals pt ON pt.member_id = m.id
                 WHERE m.gym_id = $1
                     AND m.deleted_at IS NULL
                     ${topMemberBranchClause}
                     AND COALESCE(lm.status, 'UNPAID') = 'ACTIVE'
                     AND COALESCE(pt.total_paid, 0) > 0
                 ORDER BY pt.total_paid DESC, m.full_name ASC
                 LIMIT 5`,
                topMembersParams
            ),
            pool.query(
                `SELECT
                    EXTRACT(HOUR FROM timezone($3, a.check_in_time))::INTEGER AS hour,
                    COUNT(*)::INTEGER AS count
                 FROM attendance a
                 WHERE a.gym_id = $1
                   AND a.deleted_at IS NULL
                   ${peakHourBranchClause}
                   AND a.check_in_time >= NOW() - ($2::int || ' day')::interval
                 GROUP BY EXTRACT(HOUR FROM timezone($3, a.check_in_time))
                 ORDER BY hour ASC`,
                peakHourParams
            ),
            pool.query(
                `SELECT COALESCE(ROUND(SUM(amount_paid)), 0)::INTEGER AS revenue
                 FROM payments pay
                 WHERE pay.gym_id = $1
                   AND pay.deleted_at IS NULL
                   ${last30RevenueBranchClause}
                   AND pay.payment_date >= NOW() - INTERVAL '30 days'`,
                last30RevenueParams
            ),
        ]);

        const today = new Date();
        const memberRows = memberRowsRes.rows.map((row) => {
            const daysLeft = row.end_date ? diffInDays(row.end_date, today) : null;
            return {
                ...row,
                plan_price: Number(row.plan_price || 0),
                days_left: daysLeft,
            };
        });

        const activeMembers = memberRows.filter((member) => member.membership_status === 'ACTIVE');
        const expiredMembers = memberRows.filter((member) => member.membership_status === 'EXPIRED');
        const payingMembersCount = activeMembers.length + expiredMembers.length;

        const retention = payingMembersCount > 0
            ? Number(((activeMembers.length / payingMembersCount) * 100).toFixed(1))
            : 0;
        const churn = payingMembersCount > 0 ? Number((100 - retention).toFixed(1)) : 0;

        const expiringMembers = memberRows
            .filter((member) => member.days_left !== null && member.days_left >= -7 && member.days_left <= 7)
            .sort((left, right) => {
                if (left.days_left === right.days_left) return String(left.full_name).localeCompare(String(right.full_name));
                return Number(left.days_left) - Number(right.days_left);
            });

        const inactiveMembers = activeMembers
            .filter((member) => {
                // Exclude members who joined in the last 7 days — they're new, not inactive
                if (member.joining_date) {
                    const daysSinceJoin = diffInDays(today, member.joining_date);
                    if (daysSinceJoin !== null && daysSinceJoin < 7) return false;
                }
                if (!member.last_visit) return true;
                const inactiveDays = diffInDays(today, member.last_visit);
                return inactiveDays !== null && inactiveDays >= 7;
            })
            .map((member) => ({
                ...member,
                days_inactive: member.last_visit ? diffInDays(today, member.last_visit) : null,
            }))
            .sort((left, right) => {
                const leftDays = Number(left.days_inactive ?? 9999);
                const rightDays = Number(right.days_inactive ?? 9999);
                return rightDays - leftDays;
            });

        const activeUsersByPlan = activeMembers.reduce((acc, member) => {
            const key = String(member.plan_name || 'Unassigned Plan');
            acc.set(key, (acc.get(key) || 0) + 1);
            return acc;
        }, new Map());

        const topPlans = planRevenueRes.rows.map((plan) => ({
            ...plan,
            users: activeUsersByPlan.get(String(plan.name || 'Unassigned Plan')) || 0,
        }));

        const topMembers = topMembersRes.rows.map((member) => ({
            id: member.id,
            full_name: member.full_name,
            profile_pic: member.profile_pic,
            total_paid: Number(member.total_paid || 0),
        }));

        const revenueAtRisk = expiringMembers.reduce((sum, member) => sum + Math.max(0, Number(member.plan_price || 0)), 0);
        const lostRevenue = expiredMembers.reduce((sum, member) => sum + Math.max(0, Number(member.plan_price || 0)), 0);
        const last30Revenue = Number(last30RevenueRes.rows[0]?.revenue || 0);
        const arpu = activeMembers.length > 0 ? Math.round(last30Revenue / activeMembers.length) : 0;

        const expiringList = expiringMembers.slice(0, 10).map((member) => ({
            id: member.id,
            full_name: member.full_name,
            phone: member.phone,
            days_left: member.days_left,
        }));

        const inactiveList = inactiveMembers.slice(0, 5).map((member) => ({
            id: member.id,
            full_name: member.full_name,
            phone: member.phone,
            last_visit: member.last_visit,
            days_inactive: member.days_inactive,
        }));

        const insightsResponse = {
            range,
            revenue: {
                graphData: revenueGraphRes.rows,
                arpu,
                lostRevenue,
                topPlans,
            },
            health: {
                active: activeMembers.length,
                expired: expiredMembers.length,
                retention,
                churn,
            },
            risk: {
                expiringCount: expiringMembers.length,
                revenueAtRisk,
                expiringList,
                inactiveCount: inactiveMembers.length,
                inactiveList,
            },
            attendance: {
                heatmap: peakHoursRes.rows.map((item) => ({
                    time: item.hour === 0 ? '12AM' : item.hour < 12 ? `${item.hour}AM` : item.hour === 12 ? '12PM' : `${item.hour - 12}PM`,
                    count: Number(item.count || 0),
                })),
                topMembers,
            },
        };

        await cacheSet(cacheKey, insightsResponse, INSIGHTS_OVERVIEW_TTL);
        return res.json(insightsResponse);
    } catch (err) {
        return sendInsightsRouteError(res, err, 'INSIGHTS OVERVIEW ERROR:', 'Failed to load insights overview.');
    }
});

router.get('/franchise', requirePermission('insights:read'), async (req, res) => {
    const gymId = req.user.gym_id;
    const range = normalizeRange(req.query.range);
    const months = RANGE_TO_MONTHS[range];

    try {
        if (String(req.user.role || '').trim().toUpperCase() !== 'OWNER') {
            return res.status(403).json({ error: 'Franchise insights are only available for owner accounts.' });
        }

        const [gymRes, branchDirectory, gymTimezone] = await Promise.all([
            pool.query(
                `SELECT current_plan
                 FROM gyms
                 WHERE id = $1
                 LIMIT 1`,
                [gymId]
            ),
            getGymBranchDirectory(pool, gymId),
            getGymTimezone(pool, gymId),
        ]);

        const currentPlan = normalizePlanId(gymRes.rows[0]?.current_plan);
        if (!hasFranchiseInsightsAccess(currentPlan)) {
            return res.status(403).json({ error: 'Franchise insights are available only on Growth and Pro plans.' });
        }

        const cacheKey = buildCacheKey('insights', 'franchise', gymId, range, currentPlan);
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const [memberSummaryRes, financialSummaryRes, attendanceSummaryRes, revenueTrendRes, topPlansRes, last30RevenueRes] = await Promise.all([
            pool.query(
                `WITH latest_memberships AS (
                    SELECT DISTINCT ON (ms.member_id)
                        ms.member_id,
                        COALESCE(ms.status, 'UNPAID') AS status
                    FROM memberships ms
                    WHERE ms.gym_id = $1
                      AND ms.deleted_at IS NULL
                    ORDER BY ms.member_id, ms.end_date DESC NULLS LAST, ms.id DESC
                 )
                 SELECT
                    COALESCE(m.branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
                    COUNT(*)::INTEGER AS total_members,
                    COUNT(*) FILTER (WHERE COALESCE(lm.status, 'UNPAID') = 'ACTIVE')::INTEGER AS active_members,
                    COUNT(*) FILTER (WHERE COALESCE(lm.status, 'UNPAID') = 'EXPIRED')::INTEGER AS expired_members,
                    COUNT(*) FILTER (WHERE COALESCE(lm.status, 'UNPAID') = 'UNPAID')::INTEGER AS unpaid_members,
                    COUNT(*) FILTER (
                        WHERE COALESCE(lm.status, 'UNPAID') = 'ACTIVE'
                          AND (m.last_visit IS NULL OR m.last_visit < NOW() - INTERVAL '7 days')
                          AND (m.joining_date IS NULL OR m.joining_date <= CURRENT_DATE - INTERVAL '7 days')
                    )::INTEGER AS inactive_members
                 FROM members m
                 LEFT JOIN latest_memberships lm ON lm.member_id = m.id
                 WHERE m.gym_id = $1
                   AND m.deleted_at IS NULL
                 GROUP BY COALESCE(m.branch_id, ${DEFAULT_BRANCH_SQL})
                 ORDER BY branch_id ASC`,
                [gymId]
            ),
            pool.query(
                `WITH membership_revenue AS (
                    SELECT
                        COALESCE(branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
                        COALESCE(SUM(amount_paid), 0)::NUMERIC AS membership_revenue
                    FROM payments
                    WHERE gym_id = $1
                      AND deleted_at IS NULL
                      AND payment_date >= (
                          date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month')
                      ) AT TIME ZONE $3
                      AND payment_date < (
                          date_trunc('month', timezone($3, NOW())) + INTERVAL '1 month'
                      ) AT TIME ZONE $3
                    GROUP BY COALESCE(branch_id, ${DEFAULT_BRANCH_SQL})
                 ),
                 pos_revenue AS (
                    SELECT
                        COALESCE(branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
                        COALESCE(SUM(total_amount), 0)::NUMERIC AS pos_revenue
                    FROM pos_sales
                    WHERE gym_id = $1
                      AND created_at >= (
                          date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month')
                      ) AT TIME ZONE $3
                      AND created_at < (
                          date_trunc('month', timezone($3, NOW())) + INTERVAL '1 month'
                      ) AT TIME ZONE $3
                    GROUP BY COALESCE(branch_id, ${DEFAULT_BRANCH_SQL})
                 ),
                 expense_totals AS (
                    SELECT
                        COALESCE(branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
                        COALESCE(SUM(amount), 0)::NUMERIC AS total_expenses
                    FROM expenses
                    WHERE gym_id = $1
                      AND deleted_at IS NULL
                      AND bill_date >= (
                          date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month')
                      )::date
                      AND bill_date < (
                          date_trunc('month', timezone($3, NOW())) + INTERVAL '1 month'
                      )::date
                    GROUP BY COALESCE(branch_id, ${DEFAULT_BRANCH_SQL})
                 ),
                 payroll_totals AS (
                    SELECT
                        COALESCE(branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
                        COALESCE(SUM(net_pay) FILTER (WHERE UPPER(COALESCE(status, '')) <> 'REJECTED'), 0)::NUMERIC AS total_payroll
                    FROM payroll_entries
                    WHERE gym_id = $1
                      AND COALESCE(paid_at, created_at) >= (
                          date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month')
                      ) AT TIME ZONE $3
                      AND COALESCE(paid_at, created_at) < (
                          date_trunc('month', timezone($3, NOW())) + INTERVAL '1 month'
                      ) AT TIME ZONE $3
                    GROUP BY COALESCE(branch_id, ${DEFAULT_BRANCH_SQL})
                 ),
                 branch_ids AS (
                    SELECT branch_id FROM membership_revenue
                    UNION
                    SELECT branch_id FROM pos_revenue
                    UNION
                    SELECT branch_id FROM expense_totals
                    UNION
                    SELECT branch_id FROM payroll_totals
                 )
                 SELECT
                    branch_ids.branch_id,
                    COALESCE(membership_revenue.membership_revenue, 0)::NUMERIC AS membership_revenue,
                    COALESCE(pos_revenue.pos_revenue, 0)::NUMERIC AS pos_revenue,
                    COALESCE(expense_totals.total_expenses, 0)::NUMERIC AS total_expenses,
                    COALESCE(payroll_totals.total_payroll, 0)::NUMERIC AS total_payroll
                 FROM branch_ids
                 LEFT JOIN membership_revenue ON membership_revenue.branch_id = branch_ids.branch_id
                 LEFT JOIN pos_revenue ON pos_revenue.branch_id = branch_ids.branch_id
                 LEFT JOIN expense_totals ON expense_totals.branch_id = branch_ids.branch_id
                 LEFT JOIN payroll_totals ON payroll_totals.branch_id = branch_ids.branch_id
                 ORDER BY branch_ids.branch_id ASC`,
                [gymId, months, gymTimezone]
            ),
            pool.query(
                `SELECT
                    COALESCE(branch_id, ${DEFAULT_BRANCH_SQL}) AS branch_id,
                    COUNT(*)::INTEGER AS total_checkins
                 FROM attendance
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   AND check_in_time >= (
                        date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month')
                   ) AT TIME ZONE $3
                   AND check_in_time < (
                        date_trunc('month', timezone($3, NOW())) + INTERVAL '1 month'
                   ) AT TIME ZONE $3
                 GROUP BY COALESCE(branch_id, ${DEFAULT_BRANCH_SQL})
                 ORDER BY branch_id ASC`,
                [gymId, months, gymTimezone]
            ),
            pool.query(
                `WITH month_series AS (
                    SELECT generate_series(
                        date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month'),
                        date_trunc('month', timezone($3, NOW())),
                        INTERVAL '1 month'
                    ) AS month_start
                 ),
                 income_by_month AS (
                    SELECT
                        month_start,
                        COALESCE(SUM(membership_revenue), 0)::NUMERIC AS membership_revenue,
                        COALESCE(SUM(pos_revenue), 0)::NUMERIC AS pos_revenue
                    FROM (
                        SELECT
                            date_trunc('month', timezone($3, payment_date)) AS month_start,
                            COALESCE(SUM(amount_paid), 0)::NUMERIC AS membership_revenue,
                            0::NUMERIC AS pos_revenue
                        FROM payments
                        WHERE gym_id = $1
                          AND deleted_at IS NULL
                          AND payment_date >= (
                              date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month')
                          ) AT TIME ZONE $3
                        GROUP BY date_trunc('month', timezone($3, payment_date))

                        UNION ALL

                        SELECT
                            date_trunc('month', timezone($3, created_at)) AS month_start,
                            0::NUMERIC AS membership_revenue,
                            COALESCE(SUM(total_amount), 0)::NUMERIC AS pos_revenue
                        FROM pos_sales
                        WHERE gym_id = $1
                          AND created_at >= (
                              date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month')
                          ) AT TIME ZONE $3
                        GROUP BY date_trunc('month', timezone($3, created_at))
                    ) monthly_income
                    GROUP BY month_start
                 )
                 SELECT
                    TO_CHAR(ms.month_start, 'Mon') AS name,
                    COALESCE(ROUND(ibm.membership_revenue), 0)::INTEGER AS membership_revenue,
                    COALESCE(ROUND(ibm.pos_revenue), 0)::INTEGER AS pos_revenue,
                    COALESCE(ROUND(ibm.membership_revenue + ibm.pos_revenue), 0)::INTEGER AS total_revenue
                 FROM month_series ms
                 LEFT JOIN income_by_month ibm ON ibm.month_start = ms.month_start
                 ORDER BY ms.month_start ASC`,
                [gymId, months, gymTimezone]
            ),
            pool.query(
                `SELECT
                    COALESCE(p.name, 'Unassigned Plan') AS name,
                    COALESCE(ROUND(SUM(pay.amount_paid)), 0)::INTEGER AS revenue,
                    COUNT(DISTINCT pay.user_id)::INTEGER AS buyers
                 FROM payments pay
                 LEFT JOIN plans p ON p.id = pay.plan_id
                 WHERE pay.gym_id = $1
                   AND pay.deleted_at IS NULL
                   AND pay.payment_date >= (
                        date_trunc('month', timezone($3, NOW())) - (($2::int - 1) * INTERVAL '1 month')
                   ) AT TIME ZONE $3
                 GROUP BY COALESCE(p.name, 'Unassigned Plan')
                 ORDER BY revenue DESC, name ASC
                 LIMIT 8`,
                [gymId, months, gymTimezone]
            ),
            pool.query(
                `WITH membership_revenue AS (
                    SELECT COALESCE(SUM(amount_paid), 0)::NUMERIC AS total
                    FROM payments
                    WHERE gym_id = $1
                      AND deleted_at IS NULL
                      AND payment_date >= NOW() - INTERVAL '30 days'
                 ),
                 pos_revenue AS (
                    SELECT COALESCE(SUM(total_amount), 0)::NUMERIC AS total
                    FROM pos_sales
                    WHERE gym_id = $1
                      AND created_at >= NOW() - INTERVAL '30 days'
                 )
                 SELECT (
                    COALESCE((SELECT total FROM membership_revenue), 0)
                    + COALESCE((SELECT total FROM pos_revenue), 0)
                 )::NUMERIC AS total_revenue`,
                [gymId]
            ),
        ]);

        const emptyBranchMetrics = (branchId, branchName) => ({
            branchId,
            branchName,
            totalMembers: 0,
            activeMembers: 0,
            expiredMembers: 0,
            unpaidMembers: 0,
            inactiveMembers: 0,
            membershipRevenue: 0,
            posRevenue: 0,
            totalExpenses: 0,
            totalPayroll: 0,
            totalCheckins: 0,
        });

        const branchMetricsMap = new Map(
            branchDirectory.map((branch) => [branch.id, emptyBranchMetrics(branch.id, branch.name)])
        );

        const ensureBranchMetrics = (branchId) => {
            const normalizedBranchId = String(branchId || DEFAULT_BRANCH_ID).trim().toLowerCase() || DEFAULT_BRANCH_ID;
            if (!branchMetricsMap.has(normalizedBranchId)) {
                branchMetricsMap.set(normalizedBranchId, emptyBranchMetrics(normalizedBranchId, normalizedBranchId));
            }
            return branchMetricsMap.get(normalizedBranchId);
        };

        memberSummaryRes.rows.forEach((row) => {
            const metrics = ensureBranchMetrics(row.branch_id);
            metrics.totalMembers = Number(row.total_members || 0);
            metrics.activeMembers = Number(row.active_members || 0);
            metrics.expiredMembers = Number(row.expired_members || 0);
            metrics.unpaidMembers = Number(row.unpaid_members || 0);
            metrics.inactiveMembers = Number(row.inactive_members || 0);
        });

        financialSummaryRes.rows.forEach((row) => {
            const metrics = ensureBranchMetrics(row.branch_id);
            metrics.membershipRevenue = Number(row.membership_revenue || 0);
            metrics.posRevenue = Number(row.pos_revenue || 0);
            metrics.totalExpenses = Number(row.total_expenses || 0);
            metrics.totalPayroll = Number(row.total_payroll || 0);
        });

        attendanceSummaryRes.rows.forEach((row) => {
            const metrics = ensureBranchMetrics(row.branch_id);
            metrics.totalCheckins = Number(row.total_checkins || 0);
        });

        const branches = Array.from(branchMetricsMap.values())
            .map((metrics) => {
                const totalRevenue = Number(metrics.membershipRevenue || 0) + Number(metrics.posRevenue || 0);
                const profit = totalRevenue - Number(metrics.totalExpenses || 0) - Number(metrics.totalPayroll || 0);
                return {
                    ...metrics,
                    totalRevenue,
                    profit,
                };
            })
            .sort((left, right) => {
                if (right.totalRevenue !== left.totalRevenue) return right.totalRevenue - left.totalRevenue;
                if (right.activeMembers !== left.activeMembers) return right.activeMembers - left.activeMembers;
                return String(left.branchName).localeCompare(String(right.branchName));
            });

        const totals = branches.reduce((acc, branch) => ({
            branchCount: acc.branchCount + 1,
            totalMembers: acc.totalMembers + Number(branch.totalMembers || 0),
            activeMembers: acc.activeMembers + Number(branch.activeMembers || 0),
            expiredMembers: acc.expiredMembers + Number(branch.expiredMembers || 0),
            unpaidMembers: acc.unpaidMembers + Number(branch.unpaidMembers || 0),
            inactiveMembers: acc.inactiveMembers + Number(branch.inactiveMembers || 0),
            membershipRevenue: acc.membershipRevenue + Number(branch.membershipRevenue || 0),
            posRevenue: acc.posRevenue + Number(branch.posRevenue || 0),
            totalExpenses: acc.totalExpenses + Number(branch.totalExpenses || 0),
            totalPayroll: acc.totalPayroll + Number(branch.totalPayroll || 0),
            totalCheckins: acc.totalCheckins + Number(branch.totalCheckins || 0),
        }), {
            branchCount: 0,
            totalMembers: 0,
            activeMembers: 0,
            expiredMembers: 0,
            unpaidMembers: 0,
            inactiveMembers: 0,
            membershipRevenue: 0,
            posRevenue: 0,
            totalExpenses: 0,
            totalPayroll: 0,
            totalCheckins: 0,
        });

        const totalRevenue = Number(totals.membershipRevenue || 0) + Number(totals.posRevenue || 0);
        const profit = totalRevenue - Number(totals.totalExpenses || 0) - Number(totals.totalPayroll || 0);
        const last30Revenue = Number(last30RevenueRes.rows[0]?.total_revenue || 0);
        const averageRevenuePerActiveMember = totals.activeMembers > 0
            ? Math.round(last30Revenue / totals.activeMembers)
            : 0;
        const expectedNextMonth = averageRevenuePerActiveMember * totals.activeMembers;

        const franchiseResponse = {
            range,
            plan: currentPlan,
            totals: {
                ...totals,
                totalRevenue,
                profit,
                averageRevenuePerActiveMember,
                expectedNextMonth,
            },
            revenueTrend: revenueTrendRes.rows.map((row) => ({
                name: row.name,
                membership_revenue: Number(row.membership_revenue || 0),
                pos_revenue: Number(row.pos_revenue || 0),
                total_revenue: Number(row.total_revenue || 0),
            })),
            topPlans: topPlansRes.rows.map((row) => ({
                name: row.name,
                revenue: Number(row.revenue || 0),
                buyers: Number(row.buyers || 0),
            })),
            branches,
        };

        await cacheSet(cacheKey, franchiseResponse, FRANCHISE_INSIGHTS_TTL);
        return res.json(franchiseResponse);
    } catch (err) {
        return sendInsightsRouteError(res, err, 'FRANCHISE INSIGHTS ERROR:', 'Failed to load franchise insights.');
    }
});

module.exports = router;