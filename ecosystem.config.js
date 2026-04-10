/**
 * PM2 Ecosystem Configuration
 *
 * Start in cluster mode:   pm2 start ecosystem.config.js
 * Stop:                     pm2 stop gym-api
 * Restart with 0-downtime:  pm2 reload gym-api
 * Monitor:                  pm2 monit
 * Logs:                     pm2 logs gym-api
 *
 * Background jobs (expiry checks, notifications, retention, payroll, backups)
 * are automatically limited to **one** worker (instance_var INSTANCE_ID === '0')
 * to prevent duplicate execution across the cluster.
 *
 * Environment variables consumed by the app:
 *   REDIS_URL          — Enables cross-worker cache sharing (recommended for cluster)
 *   DB_POOL_MAX        — Per-worker PG pool size (default 100; total = instances × max)
 *   NODE_OPTIONS       — V8 flags; heap limit set below
 */

module.exports = {
    apps: [
        {
            name: 'gym-api',
            script: 'server.js',
            instances: 'max',
            exec_mode: 'cluster',
            instance_var: 'INSTANCE_ID',
            node_args: '--max-old-space-size=2048',
            max_memory_restart: '1800M',
            env: {
                NODE_ENV: 'production',
                NODE_OPTIONS: '--max-old-space-size=2048',
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
