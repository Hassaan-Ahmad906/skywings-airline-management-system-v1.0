const db = require('../config/database');
const rebookingPolicy = require('./rebookingPolicy');
const rebookingRepository = require('../repositories/rebookingRepository');
const seatRepository = require('../repositories/seatRepository');
const seatAllocationService = require('./seatAllocationService');
const bookingStateMachine = require('./bookingStateMachine');
const ticketRepository = require('../repositories/ticketRepository');
const auditService = require('./auditService');

class RebookingService {
  /**
   * Search operational alternative candidate flights for a booking without reserving seats
   */
  async getEligibleAlternatives(bookingId, requestingUser) {
    const pool = db.pool;
    const [bookingRows] = await pool.execute(
      `SELECT b.*, f.from_airport_code, f.to_airport_code, f.flight_number
       FROM bookings b
       INNER JOIN flights f ON b.flight_id = f.flight_id
       WHERE b.booking_id = ?`,
      [bookingId]
    );

    if (bookingRows.length === 0) {
      const error = new Error('Booking not found.');
      error.code = 'BOOKING_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    const booking = bookingRows[0];
    rebookingPolicy.validateBookingEligibility(booking, 'CUSTOMER_REQUEST', requestingUser);

    const candidateFlights = await rebookingRepository.getAlternativeFlights(
      pool,
      booking.flight_id,
      booking.from_airport_code,
      booking.to_airport_code,
      booking.number_of_passengers,
      booking.class
    );

    return {
      booking_id: bookingId,
      current_flight_id: booking.flight_id,
      current_flight_number: booking.flight_number,
      passenger_count: booking.number_of_passengers,
      alternatives: candidateFlights
    };
  }

  /**
   * Preview rebooking calculations, available seats, and seat conflicts
   */
  async previewRebooking(bookingId, newFlightId, requestedSeats = [], requestingUser) {
    const pool = db.pool;
    const [bookingRows] = await pool.execute(
      `SELECT b.*, f.from_airport_code, f.to_airport_code, f.aircraft_id as old_aircraft_id
       FROM bookings b
       INNER JOIN flights f ON b.flight_id = f.flight_id
       WHERE b.booking_id = ?`,
      [bookingId]
    );

    if (bookingRows.length === 0) {
      const error = new Error('Booking not found.');
      error.code = 'BOOKING_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    const booking = bookingRows[0];
    rebookingPolicy.validateBookingEligibility(booking, 'CUSTOMER_REQUEST', requestingUser);

    const [targetFlightRows] = await pool.execute(
      `SELECT f.*, a.capacity, a.aircraft_id
       FROM flights f
       INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       WHERE f.flight_id = ?`,
      [newFlightId]
    );

    if (targetFlightRows.length === 0) {
      const error = new Error('Target flight not found.');
      error.code = 'TARGET_FLIGHT_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    const targetFlight = targetFlightRows[0];
    rebookingPolicy.validateTargetFlight(booking, targetFlight);

    // Fetch passenger details
    const [passengers] = await pool.execute(
      `SELECT p.passenger_id, p.first_name, p.last_name, bp.seat_number
       FROM booking_passengers bp
       INNER JOIN passengers p ON bp.passenger_id = p.passenger_id
       WHERE bp.booking_id = ?`,
      [bookingId]
    );

    return {
      eligible: true,
      booking_id: bookingId,
      passengers_count: passengers.length,
      old_flight_id: booking.flight_id,
      new_flight_id: newFlightId,
      new_flight_number: targetFlight.flight_number,
      departure_datetime: targetFlight.departure_datetime,
      passengers: passengers
    };
  }

  /**
   * Executes flight rebooking with deterministic lock ordering and atomic seat/ticket updates
   */
  async executeRebooking(connection, bookingId, newFlightId, newSeatMappings = [], reason = 'CUSTOMER_REQUEST', requestingUser, rebookingKey = null) {
    const [metadata] = await connection.execute('SELECT * FROM bookings WHERE booking_id = ?', [bookingId]);
    if (!metadata.length) throw Object.assign(new Error('Booking not found'), { status: 404 });
    rebookingPolicy.validateBookingEligibility(metadata[0], reason, requestingUser);
    if (!Array.isArray(newSeatMappings) || (newSeatMappings.length && newSeatMappings.length !== metadata[0].number_of_passengers)) throw Object.assign(new Error('Provide one seat for each passenger or omit all seat choices'), { status: 400 });
    const seats = newSeatMappings.map(value => typeof value === 'object' ? value?.seat_number : value);
    if (seats.some(value => typeof value !== 'string' || !/^\d{1,3}[A-Z]$/i.test(value)) || new Set(seats.map(value => value.toUpperCase())).size !== seats.length) throw Object.assign(new Error('Invalid or duplicate seats'), { status: 400 });
    for (const id of [...new Set([metadata[0].flight_id, newFlightId])].sort((a, b) => a - b)) await connection.execute('SELECT flight_id FROM flights WHERE flight_id = ? FOR UPDATE', [id]);
    // Lock and revalidate the booking after deterministic flight locks.
    const [bookingRows] = await connection.execute(
      `SELECT * FROM bookings WHERE booking_id = ? FOR UPDATE`,
      [bookingId]
    );

    if (bookingRows.length === 0) {
      const error = new Error('Booking not found.');
      error.code = 'BOOKING_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    const booking = bookingRows[0];
    const oldFlightId = booking.flight_id;

    // Authorize before returning any idempotent result or locking other flights.
    rebookingPolicy.validateBookingEligibility(booking, reason, requestingUser);
    if (rebookingKey) {
      const existing = await rebookingRepository.findByRebookingKey(connection, rebookingKey);
      if (existing) {
        if (existing.booking_id !== bookingId) {
          const error = new Error('Rebooking key is already used for another booking.');
          error.status = 409;
          error.code = 'REBOOKING_KEY_CONFLICT';
          throw error;
        }
        return { rebooking: existing, isDuplicateExecution: true };
      }
    }

    if (oldFlightId !== metadata[0].flight_id) throw Object.assign(new Error('Booking changed during rebooking. Please retry.'), { status: 409 });
    const [oldFlights] = await connection.execute('SELECT * FROM flights WHERE flight_id = ?', [oldFlightId]);
    const [targets] = await connection.execute('SELECT * FROM flights WHERE flight_id = ?', [newFlightId]);
    const targetFlight = targets[0];
    booking.from_airport_code = oldFlights[0].from_airport_code;
    booking.to_airport_code = oldFlights[0].to_airport_code;
    if (booking.status !== 'CANCELLED' && new Date(oldFlights[0].departure_datetime) <= new Date()) throw Object.assign(new Error('Rebooking is closed after departure'), { status: 409 });

    // 4. REVALIDATE EVERYTHING INSIDE ACTIVE TRANSACTION
    rebookingPolicy.validateBookingEligibility(booking, reason, requestingUser);
    rebookingPolicy.validateTargetFlight(booking, targetFlight);
    const [aircraft] = await connection.execute('SELECT capacity FROM aircraft WHERE aircraft_id = ?', [targetFlight.aircraft_id]);
    targetFlight.capacity = aircraft[0]?.capacity || 0;
    await require('../repositories/bookingRepository').assertCapacity(connection, targetFlight, booking.class, booking.number_of_passengers, null, seats.map(seat => seat.toUpperCase()));

    // Fetch passenger records
    const [passengers] = await connection.execute(
      `SELECT bp.booking_passenger_id, bp.passenger_id, bp.seat_number, p.first_name, p.last_name
       FROM booking_passengers bp
       INNER JOIN passengers p ON bp.passenger_id = p.passenger_id
       WHERE bp.booking_id = ? ORDER BY bp.booking_passenger_id FOR UPDATE`,
      [bookingId]
    );

    // Format old and new seats JSON structures
    const oldSeatsJson = passengers.map(p => ({ passenger_id: p.passenger_id, seat_number: p.seat_number }));
    const newSeatsJson = [];

    // Map new seats provided or auto-assign
    for (let i = 0; i < passengers.length; i++) {
      const p = passengers[i];
      let assignedSeat = null;
      if (Array.isArray(newSeatMappings) && newSeatMappings[i]) {
        assignedSeat = typeof newSeatMappings[i] === 'object' ? newSeatMappings[i].seat_number : newSeatMappings[i];
      }
      newSeatsJson.push({
        passenger_id: p.passenger_id,
        seat_number: assignedSeat ? assignedSeat.trim().toUpperCase() : null
      });
    }

    // 5. ATOMIC SEAT ALLOCATION ON NEW FLIGHT
    const newSeatNumbersOnly = newSeatsJson.map(s => s.seat_number).filter(Boolean);
    if (newSeatNumbersOnly.length > 0) {
      const invalidSeats = await seatRepository.verifySeatsBelongToAircraft(connection, targetFlight.aircraft_id, newSeatNumbersOnly, booking.class);
      if (invalidSeats.length > 0) {
        const error = new Error(`Seat(s) ${invalidSeats.join(', ')} do not exist on new aircraft.`);
        error.code = 'INVALID_SEAT';
        error.status = 400;
        throw error;
      }

      // Check if new seats are already allocated on target flight
      for (const seatNum of newSeatNumbersOnly) {
        const [existingAlloc] = await connection.execute(
          `SELECT allocation_id FROM flight_seat_allocations 
           WHERE flight_id = ? AND seat_number = ? AND (status = 'confirmed' OR (status = 'held' AND expires_at > NOW()))`,
          [newFlightId, seatNum]
        );
        if (existingAlloc.length > 0) {
          const error = new Error(`Seat ${seatNum} is already occupied on flight #${targetFlight.flight_number}.`);
          error.code = 'SEAT_UNAVAILABLE';
          error.status = 409;
          throw error;
        }
      }
    }

    // 6. RELEASE OLD SEATS & RESERVE NEW SEATS
    await seatAllocationService.releaseSeats(connection, bookingId);

    // Update booking header
    await connection.execute(
      `UPDATE bookings SET flight_id = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?`,
      [newFlightId, bookingId]
    );

    await connection.execute('DELETE FROM check_ins WHERE booking_id = ?', [bookingId]);
    await connection.execute('UPDATE booking_passengers SET boarding_token = NULL, boarded_at = NULL WHERE booking_id = ?', [bookingId]);
    await connection.execute("UPDATE bookings SET refund_status = 'none', checked_in_at = NULL WHERE booking_id = ?", [bookingId]);

    // Update passenger seat assignments and tickets
    for (const ns of newSeatsJson) {
      await connection.execute(
          `UPDATE booking_passengers SET seat_number = ? WHERE booking_id = ? AND passenger_id = ?`,
          [ns.seat_number, bookingId, ns.passenger_id]
        );
      if (ns.seat_number) {
        // Record physical seat allocation for new flight
        await seatRepository.allocateSeat(connection, newFlightId, ns.seat_number, bookingId, booking.user_id);
      }

      // Update ticket record preserving ticket number
      const existingTicket = await ticketRepository.findByBookingIdAndPassengerId(connection, bookingId, ns.passenger_id);
      if (existingTicket) {
        await connection.execute(
          `UPDATE tickets SET flight_id = ?, seat_number = ?, status = 'ISSUED' WHERE ticket_id = ?`,
          [newFlightId, ns.seat_number, existingTicket.ticket_id]
        );
      }
    }

    // 7. CONTROLLED STATE MACHINE TRANSITION (Reactiving if cancelled)
    const actor = {
      type: requestingUser ? (requestingUser.role === 'admin' ? 'ADMIN' : 'USER') : 'SYSTEM',
      userId: requestingUser ? requestingUser.userId : null,
      role: requestingUser ? requestingUser.role : 'user'
    };

    const updatedBooking = await bookingStateMachine.transitionBookingState(
      connection,
      bookingId,
      'CONFIRMED',
      actor,
      `Rebooked from Flight #${oldFlightId} to Flight #${newFlightId} (${reason})`,
      { allowReactivation: true, allowCheckInReset: true, operation: 'REBOOKING' }
    );

    // 8. RECORD REBOOKING HISTORY
    const historyId = await rebookingRepository.createRebookingHistory(connection, {
      booking_id: bookingId,
      old_flight_id: oldFlightId,
      new_flight_id: newFlightId,
      rebooking_reason: reason,
      actor_user_id: requestingUser ? requestingUser.userId : null,
      actor_type: actor.type,
      rebooking_key: rebookingKey,
      old_seats_json: oldSeatsJson,
      new_seats_json: newSeatsJson,
      notes: `Successfully rebooked to flight #${targetFlight.flight_number}`,
      status: 'COMPLETED'
    });

    // 9. RECORD AUDIT EVENT
    await auditService.logEvent({
      userId: requestingUser ? requestingUser.userId : null,
      action: 'FLIGHT_REBOOKED',
      resourceType: 'BOOKING',
      resourceId: bookingId,
      oldValue: { flight_id: oldFlightId, seats: oldSeatsJson },
      newValue: { flight_id: newFlightId, seats: newSeatsJson, reason },
      connection,
      status: 'SUCCESS'
    });

    return {
      rebooking_id: historyId,
      booking: updatedBooking,
      old_flight_id: oldFlightId,
      new_flight_id: newFlightId,
      new_seats: newSeatsJson
    };
  }
}

module.exports = new RebookingService();
