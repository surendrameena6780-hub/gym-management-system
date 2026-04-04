require('dotenv').config();

const { pool } = require('../config/db');

const BOT_EMAIL_DOMAIN = 'seed.gymvault.bot';
const DEFAULT_STATUS_MIX = {
  ACTIVE: 10,
  UNPAID: 10,
  INACTIVE: 10,
  EXPIRED: 10,
  EXPIRING_SOON: 10,
};

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Kabir', 'Arjun', 'Reyansh', 'Ishaan', 'Rohan', 'Karan', 'Neeraj',
  'Priya', 'Ananya', 'Meera', 'Aisha', 'Sneha', 'Kavya', 'Ritika', 'Pooja', 'Naina', 'Ira',
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Mehta', 'Singh', 'Patel', 'Kapoor', 'Nair', 'Reddy', 'Joshi', 'Bansal',
  'Khanna', 'Mishra', 'Gupta', 'Malhotra', 'Yadav', 'Rana', 'Chawla', 'Arora', 'Saxena', 'Pillai',
];

const toDateOnly = (date) => date.toISOString().slice(0, 10);

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const parseArgs = () => {
  const options = {
    gymId: null,
    replace: true,
    mix: { ...DEFAULT_STATUS_MIX },
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--keep-existing') {
      options.replace = false;
      continue;
    }

    if (arg.startsWith('--gym-id=')) {
      const gymId = Number.parseInt(arg.split('=')[1], 10);
      options.gymId = Number.isInteger(gymId) ? gymId : null;
      continue;
    }

    if (arg.startsWith('--mix=')) {
      const rawMix = arg.split('=')[1] || '';
      const parsed = {
        ACTIVE: 0,
        UNPAID: 0,
        INACTIVE: 0,
        EXPIRED: 0,
        EXPIRING_SOON: 0,
      };

      rawMix.split(',').forEach((pair) => {
        const [rawKey, rawValue] = pair.split(':');
        const key = String(rawKey || '').trim().toUpperCase();
        const value = Math.max(0, Number.parseInt(rawValue, 10) || 0);
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
          parsed[key] = value;
        }
      });

      const total = Object.values(parsed).reduce((sum, count) => sum + count, 0);
      if (total > 0) {
        options.mix = parsed;
      }
    }
  }

  return options;
};

const slugify = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '.')
  .replace(/^\.+|\.+$/g, '')
  .slice(0, 32);

const buildPhone = (gymId, index) => {
  const gymFragment = String(Math.abs(gymId) % 1000).padStart(3, '0');
  const sequenceFragment = String(index).padStart(6, '0').slice(-6);
  return `9${gymFragment}${sequenceFragment}`;
};

const resolveTargetGym = async (client, gymId) => {
  if (Number.isInteger(gymId)) {
    const explicit = await client.query(
      `SELECT g.id, g.name
       FROM gyms g
       WHERE g.id = $1
       LIMIT 1`,
      [gymId]
    );

    if (explicit.rows.length === 0) {
      throw new Error(`Gym ${gymId} was not found.`);
    }

    return explicit.rows[0];
  }

  const preferred = await client.query(
    `SELECT g.id, g.name
     FROM gyms g
     WHERE EXISTS (
       SELECT 1
       FROM plans p
       WHERE p.gym_id = g.id
         AND p.deleted_at IS NULL
     )
     ORDER BY g.created_at ASC, g.id ASC
     LIMIT 1`
  );

  if (preferred.rows.length > 0) {
    return preferred.rows[0];
  }

  const fallback = await client.query(
    `SELECT id, name
     FROM gyms
     ORDER BY created_at ASC, id ASC
     LIMIT 1`
  );

  if (fallback.rows.length === 0) {
    throw new Error('No gyms found. Create a gym before seeding bot members.');
  }

  return fallback.rows[0];
};

const loadPlans = async (client, gymId) => {
  const result = await client.query(
    `SELECT id, name, price, duration_days
     FROM plans
     WHERE gym_id = $1
       AND deleted_at IS NULL
     ORDER BY id ASC`,
    [gymId]
  );

  if (result.rows.length === 0) {
    throw new Error('This gym has no active plans. Add at least one plan before seeding bot members.');
  }

  return result.rows.map((plan) => ({
    ...plan,
    price: Number(plan.price || 0),
    duration_days: Number(plan.duration_days || 30) || 30,
  }));
};

const expandStatusMix = (mix) => Object.entries(mix).flatMap(([status, count]) => Array.from({ length: count }, () => status));

