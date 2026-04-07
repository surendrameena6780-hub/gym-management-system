const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const { requireOwner } = require('../middleware/rbac');

router.use(auth, requireOwner);

// Lazy Razorpay initializer — prevents crash when keys are not configured
let _razorpay = null;
const getRazorpay = () => {
    if (!_razorpay) {
        if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables are required for billing.');
        }
        _razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
    }
    return _razorpay;
};

const SAAS_PRICING = {
    monthly: { test: 1, basic: 999, pro: 1999, elite: 3999 },
    annual:  { test: 1, basic: 10068, pro: 19992, elite: 39996 },
};

const normalizeCycle = (value) => String(value || 'monthly').trim().toLowerCase();
const normalizePlanTier = (value) => String(value || 'pro').trim().toLowerCase();

const resolveSaasPrice = (planTier, cycle) => {
    const normalizedCycle = normalizeCycle(cycle);
    const normalizedPlan = normalizePlanTier(planTier);
    const cycleMap = SAAS_PRICING[normalizedCycle];
    if (!cycleMap || !Object.prototype.hasOwnProperty.call(cycleMap, normalizedPlan)) {
        return null;
    }
    return { planTier: normalizedPlan, cycle: normalizedCycle, amountInr: cycleMap[normalizedPlan] };
};

// --- 0. PUBLIC CONFIG — returns the Razorpay key_id to authenticated frontend ---
router.get('/config', (req, res) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId) return res.status(503).json({ error: 'Payment gateway not configured.' });
    res.json({ razorpay_key_id: keyId });
});

// --- 1. CREATE DYNAMIC SAAS ORDER ---
router.post('/create-order', async (req, res) => {
    try {
        const resolved = resolveSaasPrice(req.body.plan_tier, req.body.cycle);
        if (!resolved) {
            return res.status(400).json({ error: 'Invalid plan_tier or cycle.' });
        }

        const options = {
            amount: resolved.amountInr * 100,
            currency: "INR",
            // Razorpay receipt max 40 chars — keep short
            receipt: `saas_${req.user.gym_id}_${resolved.planTier}_${Date.now().toString().slice(-8)}`,
            notes: {
                gym_id: String(req.user.gym_id),
                plan_tier: resolved.planTier,
                cycle: resolved.cycle,
            },
        };

        const order = await getRazorpay().orders.create(options);
        res.json(order);
    } catch (error) {
        console.error("RAZORPAY ORDER ERROR:", error);
        res.status(500).json({ error: "Failed to initiate payment" });
    }
});

// --- 2. VERIFY & SAVE PLAN ---
router.post('/verify', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_tier, cycle } = req.body;
    const resolved = resolveSaasPrice(plan_tier, cycle);
    if (!resolved) {
        return res.status(400).json({ error: 'Invalid plan_tier or cycle.' });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing payment verification fields.' });
    }

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(sign.toString()).digest("hex");

    if (razorpay_signature === expectedSign) {
        try {
            const order = await getRazorpay().orders.fetch(razorpay_order_id);
            if (!order || Number(order.amount) !== resolved.amountInr * 100 || String(order.currency || '').toUpperCase() !== 'INR') {
                return res.status(400).json({ error: 'Order amount/currency mismatch.' });
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');
            const targetPlan = resolved.planTier;
            const targetCycle = resolved.cycle;
            // Test plan expires in 1 day; real plans: annual=365, monthly=30
            const daysToAdd = targetPlan === 'test' ? 1 : targetCycle === 'annual' ? 365 : 30;

                await client.query(
                `UPDATE gyms 
                 SET saas_status = 'ACTIVE', 
                     current_plan = $1,
                     saas_billing_cycle = $2,
                     saas_valid_until = CURRENT_TIMESTAMP + ($3 || ' days')::interval 
                 WHERE id = $4`,
                [targetPlan, targetCycle, daysToAdd, req.user.gym_id]
            );

                await client.query('COMMIT');
            } catch (err) {
                try {
                    await client.query('ROLLBACK');
                } catch (_rollbackError) {
                    // Preserve the original billing failure.
                }
                throw err;
            } finally {
                client.release();
            }
            res.json({ message: "Subscription activated!" });
        } catch (err) {
            res.status(500).json({ error: "DB Error" });
        }
    } else {
        res.status(400).json({ error: "Invalid signature!" });
    }
});

// --- 3. RESET TEST PLAN TIMER (dev only, only works if current_plan is 'test') ---
router.post('/reset-test', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT current_plan FROM gyms WHERE id = $1', [req.user.gym_id]);
        if (!rows[0] || rows[0].current_plan !== 'test') {
            return res.status(400).json({ error: 'Reset is only available for the Test Drive plan.' });
        }
        const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await pool.query(
            `UPDATE gyms SET saas_valid_until = CURRENT_TIMESTAMP + INTERVAL '1 day' WHERE id = $1`,
            [req.user.gym_id]
        );
        res.json({ message: 'Test timer reset to 1 day.', saas_valid_until: newExpiry });
    } catch (err) {
        console.error('Reset test error:', err);
        res.status(500).json({ error: 'Failed to reset test timer.' });
    }
});

module.exports = router;