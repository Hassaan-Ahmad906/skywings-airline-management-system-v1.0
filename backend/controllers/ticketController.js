const ticketService = require('../services/ticketService');

class TicketController {
  /**
   * GET /api/tickets/my-tickets - Fetch all tickets for authenticated user
   */
  async getMyTickets(req, res) {
    try {
      const userId = req.user.userId;
      const tickets = await ticketService.getUserTickets(userId);

      res.status(200).json({
        success: true,
        data: tickets
      });
    } catch (error) {
      console.error('Get my tickets controller error:', error.message);
      const statusCode = error.status || 500;
      res.status(statusCode).json({
        success: false,
        error: { code: error.code || 'GET_TICKETS_FAILED', message: error.message || 'Failed to fetch tickets' }
      });
    }
  }

  /**
   * GET /api/tickets/:ticketNumber - Lookup individual ticket details
   */
  async getTicketByNumber(req, res) {
    try {
      const { ticketNumber } = req.params;
      if (!ticketNumber) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Ticket number is required' }
        });
      }

      const ticket = await ticketService.getTicketByNumber(ticketNumber, req.user);
      res.status(200).json({
        success: true,
        data: ticket
      });
    } catch (error) {
      console.error('Get ticket by number error:', error.message);
      const statusCode = error.status || 500;
      res.status(statusCode).json({
        success: false,
        error: { code: error.code || 'TICKET_LOOKUP_FAILED', message: error.message || 'Failed to fetch ticket' }
      });
    }
  }

  /**
   * GET /api/bookings/:bookingReference/tickets - Lookup all tickets under a PNR
   */
  async getTicketsByBookingRef(req, res) {
    try {
      const { bookingReference } = req.params;
      if (!bookingReference) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Booking reference (PNR) is required' }
        });
      }

      const tickets = await ticketService.getTicketsByBookingReference(bookingReference, req.user);
      res.status(200).json({
        success: true,
        data: tickets
      });
    } catch (error) {
      console.error('Get tickets by PNR error:', error.message);
      const statusCode = error.status || 500;
      res.status(statusCode).json({
        success: false,
        error: { code: error.code || 'PNR_TICKETS_FAILED', message: error.message || 'Failed to fetch PNR tickets' }
      });
    }
  }

  /**
   * PATCH /api/tickets/:ticketNumber/status - Admin status management (VOID, CANCELLED)
   */
  async adminUpdateTicketStatus(req, res) {
    try {
      const { ticketNumber } = req.params;
      const { status, reason } = req.body;

      if (!ticketNumber || !status) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'ticketNumber and status are required' }
        });
      }

      const updatedTicket = await ticketService.adminUpdateTicketStatus(
        ticketNumber,
        status.toUpperCase(),
        reason,
        req.user
      );

      res.status(200).json({
        success: true,
        message: `Ticket status successfully updated to ${status.toUpperCase()}`,
        data: updatedTicket
      });
    } catch (error) {
      console.error('Admin update ticket status error:', error.message);
      const statusCode = error.status || 500;
      res.status(statusCode).json({
        success: false,
        error: { code: error.code || 'UPDATE_TICKET_FAILED', message: error.message || 'Failed to update ticket status' }
      });
    }
  }
}

module.exports = new TicketController();
