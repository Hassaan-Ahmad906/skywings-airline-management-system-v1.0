const db = require('../config/database');
const ticketRepository = require('../repositories/ticketRepository');
const ticketService = require('./ticketService');
const seatAllocationService = require('./seatAllocationService');
const auditService = require('./auditService');

const BOOKING_STATES = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  BOARDED: 'BOARDED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED'
};

class BookingStateMachine {
  get STATES() {
    return BOOKING_STATES;
  }

  /**
   * Validate state transition and actor permissions
   */
  validateTransition(currentStatus, requestedStatus, actor, options = {}) {
    const current = currentStatus.toUpperCase();
    const target = requestedStatus.toUpperCase();

    if (current === target) return;

    // Controlled Disruption Reactivation: CANCELLED -> CONFIRMED allowed ONLY during authorized REBOOKING
    const isRebookingReactivation = current === 'CANCELLED' && target === 'CONFIRMED' && options.allowReactivation === true && options.operation === 'REBOOKING';

    // Terminal State Protection: COMPLETED, EXPIRED, and un-authorized CANCELLED cannot transition out
    if (['COMPLETED', 'EXPIRED'].includes(current) || (current === 'CANCELLED' && !isRebookingReactivation)) {
      const error = new Error(`Cannot transition out of terminal booking state ${current}.`);
      error.code = 'TERMINAL_STATE_LOCKED';
      error.status = 400;
      throw error;
    }

    const actorType = actor ? (actor.type || (actor.role === 'admin' ? 'ADMIN' : 'USER')) : 'SYSTEM';

    let isAllowed = false;

    if (isRebookingReactivation) {
      isAllowed = ['USER', 'CUSTOMER_SERVICE', 'OPERATIONS', 'ADMIN', 'SYSTEM'].includes(actorType);
    } else if (current === 'PENDING' && target === 'CONFIRMED') {
      // PENDING -> CONFIRMED (System/Booking Service ONLY)
      isAllowed = ['SYSTEM', 'BOOKING_SERVICE', 'ADMIN'].includes(actorType);
    } else if (current === 'PENDING' && target === 'EXPIRED') {
      // PENDING -> EXPIRED (System/Cleaner ONLY)
      isAllowed = ['SYSTEM', 'CLEANER', 'ADMIN'].includes(actorType);
    } else if (current === 'PENDING' && target === 'CANCELLED') {
      // PENDING -> CANCELLED (Customer/Admin)
      isAllowed = ['USER', 'ADMIN', 'SYSTEM'].includes(actorType);
    } else if (current === 'CONFIRMED' && target === 'CHECKED_IN') {
      // CONFIRMED -> CHECKED_IN (Customer, Check-in Agent, Admin)
      isAllowed = ['USER', 'CHECKIN_AGENT', 'ADMIN', 'SYSTEM'].includes(actorType);
    } else if (current === 'CONFIRMED' && target === 'CANCELLED') {
      // CONFIRMED -> CANCELLED (Customer, Admin, System/Flight Cancellation)
      isAllowed = ['USER', 'ADMIN', 'SYSTEM'].includes(actorType);
    } else if (current === 'CHECKED_IN' && target === 'BOARDED') {
      // CHECKED_IN -> BOARDED (Gate Agent, Admin, System)
      isAllowed = ['GATE_AGENT', 'ADMIN', 'SYSTEM'].includes(actorType);
    } else if (current === 'CHECKED_IN' && target === 'CANCELLED') {
      // CHECKED_IN -> CANCELLED (Customer voluntary cancellation before departure, Admin or System/Flight Cancellation)
      isAllowed = ['USER', 'ADMIN', 'SYSTEM'].includes(actorType);
    } else if (current === 'BOARDED' && target === 'COMPLETED') {
      // BOARDED -> COMPLETED (System / Flight Operations ONLY)
      isAllowed = ['SYSTEM', 'FLIGHT_OPERATIONS', 'ADMIN'].includes(actorType);
    } else if (current === 'BOARDED' && target === 'CANCELLED') {
      // BOARDED -> CANCELLED (Emergency Admin Override ONLY)
      isAllowed = actorType === 'ADMIN' && options.allowOverride === true;
    }

    if (!isAllowed) {
      const error = new Error(`Invalid booking state transition from ${current} to ${target} for actor type [${actorType}].`);
      error.code = 'INVALID_STATE_TRANSITION';
      error.status = 400;
      throw error;
    }
  }

