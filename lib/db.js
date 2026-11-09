import pg from 'pg';

const pool =
  globalThis.__pgPool ||
  (globalThis.__pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    ssl: { rejectUnauthorized: false },
  }));

export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
