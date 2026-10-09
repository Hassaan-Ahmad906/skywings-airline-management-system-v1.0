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

### Shared local and hosted demo accounts

Local `db:seed` and the isolated TiDB `db:public-demo` use the same [seed implementation](scripts/seed_database.js) and [account configuration](backend/config/demoSeed.js). Both create the same synthetic Pakistani passengers, bookings, fleet, cabin seats, fares and routes. Use these credentials on either freshly seeded demo:

| Portal | Email | Password |
| --- | --- | --- |
| Customer: Ali Raza | `demo.user@public-demo.example.com` | `DemoUser2026!` |
| Administrator: Ahmed Farooq | `demo.admin@public-demo.example.com` | `DemoAdmin2026!` |
| Airport crew: Hamza Iqbal, Karachi (`KHI`) | `demo.crew@public-demo.example.com` | `DemoCrew2026!` |

All demo accounts are shared and payment confirmations are simulated. The other 11 seeded customers use lowercase `firstname.lastname@public-demo.example.com` emails and the customer password above. The current Vercel website uses the primary `skywings_airlines` database with different staff credentials; this demo table does not apply to that website.

Both demo seeds contain **14 accounts, 12 airports, 4 aircraft, 288 seats, 63 flights and 19 bookings**. Names include Ali Raza, Ayesha Khan, Hassan Ahmed, Fatima Malik and Ahmed Farooq. Passenger identities, addresses and passport references are synthetic; aircraft have compact demonstration cabins. Flight dates are relative to each seed run. Generated IDs, password hashes, boarding tokens and booking references differ between installations; reservations also expire and booking states advance over time.

### Isolated public demo on TiDB

The separate `skywings_public_demo` TiDB database already contains the shared dataset and credentials above. The demo is prepared for a separate Render service; its public URL will be added after deployment.

To run the prepared demo locally with its private TiDB connection:

```sh
npm run start:public-demo
```

