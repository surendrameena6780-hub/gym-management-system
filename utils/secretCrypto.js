const crypto = require('crypto');

const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = Math.max(120000, Number.parseInt(process.env.APP_SECRET_ENC_PBKDF2_ITERATIONS || '210000', 10) || 210000);
const PBKDF2_DIGEST = 'sha512';
const FORMAT_PREFIX = 'v2';

const getBaseSecret = () => {
    const secret = process.env.APP_SECRET_ENC_KEY || process.env.JWT_SECRET || '';
    if (!secret) {
        throw new Error('APP_SECRET_ENC_KEY (or JWT_SECRET fallback) is required for secret encryption.');
    }
    return secret;
};

const deriveKey = (salt) => {
    return crypto.pbkdf2Sync(getBaseSecret(), salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
};

const deriveLegacyKey = () => {
    return crypto.createHash('sha256').update(getBaseSecret()).digest();
};

const encryptSecret = (plainText) => {
    const value = String(plainText || '').trim();
    if (!value) return '';

    const salt = crypto.randomBytes(16);
    const key = deriveKey(salt);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${FORMAT_PREFIX}:${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

const decryptSecret = (encodedValue) => {
    const raw = String(encodedValue || '').trim();
    if (!raw) return '';

    try {
        if (raw.startsWith(`${FORMAT_PREFIX}:`)) {
            const [, saltHex, ivHex, tagHex, encryptedHex] = raw.split(':');
            if (!saltHex || !ivHex || !tagHex || !encryptedHex) return '';

            const key = deriveKey(Buffer.from(saltHex, 'hex'));
            const iv = Buffer.from(ivHex, 'hex');
            const tag = Buffer.from(tagHex, 'hex');
            const encrypted = Buffer.from(encryptedHex, 'hex');

            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);

            return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
        }

        const [ivHex, tagHex, encryptedHex] = raw.split(':');
        if (!ivHex || !tagHex || !encryptedHex) return '';

        const key = deriveLegacyKey();
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const encrypted = Buffer.from(encryptedHex, 'hex');

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);

        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch (_err) {
        return '';
    }
};

module.exports = {
    encryptSecret,
    decryptSecret,
};
