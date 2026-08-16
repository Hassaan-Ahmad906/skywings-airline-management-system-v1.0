const DISRUPTION_TYPES = {
  DELAY: 'DELAY',
  CANCELLATION: 'CANCELLATION',
  DIVERSION: 'DIVERSION',
  AIRCRAFT_CHANGE: 'AIRCRAFT_CHANGE',
  GATE_CHANGE: 'GATE_CHANGE',
  SCHEDULE_CHANGE: 'SCHEDULE_CHANGE'
};

class DisruptionPolicy {
  get TYPES() {
    return DISRUPTION_TYPES;
  }

  /**
   * Validate disruption policy and payload requirements
   */
  validatePolicy(disruptionType, flight, payload = {}) {
    const type = disruptionType ? disruptionType.toUpperCase() : null;

    if (!Object.values(DISRUPTION_TYPES).includes(type)) {
      const error = new Error(`Unsupported disruption type [${disruptionType}].`);
      error.code = 'INVALID_DISRUPTION_TYPE';
      error.status = 400;
      throw error;
    }

    if (flight.status === 'cancelled') {
      const error = new Error(`Flight #${flight.flight_number} is already cancelled.`);
      error.code = 'FLIGHT_ALREADY_CANCELLED';
      error.status = 400;
      throw error;
    }

    if (type === 'SCHEDULE_CHANGE' || type === 'DELAY') {
      if (!payload.new_departure_datetime || !payload.new_arrival_datetime) {
        const error = new Error('Schedule change requires new_departure_datetime and new_arrival_datetime.');
        error.code = 'MISSING_SCHEDULE_DATA';
        error.status = 400;
        throw error;
      }

      const dep = new Date(payload.new_departure_datetime);
      const arr = new Date(payload.new_arrival_datetime);
      if (arr <= dep) {
        const error = new Error('New arrival datetime must be strictly after new departure datetime.');
        error.code = 'INVALID_SCHEDULE_TIMING';
        error.status = 400;
        throw error;
      }
    }

    if (type === 'AIRCRAFT_CHANGE') {
      if (!payload.new_aircraft_id) {
        const error = new Error('Aircraft change requires new_aircraft_id.');
        error.code = 'MISSING_AIRCRAFT_DATA';
        error.status = 400;
        throw error;
      }
    }

    return true;
  }

  /**
   * Evaluates seat conflict warnings for Aircraft Change
   */
  evaluateAircraftChange(oldAircraft, newAircraft, assignedSeats = []) {
    const warnings = [];
    let canExecute = true;

    if (newAircraft.capacity < assignedSeats.length) {
      canExecute = false;
      warnings.push(`New aircraft capacity (${newAircraft.capacity}) is smaller than total assigned passenger seats (${assignedSeats.length}).`);
    }

    // Check individual seat numbers validity on new layout if capacity is lower
    const conflictSeats = [];
    if (newAircraft.capacity < oldAircraft.capacity) {
      // High row seats might not exist on smaller aircraft
      const maxRowsNew = Math.ceil(newAircraft.capacity / 6);
      for (const s of assignedSeats) {
        if (s.seat_number) {
          const rowNum = parseInt(s.seat_number, 10);
          if (!isNaN(rowNum) && rowNum > maxRowsNew) {
            conflictSeats.push(s.seat_number);
          }
        }
      }
    }

    if (conflictSeats.length > 0) {
      warnings.push(`${conflictSeats.length} assigned seats (${conflictSeats.join(', ')}) exceed row bounds of new aircraft layout.`);
    }

    return {
      canExecute,
      seatConflictsCount: conflictSeats.length,
      conflictSeats,
      warnings
    };
  }
}

module.exports = new DisruptionPolicy();