Open [http://localhost:3001/login.html](http://localhost:3001/login.html). A fresh installation can copy [.env.public-demo.example](.env.public-demo.example) to the private `.env.public-demo`, configure the demo database connection and set a new random JWT secret. The launcher refuses the primary database, requires a distinct signing secret, uses UTC dates and disables external notifications. The isolated sample dataset has 14 accounts, 12 airports, 4 aircraft, 288 seats, 63 flights and 19 synthetic bookings. Repeat startup preserves the demo data; an incomplete seed refuses to start.

Deploy a **separate** service using [render.yaml](render.yaml) in Render's Blueprint flow. Provide the demo database connection in Render's private environment fields and use a database user restricted to the demo schema. The Blueprint generates an independent JWT secret and runs `npm run start:public-demo`. It serves both the frontend and API from the new service. See [Render's Blueprint documentation](https://render.com/docs/infrastructure-as-code).

An operator can restore the shared sample data and refresh its relative flight dates with `npm run db:reset:public-demo -- --reset`. This backs up and restore-verifies the isolated demo before rebuilding it. The reset command accepts only `skywings_public_demo`; it cannot reset `skywings_airlines`.

### Hosted customer samples

Sign in at the [live SkyWings login page](https://skywings-airline-management-system.vercel.app/login). These public sample accounts have customer access and synthetic Pakistani profiles:

| Name | Email | Password |
| --- | --- | --- |
| Ali Raza | `sample.ali.raza.2026@example.com` | `AliSample2026!` |
| Fatima Malik | `sample.fatima.malik.2026@example.com` | `FatimaSample2026!` |

Verified on **4 October 2026**: both accounts signed up, logged out and logged back in on the live website. Desktop and mobile customer dashboards were checked. These are shared public accounts; use your own registered account for personal bookings or passenger details. Hosted admin and crew passwords are private because those accounts access booking records and gate operations.

### Hosted TiDB staff and private accounts

The following hosted portal accounts also exist in the actual TiDB database; their roles, active status and stored password matches were verified on **4 October 2026**:

| Hosted role | Email | Password location |
| --- | --- | --- |
| Customer (private account) | `user@skywings.com` | Operator's private `artifacts/tidb-sample-accounts.json` |
| Administrator | `admin@skywings.com` | Operator's private `artifacts/tidb-sample-accounts.json` |
| Airport crew, Karachi (`KHI`) | `crew@skywings.com` | Operator's private `artifacts/tidb-sample-accounts.json` |

These hosted staff accounts control the current booking and gate records. Public credentials for all roles require a separate demo deployment with isolated synthetic records. Database connection values such as `DB_USER` and `DB_PASSWORD` are separate from website account credentials and belong in private environment configuration.

### Local development portals

Run `npm run db:setup` and `npm run db:seed` against a fresh local development database, then use the shared demo credentials above:

| Portal | Local address |
| --- | --- |
| Customer | [Customer dashboard](http://localhost:3000/user-dashboard.html) |
| Administrator | [Admin dashboard](http://localhost:3000/admin-dashboard.html) |
| Airport crew | [Gate operations](http://localhost:3000/crew-portal.html) |

Existing local databases from earlier versions retain their old accounts because seeding skips a database containing users. To adopt the shared sample data, configure `.env` for localhost and follow [Resetting local sample data](#resetting-local-sample-data). That command backs up and verifies the previous local database before replacing it. Deploying an update or editing this README does not rewrite existing passwords.

Sign in through the [login page](http://localhost:3000/login.html); the application redirects each role to its portal. The sample crew member, Hamza Iqbal, is assigned to Karachi (`KHI`). Administrators retain gate operations on their dashboard and can create crew accounts with an assigned departure airport. Public registration creates customer accounts.

Production startup rejects active demo-domain and `.test` accounts, and known published passwords on the legacy portal accounts. Operator account recovery also refuses the published demo passwords.

### Login on a hosted installation

The public hosted customer credentials are listed above. For the primary database's private accounts created by the TiDB reseed, including hosted admin and crew, use `artifacts/tidb-sample-accounts.json` on the operator's computer. Their passwords differ from the shared demo credentials. This private credentials file, environment file and SQL backups must remain outside Git.

Database migrations preserve hosted users and passwords; they do not copy the local sample accounts. Use an account registered on that website or credentials provisioned for its database.

Login and registration support both `.html` paths and Vercel clean URLs. Redirects use the server-verified session, so a stale saved role cannot redirect a logged-out browser. Customer, admin and crew sessions each return to their own portal. Password fields include Show/Hide controls; password case and spaces are preserved exactly.

When login fails, the inline message includes a support reference. An operator can search Render logs for that reference under `Authentication rejected:` or query the corresponding private `AUTH_LOGIN_FAILURE` audit record. The internal reason distinguishes `ACCOUNT_NOT_FOUND`, `PASSWORD_MISMATCH`, `PASSWORD_STORAGE_INVALID` and `ACCOUNT_INACTIVE`; the public response does not disclose these reasons for credential failures. No password or hash is logged. A missing account means the configured database needs investigation, while invalid storage can require the account recovery command below. Do not reset the whole database to troubleshoot authentication.

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

### Reseeding TiDB while preserving history

This operator workflow targets the primary `skywings_airlines` installation. It preserves historical records and creates private accounts and a 240-flight operational schedule, so it intentionally differs from the shared 63-flight synthetic demo. To provision or refresh the synchronized server demo, use `db:public-demo` or `db:reset:public-demo -- --reset` with `.env.public-demo` instead. Data is never copied between the primary installation and either demo.

Configure the private local `.env` with the intended TiDB connection and `DB_SSL=true`. Create a consistent snapshot and verify its contents by restoring it into a temporary schema:

```sh
npm run db:backup
```

Use the private backup path printed by that command:

```sh
npm run db:seed:tidb -- --reseed skywings_airlines --backup backups/YOUR_BACKUP.sql
```

This command accepts only the named TiDB database with verified TLS and a recent, checksum-matched, restore-verified backup. It refuses unexpected schemas or records changed since the backup. The database user must have permission to create/drop the isolated restore schema.

The transaction retires previous logins and revokes their sessions while preserving account IDs for historical references. It preserves bookings, recorded payments, tickets, audits and referenced flights. It removes only flights with no booking, ticket, hold, allocation, disruption or audit reference. Four active aircraft are required; capacity values are reconciled to their existing physical seats. It creates 14 Pakistani sample accounts, saved passenger profiles, sample feedback and 240 future flights over 30 days with return rotations and turnaround time. No simulated paid bookings are created. New customers start with zero spending; the admin reports retain historical paid booking value.

Unique passwords are written to the private `artifacts/tidb-sample-accounts.json` file and are never printed or committed. Previous logins are inactive and use archived email identities; original email mappings remain in the private reseed audit. A failed transaction rolls back all database changes. This is an operator command, not an automatic deployment seed.

## Workflow rules

- Reservations begin unpaid and expire after ten minutes. Multi-leg reservation and development confirmation succeed or roll back together.
- Check-in opens 24 hours before departure. Choosing a seat creates a server hold; assigned seats alone do not indicate completed check-in or boarding.
- Gate scans require an administrator or airport-authorized crew member, an open gate, the correct flight, a valid issued ticket, an unused passenger token and staff identity confirmation. Boarding is permitted within 90 minutes before departure.
- Each successful scan records one passenger and consumes that passenger's ticket. A group booking becomes boarded only after every passenger is recorded. Successful and rejected scans have separate gate audit records without raw boarding tokens.
- Connecting journey legs require at least 60 minutes under the application's current policy. Airport-specific connection rules and interline itineraries are not implemented. Independent single-leg rebooking of linked journeys is blocked; coordinated journey changes remain future work.
- Journey search uses the selected calendar day in the browser's time zone, including daylight-saving transitions. This keeps results consistent with displayed dates on both local MySQL and UTC-based TiDB.
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

## Dashboard and report values

Dashboards and reports share the same metric definitions. Administrator cards cover all users; customer cards and profiles cover only the signed-in customer. Booking counts represent individual flight booking records, including each leg of a multi-city or return booking. Crew views cover the staff member's assigned departure airport.

| Value | Definition |
| --- | --- |
| Total bookings | All stored booking states, including cancelled, expired and missed records |
| Confirmed bookings | Confirmed, checked-in, boarded and completed records; exact-state filters remain separate |
| Upcoming bookings | Future scheduled/boarding/delayed flights with active bookings or unexpired unpaid reservations |
| Upcoming flights | Future scheduled/boarding/delayed flights assigned to active aircraft |
| Paid booking value / customer spending | Amounts marked paid, including missed bookings and cancelled bookings awaiting a refund; unpaid and refunded records are excluded |
| Occupancy | Paid confirmed/checked-in/boarded/completed passengers divided by aircraft capacity across non-cancelled flights, shown to two decimal places |
| Average route fare | Recorded paid amounts divided by their passenger count, rather than today's advertised flight price |

Paid booking value reflects application records; local simulated confirmation is not payment settlement or an accounting revenue ledger. On-time performance, ratings and loyalty balances show unavailable when their source data is absent. Growth shows unavailable without a previous-month baseline. Report CSV exports use the same values and preserve unavailable fields. Flight management loads all API pages before displaying its grouped totals; search results cannot be overwritten by an older delayed response.

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
| `npm run test:seed` | Sample data, capacity, lifecycle, repeat-seed safety, login for all 14 accounts and portal/new-customer re-login after logout |
| `npm run test:seed -- --compare-public-demo` | Optional TiDB fixture comparison: fresh disposable seed versus existing isolated demo; profiles, all 14 passwords, fleet, airports, seats, routes/fares/durations, booking amounts and feedback |
| `npm run test:tidb-seed` | Optional cloud/disposable-schema check: backup drift refusal, rollback, preserved financial/ticket records, retired sessions, production-safe credentials and non-overlapping new flights |
| `npm run test:public-demo` | Isolated TiDB demo: three-role login/logout, portal browser checks, report reconciliation, primary-token rejection and unchanged primary records |
| `npm run test:ui` | Keyboard navigation, date controls and modal focus behavior |
| `npm run test:enterprise` | Multi-leg ownership, retry protection, capacity, rollback, expiry, staff provisioning, account recovery and private login diagnostics |
| `npm run test:metrics` | Dashboard/report/customer reconciliation, occupancy and recorded fares, exact-state filters, all flight pages and desktop/mobile checks in different time zones |
| `npm run test:browser` | All 14 pages at desktop/mobile widths; signup/logout/re-login, password controls, stale session roles and HTML/clean URL redirects; complete customer, admin and crew workflows |

The eight checks in `test:all` use disposable `skywings_test_*` databases rather than application records. The optional `test:public-demo` uses the isolated `skywings_public_demo` database for its authentication/browser checks and reads the primary records to verify they stay unchanged. External delivery is stubbed or disabled. Results, logs and screenshots are saved under the Git-ignored `artifacts/` directory.

The optional seed comparison requires `.env` to connect to the TiDB instance containing `skywings_public_demo`, with read access to that schema and permission to create/drop a disposable test schema. It never resets the server demo. It compares fixture content while allowing deployment-specific dates, random identifiers and time-driven booking states. If shared-demo users have changed the data, a mismatch is reported; any reset remains an explicit operator action.

**Last verified: 4 October 2026.** The independent regression suite has 51 passing tests, including public-demo isolation, UTC parsing for TiDB deadlines, Pakistan/daylight-saving search boundaries and safe seat-selection controls during delayed or failed hold requests. The shared seed was compared against the actual isolated TiDB demo: all 14 passwords and the checked profiles, airports, aircraft, seats, flight routes/fares/durations, booking amounts and feedback matched. Fresh seeded accounts and a newly registered customer passed logout/re-login. The isolated demo's three portal roles, browser views, report totals and token separation passed; primary users, bookings and tickets remained unchanged, and its production account guard passed. The earlier eight-check run passed. Metrics checks cover 510 flights, state/payment/expiry exclusions, customer ownership and browser reconciliation in Pakistan and US time zones. Schema checks reproduce and repair the missing reservation-expiry column while preserving an existing booking. Full browser checks cover all 14 pages at 1440px and 390px. The dependency audit reported zero vulnerabilities during the feature-upgrade audit. These checks do not certify production hosting, payment settlement or airport interoperability.

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
