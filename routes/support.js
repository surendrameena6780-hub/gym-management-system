const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requirePermission } = require('../middleware/rbac');
const { ensurePlatformSettingsBase, normalizeSupportProfile } = require('../utils/platformSettings');

router.use(auth, saasMiddleware);

let ensureSupportProfileTablePromise;
const ensureSupportProfileTable = async () => {
    if (!ensureSupportProfileTablePromise) {
        ensureSupportProfileTablePromise = pool.query(`
            CREATE TABLE IF NOT EXISTS gym_support_profiles (
                gym_id INT PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
                whatsapp VARCHAR(30),
                about_mission TEXT,
                support_window VARCHAR(255),
                sla TEXT,
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);
    }
    await ensureSupportProfileTablePromise;
};

// GET /api/support/overview
router.get('/overview', requirePermission('support:read'), async (req, res) => {
    try {
        await ensurePlatformSettingsBase();

        const platform = await pool.query(
            `SELECT support_profile
             FROM platform_settings
             WHERE id = 1`
        );

        const supportProfile = normalizeSupportProfile(platform.rows[0]?.support_profile);

        return res.json({
            contact: {
                phone: supportProfile.phone,
                email: supportProfile.email,
                whatsapp: supportProfile.whatsapp,
            },
            about: {
                title: 'About GymVault',
                mission: supportProfile.about,
                address: supportProfile.address,
                support_window: supportProfile.timings,
            },
        });
    } catch (err) {
        console.error('SUPPORT OVERVIEW ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load support overview.' });
    }
});

// GET /api/support/tickets
router.get('/tickets', requirePermission('support:read'), async (req, res) => {
    try {
        const tickets = await pool.query(
            `SELECT
                t.id,
                t.subject,
                t.category,
                t.priority,
                t.status,
                t.description,
                t.assigned_to,
                t.created_at,
                t.updated_at,
                u.full_name AS raised_by_name,
                u.email AS raised_by_email
             FROM support_tickets t
             LEFT JOIN users u ON u.id = t.raised_by
             WHERE t.gym_id = $1
             ORDER BY t.created_at DESC
             LIMIT 100`,
            [req.user.gym_id]
        );

        return res.json(tickets.rows);
    } catch (err) {
        console.error('SUPPORT TICKETS LIST ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load support tickets.' });
    }
});

// POST /api/support/tickets
router.post('/tickets', requirePermission('support:write'), async (req, res) => {
    const { subject, category, priority, description } = req.body;

    if (!subject || !description) {
        return res.status(400).json({ error: 'subject and description are required.' });
    }

    try {
        const insert = await pool.query(
            `INSERT INTO support_tickets
             (gym_id, raised_by, subject, category, priority, status, description)
             VALUES ($1, $2, $3, $4, $5, 'OPEN', $6)
             RETURNING id, subject, category, priority, status, description, created_at, updated_at`,
            [
                req.user.gym_id,
                req.user.id,
                String(subject).trim(),
                String(category || 'GENERAL').trim().toUpperCase(),
                String(priority || 'MEDIUM').trim().toUpperCase(),
                String(description).trim(),
            ]
        );

        await pool.query(
            `INSERT INTO notifications (gym_id, title, message)
             VALUES ($1, $2, $3)`,
            [
                req.user.gym_id,
                'Support ticket raised',
                `Ticket #${insert.rows[0].id} raised: ${insert.rows[0].subject}`,
            ]
        );

        return res.status(201).json(insert.rows[0]);
    } catch (err) {
        console.error('SUPPORT TICKET CREATE ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to raise support ticket.' });
    }
});

// GET /api/support/tickets/:id/messages
router.get('/tickets/:id/messages', requirePermission('support:read'), async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (!Number.isInteger(ticketId)) {
        return res.status(400).json({ error: 'Invalid ticket id.' });
    }

    try {
        const messages = await pool.query(
            `SELECT
                m.id,
                m.ticket_id,
                m.author_type,
                m.message,
                m.created_at,
                u.full_name AS author_name
             FROM support_ticket_messages m
             LEFT JOIN users u ON u.id = m.author_user_id
             WHERE m.gym_id = $1 AND m.ticket_id = $2
             ORDER BY m.created_at ASC`,
            [req.user.gym_id, ticketId]
        );

        return res.json(messages.rows);
    } catch (err) {
        console.error('SUPPORT TICKET MESSAGES ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to load ticket messages.' });
    }
});

