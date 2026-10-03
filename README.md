<p align="center">
  <img src="frontend/images/transparent_logo_clean.PNG" alt="SkyWings logo" width="150">
</p>

# SkyWings Airline Management System

A full-stack airline reservation and operations application built with Node.js, Express, MySQL and vanilla JavaScript. SkyWings brings passenger booking, administration and airport gate operations into three dedicated portals.

Customers can plan one-way, return and multi-city journeys, reserve cabin inventory, select seats and check in. Administrators manage flights, disruptions, reports and feedback. Airport crew handle manifests, gate controls and individual passenger boarding.

**Project status:** local workflows are implemented and tested. Payment confirmation is a development simulation; live payments and airline/airport integrations remain required before operational deployment. See the [enterprise readiness audit](ENTERPRISE_READINESS_AUDIT.md).

## Features

| Area | Capabilities |
| --- | --- |
| Flight search | One-way, return and multi-city trips; up to six legs and nine passengers; cabin selection, fare/time filters and sorting |
| Reservations | Server-calculated fares, shared journey references, atomic multi-leg reservations, retry protection and ten-minute unpaid reservation deadlines |
| Seats and check-in | Cabin-aware availability, temporary server seat holds, check-in, individual tickets and QR boarding passes |
| Customer portal | Saved passengers, booking history, eligible rebooking/cancellation and support messages |
| Admin portal | Flight and aircraft management, schedule validation, disruption handling, database-backed reports and crew provisioning |
| Feedback inbox | Search, pagination, new/reviewed/resolved filters, individual deletion to Trash and restoration |
| Airport crew portal | Assigned-airport flight access, passenger manifests, gate assignment, boarding open/close, scanning and per-passenger boarding |
| Audit and access | Role and airport authorization, gate audit history, transactional admin audits, token revocation and request rate limits |

## Technology

- **Frontend:** HTML, CSS and JavaScript, served by Express.
- **Backend:** Node.js, Express, JWT authentication and bcrypt password hashing.
- **Database:** MySQL 8, transactional reservations and versioned schema migrations.
- **Boarding passes:** server-generated QR codes with individual passenger tokens.
- **Verification:** Node.js regression tests, disposable MySQL workflows and Playwright/Chromium browser checks.

## Getting started

### Prerequisites

- Node.js 22 or newer and npm.
- A running MySQL 8 server.
- Local database credentials with permission to create the application database and tables. Integration tests additionally need permission to create and drop disposable test databases.

Run the following commands from the repository root.

### 1. Install dependencies

```sh
npm ci
```

### 2. Configure the environment

Copy [.env.example](.env.example) to `.env`:

```sh
# macOS / Linux
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

The template contains production/cloud placeholders. Replace them with your local settings before running setup or seeding:

```dotenv
PORT=3000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_USER=your_local_database_user
DB_PASSWORD=your_local_database_password
DB_NAME=skywings_airlines
DB_SSL=false
DB_CONNECTION_LIMIT=10

JWT_SECRET=replace_with_a_random_secret_generated_below
JWT_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:3000

