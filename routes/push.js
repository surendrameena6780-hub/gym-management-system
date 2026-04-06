const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const { pool } = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');
const memberAuthMiddleware = require('../middleware/memberAuthMiddleware');

const vapidConfigured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const PUSH_BATCH_SIZE = Math.max(25, Math.min(250, parseInt(process.env.PUSH_BATCH_SIZE || '100', 10) || 100));
if (vapidConfigured) {
    webpush.setVapidDetails(
        process.env.VAPID_EMAIL || 'mailto:admin@gymvault.app',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

const sendPushPayload = async (subscription, payload) => {
    try {
        await webpush.sendNotification(
            {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            JSON.stringify(payload || {})
        );
        return 1;
    } catch (err) {
        if (err.statusCode === 410) {
            pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [subscription.endpoint]).catch(() => {});
        }
        return 0;
    }
};

router.get('/vapid-public-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

router.post('/subscribe', authMiddleware, async (req, res) => {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ message: 'Invalid subscription object.' });
    }

    const gym_id = req.user.gym_id;
    const user_id = req.user.id;
    const role = req.user.role || 'OWNER';

    try {
        await pool.query(
            `INSERT INTO push_subscriptions (gym_id, user_id, role, endpoint, p256dh, auth)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (endpoint) DO UPDATE
             SET p256dh = $5, auth = $6, gym_id = $1, user_id = $2, role = $3`,
            [gym_id, user_id, role, endpoint, keys.p256dh, keys.auth]
        );
        res.json({ message: 'Subscribed.' });
    } catch (err) {
        console.error('Push subscribe error:', err.message);
        res.status(500).json({ message: 'Failed to save subscription.' });
    }
});

router.post('/subscribe-member', memberAuthMiddleware, async (req, res) => {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ message: 'Invalid subscription.' });
    }

    try {
        await pool.query(
            `INSERT INTO push_subscriptions (gym_id, user_id, role, endpoint, p256dh, auth)
             VALUES ($1, $2, 'MEMBER', $3, $4, $5)
             ON CONFLICT (endpoint) DO UPDATE
             SET p256dh = $4, auth = $5, gym_id = $1, user_id = $2, role = 'MEMBER'`,
            [req.member.gym_id, req.member.id, endpoint, keys.p256dh, keys.auth]
        );
        res.json({ message: 'Subscribed.' });
    } catch (err) {
        console.error('Member push subscribe error:', err.message);
        res.status(500).json({ message: 'Failed.' });
    }
});

router.delete('/unsubscribe', authMiddleware, async (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ message: 'Endpoint required.' });

    try {
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
        res.json({ message: 'Unsubscribed.' });
    } catch (_err) {
        res.status(500).json({ message: 'Failed.' });
    }
});

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

        await Promise.all(subs.rows.map((sub) => sendPushPayload(sub, {
            title: 'GymVault Test',
            body: 'Push notifications are working!',
            icon: '/gymvault-app-icon-192.png',
            badge: '/gymvault-app-icon-64.png',
            url: '/',
        })));

        res.json({ message: 'Test notification sent.' });
    } catch (err) {
        console.error('Push test error:', err.message);
        res.status(500).json({ message: 'Failed to send test notification.' });
    }
});

const sendPushToGym = async (gym_id, payload, roles = ['OWNER', 'STAFF', 'MEMBER']) => {
    try {
        if (!vapidConfigured) return 0;

        let deliveredTotal = 0;
        for (let offset = 0; ; offset += PUSH_BATCH_SIZE) {
            const subs = await pool.query(
                `SELECT endpoint, p256dh, auth, user_id
                 FROM push_subscriptions
                 WHERE gym_id = $1 AND role = ANY($2)
                 ORDER BY id ASC
                 LIMIT $3 OFFSET $4`,
                [gym_id, roles, PUSH_BATCH_SIZE, offset]
            );

            if (subs.rows.length === 0) {
                break;
            }

            const delivered = await Promise.all(subs.rows.map((sub) => sendPushPayload(sub, payload)));
            deliveredTotal += delivered.reduce((sum, count) => sum + count, 0);

            if (subs.rows.length < PUSH_BATCH_SIZE) {
                break;
            }
        }

        return deliveredTotal;
    } catch (err) {
        console.error(`sendPushToGym(${gym_id}) error:`, err.message);
        return 0;
    }
};

const sendPushToUsers = async (gym_id, userIds = [], payloadResolver, role = 'MEMBER') => {
    try {
        if (!vapidConfigured) {
            return { recipients: 0, subscriptions: 0, delivered: 0, deliveredByUser: {} };
        }

        const ids = Array.from(new Set(
            userIds
                .map((value) => Number.parseInt(value, 10))
                .filter((value) => Number.isInteger(value) && value > 0)
        ));

        if (ids.length === 0) {
            return { recipients: 0, subscriptions: 0, delivered: 0, deliveredByUser: {} };
        }

        const subs = await pool.query(
            `SELECT endpoint, p256dh, auth, user_id
             FROM push_subscriptions
             WHERE gym_id = $1 AND role = $2 AND user_id = ANY($3::int[])`,
            [gym_id, role, ids]
        );

        const deliveries = await Promise.all(subs.rows.map(async (sub) => {
            const payload = typeof payloadResolver === 'function'
                ? payloadResolver(sub.user_id, sub)
                : payloadResolver;

            if (!payload) {
                return { userId: sub.user_id, delivered: 0 };
            }

            const delivered = await sendPushPayload(sub, payload);
            return { userId: sub.user_id, delivered };
        }));

        const deliveredByUser = deliveries.reduce((acc, entry) => {
            if (!entry?.userId) return acc;
            acc[entry.userId] = (acc[entry.userId] || 0) + (entry.delivered || 0);
            return acc;
        }, {});

        return {
            recipients: ids.length,
            subscriptions: subs.rows.length,
            delivered: deliveries.reduce((sum, entry) => sum + (entry.delivered || 0), 0),
            deliveredByUser,
        };
    } catch (err) {
        console.error(`sendPushToUsers(${gym_id}) error:`, err.message);
        return { recipients: 0, subscriptions: 0, delivered: 0, deliveredByUser: {} };
    }
};

module.exports = router;
module.exports.sendPushToGym = sendPushToGym;
module.exports.sendPushToUsers = sendPushToUsers;
