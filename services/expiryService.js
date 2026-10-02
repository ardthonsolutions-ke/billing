// ═══════════════════════════════════════════════════════════
// Subscriber Expiry Service
// Runs periodically — marks expired subscribers, logs events
// ═══════════════════════════════════════════════════════════
const db = require('../config/database');

/**
 * Find all active subscribers whose expires_at is in the past,
 * mark them expired, log an event.
 * Returns { processed, errors }
 */
async function expireSubscribers() {
  let processed = 0;
  let errors = 0;

  try {
    const [expired] = await db.query(
      `SELECT id, tenant_id, full_name, phone, account_number, expires_at
       FROM subscribers
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
       LIMIT 500`
    );

    if (expired.length === 0) return { processed: 0, errors: 0 };

    for (const sub of expired) {
      try {
        await db.query(
          "UPDATE subscribers SET status = 'expired' WHERE id = ?",
          [sub.id]
        );

        try {
          await db.query(
            'INSERT INTO subscriber_events (tenant_id, subscriber_id, event_type, details) VALUES (?, ?, ?, ?)',
            [sub.tenant_id, sub.id, 'expired', JSON.stringify({
              expired_at: sub.expires_at,
              auto: true
            })]
          );
        } catch (e) {
          console.error('[Expiry] event log failed for sub', sub.id, e.message);
        }

        processed++;
        console.log('[Expiry] Expired: ' + sub.account_number + ' (' + sub.full_name + ')');
      } catch (err) {
        errors++;
        console.error('[Expiry] Failed for sub', sub.id, err.message);
      }
    }
  } catch (err) {
    console.error('[Expiry] Query failed:', err.message);
  }

  return { processed, errors };
}

/**
 * Warn subscribers whose plan expires within the next N minutes.
 * Currently a stub — will send SMS/email in Phase 4.7.
 */
async function warnExpiringSoon(minutes = 30) {
  try {
    const [subs] = await db.query(
      `SELECT id, tenant_id, full_name, phone, account_number, expires_at
       FROM subscribers
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? MINUTE)`,
      [minutes]
    );
    return subs;
  } catch (err) {
    console.error('[Expiry] warn query failed:', err.message);
    return [];
  }
}

module.exports = { expireSubscribers, warnExpiringSoon };
