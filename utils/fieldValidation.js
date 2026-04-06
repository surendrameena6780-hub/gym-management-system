class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 400;
    }
}

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

const applyStringCasing = (value, { lowercase = false, uppercase = false } = {}) => {
    if (lowercase) return value.toLowerCase();
    if (uppercase) return value.toUpperCase();
    return value;
};

const ensureTrimmedString = (value, {
    field = 'field',
    required = false,
    min = 0,
    max = 120,
    defaultValue = '',
    lowercase = false,
    uppercase = false,
} = {}) => {
    if (isBlank(value)) {
        if (required) {
            throw new ValidationError(`${field} is required.`);
        }

        return applyStringCasing(String(defaultValue || '').trim(), { lowercase, uppercase });
    }

    const normalized = String(value).trim();

    if (normalized.length < min) {
        throw new ValidationError(`${field} must be at least ${min} characters.`);
    }

    if (normalized.length > max) {
        throw new ValidationError(`${field} must be ${max} characters or fewer.`);
    }

    return applyStringCasing(normalized, { lowercase, uppercase });
};

const ensureEmail = (value, {
    field = 'email',
    required = false,
    max = 120,
} = {}) => {
    const normalized = ensureTrimmedString(value, {
        field,
        required,
        min: required ? 5 : 0,
        max,
        lowercase: true,
    });

    if (!normalized) {
        return '';
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw new ValidationError(`${field} is invalid.`);
    }

    return normalized;
};

const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');

const ensurePhone10 = (value, {
    field = 'phone',
    required = false,
} = {}) => {
    const normalized = normalizeDigits(value);

    if (!normalized) {
        if (required) {
            throw new ValidationError(`${field} is required.`);
        }
        return '';
    }

    if (!/^\d{10}$/.test(normalized)) {
        throw new ValidationError(`${field} must be exactly 10 digits.`);
    }

    return normalized;
};

const ensureInteger = (value, {
    field = 'value',
    required = false,
    min = null,
    max = null,
    defaultValue = null,
} = {}) => {
    if (value === '' || value === undefined || value === null) {
        if (required) {
            throw new ValidationError(`${field} is required.`);
        }
        return defaultValue;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) {
        throw new ValidationError(`${field} must be a whole number.`);
    }

    if (min !== null && parsed < min) {
        throw new ValidationError(`${field} must be at least ${min}.`);
    }

    if (max !== null && parsed > max) {
        throw new ValidationError(`${field} must be ${max} or less.`);
    }

    return parsed;
};

const ensureNumber = (value, {
    field = 'value',
    required = false,
    min = null,
    max = null,
    defaultValue = null,
} = {}) => {
    if (value === '' || value === undefined || value === null) {
        if (required) {
            throw new ValidationError(`${field} is required.`);
        }
        return defaultValue;
    }

    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        throw new ValidationError(`${field} must be a valid number.`);
    }

    if (min !== null && parsed < min) {
        throw new ValidationError(`${field} must be at least ${min}.`);
    }

    if (max !== null && parsed > max) {
        throw new ValidationError(`${field} must be ${max} or less.`);
    }

    return parsed;
};

const ensureStringArray = (value, {
    field = 'value',
    maxItems = 50,
    itemMax = 120,
} = {}) => {
    if (value === undefined || value === null || value === '') {
        return [];
    }

    if (!Array.isArray(value)) {
        throw new ValidationError(`${field} must be an array.`);
    }

    if (value.length > maxItems) {
        throw new ValidationError(`${field} must contain ${maxItems} items or fewer.`);
    }

    return value
        .map((item, index) => ensureTrimmedString(item, {
            field: `${field}[${index}]`,
            max: itemMax,
        }))
        .filter(Boolean);
};

const ensureObject = (value, {
    field = 'value',
    defaultValue = {},
} = {}) => {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new ValidationError(`${field} must be an object.`);
    }

    return value;
};

const ensureTimestamp = (value, {
    field = 'value',
    required = false,
    defaultValue = null,
    allowPast = true,
    allowFuture = true,
} = {}) => {
    if (isBlank(value)) {
        if (required) {
            throw new ValidationError(`${field} is required.`);
        }
        return defaultValue;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new ValidationError(`${field} must be a valid date/time.`);
    }

    const now = Date.now();
    if (!allowPast && parsed.getTime() < now) {
        throw new ValidationError(`${field} cannot be in the past.`);
    }

    if (!allowFuture && parsed.getTime() > now) {
        throw new ValidationError(`${field} cannot be in the future.`);
    }

    return parsed.toISOString();
};

const ensureDateOnly = (value, {
    field = 'value',
    required = false,
    defaultValue = null,
    allowPast = true,
    allowFuture = true,
} = {}) => {
    if (isBlank(value)) {
        if (required) {
            throw new ValidationError(`${field} is required.`);
        }
        return defaultValue;
    }

    const raw = String(value).trim();
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        throw new ValidationError(`${field} must be a valid date.`);
    }

    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? raw
        : parsed.toISOString().slice(0, 10);

    const dateOnly = new Date(`${normalized}T00:00:00.000Z`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    if (!allowPast && dateOnly < today) {
        throw new ValidationError(`${field} cannot be in the past.`);
    }

    if (!allowFuture && dateOnly > today) {
        throw new ValidationError(`${field} cannot be in the future.`);
    }

    return normalized;
};

const ensureChoice = (value, {
    field = 'value',
    choices = [],
    required = false,
    defaultValue = '',
    lowercase = false,
    uppercase = false,
} = {}) => {
    const normalized = ensureTrimmedString(value, {
        field,
        required,
        max: 120,
        defaultValue,
        lowercase,
        uppercase,
    });

    if (!normalized) {
        return normalized;
    }

    if (!choices.includes(normalized)) {
        throw new ValidationError(`${field} is invalid.`);
    }

    return normalized;
};

const ensureUrl = (value, {
    field = 'url',
    required = false,
    max = 2048,
    defaultValue = '',
    protocols = ['http:', 'https:'],
} = {}) => {
    const normalized = ensureTrimmedString(value, {
        field,
        required,
        max,
        defaultValue,
    });

    if (!normalized) {
        return normalized;
    }

    try {
        const parsed = new URL(normalized);
        if (!protocols.includes(parsed.protocol.toLowerCase())) {
            throw new ValidationError(`${field} is invalid.`);
        }
        return parsed.toString();
    } catch (_err) {
        throw new ValidationError(`${field} is invalid.`);
    }
};

const isValidationError = (error) => error instanceof ValidationError;

module.exports = {
    ValidationError,
    ensureTrimmedString,
    ensureEmail,
    ensurePhone10,
    ensureInteger,
    ensureNumber,
    ensureStringArray,
    ensureObject,
    ensureTimestamp,
    ensureDateOnly,
    ensureChoice,
    ensureUrl,
    isValidationError,
    normalizeDigits,
};