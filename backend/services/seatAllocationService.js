const seatRepository = require('../repositories/seatRepository');

class SeatAllocationService {
  /**
   * Hold seats temporarily (10 minutes) for a user
   */
  async holdSeats(connection, flightId, aircraftId, userId, seatNumbers, durationMinutes = 10) {
    if (!seatNumbers || !Array.isArray(seatNumbers) || seatNumbers.length === 0) {
      const error = new Error('At least one seat number is required to hold.');
      error.code = 'INVALID_INPUT';
      error.status = 400;
      throw error;
    }

    const cleanedSeats = seatNumbers
      .map(s => typeof s === 'string' ? s.trim().toUpperCase() : '')
      .filter(s => s.length > 0);

    // 1. Prevent duplicate seats in request
    if (new Set(cleanedSeats).size !== cleanedSeats.length) {
      const error = new Error('Duplicate seat selections found in request.');
      error.code = 'DUPLICATE_SEAT_IN_BOOKING';
      error.status = 400;
      throw error;
    }

    // 2. Verify seats belong to aircraft
    const invalidSeats = await seatRepository.verifySeatsBelongToAircraft(connection, aircraftId, cleanedSeats);
    if (invalidSeats.length > 0) {
      const error = new Error(`Seat(s) ${invalidSeats.join(', ')} do not exist on the aircraft assigned to this flight.`);
      error.code = 'INVALID_SEAT';
      error.status = 400;
      throw error;
    }

    // 3. Process temporary holds
    const heldSeats = [];
    const sessionId = `legacy:${userId}:${flightId}`;
    const holdRepository = require('../repositories/seatHoldRepository');
    const holdMinutes = Math.min(10, Math.max(1, Number(durationMinutes) || 10));
    for (const [passengerIndex, seatNumber] of cleanedSeats.entries()) {
      await holdRepository.createOrUpdateHold(connection, { flightId, seatNumber, userId, sessionId, passengerIndex, durationMinutes: holdMinutes });
      heldSeats.push(seatNumber);
    }

    return {
      flightId,
      userId,
      heldSeats,
      expiresInMinutes: holdMinutes,
      session_id: sessionId
    };
  }

  /**
   * Validate and allocate confirmed seats for a booking inside transaction
   */
  async processSeatAllocations(connection, flightId, aircraftId, bookingId, userId, passengers, cabinClass = null) {
    const seatNumbers = passengers
      .map(p => p.seat_number)
      .filter(s => typeof s === 'string' && s.trim().length > 0)
      .map(s => s.trim().toUpperCase());

    if (seatNumbers.length === 0) {
      return; // No specific seat selections provided
    }

    // 1. Prevent duplicate seats in request
    const uniqueSeatsInRequest = new Set(seatNumbers);
    if (uniqueSeatsInRequest.size !== seatNumbers.length) {
      const error = new Error('Duplicate seat selections found within the same booking request.');
      error.code = 'DUPLICATE_SEAT_IN_BOOKING';
      error.status = 400;
      throw error;
    }

    // 2. Prevent booking seat from another aircraft
    const invalidSeats = await seatRepository.verifySeatsBelongToAircraft(connection, aircraftId, seatNumbers, cabinClass);
    if (invalidSeats.length > 0) {
      const error = new Error(`Seat(s) ${invalidSeats.join(', ')} do not exist on the aircraft assigned to this flight.`);
      error.code = 'INVALID_SEAT';
      error.status = 400;
      throw error;
    }

    // 3. Confirm seat allocations (HELD -> CONFIRMED or AVAILABLE -> CONFIRMED)
    for (const seatNumber of seatNumbers) {
      await seatRepository.allocateSeat(connection, flightId, seatNumber, bookingId, userId);
    }
    for (const passenger of passengers) {
      if (typeof passenger.seat_number === 'string') passenger.seat_number = passenger.seat_number.trim().toUpperCase();
    }
  }

  /**
   * Release seat allocations when booking is cancelled
   */
  async releaseSeats(connection, bookingId) {
    await seatRepository.releaseSeatsForBooking(connection, bookingId);
  }
}

module.exports = new SeatAllocationService();
