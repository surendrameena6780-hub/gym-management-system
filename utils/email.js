const nodemailer = require('nodemailer');

const toTrimmedString = (value) => String(value || '').trim();

const toBoolean = (value, fallback = false) => {
    const normalized = toTrimmedString(value).toLowerCase();
    if (!normalized) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const toPortNumber = (value, fallback = 587) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getSmtpConfig = () => ({
    host: toTrimmedString(process.env.SMTP_HOST),
    port: toPortNumber(process.env.SMTP_PORT, 587),
    secure: toBoolean(process.env.SMTP_SECURE, false),
    user: toTrimmedString(process.env.SMTP_USER),
    pass: toTrimmedString(process.env.SMTP_PASS),
    fromName: toTrimmedString(process.env.SMTP_FROM_NAME || 'GymVault'),
    fromEmail: toTrimmedString(process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER),
});

const isEmailTransportConfigured = () => {
    const config = getSmtpConfig();
    return Boolean(config.host && config.user && config.pass && config.fromEmail);
};

let cachedTransporter = null;
let cachedTransportKey = '';

const getTransporter = () => {
    if (!isEmailTransportConfigured()) {
        throw new Error('SMTP email delivery is not configured.');
    }

    const config = getSmtpConfig();
    const transportKey = JSON.stringify({
        host: config.host,
        port: config.port,
        secure: config.secure,
        user: config.user,
        pass: config.pass,
    });

    if (!cachedTransporter || cachedTransportKey !== transportKey) {
        cachedTransporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: {
                user: config.user,
                pass: config.pass,
            },
        });
        cachedTransportKey = transportKey;
    }

    return cachedTransporter;
};

const sendTransactionalEmail = async ({ to, subject, text, html }) => {
    const transporter = getTransporter();
    const config = getSmtpConfig();

    return transporter.sendMail({
        from: {
            name: config.fromName || 'GymVault',
            address: config.fromEmail,
        },
        to,
        subject,
        text,
        html,
    });
};

module.exports = {
    isEmailTransportConfigured,
    sendTransactionalEmail,
};