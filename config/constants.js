module.exports = {
  ROLES: {
    SUPER_ADMIN: 'super_admin',
    ISP_ADMIN: 'isp_admin',
    RESELLER: 'reseller',
    STAFF: 'staff',
    ACCOUNTANT: 'accountant'
  },

  SUBSCRIBER_STATUS: {
    ACTIVE: 'active',
    EXPIRED: 'expired',
    SUSPENDED: 'suspended',
    PENDING: 'pending'
  },

  SUBSCRIBER_TYPE: {
    HOTSPOT: 'hotspot',
    PPPOE: 'pppoe',
    STATIC: 'static'
  },

  PLAN_TYPE: {
    HOTSPOT: 'hotspot',
    PPPOE: 'pppoe'
  },

  PAYMENT_STATUS: {
    PENDING: 'pending',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  },

  PAYMENT_METHOD: {
    MPESA_STK: 'mpesa_stk',
    MPESA_C2B: 'mpesa_c2b',
    CASH: 'cash',
    BANK: 'bank',
    MANUAL: 'manual'
  },

  TICKET_STATUS: {
    OPEN: 'open',
    PENDING: 'pending',
    RESOLVED: 'resolved',
    CLOSED: 'closed'
  },

  TICKET_PRIORITY: {
    LOW: 'low',
    NORMAL: 'normal',
    HIGH: 'high',
    URGENT: 'urgent'
  },

  LEAD_STATUS: {
    NEW: 'new',
    CONTACTED: 'contacted',
    CONVERTED: 'converted',
    LOST: 'lost'
  },

  ROUTER_STATUS: {
    ONLINE: 'online',
    OFFLINE: 'offline',
    UNKNOWN: 'unknown'
  }
};