// POST /api/support/tickets/:id/messages
router.post('/tickets/:id/messages', requirePermission('support:write'), async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const { message } = req.body;

    if (!Number.isInteger(ticketId)) {
        return res.status(400).json({ error: 'Invalid ticket id.' });
    }

    if (!message || !String(message).trim()) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    try {
        const ticket = await pool.query(
            `SELECT id
             FROM support_tickets
             WHERE id = $1 AND gym_id = $2`,
            [ticketId, req.user.gym_id]
        );

        if (ticket.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket not found.' });
        }

        const insert = await pool.query(
            `INSERT INTO support_ticket_messages
             (ticket_id, gym_id, author_user_id, author_type, message)
             VALUES ($1, $2, $3, 'GYM', $4)
             RETURNING id, ticket_id, author_type, message, created_at`,
            [ticketId, req.user.gym_id, req.user.id, String(message).trim()]
        );

        await pool.query(
            `UPDATE support_tickets
             SET updated_at = NOW()
             WHERE id = $1 AND gym_id = $2`,
            [ticketId, req.user.gym_id]
        );

        return res.status(201).json(insert.rows[0]);
    } catch (err) {
        console.error('SUPPORT TICKET REPLY ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to post reply.' });
    }
});

// POST /api/support/chatbot
router.post('/chatbot', requirePermission('support:read'), async (req, res) => {
    const message = String(req.body?.message || '').trim();

    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    const lower = message.toLowerCase();

    const intents = [
        {
            check: ['add member', 'add members', 'new member', 'register member', 'create member'],
            category: 'GENERAL',
            priority: 'MEDIUM',
            subject: 'Unable to add members',
            answer: 'To add members: open Members page, click Add Member, fill name/phone/email, assign plan, and save. If it fails, check duplicate phone and required fields.',
            actions: ['Open Members page', 'Verify required fields', 'Raise support ticket'],
        },
        {
            check: ['reset password', 'staff password', 'forgot password'],
            category: 'ACCOUNT',
            priority: 'MEDIUM',
            subject: 'Staff password reset help',
            answer: 'To reset staff password: go to Settings → Staff & Roles, find the staff member, enter a new password, and click Reset.',
            actions: ['Open Settings → Staff & Roles', 'Reset staff password', 'Raise support ticket'],
        },
        {
            check: ['billing', 'invoice', 'payment', 'subscription', 'plan'],
            category: 'BILLING',
            priority: 'MEDIUM',
            subject: 'Billing or subscription issue',
            answer: 'For billing issues: go to Settings → Billing & Subscriptions and verify current plan, validity date, and payment history.',
            actions: ['Open Billing settings', 'Download invoice', 'Raise billing ticket'],
        },
        {
            check: ['attendance', 'check in', 'check-in', 'checkin', 'qr', 'rfid'],
            category: 'TECHNICAL',
            priority: 'HIGH',
            subject: 'Attendance/check-in troubleshooting',
            answer: 'For attendance issues: verify mode in Attendance settings, ensure member has active plan, and retry check-in. If still failing, raise a technical ticket with member name and timestamp.',
            actions: ['Verify attendance mode', 'Retry check-in', 'Raise technical ticket'],
        },
        {
            check: ['member deleted', 'recover member', 'restore member'],
            category: 'DATA',
            priority: 'HIGH',
            subject: 'Recover deleted member',
            answer: 'Deleted members are soft-deleted. Share member name/phone and deletion time in a ticket so support can restore safely.',
            actions: ['Collect member details', 'Raise recovery ticket'],
        },
    ];

    const matched = intents.find((intent) => intent.check.some((keyword) => lower.includes(keyword)));

    if (!matched) {
        return res.json({
            answer: 'I can help with staff password reset, billing/subscription, attendance issues, and member recovery. You can also ask me to raise a ticket for this issue.',
            category: 'GENERAL',
            priority: 'LOW',
            suggested_subject: 'General support assistance',
            actions: ['Raise support ticket'],
            confidence: 'LOW',
        });
    }

    return res.json({
        answer: matched.answer,
        category: matched.category,
        priority: matched.priority,
        suggested_subject: matched.subject,
        actions: matched.actions,
        confidence: 'HIGH',
    });
});

module.exports = router;
