const { query } = require('../config/database');

class BookingRepository {
  /**
   * Count every passenger holding capacity on a flight. A booking holds capacity
   * from confirmation onward, including before a seat is selected at check-in.
   */
  async countCapacityReserved(connection, flightId) {
    const [rows] = await connection.execute(
      `SELECT COALESCE(SUM(number_of_passengers), 0) AS reserved_seats
       FROM bookings
       WHERE flight_id = ? AND status IN ('pending', 'confirmed')`,
      [flightId]
    );

    return Number(rows[0]?.reserved_seats || 0);
  }

  /**
   * Find existing booking by user_id and idempotency_key
   */
  async findByUserAndIdempotencyKey(connection, userId, idempotencyKey) {
    if (!idempotencyKey) return null;
    const [rows] = await connection.execute(
      `SELECT * FROM bookings WHERE user_id = ? AND idempotency_key = ? FOR UPDATE`,
      [userId, idempotencyKey]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Create a new booking record
   */
  async createBooking(connection, bookingData) {
    const { 
      booking_reference, 
      user_id, 
      flight_id, 
      number_of_passengers, 
      class: flightClass, 
      total_amount, 
      idempotency_key = null,
      status = 'CONFIRMED',
      payment_status = 'paid'
    } = bookingData;
    
    const initialStatus = (status || 'CONFIRMED').toUpperCase();
    const initialPayment = (payment_status || 'paid').toLowerCase();

    const [result] = await connection.execute(
      `INSERT INTO bookings (
        booking_reference, user_id, flight_id, number_of_passengers, 
        class, total_amount, status, payment_status, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [booking_reference, user_id, flight_id, number_of_passengers, flightClass, total_amount, initialStatus, initialPayment, idempotency_key || null]
    );
    
    return result.insertId;
  }

  /**
   * Create or link passenger and map to booking_passengers
   */
  async addPassengerToBooking(connection, bookingId, userId, passengerData) {
    let passengerId = passengerData.passenger_id;

    if (!passengerId) {
      const [passengerResult] = await connection.execute(
        `INSERT INTO passengers (
          user_id, first_name, last_name, date_of_birth, 
          passport_number, nationality, is_saved
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          passengerData.first_name,
          passengerData.last_name,
          passengerData.date_of_birth || null,
          passengerData.passport_number || null,
          passengerData.nationality || null,
          passengerData.save ? 1 : 0
        ]
      );
      passengerId = passengerResult.insertId;
    }

    await connection.execute(
      `INSERT INTO booking_passengers (booking_id, passenger_id, seat_number)
       VALUES (?, ?, ?)`,
      [bookingId, passengerId, passengerData.seat_number || null]
    );

    return passengerId;
  }

  /**
   * Find booking by ID for a specific user or admin (with lock if requested)
   */
  async findById(connection, bookingId, userId = null, forUpdate = false) {
    let sql = `SELECT * FROM bookings WHERE booking_id = ?`;
    const params = [bookingId];

    if (userId) {
      sql += ` AND user_id = ?`;
      params.push(userId);
    }

    if (forUpdate) {
      sql += ` FOR UPDATE`;
    }

    const [rows] = await connection.execute(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Update status of a booking
   */
  async updateStatus(connection, bookingId, status, paymentStatus = null) {
    let sql = `UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP`;
    const params = [status];

    if (paymentStatus) {
      sql += `, payment_status = ?`;
      params.push(paymentStatus);
    }

    sql += ` WHERE booking_id = ?`;
    params.push(bookingId);

    await connection.execute(sql, params);
  }
}

module.exports = new BookingRepository();
