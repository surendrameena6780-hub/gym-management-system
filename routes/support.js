const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const auth = require('../middleware/authMiddleware');
const saasMiddleware = require('../middleware/saasMiddleware');
const { requirePermission } = require('../middleware/rbac');
const { ensurePlatformSettingsBase, normalizeSupportProfile } = require('../utils/platformSettings');
const { captureClientError } = require('../utils/runtimeTelemetry');

router.use(auth, saasMiddleware);

router.post('/client-errors', async (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        await captureClientError(req, payload);
        return res.status(202).json({ accepted: true });
    } catch (err) {
        console.error('CLIENT ERROR INGEST ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to capture client error.' });
    }
});

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
            subject: 'How to add a member',
            answer: 'To add a member:\n1. Go to the Members page from the bottom navigation.\n2. Tap the "+ Add Member" button at the top.\n3. Fill in the name, phone number, and email.\n4. Select a plan and set the start date.\n5. Click Save.\n\nIf the phone number is already used by another member, you will see an error. Each member needs a unique phone number.',
            actions: ['Open Members page'],
        },
        {
            check: ['reset password', 'staff password', 'forgot password', 'change password'],
            category: 'ACCOUNT',
            priority: 'MEDIUM',
            subject: 'Staff password reset help',
            answer: 'To reset a staff password:\n1. Go to Settings → Staff & Roles tab.\n2. Find the staff member in the list.\n3. Click the Edit button next to their name.\n4. Enter a new password (minimum 8 characters).\n5. Click Save.\n\nThe staff member can then log in with their email and the new password.',
            actions: ['Open Settings → Staff & Roles'],
        },
        {
            check: ['billing', 'invoice', 'subscription', 'my plan', 'upgrade', 'downgrade'],
            category: 'BILLING',
            priority: 'MEDIUM',
            subject: 'Billing or subscription help',
            answer: 'To manage your billing:\n1. Go to Settings → Billing & Subscriptions.\n2. You can see your current plan, validity, and payment history.\n3. To download an invoice, find the payment in the history and tap Download.\n4. To change your plan, tap Upgrade or Change Plan.\n\nIf you have a billing dispute, raise a support ticket with the payment date and amount.',
            actions: ['Open Billing settings'],
        },
        {
            check: ['attendance', 'check in', 'check-in', 'checkin', 'qr', 'scan'],
            category: 'TECHNICAL',
            priority: 'HIGH',
            subject: 'Attendance check-in help',
            answer: 'To check in a member:\n1. Go to the Attendance page → Check-In tab.\n2. Search for the member by name or phone.\n3. Select the member and tap Check In.\n\nIf check-in fails:\n• Make sure the member has an active plan.\n• Check that the attendance mode is set correctly in Settings.\n• If using QR, ensure the camera has permission.\n\nFor RFID check-in, the member must have a paired RFID tag.',
            actions: ['Open Attendance page', 'Verify attendance settings'],
        },
        {
            check: ['member deleted', 'recover member', 'restore member', 'deleted member', 'get member back'],
            category: 'DATA',
            priority: 'HIGH',
            subject: 'Recover deleted member',
            answer: 'Deleted members are soft-deleted and can be recovered.\n\nTo recover a member:\n1. Go to Members page.\n2. Scroll to the bottom or filter for deleted members.\n3. If you cannot find the option, raise a support ticket with:\n   - Member name\n   - Phone number\n   - Approximate time of deletion\n\nOur team will restore the member safely.',
            actions: ['Raise recovery ticket'],
        },
        {
            check: ['payment', 'collect payment', 'payment link', 'razorpay', 'online payment'],
            category: 'BILLING',
            priority: 'MEDIUM',
            subject: 'Payment collection help',
            answer: 'To collect a payment:\n1. Go to the Payments page.\n2. Tap "+ New Payment" or click on a member.\n3. Select the plan, amount, and payment method.\n4. Click Record Payment.\n\nFor online payments:\n1. Go to Settings → Integrations → Payments.\n2. Connect your Razorpay account using your Account ID.\n3. Once connected, you can send payment links to members via WhatsApp.',
            actions: ['Open Payments page', 'Open Settings → Integrations'],
        },
        {
            check: ['whatsapp', 'message', 'broadcast', 'reminder', 'send message'],
            category: 'TECHNICAL',
            priority: 'MEDIUM',
            subject: 'WhatsApp messaging help',
            answer: 'To send WhatsApp messages:\n1. Go to Settings → Integrations → Messaging.\n2. Connect your MSG91 account with API key and Hello number.\n3. Once connected, you can:\n   - Send reminders from member profiles\n   - Send broadcasts from the Members page\n   - Auto-reminders for expiring/expired members run daily\n\nIf a message shows "Failed", check:\n• The member has a valid WhatsApp number.\n• Your MSG91 account has sufficient balance.\n• The template is approved by Meta.',
            actions: ['Open Settings → Integrations → Messaging'],
        },
        {
            check: ['plan', 'create plan', 'add plan', 'edit plan', 'pricing'],
            category: 'GENERAL',
            priority: 'MEDIUM',
            subject: 'Plan management help',
            answer: 'To create or edit plans:\n1. Go to the Plans page from the bottom navigation.\n2. Tap "+ New Plan" to create a plan.\n3. Set the name, duration, price, and any discounts.\n4. Click Save.\n\nTo edit an existing plan, tap the edit icon on the plan card.\n\nTips:\n• Having 2-3 plans gives members choice.\n• Add a premium plan with extra perks for higher revenue.\n• Enable discounts for special offers.',
            actions: ['Open Plans page'],
        },
        {
            check: ['lead', 'enquiry', 'enquiries', 'follow up', 'convert lead'],
            category: 'GENERAL',
            priority: 'MEDIUM',
            subject: 'Lead management help',
            answer: 'To manage leads:\n1. Go to the Leads page from More menu.\n2. Tap "+ Add Lead" to add a new enquiry.\n3. Fill in name, phone, source, and priority.\n4. Set a follow-up date.\n\nTo follow up:\n• Tap Call to phone them directly.\n• Tap Chat to send a WhatsApp message.\n• When they join, tap Convert to create their member profile.\n\nTips:\n• Reply to leads within 5 minutes for best conversion.\n• Set follow-up reminders so no lead is forgotten.',
            actions: ['Open Leads page'],
        },
        {
            check: ['class', 'classes', 'schedule', 'batch', 'trainer'],
            category: 'GENERAL',
            priority: 'MEDIUM',
            subject: 'Class scheduling help',
            answer: 'To manage classes:\n1. Go to the Classes page from More menu.\n2. Create class types (e.g., Yoga, CrossFit, Zumba).\n3. Add sessions with time, trainer, and capacity.\n4. Members can be enrolled into sessions.\n\nTips:\n• Set capacity limits to avoid overcrowding.\n• Assign trainers to each session for accountability.\n• Use different class types to offer variety.',
            actions: ['Open Classes page'],
        },
        {
            check: ['report', 'insights', 'analytics', 'revenue', 'dashboard'],
            category: 'GENERAL',
            priority: 'LOW',
            subject: 'Reports and analytics help',
            answer: 'To view your gym analytics:\n1. Go to the Insights page from More menu.\n2. Choose a time range (1M, 3M, 6M, 1Y).\n3. View:\n   - Revenue per member and trends\n   - Member retention rate\n   - Renewals due and money at risk\n   - Attendance heatmap and peak hours\n\nThe Dashboard page also shows daily smart tips and action items to help you grow your gym.',
            actions: ['Open Insights page'],
        },
        {
            check: ['staff', 'add staff', 'trainer', 'employee', 'role', 'permission'],
            category: 'ACCOUNT',
            priority: 'MEDIUM',
            subject: 'Staff management help',
            answer: 'To add staff:\n1. Go to Settings → Staff & Roles.\n2. Fill in name, email, and password.\n3. Select a role (Trainer, Manager, Front Desk).\n4. Assign a branch if you have multiple branches.\n5. Click Add Staff.\n\nRoles control what each staff member can see and do:\n• Manager: Full access except billing settings.\n• Trainer: View members and mark attendance.\n• Front Desk: Check-in, view members, and manage leads.',
            actions: ['Open Settings → Staff & Roles'],
        },
        {
            check: ['branch', 'multi branch', 'multiple branch', 'location'],
            category: 'GENERAL',
            priority: 'MEDIUM',
            subject: 'Multi-branch setup help',
            answer: 'To set up multiple branches:\n1. Go to Settings → Branches.\n2. Tap Add Branch and enter the branch name and address.\n3. Assign staff members to each branch.\n\nOnce branches are set:\n• Use the branch selector in the header to switch between branches.\n• Each branch has its own members, attendance, and reports.\n• The Insights → Franchise tab shows combined analytics.',
            actions: ['Open Settings → Branches'],
        },
        {
            check: ['waiver', 'sign waiver', 'liability', 'terms'],
            category: 'GENERAL',
            priority: 'LOW',
            subject: 'Waiver signing help',
            answer: 'To sign a waiver for a member:\n1. Go to Members page and tap on a member.\n2. Go to the Waivers tab in the member profile.\n3. Tap "Sign Standard Waiver".\n4. The member reviews the terms and provides their signature.\n5. The signed waiver is stored in their profile.\n\nWaivers protect your gym from liability. It is recommended to have every member sign one.',
            actions: ['Open Members page'],
        },
    ];

    const matched = intents.find((intent) => intent.check.some((keyword) => lower.includes(keyword)));

    if (!matched) {
        return res.json({
            answer: 'I can help you with:\n• Adding members and managing profiles\n• Payment collection and billing\n• WhatsApp messaging and broadcasts\n• Attendance and check-in setup\n• Plans and pricing\n• Lead management and follow-ups\n• Staff roles and permissions\n• Class scheduling\n• Reports and analytics\n• Branch management\n• Waivers\n\nTell me what you need help with, or tap a quick issue above.',
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
