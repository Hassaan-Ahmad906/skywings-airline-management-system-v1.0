const db = require('../config/database');

class TicketRepository {
  /**
   * Create a new ticket record inside active transaction
   */
  async createTicket(connection, ticketData) {
    const {
      ticket_number,
      booking_id,
      passenger_id,
      flight_id,
      seat_number,
      cabin_class,
      status = 'ISSUED'
    } = ticketData;

    const [result] = await connection.execute(
      `INSERT INTO tickets (
        ticket_number, booking_id, passenger_id, flight_id, 
        seat_number, cabin_class, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ticket_number,
        booking_id,
        passenger_id,
        flight_id,
        seat_number || null,
        cabin_class,
        status
      ]
    );

    return result.insertId;
  }

  /**
   * Insert ticket audit log record
   */
  async createAuditLog(connection, { ticket_id, old_status, new_status, changed_by_user_id, reason }) {
    await connection.execute(
      `INSERT INTO ticket_audit_logs (
        ticket_id, old_status, new_status, changed_by_user_id, reason
      ) VALUES (?, ?, ?, ?, ?)`,
      [ticket_id, old_status || null, new_status, changed_by_user_id || null, reason || null]
    );
  }

  /**
   * Find ticket by ticket number with full joins
   */
  async findByTicketNumber(connection, ticketNumber) {
    const [rows] = await connection.execute(
      `SELECT t.*, 
              p.first_name as passenger_first_name, p.last_name as passenger_last_name, p.passport_number,
              b.booking_reference, b.user_id as booking_user_id, b.status as booking_status,
              f.flight_number, f.from_airport_code, f.to_airport_code, f.departure_datetime, f.arrival_datetime
       FROM tickets t
       INNER JOIN passengers p ON t.passenger_id = p.passenger_id
       INNER JOIN bookings b ON t.booking_id = b.booking_id
       INNER JOIN flights f ON t.flight_id = f.flight_id
       WHERE UPPER(t.ticket_number) = UPPER(?)`,
      [ticketNumber]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find all tickets by booking ID
   */
  async findByBookingId(connection, bookingId) {
    const [rows] = await connection.execute(
      `SELECT t.*, 
              p.first_name as passenger_first_name, p.last_name as passenger_last_name, p.passport_number,
              b.booking_reference, f.flight_number
       FROM tickets t
       INNER JOIN passengers p ON t.passenger_id = p.passenger_id
       INNER JOIN bookings b ON t.booking_id = b.booking_id
       INNER JOIN flights f ON t.flight_id = f.flight_id
       WHERE t.booking_id = ?`,
      [bookingId]
    );
    return rows;
  }

  /**
   * Find ticket by booking_id and passenger_id (to prevent duplicate issuance)
   */
  async findByBookingIdAndPassengerId(connection, bookingId, passengerId) {
    const [rows] = await connection.execute(
      `SELECT * FROM tickets WHERE booking_id = ? AND passenger_id = ?`,
      [bookingId, passengerId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find tickets by PNR / booking_reference (Case-insensitive)
   */
  async findByBookingReference(connection, bookingReference) {
    const [rows] = await connection.execute(
      `SELECT t.*, 
              p.first_name as passenger_first_name, p.last_name as passenger_last_name, p.passport_number,
              b.booking_reference, b.user_id as booking_user_id, f.flight_number
       FROM tickets t
       INNER JOIN passengers p ON t.passenger_id = p.passenger_id
       INNER JOIN bookings b ON t.booking_id = b.booking_id
       INNER JOIN flights f ON t.flight_id = f.flight_id
       WHERE UPPER(b.booking_reference) = UPPER(?)`,
      [bookingReference]
    );
    return rows;
  }

  /**
   * Find all tickets belonging to a specific user (via booking ownership)
   */
  async findByUserId(connection, userId) {
    const [rows] = await connection.execute(
      `SELECT t.*, 
              p.first_name as passenger_first_name, p.last_name as passenger_last_name,
              b.booking_reference, f.flight_number, f.from_airport_code, f.to_airport_code, f.departure_datetime
       FROM tickets t
       INNER JOIN passengers p ON t.passenger_id = p.passenger_id
       INNER JOIN bookings b ON t.booking_id = b.booking_id
       INNER JOIN flights f ON t.flight_id = f.flight_id
       WHERE b.user_id = ?
       ORDER BY t.created_at DESC`,
      [userId]
    );
    return rows;
  }

  /**
   * Update ticket status and set state timestamp
   */
  async updateStatus(connection, ticketId, oldStatus, newStatus, changedByUserId = null, reason = null) {
    let timestampClause = '';
    if (newStatus === 'VOID') timestampClause = ', void_timestamp = CURRENT_TIMESTAMP';
    if (newStatus === 'USED') timestampClause = ', used_timestamp = CURRENT_TIMESTAMP';
    if (newStatus === 'CANCELLED') timestampClause = ', cancelled_timestamp = CURRENT_TIMESTAMP';

    await connection.execute(
      `UPDATE tickets SET status = ? ${timestampClause} WHERE ticket_id = ?`,
      [newStatus, ticketId]
    );

    await this.createAuditLog(connection, {
      ticket_id: ticketId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by_user_id: changedByUserId,
      reason: reason
    });
  }

  /**
   * Fetch audit logs for a ticket
   */
  async getAuditLogsForTicket(connection, ticketId) {
    const [rows] = await connection.execute(
      `SELECT l.*, u.email as changed_by_email 
       FROM ticket_audit_logs l
       LEFT JOIN users u ON l.changed_by_user_id = u.user_id
       WHERE l.ticket_id = ?
       ORDER BY l.changed_at DESC`,
      [ticketId]
    );
    return rows;
  }
}

module.exports = new TicketRepository();
