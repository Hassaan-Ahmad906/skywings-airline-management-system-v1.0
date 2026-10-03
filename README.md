# SkyWings Airlines

A Node.js, Express, MySQL and vanilla JavaScript airline application. It supports one-way, return and multi-city reservations, cabin-aware inventory, check-in, a dedicated airport crew portal, per-passenger boarding, audit history, rebooking, disruptions and a support inbox. Online confirmation currently uses explicitly labelled development simulation; a live payment provider is not integrated.

## Run locally

Use Node.js 22 or newer and MySQL 8. Configure `.env` from `.env.example` with your local database credentials and a random JWT secret. The private local `.env` is already configured in this workspace.

```sh
npm install
npm run db:setup
npm run db:seed
npm start
```

Open http://localhost:3000. `npm run dev` uses Node's built-in watch mode.

## Pakistani sample data

The local sample dataset contains 14 accounts (including airport crew), 12 airports, 4 demo aircraft, 288 cabin seats, 63 flights, and 19 bookings. Flights are dated relative to seeding. Names include Ali Raza, Ayesha Khan, Hassan Ahmed, Fatima Malik, Sana Ahmed and Ahmed Farooq. Addresses, passport references and support inquiries are synthetic. Aircraft use compact demonstration cabins.

| Role | Name | Email | Demo password |
| --- | --- | --- | --- |
| Administrator | Ahmed Farooq | admin@skywings.com | DemoPass123! |
| Customer | Ali Raza | user@skywings.com | DemoPass123! |
| Karachi airport crew | Hamza Iqbal | crew@skywings.com | DemoPass123! |

Other customer addresses use `firstname.lastname@example.test` and the same demonstration password. These accounts belong only in a local demo.

`npm run db:reset` resets **only the local development `skywings_airlines` database**. It first writes a private SQL backup under `backups/`, restores it into an isolated database and verifies every table row count, then installs the schema and seeds the sample data. Seeding an already populated database skips existing records. Backups and `.env` are excluded from Git.

The pre-reset backup is `backups/skywings_airlines-2026-10-03T14-45-06-951Z.sql`. To restore it, select a clean database and execute the backup with a MySQL client after stopping the app; its SQL targets `skywings_airlines`.

## Booking behavior

Reservations start unpaid and expire after ten minutes. Development/test confirmation requires `PAYMENT_MODE=demo` and collects no money or payment credentials. Production always rejects demo confirmation. A real payment provider is not integrated.

Check-in opens 24 hours before departure. Selecting a seat creates a server hold in the booked cabin. Assigned seats do not imply completed check-in or boarding. Tickets become USED only when staff record boarding. Each passenger receives a random server-issued token encoded as a QR code. Gate scans require an administrator or assigned airport crew member, an open gate within the 90-minute window, the correct flight, an unused token, a valid issued ticket and an identity confirmation. A group booking is marked BOARDED after every passenger is recorded.

The global payment banner is removed. The confirmation dialog retains accurate payment information. Return and multi-city search uses each leg's airports/date, supports up to six legs and nine passengers, and provides cabin, departure-time, fare and sorting controls. All selected legs reserve in one transaction with a shared journey reference; a failed leg rolls back the whole reservation. Development confirmation of a journey is also atomic. Connecting legs require at least 60 minutes in this application; airport-specific connection rules and interline connections are not implemented. Linked journeys cannot use independent single-leg rebooking because that could invalidate their itinerary. Coordinated journey changes require a future workflow.

Open `/crew-portal.html` for departure control. Crew can search their airport's upcoming flights, see a minimal passenger manifest, assign gates, open/close boarding, scan connected-reader codes or enter tokens, and review gate audit history. Administrators have the same workspace on their dashboard and can create crew accounts with an assigned airport through the portal. Customer registration cannot assign crew privileges. Successful and rejected scans are stored separately in `gate_audit_events`; tokens are never stored in that audit table. This verifies internal application codes, not compatibility with airline departure-control systems or IATA boarding-pass readers.

Dashboard/report requests are read-only. The scheduled worker expires unpaid reservations and records no-shows; only recorded boarding can become completed travel. Unmeasured metrics such as actual on-time performance, fuel efficiency and satisfaction display as unavailable. Charts use stored data.

Flight cancellation updates bookings, tickets, seats and check-in together. An unpaid cancellation does not invent a refund. Demo refunds are explicitly simulated; real paid bookings retain a pending refund until provider processing is implemented.

Rebooking requires an eligible paid booking and preserves the route. Existing check-in and seat assignments are reset. Active itineraries cannot be edited directly: use the authenticated disruption/rebooking APIs. Incompatible aircraft layouts and overlapping schedules are rejected.

## Notifications and support

Contact messages are validated and stored in `contact_messages`, with a reference shown after storage succeeds. The admin inbox supports search, pagination and new/reviewed/resolved filters. Individual messages can be moved to Trash and restored. These changes are recorded in the admin audit; they do not send email. `GET /api/contact`, `PATCH /api/contact/:id`, `DELETE /api/contact/:id` and `POST /api/contact/:id/restore` require admin access.

External notification delivery is disabled by default. Enable `NOTIFICATIONS_ENABLED=true` only with an intentionally configured endpoint:

- `N8N_BOOKING_EMAIL_WEBHOOK_URL` for real paid booking confirmations.
- `DISRUPTION_NOTIFICATION_WEBHOOK_URL` for disruption notifications.

Demo payments never dispatch external booking notifications. Tests stub or disable delivery. A successful notification status records gateway acceptance; final mailbox delivery is outside this application.

## Verification

```sh
npm test
npm run test:schema
npm run test:workflows
npm run test:seed
npm run test:ui
npm run test:browser
npm run test:enterprise
npm run test:all
```

The independent regression suite uses isolated stubs. Database checks create and drop only `skywings_test_*` databases and never change application records. Browser checks require Chromium: `node node_modules/playwright/cli.js install chromium --no-shell`. Browser screenshots are saved privately under `artifacts/`. `test:all` runs the seven checks sequentially, stops on failure, and saves `artifacts/final-test-results.json` and `artifacts/final-test-output.log`.

`REVIEW_REPORT.md` preserves the original audit. `FIX_PROGRESS.md` records fixes, verification and resume state. `GATE_BOARDING_AUDIT.md` documents the staff workflow and `ENTERPRISE_READINESS_AUDIT.md` records release limits. Production requires database credentials and a JWT secret of at least 32 characters. Startup refuses active synthetic sample accounts or the known default demo password. Real payments, provider refunds, airline/airport integration and live aviation telemetry require separate integrations before operational use. Run `npm run db:setup` on upgrades; migrations 008–010 preserve existing application records while adding inbox, crew/gate and journey features.
