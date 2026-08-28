# ✈️ SkyWings Airlines - Enterprise Flight Management & Booking Platform

SkyWings Airlines is a modern, full-stack, enterprise-grade airline booking, fleet scheduling, passenger check-in, and operations management platform structured for modular deployment across **Frontend**, **Backend**, and **Database**.

---

## 🏗️ Project Architecture & Deployment Structure

```
WEB/
├── backend/                 # [BACKEND SERVICE] Express API & Domain Business Logic
│   ├── config/              # Database pool & environment configuration
│   ├── controllers/         # HTTP request controllers (bookings, holds, tickets)
│   ├── middleware/          # JWT auth & centralized audit logging middleware
│   ├── repositories/        # Data access layer (Repository pattern)
│   ├── routes/              # RESTful API routes (/api/auth, /api/flights, etc.)
│   ├── services/            # Domain logic, state machines & disruption engine
│   ├── workers/             # Background asynchronous workers & hold cleaner
│   └── server.js            # Express server entry point & static asset router
├── frontend/                # [FRONTEND SERVICE] Client Web Application
│   ├── css/                 # Glassmorphic responsive styling (style.css)
│   ├── js/                  # Application controller (main.js) & Flight Radar (radar.js)
│   ├── images/              # Airline logos, aircraft icons & media assets
│   ├── index.html            # Landing page & quick flight search
│   ├── flight-search.html   # Flight search, filtering & interactive seat map
│   ├── about-contact.html   # Public about & contact page (scroll-restored)
│   ├── user-about-contact.html
│   ├── login.html           # Unified authentication
│   ├── register.html        # Customer registration
│   ├── check-in.html        # Online web check-in & boarding pass generator
│   ├── my-bookings.html     # Customer booking history & e-tickets
│   ├── user-dashboard.html  # Customer account overview
│   ├── user-profile.html    # Profile management & travel preferences
│   ├── admin-dashboard.html # Operations & metrics center
│   ├── admin-management.html# Fleet, flights, bookings & airport CRUD
│   └── admin-reports.html   # Revenue analytics & route occupancy reports
├── database/                # [DATABASE] MySQL Schemas, Migrations & Seeds
│   └── schema.sql           # Complete relational schema (17 tables, FKs, indexes)
├── scripts/                 # [AUTOMATION & UTILITIES] Database Tools & Master Test Suite
│   ├── master_test.js       # Master 1,000-Point System Verification Suite
│   ├── setup_database.js    # DDL Runner creating all 17 tables from schema.sql
│   ├── seed_database.js     # Seeds Admin, 20 Customers, Airports, Fleet & Flights
│   └── reset_database.js    # One-step database wipe and re-seed utility
├── server.js                # Root delegator to backend/server.js
├── package.json             # NPM package manifest & test scripts
├── .env                     # Environment variables
└── README.md                # System documentation
```

---

## 🚀 Full Cloud Deployment Guide (GitHub + TiDB Cloud + Render + Vercel)

For complete step-by-step instructions on deploying the full stack online across GitHub, TiDB Cloud Serverless, Render Web Services, and Vercel Global Edge CDN, see **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)**.

---

## ⚡ Local Quick Start & Development

### 1. Prerequisites

* **Node.js**: v18.0.0 or higher
* **MySQL Server**: 8.0 or higher (or TiDB Cloud)

### 2. Environment Setup

Create a `.env` file in the root directory:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=skywings_airlines
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRES_IN=7d
```

### 3. Database Initialization & Seeding

```bash
# Option A: Create tables from schema.sql
npm run db:setup

# Option B: Populate Admin, 20 Customer Users, Airports, Fleet & Flights
npm run db:seed

# Option C: Complete One-Step Database Reset & Seed
npm run db:reset
```

### 4. Start the Application

```bash
# Production server
npm start

# Development with automatic restart
npm run dev
```

The application will be accessible at `http://localhost:3000`.

---

## 🔑 Default Credentials

### Administrative & Primary Accounts

| Role                     | Name         | Email                | Password   |
| ------------------------ | ------------ | -------------------- | ---------- |
| **System Administrator** | System Admin | `admin@skywings.com` | `admin123` |
| **Primary Customer**     | John Doe     | `user@skywings.com`  | `user123`  |

### 20 Pre-Seeded Enterprise Customer Accounts (Password: `user123`)

|  #  | Name               | Email                             | Nationality | Passport Number |
| :-: | ------------------ | --------------------------------- | ----------- | --------------- |
|  1  | Emily Clark        | `emily.clark@skywings.com`        | American    | US89214710      |
|  2  | David Miller       | `david.miller@skywings.com`       | American    | US89214711      |
|  3  | Sarah Jenkins      | `sarah.jenkins@skywings.com`      | British     | GB78419201      |
|  4  | Michael Brown      | `michael.brown@skywings.com`      | American    | US89214713      |
|  5  | Jessica Taylor     | `jessica.taylor@skywings.com`     | American    | US89214714      |
|  6  | James Anderson     | `james.anderson@skywings.com`     | Australian  | AU90381241      |
|  7  | Olivia Martinez    | `olivia.martinez@skywings.com`    | Spanish     | ES67129034      |
|  8  | Daniel Thomas      | `daniel.thomas@skywings.com`      | American    | US89214717      |
|  9  | Sophia Jackson     | `sophia.jackson@skywings.com`     | French      | FR45129834      |
|  10 | William White      | `william.white@skywings.com`      | American    | US89214719      |
|  11 | Ava Harris         | `ava.harris@skywings.com`         | American    | US89214720      |
|  12 | Alexander Martin   | `alexander.martin@skywings.com`   | German      | DE89234109      |
|  13 | Mia Thompson       | `mia.thompson@skywings.com`       | American    | US89214722      |
|  14 | Ethan Garcia       | `ethan.garcia@skywings.com`       | Emirati     | AE56129845      |
|  15 | Charlotte Robinson | `charlotte.robinson@skywings.com` | American    | US89214724      |
|  16 | Lucas Clark        | `lucas.clark@skywings.com`        | Japanese    | JP90412890      |
|  17 | Amelia Rodriguez   | `amelia.rodriguez@skywings.com`   | American    | US89214726      |
|  18 | Benjamin Lewis     | `benjamin.lewis@skywings.com`     | Singaporean | SG78129045      |
|  19 | Harper Lee         | `harper.lee@skywings.com`         | American    | US89214728      |
|  20 | Henry Walker       | `henry.walker@skywings.com`       | American    | US89214729      |

