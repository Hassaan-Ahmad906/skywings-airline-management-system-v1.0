const db = require('../config/database');

class RebookingRepository {
  /**
   * Search operational alternative candidate flights for a route matching passenger count
   */
  async getAlternativeFlights(connection, currentFlightId, fromCode, toCode, passengerCount = 1) {
    const dbExec = connection || db.pool;
    const [rows] = await dbExec.execute(
      `SELECT f.flight_id, f.flight_number, f.departure_datetime, f.arrival_datetime, f.status,
              f.base_price, f.business_price, f.first_class_price,
              a.aircraft_id, a.model as aircraft_model, a.capacity,
              dep.city as from_city, arr.city as to_city,
              (a.capacity - (
                SELECT COUNT(*) FROM booking_passengers bp
                INNER JOIN bookings b ON bp.booking_id = b.booking_id
                WHERE b.flight_id = f.flight_id AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'confirmed')
              )) as available_seats
       FROM flights f
       INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       WHERE f.from_airport_code = ? AND f.to_airport_code = ?
         AND f.flight_id != ?
         AND f.status IN ('scheduled', 'delayed')
         AND f.departure_datetime > NOW()
       HAVING available_seats >= ?
       ORDER BY f.departure_datetime ASC`,
      [fromCode, toCode, currentFlightId, parseInt(passengerCount, 10)]
    );

    return rows;
  }

  /**
   * Find existing rebooking record by idempotency key
   */
  async findByRebookingKey(connection, rebookingKey) {
    if (!rebookingKey) return null;
    const dbExec = connection || db.pool;
    const [rows] = await dbExec.execute(
      `SELECT * FROM booking_rebooking_history WHERE rebooking_key = ?`,
      [rebookingKey]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Create rebooking history record
   */
  async createRebookingHistory(connection, data) {
    const dbExec = connection || db.pool;
    const {
      booking_id,
      old_flight_id,
      new_flight_id,
      rebooking_reason,
      actor_user_id = null,
      actor_type = 'USER',
      rebooking_key = null,
      old_seats_json = null,
      new_seats_json = null,
      notes = null,
      status = 'COMPLETED',
      failure_reason = null
    } = data;

    const [result] = await dbExec.execute(
      `INSERT INTO booking_rebooking_history (
        booking_id, old_flight_id, new_flight_id, rebooking_reason,
        actor_user_id, actor_type, rebooking_key,
        old_seats_json, new_seats_json, notes, status, failure_reason, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        booking_id,
        old_flight_id,
        new_flight_id,
        rebooking_reason,
        actor_user_id,
        actor_type,
        rebooking_key,
        old_seats_json ? JSON.stringify(old_seats_json) : null,
        new_seats_json ? JSON.stringify(new_seats_json) : null,
        notes,
        status,
        failure_reason
      ]
    );

    return result.insertId;
  }

  /**
   * Get rebooking history for a booking
   */
  async getHistoryByBooking(connection, bookingId) {
    const dbExec = connection || db.pool;
    const [rows] = await dbExec.execute(
      `SELECT h.*, 
              fOld.flight_number as old_flight_number, fNew.flight_number as new_flight_number,
              u.email as actor_email
       FROM booking_rebooking_history h
       INNER JOIN flights fOld ON h.old_flight_id = fOld.flight_id
       INNER JOIN flights fNew ON h.new_flight_id = fNew.flight_id
       LEFT JOIN users u ON h.actor_user_id = u.user_id
       WHERE h.booking_id = ?
       ORDER BY h.rebooking_id DESC`,
      [bookingId]
    );

    return rows.map(r => ({
      ...r,
      old_seats_json: r.old_seats_json ? (typeof r.old_seats_json === 'string' ? JSON.parse(r.old_seats_json) : r.old_seats_json) : [],
      new_seats_json: r.new_seats_json ? (typeof r.new_seats_json === 'string' ? JSON.parse(r.new_seats_json) : r.new_seats_json) : []
    }));
  }
}

module.exports = new RebookingRepository();
