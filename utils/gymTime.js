const DEFAULT_GYM_TIMEZONE = 'Asia/Kolkata';

let ensureTimezoneAwareTimestampsPromise;

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

const getGymTimezone = async (pool, gymId) => {
    await ensureTimezoneAwareTimestamps(pool);

    const result = await pool.query(
        `SELECT COALESCE(NULLIF(timezone, ''), $2) AS timezone
         FROM gyms
         WHERE id = $1
         LIMIT 1`,
        [gymId, DEFAULT_GYM_TIMEZONE]
    ).catch(() => ({ rows: [] }));

    return result.rows[0]?.timezone || DEFAULT_GYM_TIMEZONE;
};

module.exports = {
    DEFAULT_GYM_TIMEZONE,
    ensureTimezoneAwareTimestamps,
    getGymTimezone,
};