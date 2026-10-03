const REBOOKING_REASONS = {
  FLIGHT_CANCELLED: 'FLIGHT_CANCELLED',
  FLIGHT_DELAYED: 'FLIGHT_DELAYED',
  SCHEDULE_CHANGE: 'SCHEDULE_CHANGE',
  CUSTOMER_REQUEST: 'CUSTOMER_REQUEST',
  AIRCRAFT_CHANGE: 'AIRCRAFT_CHANGE',
  OPERATIONAL_OVERRIDE: 'OPERATIONAL_OVERRIDE'
};

class RebookingPolicy {
  get REASONS() {
    return REBOOKING_REASONS;
  }

  /**
   * Validates if a booking is eligible for rebooking under policy
   */
  validateBookingEligibility(booking, reason, actor) {
    const status = booking.status ? booking.status.toUpperCase() : '';
    const reasonType = reason ? reason.toUpperCase() : '';

    if (!Object.values(REBOOKING_REASONS).includes(reasonType)) {
      const error = new Error(`Invalid rebooking reason [${reason}].`);
      error.code = 'INVALID_REBOOKING_REASON';
      error.status = 400;
      throw error;
    }

    if (!['CONFIRMED','CHECKED_IN','CANCELLED'].includes(status) || booking.payment_status !== 'paid') {
      const error = new Error(`Bookings in state ${status} are strictly ineligible for rebooking.`);
      error.code = 'INELIGIBLE_BOOKING_STATE';
      error.status = 400;
      throw error;
    }

    if (status === 'CANCELLED') {
      if (actor?.role !== 'admin') throw Object.assign(new Error('Contact support to transfer a cancelled paid booking; refunded reservations require a new booking.'), { status: 409, code: 'CANCELLED_REBOOKING_NOT_ALLOWED' });
      const isDisruptionRebooking = ['FLIGHT_CANCELLED', 'FLIGHT_DELAYED', 'SCHEDULE_CHANGE', 'AIRCRAFT_CHANGE', 'OPERATIONAL_OVERRIDE'].includes(reasonType);
      if (!isDisruptionRebooking) {
        const error = new Error('Cancelled bookings can only be rebooked if cancellation was caused by a flight disruption or operational override.');
        error.code = 'CANCELLED_REBOOKING_NOT_ALLOWED';
        error.status = 400;
        throw error;
      }
    }

    // RBAC check: Customer can rebook own eligible CONFIRMED booking or disrupted booking
    const actorRole = actor ? actor.role : 'user';
    const actorUserId = actor ? (actor.userId || actor.id) : null;

    if (actorRole !== 'admin' && booking.user_id !== actorUserId) {
      const error = new Error('You are not authorized to rebook this booking.');
      error.code = 'FORBIDDEN';
      error.status = 403;
      throw error;
    }

    if (booking.itinerary_id) throw Object.assign(new Error('Changing a linked journey requires reviewing all flight legs together; individual leg rebooking is unavailable.'), { status:409, code:'JOURNEY_CHANGE_REVIEW_REQUIRED' });
    return true;
  }

  /**
   * Validates target flight departure, status, and cabin compatibility
   */
  validateTargetFlight(booking, targetFlight) {
    if (!targetFlight || !['scheduled', 'delayed'].includes(targetFlight.status)) {
      const error = new Error('Target flight is not operational or available for booking.');
      error.code = 'TARGET_FLIGHT_UNAVAILABLE';
      error.status = 400;
      throw error;
    }

    const now = new Date();
    const depTime = new Date(targetFlight.departure_datetime);
    if (depTime <= now) {
      const error = new Error('Target flight has already departed.');
      error.code = 'TARGET_FLIGHT_DEPARTED';
      error.status = 400;
      throw error;
    }

    if (booking.flight_id === targetFlight.flight_id) {
      const error = new Error('Target flight must be different from current flight.');
      error.code = 'SAME_FLIGHT_REBOOKING';
      error.status = 400;
      throw error;
    }

    if (booking.from_airport_code && (booking.from_airport_code !== targetFlight.from_airport_code || booking.to_airport_code !== targetFlight.to_airport_code)) {
      throw Object.assign(new Error('Rebooking must preserve the original route'), { status: 400, code: 'ROUTE_MISMATCH' });
    }

    return true;
  }
}

module.exports = new RebookingPolicy();
