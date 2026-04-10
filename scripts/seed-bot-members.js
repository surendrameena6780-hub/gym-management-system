require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

const BOT_EMAIL_DOMAIN = 'seed.gymvault.bot';
const BOT_STAFF_EMAIL_DOMAIN = 'staff.gymvault.bot';
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
  'Raj', 'Vikram', 'Deepak', 'Suresh', 'Pankaj', 'Rahul', 'Sanjay', 'Manish', 'Nikhil', 'Amit',
  'Ritu', 'Sonal', 'Tanvi', 'Gauri', 'Nikita', 'Simran', 'Komal', 'Bhavna', 'Heena', 'Divya',
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Mehta', 'Singh', 'Patel', 'Kapoor', 'Nair', 'Reddy', 'Joshi', 'Bansal',
  'Khanna', 'Mishra', 'Gupta', 'Malhotra', 'Yadav', 'Rana', 'Chawla', 'Arora', 'Saxena', 'Pillai',
  'Bhat', 'Rathi', 'Dubey', 'Chauhan', 'Thakur', 'Pandey', 'Dixit', 'Kulkarni', 'Iyer', 'Desai',
];

const STAFF_ROLES = ['TRAINER', 'RECEPTIONIST', 'TRAINER', 'MANAGER', 'TRAINER'];
const DEFAULT_STAFF_PASSWORD = 'Staff@1234';

