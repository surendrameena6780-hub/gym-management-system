const { pool } = require('../config/db');
const { isEmailTransportConfigured, sendTransactionalEmail } = require('./email');

const stripTrailingSlash = (value, fallback = '') => String(value || fallback || '').trim().replace(/\/+$/, '');

const getFrontendUrl = () => stripTrailingSlash(process.env.FRONTEND_URL, 'http://localhost:5173');

const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDateLabel = (value) => {
    if (!value) return '';
    const rawValue = typeof value === 'string' && !value.includes('T') ? `${value}T00:00:00` : value;
    const date = new Date(rawValue);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatPhoneNumber = (value) => {
    const digits = String(value || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) return String(value || '').trim();
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
};

const getFirstName = (value) => String(value || '').trim().split(/\s+/)[0] || 'there';

const buildMembershipSummary = ({ membershipStatus, planName, membershipEndDate }) => {
    const status = String(membershipStatus || '').trim().toUpperCase() || 'UNPAID';
    const safePlanName = String(planName || '').trim();
    const endLabel = formatDateLabel(membershipEndDate);

    if (status === 'ACTIVE') {
        if (safePlanName && endLabel) {
            return `Your ${safePlanName} plan is active until ${endLabel}.`;
        }
        if (safePlanName) {
            return `Your ${safePlanName} plan is active.`;
        }
        return endLabel ? `Your membership is active until ${endLabel}.` : 'Your membership is active.';
    }

    if (status === 'EXPIRED') {
        return endLabel
            ? `Your previous membership expired on ${endLabel}. Open the member portal if you want to renew it quickly.`
            : 'Your previous membership has expired. Open the member portal if you want to renew it quickly.';
    }

    if (status === 'FROZEN') {
        return 'Your membership is currently frozen. Open the member portal or speak to your gym if you need help.';
    }

    return 'Your member profile is ready. If your plan is not active yet, your gym team can activate it after payment.';
};

const loadGymName = async (gymId) => {
    const normalizedGymId = Number.parseInt(gymId, 10);
    if (!Number.isInteger(normalizedGymId) || normalizedGymId <= 0) return 'your gym';

    try {
        const result = await pool.query('SELECT name FROM gyms WHERE id = $1 LIMIT 1', [normalizedGymId]);
        return String(result.rows[0]?.name || '').trim() || 'your gym';
    } catch (_err) {
        return 'your gym';
    }
};

const sendMemberWelcomeEmail = async ({
    gymId,
    gymName = '',
    memberEmail,
    memberName,
    memberPhone,
    membershipStatus = 'UNPAID',
    membershipEndDate = null,
    planName = '',
}) => {
    const email = String(memberEmail || '').trim().toLowerCase();
    if (!email || !isEmailTransportConfigured()) {
        return { sent: false, skipped: true };
    }

    const resolvedGymName = String(gymName || '').trim() || await loadGymName(gymId);
    const firstName = getFirstName(memberName);
    const loginUrl = `${getFrontendUrl()}/login`;
    const formattedPhone = formatPhoneNumber(memberPhone);
    const membershipSummary = buildMembershipSummary({ membershipStatus, planName, membershipEndDate });
    const safeGymName = escapeHtml(resolvedGymName);
    const safeFirstName = escapeHtml(firstName);
    const safeMemberPhone = escapeHtml(formattedPhone || String(memberPhone || '').trim());
    const safeLoginUrl = escapeHtml(loginUrl);
    const safeMembershipSummary = escapeHtml(membershipSummary);
    const safePlanName = escapeHtml(String(planName || '').trim());

    await sendTransactionalEmail({
        to: email,
        subject: `Welcome to ${resolvedGymName} on GymVault`,
        text: [
            `Hi ${firstName},`,
            '',
            `Welcome to ${resolvedGymName} on GymVault.`,
            membershipSummary,
            '',
            `Open your member portal: ${loginUrl}`,
            '',
            'How to sign in:',
            '1. Open the link above.',
            '2. Tap Gym Member.',
            `3. Enter your phone number: ${formattedPhone || memberPhone || ''}`,
            `4. If asked, choose ${resolvedGymName}.`,
            '5. Enter the 6-digit login code sent to this email.',
            '',
            'Add the app to your home screen:',
            'Android: open the link in Chrome and tap Install App or Add to Home Screen.',
            'iPhone: open the link in Safari, tap Share, then Add to Home Screen.',
            '',
            'Inside the member portal you can:',
            '- Check your membership status',
            '- View attendance and activity',
            '- Open your member QR',
            '- See payments and classes',
            '',
            'If you need help, contact your gym team.',
        ].join('\n'),
        html: `
            <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
                <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:22px;padding:32px;">
                    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#6366f1;">GymVault</p>
                    <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;">Welcome to ${safeGymName}</h1>
                    <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#475569;">Hi ${safeFirstName}, your member portal is ready.</p>
                    <div style="margin:0 0 20px;padding:18px;border-radius:18px;background:#eef2ff;border:1px solid #c7d2fe;">
                        <p style="margin:0;font-size:13px;line-height:1.7;color:#312e81;">${safeMembershipSummary}</p>
                        ${safePlanName ? `<p style="margin:10px 0 0;font-size:12px;font-weight:700;color:#4338ca;">Plan: ${safePlanName}</p>` : ''}
                    </div>
                    <div style="margin:0 0 20px;padding:18px;border-radius:18px;background:#0f172a;color:#ffffff;">
                        <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;">Member portal</p>
                        <a href="${safeLoginUrl}" style="display:inline-block;padding:12px 18px;border-radius:14px;background:#6366f1;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Open GymVault</a>
                        <p style="margin:12px 0 0;font-size:13px;line-height:1.7;color:#cbd5e1;">Phone number: ${safeMemberPhone || 'Use your registered phone number'}<br/>Tap <strong>Gym Member</strong> on the login screen and enter the 6-digit code sent to this email.</p>
                    </div>
                    <div style="margin:0 0 20px;">
                        <h2 style="margin:0 0 10px;font-size:16px;color:#0f172a;">Add the app to your home screen</h2>
                        <div style="display:grid;grid-template-columns:1fr;gap:10px;">
                            <div style="padding:14px 16px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;">
                                <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:#64748b;">Android</p>
                                <p style="margin:0;font-size:13px;line-height:1.7;color:#334155;">Open GymVault in Chrome, then tap <strong>Install App</strong> or <strong>Add to Home Screen</strong>.</p>
                            </div>
                            <div style="padding:14px 16px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;">
                                <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:#64748b;">iPhone</p>
                                <p style="margin:0;font-size:13px;line-height:1.7;color:#334155;">Open GymVault in Safari, tap <strong>Share</strong>, then tap <strong>Add to Home Screen</strong>.</p>
                            </div>
                        </div>
                    </div>
                    <div style="padding:18px;border-radius:18px;background:#f8fafc;border:1px solid #e2e8f0;">
                        <p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:#64748b;">Inside the app</p>
                        <ul style="margin:0;padding-left:18px;color:#334155;font-size:13px;line-height:1.8;">
                            <li>Check your membership status</li>
                            <li>View attendance and activity</li>
                            <li>Open your member QR</li>
                            <li>See payments and classes</li>
                        </ul>
                    </div>
                    <p style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#64748b;">If you need help, contact your gym team. We’re ready when you are.</p>
                </div>
            </div>
        `,
    });

    return { sent: true, skipped: false };
};

module.exports = {
    sendMemberWelcomeEmail,
};