PAYMENT_MODE=demo
NOTIFICATIONS_ENABLED=false
DISRUPTION_NOTIFICATION_WEBHOOK_URL=
N8N_BOOKING_EMAIL_WEBHOOK_URL=
```

Generate a random JWT secret, then paste its output into `JWT_SECRET`:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

`.env` is private and excluded from Git. `PAYMENT_MODE=demo` enables development confirmation without collecting money or payment credentials. Use `disabled` to disable that confirmation.

### 3. Set up and seed the database

```sh
npm run db:setup
npm run db:seed
```

Setup creates the schema and applies versioned migrations. Run it again when upgrading an existing installation. Seeding requires development/test mode and demo payments; it skips databases that already contain users.

### 4. Start the application

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). For development with automatic server reloads:

```sh
npm run dev
```

The API health endpoint is `GET /api/health`.

## Portals and sample accounts

| Portal | Local address | Sample email | Sample password |
| --- | --- | --- | --- |
| Customer | [Customer dashboard](http://localhost:3000/user-dashboard.html) | `user@skywings.com` | `DemoPass123!` |
| Administrator | [Admin dashboard](http://localhost:3000/admin-dashboard.html) | `admin@skywings.com` | `DemoPass123!` |
| Airport crew | [Gate operations](http://localhost:3000/crew-portal.html) | `crew@skywings.com` | `DemoPass123!` |

Sign in through the [login page](http://localhost:3000/login.html); the application redirects each role to its portal. The sample crew member, Hamza Iqbal, is assigned to Karachi (`KHI`). Administrators retain gate operations on their dashboard and can create crew accounts with an assigned departure airport. Public registration creates customer accounts.

The Pakistani sample dataset contains **14 accounts, 12 airports, 4 aircraft, 288 seats, 63 flights and 19 bookings**. Names include Ali Raza, Ayesha Khan, Hassan Ahmed, Fatima Malik and Ahmed Farooq. Flights are scheduled relative to the time of seeding. Passenger identities, addresses and passport references are synthetic; aircraft have compact demonstration cabins.

Sample accounts are for local evaluation. Production startup rejects active known sample accounts and the default demo password.

### Login on a hosted installation

Database migrations preserve hosted users and passwords; they do not copy the local sample accounts. The README sample password will therefore not sign in to a production installation. Use an account registered on that website or credentials provisioned for its database.

An operator with database access can inspect or recover one existing account from an interactive terminal. Configure the database environment for the intended installation first and verify the target printed by the command:

```sh
npm run account:recover -- --check your-account@example.com
npm run account:recover -- --reset your-account@example.com
```

Checking is read-only and reports account existence, role, status and password format without showing the password hash. Reset requires confirmation of the account and twice-entered hidden input for a unique password of at least 12 characters (up to 72 UTF-8 bytes), containing uppercase, lowercase and a number. It preserves the account's role and records, revokes existing sessions and writes a transactional audit. It does not create missing accounts or reactivate suspended ones. Do not send passwords in chat or command arguments, or reset the database to recover a login.

### Resetting local sample data

```sh
npm run db:reset
```

**This replaces the local application database.** Reset is restricted to the development `skywings_airlines` database on localhost. If an existing database is present, it first saves a private SQL backup under `backups/`, restores it into an isolated database and verifies table row counts before resetting and reseeding. Backups are excluded from Git.

## Workflow rules

- Reservations begin unpaid and expire after ten minutes. Multi-leg reservation and development confirmation succeed or roll back together.
- Check-in opens 24 hours before departure. Choosing a seat creates a server hold; assigned seats alone do not indicate completed check-in or boarding.
- Gate scans require an administrator or airport-authorized crew member, an open gate, the correct flight, a valid issued ticket, an unused passenger token and staff identity confirmation. Boarding is permitted within 90 minutes before departure.
- Each successful scan records one passenger and consumes that passenger's ticket. A group booking becomes boarded only after every passenger is recorded. Successful and rejected scans have separate gate audit records without raw boarding tokens.
- Connecting journey legs require at least 60 minutes under the application's current policy. Airport-specific connection rules and interline itineraries are not implemented. Independent single-leg rebooking of linked journeys is blocked; coordinated journey changes remain future work.
- Eligible single-flight rebooking preserves the route and resets prior check-in and seat assignments. Flight cancellation updates linked booking, seat, check-in and ticket records transactionally.
- Dashboard/report reads do not advance booking states. Unmeasured aviation metrics display as unavailable. Real refunds require provider processing; development refunds are explicitly simulated.

## Notifications

Support messages are validated and stored with a reference. Admin inbox changes are audited and do not send email.

External delivery is disabled by default. To enable it, set `NOTIFICATIONS_ENABLED=true` and configure the applicable endpoint:

| Variable | Purpose |
| --- | --- |
| `N8N_BOOKING_EMAIL_WEBHOOK_URL` | Real paid booking confirmations |
| `DISRUPTION_NOTIFICATION_WEBHOOK_URL` | Disruption notifications |

Demo payments do not dispatch external booking confirmations. Notification success means gateway acceptance; final mailbox delivery is outside the application.

## Tests and verification

Install Chromium before running browser checks:

```sh
node node_modules/playwright/cli.js install chromium --no-shell
```

Run the complete verification suite:

```sh
npm run test:all
```

| Command | Coverage |
| --- | --- |
| `npm test` | Independent security, authorization, inventory and workflow regressions |
| `npm run test:schema` | Fresh schema, legacy upgrades and repeated migrations |
| `npm run test:workflows` | Booking, holds, expiry, rebooking, boarding and support workflows |
| `npm run test:seed` | Sample data, cabin capacity, lifecycle and repeat-seed safety |
| `npm run test:ui` | Keyboard navigation, date controls and modal focus behavior |
| `npm run test:enterprise` | Multi-leg ownership, retry protection, capacity, rollback, expiry and staff provisioning |
| `npm run test:browser` | All 14 pages at desktop/mobile widths; registration/logout/re-login; complete customer, admin and crew workflows |

Database/browser checks use disposable `skywings_test_*` databases rather than application records. External delivery is stubbed or disabled. `test:all` runs the seven checks sequentially and stops on failure. Results, logs and screenshots are saved under the Git-ignored `artifacts/` directory.

**Last verified: 3 October 2026.** The independent regression suite has 40 passing tests, including rejection of an outdated database before server/cleanup startup. Schema checks reproduce and repair the missing reservation-expiry column while preserving an existing booking. The seven-part suite also covers browser checks at 1440px and 390px. The dependency audit reported zero vulnerabilities during the feature-upgrade audit. These checks cover local application behavior; they do not certify production hosting, payment settlement or airport interoperability.

## Repository structure

```text
backend/
  config/           Database configuration
  middleware/       Authentication, authorization and request controls
  repositories/     Database access
  routes/           HTTP API endpoints
  services/         Reservation, inventory and operations logic
  workers/          Background processing
