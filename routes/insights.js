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
    resolveBranchReadScope,
} = require('../utils/branchAccess');

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

        return res.json({
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
        });
    } catch (err) {
        return sendInsightsRouteError(res, err, 'INSIGHTS OVERVIEW ERROR:', 'Failed to load insights overview.');
    }
});

module.exports = router;