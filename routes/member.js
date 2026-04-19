const express = require('express');
const { pool } = require('../config/db');
const memberAuth = require('../middleware/memberAuthMiddleware');
const {
    ensureInteger,
    ensureNumber,
    ensureDateOnly,
    ensureTrimmedString,
    ensurePhone10,
    ensureEmail,
    isValidationError,
} = require('../utils/fieldValidation');
const {
    createProfileUploadMiddleware,
    cleanupUploadedFile,
    getStoredProfileValue,
    resolveStoredProfileImagePath,
} = require('../utils/profileUploads');
const {
    ensurePaymentCollectionsSchema,
    roundMoney,
    DUE_ZERO_THRESHOLD,
    getGymCollectionSetup,
    getPendingPaymentById,
    createCollectionPaymentLink,
    createCollectionRazorpayClient,
    resolvePaidPaymentLinkResult,
    serializeCollectionPaymentLink,
    fetchCollectionPaymentLinkSafely,
    applyDueCollection,
} = require('./payments');
const {
    ensureMemberPaymentsSchema,
    buildDeskCollectionReference,
} = require('./memberships');

const router = express.Router();

const ACTIVE_BOOKING_STATUSES = ['BOOKED', 'CHECKED_IN', 'WAITLISTED'];
const COVERAGE_BOOKABLE_STATUSES = new Set(['ACTIVE', 'EXPIRING SOON']);
const COVERAGE_VISIBLE_STATUSES = new Set(['ACTIVE', 'EXPIRING SOON', 'FROZEN']);

const uploadMemberProfilePic = createProfileUploadMiddleware({
    prefix: 'member-profile',
    storageMode: 'inline',
    getActorId: (req) => req.member?.id || req.user?.id || 'member',
});

