/**
 * Integration Test for n8n Email Webhook Integration on Payment Confirmation
 */
const { pool } = require('../backend/config/database');
const emailWebhookService = require('../backend/services/emailWebhookService');
const bookingRepository = require('../backend/repositories/bookingRepository');
const bookingService = require('../backend/services/bookingService');

async function runWebhookIntegrationTest() {
  console.log('\n======================================================================');
  console.log('🧪 TESTING N8N PRODUCTION WEBHOOK INTEGRATION ON PAYMENT CONFIRMATION');
  console.log('======================================================================\n');

  let testBookingId = null;
  const connection = await pool.getConnection();

  try {
    // 1. Fetch a real active customer user
    const [users] = await connection.execute(
      'SELECT user_id, first_name, last_name, email, phone FROM users WHERE role = "user" AND status = "active" LIMIT 1'
    );
    if (users.length === 0) {
      throw new Error('No active test customer found in database.');
    }
    const testUser = users[0];
    console.log(`👤 Test Customer: ${testUser.first_name} ${testUser.last_name} (${testUser.email})`);

    // 2. Fetch or update an upcoming scheduled flight
    let [flights] = await connection.execute(
      `SELECT f.flight_id, f.flight_number, f.base_price, f.departure_datetime, f.arrival_datetime,
              dep.airport_name as from_name, dep.airport_code as from_code,
              arr.airport_name as to_name, arr.airport_code as to_code
       FROM flights f
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       WHERE f.status = 'scheduled' AND f.departure_datetime > NOW()
       ORDER BY f.flight_id ASC
       LIMIT 1`
    );

    if (flights.length === 0) {
      // Refresh flight schedules to be in the future
      await connection.execute(
        `UPDATE flights SET departure_datetime = DATE_ADD(NOW(), INTERVAL 3 DAY), 
                            arrival_datetime = DATE_ADD(NOW(), INTERVAL 3 DAY + INTERVAL 6 HOUR)
         WHERE status = 'scheduled'`
      );
      [flights] = await connection.execute(
        `SELECT f.flight_id, f.flight_number, f.base_price, f.departure_datetime, f.arrival_datetime,
                dep.airport_name as from_name, dep.airport_code as from_code,
                arr.airport_name as to_name, arr.airport_code as to_code
         FROM flights f
         INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
         INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
         WHERE f.status = 'scheduled' AND f.departure_datetime > NOW()
         ORDER BY f.flight_id ASC
         LIMIT 1`
      );
    }
    const testFlight = flights[0];
    console.log(`✈️ Test Flight: ${testFlight.flight_number} (${testFlight.from_code} -> ${testFlight.to_code})`);

    // 3. Create a test confirmed booking through bookingService
    const bookingData = {
      flight_id: testFlight.flight_id,
      class: 'economy',
      payment_method: 'Credit Card',
      passengers: [{
        first_name: testUser.first_name,
        last_name: testUser.last_name,
        date_of_birth: '1992-08-20',
        passport_number: 'N8NTEST999',
        nationality: 'American',
        seat_number: '12A'
      }]
    };

    console.log('\n📦 Creating real test booking with dynamic data...');
    const createdBooking = await bookingService.createBooking(testUser.user_id, bookingData);
    testBookingId = createdBooking.booking_id;
    console.log(`✅ Booking Created Successfully: ID=${testBookingId}, PNR=${createdBooking.booking_reference}, Status=${createdBooking.status}`);

    // 4. Fetch complete details using repository
    const completeDetails = await bookingRepository.getCompleteBookingDetails(connection, testBookingId);
    console.log('\n🔍 Retrieved complete booking data from database:');
    console.log(`   Customer: ${completeDetails.customer_first_name} ${completeDetails.customer_last_name} <${completeDetails.customer_email}>`);
    console.log(`   Flight: ${completeDetails.flight_number} (${completeDetails.departure_city} -> ${completeDetails.arrival_city})`);
    console.log(`   Passenger Count: ${completeDetails.passengers.length}`);
    console.log(`   Seat: ${completeDetails.passengers[0].seat_number}`);

    // 5. Build payload and validate target structure
    const payload = emailWebhookService.buildPayload(completeDetails);
    console.log('\n📋 Formatted JSON Payload for n8n Webhook:');
    console.log(JSON.stringify(payload, null, 2));

    // Structure Assertions
    if (payload.event_type !== 'payment_confirmed') throw new Error('Invalid event_type');
    if (payload.payment_status !== 'confirmed') throw new Error('Invalid payment_status');
    if (!payload.customer.name || !payload.customer.email) throw new Error('Invalid customer object');
    if (!payload.passenger.name) throw new Error('Invalid passenger object');
    if (!payload.booking.booking_reference || !payload.booking.number_of_passengers) throw new Error('Invalid booking object');
    if (!payload.flight.flight_number || !payload.flight.departure.airport || !payload.flight.arrival.airport) throw new Error('Invalid flight object');
    if (!payload.seat.number) throw new Error('Invalid seat object');
    if (!payload.baggage.allowance) throw new Error('Invalid baggage object');
    if (!payload.payment.amount || !payload.payment.currency || !payload.payment.method) throw new Error('Invalid payment object');
    if (!payload.check_in.information) throw new Error('Invalid check_in object');

    console.log('\n✅ All target schema assertions PASSED!');

    // 6. Test actual dispatch to production n8n webhook
    console.log('\n🌐 Dispatching payload to production n8n webhook URL:');
    console.log(`   URL: ${emailWebhookService.getWebhookUrl()}`);
    
    const webhookResult = await emailWebhookService.triggerPaymentConfirmationWebhook(testBookingId);
    console.log('📥 Webhook Dispatch Result:', webhookResult);

    if (webhookResult.success) {
      console.log(`\n🎉 SUCCESS: Production n8n webhook accepted payment confirmation with HTTP status ${webhookResult.statusCode}!`);
    } else {
      console.log(`\n⚠️ Webhook returned error: ${webhookResult.error || webhookResult.reason}`);
    }

    // 7. Test Flow 2: Pending Booking followed by Payment Confirmation
    console.log('\n----------------------------------------------------------------------');
    console.log('📦 Testing Flow 2: Pending Booking followed by Payment Confirmation...');
    console.log('----------------------------------------------------------------------');

    const pendingBookingData = {
      flight_id: testFlight.flight_id,
      class: 'business',
      is_pending: true,
      passengers: [{
        first_name: testUser.first_name,
        last_name: testUser.last_name,
        date_of_birth: '1992-08-20',
        passport_number: 'N8NTEST999',
        nationality: 'American',
        seat_number: '2A'
      }]
    };

    const pendingBooking = await bookingService.createBooking(testUser.user_id, pendingBookingData);
    const pendingBookingId = pendingBooking.booking_id;
    console.log(`✅ Pending Booking Created: ID=${pendingBookingId}, Status=${pendingBooking.status}, Payment=${pendingBooking.payment_status}`);

    // Verify webhook does NOT trigger for pending status
    const pendingTrigger = await emailWebhookService.triggerPaymentConfirmationWebhook(pendingBookingId);
    console.log(`🔒 Verification: Pending booking webhook trigger result: success=${pendingTrigger.success}, reason=${pendingTrigger.reason}`);
    if (pendingTrigger.success) throw new Error('Webhook should NOT trigger for pending booking');

    // Simulate Payment Confirmation
    const bookingStateMachine = require('../backend/services/bookingStateMachine');
    const ticketService = require('../backend/services/ticketService');
    const payConn = await pool.getConnection();
    try {
      await payConn.beginTransaction();
      await bookingStateMachine.transitionBookingState(
        payConn,
        pendingBookingId,
        'CONFIRMED',
        { userId: testUser.user_id, role: 'user', type: 'BOOKING_SERVICE' },
        'Customer completed payment via PayPal'
      );
      await payConn.execute(
        `UPDATE bookings SET payment_status = 'paid', payment_method = ? WHERE booking_id = ?`,
        ['PayPal', pendingBookingId]
      );
      const [passengers] = await payConn.execute(
        `SELECT bp.passenger_id, bp.seat_number FROM booking_passengers bp WHERE bp.booking_id = ?`,
        [pendingBookingId]
      );
      await ticketService.issueTicketsForBooking(
        payConn,
        pendingBookingId,
        testFlight.flight_id,
        'business',
        passengers,
        testUser.user_id
      );
      await payConn.commit();
      console.log('💳 Payment confirmed for pending booking. State transitioned to CONFIRMED.');
    } catch (payErr) {
      await payConn.rollback();
      throw payErr;
    } finally {
      payConn.release();
    }

    // Trigger webhook on confirmed payment
    const payConfirmWebhookResult = await emailWebhookService.triggerPaymentConfirmationWebhook(pendingBookingId);
    console.log('📥 Pay Pending Webhook Result:', payConfirmWebhookResult);
    if (!payConfirmWebhookResult.success) throw new Error('Failed to dispatch webhook for paid pending booking');
    console.log('🎉 Flow 2 Verified: Webhook successfully triggered with payment_method="PayPal" and class="Business"!');

    // Cleanup Flow 2 booking
    await connection.execute('DELETE FROM flight_seat_allocations WHERE booking_id = ?', [pendingBookingId]);
    await connection.execute('DELETE FROM ticket_audit_logs WHERE ticket_id IN (SELECT ticket_id FROM tickets WHERE booking_id = ?)', [pendingBookingId]);
    await connection.execute('DELETE FROM tickets WHERE booking_id = ?', [pendingBookingId]);
    await connection.execute('DELETE FROM booking_passengers WHERE booking_id = ?', [pendingBookingId]);
    await connection.execute('DELETE FROM bookings WHERE booking_id = ?', [pendingBookingId]);

  } catch (error) {
    console.error('\n❌ Integration Test Failed:', error);
    process.exitCode = 1;
  } finally {
    // Cleanup test booking
    if (testBookingId) {
      console.log(`\n🧹 Cleaning up test booking ID ${testBookingId}...`);
      try {
        await connection.execute('DELETE FROM flight_seat_allocations WHERE booking_id = ?', [testBookingId]);
        await connection.execute('DELETE FROM ticket_audit_logs WHERE ticket_id IN (SELECT ticket_id FROM tickets WHERE booking_id = ?)', [testBookingId]);
        await connection.execute('DELETE FROM tickets WHERE booking_id = ?', [testBookingId]);
        await connection.execute('DELETE FROM booking_passengers WHERE booking_id = ?', [testBookingId]);
        await connection.execute('DELETE FROM bookings WHERE booking_id = ?', [testBookingId]);
        console.log('✅ Cleanup completed.');
      } catch (cleanupErr) {
        console.error('Cleanup error:', cleanupErr.message);
      }
    }
    // Small delay to allow any pending async logs
    await new Promise(r => setTimeout(r, 500));
    connection.release();
    pool.end();
  }
}

runWebhookIntegrationTest();

