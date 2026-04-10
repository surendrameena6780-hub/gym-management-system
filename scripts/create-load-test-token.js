const path = require('path');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });

const requiredEnv = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'JWT_SECRET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
    console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
    process.exit(1);
}

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
});

const buildOwnerQuery = () => {
    if (process.env.LOAD_TEST_OWNER_EMAIL) {
        return {
            text: `
                SELECT
                    u.id,
                    u.gym_id,
                    u.email,
                    UPPER(COALESCE(u.role, 'OWNER')) AS role,
                    COALESCE(u.staff_role, 'OWNER') AS staff_role,
                    COALESCE(u.is_active, TRUE) AS is_active
                FROM users u
                JOIN gyms g ON g.id = u.gym_id
                WHERE LOWER(COALESCE(u.email, '')) = LOWER($1)
                  AND COALESCE(u.is_active, TRUE) = TRUE
                  AND COALESCE(g.is_active, TRUE) = TRUE
                  AND COALESCE(g.gym_access_status, 'ACTIVE') = 'ACTIVE'
                  AND (g.saas_valid_until IS NULL OR g.saas_valid_until >= NOW() - INTERVAL '3 days')
                LIMIT 1
            `,
            values: [process.env.LOAD_TEST_OWNER_EMAIL],
        };
    }

    return {
        text: `
            SELECT
                u.id,
                u.gym_id,
                u.email,
                UPPER(COALESCE(u.role, 'OWNER')) AS role,
                COALESCE(u.staff_role, 'OWNER') AS staff_role,
                COALESCE(u.is_active, TRUE) AS is_active
            FROM users u
            JOIN gyms g ON g.id = u.gym_id
            WHERE UPPER(COALESCE(u.role, 'OWNER')) = 'OWNER'
              AND COALESCE(u.is_active, TRUE) = TRUE
              AND COALESCE(g.is_active, TRUE) = TRUE
              AND COALESCE(g.gym_access_status, 'ACTIVE') = 'ACTIVE'
              AND (g.saas_valid_until IS NULL OR g.saas_valid_until >= NOW() - INTERVAL '3 days')
              AND COALESCE(u.email, '') <> ''
            ORDER BY u.id ASC
            LIMIT 1
        `,
        values: [],
    };
};

const createToken = (user) => jwt.sign(
    {
        user: {
            id: user.id,
            gym_id: user.gym_id,
            role: user.role,
            staff_role: user.staff_role,
            permissions: ['*'],
            is_active: user.is_active !== false,
        },
    },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
);

async function main() {
    const query = buildOwnerQuery();
    const result = await pool.query(query.text, query.values);
    const owner = result.rows[0];

    if (!owner) {
        throw new Error('No eligible active owner account found for load testing.');
    }

    const token = createToken(owner);
    process.stdout.write(JSON.stringify({
        token,
        email: owner.email,
        userId: owner.id,
        gymId: owner.gym_id,
    }));
}

main()
    .catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end().catch(() => undefined);
    });