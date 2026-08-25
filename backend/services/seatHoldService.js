const db = require('../config/database');
const flightRepository = require('../repositories/flightRepository');
const seatRepository = require('../repositories/seatRepository');
const seatHoldRepository = require('../repositories/seatHoldRepository');

class SeatHoldService {
  getHoldDurationMinutes() {
    const duration = parseInt(process.env.SEAT_HOLD_DURATION_MINUTES, 10);
    return !isNaN(duration) && duration > 0 ? duration : 10;
  }

  /**
   * Create or update a temporary seat hold for a passenger
   */
  async createOrChangeHold(userId, { flight_id, seat_number, session_id, passenger_index = 0 }) {
    if (!flight_id || !seat_number || !session_id) {
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

      // 3. Create or update seat hold
      const hold = await seatHoldRepository.createOrUpdateHold(connection, {
        flightId: flight_id,
        seatNumber: seatUpper,
        userId,
        sessionId: session_id,
        passengerIndex: parseInt(passenger_index, 10) || 0,
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
      let templateSeats = [];
      try {
        const [rows] = await connection.execute(
          `SELECT seat_number, seat_class, \`row_number\`, column_letter 
           FROM seats 
           WHERE aircraft_id = ? 
           ORDER BY \`row_number\`, column_letter`,
          [flight.aircraft_id]
        );
        templateSeats = rows || [];
      } catch (err) {
        console.warn('Warning querying seats table, falling back to layout generator:', err.message);
      }

      // If no seat templates exist for this aircraft, generate dynamic standard seat grid
      if (templateSeats.length === 0) {
        const capacity = flight.capacity || 150;
        const totalRows = Math.ceil(capacity / 6);
        for (let r = 1; r <= totalRows; r++) {
          for (let c = 1; c <= 6; c++) {
            if (templateSeats.length >= capacity) break;
            const letter = String.fromCharCode(64 + c);
            const seatClass = r <= 2 ? 'first' : r <= 5 ? 'business' : 'economy';
            templateSeats.push({
              seat_number: `${r}${letter}`,
              seat_class: seatClass,
              row_number: r,
              column_letter: letter
            });
          }
        }
      }

      // 3. Query confirmed booking seat assignments
      const [confirmedSeats] = await connection.execute(
        `SELECT bp.seat_number 
         FROM booking_passengers bp
         INNER JOIN bookings b ON bp.booking_id = b.booking_id
         WHERE b.flight_id = ? AND b.status != 'cancelled' AND bp.seat_number IS NOT NULL AND bp.seat_number != ''`,
        [flightId]
      );
      const confirmedSet = new Set(confirmedSeats.map(s => s.seat_number.toUpperCase()));

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

        if (confirmedSet.has(seatNumUpper)) {
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
          expires_at: expiresAt
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