const toDateOnly = (date) => date.toISOString().slice(0, 10);

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const parseArgs = () => {
  const options = {
    gymId: null,
    gymName: '',
    replace: true,
    mix: { ...DEFAULT_STATUS_MIX },
    staffPerBranch: 0,
    perBranch: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--keep-existing') {
      options.replace = false;
      continue;
    }

    if (arg === '--per-branch') {
      options.perBranch = true;
      continue;
    }

    if (arg.startsWith('--staff=')) {
      options.staffPerBranch = Math.max(0, Number.parseInt(arg.split('=')[1], 10) || 0);
      continue;
    }

    if (arg.startsWith('--gym-id=')) {
      const gymId = Number.parseInt(arg.split('=')[1], 10);
      options.gymId = Number.isInteger(gymId) ? gymId : null;
      continue;
    }

    if (arg.startsWith('--gym-name=')) {
      options.gymName = String(arg.split('=').slice(1).join('=') || '').trim();
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

const resolveTargetGym = async (client, gymId, gymName) => {
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

  if (gymName) {
    const namedGym = await client.query(
      `SELECT g.id, g.name
       FROM gyms g
       WHERE lower(g.name) = lower($1)
          OR lower(g.name) LIKE lower($2)
       ORDER BY CASE WHEN lower(g.name) = lower($1) THEN 0 ELSE 1 END, g.created_at ASC, g.id ASC
       LIMIT 1`,
      [gymName, `%${gymName}%`]
    );

    if (namedGym.rows.length === 0) {
      throw new Error(`No gym matched "${gymName}".`);
    }

    return namedGym.rows[0];
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
     ORDER BY g.created_at ASC, g.id ASC`
  );

  if (preferred.rows.length === 1) {
    return preferred.rows[0];
  }

  if (preferred.rows.length > 1) {
    throw new Error(`Multiple gyms have active plans. Re-run with --gym-id=<id> or --gym-name="Gym Name". Matches: ${preferred.rows.map((gym) => `${gym.id}:${gym.name}`).join(', ')}`);
  }

  const fallback = await client.query(
    `SELECT id, name
     FROM gyms
     ORDER BY created_at ASC, id ASC`
  );

  if (fallback.rows.length === 1) {
    return fallback.rows[0];
  }

  if (fallback.rows.length === 0) {
    throw new Error('No gyms found. Create a gym before seeding bot members.');
  }

  throw new Error(`Multiple gyms exist. Re-run with --gym-id=<id> or --gym-name="Gym Name". Matches: ${fallback.rows.map((gym) => `${gym.id}:${gym.name}`).join(', ')}`);
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

const insertSeedMember = async (client, gymId, seed, sequence, branchId) => {
  const memberInsert = await client.query(
    `INSERT INTO members (gym_id, full_name, phone, email, joining_date, last_visit, status, branch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      gymId,
      seed.fullName,
      seed.phone,
      seed.email,
      seed.joiningDate,
      seed.lastVisit ? seed.lastVisit.toISOString() : null,
      seed.memberStatus,
      branchId,
    ]
  );

  const memberId = memberInsert.rows[0].id;

  if (seed.membership) {
    await client.query(
      `INSERT INTO memberships (gym_id, member_id, plan_id, start_date, end_date, status, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        gymId,
        memberId,
        seed.membership.planId,
        toDateOnly(seed.membership.startDate),
        toDateOnly(seed.membership.endDate),
        seed.membership.status,
        branchId,
      ]
    );
  }

  if (seed.payment) {
    await client.query(
      `INSERT INTO payments (gym_id, user_id, plan_id, amount_paid, amount_due, total_amount, payment_mode, transaction_id, invoice_id, notes, status, payment_date, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
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
        branchId,
      ]
    );
  }
};

const loadBranchDirectory = async (client, gymId) => {
  const res = await client.query(
    `SELECT branches_count, branch_directory FROM gyms WHERE id = $1 LIMIT 1`,
    [gymId]
  );
  const row = res.rows[0] || {};
  const count = Math.max(1, Number(row.branches_count) || 1);
  const directory = Array.isArray(row.branch_directory) ? row.branch_directory : [];
  if (directory.length === 0) {
    return Array.from({ length: count }, (_, i) => ({
      id: `branch-${i + 1}`,
      name: i === 0 ? 'Main Branch' : `Branch ${i + 1}`,
    }));
  }
  return directory.slice(0, count).map((b, i) => ({
    id: b.id || `branch-${i + 1}`,
    name: b.name || (i === 0 ? 'Main Branch' : `Branch ${i + 1}`),
  }));
};

const deleteExistingBotStaff = async (client, gymId) => {
  const result = await client.query(
    `DELETE FROM users WHERE gym_id = $1 AND lower(email) LIKE $2 AND UPPER(role) != 'OWNER'`,
    [gymId, `%@${BOT_STAFF_EMAIL_DOMAIN}`]
  );
  return result.rowCount || 0;
};

const insertBotStaff = async (client, gymId, branchId, staffIndex, branchIndex) => {
  const firstName = FIRST_NAMES[(branchIndex * 5 + staffIndex) % FIRST_NAMES.length];
  const lastName = LAST_NAMES[(branchIndex * 5 + staffIndex + 3) % LAST_NAMES.length];
  const fullName = `${firstName} ${lastName}`;
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.b${branchIndex + 1}.s${staffIndex + 1}@${BOT_STAFF_EMAIL_DOMAIN}`;
  const staffRole = STAFF_ROLES[staffIndex % STAFF_ROLES.length];
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(DEFAULT_STAFF_PASSWORD, salt);

  await client.query(
    `INSERT INTO users (gym_id, full_name, email, password_hash, role, staff_role, branch_id, is_active, permissions)
     VALUES ($1, $2, $3, $4, 'STAFF', $5, $6, TRUE, $7::jsonb)
     ON CONFLICT (email) DO NOTHING`,
    [gymId, fullName, email, hash, staffRole, branchId, JSON.stringify({})]
  );
  return { fullName, email, staffRole, branchId };
};

const main = async () => {
  const options = parseArgs();
  const statusList = expandStatusMix(options.mix);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const gym = await resolveTargetGym(client, options.gymId, options.gymName);
    const plans = await loadPlans(client, gym.id);
    const branches = await loadBranchDirectory(client, gym.id);
    const removed = options.replace ? await deleteExistingBotMembers(client, gym.id) : 0;
    const removedStaff = options.staffPerBranch > 0 ? await deleteExistingBotStaff(client, gym.id) : 0;

    let totalSeeded = 0;
    let totalStaff = 0;
    const branchResults = [];

    const targetBranches = options.perBranch ? branches : [branches[0]];

    for (const branch of targetBranches) {
      const branchSeeds = buildSeedMembers(gym.id, statusList, plans);

      for (let index = 0; index < branchSeeds.length; index += 1) {
        // Make emails unique per branch
        const seed = { ...branchSeeds[index] };
        seed.email = seed.email.replace(`@${BOT_EMAIL_DOMAIN}`, `.${branch.id}@${BOT_EMAIL_DOMAIN}`);
        seed.phone = buildPhone(gym.id, totalSeeded + index + 1);
        await insertSeedMember(client, gym.id, seed, totalSeeded + index + 1, branch.id);
      }

      let branchStaff = 0;
      if (options.staffPerBranch > 0) {
        const branchIdx = targetBranches.indexOf(branch);
        for (let s = 0; s < options.staffPerBranch; s++) {
          await insertBotStaff(client, gym.id, branch.id, s, branchIdx);
          branchStaff++;
        }
      }

      branchResults.push({
        branch_id: branch.id,
        branch_name: branch.name,
        members_seeded: branchSeeds.length,
        staff_seeded: branchStaff,
      });

      totalSeeded += branchSeeds.length;
      totalStaff += branchStaff;
    }

    await client.query('COMMIT');

    console.log(JSON.stringify({
      gym_id: gym.id,
      gym_name: gym.name,
      total_members_seeded: totalSeeded,
      total_staff_seeded: totalStaff,
      removed_existing_members: removed,
      removed_existing_staff: removedStaff,
      mix: options.mix,
      branches: branchResults,
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