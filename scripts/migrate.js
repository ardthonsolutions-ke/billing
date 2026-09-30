require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
  });

  console.log('[Migrate] Connected to', process.env.DB_NAME);

  // Ensure migration tracking table exists
  await conn.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [applied] = await conn.query('SELECT filename FROM _migrations');
  const appliedSet = new Set(applied.map(r => r.filename));

  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log('[Migrate] Skipping (already applied):', file);
      continue;
    }
    console.log('[Migrate] Applying:', file);
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await conn.query(sql);
    await conn.query('INSERT INTO _migrations (filename) VALUES (?)', [file]);
    count++;
  }

  console.log(`[Migrate] Done. ${count} new migration(s) applied.`);
  await conn.end();
  process.exit(0);
})().catch(err => {
  console.error('[Migrate] Error:', err.message);
  process.exit(1);
});
