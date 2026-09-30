const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+03:00',
  dateStrings: false,
  supportBigNumbers: true,
  bigNumberStrings: false
});

// Test connection on startup
pool.getConnection()
  .then(conn => {
    console.log('[DB] Connected to MySQL — ' + process.env.DB_NAME);
    conn.release();
  })
  .catch(err => console.error('[DB] Connection failed:', err.message));

module.exports = pool;