  /**
   * Single Gateway to perform state transition under row-level FOR UPDATE lock
   */
  async transitionBookingState(connection, bookingId, requestedStatus, actor, reason = null, options = {}) {
    const target = requestedStatus.toUpperCase();

    // 1. SELECT booking FOR UPDATE (Row Lock)
    const [rows] = await connection.execute(
      `SELECT * FROM bookings WHERE booking_id = ? FOR UPDATE`,
      [bookingId]
    );

    if (rows.length === 0) {
      const error = new Error('Booking not found.');
      error.code = 'BOOKING_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    const booking = rows[0];
    const current = booking.status.toUpperCase();

    if (current === target) return booking;

    // 2. Validate current state & actor permissions
    this.validateTransition(current, target, actor, options);

    // 3. Validate mandatory reason for admin overrides & offloadings
    const actorRole = actor ? actor.role : null;
    const isOverride = options.allowOverride === true || (actorRole === 'admin' && ['CANCELLED'].includes(target));
    if (isOverride && (!reason || reason.trim() === '')) {
      const error = new Error(`A mandatory reason string is required for state transition to ${target}.`);
      error.code = 'REASON_REQUIRED';
      error.status = 400;
      throw error;
    }

    const defaultReason = reason || `Transition from ${current} to ${target}`;

    // 4. Update booking status and lifecycle timestamps
    let timestampCol = null;
    if (target === 'CONFIRMED') timestampCol = 'confirmed_at';
    if (target === 'CHECKED_IN') timestampCol = 'checked_in_at';
    if (target === 'BOARDED') timestampCol = 'boarded_at';
    if (target === 'COMPLETED') timestampCol = 'completed_at';
    if (target === 'CANCELLED') timestampCol = 'cancelled_at';
    if (target === 'EXPIRED') timestampCol = 'expired_at';

    let updateSql = `UPDATE bookings SET status = ?, state_change_reason = ?`;
    const updateParams = [target, defaultReason];

    if (target === 'CANCELLED') {
      updateSql += `, payment_status = 'refunded'`;
    }

    if (timestampCol) {
      updateSql += `, ${timestampCol} = CURRENT_TIMESTAMP`;
    }
    updateSql += ` WHERE booking_id = ?`;
    updateParams.push(bookingId);

    await connection.execute(updateSql, updateParams);

    // 5. Synchronize Tickets
    const bookingTickets = await ticketRepository.findByBookingId(connection, bookingId);

    if (target === 'BOARDED') {
      // BOARDED -> Ticket USED
      for (const t of bookingTickets) {
        if (t.status === 'ISSUED') {
          await ticketService.updateTicketStatus(
            connection,
            t.ticket_id,
            t.status,
            'USED',
            actor ? actor.userId : null,
            'Passenger boarded flight',
            { isCheckInFlow: true }
          );
        }
      }
    } else if (target === 'CANCELLED') {
      // CANCELLED -> Ticket CANCELLED
      for (const t of bookingTickets) {
        if (t.status !== 'CANCELLED') {
          await ticketService.updateTicketStatus(
            connection,
            t.ticket_id,
            t.status,
            'CANCELLED',
            actor ? actor.userId : null,
            defaultReason,
            { isCheckInFlow: false }
          );
        }
      }
      // Release physical seats & active holds
      await seatAllocationService.releaseSeats(connection, bookingId);
    }

    // 6. Record Audit Log
    await auditService.logEvent({
      userId: actor ? actor.userId : null,
      action: 'BOOKING_STATE_CHANGED',
      resourceType: 'BOOKING',
      resourceId: bookingId,
      oldValue: { status: current },
      newValue: { status: target, reason: defaultReason },
      connection,
      status: 'SUCCESS'
    });

    const [updatedRows] = await connection.execute(
      `SELECT * FROM bookings WHERE booking_id = ?`,
      [bookingId]
    );
    return updatedRows[0];
  }
}

module.exports = new BookingStateMachine();
