const express = require('express');
const { authenticate } = require('../middleware/auth');
const ticketController = require('../controllers/ticketController');

const router = express.Router();

// Require JWT authentication for all ticket routes
router.use(authenticate);

// GET /api/tickets/my-tickets - Fetch all tickets for authenticated user
router.get('/my-tickets', (req, res) => ticketController.getMyTickets(req, res));

// GET /api/tickets/:ticketNumber - Lookup individual ticket
router.get('/:ticketNumber', (req, res) => ticketController.getTicketByNumber(req, res));

// PATCH /api/tickets/:ticketNumber/status - Admin update ticket status (VOID, CANCELLED)
router.patch('/:ticketNumber/status', (req, res) => ticketController.adminUpdateTicketStatus(req, res));

module.exports = router;
