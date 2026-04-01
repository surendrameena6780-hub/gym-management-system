const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PROFILE_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'profiles');
const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
const allowedImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/jpg', 'image/webp']);
const allowedProfileImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const normalizeIdSegment = (value, fallback = 'unknown') => {
    const normalized = String(value ?? fallback).trim().replace(/[^a-zA-Z0-9_-]/g, '');
    return normalized || fallback;
};

const detectImageExtension = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
        return null;
    }

    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return '.jpg';
    }

    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return '.png';
    }

    if (
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
        return '.webp';
    }

    return null;
};

const expectedExtensionForMimeType = (mimeType) => {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized === 'image/png') return '.png';
    if (normalized === 'image/webp') return '.webp';
    if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg';
    return null;
};

const contentTypeForImageExtension = (extension) => {
    const normalized = String(extension || '').toLowerCase();
    if (normalized === '.png') return 'image/png';
    if (normalized === '.webp') return 'image/webp';
    return 'image/jpeg';
};

const buildStoredFilename = ({ prefix, gymId, actorId, extension }) => {
    return `${normalizeIdSegment(prefix, 'profile')}-${normalizeIdSegment(gymId)}-${normalizeIdSegment(actorId, 'anon')}-${crypto.randomBytes(12).toString('hex')}${extension}`;
};

const baseUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PROFILE_IMAGE_BYTES },
    fileFilter: (_req, file, cb) => {
        if (!allowedImageMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
            return cb(new Error('Only JPG, JPEG, PNG, and WEBP files are allowed'));
        }
        return cb(null, true);
    },
});

const respondToUploadError = (res, err) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Image too large. Max size is 2MB.' });
        }
        return res.status(400).json({ error: err.message || 'Invalid image upload.' });
    }

    const message = String(err?.message || '');
    if (message.includes('Only JPG') || message.includes('Unexpected end of form') || message.includes('Multipart')) {
        return res.status(400).json({ error: 'Invalid image upload payload. Please reselect image and try again.' });
    }

    return res.status(500).json({ error: 'Image upload failed.' });
};

const createProfileUploadMiddleware = ({ prefix = 'profile', getActorId, storageMode = 'disk' } = {}) => {
    return (req, res, next) => {
        baseUpload.single('profile_pic')(req, res, async (err) => {
            if (err) {
                return respondToUploadError(res, err);
            }

            if (!req.file) {
                return next();
            }

            try {
                const detectedExtension = detectImageExtension(req.file.buffer);
                const expectedExtension = expectedExtensionForMimeType(req.file.mimetype);

                if (!detectedExtension || (expectedExtension && expectedExtension !== detectedExtension)) {
                    return res.status(400).json({ error: 'Uploaded file content does not match a supported image type.' });
                }

                await fs.promises.mkdir(PROFILE_UPLOAD_DIR, { recursive: true });

                const gymId = req?.user?.gym_id ?? req?.user?.gymId ?? 'unknown';
                const actorId = typeof getActorId === 'function'
                    ? getActorId(req)
                    : req?.user?.id ?? 'anon';
                const filename = buildStoredFilename({
                    prefix,
                    gymId,
                    actorId,
                    extension: detectedExtension,
                });

                req.file.filename = filename;
                req.file.storageMode = storageMode;

                if (storageMode === 'inline') {
                    req.file.inlineDataUrl = `data:${contentTypeForImageExtension(detectedExtension)};base64,${req.file.buffer.toString('base64')}`;
                    req.file.path = '';
                    req.file.destination = '';
                    return next();
                }

                const destination = path.join(PROFILE_UPLOAD_DIR, filename);

                await fs.promises.writeFile(destination, req.file.buffer, { flag: 'wx' });

                req.file.path = destination;
                req.file.destination = PROFILE_UPLOAD_DIR;

                return next();
            } catch (writeErr) {
                console.error('PROFILE UPLOAD WRITE ERROR:', writeErr.message);
                return res.status(500).json({ error: 'Image upload failed.' });
            }
        });
    };
};

const cleanupUploadedFile = async (fileOrPath) => {
    const filePath = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath?.path;
    if (!filePath) {
        return;
    }

    try {
        await fs.promises.unlink(filePath);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error('PROFILE UPLOAD CLEANUP ERROR:', err.message);
        }
    }
};

const resolveStoredProfileImagePath = (value) => {
    const raw = String(value || '').trim();
    if (!raw) {
        return null;
    }

    if (/^(https?:|data:|blob:)/i.test(raw)) {
        return null;
    }

    const normalized = raw.replace(/\\/g, '/');
    const isKnownProfilePath =
        normalized.startsWith('/uploads/profiles/') ||
        normalized.startsWith('uploads/profiles/') ||
        !normalized.includes('/');

    if (!isKnownProfilePath) {
        return null;
    }

    const fileName = path.basename(normalized);
    if (!fileName || fileName === '.' || fileName.includes('\0')) {
        return null;
    }

    return path.join(PROFILE_UPLOAD_DIR, fileName);
};

module.exports = {
    PROFILE_UPLOAD_DIR,
    MAX_PROFILE_IMAGE_BYTES,
    allowedProfileImageExtensions,
    createProfileUploadMiddleware,
    cleanupUploadedFile,
    resolveStoredProfileImagePath,
};