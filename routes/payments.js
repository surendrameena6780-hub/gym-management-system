const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requireOwner } = require('../middleware/rbac');
const { decryptSecret } = require('../utils/secretCrypto');

const router = express.Router();

router.use(auth, saasMiddleware, requireOwner);

const DUE_ZERO_THRESHOLD = 0.009;
let ensurePaymentCollectionsSchemaPromise;

const ensurePaymentCollectionsSchema = async () => {
    if (!ensurePaymentCollectionsSchemaPromise) {
        ensurePaymentCollectionsSchemaPromise = pool.query(`
                ALTER TABLE gyms
                ADD COLUMN IF NOT EXISTS member_payments_enabled BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS member_upi_id VARCHAR(120);

            CREATE TABLE IF NOT EXISTS payment_collections (
                id               SERIAL PRIMARY KEY,
                gym_id           INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
                payment_id       INTEGER REFERENCES payments(id) ON DELETE CASCADE,
                collected_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
                payment_mode     VARCHAR(50) DEFAULT 'Cash',
                transaction_id   VARCHAR(120),
                notes            TEXT DEFAULT '',
                collected_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at       TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_payment_collections_payment_id ON payment_collections(payment_id);
            CREATE INDEX IF NOT EXISTS idx_payment_collections_gym_id ON payment_collections(gym_id);
            CREATE INDEX IF NOT EXISTS idx_payment_collections_created_at ON payment_collections(created_at);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_collections_transaction_unique
            ON payment_collections(gym_id, transaction_id)
            WHERE transaction_id IS NOT NULL;
        `);
    }

    await ensurePaymentCollectionsSchemaPromise;
};

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const parseAmount = (value) => {
    if (value === undefined || value === null || value === '') return NaN;
    return roundMoney(Number.parseFloat(value));
};

const formatCurrency = (value) => roundMoney(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});

const normalizeCollectionMode = (value) => {
    const raw = String(value || '').trim().toUpperCase();
    return raw === 'ONLINE' ? 'Online' : 'Cash';
};

const appendNote = (existingNotes, newNote) => {
    const current = String(existingNotes || '').trim();
    const incoming = String(newNote || '').trim();
    if (!incoming) return current;
    return current ? `${current}\n${incoming}` : incoming;
};

const buildAutoCollectionReference = (paymentId) => `DUE-${paymentId}-${Date.now().toString().slice(-6)}`;

const getGymCollectionProfile = async (gymId) => {
    const gymConfigRes = await pool.query(
        `SELECT
            name,
            member_payments_enabled,
            member_upi_id
         FROM gyms
         WHERE id = $1
         LIMIT 1`,
        [gymId]
    );

    const gymConfig = gymConfigRes.rows[0] || {};
    if (!gymConfig.member_payments_enabled) {
        return { ok: false, status: 400, error: 'Member online collection is disabled in Integrations.' };
    }

    const upiId = String(gymConfig.member_upi_id || '').trim().toLowerCase();
    if (!upiId) {
        return { ok: false, status: 400, error: 'Add your collection UPI ID in Integrations before collecting member payments online.' };
    }

    return {
        ok: true,
        data: {
            payeeName: String(gymConfig.name || 'GymVault Gym').trim() || 'GymVault Gym',
            upiId,
        },
    };
};

const getPendingPaymentById = async (db, gymId, paymentId, { lock = false } = {}) => {
    const query = `
        SELECT
            p.id,
            p.gym_id,
            p.user_id,
            p.plan_id,
            p.invoice_id,
            p.transaction_id,
            p.amount_paid,
            p.amount_due,
            p.total_amount,
            p.payment_date,
            p.status,
            p.payment_mode,
            p.notes,
            m.full_name AS member_name,
            m.email AS member_email,
            m.phone AS member_phone,
            pl.name AS plan_name
        FROM payments p
        JOIN members m ON m.id = p.user_id AND m.gym_id = p.gym_id AND m.deleted_at IS NULL
        LEFT JOIN plans pl ON pl.id = p.plan_id AND pl.gym_id = p.gym_id
        WHERE p.id = $1
          AND p.gym_id = $2
          AND p.deleted_at IS NULL
        ${lock ? 'FOR UPDATE OF p' : ''}
    `;
    const result = await db.query(query, [paymentId, gymId]);
    return result.rows[0] || null;
};

