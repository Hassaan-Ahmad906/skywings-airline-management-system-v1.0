const crypto = require('crypto');

/**
 * Audit Context Middleware
 * Generates req.id and extracts client IP before auth/business logic runs
 */
function auditMiddleware(req, res, next) {
  // Generate unique Request ID if not already present
  if (!req.id) {
    req.id = req.headers['x-request-id'] || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  // Set response header for correlation
  res.setHeader('X-Request-ID', req.id);

  // Extract safe client IP address
  let ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  req.clientIp = ip;

  // Track request start timestamp
  req.startTime = Date.now();

  next();
}

module.exports = auditMiddleware;
