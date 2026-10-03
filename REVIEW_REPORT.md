# SkyWings code review

Review date: 3 October 2026.

The application has significant authorization, booking inventory, fresh-install schema, and UI behavior defects. Address the high-priority findings before treating it as ready for real bookings.

## Verification and scope

- Parsed all 44 project JavaScript files and seven inline HTML scripts: no syntax errors.
- Checked local HTML `src` and `href` targets: no missing files found.
- Connected to local MySQL 8.0.44 using read-only queries and inspected schema metadata. The existing database contains columns and enum values absent from the committed schema.
- Ran nine isolated reproductions against actual route/service/frontend functions with mocked database or DOM dependencies. Results are recorded below.
- Did not run `npm test`: it deletes a seat allocation on an existing flight, changes that flight's schedule, and can trigger the real email webhook. It needs an isolated test database and notification stub first.
- Did not alter application code or database records. Browser rendering, mobile screenshots, live payment integration, and dependency vulnerability scanning were not verified.

## High priority

### 1. Customers can bypass the booking state machine

**Location:** `backend/routes/bookings.js:204`.

`POST /api/bookings/:id/update-status` accepts any listed status and writes it directly. A customer can reactivate a terminal booking, confirm an unpaid booking, or claim boarding/completion without the associated ticket, allocation, timestamp, and audit updates. Isolated reproduction: an owned `COMPLETED` booking was changed to `PENDING`, with HTTP 200.

**Suggested fix:** Remove the generic customer status setter. Expose specific authorized actions through the transactional state machine, with payment and operational prerequisites.

### 2. Customers can board other customers' bookings

**Locations:** `backend/routes/boarding.js:16`, `backend/services/bookingStateMachine.js:114`.

The scan route requires authentication but does not require staff authorization or check booking ownership. It assigns ordinary customers the `GATE_AGENT` actor type. The state machine loads a booking by ID without checking its owner. Isolated reproduction: a customer actor transitioned another owner's `CHECKED_IN` booking to `BOARDED`.

**Suggested fix:** Require an authorized staff role for gate scans and enforce resource authorization before transitions. Derive actor capabilities from trusted permissions.

### 3. Arbitrary passenger IDs can expose another customer's passenger information

**Location:** `backend/repositories/bookingRepository.js:65`.

When `passenger_id` is supplied, the repository links it to the booking without checking the passenger's `user_id`. Booking and ticket detail queries subsequently return that passenger's information, including passport details. Isolated reproduction: supplying passenger ID 999 produced only a link INSERT, with no ownership lookup.

**Suggested fix:** Validate every supplied passenger ID against the authenticated owner within the transaction. Validate required names, lengths, dates, and cabin values before database writes.

### 4. Rebooking history has no booking ownership check

**Locations:** `backend/routes/bookings.js:445`, `backend/repositories/rebookingRepository.js:95`.

Any authenticated customer can request history for an arbitrary booking ID. Results include actor email and old/new passenger seat mappings. Isolated reproduction returned another booking's history with HTTP 200.

**Suggested fix:** Check the booking owner, allowing an explicit admin exception, before fetching history. Scope idempotency lookups to the authorized booking/user as well.

### 5. Paid bookings are created without payment verification

**Locations:** `backend/services/bookingService.js:50`, `backend/routes/bookings.js:267`, `frontend/js/main.js:3310`.

Creating a booking without `is_pending` defaults to `CONFIRMED`/`paid`. The pay route also marks a booking paid without verifying a gateway transaction. The frontend explicitly implements a mock payment flow; this supports a demonstration but cannot establish that money was collected.

**Suggested fix:** Make unpaid creation the default. Confirm real payments only from a verified gateway result/webhook, checking amount, currency, booking reference, and idempotency. If keeping a demo, clearly label it and disable simulated confirmation in production.

### 6. Committed schema does not match repository SQL

**Locations:** `database/schema.sql:178`, `database/schema.sql:221`, `database/schema.sql:256`, `backend/repositories/seatHoldRepository.js:107`, `backend/repositories/disruptionRepository.js:29`.

Examples of fresh-install failures:

