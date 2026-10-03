const db = require('../config/database');
const stateMachine = require('./bookingStateMachine');
const ticketService = require('./ticketService');

function demoEnabled() {
  return process.env.PAYMENT_MODE === 'demo' && process.env.NODE_ENV !== 'production';
}

async function confirmDemoPayment(userId, bookingId, transaction = null) {
  if (!demoEnabled()) {
    const error = new Error('Online payments are unavailable. Your reservation remains unpaid.');
    error.status = 503;
    error.code = 'PAYMENT_UNAVAILABLE';
    throw error;
  }
  if (!Number.isSafeInteger(bookingId) || bookingId < 1) {
    const error = new Error('Invalid booking ID');
    error.status = 400;
    throw error;
  }
  const connection = transaction || await db.pool.getConnection();
  try {
    if (!transaction) await connection.beginTransaction();
    const fail = (message, status = 409) => { const error = new Error(message); error.status = status; throw error; };
    const [metadata] = await connection.execute('SELECT flight_id FROM bookings WHERE booking_id = ? AND user_id = ?', [bookingId, userId]);
    if (!metadata.length) fail('Booking not found', 404);
    // Every inventory mutation locks the flight before its bookings.
    const [flights] = await connection.execute('SELECT departure_datetime, status FROM flights WHERE flight_id = ? FOR UPDATE', [metadata[0].flight_id]);
    const [rows] = await connection.execute(
      'SELECT * FROM bookings WHERE booking_id = ? AND user_id = ? FOR UPDATE', [bookingId, userId]
    );
    const booking = rows[0];
    if (!booking) fail('Booking not found', 404);
    if (booking.flight_id !== metadata[0].flight_id) fail('This booking changed. Refresh before confirming.');
    if (!flights.length) fail('Flight not found', 404);
    booking.departure_datetime = flights[0].departure_datetime;
    booking.flight_status = flights[0].status;
    if (booking.status === 'CONFIRMED' && booking.payment_status === 'paid' && booking.payment_method === 'Demo') {
      if (!transaction) await connection.commit();
      return { booking_id: bookingId, demo: true, already_confirmed: true };
    }
    if (String(booking.status).toUpperCase() !== 'PENDING') fail('Only pending reservations can be confirmed.');
    if (new Date(booking.departure_datetime) <= new Date() || booking.flight_status === 'cancelled') fail('This flight is no longer available.');
    if (booking.reservation_expires_at && new Date(booking.reservation_expires_at) <= new Date()) fail('This reservation has expired.');
    await connection.execute("UPDATE bookings SET payment_status = 'paid', payment_method = 'Demo' WHERE booking_id = ?", [bookingId]);
    await stateMachine.transitionBookingState(connection, bookingId, 'CONFIRMED',
      { userId, role: 'user', type: 'BOOKING_SERVICE' }, 'Development demo confirmation; no money collected');
    const [passengers] = await connection.execute('SELECT passenger_id, seat_number FROM booking_passengers WHERE booking_id = ?', [bookingId]);
    await ticketService.issueTicketsForBooking(connection, bookingId, booking.flight_id, booking.class, passengers, userId);
    if (!transaction) await connection.commit();
    // Demo confirmations must never trigger external customer notifications.
    return { booking_id: bookingId, demo: true };
  } catch (error) {
    if (!transaction) await connection.rollback();
    throw error;
  } finally {
    if (!transaction) connection.release();
  }
}

module.exports = { demoEnabled, confirmDemoPayment };
