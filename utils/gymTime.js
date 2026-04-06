const DEFAULT_GYM_TIMEZONE = 'Asia/Kolkata';
const GYM_TIMEZONE_CACHE_TTL_MS = 5 * 60 * 1000;

let ensureTimezoneAwareTimestampsPromise;
const gymTimezoneCache = new Map();

const TARGET_COLUMNS = [
    { table: 'attendance', column: 'check_in_time' },
    { table: 'members', column: 'last_visit' },
    { table: 'payments', column: 'payment_date' },
];

const ensureTimezoneAwareTimestamps = async (pool) => {
    if (!ensureTimezoneAwareTimestampsPromise) {
        ensureTimezoneAwareTimestampsPromise = (async () => {
            const result = await pool.query(
                `SELECT table_name, column_name, data_type
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND (
                        (table_name = 'attendance' AND column_name = 'check_in_time')
                     OR (table_name = 'members' AND column_name = 'last_visit')
                     OR (table_name = 'payments' AND column_name = 'payment_date')
                   )`
            );

            const typeMap = new Map(
                result.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type])
            );

            for (const target of TARGET_COLUMNS) {
                const key = `${target.table}.${target.column}`;
                const dataType = typeMap.get(key);
                if (!dataType || dataType === 'timestamp with time zone') {
                    continue;
                }

                await pool.query(
                    `ALTER TABLE ${target.table}
                     ALTER COLUMN ${target.column}
                     TYPE TIMESTAMPTZ
                     USING ${target.column} AT TIME ZONE current_setting('TIMEZONE')`
                );
            }
        })();
    }

    await ensureTimezoneAwareTimestampsPromise;
};

const getCachedGymTimezone = (gymId) => {
    const cached = gymTimezoneCache.get(gymId);
    if (!cached) {
        return null;
    }

    if (cached.expiresAt <= Date.now()) {
        gymTimezoneCache.delete(gymId);
        return null;
    }

    return cached.timezone;
};

const setCachedGymTimezone = (gymId, timezone) => {
    if (!Number.isInteger(gymId)) {
        return timezone;
    }

    gymTimezoneCache.set(gymId, {
        timezone,
        expiresAt: Date.now() + GYM_TIMEZONE_CACHE_TTL_MS,
    });
    return timezone;
};

const invalidateGymTimezoneCache = (gymId) => {
    const normalizedGymId = Number.parseInt(gymId, 10);
    if (Number.isInteger(normalizedGymId)) {
        gymTimezoneCache.delete(normalizedGymId);
        return;
    }

    gymTimezoneCache.clear();
};

const getGymTimezone = async (pool, gymId) => {
    await ensureTimezoneAwareTimestamps(pool);

    const normalizedGymId = Number.parseInt(gymId, 10);
    if (Number.isInteger(normalizedGymId)) {
        const cachedTimezone = getCachedGymTimezone(normalizedGymId);
        if (cachedTimezone) {
            return cachedTimezone;
        }
    }

    const result = await pool.query(
        `SELECT COALESCE(NULLIF(timezone, ''), $2) AS timezone
         FROM gyms
         WHERE id = $1
         LIMIT 1`,
        [gymId, DEFAULT_GYM_TIMEZONE]
    ).catch(() => ({ rows: [] }));

    return setCachedGymTimezone(normalizedGymId, result.rows[0]?.timezone || DEFAULT_GYM_TIMEZONE);
};

module.exports = {
    DEFAULT_GYM_TIMEZONE,
    ensureTimezoneAwareTimestamps,
    getGymTimezone,
    invalidateGymTimezoneCache,
};