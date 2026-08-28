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
      payment_status = 'paid',
      payment_method = 'Credit Card'
    } = bookingData;
    
    const initialStatus = (status || 'CONFIRMED').toUpperCase();
    const initialPayment = (payment_status || 'paid').toLowerCase();

    const [result] = await connection.execute(
      `INSERT INTO bookings (
        booking_reference, user_id, flight_id, number_of_passengers, 
        class, total_amount, status, payment_status, payment_method, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [booking_reference, user_id, flight_id, number_of_passengers, flightClass, total_amount, initialStatus, initialPayment, payment_method, idempotency_key || null]
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

  /**
   * Retrieve complete booking record with Customer, Flight, Airports, Aircraft, Passengers, Tickets and Check-in details
   */
  async getCompleteBookingDetails(connection, bookingId) {
    const conn = connection || require('../config/database').pool;
    const [rows] = await conn.execute(
      `SELECT 
        b.booking_id,
        b.booking_reference,
        b.user_id,
        b.flight_id,
        b.booking_date,
        b.number_of_passengers,
        b.class,
        b.total_amount,
        b.status,
        b.payment_status,
        b.payment_method,
        b.confirmed_at,
        b.checked_in_at,
        b.boarded_at,
        b.completed_at,
        b.cancelled_at,
        b.created_at,
        b.updated_at,
        u.first_name AS customer_first_name,
        u.last_name AS customer_last_name,
        u.email AS customer_email,
        u.phone AS customer_phone,
        f.flight_number,
        f.departure_datetime,
        f.arrival_datetime,
        f.status AS flight_status,
        dep.airport_code AS departure_airport_code,
        dep.airport_name AS departure_airport_name,
        dep.city AS departure_city,
        dep.country AS departure_country,
        arr.airport_code AS arrival_airport_code,
        arr.airport_name AS arrival_airport_name,
        arr.city AS arrival_city,
        arr.country AS arrival_country,
        a.model AS aircraft_model,
        a.registration AS aircraft_registration,
        ci.check_in_id,
        ci.gate_number,
        ci.boarding_time,
        ci.status AS check_in_status
       FROM bookings b
       INNER JOIN users u ON b.user_id = u.user_id
       INNER JOIN flights f ON b.flight_id = f.flight_id
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       LEFT JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       LEFT JOIN check_ins ci ON b.booking_id = ci.booking_id
       WHERE b.booking_id = ?`,
      [bookingId]
    );

    if (rows.length === 0) return null;
    const booking = rows[0];

    const [passengers] = await conn.execute(
      `SELECT 
        p.passenger_id,
        p.first_name,
        p.last_name,
        p.date_of_birth,
        p.passport_number,
        p.nationality,
        bp.seat_number
       FROM booking_passengers bp
       INNER JOIN passengers p ON bp.passenger_id = p.passenger_id
       WHERE bp.booking_id = ?
       ORDER BY bp.booking_passenger_id ASC`,
      [bookingId]
    );

    const [tickets] = await conn.execute(
      `SELECT 
        ticket_id,
        ticket_number,
        passenger_id,
        seat_number,
        cabin_class,
        status
       FROM tickets
       WHERE booking_id = ?`,
      [bookingId]
    );

    return {
      ...booking,
      passengers: passengers || [],
      tickets: tickets || []
    };
  }
}

module.exports = new BookingRepository();

