const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const env = require('../config/env');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: env.db.host,
      port: env.db.port,
      database: env.db.name,
      user: env.db.user,
      password: env.db.password
    });
  }
  return pool;
}

function query(text, params) {
  return getPool().query(text, params);
}

// Nothing else in this codebase or the deploy pipeline ever applies
// database/schema.sql - it was only ever run by hand once, against
// whatever the production DB looked like at the time. Every statement in
// it is idempotent (CREATE TABLE/INDEX IF NOT EXISTS, ALTER ... ADD COLUMN
// IF NOT EXISTS), so it's safe to just run the whole file on every boot -
// this is what actually gets a new column/table onto production instead
// of only ever existing in a fresh local dev DB.
async function applySchema() {
  const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await getPool().query(sql);
}

module.exports = { getPool, query, applySchema };
