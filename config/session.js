const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

// Base session options
const baseOptions = {
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'abs.sid',
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
};

function createSessionOptions() {
  if (!process.env.DB_HOST || !process.env.DB_NAME) {
    console.warn('[Session] DB env not set — falling back to MemoryStore');
    return baseOptions;
  }

  try {
    const store = new MySQLStore({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      createDatabaseTable: false,
      schema: {
        tableName: 'sessions',
        columnNames: {
          session_id: 'session_id',
          expires: 'expires',
          data: 'data'
        }
      }
    });

    console.log('[Session] Using MySQL session store');
    return Object.assign({}, baseOptions, { store });
  } catch (err) {
    console.error('[Session] MySQL store failed, falling back:', err.message);
    return baseOptions;
  }
}

module.exports = createSessionOptions;
