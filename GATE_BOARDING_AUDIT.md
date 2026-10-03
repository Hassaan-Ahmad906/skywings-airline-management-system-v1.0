# Gate boarding audit

Reviewed: 3 October 2026, Asia/Karachi.

## Implemented workflow

The airport crew portal at `/crew-portal.html` provides a departure-control workspace. Administrators retain the same workspace on `/admin-dashboard.html`. Crew logins redirect to their portal; only administrators can create staff accounts and assign a departure airport.

| Operation | Customer | Assigned airport crew | Administrator |
| --- | --- | --- | --- |
| Customer check-in and personal pass | Own booking | No passenger self-service privilege required for gate work | Existing staff/admin operations |
| Upcoming gate flights and passenger manifest | Denied | Assigned airport only | All airports |
| Assign gate, open or close boarding | Denied | Assigned airport only | All airports |
| Record individual boarding | Denied | Assigned airport only | All airports |
| View gate audit for a flight | Denied | Assigned airport only | All airports |
| Create crew account | Denied | Denied | Allowed |
| Admin reports, support inbox and management | Denied | Denied | Allowed |

The manifest shows names, seats, booking references, cabin and boarding status. It excludes passport numbers, customer contact details, passwords and boarding tokens. Current portal counters distinguish expected passengers, recorded boarding and passengers awaiting boarding.

## Boarding controls

1. Select the correct flight, assign its departure gate and open boarding. Opening is allowed only within 90 minutes before scheduled departure.
2. Verify the passenger's identity and scan a connected barcode reader or enter the server-issued code. The portal requires an identity checkbox; this is an operator attestation, not automated identity verification.
3. The server authenticates the operator and verifies airport scope, gate state, flight/time window, passenger token, check-in state and an issued ticket under a flight lock.
4. A successful transaction sets the passenger's boarding timestamp, consumes that passenger's ticket, and appends a gate audit event. Only the final passenger changes a party booking to BOARDED.
5. Replayed codes, wrong flights, unassigned airports and closed gates are rejected. Rejected scan reasons are recorded without the raw token. Closing boarding blocks further scans.

Gate state changes are recorded with the staff account and time. The portal presents the latest 100 events per flight. There is no crew/admin API for editing or deleting gate audit events. This is application-level protection; a database administrator still has database authority.

## Verification

- HTTP/MySQL checks cover crew airport scope, admin-route denial, identity confirmation, gate assignment/opening, successful boarding, duplicate/wrong-airport rejection, ticket use, group status and accepted/rejected audit records.
- Browser checks cover crew flight selection, opening boarding, entering a real issued token, identity confirmation, updated manifest counts and visible audit history. Selected manifests are checked at desktop and mobile widths.
- Customer registration does not accept a caller-selected privileged role. Staff accounts are created through an admin-only route. Current role/scope is loaded from the database on every authenticated request.

## Operational limits before real airport use

The current QR payload is an internal random token. It is not an implemented IATA structured boarding-pass payload, nor a tested airline/DCS or airport gate-reader interface. IATA documents boarding-pass formats under Resolution 792; internal QR validity alone does not establish that interoperability. [IATA common-use standards](https://www.iata.org/en/programs/passenger/common-use/).

Physical gate actuation, airline departure-control reconciliation, offloading/unboarding after a successful scan, identity-document/admissibility verification, airport-specific cutoffs, offline operation and emergency procedures are not implemented. Real deployments need an operator-approved workflow for each, staff MFA and device controls, immutable external audit retention, monitoring, and an agreed retention/access policy for passenger manifests. No airport certification or regulatory approval has been performed.
