const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node run-migration.js <path-to-sql-file>');
    process.exit(1);
  }

  const sql = fs.readFileSync(path.resolve(filePath), 'utf8');
  
  try {
    console.log(`Running migration: ${filePath}`);
    await pool.query(sql);
    console.log('✅ Migration successful');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
