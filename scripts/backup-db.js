const { runDatabaseBackup } = require('../jobs/databaseBackup');

(async () => {
    try {
        const result = await runDatabaseBackup({ force: true });
        if (result?.skipped) {
            console.log('Database backup skipped:', result.reason || 'disabled');
            process.exit(0);
        }

        console.log(`Database backup created at ${result.backupPath}`);
        process.exit(0);
    } catch (err) {
        console.error('Database backup failed:', err.message);
        process.exit(1);
    }
})();