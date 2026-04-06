const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getBackupDirectory = () => path.resolve(process.env.DB_BACKUP_DIR || path.join(process.cwd(), 'backups', 'db'));

const ensureBackupDirectory = async () => {
    await fs.promises.mkdir(getBackupDirectory(), { recursive: true });
};

const buildTimestamp = () => new Date().toISOString().replace(/[.:]/g, '-');

const pruneBackupFiles = async () => {
    const retentionCount = parsePositiveInt(process.env.DB_BACKUP_RETENTION_COUNT, 14);
    const directory = getBackupDirectory();

    await ensureBackupDirectory();

    const files = (await fs.promises.readdir(directory))
        .filter((entry) => entry.endsWith('.sql.gz'))
        .sort()
        .reverse();

    const filesToDelete = files.slice(retentionCount);
    await Promise.all(filesToDelete.map((entry) => fs.promises.unlink(path.join(directory, entry)).catch(() => {})));
};

const runDatabaseBackup = async ({ force = false } = {}) => {
    const isEnabled = String(process.env.DB_BACKUP_ENABLED || 'false').trim().toLowerCase() === 'true';
    if (!isEnabled && !force) {
        return { skipped: true, reason: 'disabled' };
    }

    await ensureBackupDirectory();

    const backupPath = path.join(getBackupDirectory(), `gymvault-${buildTimestamp()}.sql.gz`);
    const dumpBinary = process.env.PG_DUMP_PATH || (process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
    const args = [
        '--host', process.env.DB_HOST,
        '--port', String(process.env.DB_PORT || '5432'),
        '--username', process.env.DB_USER,
        '--dbname', process.env.DB_NAME,
        '--no-owner',
        '--no-privileges',
        '--format=plain',
        '--encoding=UTF8',
    ];

    const child = spawn(dumpBinary, args, {
        env: {
            ...process.env,
            PGPASSWORD: process.env.DB_PASSWORD,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    try {
        await pipeline(child.stdout, zlib.createGzip({ level: 9 }), fs.createWriteStream(backupPath));

        const exitCode = await new Promise((resolve, reject) => {
            child.on('error', reject);
            child.on('close', resolve);
        });

        if (exitCode !== 0) {
            throw new Error(stderr.trim() || `pg_dump exited with code ${exitCode}`);
        }

        await pruneBackupFiles();

        return {
            skipped: false,
            backupPath,
        };
    } catch (err) {
        await fs.promises.unlink(backupPath).catch(() => {});
        throw err;
    }
};

module.exports = {
    getBackupDirectory,
    runDatabaseBackup,
    pruneBackupFiles,
};