- Seat hold SQL uses `released_at`, `updated_at`, and status `CONSUMED`; the committed table lacks those columns and enum value.
- Rebooking SQL uses `old_flight_id`, `rebooking_id`, `rebooking_key`, and actor/seat fields; the committed table defines a substantially different structure.
- Disruption SQL uses execution timestamps, operational notes, old/new schedule and aircraft fields, and `EXECUTING`/`EXECUTED` statuses absent from the committed table.
- Notification SQL requires attempts/error/sent timestamp fields absent from the committed table.
- User ticket listing orders by `tickets.created_at`; that column is absent from the committed tickets table.
- Ticket audit history orders by `ticket_audit_logs.changed_at`; the committed table instead defines `created_at`.

Read-only inspection confirmed that the local database has several of these newer fields, so success locally would not verify a fresh deployment. `CREATE TABLE IF NOT EXISTS` does not migrate existing tables.

**Suggested fix:** Reconcile the schema with the repositories and introduce versioned migrations. Verify both a clean install and an upgrade from the old schema in disposable databases.

### 7. Booking capacity excludes checked-in and boarded passengers

**Location:** `backend/repositories/bookingRepository.js:8`.

The final booking capacity check sums only `pending` and `confirmed` bookings. Once passengers check in, they stop counting toward that check even though they still occupy capacity. Requests without specific seat selections can therefore pass the capacity check incorrectly. Search uses a different, broader status list.

**Suggested fix:** Centralize inventory calculation and include all capacity-consuming states. Enforce cabin capacity as well as total capacity under the flight lock. Rebooking must apply the same capacity check inside its transaction.

### 8. Seat holds and final allocation use different inventories

**Locations:** `backend/services/seatHoldService.js:70`, `backend/repositories/seatHoldRepository.js:62`, `backend/repositories/seatRepository.js:119`, `backend/services/bookingService.js:91`.

The newer hold flow stores holds in `seat_holds`, but final allocation checks only `flight_seat_allocations`. A request can allocate a seat actively held by another user. The legacy hold route stores holds in the other table, while the unified seat map reads the newer table. Session validation checks hold count without constraining flight or verifying the requested seats match the held seats.

**Suggested fix:** Use one authoritative seat inventory. Check hold owner, flight, session, seat, and expiry during final allocation. Enforce the booked cabin's seat class. Make retrying the same hold idempotent.

### 9. Unescaped database values enter HTML

**Locations:** `frontend/js/main.js:4979`, `frontend/js/main.js:6130`, `frontend/js/main.js:6569`, `backend/repositories/bookingRepository.js:65`.

Passenger names and airport fields are interpolated into `innerHTML`. Booking creation has no passenger-name validation that excludes HTML. A stored HTML payload can reach customer or administrator detail screens. This is a stored XSS path identified by tracing input to rendering; script execution was not tested in a browser.

**Suggested fix:** Render user-controlled text with `textContent` and DOM properties. Avoid putting data into HTML or inline event-handler strings. Add input validation and a restrictive CSP as additional protection.

### 10. Reading dashboards rewrites booking lifecycle states

**Locations:** `backend/routes/admin.js:12`, `backend/routes/reports.js:11`, `frontend/js/main.js:2444`.

GET handlers run lifecycle mutations. Their SQL treats any assigned seat as evidence of boarding after departure and can change `COMPLETED` back to `BOARDED`. Frontend display logic applies similar assumptions. Seat assignment does not establish check-in or boarding, so reports and travel history can be inaccurate.

**Suggested fix:** Keep reporting reads free of lifecycle writes. Use a scheduled, auditable worker for time-based expiry/completion and actual check-in/gate events for passenger progress. Render server states consistently.

### 11. Flight cancellation can partially succeed

**Location:** `backend/routes/admin.js:460`.

Flight, booking, ticket, and allocation changes use separate autocommitted queries. Cascade errors are caught and logged, yet the endpoint still returns success. A cancelled flight can retain inconsistent bookings or seats. Setting `payment_status = refunded` also records a refund without a payment-provider refund result.

**Suggested fix:** Use the existing transactional domain services for database changes. Track refunds as separate verified operations, with retryable delivery and explicit pending/failed outcomes.

