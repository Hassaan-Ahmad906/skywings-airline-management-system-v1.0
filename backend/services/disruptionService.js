const db = require('../config/database');
const disruptionPolicy = require('./disruptionPolicy');
const disruptionRepository = require('../repositories/disruptionRepository');
const bookingStateMachine = require('./bookingStateMachine');
const ticketRepository = require('../repositories/ticketRepository');
const auditService = require('./auditService');

class DisruptionService {
  /**
   * Previews disruption impact (affected bookings, passengers, tickets, seats) without modifying database
   */
  async calculateImpact(flightId, disruptionType, payload = {}, connection = null) {
    const pool = connection || db.pool;
    const [flights] = await pool.execute(
      `SELECT f.*, a.model as aircraft_model, a.capacity
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
    disruptionPolicy.validatePolicy(disruptionType, flight, payload);

    // Fetch active bookings (CONFIRMED or CHECKED_IN)
    const [affectedBookings] = await pool.execute(
      `SELECT b.*, u.email as user_email
       FROM bookings b
       INNER JOIN users u ON b.user_id = u.user_id
       WHERE b.flight_id = ? AND b.status IN ('PENDING','CONFIRMED','CHECKED_IN','BOARDED')`,
      [flightId]
    );

    // Fetch affected passengers & seats
    const [affectedPassengers] = await pool.execute(
      `SELECT p.passenger_id, p.first_name, p.last_name, bp.booking_id, bp.seat_number, b.status as booking_status,
              (SELECT check_in_id FROM check_ins ci WHERE ci.booking_id = b.booking_id LIMIT 1) as check_in_id
       FROM booking_passengers bp
       INNER JOIN passengers p ON bp.passenger_id = p.passenger_id
       INNER JOIN bookings b ON bp.booking_id = b.booking_id
       WHERE b.flight_id = ? AND b.status IN ('PENDING','CONFIRMED','CHECKED_IN','BOARDED')`,
      [flightId]
    );

    const checkedInCount = affectedPassengers.filter(p => p.booking_status === 'CHECKED_IN' || p.check_in_id !== null).length;

    // Aircraft change seat conflict check
    let aircraftAnalysis = { canExecute: true, warnings: [] };
    if (disruptionType.toUpperCase() === 'AIRCRAFT_CHANGE' && payload.new_aircraft_id) {
      const [newAcRows] = await pool.execute(
        `SELECT * FROM aircraft WHERE aircraft_id = ?`,
        [payload.new_aircraft_id]
      );
      if (newAcRows.length > 0) {
        aircraftAnalysis = disruptionPolicy.evaluateAircraftChange(flight, newAcRows[0], affectedPassengers);
      }
    }

    return {
      flight_id: flightId,
      flight_number: flight.flight_number,
      disruption_type: disruptionType.toUpperCase(),
      affected_bookings_count: affectedBookings.length,
      affected_passengers_count: affectedPassengers.length,
      checked_in_passengers_count: checkedInCount,
      seats_impacted_count: affectedPassengers.filter(p => p.seat_number).length,
      notifications_required: affectedPassengers.length,
      can_execute: aircraftAnalysis.canExecute,
      warnings: aircraftAnalysis.warnings || [],
      affected_bookings: affectedBookings,
      affected_passengers: affectedPassengers
    };
  }

  /**
   * Executes flight disruption under lock-first transaction control
   */
  async executeDisruption(connection, flightId, payload, actor, executionKey = null) {
    if (actor?.role !== 'admin') throw Object.assign(new Error('Administrator authorization required'), { status: 403 });
    if (typeof payload.reason !== 'string' || payload.reason.trim().length < 3 || payload.reason.length > 500) throw Object.assign(new Error('Provide a reason of 3–500 characters'), { status: 400 });
    // 1. Idempotency Check
    if (executionKey) {
      const existing = await disruptionRepository.findByExecutionKey(connection, executionKey);
      if (existing) {
        if (existing.flight_id !== flightId) throw Object.assign(new Error('Execution key belongs to another flight'), { status: 409 });
        return {
          disruption: existing,
          isDuplicateExecution: true
        };
      }
    }

    // 2. Lock Flight Row FOR UPDATE
    const [flightRows] = await connection.execute(
      `SELECT f.*, a.model as aircraft_model, a.capacity
       FROM flights f
       INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       WHERE f.flight_id = ? FOR UPDATE`,
      [flightId]
    );

    if (flightRows.length === 0) {
      const error = new Error('Flight not found.');
      error.code = 'FLIGHT_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    const flight = flightRows[0];
    const disruptionType = payload.disruption_type.toUpperCase();

    disruptionPolicy.validatePolicy(disruptionType, flight, payload);

    // 3. Create Disruption Record with status EXECUTING
    const disruptionId = await disruptionRepository.createDisruption(connection, {
      flight_id: flightId,
      disruption_type: disruptionType,
      reason: payload.reason,
      operational_notes: payload.operational_notes || null,
      execution_key: executionKey,
      old_departure_datetime: flight.departure_datetime,
      new_departure_datetime: payload.new_departure_datetime || null,
      old_arrival_datetime: flight.arrival_datetime,
      new_arrival_datetime: payload.new_arrival_datetime || null,
      old_aircraft_id: flight.aircraft_id,
      new_aircraft_id: payload.new_aircraft_id || null,
      old_gate: flight.gate || null,
      new_gate: payload.new_gate || null,
      created_by_user_id: actor ? actor.userId : null,
      status: 'EXECUTING'
    });

    try {
      // 4. Re-calculate affected passengers inside active transaction
      const impactData = await this.calculateImpact(flightId, disruptionType, payload, connection);
      const management = require('./flightManagementService');
      const updated = management.validateFlight({ ...flight,
        ...(disruptionType === 'CANCELLATION' ? { status: 'cancelled' } : {}),
        ...(['DELAY','SCHEDULE_CHANGE'].includes(disruptionType) ? { departure_datetime: payload.new_departure_datetime, arrival_datetime: payload.new_arrival_datetime, status: 'delayed' } : {}),
        ...(disruptionType === 'AIRCRAFT_CHANGE' ? { aircraft_id: payload.new_aircraft_id } : {}) });
      await management.validateReferences(connection, updated, flightId);
      if (disruptionType !== 'CANCELLATION' && impactData.affected_bookings.some(booking => booking.status === 'BOARDED')) throw Object.assign(new Error('Cannot change an itinerary after boarding'), { status: 409 });
      if (disruptionType === 'AIRCRAFT_CHANGE') {
        for (const cabin of ['economy','business','first']) {
          const reserved = impactData.affected_bookings.filter(booking => booking.class === cabin).reduce((sum, booking) => sum + Number(booking.number_of_passengers), 0);
          const [seats] = await connection.execute('SELECT COUNT(*) AS capacity FROM seats WHERE aircraft_id = ? AND seat_class = ? AND is_available = 1', [updated.aircraft_id, cabin]);
          if (reserved > seats[0].capacity) throw Object.assign(new Error(`New aircraft has insufficient ${cabin} capacity`), { status: 409 });
          const bookingIds = new Set(impactData.affected_bookings.filter(booking => booking.class === cabin).map(booking => booking.booking_id));
          const assigned = impactData.affected_passengers.filter(passenger => bookingIds.has(passenger.booking_id)).map(passenger => passenger.seat_number).filter(Boolean);
          if ((await require('../repositories/seatRepository').verifySeatsBelongToAircraft(connection, updated.aircraft_id, assigned, cabin)).length) throw Object.assign(new Error('Assigned seats are incompatible with the new aircraft; rebook affected passengers first'), { status: 409 });
        }
      }

      // 5. Apply Disruption Policy Logic
      if (disruptionType === 'CANCELLATION') {
        // Update flight status to cancelled
        await connection.execute(`UPDATE flights SET status = 'cancelled' WHERE flight_id = ?`, [flightId]);

        // Cascade cancellation to all affected bookings via Booking State Machine
        for (const b of impactData.affected_bookings) {
          await bookingStateMachine.transitionBookingState(
            connection,
            b.booking_id,
            'CANCELLED',
            { type: 'ADMIN', userId: actor.userId, role: actor.role },
            `Flight ${flight.flight_number} cancellation: ${payload.reason}`,
            { allowOverride: true }
          );
        }
      } else if (disruptionType === 'DELAY' || disruptionType === 'SCHEDULE_CHANGE') {
        await connection.execute(
          `UPDATE flights SET departure_datetime = ?, arrival_datetime = ?, status = 'delayed' WHERE flight_id = ?`,
          [payload.new_departure_datetime, payload.new_arrival_datetime, flightId]
        );
      } else if (disruptionType === 'AIRCRAFT_CHANGE') {
        await connection.execute(
          `UPDATE flights SET aircraft_id = ? WHERE flight_id = ?`,
          [payload.new_aircraft_id, flightId]
        );
      }

      await require('../repositories/seatHoldRepository').releaseHoldsForCancelledFlight(connection, flightId);
      if (disruptionType !== 'CANCELLATION') {
        for (const booking of impactData.affected_bookings.filter(booking => booking.status === 'CHECKED_IN')) {
          await connection.execute('DELETE FROM check_ins WHERE booking_id = ?', [booking.booking_id]);
          await connection.execute('UPDATE booking_passengers SET boarding_token = NULL, boarded_at = NULL WHERE booking_id = ?', [booking.booking_id]);
          await bookingStateMachine.transitionBookingState(connection, booking.booking_id, 'CONFIRMED', { ...actor, type: 'ADMIN' }, 'Itinerary changed; check in again', { allowCheckInReset: true, operation: 'DISRUPTION' });
        }
      }

      // 6. Populate Affected Passengers Notification Queue
      const affectedList = await Promise.all(
        impactData.affected_passengers.map(async (p) => {
          const ticket = await ticketRepository.findByBookingIdAndPassengerId(connection, p.booking_id, p.passenger_id);
          return {
            booking_id: p.booking_id,
            passenger_id: p.passenger_id,
            ticket_id: ticket ? ticket.ticket_id : null,
            seat_number: p.seat_number,
            check_in_status: p.booking_status
          };
        })
      );

      await disruptionRepository.addAffectedPassengers(connection, disruptionId, affectedList);

      // 7. Update Disruption status to EXECUTED
      await disruptionRepository.updateDisruptionStatus(connection, disruptionId, 'EXECUTED', null, actor ? actor.userId : null);

      // 8. Record Audit Log
      await auditService.logEvent({
        userId: actor ? actor.userId : null,
        action: 'FLIGHT_DISRUPTION_EXECUTED',
        resourceType: 'FLIGHT',
        resourceId: flightId,
        oldValue: { status: flight.status, departure: flight.departure_datetime },
        newValue: { disruption_type: disruptionType, reason: payload.reason, affected_passengers: affectedList.length },
        connection,
        status: 'SUCCESS'
      });

      const [updatedDisruption] = await connection.execute(
        `SELECT * FROM flight_disruptions WHERE disruption_id = ?`,
        [disruptionId]
      );

      return {
        disruption: updatedDisruption[0],
        affected_count: affectedList.length
      };

    } catch (err) {
      // Record status FAILED if error occurs
      await disruptionRepository.updateDisruptionStatus(connection, disruptionId, 'FAILED', err.message, actor ? actor.userId : null);
      throw err;
    }
  }
}

module.exports = new DisruptionService();