const tableHasColumn = async (tableName, columnName) => {
    const result = await pool.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = $2
         LIMIT 1`,
        [tableName, columnName]
    );
    return result.rows.length > 0;
};

const toIsoDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString();
};

const daysUntilDate = (value) => {
    if (!value) return null;
    const endDate = new Date(value);
    if (Number.isNaN(endDate.getTime())) return null;
    return Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / 86400000));
};

const normalizeOptionalMemberEmail = (value) => ensureEmail(value, { field: 'email', max: 100 });
const normalizeOptionalMemberPhone = (value) => ensurePhone10(value, { field: 'phone' });

const normalizeDocumentUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (/^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(raw)) {
        return raw;
    }

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;

    try {
        const parsed = new URL(withProtocol);
        if (!/^https?:$/i.test(parsed.protocol)) return '';
        return parsed.toString();
    } catch (_err) {
        return '';
    }
};

const normalizeMemberDocumentPayload = (payload = {}) => ({
    doc_type: ensureTrimmedString(payload.doc_type, { field: 'doc_type', required: true, max: 60 }),
    doc_name: ensureTrimmedString(payload.doc_name, { field: 'doc_name', max: 120 }),
    notes: ensureTrimmedString(payload.notes, { field: 'notes', max: 1000 }),
});

const normalizeOnboardingPatch = (payload = {}) => {
    const updates = {};

    if (payload.onboarding_complete !== undefined) {
        updates.onboarding_complete = Boolean(payload.onboarding_complete);
    }
    if (payload.emergency_contact !== undefined) {
        updates.emergency_contact = ensureTrimmedString(payload.emergency_contact, { field: 'emergency_contact', max: 120 });
    }
    if (payload.gender !== undefined) {
        updates.gender = ensureTrimmedString(payload.gender, { field: 'gender', max: 20 });
    }
    if (payload.date_of_birth !== undefined) {
        updates.date_of_birth = ensureDateOnly(payload.date_of_birth, { field: 'date_of_birth', allowFuture: false });
    }
    if (payload.address !== undefined) {
        updates.address = ensureTrimmedString(payload.address, { field: 'address', max: 500 });
    }
    if (payload.blood_group !== undefined) {
        updates.blood_group = ensureTrimmedString(payload.blood_group, { field: 'blood_group', max: 20, uppercase: true });
    }
    if (payload.medical_notes !== undefined) {
        updates.medical_notes = ensureTrimmedString(payload.medical_notes, { field: 'medical_notes', max: 2000 });
    }

    return updates;
};

const buildCurrentMembership = (row) => {
    if (!row?.membership_id) {
        return null;
    }

    const status = String(row.membership_status || '').trim().toUpperCase();

    return {
        id: Number(row.membership_id),
        plan_id: row.plan_id ? Number(row.plan_id) : null,
        plan_name: row.plan_name || '',
        plan_price: roundMoney(row.plan_price),
        status,
        start_date: row.membership_start_date || null,
        end_date: row.membership_end_date || null,
        freeze_start_date: row.freeze_start_date || null,
        freeze_end_date: row.freeze_end_date || null,
        freeze_reason: row.freeze_reason || '',
        duration_days: row.duration_days ? Number(row.duration_days) : null,
        duration_months: row.duration_months ? Number(row.duration_months) : null,
        days_left: daysUntilDate(row.membership_end_date),
        can_book_classes: Boolean(
            row.membership_end_date
            && COVERAGE_BOOKABLE_STATUSES.has(status)
            && new Date(row.membership_end_date).getTime() >= Date.now() - 86400000
        ),
        has_visible_coverage: Boolean(
            row.membership_end_date
            && COVERAGE_VISIBLE_STATUSES.has(status)
            && new Date(row.membership_end_date).getTime() >= Date.now() - 86400000
        ),
    };
};

const serializeMemberSummary = (row) => ({
    id: Number(row.id),
    gym_id: Number(row.gym_id),
    full_name: row.full_name || '',
    email: row.email || '',
    phone: row.phone || '',
    profile_pic: row.profile_pic || '',
    joining_date: row.joining_date || null,
    status: row.member_status || row.status || 'UNPAID',
    gym_name: row.gym_name || '',
    onboarding_complete: Boolean(row.onboarding_complete),
    emergency_contact: row.emergency_contact || '',
    gender: row.gender || '',
    date_of_birth: row.date_of_birth || null,
    address: row.address || '',
    blood_group: row.blood_group || '',
    medical_notes: row.medical_notes || '',
});

const mapPlanOption = (plan) => ({
    id: Number(plan.id),
    name: plan.name || '',
    price: roundMoney(plan.price),
    duration_days: Number(plan.duration_days || 0),
    duration_months: Number(plan.duration_months || 0),
    color_theme: plan.color_theme || 'blue',
    is_popular: Boolean(plan.is_popular),
    description: plan.description || '',
});

const mapPaymentHistoryEntry = (entry) => ({
    payment_date: entry.payment_date,
    amount_paid: roundMoney(entry.amount_paid),
    status: entry.status || 'Completed',
    invoice_id: entry.invoice_id || '',
    transaction_id: entry.transaction_id || '',
    payment_mode: entry.payment_mode || 'Cash',
    plan_name: entry.plan_name || 'Membership',
    entry_type: entry.entry_type || 'PAYMENT',
});

const mapDuePayment = (payment) => ({
    id: Number(payment.id),
    plan_id: payment.plan_id ? Number(payment.plan_id) : null,
    plan_name: payment.plan_name || 'Membership',
    amount_paid: roundMoney(payment.amount_paid),
    amount_due: roundMoney(payment.amount_due),
    total_amount: roundMoney(payment.total_amount),
    payment_date: payment.payment_date,
    status: payment.status || 'Pending',
    payment_mode: payment.payment_mode || 'Cash',
    invoice_id: payment.invoice_id || '',
    transaction_id: payment.transaction_id || '',
    notes: payment.notes || '',
    last_collection_at: payment.last_collection_at || null,
    collected_total: roundMoney(payment.collected_total),
});

const mapScheduleRow = (row) => {
    const capacity = Number(row.effective_capacity || 20);
    const bookedCount = Number(row.booked_count || 0);
    const waitlistCount = Number(row.waitlist_count || 0);
    const memberBookingId = row.member_booking_id ? Number(row.member_booking_id) : null;
    const memberBookingStatus = row.member_booking_status || '';

    return {
        id: Number(row.id),
        class_type_id: Number(row.class_type_id),
        class_title: row.class_title || '',
        category: row.category || '',
        description: row.description || '',
        color_theme: row.color_theme || 'indigo',
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        trainer_name: row.trainer_name || row.default_trainer_name || '',
        location: row.location || '',
        status: row.status || 'SCHEDULED',
        capacity,
        booked_count: bookedCount,
        waitlist_count: waitlistCount,
        checked_in_count: Number(row.checked_in_count || 0),
        is_full: bookedCount >= capacity,
        member_booking: memberBookingId
            ? {
                id: memberBookingId,
                status: memberBookingStatus,
            }
            : null,
    };
};

const mapBookingRow = (row) => ({
    id: Number(row.id),
    status: row.status || 'BOOKED',
    booked_at: row.booked_at,
    notes: row.notes || '',
    class_session_id: Number(row.class_session_id),
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    trainer_name: row.trainer_name || row.default_trainer_name || '',
    class_title: row.class_title || '',
    category: row.category || '',
    location: row.location || '',
    color_theme: row.color_theme || 'indigo',
});

const loadMemberContext = async (db, gymId, memberId, { lock = false } = {}) => {
    const result = await db.query(
        `SELECT
            m.id,
            m.gym_id,
            m.full_name,
            COALESCE(m.email, '') AS email,
            COALESCE(m.phone, '') AS phone,
            COALESCE(m.profile_pic, '') AS profile_pic,
            m.joining_date,
            COALESCE(m.status, 'UNPAID') AS member_status,
            COALESCE(m.onboarding_complete, FALSE) AS onboarding_complete,
            COALESCE(m.emergency_contact, '') AS emergency_contact,
            COALESCE(m.gender, '') AS gender,
            m.date_of_birth,
            COALESCE(m.address, '') AS address,
            COALESCE(m.blood_group, '') AS blood_group,
            COALESCE(m.medical_notes, '') AS medical_notes,
            g.name AS gym_name,
            ms.id AS membership_id,
            ms.plan_id,
            ms.start_date AS membership_start_date,
            ms.end_date AS membership_end_date,
            COALESCE(ms.status, '') AS membership_status,
            ms.freeze_start_date,
            ms.freeze_end_date,
            COALESCE(ms.freeze_reason, '') AS freeze_reason,
            p.name AS plan_name,
            p.price AS plan_price,
            p.duration_days,
            p.duration_months
         FROM members m
         INNER JOIN gyms g ON g.id = m.gym_id
         LEFT JOIN LATERAL (
            SELECT *
            FROM memberships
            WHERE member_id = m.id
              AND gym_id = m.gym_id
              AND deleted_at IS NULL
            ORDER BY end_date DESC NULLS LAST, id DESC
            LIMIT 1
         ) ms ON TRUE
         LEFT JOIN plans p ON p.id = ms.plan_id AND p.gym_id = m.gym_id AND p.deleted_at IS NULL
         WHERE m.id = $1
           AND m.gym_id = $2
           AND m.deleted_at IS NULL
         LIMIT 1
         ${lock ? 'FOR UPDATE OF m' : ''}`,
        [memberId, gymId]
    );

    return result.rows[0] || null;
};

const ensureMembershipBookable = (membership) => {
    if (!membership?.id || !membership?.can_book_classes) {
        return {
            ok: false,
            status: 400,
            error: 'An active membership is required before you can book classes.',
        };
    }

    return { ok: true };
};

const getPaymentCapabilitySummary = async (gymId) => {
    await ensureMemberPaymentsSchema();

    const result = await pool.query(
        `SELECT
            member_payments_enabled,
            COALESCE(member_upi_id, '') AS member_upi_id,
            COALESCE(member_razorpay_key_id, '') AS member_razorpay_key_id,
            COALESCE(member_razorpay_key_secret_enc, '') AS member_razorpay_key_secret_enc,
            COALESCE(member_payments_connect_mode, 'PARTNER') AS member_payments_connect_mode,
            COALESCE(member_razorpay_connected_account_id, '') AS member_razorpay_connected_account_id
         FROM gyms
         WHERE id = $1
         LIMIT 1`,
        [gymId]
    );

    const row = result.rows[0] || {};
    const connectMode = String(row.member_payments_connect_mode || 'PARTNER').toUpperCase();
    const hasRazorpay = connectMode === 'PARTNER'
        ? Boolean(String(row.member_razorpay_connected_account_id || '').trim())
        : Boolean(String(row.member_razorpay_key_id || '').trim() && String(row.member_razorpay_key_secret_enc || '').trim());

    return {
        online_enabled: Boolean(row.member_payments_enabled),
        channels: {
            razorpay: hasRazorpay,
            upi: Boolean(String(row.member_upi_id || '').trim()),
        },
        connect_mode: connectMode,
    };
};

const loadDashboardData = async (gymId, memberId) => {
    const memberRow = await loadMemberContext(pool, gymId, memberId);
    if (!memberRow) {
        return null;
    }

    const [planRows, dueSummary, bookingSummary, recentPayments, upcomingBookings, paymentCapabilities, receiptInfo, ownerInfo] = await Promise.all([
        pool.query(
            `SELECT id, name, price, duration_days, duration_months, color_theme, is_popular, description
             FROM plans
             WHERE gym_id = $1 AND deleted_at IS NULL
             ORDER BY price ASC, duration_days ASC, id ASC`,
            [gymId]
        ),
        pool.query(
            `SELECT
                COUNT(*)::INTEGER AS pending_count,
                COALESCE(SUM(amount_due), 0) AS pending_total
             FROM payments
             WHERE gym_id = $1
               AND user_id = $2
               AND deleted_at IS NULL
               AND COALESCE(amount_due, 0) > $3`,
            [gymId, memberId, DUE_ZERO_THRESHOLD]
        ),
        pool.query(
            `SELECT COUNT(*)::INTEGER AS upcoming_count
             FROM class_bookings cb
             INNER JOIN class_sessions cs ON cs.id = cb.class_session_id AND cs.gym_id = cb.gym_id
             WHERE cb.gym_id = $1
               AND cb.member_id = $2
               AND cb.status = ANY($3::text[])
               AND cs.starts_at >= NOW()`,
            [gymId, memberId, ACTIVE_BOOKING_STATUSES]
        ),
        pool.query(
            `WITH collection_totals AS (
                SELECT
                    pc.payment_id,
                    COALESCE(SUM(pc.collected_amount), 0) AS collected_total
                FROM payment_collections pc
                JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                WHERE pc.gym_id = $2
                GROUP BY pc.payment_id
            ),
            base_payments AS (
                SELECT
                    p.payment_date,
                    GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(ct.collected_total, 0), 0) AS amount_paid,
                    p.status,
                    p.invoice_id,
                    p.transaction_id,
                    p.payment_mode,
                    pl.name AS plan_name,
                    'PAYMENT' AS entry_type
                FROM payments p
                LEFT JOIN plans pl ON p.plan_id = pl.id AND pl.gym_id = p.gym_id
                LEFT JOIN collection_totals ct ON ct.payment_id = p.id
                WHERE p.user_id = $1
                  AND p.gym_id = $2
                  AND p.deleted_at IS NULL
            ),
            due_entries AS (
                SELECT
                    pc.created_at AS payment_date,
                    pc.collected_amount AS amount_paid,
                    CASE WHEN COALESCE(p.amount_due, 0) <= 0 THEN 'Completed' ELSE 'Pending' END AS status,
                    p.invoice_id,
                    pc.transaction_id,
                    pc.payment_mode,
                    CONCAT(COALESCE(pl.name, 'Membership'), ' · Due Collection') AS plan_name,
                    'DUE_COLLECTION' AS entry_type
                FROM payment_collections pc
                JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                LEFT JOIN plans pl ON p.plan_id = pl.id AND pl.gym_id = p.gym_id
                WHERE p.user_id = $1
                  AND pc.gym_id = $2
            )
            SELECT *
            FROM (
                SELECT * FROM base_payments
                UNION ALL
                SELECT * FROM due_entries
            ) payment_history
            ORDER BY payment_date DESC
            LIMIT 5`,
            [memberId, gymId]
        ),
        pool.query(
            `SELECT
                cb.id,
                cb.status,
                cb.booked_at,
                cb.notes,
                cb.class_session_id,
                cs.starts_at,
                cs.ends_at,
                cs.trainer_name,
                ct.title AS class_title,
                ct.category,
                ct.location,
                ct.color_theme,
                ct.trainer_name AS default_trainer_name
             FROM class_bookings cb
             INNER JOIN class_sessions cs ON cs.id = cb.class_session_id AND cs.gym_id = cb.gym_id
             INNER JOIN class_types ct ON ct.id = cs.class_type_id AND ct.gym_id = cs.gym_id
             WHERE cb.gym_id = $1
               AND cb.member_id = $2
               AND cb.status = ANY($3::text[])
               AND cs.starts_at >= NOW()
             ORDER BY cs.starts_at ASC
             LIMIT 4`,
            [gymId, memberId, ACTIVE_BOOKING_STATUSES]
        ),
        getPaymentCapabilitySummary(gymId),
        pool.query(
            `SELECT
                COALESCE(name, '') AS name,
                COALESCE(address, '') AS address,
                COALESCE(phone, '') AS phone,
                gym_logo,
                owner_signature,
                COALESCE(tax_id, '') AS tax_id,
                COALESCE(currency, '₹') AS currency
             FROM gyms
             WHERE id = $1
             LIMIT 1`,
            [gymId]
        ),
        pool.query(
            `SELECT full_name
             FROM users
             WHERE gym_id = $1
               AND LOWER(COALESCE(role, '')) = 'owner'
             ORDER BY id ASC
             LIMIT 1`,
            [gymId]
        ),
    ]);

    const receiptRow = receiptInfo.rows[0] || {};
    const ownerRow = ownerInfo.rows[0] || {};

    return {
        member: serializeMemberSummary(memberRow),
        membership: buildCurrentMembership(memberRow),
        renewal_options: planRows.rows.map(mapPlanOption),
        payments_summary: {
            pending_count: Number(dueSummary.rows[0]?.pending_count || 0),
            pending_total: roundMoney(dueSummary.rows[0]?.pending_total),
            recent_history: recentPayments.rows.map(mapPaymentHistoryEntry),
        },
        classes_summary: {
            upcoming_count: Number(bookingSummary.rows[0]?.upcoming_count || 0),
            upcoming_bookings: upcomingBookings.rows.map(mapBookingRow),
        },
        payment_capabilities: paymentCapabilities,
        receipt_info: {
            name: receiptRow.name || '',
            address: receiptRow.address || '',
            phone: receiptRow.phone || '',
            gym_logo: receiptRow.gym_logo || null,
            owner_signature: receiptRow.owner_signature || null,
            owner_name: ownerRow.full_name || '',
            tax_id: receiptRow.tax_id || '',
            currency: receiptRow.currency || '₹',
        },
    };
};

const applyMemberRenewalPayment = async ({ gymId, memberId, planId, paymentMode, paymentId }) => {
    const client = await pool.connect();

    try {
        const normalizedGymId = ensureInteger(gymId, { field: 'gym id', required: true, min: 1 });
        const normalizedMemberId = ensureInteger(memberId, { field: 'member_id', required: true, min: 1 });
        const normalizedPlanId = ensureInteger(planId, { field: 'plan_id', required: true, min: 1 });
        const transactionId = ensureTrimmedString(paymentId, { field: 'payment_id', required: true, max: 120 });
        const normalizedMode = ensureTrimmedString(paymentMode, { field: 'payment_mode', defaultValue: 'Online', max: 20 }) || 'Online';

        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`member-renew:${normalizedGymId}:${normalizedMemberId}`]);

        const [planResult, memberRow] = await Promise.all([
            client.query(
                `SELECT id, name, price, duration_days, duration_months
                 FROM plans
                 WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL
                 LIMIT 1`,
                [normalizedPlanId, normalizedGymId]
            ),
            loadMemberContext(client, normalizedGymId, normalizedMemberId, { lock: true }),
        ]);

        if (!memberRow) {
            await client.query('ROLLBACK');
            return { ok: false, status: 404, error: 'Member not found.' };
        }

        if (planResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return { ok: false, status: 404, error: 'Plan not found.' };
        }

        const plan = planResult.rows[0];
        const amount = roundMoney(plan.price);
        const daysToAdd = Number(plan.duration_days || (plan.duration_months * 30) || 30);
        const currentMembership = buildCurrentMembership(memberRow);
        const hasActiveCoverage = Boolean(
            currentMembership?.id
            && currentMembership.end_date
            && new Date(currentMembership.end_date).getTime() >= Date.now() - 86400000
            && COVERAGE_VISIBLE_STATUSES.has(String(currentMembership.status || '').toUpperCase())
        );

        if (hasActiveCoverage && currentMembership.plan_id && currentMembership.plan_id !== normalizedPlanId) {
            await client.query('ROLLBACK');
            return {
                ok: false,
                status: 400,
                error: 'Changing to a different plan before the current membership ends is not available in self-service yet.',
            };
        }

        const duplicatePayment = await client.query(
            `SELECT id, transaction_id
             FROM payments
             WHERE gym_id = $1
               AND user_id = $2
               AND transaction_id = $3
               AND deleted_at IS NULL
             LIMIT 1`,
            [normalizedGymId, normalizedMemberId, transactionId]
        );

        if (duplicatePayment.rows.length > 0) {
            await client.query('ROLLBACK');
            return {
                ok: true,
                data: {
                    duplicate: true,
                    message: 'Renewal payment was already applied.',
                    payment_id: duplicatePayment.rows[0].transaction_id || transactionId,
                    membership_status: currentMembership?.status || 'ACTIVE',
                    plan_name: plan.name,
                    amount,
                },
            };
        }

        await client.query(
            `UPDATE members
             SET status = 'ACTIVE',
                 joining_date = COALESCE(joining_date, CURRENT_DATE)
             WHERE id = $1 AND gym_id = $2`,
            [normalizedMemberId, normalizedGymId]
        );

        let membershipRow = null;

        if (hasActiveCoverage && currentMembership?.id && currentMembership.plan_id === normalizedPlanId) {
            const updateMembership = await client.query(
                `UPDATE memberships
                 SET end_date = (
                         CASE
                             WHEN end_date >= CURRENT_DATE AND UPPER(COALESCE(status, '')) IN ('ACTIVE', 'FROZEN', 'GRACE')
                                 THEN end_date + INTERVAL '1 day'
                             ELSE CURRENT_DATE
                         END
                     ) + ($1 || ' day')::interval,
                     status = 'ACTIVE',
                     freeze_start_date = NULL,
                     freeze_end_date = NULL,
                     freeze_reason = ''
                 WHERE id = $2 AND gym_id = $3 AND deleted_at IS NULL
                 RETURNING *`,
                [daysToAdd, currentMembership.id, normalizedGymId]
            );
            membershipRow = updateMembership.rows[0] || null;
        } else {
            if (currentMembership?.id) {
                await client.query(
                    `UPDATE memberships
                     SET deleted_at = NOW(),
                         status = 'EXPIRED'
                     WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL`,
                    [currentMembership.id, normalizedGymId]
                );
            }

            const createdMembership = await client.query(
                `INSERT INTO memberships (gym_id, member_id, plan_id, start_date, end_date, status)
                 VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + ($4 || ' day')::interval, 'ACTIVE')
                 RETURNING *`,
                [normalizedGymId, normalizedMemberId, normalizedPlanId, daysToAdd]
            );
            membershipRow = createdMembership.rows[0] || null;
        }

        const paymentInsert = await client.query(
            `INSERT INTO payments (
                gym_id,
                user_id,
                plan_id,
                amount_paid,
                total_amount,
                payment_date,
                status,
                payment_mode,
                transaction_id,
                invoice_id
             ) VALUES ($1, $2, $3, $4, $5, NOW(), 'Completed', $6, $7, $8)
             RETURNING *`,
            [
                normalizedGymId,
                normalizedMemberId,
                normalizedPlanId,
                amount,
                amount,
                normalizedMode,
                transactionId,
                transactionId,
            ]
        );

        await client.query('COMMIT');

        return {
            ok: true,
            data: {
                message: 'Membership renewed successfully.',
                membership: membershipRow,
                payment: paymentInsert.rows[0] || null,
                plan_name: plan.name,
                amount,
            },
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
};

router.use(memberAuth);

router.get('/dashboard', async (req, res) => {
    try {
        await Promise.all([ensureMemberPaymentsSchema(), ensurePaymentCollectionsSchema()]);

        const data = await loadDashboardData(req.member.gym_id, req.member.id);
        if (!data) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        return res.json(data);
    } catch (err) {
        console.error('MEMBER DASHBOARD ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load member workspace.' });
    }
});

router.put('/profile', uploadMemberProfilePic, async (req, res) => {
    try {
        const gymId = req.member.gym_id;
        const memberId = req.member.id;
        const fullName = ensureTrimmedString(req.body?.full_name, { field: 'full_name', required: true, min: 2, max: 100 });
        const email = normalizeOptionalMemberEmail(req.body?.email);
        const phone = normalizeOptionalMemberPhone(req.body?.phone);
        const removeProfilePic = String(req.body?.remove_profile_pic || '').trim().toLowerCase() === 'true';

        const currentResult = await pool.query(
            `SELECT id, profile_pic
             FROM members
             WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL
             LIMIT 1`,
            [memberId, gymId]
        );

        if (currentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        if (email) {
            const duplicateEmail = await pool.query(
                `SELECT id
                 FROM members
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   AND id <> $2
                   AND LOWER(COALESCE(email, '')) = LOWER($3)
                 LIMIT 1`,
                [gymId, memberId, email]
            );
            if (duplicateEmail.rows.length > 0) {
                return res.status(409).json({ error: 'Another member already uses this email address.' });
            }
        }

        if (phone) {
            const duplicatePhone = await pool.query(
                `SELECT id
                 FROM members
                 WHERE gym_id = $1
                   AND deleted_at IS NULL
                   AND id <> $2
                   AND COALESCE(phone, '') = $3
                 LIMIT 1`,
                [gymId, memberId, phone]
            );
            if (duplicatePhone.rows.length > 0) {
                return res.status(409).json({ error: 'Another member already uses this phone number.' });
            }
        }

        const currentProfilePic = currentResult.rows[0].profile_pic || '';
        const uploadedProfilePic = getStoredProfileValue(req.file);
        const nextProfilePic = removeProfilePic
            ? ''
            : (uploadedProfilePic || currentProfilePic);

        const updateResult = await pool.query(
            `UPDATE members
             SET full_name = $1,
                 email = $2,
                 phone = $3,
                 profile_pic = $4
             WHERE id = $5 AND gym_id = $6
             RETURNING id, gym_id, full_name, email, phone, profile_pic, joining_date, status`,
            [fullName, email, phone, nextProfilePic, memberId, gymId]
        );

        const oldStoredProfilePath = resolveStoredProfileImagePath(currentProfilePic);
        const nextStoredProfilePath = resolveStoredProfileImagePath(nextProfilePic);
        if (oldStoredProfilePath && oldStoredProfilePath !== nextStoredProfilePath && (uploadedProfilePic || removeProfilePic)) {
            await cleanupUploadedFile(oldStoredProfilePath);
        }

        return res.json({
            member: {
                ...updateResult.rows[0],
                gym_name: '',
            },
            message: 'Profile updated successfully.',
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER PROFILE UPDATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to update profile.' });
    }
});

router.patch('/onboarding', async (req, res) => {
    try {
        const payload = normalizeOnboardingPatch(req.body || {});
        const updates = [];
        const values = [];
        let nextIndex = 3;

        if (payload.onboarding_complete !== undefined) {
            updates.push(`onboarding_complete = $${nextIndex++}`);
            values.push(payload.onboarding_complete);
        }
        if (payload.emergency_contact !== undefined) {
            updates.push(`emergency_contact = $${nextIndex++}`);
            values.push(payload.emergency_contact);
        }
        if (payload.gender !== undefined) {
            updates.push(`gender = $${nextIndex++}`);
            values.push(payload.gender);
        }
        if (payload.date_of_birth !== undefined) {
            updates.push(`date_of_birth = $${nextIndex++}`);
            values.push(payload.date_of_birth || null);
        }
        if (payload.address !== undefined) {
            updates.push(`address = $${nextIndex++}`);
            values.push(payload.address);
        }
        if (payload.blood_group !== undefined) {
            updates.push(`blood_group = $${nextIndex++}`);
            values.push(payload.blood_group);
        }
        if (payload.medical_notes !== undefined) {
            updates.push(`medical_notes = $${nextIndex++}`);
            values.push(payload.medical_notes);
        }

        if (!updates.length) {
            return res.status(400).json({ error: 'No onboarding fields to update.' });
        }

        const updateResult = await pool.query(
            `UPDATE members
             SET ${updates.join(', ')}
             WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL
             RETURNING id`,
            [req.member.id, req.member.gym_id, ...values]
        );

        if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        const refreshedContext = await loadMemberContext(pool, req.member.gym_id, req.member.id);
        return res.json({
            member: serializeMemberSummary(refreshedContext),
            message: 'Onboarding details updated successfully.',
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER ONBOARDING UPDATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to update onboarding details.' });
    }
});

router.get('/documents', async (req, res) => {
    try {
        const [hasNotesColumn, hasUploadedAtColumn] = await Promise.all([
            tableHasColumn('member_documents', 'notes'),
            tableHasColumn('member_documents', 'uploaded_at'),
        ]);
        const notesSelect = hasNotesColumn ? 'md.notes' : 'NULL';
        const uploadedAtSelect = hasUploadedAtColumn ? 'md.uploaded_at' : 'md.created_at';
        const result = await pool.query(
            `SELECT md.*, ${notesSelect} AS notes, ${uploadedAtSelect} AS uploaded_at
             FROM member_documents md
             WHERE md.member_id = $1 AND md.gym_id = $2
             ORDER BY ${uploadedAtSelect} DESC`,
            [req.member.id, req.member.gym_id]
        );
        return res.json(result.rows);
    } catch (err) {
        console.error('MEMBER DOCUMENT LIST ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load documents.' });
    }
});

router.post('/documents', async (req, res) => {
    try {
        const payload = normalizeMemberDocumentPayload(req.body || {});
        const normalizedDocUrl = normalizeDocumentUrl(req.body?.doc_url);
        if (!normalizedDocUrl) {
            return res.status(400).json({ error: 'doc_type and a valid document are required.' });
        }

        const [hasNotesColumn, hasDocNameColumn] = await Promise.all([
            tableHasColumn('member_documents', 'notes'),
            tableHasColumn('member_documents', 'doc_name'),
        ]);
        const columns = ['gym_id', 'member_id', 'doc_type', 'doc_url'];
        const values = [req.member.gym_id, req.member.id, payload.doc_type, normalizedDocUrl];

        if (hasNotesColumn) {
            columns.push('notes');
            values.push(payload.notes || null);
        }
        if (hasDocNameColumn) {
            columns.push('doc_name');
            values.push(payload.doc_name || payload.doc_type);
        }

        const result = await pool.query(
            `INSERT INTO member_documents (${columns.join(', ')})
             VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})
             RETURNING *`,
            values
        );

        return res.status(201).json(result.rows[0]);
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER DOCUMENT CREATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to save document.' });
    }
});

router.delete('/documents/:id', async (req, res) => {
    try {
        const documentId = ensureInteger(req.params.id, { field: 'document id', required: true, min: 1 });
        await pool.query(
            `DELETE FROM member_documents
             WHERE id = $1 AND member_id = $2 AND gym_id = $3`,
            [documentId, req.member.id, req.member.gym_id]
        );
        return res.json({ message: 'Document deleted.' });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER DOCUMENT DELETE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to delete document.' });
    }
});

router.get('/payments/history', async (req, res) => {
    try {
        await ensurePaymentCollectionsSchema();
        const limit = ensureInteger(req.query.limit, { field: 'limit', min: 1, max: 100, defaultValue: 25 });

        const history = await pool.query(
            `WITH collection_totals AS (
                SELECT
                    pc.payment_id,
                    COALESCE(SUM(pc.collected_amount), 0) AS collected_total
                FROM payment_collections pc
                JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                WHERE pc.gym_id = $2
                GROUP BY pc.payment_id
            ),
            base_payments AS (
                SELECT
                    p.payment_date,
                    GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(ct.collected_total, 0), 0) AS amount_paid,
                    p.status,
                    p.invoice_id,
                    p.transaction_id,
                    p.payment_mode,
                    pl.name AS plan_name,
                    'PAYMENT' AS entry_type
                FROM payments p
                LEFT JOIN plans pl ON p.plan_id = pl.id AND pl.gym_id = p.gym_id
                LEFT JOIN collection_totals ct ON ct.payment_id = p.id
                WHERE p.user_id = $1
                  AND p.gym_id = $2
                  AND p.deleted_at IS NULL
            ),
            due_entries AS (
                SELECT
                    pc.created_at AS payment_date,
                    pc.collected_amount AS amount_paid,
                    CASE WHEN COALESCE(p.amount_due, 0) <= 0 THEN 'Completed' ELSE 'Pending' END AS status,
                    p.invoice_id,
                    pc.transaction_id,
                    pc.payment_mode,
                    CONCAT(COALESCE(pl.name, 'Membership'), ' · Due Collection') AS plan_name,
                    'DUE_COLLECTION' AS entry_type
                FROM payment_collections pc
                JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                LEFT JOIN plans pl ON p.plan_id = pl.id AND pl.gym_id = p.gym_id
                WHERE p.user_id = $1
                  AND pc.gym_id = $2
            )
            SELECT *
            FROM (
                SELECT * FROM base_payments
                UNION ALL
                SELECT * FROM due_entries
            ) payment_history
            ORDER BY payment_date DESC
            LIMIT $3`,
            [req.member.id, req.member.gym_id, limit]
        );

        return res.json(history.rows.map(mapPaymentHistoryEntry));
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER PAYMENT HISTORY ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load payment history.' });
    }
});

router.get('/payments/dues', async (req, res) => {
    try {
        await ensurePaymentCollectionsSchema();

        const result = await pool.query(
            `WITH collection_totals AS (
                SELECT
                    pc.payment_id,
                    COALESCE(SUM(pc.collected_amount), 0) AS collected_total,
                    MAX(pc.created_at) AS last_collection_at
                FROM payment_collections pc
                GROUP BY pc.payment_id
            )
            SELECT
                p.id,
                p.plan_id,
                pl.name AS plan_name,
                p.amount_paid,
                p.amount_due,
                p.total_amount,
                p.payment_date,
                p.status,
                p.payment_mode,
                p.invoice_id,
                p.transaction_id,
                p.notes,
                COALESCE(ct.collected_total, 0) AS collected_total,
                ct.last_collection_at
            FROM payments p
            LEFT JOIN plans pl ON pl.id = p.plan_id AND pl.gym_id = p.gym_id
            LEFT JOIN collection_totals ct ON ct.payment_id = p.id
            WHERE p.gym_id = $1
              AND p.user_id = $2
              AND p.deleted_at IS NULL
              AND COALESCE(p.amount_due, 0) > $3
            ORDER BY p.payment_date DESC, p.id DESC`,
            [req.member.gym_id, req.member.id, DUE_ZERO_THRESHOLD]
        );

        return res.json(result.rows.map(mapDuePayment));
    } catch (err) {
        console.error('MEMBER PAYMENT DUES ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load pending dues.' });
    }
});

router.post('/payments/dues/:paymentId/create-order', async (req, res) => {
    try {
        await ensureMemberPaymentsSchema();
        const paymentId = ensureInteger(req.params.paymentId, { field: 'payment id', required: true, min: 1 });
        const requestedAmount = req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === ''
            ? req.body?.amount
            : ensureNumber(req.body?.amount, { field: 'amount', min: 0, max: 1000000 });

        const payment = await getPendingPaymentById(pool, req.member.gym_id, paymentId);
        if (!payment || Number(payment.user_id) !== req.member.id) {
            return res.status(404).json({ error: 'Pending due not found.' });
        }

        const remainingDue = roundMoney(payment.amount_due);
        const amount = requestedAmount === undefined || requestedAmount === null || requestedAmount === ''
            ? remainingDue
            : roundMoney(requestedAmount);

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Enter a valid due amount.' });
        }
        if (amount - remainingDue > DUE_ZERO_THRESHOLD) {
            return res.status(400).json({ error: 'Due payment amount cannot exceed the pending balance.' });
        }

        const collectionSetup = await getGymCollectionSetup(req.member.gym_id);
        if (!collectionSetup.ok) {
            return res.status(collectionSetup.status).json({ error: collectionSetup.error });
        }

        const reference = buildDeskCollectionReference('DUE', payment.id);
        const dueNote = `${payment.plan_name || 'Membership'} due · ${payment.member_name || req.member.full_name || 'Member'}`;
        const responsePayload = {
            mode: 'COLLECTION',
            merchant_name: collectionSetup.data.payeeName,
            payment: {
                id: Number(payment.id),
                plan_name: payment.plan_name || 'Membership',
                amount_due: remainingDue,
                total_amount: roundMoney(payment.total_amount),
                payment_date: payment.payment_date,
                invoice_id: payment.invoice_id || '',
            },
            collection: collectionSetup.data.upi
                ? {
                    amount,
                    currency: 'INR',
                    payee_name: collectionSetup.data.upi.payeeName,
                    upi_id: collectionSetup.data.upi.upiId,
                    note: dueNote,
                    reference,
                }
                : null,
            razorpay: null,
            channels: {
                upi: Boolean(collectionSetup.data.upi),
                razorpay: false,
            },
        };

        if (collectionSetup.data.razorpay) {
            responsePayload.razorpay = await createCollectionPaymentLink({
                razorpayConfig: collectionSetup.data.razorpay,
                payeeName: collectionSetup.data.payeeName,
                amountPaise: Math.round(amount * 100),
                referenceId: reference,
                description: dueNote,
                member: {
                    member_name: payment.member_name,
                    member_email: payment.member_email,
                    member_phone: payment.member_phone,
                },
                notes: {
                    purpose: 'MEMBER_DUE',
                    gym_id: String(req.member.gym_id),
                    member_id: String(req.member.id),
                    payment_id: String(payment.id),
                },
            });
            responsePayload.channels.razorpay = true;
        }

        return res.json(responsePayload);
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER DUE ORDER ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to prepare due payment options.' });
    }
});

router.post('/payments/dues/:paymentId/payment-link-status', async (req, res) => {
    try {
        await ensureMemberPaymentsSchema();
        const paymentId = ensureInteger(req.params.paymentId, { field: 'payment id', required: true, min: 1 });
        const paymentLinkId = ensureTrimmedString(req.body?.payment_link_id, { field: 'payment_link_id', required: true, max: 120 });
        const requestedAmount = req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === ''
            ? req.body?.amount
            : ensureNumber(req.body?.amount, { field: 'amount', min: 0, max: 1000000 });
        const notes = ensureTrimmedString(req.body?.notes, { field: 'notes', max: 1000 });

        const payment = await getPendingPaymentById(pool, req.member.gym_id, paymentId);
        if (!payment || Number(payment.user_id) !== req.member.id) {
            return res.status(404).json({ error: 'Pending due not found.' });
        }

        const collectionSetup = await getGymCollectionSetup(req.member.gym_id);
        if (!collectionSetup.ok) {
            return res.status(collectionSetup.status).json({ error: collectionSetup.error });
        }
        if (!collectionSetup.data.razorpay) {
            return res.status(400).json({ error: 'Razorpay collection is not configured for this gym.' });
        }

        const razorpayClient = createCollectionRazorpayClient(collectionSetup.data.razorpay);
        const paymentLinkFetch = await fetchCollectionPaymentLinkSafely(razorpayClient, paymentLinkId);
        if (!paymentLinkFetch.ok) {
            return res.json({
                paid: false,
                status: 'NOT_FOUND',
                payment_link: {
                    id: paymentLinkId,
                    short_url: '',
                    status: 'not_found',
                    environment: collectionSetup.data.razorpay.environment,
                    gateway_source: collectionSetup.data.razorpay.source,
                },
            });
        }

        const paymentLink = paymentLinkFetch.paymentLink;
        const settledPayment = await resolvePaidPaymentLinkResult(razorpayClient, paymentLink);

        if (!settledPayment) {
            return res.json({
                paid: false,
                status: String(paymentLink.status || 'created').toUpperCase(),
                payment_link: serializeCollectionPaymentLink(paymentLink, {
                    environment: collectionSetup.data.razorpay.environment,
                    gatewaySource: collectionSetup.data.razorpay.source,
                }),
            });
        }

        const settledTransactionIds = Array.from(new Set([
            settledPayment.paymentId,
            settledPayment.linkId,
        ].map((value) => String(value || '').trim()).filter(Boolean)));

        const existingCollection = await pool.query(
            `SELECT 1
             FROM payment_collections
             WHERE gym_id = $1
               AND transaction_id = ANY($2::text[])
             LIMIT 1`,
            [req.member.gym_id, settledTransactionIds]
        );

        if (existingCollection.rows.length > 0) {
            return res.json({
                paid: true,
                already_processed: true,
                status: 'PAID',
                payment_id: settledPayment.paymentId || settledPayment.linkId,
                payment_method: settledPayment.method || null,
            });
        }

        const existingPayment = await pool.query(
            `SELECT 1
             FROM payments
             WHERE gym_id = $1
               AND transaction_id = ANY($2::text[])
               AND deleted_at IS NULL
             LIMIT 1`,
            [req.member.gym_id, settledTransactionIds]
        );

        if (existingPayment.rows.length > 0) {
            return res.json({
                paid: true,
                already_processed: true,
                status: 'PAID',
                payment_id: settledPayment.paymentId || settledPayment.linkId,
                payment_method: settledPayment.method || null,
            });
        }

        const result = await applyDueCollection({
            gymId: req.member.gym_id,
            paymentId,
            amount: Number.isFinite(Number(requestedAmount)) ? requestedAmount : settledPayment.amount,
            paymentMode: 'Online',
            transactionId: settledPayment.paymentId || settledPayment.linkId,
            notes,
            collectedBy: null,
        });

        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }

        return res.json({
            ...result.data,
            paid: true,
            status: 'PAID',
            payment_id: settledPayment.paymentId || settledPayment.linkId,
            payment_method: settledPayment.method || null,
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER DUE STATUS ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to verify due payment.' });
    }
});

router.post('/membership/renew/create-order', async (req, res) => {
    try {
        await ensureMemberPaymentsSchema();

        const memberContext = await loadMemberContext(pool, req.member.gym_id, req.member.id);
        if (!memberContext) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        const currentMembership = buildCurrentMembership(memberContext);
        const requestedPlanId = ensureInteger(req.body?.plan_id, {
            field: 'plan_id',
            min: 1,
            defaultValue: currentMembership?.plan_id || null,
        });

        if (!requestedPlanId) {
            return res.status(400).json({ error: 'Select a plan to renew.' });
        }

        if (currentMembership?.id && currentMembership.plan_id && currentMembership.plan_id !== requestedPlanId && currentMembership.has_visible_coverage) {
            return res.status(400).json({ error: 'Plan changes before the current membership ends are not available in self-service yet.' });
        }

        const collectionSetup = await getGymCollectionSetup(req.member.gym_id);
        if (!collectionSetup.ok) {
            return res.status(collectionSetup.status).json({ error: collectionSetup.error });
        }

        const planResult = await pool.query(
            `SELECT id, name, price, duration_days, duration_months, color_theme, description
             FROM plans
             WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL
             LIMIT 1`,
            [requestedPlanId, req.member.gym_id]
        );
        if (planResult.rows.length === 0) {
            return res.status(404).json({ error: 'Plan not found.' });
        }

        const plan = planResult.rows[0];
        const amountPaise = Math.round(Number(plan.price || 0) * 100);
        if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
            return res.status(400).json({ error: 'Selected plan has invalid price.' });
        }

        const reference = buildDeskCollectionReference('MEM', req.member.id);
        const renewNote = `${plan.name} renewal · ${memberContext.full_name}`;
        let razorpay = null;

        if (collectionSetup.data.razorpay) {
            razorpay = await createCollectionPaymentLink({
                razorpayConfig: collectionSetup.data.razorpay,
                payeeName: collectionSetup.data.payeeName,
                amountPaise,
                referenceId: reference,
                description: renewNote,
                member: memberContext,
                notes: {
                    purpose: 'MEMBER_RENEWAL',
                    gym_id: String(req.member.gym_id),
                    member_id: String(req.member.id),
                    plan_id: String(requestedPlanId),
                },
            });
        }

        return res.json({
            mode: 'COLLECTION',
            merchant_name: collectionSetup.data.payeeName,
            collection: collectionSetup.data.upi
                ? {
                    amount: roundMoney(plan.price),
                    currency: 'INR',
                    payee_name: collectionSetup.data.upi.payeeName,
                    upi_id: collectionSetup.data.upi.upiId,
                    note: renewNote,
                    reference,
                }
                : null,
            razorpay,
            channels: {
                upi: Boolean(collectionSetup.data.upi),
                razorpay: Boolean(razorpay),
            },
            plan: mapPlanOption(plan),
            membership: currentMembership,
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER RENEW ORDER ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to prepare renewal payment.' });
    }
});

router.post('/membership/renew/payment-link-status', async (req, res) => {
    try {
        await ensureMemberPaymentsSchema();
        const paymentLinkId = ensureTrimmedString(req.body?.payment_link_id, { field: 'payment_link_id', required: true, max: 120 });

        const memberContext = await loadMemberContext(pool, req.member.gym_id, req.member.id);
        if (!memberContext) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        const currentMembership = buildCurrentMembership(memberContext);
        const requestedPlanId = ensureInteger(req.body?.plan_id, {
            field: 'plan_id',
            min: 1,
            defaultValue: currentMembership?.plan_id || null,
        });

        if (!requestedPlanId) {
            return res.status(400).json({ error: 'Select a plan to renew.' });
        }

        if (currentMembership?.id && currentMembership.plan_id && currentMembership.plan_id !== requestedPlanId && currentMembership.has_visible_coverage) {
            return res.status(400).json({ error: 'Plan changes before the current membership ends are not available in self-service yet.' });
        }

        const collectionSetup = await getGymCollectionSetup(req.member.gym_id);
        if (!collectionSetup.ok) {
            return res.status(collectionSetup.status).json({ error: collectionSetup.error });
        }
        if (!collectionSetup.data.razorpay) {
            return res.status(400).json({ error: 'Razorpay collection is not configured for this gym.' });
        }

        const razorpayClient = createCollectionRazorpayClient(collectionSetup.data.razorpay);
        const paymentLinkFetch = await fetchCollectionPaymentLinkSafely(razorpayClient, paymentLinkId);
        if (!paymentLinkFetch.ok) {
            return res.json({
                paid: false,
                status: 'NOT_FOUND',
                payment_link: {
                    id: paymentLinkId,
                    short_url: '',
                    status: 'not_found',
                    environment: collectionSetup.data.razorpay.environment,
                    gateway_source: collectionSetup.data.razorpay.source,
                },
            });
        }

        const paymentLink = paymentLinkFetch.paymentLink;
        const settledPayment = await resolvePaidPaymentLinkResult(razorpayClient, paymentLink);

        if (!settledPayment) {
            return res.json({
                paid: false,
                status: String(paymentLink.status || 'created').toUpperCase(),
                payment_link: serializeCollectionPaymentLink(paymentLink, {
                    environment: collectionSetup.data.razorpay.environment,
                    gatewaySource: collectionSetup.data.razorpay.source,
                }),
            });
        }

        const settledTransactionIds = Array.from(new Set([
            settledPayment.paymentId,
            settledPayment.linkId,
        ].map((value) => String(value || '').trim()).filter(Boolean)));

        const existingPayment = await pool.query(
            `SELECT id
             FROM payments
             WHERE gym_id = $1
               AND user_id = $2
               AND transaction_id = ANY($3::text[])
               AND deleted_at IS NULL
             LIMIT 1`,
            [req.member.gym_id, req.member.id, settledTransactionIds]
        );

        if (existingPayment.rows.length > 0) {
            return res.json({
                paid: true,
                already_processed: true,
                status: 'PAID',
                payment_id: settledPayment.paymentId || settledPayment.linkId,
                payment_method: settledPayment.method || null,
            });
        }

        const result = await applyMemberRenewalPayment({
            gymId: req.member.gym_id,
            memberId: req.member.id,
            planId: requestedPlanId,
            paymentMode: 'Online',
            paymentId: settledPayment.paymentId || settledPayment.linkId,
        });

        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }

        return res.json({
            ...result.data,
            paid: true,
            status: 'PAID',
            payment_id: settledPayment.paymentId || settledPayment.linkId,
            payment_method: settledPayment.method || null,
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER RENEW STATUS ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to verify renewal payment.' });
    }
});

router.get('/classes/schedule', async (req, res) => {
    try {
        const from = toIsoDate(req.query.from) || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        const to = toIsoDate(req.query.to) || new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)).toISOString();

        const result = await pool.query(
            `SELECT
                cs.id,
                cs.class_type_id,
                cs.starts_at,
                cs.ends_at,
                cs.trainer_name,
                cs.status,
                ct.title AS class_title,
                ct.category,
                ct.description,
                ct.color_theme,
                ct.location,
                ct.trainer_name AS default_trainer_name,
                COALESCE(cs.capacity, ct.capacity, 20) AS effective_capacity,
                COUNT(cb.id) FILTER (WHERE cb.status IN ('BOOKED', 'CHECKED_IN'))::INTEGER AS booked_count,
                COUNT(cb.id) FILTER (WHERE cb.status = 'WAITLISTED')::INTEGER AS waitlist_count,
                COUNT(cb.id) FILTER (WHERE cb.status = 'CHECKED_IN')::INTEGER AS checked_in_count,
                MAX(mb.id) AS member_booking_id,
                MAX(mb.status) AS member_booking_status
             FROM class_sessions cs
             INNER JOIN class_types ct ON ct.id = cs.class_type_id AND ct.gym_id = cs.gym_id
             LEFT JOIN class_bookings cb ON cb.class_session_id = cs.id AND cb.gym_id = cs.gym_id
             LEFT JOIN class_bookings mb
                ON mb.class_session_id = cs.id
               AND mb.gym_id = cs.gym_id
               AND mb.member_id = $4
               AND mb.status <> 'CANCELLED'
             WHERE cs.gym_id = $1
               AND ct.is_active = TRUE
               AND cs.starts_at BETWEEN $2 AND $3
             GROUP BY cs.id, ct.id
             ORDER BY cs.starts_at ASC`,
            [req.member.gym_id, from, to, req.member.id]
        );

        return res.json(result.rows.map(mapScheduleRow));
    } catch (err) {
        console.error('MEMBER CLASS SCHEDULE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load class schedule.' });
    }
});

router.get('/classes/bookings', async (req, res) => {
    try {
        const limit = ensureInteger(req.query.limit, { field: 'limit', min: 1, max: 50, defaultValue: 12 });

        const result = await pool.query(
            `SELECT
                cb.id,
                cb.status,
                cb.booked_at,
                cb.notes,
                cb.class_session_id,
                cs.starts_at,
                cs.ends_at,
                cs.trainer_name,
                ct.title AS class_title,
                ct.category,
                ct.location,
                ct.color_theme,
                ct.trainer_name AS default_trainer_name
             FROM class_bookings cb
             INNER JOIN class_sessions cs ON cs.id = cb.class_session_id AND cs.gym_id = cb.gym_id
             INNER JOIN class_types ct ON ct.id = cs.class_type_id AND ct.gym_id = cs.gym_id
             WHERE cb.gym_id = $1
               AND cb.member_id = $2
               AND cb.status = ANY($3::text[])
               AND cs.ends_at >= NOW() - INTERVAL '12 hours'
             ORDER BY cs.starts_at ASC
             LIMIT $4`,
            [req.member.gym_id, req.member.id, ACTIVE_BOOKING_STATUSES, limit]
        );

        return res.json(result.rows.map(mapBookingRow));
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER CLASS BOOKINGS ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load class bookings.' });
    }
});

router.post('/classes/bookings', async (req, res) => {
    try {
        const sessionId = ensureInteger(req.body?.session_id, { field: 'session_id', required: true, min: 1 });
        const bookingNotes = ensureTrimmedString(req.body?.notes, { field: 'notes', max: 500 });

        const memberContext = await loadMemberContext(pool, req.member.gym_id, req.member.id);
        if (!memberContext) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        const membershipCheck = ensureMembershipBookable(buildCurrentMembership(memberContext));
        if (!membershipCheck.ok) {
            return res.status(membershipCheck.status).json({ error: membershipCheck.error });
        }

        const sessionRes = await pool.query(
            `SELECT
                cs.id,
                cs.gym_id,
                cs.starts_at,
                cs.ends_at,
                cs.status,
                COALESCE(cs.capacity, ct.capacity, 20) AS effective_capacity,
                ct.title AS class_title
             FROM class_sessions cs
             INNER JOIN class_types ct ON ct.id = cs.class_type_id AND ct.gym_id = cs.gym_id
             WHERE cs.id = $1 AND cs.gym_id = $2
             LIMIT 1`,
            [sessionId, req.member.gym_id]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ error: 'Class session not found.' });
        }

        const session = sessionRes.rows[0];
        if (new Date(session.starts_at).getTime() <= Date.now()) {
            return res.status(400).json({ error: 'This class has already started.' });
        }
        if (String(session.status || '').toUpperCase() === 'CANCELLED') {
            return res.status(400).json({ error: 'This class session is not available for booking.' });
        }

        const existingBooking = await pool.query(
            `SELECT id, status
             FROM class_bookings
             WHERE gym_id = $1
               AND class_session_id = $2
               AND member_id = $3
             LIMIT 1`,
            [req.member.gym_id, sessionId, req.member.id]
        );

        if (existingBooking.rows.length > 0 && existingBooking.rows[0].status !== 'CANCELLED') {
            return res.status(409).json({ error: 'You already have a booking for this class.' });
        }

        const activeBookingsRes = await pool.query(
            `SELECT COUNT(*)::INTEGER AS count
             FROM class_bookings
             WHERE gym_id = $1
               AND class_session_id = $2
               AND status IN ('BOOKED', 'CHECKED_IN')`,
            [req.member.gym_id, sessionId]
        );

        const effectiveCapacity = Number(session.effective_capacity || 20);
        const currentBookings = Number(activeBookingsRes.rows[0]?.count || 0);
        const bookingStatus = currentBookings >= effectiveCapacity ? 'WAITLISTED' : 'BOOKED';

        const result = await pool.query(
            `INSERT INTO class_bookings (gym_id, class_session_id, member_id, status, booked_at, notes)
             VALUES ($1, $2, $3, $4, NOW(), $5)
             ON CONFLICT (class_session_id, member_id)
             DO UPDATE SET
                status = EXCLUDED.status,
                booked_at = NOW(),
                notes = EXCLUDED.notes
             RETURNING *`,
            [req.member.gym_id, sessionId, req.member.id, bookingStatus, bookingNotes]
        );

        return res.status(201).json({
            ...result.rows[0],
            class_title: session.class_title,
            starts_at: session.starts_at,
            booking_status: bookingStatus,
        });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER CLASS BOOK ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to create class booking.' });
    }
});

router.delete('/classes/bookings/:bookingId', async (req, res) => {
    try {
        const bookingId = ensureInteger(req.params.bookingId, { field: 'booking id', required: true, min: 1 });

        const bookingResult = await pool.query(
            `SELECT
                cb.id,
                cb.status,
                cs.starts_at
             FROM class_bookings cb
             INNER JOIN class_sessions cs ON cs.id = cb.class_session_id AND cs.gym_id = cb.gym_id
             WHERE cb.id = $1
               AND cb.gym_id = $2
               AND cb.member_id = $3
             LIMIT 1`,
            [bookingId, req.member.gym_id, req.member.id]
        );

        if (bookingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        const booking = bookingResult.rows[0];
        if (String(booking.status || '').toUpperCase() === 'CHECKED_IN') {
            return res.status(400).json({ error: 'Checked-in classes cannot be cancelled from self-service.' });
        }
        if (new Date(booking.starts_at).getTime() <= Date.now()) {
            return res.status(400).json({ error: 'This class has already started.' });
        }

        await pool.query(
            `UPDATE class_bookings
             SET status = 'CANCELLED'
             WHERE id = $1 AND gym_id = $2 AND member_id = $3`,
            [bookingId, req.member.gym_id, req.member.id]
        );

        return res.json({ message: 'Class booking cancelled.' });
    } catch (err) {
        if (isValidationError(err)) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error('MEMBER CLASS CANCEL ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to cancel class booking.' });
    }
});

// --- STREAKS & BADGES ---
router.get('/streaks', memberAuth, async (req, res) => {
    try {
        const { gym_id, member_id } = req.memberUser;

        const [streakResult, badgeResult] = await Promise.all([
            pool.query(
                `SELECT current_streak, longest_streak, last_checkin_date FROM member_streaks WHERE gym_id = $1 AND member_id = $2`,
                [gym_id, member_id]
            ),
            pool.query(
                `SELECT badge_key, unlocked_at FROM member_badges WHERE gym_id = $1 AND member_id = $2 ORDER BY unlocked_at ASC`,
                [gym_id, member_id]
            ),
        ]);

        const streak = streakResult.rows[0] || { current_streak: 0, longest_streak: 0, last_checkin_date: null };
        return res.json({ streak, badges: badgeResult.rows });
    } catch (err) {
        console.error('MEMBER STREAKS ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load streaks.' });
    }
});

module.exports = router;