### 12. Email configuration silently falls back to a real endpoint

**Locations:** `backend/services/emailWebhookService.js:7`, `.env.example`, `README.md` email configuration.

The service uses a hardcoded production webhook when `N8N_EMAIL_WEBHOOK_URL` is unset. README instructions instead specify `N8N_BOOKING_EMAIL_WEBHOOK_URL`, which the service does not read. A developer following the README can unintentionally send booking data to the fallback endpoint.

**Suggested fix:** Standardize the environment variable, remove the production fallback, and explicitly disable external delivery when unconfigured. Use notification stubs for tests and a durable outbox for reliable delivery.

## UI and functional issues

### 13. Round-trip search ignores the return date

**Locations:** `frontend/flight-search.html:81`, `frontend/js/main.js:1827`, `backend/routes/flights.js:10`.

The UI defaults to Round Trip, but its request omits `return` and the backend does not search a return leg. Isolated reproduction with a selected return date sent only origin, destination, departure, passengers, and class.

**Suggested fix:** Implement outbound/return selection and combined booking, or present a one-way search until that workflow exists. Validate return date against departure.

### 14. Reserve & Hold opens the payment form

**Location:** `frontend/js/main.js:2221`.

The reserve button adds an `is_pending` hidden field, but the submit handler ignores that distinction and always opens the mock payment modal. Isolated reproduction confirmed the payment modal opens for reserve requests.

**Suggested fix:** Honor the requested action. Show a reservation reference and payment deadline after holding; open payment only for the pay action. Disable both submit actions while processing and send a stable idempotency key to avoid duplicate bookings.

### 15. A preselected seat is mistaken for completed check-in

**Locations:** `frontend/js/main.js:3523`, `frontend/js/main.js:3656`.

Check-in navigation treats the presence of a passenger seat as proof of check-in. A `CONFIRMED` booking with a seat assigned during booking/rebooking can be blocked from check-in even though it has no check-in record.

**Suggested fix:** Use booking/check-in state to determine completion and prefill existing seats when starting check-in.

### 16. Seat map invents seats and permits selecting held seats

**Locations:** `frontend/js/main.js:3778`, `frontend/js/main.js:3869`.

The map renders six seats per row and defaults missing API seats to available. Isolated reproduction: seven supplied seats rendered as twelve, including nonexistent `2B` through `2F`. Selection blocks only `occupied`, allowing another passenger's `held` seat to be selected. Clicking seats does not call the hold API, despite hold/countdown UI.

**Suggested fix:** Render the actual seat list and layout, mark unavailable seats as disabled, and integrate real hold/release requests if promising a hold. Refresh inventory on conflicts.

### 17. Useful backend errors become generic status messages

**Locations:** `frontend/js/main.js:174`, `backend/controllers/bookingController.js:61`.

The client reads `data.message`, but booking/hold controllers return `data.error.message`. Isolated reproduction turned “Seat 18A is no longer available” into “Request failed with status 409.”

**Suggested fix:** Normalize the response envelope or read both message locations, preserving an error code for UI decisions. Provide a retry or seat-refresh action for conflicts.

### 18. Contact form displays success without sending anything

**Location:** `frontend/js/main.js:7615`.

Submission waits briefly, shows a success banner, and resets the form without an API request or durable storage. Customer messages are lost.

**Suggested fix:** Connect a validated contact endpoint and show success only after delivery/storage succeeds. Preserve entered text when delivery fails.

### 19. Boarding pass QR and barcode graphics are decorative

**Locations:** `frontend/js/main.js:3991`, `frontend/js/main.js:4018`.

The graphics use custom patterns and a character-sum seed rather than encoding a valid barcode/QR payload. They should not be presented as operationally scannable passes.

**Suggested fix:** Generate valid encodings of a server-issued, verifiable boarding token and verify it at the gate. For a demo, label the graphics as samples.

### 20. Important controls lack keyboard accessibility

**Locations:** `frontend/flight-search.html:51`, `frontend/flight-search.html:125`, `frontend/js/main.js:3829`, modal markup in `frontend/flight-search.html` and `frontend/js/main.js`.

