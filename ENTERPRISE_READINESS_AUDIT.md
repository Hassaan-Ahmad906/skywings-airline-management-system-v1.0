# Enterprise publishing readiness audit

Reviewed: 3 October 2026, Asia/Karachi.

Data/report follow-up: 4 October 2026, Asia/Karachi. Shared dashboard/report metrics, exact-state booking filters, multi-page flight totals, recorded route fares and CSV fields are verified. Loyalty miles and benefits previously inferred from fares remain unavailable until backed by a rewards ledger. The earlier eight-check suite passed; 48 independent regressions now pass with additional public-demo isolation and UTC deadline checks. TiDB history-preserving reseeding and actual hosted login/report checks are recorded below. A separate synthetic-data TiDB public demo is prepared and tested for all three roles, with a distinct JWT secret, guarded namespace and unchanged primary record digests. Its Render deployment remains pending access/configuration; a local preview runs on port 3001. Primary admin/crew passwords were not published.

**Release decision: the implemented workflows are suitable for local review and testing; this application is not yet ready to operate a real airline or collect customer payments.** Removing the global banner improves the layout and does not establish that money is collected. Live hosting and payment-provider choices are still unspecified.

## Completed changes

- Removed the page-wide payment banner. Payment confirmation still accurately labels development simulation; production rejects simulated payment.
- Rebuilt the feedback/support inbox with search, pagination, status updates, individual deletion to Trash, restoration, access checks and transactional audit records.
- Added one-way, return and two-to-six-leg multi-city selection, nine-passenger capacity, cabin choice, departure-time/fare filters, sorting, journey totals and date/connection checks.
- Added atomic multi-leg reservation and development confirmation, server-calculated fares, ownership checks, request-key fingerprints, expiry checks and rollback on failure. Each flight keeps its own check-in, ticket and seat allocation.
- Added airport-scoped crew access, a dedicated gate portal, equivalent admin controls, gate assignment/open/close, minimal manifests, per-passenger scanning and separate gate audit history.
- Corrected mobile crew controls and the existing profile grid so page content fits phone widths; long manifests scroll inside their table container.
- Added non-destructive migrations 008–010 and a production startup check for active synthetic/default-password accounts.
- Render schema follow-up: added migration 011 for a missing reservation-expiry column, a migration-first deployment command and schema verification before server/worker startup. Disposable MySQL tests preserve an existing booking during recovery. The hosted Render database has not been accessed or deployed from this workspace.
- Original 26 repairs and their regression coverage are retained. The original pre-reset backup and a new pre-upgrade backup are preserved privately under `backups/`.

## Test evidence

Hosted data follow-up (4 October 2026): the TiDB reseed preserved all booking, financial, ticket and audit history, retired 33 old logins, created 14 fresh Pakistani accounts and 240 future flights, removed 11,818 unreferenced flights and reconciled four aircraft capacities to their 852 physical seats. The pre-change snapshot was restored and contents verified in TiDB. A disposable TiDB test proved backup-drift refusal, full rollback on failure and preservation of referenced records. All 14 fresh accounts passed actual hosted API login/logout checks; customer/admin/crew browser portals, new registration/logout/relogin, dashboard/report reconciliation and the production account guard passed. Future aircraft conflicts are zero. Historical flight schedules remain untouched. A full replacement was rejected by automatic approval review and was not performed.

| Check | Result |
| --- | --- |
| Independent regression tests (`npm test`) | 48 passed, including schema startup, CSV/chart accuracy, stale-search protection and public-demo/UTC isolation |
| Dashboard, report, customer and management reconciliation (`test:metrics`) | Passed in disposable MySQL and desktop/mobile Chromium; 510 flight records and two time zones |
| Fresh/legacy schema, repeat migrations and missing expiry-column recovery | Passed; existing booking preserved |
| Booking, hold, expiry, rebooking, notification and support workflows | Passed in disposable MySQL |
| Return/multi-city ownership, idempotency, capacity, atomic rollback, expiry and ticket replay | Passed in disposable MySQL |
| Keyboard navigation, date controls, modal focus/Escape/restore | Passed in Chromium |
| All 14 pages at 1440px and 390px | Passed: no script/API errors or page overflow, measuring both body and document widths |
| Real browser reserve/payment/check-in/QR, return and three-leg multi-city flow | Passed in Chromium using development confirmation |
| Crew boarding, gate audit and inbox resolve/delete/restore | Passed in Chromium |
| Dependency audit | Zero reported vulnerabilities |
| JavaScript syntax, inline HTML scripts, file links/casing and Git whitespace | Passed |

Tests create/drop only disposable `skywings_test_*` databases. They use synthetic passengers and stub/disable external delivery. They do not validate payment settlement, airline ticket settlement, hardware gate readers or a cloud production environment. Expected rejection cases deliberately return 400/403/404/409 and are asserted.

## Release blockers for real enterprise use

| Area | Current limit | Required work |
| --- | --- | --- |
| Payments/refunds | No live provider, verified settlement or provider refund handling | Select provider; implement hosted checkout, signed callbacks, amount/currency verification, replay protection, reconciliation and confirmed refunds; prove sandbox scenarios before live credentials |
| Airline/airport operations | Internal QR token only; no DCS, BCBP, physical-reader or offload integration | Agree operational contracts and procedures; integrate and test airline/airport systems. See GATE_BOARDING_AUDIT.md |
| Journey servicing | Fixed 60-minute connection rule, direct owned flights, per-leg cancellation, no coordinated multi-leg changes | Airport-specific connection rules, time-zone data, fare/tax rules, interline handling and coordinated change/refund policies |
| Staff security | Role/airport scope implemented; no staff MFA or fleet device control | Require staff MFA, approved devices, access reviews and explicit staff provisioning/revocation procedures |
| Hosting/operations | Local MySQL and development configuration tested | Choose host; configure TLS, managed secrets, least-privilege DB credentials, reverse-proxy/CORS settings, migrations, health monitoring and an operational background worker |
| Capacity/resilience | Transaction behavior tested locally; no load or failover benchmark | Test target concurrency, worker failure/recovery, DB failover, distributed rate limits and notification delivery under production topology |
| Records/privacy | Support deletion is restorable; application audits can still be changed by a DB administrator | Define retention/erasure rules and access policy; send security/gate audits to protected external storage and monitor failure/replay patterns |
| Recovery | Local pre-reset restore verified; new upgrade backup saved | Prove managed backup restoration and recovery objectives in the chosen hosting environment |
| Production data | Synthetic accounts and relative-date flight samples | Start with approved production data, unique credentials and active staff airport assignments; startup refuses the known sample accounts/passwords |

No publishing, external customer notification, live payment processing or production deployment was performed. A passing local test suite is evidence for the tested workflows, not a guarantee of all possible behavior or enterprise certification.
