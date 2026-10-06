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

// ═══════════════════════════════════════════════════════════
// Additional helpers for network dashboard
// ═══════════════════════════════════════════════════════════

/**
 * Disconnect a specific active session.
 * @param {object} router - router DB row
 * @param {string} sessionInternalId - MikroTik internal .id (from active/print)
 */
async function disconnectActiveSession(router, sessionInternalId) {
  let conn;
  try {
    conn = await connect(router);
    await conn.write('/ip/hotspot/active/remove', ['=.id=' + sessionInternalId]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

/**
 * Find an active hotspot session by MAC address.
 */
async function findSessionByMac(router, mac) {
  let conn;
  try {
    conn = await connect(router);
    const sessions = await conn.write('/ip/hotspot/active/print', [
      '?mac-address=' + mac.toUpperCase()
    ]);
    return { ok: true, session: (sessions && sessions[0]) || null };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

/**
 * Get full status of a router — active sessions, uptime, resource usage.
 */
async function getRouterFullStatus(router) {
  let conn;
  try {
    conn = await connect(router);
    const [resource] = await conn.write('/system/resource/print').catch(() => [{}]);
    const [identity] = await conn.write('/system/identity/print').catch(() => [{}]);
    const active = await conn.write('/ip/hotspot/active/print').catch(() => []);
    const users = await conn.write('/ip/hotspot/user/print').catch(() => []);

    // Optional — PPPoE sessions
    const pppoe = await conn.write('/ppp/active/print').catch(() => []);

    return {
      ok: true,
      identity: identity ? identity.name : null,
      version: resource ? resource.version : null,
      uptime: resource ? resource.uptime : null,
      cpuLoad: resource ? resource['cpu-load'] : null,
      freeMemory: resource ? resource['free-memory'] : null,
      totalMemory: resource ? resource['total-memory'] : null,
      activeSessions: active || [],
      hotspotUsers: users ? users.length : 0,
      pppoeSessions: pppoe || [],
      activeCount: (active || []).length + (pppoe || []).length
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

/**
 * List PPPoE active sessions.
 */
async function listPppoeActive(router) {
  let conn;
  try {
    conn = await connect(router);
    const sessions = await conn.write('/ppp/active/print');
    return { ok: true, sessions: sessions || [] };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

module.exports.connect = connect;
module.exports.testConnection = testConnection;
module.exports.listHotspotUsers = listHotspotUsers;
module.exports.listHotspotActive = listHotspotActive;
module.exports.createHotspotUser = createHotspotUser;
module.exports.deleteHotspotUser = deleteHotspotUser;
module.exports.getSystemInfo = getSystemInfo;
module.exports.disconnectActiveSession = disconnectActiveSession;
module.exports.findSessionByMac = findSessionByMac;
module.exports.getRouterFullStatus = getRouterFullStatus;
module.exports.listPppoeActive = listPppoeActive;

// ═══════════════════════════════════════════════════════════
// PPPoE management helpers (for subscriber self-service)
// ═══════════════════════════════════════════════════════════

/**
 * Find a PPPoE secret (account) by username.
 */
async function findPppoeSecret(router, username) {
  let conn;
  try {
    conn = await connect(router);
    const secrets = await conn.write('/ppp/secret/print', ['?name=' + username]);
    return { ok: true, secret: (secrets && secrets[0]) || null };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

/**
 * Change a PPPoE secret's password on the router.
 */
async function changePppoeSecret(router, username, newPassword) {
  let conn;
  try {
    conn = await connect(router);

    // Find the secret first
    const secrets = await conn.write('/ppp/secret/print', ['?name=' + username]);
    if (!secrets || !secrets.length) {
      return { ok: false, error: 'PPPoE account not found on router' };
    }

    const secretId = secrets[0]['.id'];

    // Update the password
    await conn.write('/ppp/secret/set', [
      '=.id=' + secretId,
      '=password=' + newPassword
    ]);

    // Find and disconnect any active session for this user (forces re-dial)
    const active = await conn.write('/ppp/active/print', ['?name=' + username]);
    if (active && active.length) {
      for (const session of active) {
        await conn.write('/ppp/active/remove', ['=.id=' + session['.id']]);
      }
    }

    return { ok: true, disconnected: (active || []).length };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

/**
 * Disconnect an active PPPoE session (force reconnect).
 */
async function disconnectPppoeSession(router, username) {
  let conn;
  try {
    conn = await connect(router);

    const active = await conn.write('/ppp/active/print', ['?name=' + username]);
    if (!active || !active.length) {
      return { ok: true, disconnected: 0, message: 'No active session' };
    }

    for (const session of active) {
      await conn.write('/ppp/active/remove', ['=.id=' + session['.id']]);
    }

    return { ok: true, disconnected: active.length };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

/**
 * Get PPPoE session status for a username (online/offline + IP + uptime).
 */
async function getPppoeStatus(router, username) {
  let conn;
  try {
    conn = await connect(router);
    const active = await conn.write('/ppp/active/print', ['?name=' + username]);

    if (!active || !active.length) {
      return { ok: true, online: false, session: null };
    }

    const s = active[0];
    return {
      ok: true,
      online: true,
      session: {
        address: s.address,
        uptime: s.uptime,
        caller_id: s['caller-id'],
        bytes_in: s['bytes-in'],
        bytes_out: s['bytes-out'],
        session_id: s['.id']
      }
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) try { conn.close(); } catch (e) {}
  }
}

module.exports.findPppoeSecret = findPppoeSecret;
module.exports.changePppoeSecret = changePppoeSecret;
module.exports.disconnectPppoeSession = disconnectPppoeSession;
module.exports.getPppoeStatus = getPppoeStatus;
