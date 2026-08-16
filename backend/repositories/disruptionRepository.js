const db = require('../config/database');

class DisruptionRepository {
  /**
   * Create new flight disruption record
   */
  async createDisruption(connection, data) {
    const dbExec = connection || db.pool;
    const {
      flight_id,
      disruption_type,
      reason,
      operational_notes = null,
      execution_key = null,
      old_departure_datetime = null,
      new_departure_datetime = null,
      old_arrival_datetime = null,
      new_arrival_datetime = null,
      old_aircraft_id = null,
      new_aircraft_id = null,
      old_gate = null,
      new_gate = null,
      created_by_user_id = null,
      status = 'PENDING_EXECUTION'
    } = data;

    const [result] = await dbExec.execute(
      `INSERT INTO flight_disruptions (
        flight_id, disruption_type, reason, operational_notes, execution_key,
        old_departure_datetime, new_departure_datetime, old_arrival_datetime, new_arrival_datetime,
        old_aircraft_id, new_aircraft_id, old_gate, new_gate,
        created_by_user_id, status, execution_started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        flight_id,
        disruption_type,
        reason,
        operational_notes,
        execution_key,
        old_departure_datetime,
        new_departure_datetime,
        old_arrival_datetime,
        new_arrival_datetime,
        old_aircraft_id,
        new_aircraft_id,
        old_gate,
        new_gate,
        created_by_user_id,
        status
      ]
    );

    return result.insertId;
  }

  /**
   * Update disruption status and execution details
   */
  async updateDisruptionStatus(connection, disruptionId, status, failureReason = null, executedByUserId = null) {
    const dbExec = connection || db.pool;
    let sql = `UPDATE flight_disruptions SET status = ?`;
    const params = [status];

    if (status === 'EXECUTED') {
      sql += `, executed_at = CURRENT_TIMESTAMP`;
    }
    if (failureReason) {
      sql += `, failure_reason = ?`;
      params.push(failureReason);
    }
    if (executedByUserId) {
      sql += `, executed_by_user_id = ?`;
      params.push(executedByUserId);
    }
    sql += ` WHERE disruption_id = ?`;
    params.push(disruptionId);

    await dbExec.execute(sql, params);
  }

  /**
   * Find existing disruption by execution key (Idempotency)
   */
  async findByExecutionKey(connection, executionKey) {
    if (!executionKey) return null;
    const dbExec = connection || db.pool;
    const [rows] = await dbExec.execute(
      `SELECT * FROM flight_disruptions WHERE execution_key = ?`,
      [executionKey]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Batch insert affected passengers into disruption_affected_passengers table
   */
  async addAffectedPassengers(connection, disruptionId, list = []) {
    if (list.length === 0) return;
    const dbExec = connection || db.pool;

    for (const item of list) {
      await dbExec.execute(
        `INSERT INTO disruption_affected_passengers (
          disruption_id, booking_id, passenger_id, ticket_id, seat_number, check_in_status, notification_status
        ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
        ON DUPLICATE KEY UPDATE
          ticket_id = VALUES(ticket_id),
          seat_number = VALUES(seat_number),
          check_in_status = VALUES(check_in_status)`,
        [
          disruptionId,
          item.booking_id,
          item.passenger_id,
          item.ticket_id || null,
          item.seat_number || null,
          item.check_in_status || 'NOT_CHECKED_IN'
        ]
      );
    }
  }

  /**
   * Query disruption history for a flight
   */
  async getDisruptionsByFlight(connection, flightId) {
    const dbExec = connection || db.pool;
    const [rows] = await dbExec.execute(
      `SELECT d.*, u.email as creator_email, u2.email as executor_email
       FROM flight_disruptions d
       LEFT JOIN users u ON d.created_by_user_id = u.user_id
       LEFT JOIN users u2 ON d.executed_by_user_id = u2.user_id
       WHERE d.flight_id = ?
       ORDER BY d.disruption_id DESC`,
      [flightId]
    );
    return rows;
  }

  /**
   * Get pending notifications for worker processing
   */
  async getPendingNotifications(connection, limit = 50) {
    const dbExec = connection || db.pool;
    const [rows] = await dbExec.execute(
      `SELECT ap.*, p.first_name, p.last_name, u.email as user_email, f.flight_number, fd.disruption_type, fd.reason
       FROM disruption_affected_passengers ap
       INNER JOIN flight_disruptions fd ON ap.disruption_id = fd.disruption_id
       INNER JOIN passengers p ON ap.passenger_id = p.passenger_id
       INNER JOIN bookings b ON ap.booking_id = b.booking_id
       INNER JOIN users u ON b.user_id = u.user_id
       INNER JOIN flights f ON fd.flight_id = f.flight_id
       WHERE ap.notification_status = 'PENDING' OR (ap.notification_status = 'FAILED' AND ap.notification_attempts < 3)
       LIMIT ${parseInt(limit, 10)}`
    );
    return rows;
  }

  /**
   * Update notification status after sending attempt
   */
  async updateNotificationStatus(connection, affectedId, status, errorMsg = null) {
    const dbExec = connection || db.pool;
    let sql = `UPDATE disruption_affected_passengers 
               SET notification_status = ?, notification_attempts = notification_attempts + 1`;
    const params = [status];

    if (status === 'SENT') {
      sql += `, notification_sent_at = CURRENT_TIMESTAMP`;
    }
    if (errorMsg) {
      sql += `, notification_error = ?`;
      params.push(errorMsg.substring(0, 500));
    }
    sql += ` WHERE affected_id = ?`;
    params.push(affectedId);

    await dbExec.execute(sql, params);
  }

  /**
   * Recover stale EXECUTING disruptions older than timeoutMinutes
   */
  async recoverStaleExecutions(connection, timeoutMinutes = 5) {
    const dbExec = connection || db.pool;
    const [result] = await dbExec.execute(
      `UPDATE flight_disruptions
       SET status = 'FAILED', failure_reason = 'Stale execution timed out automatically'
       WHERE status = 'EXECUTING' AND execution_started_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [timeoutMinutes]
    );
    return result.affectedRows;
  }
}

module.exports = new DisruptionRepository();
