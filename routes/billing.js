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
    monthly: { basic: 999, pro: 1999, elite: 3999 },
    annual: { basic: 10068, pro: 19992, elite: 39996 },
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
            receipt: `master_saas_${req.user.gym_id}_${resolved.planTier}_${resolved.cycle}_${Date.now()}`,
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

            await pool.query('BEGIN');
            const targetPlan = resolved.planTier;
            const targetCycle = resolved.cycle;
            const daysToAdd = targetCycle === 'annual' ? 365 : 30;

            await pool.query(
                `UPDATE gyms 
                 SET saas_status = 'ACTIVE', 
                     current_plan = $1,
                     saas_billing_cycle = $2,
                     saas_valid_until = CURRENT_TIMESTAMP + ($3 || ' days')::interval 
                 WHERE id = $4`,
                [targetPlan, targetCycle, daysToAdd, req.user.gym_id]
            );

            await pool.query('COMMIT');
            res.json({ message: "Subscription activated!" });
        } catch (err) {
            await pool.query('ROLLBACK');
            res.status(500).json({ error: "DB Error" });
        }
    } else {
        res.status(400).json({ error: "Invalid signature!" });
    }
});
module.exports = router;