const resolveDueAmount = (requestedAmount, remainingDue) => {
    if (requestedAmount === undefined || requestedAmount === null || requestedAmount === '') {
        return roundMoney(remainingDue);
    }
    return parseAmount(requestedAmount);
};

const getGymGatewayConfig = async (gymId) => {
    const gymConfigRes = await pool.query(
        `SELECT
            member_payments_enabled,
            member_razorpay_key_id,
            member_razorpay_key_secret_enc,
            member_payments_connect_mode,
            member_razorpay_connected_account_id
         FROM gyms WHERE id = $1 LIMIT 1`,
        [gymId]
    );

    const gymConfig = gymConfigRes.rows[0] || {};
    const connectMode = String(gymConfig.member_payments_connect_mode || 'MANUAL').toUpperCase();
    const connectedAccount = String(gymConfig.member_razorpay_connected_account_id || '').trim();

    if (!gymConfig.member_payments_enabled) {
        return { ok: false, status: 400, error: 'Member online payments are disabled in Integrations.' };
    }

    if (connectMode === 'PARTNER') {
        const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
        const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();

        if (!connectedAccount) {
            return { ok: false, status: 400, error: 'Razorpay account is not connected yet. Complete Connect Razorpay onboarding first.' };
        }
        if (!keyId || !keySecret) {
            return { ok: false, status: 500, error: 'Platform payment gateway not configured. Contact support.' };
        }

        return {
            ok: true,
            data: {
                connectMode,
                connectedAccount,
                keyId,
                keySecret,
            },
        };
    }

    const keyId = String(gymConfig.member_razorpay_key_id || '').trim();
    const keySecret = decryptSecret(gymConfig.member_razorpay_key_secret_enc || '');
    if (!keyId || !keySecret) {
        return { ok: false, status: 400, error: 'Razorpay member payment gateway is not configured. Please update Integrations.' };
    }

    return {
        ok: true,
        data: {
            connectMode,
            connectedAccount: '',
            keyId,
            keySecret,
        },
    };
};

