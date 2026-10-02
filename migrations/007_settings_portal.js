// Migration 007 — Tenant Settings + Captive Portal
// Uses IF NOT EXISTS logic via information_schema (MySQL 5.x compatible)

module.exports = async function migrate(db) {
  // ─── Add columns to tenants ───
  const columnsToAdd = [
    ['support_phone',         "VARCHAR(30) DEFAULT NULL"],
    ['support_email',         "VARCHAR(150) DEFAULT NULL"],
    ['support_whatsapp',      "VARCHAR(30) DEFAULT NULL"],
    ['portal_template',       "VARCHAR(30) DEFAULT 'classic'"],
    ['portal_font',           "VARCHAR(50) DEFAULT 'system'"],
    ['portal_welcome',        "VARCHAR(300) DEFAULT NULL"],
    ['portal_terms',          "TEXT DEFAULT NULL"],
    ['advert_image_url',      "VARCHAR(500) DEFAULT NULL"],
    ['advert_link',           "VARCHAR(500) DEFAULT NULL"],
    ['sms_gateway',           "ENUM('none','africastalking','safaricom','twilio') DEFAULT 'none'"],
    ['sms_api_key',           "VARCHAR(255) DEFAULT NULL"],
    ['sms_username',          "VARCHAR(100) DEFAULT NULL"],
    ['payment_gateway',       "ENUM('none','paybill','till') DEFAULT 'none'"],
    ['payment_shortcode',     "VARCHAR(20) DEFAULT NULL"]
  ];

  for (const [col, def] of columnsToAdd) {
    const [exists] = await db.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = ?`,
      [col]
    );
    if (exists[0].c === 0) {
      await db.query(`ALTER TABLE tenants ADD COLUMN ${col} ${def}`);
      console.log('  + tenants.' + col);
    } else {
      console.log('  = tenants.' + col + ' (exists)');
    }
  }

  // ─── Create portal_sessions table ───
  await db.query(`
    CREATE TABLE IF NOT EXISTS portal_sessions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      visitor_mac VARCHAR(20) DEFAULT NULL,
      visitor_ip VARCHAR(45) DEFAULT NULL,
      router_id INT DEFAULT NULL,
      phone VARCHAR(30) DEFAULT NULL,
      stage ENUM('visited','selected_plan','paid','active') DEFAULT 'visited',
      plan_id INT DEFAULT NULL,
      payment_id INT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tenant (tenant_id),
      INDEX idx_mac (visitor_mac),
      INDEX idx_created (created_at),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  + portal_sessions table');
};
