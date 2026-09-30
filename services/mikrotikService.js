// ═══════════════════════════════════════════════════════════
// MikroTik RouterOS API service
// Wraps node-routeros with our own error handling + helpers
// ═══════════════════════════════════════════════════════════
const RouterOSAPI = require('node-routeros').RouterOSAPI;

/**
 * Open a connection to a MikroTik router.
 * Returns { conn, close } — call close() when done.
 */
async function connect(router) {
  const options = {
    host: router.host,
    port: router.port || 8728,
    user: router.username,
    password: router.password_encrypted,
    timeout: 8,
    keepalive: false
  };

  const conn = new RouterOSAPI(options);
  await conn.connect();
  return conn;
}

/**
 * Test the connection. Returns { ok, version, identity, board, error }
 */
async function testConnection(router) {
  let conn;
  try {
    conn = await connect(router);

    const [resource] = await conn.write('/system/resource/print');
    const [identity] = await conn.write('/system/identity/print');
    const [routerboard] = await conn.write('/system/routerboard/print').catch(() => []);

    return {
      ok: true,
      version: resource ? resource.version : null,
      identity: identity ? identity.name : null,
      board: routerboard ? routerboard.model : null,
      uptime: resource ? resource.uptime : null,
      cpuLoad: resource ? resource['cpu-load'] : null,
      freeMemory: resource ? resource['free-memory'] : null,
      totalMemory: resource ? resource['total-memory'] : null
    };
  } catch (err) {
    return { ok: false, error: err.message || 'Connection failed' };
  } finally {
    if (conn) {
      try { conn.close(); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * List all hotspot users on the router.
 */
async function listHotspotUsers(router) {
  let conn;
  try {
    conn = await connect(router);
    const users = await conn.write('/ip/hotspot/user/print');
    return { ok: true, users: users || [] };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

/**
 * List active hotspot sessions (who's online right now).
 */
async function listHotspotActive(router) {
  let conn;
  try {
    conn = await connect(router);
    const active = await conn.write('/ip/hotspot/active/print');
    return { ok: true, sessions: active || [] };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

/**
 * Create a hotspot user on the router.
 * subscriber = { username, password_plain, plan (limits), mac_address }
 */
async function createHotspotUser(router, subscriber, plan) {
  let conn;
  try {
    conn = await connect(router);

    const params = [
      '=name=' + subscriber.username,
      '=password=' + (subscriber.password_plain || ''),
      '=comment=ABS-' + subscriber.account_number
    ];

    if (plan) {
      if (plan.speed_down_kbps && plan.speed_up_kbps) {
        // Rate limit in MikroTik format: "down/up" kbps
        params.push('=limit-uptime=' + ((plan.duration_hours || 0) + 'h'));
      }
      // For plan-based limits you'd typically use a profile — deferring that to v2
    }

    const result = await conn.write('/ip/hotspot/user/add', params);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

/**
 * Delete a hotspot user by name.
 */
async function deleteHotspotUser(router, username) {
  let conn;
  try {
    conn = await connect(router);

    // Find the user's internal ID
    const users = await conn.write('/ip/hotspot/user/print', ['?name=' + username]);
    if (!users || users.length === 0) {
      return { ok: true, skipped: true, message: 'User not on router' };
    }

    await conn.write('/ip/hotspot/user/remove', ['=.id=' + users[0]['.id']]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

/**
 * Get router identity + uptime + interfaces summary.
 */
async function getSystemInfo(router) {
  let conn;
  try {
    conn = await connect(router);
    const [resource] = await conn.write('/system/resource/print');
    const [identity] = await conn.write('/system/identity/print');
    const interfaces = await conn.write('/interface/print');

    return {
      ok: true,
      identity: identity ? identity.name : null,
      version: resource ? resource.version : null,
      uptime: resource ? resource.uptime : null,
      cpuLoad: resource ? resource['cpu-load'] : null,
      freeMemory: resource ? resource['free-memory'] : null,
      totalMemory: resource ? resource['total-memory'] : null,
      interfaces: (interfaces || []).map(i => ({
        name: i.name,
        type: i.type,
        running: i.running === 'true',
        rx: i['rx-byte'],
        tx: i['tx-byte']
      }))
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

module.exports = {
  connect,
  testConnection,
  listHotspotUsers,
  listHotspotActive,
  createHotspotUser,
  deleteHotspotUser,
  getSystemInfo
};
