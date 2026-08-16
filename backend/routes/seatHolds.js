const express = require('express');
const { authenticate } = require('../middleware/auth');
const seatHoldController = require('../controllers/seatHoldController');

const router = express.Router();

// All seat hold endpoints require JWT authentication
router.use(authenticate);

// POST /api/seat-holds - Create or update temporary seat hold
router.post('/', (req, res) => seatHoldController.createOrChangeHold(req, res));

// DELETE /api/seat-holds/:id - Release a seat hold
router.delete('/:id', (req, res) => seatHoldController.releaseHold(req, res));

module.exports = router;
