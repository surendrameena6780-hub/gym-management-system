require('dotenv').config();

const { pool } = require('../config/db');

const BOT_EMAIL_DOMAIN = 'seed.gymvault.bot';

const parseArgs = () => {
  const options = { gymId: null };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--gym-id=')) {
      const gymId = Number.parseInt(arg.split('=')[1], 10);
      options.gymId = Number.isInteger(gymId) ? gymId : null;
    }
  }

  return options;
};

const main = async () => {
  const options = parseArgs();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const params = options.gymId == null
      ? [`%@${BOT_EMAIL_DOMAIN}`]
      : [options.gymId, `%@${BOT_EMAIL_DOMAIN}`];

    const query = options.gymId == null
      ? `DELETE FROM members WHERE lower(email) LIKE $1 RETURNING gym_id`
      : `DELETE FROM members WHERE gym_id = $1 AND lower(email) LIKE $2 RETURNING gym_id`;

    const result = await client.query(query, params);

    await client.query('COMMIT');

    const affectedGyms = [...new Set(result.rows.map((row) => row.gym_id))];
    console.log(JSON.stringify({
      removed: result.rowCount || 0,
      gym_ids: affectedGyms,
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
};

main();