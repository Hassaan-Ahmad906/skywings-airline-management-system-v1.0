const db = require('../config/database');

class AuditRepository {
  /**
   * Append audit log record inside active transaction or pool
   */
  async createAuditLog(connection, logData) {
    const {
      user_id = null,
      action,
      resource_type,
      resource_id = null,
      old_value = null,
      new_value = null,
      metadata = null,
      ip_address = null,
      user_agent = null,
      request_id = null,
      status = 'SUCCESS'
    } = logData;

    const dbExec = connection || db.pool;

    const [result] = await dbExec.execute(
      `INSERT INTO audit_logs (
        user_id, action, resource_type, resource_id, 
        old_value, new_value, metadata, ip_address, 
        user_agent, request_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id || null,
        action,
        resource_type,
        resource_id ? String(resource_id) : null,
        old_value ? JSON.stringify(old_value) : null,
        new_value ? JSON.stringify(new_value) : null,
        metadata ? JSON.stringify(metadata) : null,
        ip_address || null,
        user_agent ? String(user_agent).substring(0, 255) : null,
        request_id || null,
        status
      ]
    );

    return result.insertId;
  }

  /**
   * Admin audit log query with filtering and pagination (Max 100 limit)
   */
  async queryAuditLogs(connection, filters = {}, pagination = {}) {
    const dbExec = connection || db.pool;

    let {
      user_id,
      action,
      resource_type,
      resource_id,
      start_date,
      end_date,
      ip_address,
      request_id,
      status
    } = filters;

    let page = parseInt(pagination.page, 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(pagination.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 100) limit = 100; // Enforce maximum 100 limit

    const offset = (page - 1) * limit;

    const conditions = ['1=1'];
    const params = [];

    if (user_id) {
      conditions.push('a.user_id = ?');
      params.push(user_id);
    }

    if (action) {
      conditions.push('UPPER(a.action) = UPPER(?)');
      params.push(action);
    }

    if (resource_type) {
      conditions.push('UPPER(a.resource_type) = UPPER(?)');
      params.push(resource_type);
    }

    if (resource_id) {
      conditions.push('a.resource_id = ?');
      params.push(String(resource_id));
    }

    if (start_date) {
      conditions.push('a.created_at >= ?');
      params.push(start_date);
    }

    if (end_date) {
      conditions.push('a.created_at <= ?');
      params.push(end_date);
    }

    if (ip_address) {
      conditions.push('a.ip_address = ?');
      params.push(ip_address);
    }

    if (request_id) {
      conditions.push('a.request_id = ?');
      params.push(request_id);
    }

    if (status) {
      conditions.push('UPPER(a.status) = UPPER(?)');
      params.push(status);
    }

    const whereClause = conditions.join(' AND ');

    // 1. Get total count
    const [countRows] = await dbExec.execute(
      `SELECT COUNT(*) as total FROM audit_logs a WHERE ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    // 2. Fetch paginated records with user details
    const [rows] = await dbExec.execute(
      `SELECT a.*, u.email as user_email, u.first_name, u.last_name, u.role as user_role
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.user_id
       WHERE ${whereClause}
       ORDER BY a.audit_id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    // Parse JSON strings back to objects safely
    const parsedRows = rows.map(r => ({
      ...r,
      old_value: r.old_value ? (typeof r.old_value === 'string' ? JSON.parse(r.old_value) : r.old_value) : null,
      new_value: r.new_value ? (typeof r.new_value === 'string' ? JSON.parse(r.new_value) : r.new_value) : null,
      metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : null
    }));

    return {
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
      logs: parsedRows
    };
  }
}

module.exports = new AuditRepository();
