const auditRepository = require('../repositories/auditRepository');

// Standardized Audit Actions
const AUDIT_ACTIONS = {
  // Authentication & Authorization
  AUTH_LOGIN_SUCCESS: 'AUTH_LOGIN_SUCCESS',
  AUTH_LOGIN_FAILURE: 'AUTH_LOGIN_FAILURE',
  AUTH_LOGOUT: 'AUTH_LOGOUT',
  PASSWORD_RESET: 'PASSWORD_RESET',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_UPDATED: 'USER_UPDATED',

  // Flights & Aircraft
  FLIGHT_CREATED: 'FLIGHT_CREATED',
  FLIGHT_UPDATED: 'FLIGHT_UPDATED',
  FLIGHT_CANCELLED: 'FLIGHT_CANCELLED',
  FLIGHT_RESCHEDULED: 'FLIGHT_RESCHEDULED',
  AIRCRAFT_ASSIGNED: 'AIRCRAFT_ASSIGNED',
  AIRCRAFT_CREATED: 'AIRCRAFT_CREATED',
  AIRCRAFT_UPDATED: 'AIRCRAFT_UPDATED',
  AIRCRAFT_RETIRED: 'AIRCRAFT_RETIRED',
  AIRCRAFT_MAINTENANCE_CHANGED: 'AIRCRAFT_MAINTENANCE_CHANGED',

  // Bookings & Passengers
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_OVERRIDE: 'BOOKING_OVERRIDE',
  PASSENGER_MODIFIED: 'PASSENGER_MODIFIED',

  // Tickets
  TICKET_STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
  TICKET_VOIDED: 'TICKET_VOIDED',

  // Check-in
  CHECKIN_COMPLETED: 'CHECKIN_COMPLETED',
  SEAT_REASSIGNED: 'SEAT_REASSIGNED',
  GATE_MODIFIED: 'GATE_MODIFIED'
};

const SENSITIVE_KEYS = new Set([
  'password', 'passwordhash', 'token', 'accesstoken', 'refreshtoken', 
  'jwt', 'authorization', 'cookie', 'secret', 'apikey', 
  'creditcard', 'cardnumber', 'cvv', 'auth_token', 'authtoken'
]);

class AuditService {
  get ACTIONS() {
    return AUDIT_ACTIONS;
  }

  /**
   * Recursively sanitize sensitive keys in objects/arrays
   */
  sanitize(data) {
    if (data === null || data === undefined) return null;

    if (typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitize(item));
    }

    const sanitizedObj = {};
    for (const key of Object.keys(data)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey)) {
        sanitizedObj[key] = '[REDACTED]';
      } else if (typeof data[key] === 'object' && data[key] !== null) {
        sanitizedObj[key] = this.sanitize(data[key]);
      } else {
        sanitizedObj[key] = data[key];
      }
    }
    return sanitizedObj;
  }

  /**
   * Log an audit event (Transaction-aware)
   */
  async logEvent({
    userId = null,
    action,
    resourceType,
    resourceId = null,
    oldValue = null,
    newValue = null,
    metadata = null,
    req = null,
    status = 'SUCCESS',
    connection = null
  }) {
    try {
      let resolvedUserId = userId;
      let ipAddress = null;
      let userAgent = null;
      let requestId = null;
      let contextMetadata = metadata ? { ...metadata } : {};

      if (req) {
        if (!resolvedUserId && req.user) {
          resolvedUserId = req.user.userId || req.user.id;
        }
        ipAddress = req.clientIp || req.ip || (req.socket ? req.socket.remoteAddress : null);
        userAgent = req.headers ? req.headers['user-agent'] : null;
        requestId = req.id || (req.headers ? req.headers['x-request-id'] : null);

        contextMetadata.endpoint = req.originalUrl || req.url;
        contextMetadata.method = req.method;
        if (req.startTime) {
          contextMetadata.duration_ms = Date.now() - req.startTime;
        }
      }

      const logData = {
        user_id: resolvedUserId,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        old_value: this.sanitize(oldValue),
        new_value: this.sanitize(newValue),
        metadata: this.sanitize(contextMetadata),
        ip_address: ipAddress,
        user_agent: userAgent,
        request_id: requestId,
        status: status === 'FAILURE' ? 'FAILURE' : 'SUCCESS'
      };

      await auditRepository.createAuditLog(connection, logData);
    } catch (err) {
      console.error('AuditService logEvent error:', err.message);
      // Fail silently if not in transaction to avoid breaking main flow
      if (connection) {
        throw err;
      }
    }
  }

  /**
   * Query audit logs (Admin authorization required)
   */
  async getAuditLogs(filters = {}, pagination = {}, requestingUser) {
    if (!requestingUser || requestingUser.role !== 'admin') {
      const error = new Error('Admin privileges required to access audit logs.');
      error.code = 'FORBIDDEN';
      error.status = 403;
      throw error;
    }

    return await auditRepository.queryAuditLogs(null, filters, pagination);
  }
}

module.exports = new AuditService();
