const { Pool } = require('pg');

const { databaseUrl } = require('./index');

const pool = new Pool({
  connectionString: databaseUrl || undefined,
  connectionTimeoutMillis: 5000,
  max: 10,
});

pool.on('error', (error) => {
  const code = typeof error.code === 'string' ? error.code : 'POOL_ERROR';
  console.error(`Database: CONNECTION LOST (${code})`);
});

async function checkDatabaseConnection() {
  if (!databaseUrl) {
    const error = new Error('DATABASE_URL is not configured');
    error.code = 'DATABASE_URL_MISSING';
    throw error;
  }

  await pool.query('SELECT 1');
}

module.exports = { checkDatabaseConnection, pool };