const buildSeedMembers = (gymId, statuses, plans) => {
  const today = new Date();

  return statuses.map((status, index) => {
    const sequence = index + 1;
    const firstName = FIRST_NAMES[index % FIRST_NAMES.length];
    const lastName = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length];
    const fullName = `${firstName} ${lastName}`;
    const plan = plans[index % plans.length];
    const basePrice = Number(plan.price || 0);
    const amountDue = status === 'UNPAID' ? Math.max(basePrice, 999) : 0;
    const emailLocal = `${slugify(firstName)}.${slugify(lastName)}.g${gymId}.${sequence}`;
    const joiningDate = addDays(today, -(25 + (sequence * 3)));

    const seed = {
      fullName,
      email: `${emailLocal}@${BOT_EMAIL_DOMAIN}`,
      phone: buildPhone(gymId, sequence),
      joiningDate: toDateOnly(joiningDate),
      memberStatus: status === 'UNPAID' ? 'UNPAID' : 'ACTIVE',
      lastVisit: null,
      membership: null,
      payment: null,
    };

    if (status === 'ACTIVE') {
      const startDate = addDays(today, -(10 + (sequence % 18)));
      const endDate = addDays(today, 28 + (sequence % 45));
      seed.lastVisit = addDays(today, -(sequence % 4));
      seed.membership = { planId: plan.id, startDate, endDate, status: 'ACTIVE' };
      seed.payment = {
        planId: plan.id,
        amountPaid: basePrice,
        amountDue: 0,
        totalAmount: basePrice,
        paymentMode: sequence % 2 === 0 ? 'Online' : 'Cash',
        status: 'Completed',
        paymentDate: addDays(startDate, 1),
      };
    }

    if (status === 'EXPIRING_SOON') {
      const startDate = addDays(today, -(20 + (sequence % 14)));
      const endDate = addDays(today, 1 + (sequence % 7));
      seed.lastVisit = addDays(today, -((sequence % 3) + 1));
      seed.membership = { planId: plan.id, startDate, endDate, status: 'ACTIVE' };
      seed.payment = {
        planId: plan.id,
        amountPaid: basePrice,
        amountDue: 0,
        totalAmount: basePrice,
        paymentMode: 'Online',
        status: 'Completed',
        paymentDate: addDays(startDate, 1),
      };
    }

    if (status === 'INACTIVE') {
      const startDate = addDays(today, -(35 + (sequence % 20)));
      const endDate = addDays(today, 18 + (sequence % 28));
      seed.lastVisit = addDays(today, -(15 + (sequence % 18)));
      seed.membership = { planId: plan.id, startDate, endDate, status: 'ACTIVE' };
      seed.payment = {
        planId: plan.id,
        amountPaid: basePrice,
        amountDue: 0,
        totalAmount: basePrice,
        paymentMode: 'Cash',
        status: 'Completed',
        paymentDate: addDays(startDate, 1),
      };
    }

    if (status === 'EXPIRED') {
      const startDate = addDays(today, -(75 + (sequence % 24)));
      const endDate = addDays(today, -(2 + (sequence % 20)));
      seed.lastVisit = addDays(endDate, -(4 + (sequence % 12)));
      seed.membership = { planId: plan.id, startDate, endDate, status: 'EXPIRED' };
      seed.payment = {
        planId: plan.id,
        amountPaid: basePrice,
        amountDue: 0,
        totalAmount: basePrice,
        paymentMode: sequence % 2 === 0 ? 'Cash' : 'Online',
        status: 'Completed',
        paymentDate: addDays(startDate, 1),
      };
    }

    if (status === 'UNPAID') {
      seed.lastVisit = null;
      seed.payment = {
        planId: plan.id,
        amountPaid: 0,
        amountDue,
        totalAmount: amountDue,
        paymentMode: 'Cash',
        status: 'Pending',
        paymentDate: addDays(today, -(sequence % 5)),
      };
    }

    return seed;
  });
};

const deleteExistingBotMembers = async (client, gymId) => {
  const result = await client.query(
    `DELETE FROM members
     WHERE gym_id = $1
       AND lower(email) LIKE $2`,
    [gymId, `%@${BOT_EMAIL_DOMAIN}`]
  );
  return result.rowCount || 0;
};

const insertSeedMember = async (client, gymId, seed, sequence) => {
  const memberInsert = await client.query(
    `INSERT INTO members (gym_id, full_name, phone, email, joining_date, last_visit, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      gymId,
      seed.fullName,
      seed.phone,
      seed.email,
      seed.joiningDate,
      seed.lastVisit ? seed.lastVisit.toISOString() : null,
      seed.memberStatus,
    ]
  );

  const memberId = memberInsert.rows[0].id;

  if (seed.membership) {
    await client.query(
      `INSERT INTO memberships (gym_id, member_id, plan_id, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        gymId,
        memberId,
        seed.membership.planId,
        toDateOnly(seed.membership.startDate),
        toDateOnly(seed.membership.endDate),
        seed.membership.status,
      ]
    );
  }

  if (seed.payment) {
    await client.query(
      `INSERT INTO payments (gym_id, user_id, plan_id, amount_paid, amount_due, total_amount, payment_mode, transaction_id, invoice_id, notes, status, payment_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        gymId,
        memberId,
        seed.payment.planId,
        seed.payment.amountPaid,
        seed.payment.amountDue,
        seed.payment.totalAmount,
        seed.payment.paymentMode,
        seed.payment.status === 'Completed' ? `BOT-TXN-${gymId}-${sequence}` : null,
        `BOT-INV-${gymId}-${sequence}`,
        `Bot member seed (${seed.memberStatus})`,
        seed.payment.status,
        seed.payment.paymentDate.toISOString(),
      ]
    );
  }
};

const main = async () => {
  const options = parseArgs();
  const statusList = expandStatusMix(options.mix);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const gym = await resolveTargetGym(client, options.gymId);
    const plans = await loadPlans(client, gym.id);
    const removed = options.replace ? await deleteExistingBotMembers(client, gym.id) : 0;
    const seeds = buildSeedMembers(gym.id, statusList, plans);

    for (let index = 0; index < seeds.length; index += 1) {
      await insertSeedMember(client, gym.id, seeds[index], index + 1);
    }

    await client.query('COMMIT');

    console.log(JSON.stringify({
      gym_id: gym.id,
      gym_name: gym.name,
      seeded: seeds.length,
      removed_existing: removed,
      mix: options.mix,
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