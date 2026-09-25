import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let pool;

function getPool() {
  if (!pool) {
    var dbUrl = process.env.DATABASE_URL || '';
    var needsSsl = !dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1');
    pool = new Pool({
      connectionString: dbUrl,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
    });

    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err.message);
    });
  }
  return pool;
}

async function query(text, params) {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

async function transaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default { getPool, query, transaction };