Hamburger controls, quick-date chips, and seats use clickable `div`/`span` elements without button semantics or keyboard activation. Modal focus trapping, Escape handling, and accessible dialog metadata were not found in the reviewed code.

**Suggested fix:** Use native buttons, meaningful accessible names and selected/expanded states. Manage modal focus and restore it on close. Then verify keyboard navigation and small-screen layouts in a browser.

## Other correctness and maintainability issues

### 21. The advertised 1,000 tests are mostly repeated assertions

**Location:** `scripts/master_test.js:361`.

The suite pads its count to 1,000 by repeatedly asserting that no earlier assertion failed. Sorting verification sorts the response itself before asserting order. It deletes an existing flight's `18A` allocation without restoring that allocation, changes an existing schedule, and prints a broad production-readiness claim.

**Suggested fix:** Replace padding with independent checks for authorization, concurrency, capacity, schema installation, hold expiry, payment replay, and UI behavior. Use disposable fixtures/databases and mock external notifications. Assert response order before sorting it.

### 22. Partial flight updates can create invalid schedules

**Location:** `backend/routes/admin.js:446`.

Arrival-after-departure validation runs only when both values are supplied. Updating just one endpoint of an existing schedule can reverse the flight's chronology. Price updates lack corresponding finite/nonnegative checks, and aircraft changes do not reconcile existing seat assignments.

**Suggested fix:** Load the full existing flight, merge the requested fields, and validate the resulting record and allocations inside a transaction. Check aircraft availability and scheduling conflicts.

### 23. Pending reservations have no short payment expiry

**Locations:** `backend/services/bookingService.js:53`, `backend/services/seatHoldCleaner.js:40`, `backend/routes/admin.js:79`.

The cleanup worker expires seat holds, not unpaid pending bookings. Pending capacity is released by departure-time logic invoked from some admin reads rather than a reservation deadline. An abandoned reservation can block capacity for the whole period before departure.

**Suggested fix:** Store a server-defined reservation/payment deadline and expire unpaid bookings in a scheduled transactional worker. Release all associated inventory and reject payment after expiry.

### 24. Flight repository destructures the database helper incorrectly

**Location:** `backend/repositories/flightRepository.js:34`.

`query()` already returns the rows array, but `findById()` destructures it as if it were mysql2's `[rows, fields]` result. Isolated reproduction returned `null` for an existing flight row; an empty result can also cause a TypeError.

**Suggested fix:** Assign the helper result directly and return its first row. Audit other helper usages for the same mismatch.

### 25. Notifications and performance metrics report simulated results

**Locations:** `backend/workers/disruptionNotificationWorker.js:22`, `backend/routes/reports.js:529`.

The disruption worker marks notifications `SENT` with `mockSuccess = true`, without delivery. Reports hardcode satisfaction scores/review counts, fuel efficiency, and maintenance metrics.

**Suggested fix:** Require an actual delivery acknowledgement before recording `SENT`. Source metrics from recorded events/data, or explicitly label unavailable/demo metrics.

### 26. Request logging includes credentials and personal data

**Location:** `frontend/js/main.js:182`.

The generic API helper logs complete request bodies and response payloads, including login/registration/password-change credentials and passenger/profile data. Backend response handlers also frequently expose raw database error messages.

**Suggested fix:** Remove body logging or redact sensitive fields; keep production diagnostic logging structured and minimal. Return safe user messages and retain technical errors only in server logs. Add login abuse protection and invalidate existing sessions when passwords change.

## Recommended order of work

1. Close authorization and payment bypasses; remove unsafe HTML interpolation and credential logging.
2. Reconcile schema and add migrations, then centralize inventory and lifecycle transitions.
3. Fix transactional cancellation, reservation expiry, and notification configuration/delivery.
4. Correct search, reserve, check-in, seat map, contact, and error-message behavior.
5. Replace padded tests with isolated regression coverage; verify desktop/mobile rendering and accessibility.
6. Split the roughly 7,600-line frontend controller into feature modules and consolidate the roughly 11,000-line stylesheet. Preserve behavior while simplifying duplicate lifecycle and UI logic.
