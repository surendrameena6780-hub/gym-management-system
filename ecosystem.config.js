/**
 * PM2 Ecosystem Configuration
 *
 * Start in cluster mode:   pm2 start ecosystem.config.js
 * Stop:                    pm2 stop gym-api
 * Restart with 0-downtime: pm2 reload gym-api
 * Monitor:                 pm2 monit
 * Logs:                    pm2 logs gym-api
 *
 * Background jobs (expiry checks, notifications, retention, payroll, backups)
 * are automatically limited to one worker (INSTANCE_ID === '0') to prevent
 * duplicate execution across the cluster.
 *
 * Environment variables consumed by the app:
 *   REDIS_URL            Enables cross-worker cache sharing.
 *   DB_POOL_MAX          Per-worker PG pool size.
 *   PM2_INSTANCES        Number of app workers. Use 'max' on bigger machines.
 *   NODE_HEAP_MB         Max V8 heap per worker in MB.
 *   PM2_MAX_MEMORY_MB    Restart threshold per worker in MB.
 */

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const isRender = String(process.env.RENDER || '').trim().toLowerCase() === 'true'
    || Boolean(process.env.RENDER_SERVICE_ID);
const rawInstances = String(process.env.PM2_INSTANCES || '').trim().toLowerCase();
const instances = rawInstances === 'max'
    ? 'max'
    : parsePositiveInt(rawInstances, isRender ? 1 : null) || (isRender ? 1 : 'max');
const execMode = instances === 'max' || instances > 1 ? 'cluster' : 'fork';
const heapMb = parsePositiveInt(process.env.NODE_HEAP_MB, isRender ? 384 : 2048);
const maxMemoryMb = parsePositiveInt(process.env.PM2_MAX_MEMORY_MB, isRender ? 460 : 1800);

module.exports = {
    apps: [
        {
            name: 'gym-api',
            script: 'server.js',
            instances,
            exec_mode: execMode,
            instance_var: 'INSTANCE_ID',
            node_args: `--max-old-space-size=${heapMb}`,
            max_memory_restart: `${maxMemoryMb}M`,
            env: {
                NODE_ENV: 'production',
                NODE_OPTIONS: `--max-old-space-size=${heapMb}`,
            },
            // Graceful shutdown
            kill_timeout: 20000,
            listen_timeout: 10000,
            // Restart policy
            max_restarts: 15,
            restart_delay: 1000,
            exp_backoff_restart_delay: 100,
            // Logging
            merge_logs: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        },
    ],
};
