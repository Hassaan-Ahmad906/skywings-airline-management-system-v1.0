const db = require('../config/database');
const ticketRepository = require('../repositories/ticketRepository');

class TicketService {
  /**
   * Validate and retrieve 3-digit numeric TICKET_PREFIX
   */
  getPrefix() {
    const rawPrefix = process.env.TICKET_PREFIX || '789';
    if (/^\d{3}$/.test(rawPrefix.trim())) {
      return rawPrefix.trim();
    }
    return '789';
  }

  /**
   * Generate a unique 13-character e-ticket number (Prefix-10digits e.g. 789-8392019482)
   */
  async generateUniqueTicketNumber(connection) {
    const prefix = this.getPrefix();
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      attempts++;
      const randomDigits = Math.floor(1000000000 + Math.random() * 9000000000).toString();
      const candidateNumber = `${prefix}-${randomDigits}`;

      // Check if candidate already exists in database
      const existing = await ticketRepository.findByTicketNumber(connection, candidateNumber);
      if (!existing) {
        return candidateNumber;
      }
    }

    throw new Error('Failed to generate a unique ticket number after multiple attempts.');
  }

  /**
   * Issue e-tickets for all passengers in a booking inside active ACID transaction
   */
  async issueTicketsForBooking(connection, bookingId, flightId, cabinClass, passengerAllocations, userId = null) {
    const ticketsIssued = [];

    for (const alloc of passengerAllocations) {
      const passengerId = alloc.passenger_id;
      const seatNumber = alloc.seat_number || null;

      // 1. Duplicate check: Skip if ticket already issued for (booking_id, passenger_id)
      const existingTicket = await ticketRepository.findByBookingIdAndPassengerId(connection, bookingId, passengerId);
      if (existingTicket) {
        ticketsIssued.push(existingTicket);
        continue;
      }

      // 2. Generate unique ticket number with duplicate key retry loop
      let ticketInserted = false;
      let attempts = 0;

      while (!ticketInserted && attempts < 5) {
        attempts++;
        const candidateNumber = await this.generateUniqueTicketNumber(connection);

        try {
          const ticketId = await ticketRepository.createTicket(connection, {
            ticket_number: candidateNumber,
            booking_id: bookingId,
            passenger_id: passengerId,
            flight_id: flightId,
            seat_number: seatNumber,
            cabin_class: cabinClass,
            status: 'ISSUED'
          });

          // Create initial audit log entry
          await ticketRepository.createAuditLog(connection, {
            ticket_id: ticketId,
            old_status: null,
            new_status: 'ISSUED',
            changed_by_user_id: userId,
            reason: 'Initial ticket issuance upon booking confirmation'
          });

          const fullTicket = await ticketRepository.findByTicketNumber(connection, candidateNumber);
          ticketsIssued.push(fullTicket);
          ticketInserted = true;
        } catch (err) {
          if ((err.code === 'ER_DUP_ENTRY' || err.errno === 1062) && err.sqlMessage && err.sqlMessage.includes('ticket_number')) {
            // Duplicate ticket_number race condition -> retry next attempt
            continue;
          }
          throw err;
        }
      }

      if (!ticketInserted) {
        throw new Error(`Failed to insert ticket for passenger ID ${passengerId} due to duplicate number collisions.`);
      }
    }

    return ticketsIssued;
  }

  /**
   * Update ticket status with strict State Machine rules
   */
  async updateTicketStatus(connection, ticketId, oldStatus, newStatus, changedByUserId = null, reason = null, options = {}) {
    if (oldStatus === newStatus) return;

    // Strict State Machine Allowed Transitions:
    // ISSUED -> USED (Allowed ONLY via check-in/boarding workflow: options.isCheckInFlow === true)
    // ISSUED -> VOID
    // ISSUED -> CANCELLED
    const isAllowed = 
      (oldStatus === 'ISSUED' && newStatus === 'USED' && options.isCheckInFlow === true) ||
      (oldStatus === 'ISSUED' && newStatus === 'VOID') ||
      (oldStatus === 'ISSUED' && newStatus === 'CANCELLED') ||
      (oldStatus === 'USED' && newStatus === 'CANCELLED');

    if (!isAllowed) {
      const error = new Error(`Invalid ticket status transition from ${oldStatus} to ${newStatus}.${newStatus === 'USED' && !options.isCheckInFlow ? ' ISSUED to USED is only permitted through check-in/boarding workflow.' : ''}`);
      error.code = 'INVALID_TICKET_TRANSITION';
      error.status = 400;
      throw error;
    }

    await ticketRepository.updateStatus(connection, ticketId, oldStatus, newStatus, changedByUserId, reason);

    const auditService = require('./auditService');
    await auditService.logEvent({
      userId: changedByUserId,
      action: auditService.ACTIONS.TICKET_STATUS_CHANGED,
      resourceType: 'TICKET',
      resourceId: ticketId,
      oldValue: { status: oldStatus },
      newValue: { status: newStatus },
      metadata: { reason },
      connection,
      status: 'SUCCESS'
    });
  }

  /**
   * Fetch single ticket details by ticket number with RBAC check
   */
  async getTicketByNumber(ticketNumber, requestingUser) {
    const connection = await db.pool.getConnection();

    try {
      const ticket = await ticketRepository.findByTicketNumber(connection, ticketNumber);
      if (!ticket) {
        const error = new Error('Ticket not found.');
        error.code = 'TICKET_NOT_FOUND';
        error.status = 404;
        throw error;
      }

      // RBAC Authorization: Admin can view any ticket; User can only view their own ticket
      if (requestingUser.role !== 'admin' && ticket.booking_user_id !== requestingUser.userId) {
        const error = new Error('You are not authorized to view this ticket.');
        error.code = 'FORBIDDEN';
        error.status = 403;
        throw error;
      }

      const auditLogs = await ticketRepository.getAuditLogsForTicket(connection, ticket.ticket_id);
      return { ...ticket, audit_logs: auditLogs };
    } finally {
      connection.release();
    }
  }

  /**
   * Fetch tickets by PNR / Booking Reference with RBAC check
   */
  async getTicketsByBookingReference(bookingReference, requestingUser) {
    const connection = await db.pool.getConnection();

    try {
      const tickets = await ticketRepository.findByBookingReference(connection, bookingReference);
      if (!tickets || tickets.length === 0) {
        const error = new Error('No tickets found for this booking reference.');
        error.code = 'TICKETS_NOT_FOUND';
        error.status = 404;
        throw error;
      }

      // RBAC Authorization check on the booking's owner
      const ownerUserId = tickets[0].booking_user_id;
      if (requestingUser.role !== 'admin' && ownerUserId !== requestingUser.userId) {
        const error = new Error('You are not authorized to view tickets for this booking.');
        error.code = 'FORBIDDEN';
        error.status = 403;
        throw error;
      }

      return tickets;
    } finally {
      connection.release();
    }
  }

  /**
   * Get all tickets for current authenticated user
   */
  async getUserTickets(userId) {
    const connection = await db.pool.getConnection();

    try {
      return await ticketRepository.findByUserId(connection, userId);
    } finally {
      connection.release();
    }
  }

  /**
   * Admin Endpoint to Void or Update Ticket Status
   */
  async adminUpdateTicketStatus(ticketNumber, newStatus, reason, requestingUser) {
    if (requestingUser.role !== 'admin') {
      const error = new Error('Admin privileges required to update ticket status.');
      error.code = 'FORBIDDEN';
      error.status = 403;
      throw error;
    }

    const connection = await db.pool.getConnection();

    try {
      await connection.beginTransaction();

      const ticket = await ticketRepository.findByTicketNumber(connection, ticketNumber);
      if (!ticket) {
        const error = new Error('Ticket not found.');
        error.code = 'TICKET_NOT_FOUND';
        error.status = 404;
        throw error;
      }

      await this.updateTicketStatus(
        connection,
        ticket.ticket_id,
        ticket.status,
        newStatus,
        requestingUser.userId,
        reason || `Admin status change to ${newStatus}`,
        { isCheckInFlow: false }
      );

      await connection.commit();
      return await ticketRepository.findByTicketNumber(db.pool, ticketNumber);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = new TicketService();
