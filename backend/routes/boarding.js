const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, requireGateStaff } = require('../middleware/auth');
const bookingStateMachine = require('../services/bookingStateMachine');

const router = require('../middleware/asyncRouter')();

// Mount authentication middleware
router.use(authenticate);
// The application currently has user/admin roles. Gate operations require
// administrative authorization; customers cannot promote themselves to agents.
router.use(requireGateStaff);

/**
 * Gate Boarding Scan API: Transitions booking from CHECKED_IN -> BOARDED
 * and associated tickets from ISSUED -> USED
 */
router.post('/scan', async (req, res) => {
  try {
    if (req.body.identity_verified !== true || !/^[a-f0-9]{64}$/.test(req.body.boarding_token || '') || !Number.isSafeInteger(Number(req.body.flight_id)) || Number(req.body.flight_id)<1) {
      const reason = req.body.identity_verified !== true ? 'Verify passenger identity before recording boarding' : 'A valid flight and boarding token are required';
      const flightId=Number(req.body.flight_id);
      await db.pool.execute("INSERT INTO gate_audit_events (flight_id, actor_user_id, action, outcome, reason) VALUES (?, ?, 'BOARDING_SCAN', 'rejected', ?)", [Number.isSafeInteger(flightId)&&flightId>0?flightId:null,req.user.userId,reason]);
      return res.status(400).json({ success: false, message: reason });
    }
    const data = await require('../services/boardingService').scan(req.body.boarding_token, Number(req.body.flight_id), req.user);
    res.json({ success: true, message: 'Passenger boarding recorded', data });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Boarding failed', error: { code: error.code || 'BOARDING_FAILED' } }); }
});
router.use(require('./gateOperations'));
module.exports = router;
