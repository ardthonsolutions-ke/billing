require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log('[Seed] Seeding initial data...');

  // ── Default super-admin ──
  const adminEmail = 'admin@billing.ardthonsolutions.com';
  const adminPassword = 'ArdthonAdmin2026!';
  const hash = await bcrypt.hash(adminPassword, 10);

  const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (existing.length === 0) {
    await conn.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
       VALUES (NULL, ?, ?, ?, 'super_admin')`,
      [adminEmail, hash, 'Super Admin']
    );
    console.log('[Seed] ✅ Super admin created:');
    console.log('       Email:    ', adminEmail);
    console.log('       Password: ', adminPassword);
  } else {
    console.log('[Seed] Super admin already exists — skipping');
  }

  // ── Demo tenant (optional) ──
  const demoTenantName = 'Demo ISP';
  const demoSlug = 'demo-isp';

  const [existingTenant] = await conn.query('SELECT id FROM tenants WHERE slug = ?', [demoSlug]);
  if (existingTenant.length === 0) {
    const [r] = await conn.query(
      `INSERT INTO tenants (name, slug, contact_email, is_active)
       VALUES (?, ?, 'demo@example.com', 1)`,
      [demoTenantName, demoSlug]
    );
    console.log('[Seed] ✅ Demo tenant created (id=' + r.insertId + ')');
  } else {
    console.log('[Seed] Demo tenant already exists — skipping');
  }

  console.log('[Seed] Done.');
  await conn.end();
  process.exit(0);
})().catch(err => {
  console.error('[Seed] Error:', err.message);
  process.exit(1);
});