const applyDueCollection = async ({ gymId, paymentId, amount, paymentMode, transactionId, notes, collectedBy }) => {
    await ensurePaymentCollectionsSchema();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const payment = await getPendingPaymentById(client, gymId, paymentId, { lock: true });
        if (!payment) {
            await client.query('ROLLBACK');
            return { ok: false, status: 404, error: 'Payment record not found.' };
        }

        const remainingDue = roundMoney(payment.amount_due);
        if (remainingDue <= DUE_ZERO_THRESHOLD) {
            await client.query('ROLLBACK');
            return { ok: false, status: 400, error: 'This payment no longer has a pending due.' };
        }

        const requestedAmount = resolveDueAmount(amount, remainingDue);
        if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
            await client.query('ROLLBACK');
            return { ok: false, status: 400, error: 'Enter a valid collection amount.' };
        }
        if (requestedAmount - remainingDue > DUE_ZERO_THRESHOLD) {
            await client.query('ROLLBACK');
            return { ok: false, status: 400, error: 'Collection amount cannot exceed the remaining due.' };
        }

        const normalizedMode = normalizeCollectionMode(paymentMode);
        const providedTransactionId = String(transactionId || '').trim();
        const collectionTransactionId = providedTransactionId || buildAutoCollectionReference(paymentId);
        const nextAmountPaid = roundMoney(Number(payment.amount_paid || 0) + requestedAmount);
        const nextAmountDue = Math.max(0, roundMoney(remainingDue - requestedAmount));
        const nextStatus = nextAmountDue <= DUE_ZERO_THRESHOLD ? 'Completed' : 'Pending';
        const nextNotes = appendNote(payment.notes, notes);
        const nextPaymentMode = Number(payment.amount_paid || 0) <= DUE_ZERO_THRESHOLD ? normalizedMode : payment.payment_mode;

        const collectionResult = await client.query(
            `INSERT INTO payment_collections
             (gym_id, payment_id, collected_amount, payment_mode, transaction_id, notes, collected_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING *`,
            [
                gymId,
                paymentId,
                requestedAmount,
                normalizedMode,
                collectionTransactionId || null,
                String(notes || '').trim(),
                collectedBy || null,
            ]
        );

        const updatedPayment = await client.query(
            `UPDATE payments
             SET amount_paid = $1,
                 amount_due = $2,
                 status = $3,
                 payment_mode = $4,
                 transaction_id = CASE WHEN $5 <> '' THEN $5 ELSE transaction_id END,
                 notes = $6
             WHERE id = $7 AND gym_id = $8
             RETURNING *`,
            [
                nextAmountPaid,
                nextAmountDue,
                nextStatus,
                nextPaymentMode,
                normalizedMode === 'Online' ? collectionTransactionId : '',
                nextNotes,
                paymentId,
                gymId,
            ]
        );

        await client.query('COMMIT');

        const message = nextAmountDue <= DUE_ZERO_THRESHOLD
            ? `Pending due cleared for ${payment.member_name}.`
            : `Collected ₹${formatCurrency(requestedAmount)}. ₹${formatCurrency(nextAmountDue)} is still pending for ${payment.member_name}.`;

        return {
            ok: true,
            data: {
                message,
                payment: updatedPayment.rows[0],
                collection: collectionResult.rows[0],
                remaining_due: nextAmountDue,
                member: {
                    id: payment.user_id,
                    full_name: payment.member_name,
                    email: payment.member_email,
                    phone: payment.member_phone,
                },
            },
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

router.get('/', async (req, res) => {
    try {
        await ensurePaymentCollectionsSchema();
        const { search } = req.query;
        const gym_id = req.user.gym_id;

        let query = `
            SELECT
                p.id,
                p.user_id,
                p.invoice_id,
                p.transaction_id,
                p.amount_paid,
                p.amount_due,
                p.total_amount,
                p.payment_date,
                p.status,
                p.payment_mode,
                p.notes,
                GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(pc.collected_total, 0), 0) AS initial_amount_paid,
                COALESCE(pc.collection_count, 0) AS collection_count,
                COALESCE(pc.collected_total, 0) AS collected_later,
                COALESCE(pc.online_collected_total, 0) AS due_online_collected,
                COALESCE(pc.cash_collected_total, 0) AS due_cash_collected,
                pc.last_collection_at,
                CASE
                    WHEN (
                        (LOWER(COALESCE(p.payment_mode, '')) = 'online' AND COALESCE(pc.cash_collected_total, 0) > 0)
                        OR (LOWER(COALESCE(p.payment_mode, '')) = 'cash' AND COALESCE(pc.online_collected_total, 0) > 0)
                        OR (COALESCE(pc.online_collected_total, 0) > 0 AND COALESCE(pc.cash_collected_total, 0) > 0)
                    ) THEN 'Mixed'
                    ELSE p.payment_mode
                END AS effective_payment_mode,
                m.full_name AS member_name,
                m.email AS member_email,
                m.phone AS member_phone,
                m.profile_pic,
                pl.name AS plan_name,
                pl.duration_days
            FROM payments p
            JOIN members m ON p.user_id = m.id AND m.gym_id = p.gym_id
            LEFT JOIN plans pl ON p.plan_id = pl.id AND pl.gym_id = p.gym_id
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*)::INTEGER AS collection_count,
                    COALESCE(SUM(pc.collected_amount), 0) AS collected_total,
                    COALESCE(SUM(CASE WHEN LOWER(COALESCE(pc.payment_mode, '')) = 'online' THEN pc.collected_amount ELSE 0 END), 0) AS online_collected_total,
                    COALESCE(SUM(CASE WHEN LOWER(COALESCE(pc.payment_mode, '')) = 'cash' THEN pc.collected_amount ELSE 0 END), 0) AS cash_collected_total,
                    MAX(pc.created_at) AS last_collection_at
                FROM payment_collections pc
                WHERE pc.payment_id = p.id
            ) pc ON true
            WHERE p.gym_id = $1
              AND p.deleted_at IS NULL
              AND m.deleted_at IS NULL
        `;
        const params = [gym_id];

        if (search) {
            query += ` AND (m.full_name ILIKE $2 OR p.invoice_id ILIKE $2 OR p.transaction_id ILIKE $2)`;
            params.push(`%${search}%`);
        }

        query += ` ORDER BY p.payment_date DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('GET PAYMENTS ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/record', async (req, res) => {
    const { user_id, plan_id, amount_paid, total_amount, payment_mode, notes, transaction_id } = req.body;
    const gym_id = req.user.gym_id;

    if (!user_id || !plan_id) {
        return res.status(400).json({ error: 'user_id and plan_id are required.' });
    }

    const parsedAmountPaid = parseFloat(amount_paid);
    const parsedTotalAmount = parseFloat(total_amount ?? amount_paid);
    if (isNaN(parsedAmountPaid) || parsedAmountPaid < 0) {
        return res.status(400).json({ error: 'amount_paid must be a valid non-negative number.' });
    }
    if (isNaN(parsedTotalAmount) || parsedTotalAmount < 0) {
        return res.status(400).json({ error: 'total_amount must be a valid non-negative number.' });
    }

    try {
        const amount_due = parsedTotalAmount - parsedAmountPaid;
        const status = amount_due > 0 ? 'Pending' : 'Completed';
        const auto_inv_id = `INV-${Date.now().toString().slice(-6)}`;

        const final_txn_id = (transaction_id && transaction_id.trim()) ? transaction_id : auto_inv_id;
        const final_invoice_id = (transaction_id && transaction_id.startsWith('pay_')) ? transaction_id : auto_inv_id;
        const final_mode = (transaction_id && transaction_id.startsWith('pay_')) ? 'Online' : (payment_mode || 'Cash');

        const [memberResult, planResult] = await Promise.all([
            pool.query(
                'SELECT id FROM members WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
                [user_id, gym_id]
            ),
            pool.query(
                'SELECT id, duration_days FROM plans WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL LIMIT 1',
                [plan_id, gym_id]
            ),
        ]);

        if (memberResult.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        if (planResult.rows.length === 0) {
            return res.status(404).json({ error: 'Plan not found.' });
        }

        await pool.query('BEGIN');

        const newPayment = await pool.query(
            `INSERT INTO payments
             (gym_id, user_id, plan_id, amount_paid, amount_due, total_amount,
              payment_mode, status, invoice_id, transaction_id, notes, payment_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
             RETURNING *`,
            [
                gym_id, user_id, plan_id,
                parsedAmountPaid, amount_due, parsedTotalAmount,
                final_mode, status, final_invoice_id, final_txn_id, notes || '',
            ]
        );

        await pool.query("UPDATE memberships SET deleted_at = NOW(), status = 'EXPIRED' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL", [user_id, gym_id]);

        const days = planResult.rows[0].duration_days || 30;
        await pool.query(
            `INSERT INTO memberships (gym_id, member_id, plan_id, start_date, end_date, status)
             VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + ($4 || ' day')::interval, 'ACTIVE')`,
            [gym_id, user_id, plan_id, days]
        );

        await pool.query(
            `UPDATE members
             SET status = 'ACTIVE',
                 joining_date = COALESCE(joining_date, CURRENT_DATE),
                 last_visit = NOW()
             WHERE id = $1 AND gym_id = $2`,
            [user_id, gym_id]
        );

        await pool.query(
            `INSERT INTO attendance (gym_id, member_id, check_in_time)
             VALUES ($1, $2, NOW())`,
            [gym_id, user_id]
        );

        await pool.query('COMMIT');
        res.json({ msg: 'Payment Recorded!', payment: newPayment.rows[0] });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('RECORD PAYMENT ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/stats', async (req, res) => {
    try {
        await ensurePaymentCollectionsSchema();
        const gym_id = req.user.gym_id;
        const [revenue, today, pending] = await Promise.all([
            pool.query(
                `SELECT COALESCE(SUM(amount_paid), 0) AS total
                 FROM payments
                 WHERE gym_id = $1 AND deleted_at IS NULL`,
                [gym_id]
            ),
            pool.query(
                `WITH collection_totals AS (
                    SELECT
                        pc.payment_id,
                        COALESCE(SUM(pc.collected_amount), 0) AS collected_total
                    FROM payment_collections pc
                    JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                    WHERE pc.gym_id = $1
                    GROUP BY pc.payment_id
                ),
                initial_payments_today AS (
                    SELECT COALESCE(SUM(GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(ct.collected_total, 0), 0)), 0) AS total
                    FROM payments p
                    LEFT JOIN collection_totals ct ON ct.payment_id = p.id
                    WHERE p.gym_id = $1
                      AND p.deleted_at IS NULL
                      AND p.payment_date::date = CURRENT_DATE
                ),
                due_collections_today AS (
                    SELECT COALESCE(SUM(pc.collected_amount), 0) AS total
                    FROM payment_collections pc
                    JOIN payments p ON p.id = pc.payment_id
                    WHERE pc.gym_id = $1
                      AND p.deleted_at IS NULL
                      AND pc.created_at::date = CURRENT_DATE
                )
                SELECT (
                    COALESCE((SELECT total FROM initial_payments_today), 0)
                    + COALESCE((SELECT total FROM due_collections_today), 0)
                ) AS total`,
                [gym_id]
            ),
            pool.query(
                `SELECT COALESCE(SUM(amount_due), 0) AS pending
                 FROM payments
                 WHERE gym_id = $1
                   AND status = 'Pending'
                   AND deleted_at IS NULL`,
                [gym_id]
            ),
        ]);

        res.json({
            total_revenue: parseFloat(revenue.rows[0].total),
            today_revenue: parseFloat(today.rows[0].total),
            pending_dues: parseFloat(pending.rows[0].pending),
        });
    } catch (err) {
        console.error('PAYMENT STATS ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/chart', async (req, res) => {
    try {
        await ensurePaymentCollectionsSchema();
        const gym_id = req.user.gym_id;
        const days = req.query.days === '7' ? 7 : 30;

        const chartData = await pool.query(
            `WITH collection_totals AS (
                SELECT
                    pc.payment_id,
                    COALESCE(SUM(pc.collected_amount), 0) AS collected_total
                FROM payment_collections pc
                JOIN payments p ON p.id = pc.payment_id AND p.deleted_at IS NULL
                WHERE pc.gym_id = $1
                GROUP BY pc.payment_id
            ),
            payment_events AS (
                SELECT
                    p.payment_date::date AS event_date,
                    GREATEST(COALESCE(p.amount_paid, 0) - COALESCE(ct.collected_total, 0), 0) AS revenue
                FROM payments p
                LEFT JOIN collection_totals ct ON ct.payment_id = p.id
                WHERE p.gym_id = $1
                  AND p.deleted_at IS NULL
            ),
            due_events AS (
                SELECT
                    pc.created_at::date AS event_date,
                    pc.collected_amount AS revenue
                FROM payment_collections pc
                JOIN payments p ON p.id = pc.payment_id
                WHERE pc.gym_id = $1
                  AND p.deleted_at IS NULL
            ),
            all_events AS (
                SELECT event_date, revenue FROM payment_events
                UNION ALL
                SELECT event_date, revenue FROM due_events
            )
            SELECT
                TO_CHAR(event_date, 'YYYY-MM-DD') AS date,
                ROUND(SUM(revenue))::INTEGER AS revenue
            FROM all_events
            WHERE event_date >= CURRENT_DATE - (($2::int - 1) * INTERVAL '1 day')
            GROUP BY event_date
            ORDER BY event_date ASC`,
            [gym_id, days]
        );

        res.json(chartData.rows.map((row) => ({ date: row.date, revenue: row.revenue || 0 })));
    } catch (err) {
        console.error('CHART ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/history/:member_id', async (req, res) => {
    try {
        await ensurePaymentCollectionsSchema();
        const { member_id } = req.params;
        const gym_id = req.user.gym_id;
        if (!member_id || member_id === 'undefined' || member_id === 'null') {
            return res.json([]);
        }

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
            LIMIT 12`,
            [member_id, gym_id]
        );

        res.json(history.rows);
    } catch (err) {
        console.error('HISTORY ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/:id/due/create-order', async (req, res) => {
    const paymentId = Number.parseInt(req.params.id, 10);
    const gym_id = req.user.gym_id;
    const amount = req.body?.amount;

    if (!Number.isInteger(paymentId)) {
        return res.status(400).json({ error: 'Invalid payment id.' });
    }

    try {
        await ensurePaymentCollectionsSchema();

        const payment = await getPendingPaymentById(pool, gym_id, paymentId);
        if (!payment) {
            return res.status(404).json({ error: 'Payment record not found.' });
        }

        const remainingDue = roundMoney(payment.amount_due);
        if (remainingDue <= DUE_ZERO_THRESHOLD) {
            return res.status(400).json({ error: 'This payment no longer has a pending due.' });
        }

        const collectionAmount = resolveDueAmount(amount, remainingDue);
        if (!Number.isFinite(collectionAmount) || collectionAmount <= 0) {
            return res.status(400).json({ error: 'Enter a valid collection amount.' });
        }
        if (collectionAmount - remainingDue > DUE_ZERO_THRESHOLD) {
            return res.status(400).json({ error: 'Collection amount cannot exceed the remaining due.' });
        }

        const collectionProfile = await getGymCollectionProfile(gym_id);
        if (!collectionProfile.ok) {
            return res.status(collectionProfile.status).json({ error: collectionProfile.error });
        }

        return res.json({
            mode: 'COLLECTION',
            collection: {
                amount: collectionAmount,
                currency: 'INR',
                payee_name: collectionProfile.data.payeeName,
                upi_id: collectionProfile.data.upiId,
                note: `Pending due · ${payment.member_name} · Invoice ${payment.invoice_id || payment.id}`,
                reference: buildAutoCollectionReference(payment.id),
            },
            payment: {
                id: payment.id,
                invoice_id: payment.invoice_id,
                amount_due: remainingDue,
                total_amount: Number(payment.total_amount || 0),
                member_name: payment.member_name,
                member_email: payment.member_email,
                member_phone: payment.member_phone,
                plan_name: payment.plan_name,
            },
        });
    } catch (err) {
        console.error('DUE COLLECTION CONTEXT ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to prepare due collection details.' });
    }
});

router.post('/:id/due/collect', async (req, res) => {
    const paymentId = Number.parseInt(req.params.id, 10);
    const gym_id = req.user.gym_id;

    if (!Number.isInteger(paymentId)) {
        return res.status(400).json({ error: 'Invalid payment id.' });
    }

    try {
        const result = await applyDueCollection({
            gymId: gym_id,
            paymentId,
            amount: req.body?.amount,
            paymentMode: req.body?.payment_mode || 'Cash',
            transactionId: req.body?.transaction_id,
            notes: req.body?.notes,
            collectedBy: req.user.id,
        });

        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }

        return res.json(result.data);
    } catch (err) {
        console.error('DUE COLLECTION ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to collect pending due.' });
    }
});

