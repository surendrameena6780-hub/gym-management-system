const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const { pool } = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');

// Configure VAPID
webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@gymvault.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

// GET /api/push/vapid-public-key  — frontend needs this to subscribe
router.get('/vapid-public-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// POST /api/push/subscribe  — save a push subscription
router.post('/subscribe', authMiddleware, async (req, res) => {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ message: 'Invalid subscription object.' });
    }
    const gym_id = req.user.gym_id;
    const user_id = req.user.id;
    const role = req.user.role || 'OWNER';
    try {
        await pool.query(`
            INSERT INTO push_subscriptions (gym_id, user_id, role, endpoint, p256dh, auth)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (endpoint) DO UPDATE SET p256dh = $5, auth = $6, gym_id = $1, user_id = $2, role = $3
        `, [gym_id, user_id, role, endpoint, keys.p256dh, keys.auth]);
        res.json({ message: 'Subscribed.' });
    } catch (err) {
        console.error('Push subscribe error:', err.message);
        res.status(500).json({ message: 'Failed to save subscription.' });
    }
});

// POST /api/push/subscribe-member  — for member portal (no gym auth middleware)
router.post('/subscribe-member', async (req, res) => {
    const { endpoint, keys, member_id, gym_id } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth || !gym_id) {
        return res.status(400).json({ message: 'Invalid subscription.' });
    }
    try {
        await pool.query(`
            INSERT INTO push_subscriptions (gym_id, user_id, role, endpoint, p256dh, auth)
            VALUES ($1, $2, 'MEMBER', $3, $4, $5)
            ON CONFLICT (endpoint) DO UPDATE SET p256dh = $4, auth = $5, gym_id = $1, user_id = $2
        `, [gym_id, member_id || null, endpoint, keys.p256dh, keys.auth]);
        res.json({ message: 'Subscribed.' });
    } catch (err) {
        console.error('Member push subscribe error:', err.message);
        res.status(500).json({ message: 'Failed.' });
    }
});

// DELETE /api/push/unsubscribe
router.delete('/unsubscribe', authMiddleware, async (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ message: 'Endpoint required.' });
    try {
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
        res.json({ message: 'Unsubscribed.' });
    } catch (err) {
        res.status(500).json({ message: 'Failed.' });
    }
});

// POST /api/push/test  — send a test notification to current user's device
router.post('/test', authMiddleware, async (req, res) => {
    const gym_id = req.user.gym_id;
    const user_id = req.user.id;
    try {
        const subs = await pool.query(
            'SELECT * FROM push_subscriptions WHERE gym_id = $1 AND user_id = $2',
            [gym_id, user_id]
        );
        if (subs.rows.length === 0) {
            return res.status(404).json({ message: 'No subscriptions found for this user.' });
        }
        const payload = JSON.stringify({
            title: 'GymVault Test',
            body: 'Push notifications are working!',
            icon: '/vite.svg',
            badge: '/vite.svg',
            url: '/',
        });
        await Promise.all(subs.rows.map(sub =>
            webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
                .catch(err => {
                    if (err.statusCode === 410) pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
                })
        ));
        res.json({ message: 'Test notification sent.' });
    } catch (err) {
        console.error('Push test error:', err.message);
        res.status(500).json({ message: 'Failed to send test notification.' });
    }
});

// ── Shared helper: send push to a gym's subscriptions ────────────────────────
const sendPushToGym = async (gym_id, payload, roles = ['OWNER', 'STAFF', 'MEMBER']) => {
    try {
        const subs = await pool.query(
            'SELECT * FROM push_subscriptions WHERE gym_id = $1 AND role = ANY($2)',
            [gym_id, roles]
        );
        const msg = JSON.stringify(payload);
        await Promise.all(subs.rows.map(sub =>
            webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, msg)
                .catch(err => {
                    if (err.statusCode === 410) pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
                })
        ));
        return subs.rows.length;
    } catch (err) {
        console.error(`sendPushToGym(${gym_id}) error:`, err.message);
        return 0;
    }
};

module.exports = router;
module.exports.sendPushToGym = sendPushToGym;