database/
  schema.sql        Canonical database schema
  migrations/       Versioned upgrades
frontend/
  *.html            Customer, admin and crew pages
  css/              Shared and operations styling
  js/               Browser workflows
scripts/            Setup, seeding, backups and verification
tests/              Independent regression tests and fixtures
```

## Deployment and documentation

Read the [enterprise readiness audit](ENTERPRISE_READINESS_AUDIT.md) before planning a production launch. Outstanding work includes live payment/refund integration, airport/DCS interoperability, staff MFA and device controls, production hosting/security, load/failover testing and managed recovery verification. The QR payload currently verifies internal application tokens; it is not an implemented IATA boarding-pass or airport-reader integration.

For Render, use Build Command `npm ci` and Start Command `npm run start:deploy` to apply database migrations before launching. Alternatively, run `npm run db:setup` in a supported pre-deploy step and start with `npm start`. The server refuses an outdated schema before listening or starting cleanup. See the [Render migration troubleshooting instructions](DEPLOYMENT_GUIDE.md#render-missing-reservation-expiry-column) for the `reservation_expires_at` error. Neither migration path resets or seeds hosted data.

The core migration also handles the seat-hold generated-column dependency reported by TiDB. It skips unnecessary status changes, preserves existing enum order and recreates the generated flag and unique-seat index when an upgrade requires it. Schema tests cover existing hold records, interrupted migration retries and restored duplicate-seat protection on MySQL with TiDB-style checks. A live TiDB deployment still needs verification against its own database version.

| Document | Purpose |
| --- | --- |
| [Enterprise readiness audit](ENTERPRISE_READINESS_AUDIT.md) | Release decision, verification evidence and remaining production requirements |
| [Gate boarding audit](GATE_BOARDING_AUDIT.md) | Crew/admin permissions, boarding controls and operational limits |
| [Deployment guide](DEPLOYMENT_GUIDE.md) | Hosting configuration guidance; read alongside the readiness audit |
| [Original review](REVIEW_REPORT.md) | Original findings and their context |
| [Repair progress](FIX_PROGRESS.md) | Completed fixes, verification and resume checkpoint |

## License

This repository includes the [MIT License](LICENSE).