router.post('/:id/due/verify', async (req, res) => {
    const paymentId = Number.parseInt(req.params.id, 10);
    const gym_id = req.user.gym_id;
    const {
        amount,
        notes,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
    } = req.body || {};

    if (!Number.isInteger(paymentId)) {
        return res.status(400).json({ error: 'Invalid payment id.' });
    }
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing payment verification details.' });
    }

    try {
        await ensurePaymentCollectionsSchema();

        const gatewayConfig = await getGymGatewayConfig(gym_id);
        if (!gatewayConfig.ok) {
            return res.status(gatewayConfig.status).json({ error: gatewayConfig.error });
        }

        const sign = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSign = crypto.createHmac('sha256', gatewayConfig.data.keySecret).update(sign).digest('hex');
        if (expectedSign !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid payment signature.' });
        }

        const existingCollection = await pool.query(
            `SELECT 1
             FROM payment_collections
             WHERE gym_id = $1
               AND transaction_id = $2
             LIMIT 1`,
            [gym_id, razorpay_payment_id]
        );
        if (existingCollection.rows.length > 0) {
            return res.status(409).json({ error: 'This due payment has already been processed.' });
        }

        const existingPayment = await pool.query(
            `SELECT 1
             FROM payments
             WHERE gym_id = $1
               AND transaction_id = $2
               AND deleted_at IS NULL
             LIMIT 1`,
            [gym_id, razorpay_payment_id]
        );
        if (existingPayment.rows.length > 0) {
            return res.status(409).json({ error: 'This payment reference has already been used.' });
        }

        const result = await applyDueCollection({
            gymId: gym_id,
            paymentId,
            amount,
            paymentMode: 'Online',
            transactionId: razorpay_payment_id,
            notes,
            collectedBy: req.user.id,
        });

        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }

        return res.json(result.data);
    } catch (err) {
        console.error('ONLINE DUE VERIFY ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to verify due payment.' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const gym_id = req.user.gym_id;

        await pool.query('BEGIN');

        const payInfo = await pool.query(
            'SELECT user_id FROM payments WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL',
            [id, gym_id]
        );

        if (payInfo.rows.length === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({ msg: 'Record not found' });
        }
        const member_id = payInfo.rows[0].user_id;

        await pool.query('UPDATE payments SET deleted_at = NOW() WHERE id = $1 AND gym_id = $2 AND deleted_at IS NULL', [id, gym_id]);
        await pool.query("UPDATE memberships SET deleted_at = NOW(), status = 'EXPIRED' WHERE member_id = $1 AND gym_id = $2 AND deleted_at IS NULL", [member_id, gym_id]);
        await pool.query("UPDATE members SET status = 'UNPAID' WHERE id = $1 AND gym_id = $2", [member_id, gym_id]);

        await pool.query('COMMIT');
        res.json({ msg: 'Record archived and membership reset to Unpaid' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('DELETE PAYMENT ERROR:', err.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;