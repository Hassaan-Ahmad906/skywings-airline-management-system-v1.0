const { query } = require('../config/database');

class SeatHoldRepository {
  /**
   * Request-time cleanup: Mark expired holds as 'EXPIRED'
   */
  async cleanupExpiredHolds(connection, flightId = null) {
    let sql = `UPDATE seat_holds SET status = 'EXPIRED' WHERE status = 'HELD' AND expires_at <= CURRENT_TIMESTAMP`;
    const params = [];

    if (flightId) {
      sql += ` AND flight_id = ?`;
      params.push(flightId);
    }

    await connection.execute(sql, params);
  }

  /**
   * Fetch all active unexpired holds for a flight
   */
  async getActiveHoldsForFlight(connection, flightId) {
    await this.cleanupExpiredHolds(connection, flightId);

    const [rows] = await connection.execute(
      `SELECT hold_id, flight_id, seat_number, user_id, session_id, passenger_index, status, expires_at 
       FROM seat_holds 
       WHERE flight_id = ? AND status = 'HELD' AND expires_at > CURRENT_TIMESTAMP`,
      [flightId]
    );

    return rows;
  }

  /**
   * Find an active hold by hold_id
   */
  async findActiveHoldById(connection, holdId) {
    const [rows] = await connection.execute(
      `SELECT * FROM seat_holds WHERE hold_id = ? AND status = 'HELD' AND expires_at > CURRENT_TIMESTAMP FOR UPDATE`,
      [holdId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find all active holds for a session and user
   */
  async findActiveHoldsBySession(connection, sessionId, userId) {
    const [rows] = await connection.execute(
      `SELECT * FROM seat_holds 
       WHERE session_id = ? AND user_id = ? AND status = 'HELD' AND expires_at > CURRENT_TIMESTAMP 
       FOR UPDATE`,
      [sessionId, userId]
    );
    return rows;
  }

  /**
   * Check if a specific seat is occupied (confirmed booking assignment OR active unexpired hold)
   */
  async isSeatOccupied(connection, flightId, seatNumber, excludeHoldId = null) {
    await this.cleanupExpiredHolds(connection, flightId);

    // 1. Check confirmed bookings
    const [bookedRows] = await connection.execute(
      `SELECT bp.seat_number 
       FROM booking_passengers bp 
       INNER JOIN bookings b ON bp.booking_id = b.booking_id 
       WHERE b.flight_id = ? AND b.status != 'cancelled' AND UPPER(bp.seat_number) = UPPER(?)`,
      [flightId, seatNumber]
    );

    if (bookedRows.length > 0) return true;

    // 2. Check active unexpired holds
    let holdSql = `SELECT hold_id FROM seat_holds WHERE flight_id = ? AND UPPER(seat_number) = UPPER(?) AND status = 'HELD' AND expires_at > CURRENT_TIMESTAMP`;
    const holdParams = [flightId, seatNumber];

    if (excludeHoldId) {
      holdSql += ` AND hold_id != ?`;
      holdParams.push(excludeHoldId);
    }

    const [holdRows] = await connection.execute(holdSql, holdParams);
    return holdRows.length > 0;
  }

  /**
   * Create or update temporary seat hold for a passenger index
   */
  async createOrUpdateHold(connection, { flightId, seatNumber, userId, sessionId, passengerIndex, durationMinutes = 10 }) {
    await this.cleanupExpiredHolds(connection, flightId);

    const seatUpper = seatNumber.trim().toUpperCase();

    // Check if the requested seat is occupied
    const occupied = await this.isSeatOccupied(connection, flightId, seatUpper);
    if (occupied) {
      const error = new Error(`Seat ${seatUpper} is no longer available.`);
      error.code = 'SEAT_UNAVAILABLE';
      error.status = 409;
      throw error;
    }

    // Step-change handling: Release ONLY previous hold for (flight_id, session_id, passenger_index)
    await connection.execute(
      `UPDATE seat_holds 
       SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP 
       WHERE flight_id = ? AND session_id = ? AND passenger_index = ? AND status = 'HELD'`,
      [flightId, sessionId, passengerIndex]
    );

    // Insert new HELD record
    try {
      const [result] = await connection.execute(
        `INSERT INTO seat_holds (
          flight_id, seat_number, user_id, session_id, passenger_index, 
          status, expires_at
        ) VALUES (?, ?, ?, ?, ?, 'HELD', DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE))`,
        [flightId, seatUpper, userId, sessionId, passengerIndex, durationMinutes]
      );

      const [holdRows] = await connection.execute(
        `SELECT * FROM seat_holds WHERE hold_id = ?`,
        [result.insertId]
      );

      return holdRows[0];
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
        const error = new Error(`Seat ${seatUpper} is no longer available.`);
        error.code = 'SEAT_UNAVAILABLE';
        error.status = 409;
        throw error;
      }
      throw err;
    }
  }

  /**
   * Release hold by hold_id owned by userId
   */
  async releaseHold(connection, holdId, userId) {
    const [holdRows] = await connection.execute(
      `SELECT * FROM seat_holds WHERE hold_id = ?`,
      [holdId]
    );

    if (holdRows.length === 0) {
      const error = new Error('Seat hold not found.');
      error.code = 'HOLD_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    const hold = holdRows[0];
    if (hold.user_id !== userId) {
      const error = new Error('You are not authorized to release this seat hold.');
      error.code = 'FORBIDDEN';
      error.status = 403;
      throw error;
    }

    if (hold.status === 'HELD') {
      await connection.execute(
        `UPDATE seat_holds SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP WHERE hold_id = ?`,
        [holdId]
      );
    }

    return { message: 'Seat hold released successfully' };
  }

  /**
   * Mark all active holds in session as CONSUMED upon successful booking
   */
  async markHoldsConsumed(connection, sessionId, userId) {
    await connection.execute(
      `UPDATE seat_holds 
       SET status = 'CONSUMED', updated_at = CURRENT_TIMESTAMP 
       WHERE session_id = ? AND user_id = ? AND status = 'HELD'`,
      [sessionId, userId]
    );
  }

  /**
   * Release all active holds on flight cancellation
   */
  async releaseHoldsForCancelledFlight(connection, flightId) {
    await connection.execute(
      `UPDATE seat_holds 
       SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP 
       WHERE flight_id = ? AND status = 'HELD'`,
      [flightId]
    );
  }
}

module.exports = new SeatHoldRepository();