---

## 🧪 Master 1,000-Point Test Suite

Run the full end-to-end integration and stability audit:

```bash
npm test
```

---

## 🛡️ Core Enterprise Features

1. **Modular Deployment Isolation**:

   * **Frontend** (`frontend/`), **Backend** (`backend/`), and **Database** (`database/`) can be deployed together as a monolithic full-stack app or separated into distinct micro-services / static CDNs.

2. **State-Machine Booking Lifecycle**:

   * Strictly enforced transitions: `PENDING` → `CONFIRMED` → `CHECKED_IN` → `BOARDED` → `COMPLETED`.
   * Guaranteed protection against illegal mutations out of terminal states (`COMPLETED`, `CANCELLED`, `EXPIRED`).

3. **Unified Seat Map & Concurrency Locks**:

   * Transactional row-level database locks ensure zero double-booking during high-traffic rushes.
   * 10-minute temporary seat hold with automatic background TTL reclamation.

4. **IATA Compliant E-Ticketing & Boarding Passes**:

   * Standard 13-digit e-tickets (`789-XXXXXXXXXX`) issued automatically per passenger.
   * Web check-in available 24 hours prior to departure with electronic barcode boarding pass generation.

5. **Earliest-to-Latest Chronological Flight Sorting**:

   * Scheduled upcoming flights in both customer search and admin management are organized chronologically from earliest to latest departure time (`ASC`).

6. **Admin Operations Center**:

   * Comprehensive Airport Management with 3-letter IATA validation and deletion safeguards.
   * Aircraft fleet management, flight scheduling, route profitability analytics, and revenue reports.

---

## 📧 Automated Email System

SkyWings Airlines includes an automated email notification system integrated with the airline booking platform.

### Payment Confirmation Email Automation

When a customer successfully completes a payment and the booking status becomes confirmed, the system automatically sends the booking information to the email automation workflow.

The email automation workflow uses the production n8n webhook configured for the airline system.

The production webhook URL is configured through the application's environment variables and is not hard-coded into the frontend.

### Email Automation Flow

```text
Customer completes payment
        ↓
Payment confirmed
        ↓
Booking status becomes CONFIRMED
        ↓
Backend collects booking information
        ↓
Backend sends booking data to n8n
        ↓
AI generates professional booking confirmation email
        ↓
Gmail sends email
        ↓
Customer receives booking confirmation
```

### Booking Information Sent to Email Automation

The email automation uses the actual information available in the airline booking system, including:

* Booking Reference
* Booking Status
* Passenger Name
* Number of Passengers
* Airline
* Flight Number
* Travel Class
* Departure Airport
* Departure Date
* Departure Time
* Arrival Airport
* Arrival Date
* Arrival Time
* Flight Duration
* Seat Number
* Baggage Allowance
* Payment Status
* Amount Paid
* Payment Currency
* Payment Method
* Check-in Information

The email content is generated dynamically from the actual booking information.

No hard-coded customer, flight, booking, seat, payment, or passenger information is used for production email notifications.

### Email Format

The generated booking confirmation email uses professional HTML formatting, including:

* Structured booking sections
* Bold important information
* Flight information
* Passenger information
* Payment information
* Baggage information
* Check-in information
* Professional airline messaging

The email subject follows the format:

```text
Flight Booking Confirmed - {Booking Reference}
```

The recipient is the customer's actual registered email address.

The sender is:

```text
SkyWings Airlines
```

### Production n8n Integration

The production n8n webhook is configured through an environment variable:

```env
N8N_BOOKING_EMAIL_WEBHOOK_URL=your_production_n8n_webhook_url
```

The actual production webhook URL should be configured in the deployment environment and should not be hard-coded into the source code.

### Email Trigger Rules

The confirmation email is sent only when payment has been successfully confirmed.

The system must not send a booking confirmation email when:

* Payment is pending
* Payment failed
* Payment was cancelled
* Booking was cancelled
* Booking has not been confirmed

### Security

Only required booking information is sent to the email automation system.

Sensitive information such as:

* Card numbers
* CVV
* PIN
* Passwords
* JWT secrets
* Database credentials
* API keys
* Payment gateway secrets

must never be included in the email automation payload.

### Reliability

Failure of the email automation system must not change the successful payment or booking status.

If the n8n workflow is temporarily unavailable, the booking remains confirmed and the email failure should be logged for troubleshooting.

### Duplicate Protection

The email automation should respect the application's payment idempotency and booking event handling so that the same successful payment does not unnecessarily generate duplicate confirmation emails.

### Environment Configuration

The production environment should contain:

```env
N8N_BOOKING_EMAIL_WEBHOOK_URL=your_production_n8n_webhook_url
```

The `.env` file containing actual production configuration must not be committed to GitHub.
