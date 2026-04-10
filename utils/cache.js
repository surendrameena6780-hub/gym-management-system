/**
 * Caching utility with Redis (preferred) and in-memory fallback.
 *
 * Environment variables:
 *   REDIS_URL          — Redis connection string (e.g. redis://localhost:6379).
 *                        When absent, a process-local Map cache is used.
 *   CACHE_DISABLED     — Set to 'true' to disable all caching.
 *   CACHE_DEFAULT_TTL  — Default TTL in seconds (default: 30).
 */

const CACHE_DISABLED = String(process.env.CACHE_DISABLED || '').toLowerCase() === 'true';
const DEFAULT_TTL = Math.max(1, Number.parseInt(process.env.CACHE_DEFAULT_TTL || '30', 10) || 30);

// ---------------------------------------------------------------------------
// In-memory fallback cache
// ---------------------------------------------------------------------------
const memoryStore = new Map();
const MEMORY_MAX_ENTRIES = 5000;

const memoryCacheGet = (key) => {
    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        memoryStore.delete(key);
        return null;
    }
    return entry.value;
};

const memoryCacheSet = (key, value, ttlSeconds) => {
    memoryStore.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
    });

    // Evict oldest entries when over capacity
    if (memoryStore.size > MEMORY_MAX_ENTRIES) {
        const firstKey = memoryStore.keys().next().value;
        if (firstKey !== undefined) memoryStore.delete(firstKey);
    }
};

const memoryCacheDelete = (pattern) => {
    const prefix = pattern.replace(/\*$/, '');
    for (const key of memoryStore.keys()) {
        if (key.startsWith(prefix)) {
            memoryStore.delete(key);
        }
    }
};

// ---------------------------------------------------------------------------
// Redis client (lazy initialisation)
// ---------------------------------------------------------------------------
let redis = null;
let redisReady = false;
let redisInitAttempted = false;

const initRedis = () => {
    if (redisInitAttempted) return;
    redisInitAttempted = true;

    const url = process.env.REDIS_URL;
    if (!url) return;

    try {
        const Redis = require('ioredis');
        redis = new Redis(url, {
            maxRetriesPerRequest: 1,
            enableReadyCheck: true,
            lazyConnect: true,
            connectTimeout: 5000,
            retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
        });

        redis.on('ready', () => {
            redisReady = true;
            console.log('✅ Redis cache connected');
        });
        redis.on('error', () => {
            redisReady = false;
        });
        redis.on('close', () => {
            redisReady = false;
        });

        redis.connect().catch(() => {
            redisReady = false;
        });
    } catch (_err) {
        redis = null;
        redisReady = false;
    }
};

initRedis();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const cacheGet = async (key) => {
    if (CACHE_DISABLED) return null;

    if (redis && redisReady) {
        try {
            const raw = await redis.get(key);
            return raw ? JSON.parse(raw) : null;
        } catch (_err) {
            // Fall through to memory cache
        }
    }

    return memoryCacheGet(key);
};

const cacheSet = async (key, value, ttlSeconds = DEFAULT_TTL) => {
    if (CACHE_DISABLED) return;

    if (redis && redisReady) {
        try {
            await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
            return;
        } catch (_err) {
            // Fall through to memory cache
        }
    }

    memoryCacheSet(key, value, ttlSeconds);
};

const cacheDelete = async (pattern) => {
    if (CACHE_DISABLED) return;

    if (redis && redisReady) {
        try {
            const keys = await redis.keys(pattern);
            if (keys.length > 0) await redis.del(...keys);
        } catch (_err) {
            // ignore
        }
    }

    memoryCacheDelete(pattern);
};

const buildCacheKey = (...parts) => parts.filter((p) => p != null).join(':');

const disconnectCache = async () => {
    if (redis) {
        try {
            await redis.quit();
        } catch (_err) {
            // ignore
        }
    }
    memoryStore.clear();
};

module.exports = { cacheGet, cacheSet, cacheDelete, buildCacheKey, disconnectCache };
