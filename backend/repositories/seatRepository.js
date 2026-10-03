const { query } = require('../config/database');

class SeatRepository {
  /**
   * Remove any expired temporary seat holds for a flight
   */
  async cleanupExpiredHolds(connection, flightId) {
    await connection.execute(
      `DELETE FROM flight_seat_allocations 
       WHERE flight_id = ? AND status = 'held' AND expires_at <= CURRENT_TIMESTAMP`,
      [flightId]
    );
  }

  /**
   * Count currently active seat allocations (confirmed or unexpired held)
   */
  async countBookedSeats(connection, flightId) {
    await this.cleanupExpiredHolds(connection, flightId);
    
    const [rows] = await connection.execute(
      `SELECT COUNT(*) as booked_seats
       FROM flight_seat_allocations
       WHERE flight_id = ? AND (status = 'confirmed' OR (status = 'held' AND expires_at > CURRENT_TIMESTAMP))`,
      [flightId]
    );
    return Number(rows[0]?.booked_seats || 0);
  }

  /**
   * Verify if seats exist and belong to the specified aircraft
   */
  async verifySeatsBelongToAircraft(connection, aircraftId, seatNumbers, cabinClass = null) {
    if (!seatNumbers || seatNumbers.length === 0) return [];
    
    const placeholders = seatNumbers.map(() => '?').join(',');
    const [rows] = await connection.execute(
      `SELECT seat_number 
       FROM seats 
       WHERE aircraft_id = ? AND seat_number IN (${placeholders}) AND is_available = 1
         AND (? IS NULL OR seat_class = ?)`,
      [aircraftId, ...seatNumbers, cabinClass, cabinClass]
    );

    const validSeats = new Set(rows.map(r => r.seat_number));
    return seatNumbers.filter(s => !validSeats.has(s));
  }

  /**
   * Hold a seat temporarily (e.g. 10 minutes) for a user (AVAILABLE -> HELD)
   */
  async holdSeat(connection, flightId, seatNumber, userId, durationMinutes = 10) {
    await this.cleanupExpiredHolds(connection, flightId);

    try {
      await connection.execute(
        `INSERT INTO flight_seat_allocations (flight_id, seat_number, user_id, status, expires_at)
         VALUES (?, ?, ?, 'held', DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE))`,
        [flightId, seatNumber, userId, durationMinutes]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
        // Check if existing hold is expired
        const [existing] = await connection.execute(
          `SELECT allocation_id, status, expires_at, user_id 
           FROM flight_seat_allocations 
           WHERE flight_id = ? AND seat_number = ?`,
          [flightId, seatNumber]
        );

        if (existing.length > 0) {
          const alloc = existing[0];
          const isExpired = alloc.status === 'held' && new Date(alloc.expires_at) <= new Date();

          if (isExpired) {
            // Delete expired hold and replace
            await connection.execute(`DELETE FROM flight_seat_allocations WHERE allocation_id = ?`, [alloc.allocation_id]);
            await connection.execute(
              `INSERT INTO flight_seat_allocations (flight_id, seat_number, user_id, status, expires_at)
               VALUES (?, ?, ?, 'held', DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE))`,
              [flightId, seatNumber, userId, durationMinutes]
            );
            return;
          }
        }

        const error = new Error(`Seat ${seatNumber} is currently held or booked.`);
        error.code = 'SEAT_UNAVAILABLE';
        error.status = 409;
        throw error;
      }
      throw err;
    }
  }

  /**
   * Confirm seat allocation for a booking (HELD -> CONFIRMED or AVAILABLE -> CONFIRMED)
   */
  async allocateSeat(connection, flightId, seatNumber, bookingId, userId) {
    await this.cleanupExpiredHolds(connection, flightId);
    const [holds] = await connection.execute(
      `SELECT user_id FROM seat_holds WHERE flight_id = ? AND seat_number = ?
       AND status = 'HELD' AND expires_at > NOW() FOR UPDATE`, [flightId, seatNumber]
    );
    if (holds.some(hold => hold.user_id !== userId)) {
      const error = new Error(`Seat ${seatNumber} is held by another passenger.`);
      error.status = 409; error.code = 'SEAT_UNAVAILABLE'; throw error;
    }
    await connection.execute("UPDATE seat_holds SET status = 'CONSUMED' WHERE flight_id = ? AND seat_number = ? AND user_id = ? AND status = 'HELD'", [flightId, seatNumber, userId]);

    // Check if user already holds this seat
    const [existing] = await connection.execute(
      `SELECT allocation_id, status, expires_at, user_id, booking_id 
       FROM flight_seat_allocations 
       WHERE flight_id = ? AND seat_number = ?`,
      [flightId, seatNumber]
    );

    if (existing.length > 0) {
      const alloc = existing[0];
      if (alloc.booking_id === bookingId) {
        // Seat is already allocated to this exact booking (e.g. check-in confirming pre-selected seat)
        return;
      }

      const isUserHold = alloc.status === 'held' && alloc.user_id === userId && new Date(alloc.expires_at) > new Date();
      const isExpired = alloc.status === 'held' && new Date(alloc.expires_at) <= new Date();

      if (isUserHold) {
        // Upgrade HELD -> CONFIRMED
        await connection.execute(
          `UPDATE flight_seat_allocations 
           SET status = 'confirmed', booking_id = ?, expires_at = NULL 
           WHERE allocation_id = ?`,
          [bookingId, alloc.allocation_id]
        );
        return;
      } else if (isExpired) {
        // Delete expired hold and insert confirmed
        await connection.execute(`DELETE FROM flight_seat_allocations WHERE allocation_id = ?`, [alloc.allocation_id]);
      } else {
        const error = new Error(`Seat ${seatNumber} is no longer available.`);
        error.code = 'SEAT_UNAVAILABLE';
        error.status = 409;
        throw error;
      }
    }

    // Insert new confirmed allocation
    try {
      await connection.execute(
        `INSERT INTO flight_seat_allocations (flight_id, seat_number, booking_id, user_id, status, expires_at)
         VALUES (?, ?, ?, ?, 'confirmed', NULL)`,
        [flightId, seatNumber, bookingId, userId]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
        const error = new Error(`Seat ${seatNumber} is no longer available.`);
        error.code = 'SEAT_UNAVAILABLE';
        error.status = 409;
        throw error;
      }
      throw err;
    }
  }

  /**
   * Release seats when a booking is cancelled (CONFIRMED -> CANCELLED -> AVAILABLE)
   */
  async releaseSeatsForBooking(connection, bookingId) {
    await connection.execute(
      `DELETE FROM flight_seat_allocations WHERE booking_id = ?`,
      [bookingId]
    );
  }
}

module.exports = new SeatRepository();
