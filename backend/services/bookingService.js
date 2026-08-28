const db = require('../config/database');
const flightRepository = require('../repositories/flightRepository');
const seatRepository = require('../repositories/seatRepository');
const bookingRepository = require('../repositories/bookingRepository');
const seatHoldRepository = require('../repositories/seatHoldRepository');
const ticketRepository = require('../repositories/ticketRepository');
const seatAllocationService = require('./seatAllocationService');
const ticketService = require('./ticketService');

class BookingService {
  /**
   * Temporary Seat Hold API (10-minute hold)
   */
  async holdSeats(userId, flightId, seatNumbers, durationMinutes = 10) {
    const connection = await db.pool.getConnection();

    try {
      await connection.beginTransaction();

      const flight = await flightRepository.findByIdForUpdate(connection, flightId);
      if (!flight) {
        const error = new Error('Flight not found or not available.');
        error.code = 'FLIGHT_NOT_AVAILABLE';
        error.status = 404;
        throw error;
      }

      const result = await seatAllocationService.holdSeats(
        connection,
        flightId,
        flight.aircraft_id,
        userId,
        seatNumbers,
        durationMinutes
      );

      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Enterprise-Grade Transactional Booking Creation with Seat Concurrency, Hold Protection & E-Ticket Issuance
   */
  async createBooking(userId, bookingData) {
    const { flight_id, passengers, idempotency_key = null, session_id = null, is_pending = false } = bookingData;
    const flightClass = (bookingData.class || bookingData.flight_class || 'economy').toLowerCase();
    const targetStatus = (is_pending || bookingData.status === 'PENDING') ? 'PENDING' : 'CONFIRMED';
    const targetPayment = (is_pending || bookingData.status === 'PENDING') ? 'pending' : 'paid';

    if (!flight_id || !passengers || !Array.isArray(passengers) || passengers.length === 0) {
      const error = new Error('Flight ID and passengers data are required');
      error.code = 'INVALID_INPUT';
      error.status = 400;
      throw error;
    }

    const connection = await db.pool.getConnection();

    try {
      // 1. Begin ACID transaction
      await connection.beginTransaction();

      // 2. Check Idempotency Key (If booking already exists for user + key, return cleanly)
      if (idempotency_key) {
        const existingBooking = await bookingRepository.findByUserAndIdempotencyKey(connection, userId, idempotency_key);
        if (existingBooking) {
          await connection.commit();
          return await bookingRepository.findById(connection, existingBooking.booking_id);
        }
      }

      // 3. Lock flight & aircraft record using row-level FOR UPDATE lock
      const flight = await flightRepository.findByIdForUpdate(connection, flight_id, flightClass);
      if (!flight) {
        const error = new Error('Flight not found or not available for booking.');
        error.code = 'FLIGHT_NOT_AVAILABLE';
        error.status = 404;
        throw error;
      }

      if (flight.status === 'cancelled') {
        const error = new Error('Cannot create booking for a cancelled flight.');
        error.code = 'FLIGHT_CANCELLED';
        error.status = 400;
        throw error;
      }

      // 4. Prevent booking more passengers than aircraft total capacity
      if (passengers.length > flight.capacity) {
        const error = new Error(`Cannot book ${passengers.length} passengers. Aircraft max capacity is ${flight.capacity}.`);
        error.code = 'CAPACITY_EXCEEDED';
        error.status = 400;
        throw error;
      }

      // 5. If session_id is provided, verify active unexpired seat holds
      if (session_id) {
        const activeSessionHolds = await seatHoldRepository.findActiveHoldsBySession(connection, session_id, userId);

        if (activeSessionHolds.length !== passengers.length) {
          if (idempotency_key) {
            const existing = await bookingRepository.findByUserAndIdempotencyKey(connection, userId, idempotency_key);
            if (existing) {
              await connection.commit();
              return await bookingRepository.findById(connection, existing.booking_id);
            }
          }
          const error = new Error(`Hold count mismatch: Submitted ${passengers.length} passenger(s), but found ${activeSessionHolds.length} active seat hold(s) for this session.`);
          error.code = 'HOLD_COUNT_MISMATCH';
          error.status = 400;
          throw error;
        }

        activeSessionHolds.forEach((hold, idx) => {
          if (passengers[idx] && !passengers[idx].seat_number) {
            passengers[idx].seat_number = hold.seat_number;
          }
        });
      }

      // 6. Calculate current reserved capacity under FOR UPDATE lock
      const reservedCapacityCount = await bookingRepository.countCapacityReserved(connection, flight_id);
      const remainingSeats = flight.capacity - reservedCapacityCount;

      if (remainingSeats < passengers.length) {
        const error = new Error(`Not enough seats available. Only ${remainingSeats} seat(s) remaining.`);
        error.code = 'CAPACITY_EXCEEDED';
        error.status = 409;
        throw error;
      }

      // 7. Calculate total amount & generate unique reference
      const totalAmount = parseFloat(flight.price) * passengers.length;
      const bookingRef = 'BK' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

      // 8. Create booking record with idempotency_key
      const bookingId = await bookingRepository.createBooking(connection, {
        booking_reference: bookingRef,
        user_id: userId,
        flight_id: flight_id,
        number_of_passengers: passengers.length,
        class: flightClass,
        total_amount: totalAmount,
        idempotency_key: idempotency_key,
        status: targetStatus,
        payment_status: targetPayment,
        payment_method: bookingData.payment_method || 'Credit Card'
      });

      // 9. Process & validate seat allocations
      await seatAllocationService.processSeatAllocations(
        connection,
        flight_id,
        flight.aircraft_id,
        bookingId,
        userId,
        passengers
      );

      // 10. Add passengers to booking & collect IDs for ticket issuance
      const addedAllocations = [];
      for (const pData of passengers) {
        const pId = await bookingRepository.addPassengerToBooking(connection, bookingId, userId, pData);
        addedAllocations.push({
          passenger_id: pId,
          seat_number: pData.seat_number
        });
      }

      // 11. Transactional Ticket Issuance for CONFIRMED bookings
      if (targetStatus === 'CONFIRMED') {
        await ticketService.issueTicketsForBooking(
          connection,
          bookingId,
          flight_id,
          flightClass,
          addedAllocations,
          userId
        );
      }

      // 12. Transactional Audit Log inside active transaction
      const auditService = require('./auditService');
      await auditService.logEvent({
        userId,
        action: auditService.ACTIONS.BOOKING_CREATED,
        resourceType: 'BOOKING',
        resourceId: bookingId,
        newValue: { booking_reference: bookingRef, flight_id, passenger_count: passengers.length, total_amount: totalAmount },
        connection,
        status: 'SUCCESS'
      });

      // 13. Mark active session holds as CONSUMED
      if (session_id) {
        await seatHoldRepository.markHoldsConsumed(connection, session_id, userId);
      }

      // 14. Commit transaction
      await connection.commit();

      // 15. Dispatch payment confirmation email webhook for confirmed paid bookings
      if (targetStatus === 'CONFIRMED' && targetPayment === 'paid') {
        const emailWebhookService = require('./emailWebhookService');
        emailWebhookService.triggerPaymentConfirmationWebhook(bookingId).catch(err => {
          console.error('[BookingService] Confirmation webhook trigger error:', err.message);
        });
      }

      // 16. Fetch full details including tickets to return
      const fullBooking = await bookingRepository.findById(connection, bookingId);
      const tickets = await ticketRepository.findByBookingId(connection, bookingId);
      return { ...fullBooking, tickets };

    } catch (error) {
      // Rollback transaction to release all locks and discard changes
      await connection.rollback();

      // Handle duplicate idempotency key or deadlock race condition cleanly
      if (idempotency_key && (
        (error.code === 'ER_DUP_ENTRY' && error.sqlMessage && error.sqlMessage.includes('uq_user_idempotency')) ||
        error.code === 'ER_LOCK_DEADLOCK' ||
        error.errno === 1213
      )) {
        const existing = await bookingRepository.findByUserAndIdempotencyKey(db.pool, userId, idempotency_key);
        if (existing) {
          const fullBooking = await bookingRepository.findById(db.pool, existing.booking_id);
          const tickets = await ticketRepository.findByBookingId(db.pool, existing.booking_id);
          return { ...fullBooking, tickets };
        }
      }

      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Transactionally synchronized booking cancellation (CONFIRMED -> CANCELLED)
   */
  async cancelBooking(userId, bookingId, options = {}) {
    const connection = await db.pool.getConnection();

    try {
      await connection.beginTransaction();

      const booking = await bookingRepository.findById(connection, bookingId, userId, true);
      if (!booking) {
        const error = new Error('Booking not found');
        error.code = 'BOOKING_NOT_FOUND';
        error.status = 404;
        throw error;
      }

      const bookingStateMachine = require('./bookingStateMachine');
      const actor = options.requestingUser ? { userId: options.requestingUser.userId, role: options.requestingUser.role, type: options.requestingUser.role === 'admin' ? 'ADMIN' : 'USER' } : { userId, role: 'user', type: 'USER' };
      const reason = options.reason || 'Customer requested cancellation';

      await bookingStateMachine.transitionBookingState(
        connection,
        bookingId,
        'CANCELLED',
        actor,
        reason,
        options
      );

      await connection.commit();
      return { message: 'Booking cancelled successfully' };

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = new BookingService();
