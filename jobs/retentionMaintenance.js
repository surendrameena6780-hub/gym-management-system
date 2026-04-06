const { pool } = require('../config/db');

const ARCHIVE_CONFIG = [
    {
        sourceTable: 'attendance',
        timestampColumn: 'check_in_time',
        retentionDays: Math.max(90, Number.parseInt(process.env.ATTENDANCE_RETENTION_DAYS || '365', 10) || 365),
    },
    {
        sourceTable: 'rfid_events',
        timestampColumn: 'event_timestamp',
        retentionDays: Math.max(90, Number.parseInt(process.env.RFID_EVENT_RETENTION_DAYS || '365', 10) || 365),
    },
    {
        sourceTable: 'notifications',
        timestampColumn: 'created_at',
        retentionDays: Math.max(30, Number.parseInt(process.env.NOTIFICATION_RETENTION_DAYS || '180', 10) || 180),
    },
    {
        sourceTable: 'broadcast_logs',
        timestampColumn: 'created_at',
        retentionDays: Math.max(30, Number.parseInt(process.env.BROADCAST_LOG_RETENTION_DAYS || '365', 10) || 365),
    },
    {
        sourceTable: 'audit_logs',
        timestampColumn: 'created_at',
        retentionDays: Math.max(30, Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '365', 10) || 365),
    },
    {
        sourceTable: 'system_runtime_events',
        timestampColumn: 'created_at',
        retentionDays: Math.max(14, Number.parseInt(process.env.RUNTIME_EVENT_RETENTION_DAYS || '60', 10) || 60),
    },
    {
        sourceTable: 'support_ticket_messages',
        timestampColumn: 'created_at',
        retentionDays: Math.max(30, Number.parseInt(process.env.SUPPORT_MESSAGE_RETENTION_DAYS || '365', 10) || 365),
    },
    {
        sourceTable: 'support_tickets',
        timestampColumn: 'updated_at',
        retentionDays: Math.max(30, Number.parseInt(process.env.SUPPORT_TICKET_RETENTION_DAYS || '365', 10) || 365),
        filterClause: "status IN ('RESOLVED', 'CLOSED')",
    },
];

const DEFAULT_BATCH_SIZE = Math.max(250, Number.parseInt(process.env.ARCHIVE_BATCH_SIZE || '2000', 10) || 2000);
const MAX_BATCH_PASSES = Math.max(1, Number.parseInt(process.env.ARCHIVE_MAX_BATCH_PASSES || '10', 10) || 10);

let ensureArchiveSchemaPromise;

const ensureArchiveSchema = async () => {
    if (!ensureArchiveSchemaPromise) {
        ensureArchiveSchemaPromise = pool.query(`
            CREATE TABLE IF NOT EXISTS operational_archives (
                id SERIAL PRIMARY KEY,
                source_table VARCHAR(80) NOT NULL,
                record_id INTEGER NOT NULL,
                archived_from_at TIMESTAMPTZ,
                payload JSONB NOT NULL,
                archived_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (source_table, record_id)
            );

            CREATE INDEX IF NOT EXISTS idx_operational_archives_source_time
                ON operational_archives(source_table, archived_from_at DESC);
            CREATE INDEX IF NOT EXISTS idx_operational_archives_archived_at
                ON operational_archives(archived_at DESC);
        `);
    }

    await ensureArchiveSchemaPromise;
};

const archiveSourceTable = async ({ sourceTable, timestampColumn, retentionDays, filterClause = 'TRUE' }) => {
    let archivedCount = 0;

    for (let pass = 0; pass < MAX_BATCH_PASSES; pass += 1) {
        const query = `
            WITH moved AS (
                DELETE FROM ${sourceTable}
                WHERE id IN (
                    SELECT id
                    FROM ${sourceTable}
                    WHERE ${timestampColumn} < NOW() - ($1::text || ' days')::interval
                                            AND (${filterClause})
                    ORDER BY ${timestampColumn} ASC
                    LIMIT $2
                )
                RETURNING *
            )
            INSERT INTO operational_archives (source_table, record_id, archived_from_at, payload, archived_at)
            SELECT $3, moved.id, moved.${timestampColumn}, to_jsonb(moved), NOW()
            FROM moved
            ON CONFLICT (source_table, record_id) DO NOTHING
            RETURNING id
        `;

        const result = await pool.query(query, [retentionDays, DEFAULT_BATCH_SIZE, sourceTable]);
        const movedCount = result.rowCount || 0;
        archivedCount += movedCount;

        if (movedCount < DEFAULT_BATCH_SIZE) {
            break;
        }
    }

    return archivedCount;
};

const runRetentionMaintenance = async () => {
    if (String(process.env.DATA_ARCHIVE_ENABLED || 'true').trim().toLowerCase() === 'false') {
        return { archived: {} };
    }

    await ensureArchiveSchema();

    const archived = {};
    for (const config of ARCHIVE_CONFIG) {
        archived[config.sourceTable] = await archiveSourceTable(config);
    }

    return { archived };
};

module.exports = {
    runRetentionMaintenance,
};