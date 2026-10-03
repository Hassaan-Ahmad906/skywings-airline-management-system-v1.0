const db = require('../config/database');
const flightRepository = require('../repositories/flightRepository');
const seatRepository = require('../repositories/seatRepository');
const seatHoldRepository = require('../repositories/seatHoldRepository');

class SeatHoldService {
  getHoldDurationMinutes() {
    const duration = parseInt(process.env.SEAT_HOLD_DURATION_MINUTES, 10);
    return !isNaN(duration) && duration > 0 ? Math.min(10, duration) : 10;
  }

  /**
   * Create or update a temporary seat hold for a passenger
   */
  async createOrChangeHold(userId, { flight_id, seat_number, session_id, passenger_index = 0, booking_id = null }) {
    if (!Number.isSafeInteger(Number(flight_id)) || Number(flight_id) < 1 ||
        typeof seat_number !== 'string' || !/^[0-9]{1,3}[A-Z]$/i.test(seat_number.trim()) ||
        typeof session_id !== 'string' || !session_id.trim() || session_id.length > 100 ||
        !Number.isSafeInteger(Number(passenger_index)) || Number(passenger_index) < 0 || Number(passenger_index) > 8 ||
        (booking_id !== null && (!Number.isSafeInteger(Number(booking_id)) || Number(booking_id) < 1))) {
      const error = new Error('flight_id, seat_number, and session_id are required.');
      error.code = 'INVALID_INPUT';
      error.status = 400;
      throw error;
    }

    const durationMinutes = this.getHoldDurationMinutes();
    const connection = await db.pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Lock flight exclusively
      const flight = await flightRepository.findByIdForUpdate(connection, flight_id);
      if (!flight) {
        const error = new Error('Flight not found or not available for booking.');
        error.code = 'FLIGHT_NOT_AVAILABLE';
        error.status = 404;
        throw error;
      }

      // Check if flight is cancelled
      if (flight.status === 'cancelled') {
        const error = new Error('Cannot hold seats on a cancelled flight.');
        error.code = 'FLIGHT_CANCELLED';
        error.status = 400;
        throw error;
      }

      // 2. Validate seat exists on flight's aircraft model
      const seatUpper = seat_number.trim().toUpperCase();
      const invalidSeats = await seatRepository.verifySeatsBelongToAircraft(connection, flight.aircraft_id, [seatUpper]);
      if (invalidSeats.length > 0) {
        const error = new Error(`Seat ${seatUpper} does not exist on the aircraft assigned to this flight.`);
        error.code = 'INVALID_SEAT';
        error.status = 400;
        throw error;
      }

      const [ownedHolds] = await connection.execute("SELECT * FROM seat_holds WHERE flight_id = ? AND user_id = ? AND status = 'HELD' AND expires_at > NOW()", [flight_id, userId]);
      const replacing = ownedHolds.filter(hold => hold.session_id === session_id && hold.passenger_index === Number(passenger_index));
      if (!replacing.length && ownedHolds.length >= 9) throw Object.assign(new Error('You may hold at most nine seats on a flight'), { status: 409 });
      if (booking_id !== null) {
        const [bookings] = await connection.execute("SELECT class, number_of_passengers FROM bookings WHERE booking_id = ? AND user_id = ? AND flight_id = ? AND status = 'CONFIRMED' AND payment_status = 'paid' FOR UPDATE", [Number(booking_id), userId, flight_id]);
        const booking = bookings[0];
        if (!booking || Number(passenger_index) >= booking.number_of_passengers) throw Object.assign(new Error('Booking is unavailable for this seat selection'), { status: 403 });
        if ((await seatRepository.verifySeatsBelongToAircraft(connection, flight.aircraft_id, [seatUpper], booking.class)).length) throw Object.assign(new Error('Choose a seat in your booked cabin'), { status: 400 });
      } else {
        const [seats] = await connection.execute('SELECT seat_class FROM seats WHERE aircraft_id = ? AND seat_number = ?', [flight.aircraft_id, seatUpper]);
        await require('../repositories/bookingRepository').assertCapacity(connection, flight, seats[0].seat_class, 1, null, replacing.map(hold => hold.seat_number));
      }

      // 3. Create or update seat hold
      const hold = await seatHoldRepository.createOrUpdateHold(connection, {
        flightId: flight_id,
        seatNumber: seatUpper,
        userId,
        sessionId: session_id,
        passengerIndex: parseInt(passenger_index, 10) || 0,
        bookingId: booking_id === null ? null : Number(booking_id),
        durationMinutes
      });

      await connection.commit();
      return hold;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Fetch complete unified seat map combining aircraft seats, confirmed bookings, and active holds
   */
  async getUnifiedSeatMap(flightId, currentUserId = null) {
    const connection = await db.pool.getConnection();

    try {
      // 1. Fetch flight & aircraft info
      const [flights] = await connection.execute(
        `SELECT f.flight_id, f.aircraft_id, f.status, a.model as aircraft_model, a.capacity
         FROM flights f
         INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id
         WHERE f.flight_id = ?`,
        [flightId]
      );

      if (flights.length === 0) {
        const error = new Error('Flight not found.');
        error.code = 'FLIGHT_NOT_FOUND';
        error.status = 404;
        throw error;
      }

      const flight = flights[0];

      // 2. Query physical aircraft seat templates with escaped `row_number`
      const [templateSeats] = await connection.execute(
        'SELECT seat_number, seat_class, is_available FROM seats WHERE aircraft_id = ? ORDER BY `row_number`, column_letter',
        [flight.aircraft_id]);
      if (!templateSeats.length) throw Object.assign(new Error('Aircraft seat layout is unavailable'), { status: 409, code: 'SEAT_LAYOUT_UNAVAILABLE' });

      // 3. Query confirmed booking seat assignments
      const [confirmedSeats] = await connection.execute(
        `SELECT bp.seat_number, b.booking_id, b.user_id
         FROM booking_passengers bp
         INNER JOIN bookings b ON bp.booking_id = b.booking_id
         WHERE b.flight_id = ? AND b.status IN ('PENDING','CONFIRMED','CHECKED_IN','BOARDED')
           AND (b.status <> 'PENDING' OR b.reservation_expires_at IS NULL OR b.reservation_expires_at > NOW())
           AND bp.seat_number IS NOT NULL AND bp.seat_number != ''`,
        [flightId]
      );
      const confirmedMap = new Map(confirmedSeats.map(s => [s.seat_number.toUpperCase(), s]));

      // 4. Query active unexpired temporary seat holds
      const activeHolds = await seatHoldRepository.getActiveHoldsForFlight(connection, flightId);
      const holdMap = new Map();
      activeHolds.forEach(h => {
        holdMap.set(h.seat_number.toUpperCase(), h);
      });

      // 5. Build unified seat list
      const seatList = templateSeats.map(seat => {
        const seatNumUpper = seat.seat_number.toUpperCase();
        let status = 'AVAILABLE';
        let mine = false;
        let expiresAt = null;

        if (!seat.is_available) {
          status = 'UNAVAILABLE';
        } else if (confirmedMap.has(seatNumUpper)) {
          status = 'BOOKED';
        } else if (holdMap.has(seatNumUpper)) {
          const hold = holdMap.get(seatNumUpper);
          status = 'HELD';
          if (currentUserId && hold.user_id === currentUserId) {
            mine = true;
            expiresAt = hold.expires_at;
          }
        }

        return {
          seat_number: seat.seat_number,
          seat_class: seat.seat_class,
          status,
          mine,
          expires_at: expiresAt,
          booking_id: confirmedMap.get(seatNumUpper)?.user_id === currentUserId ? confirmedMap.get(seatNumUpper).booking_id : null,
          hold_id: mine ? holdMap.get(seatNumUpper).hold_id : null,
          session_id: mine ? holdMap.get(seatNumUpper).session_id : null,
          passenger_index: mine ? holdMap.get(seatNumUpper).passenger_index : null
        };
      });

      return {
        flight_id: flight.flight_id,
        aircraft_model: flight.aircraft_model,
        total_capacity: flight.capacity,
        seats: seatList
      };

    } finally {
      connection.release();
    }
  }

  /**
   * Release active seat hold by ID owned by user
   */
  async releaseHold(userId, holdId) {
    const connection = await db.pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await seatHoldRepository.releaseHold(connection, holdId, userId);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = new SeatHoldService();
