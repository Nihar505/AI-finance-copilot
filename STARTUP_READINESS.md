# FinCopilot Startup Readiness Plan

## Decision

FinCopilot should launch as an exception-driven monthly-close workspace for Indian Chartered Accountant firms and their growing-business clients. It should not launch as a broad AI accounting platform, an automated Chartered Accountant, or a payment product.

The first job is narrow and urgent: turn a client’s bank statement, invoices, and bills into a source-linked review queue that a CA can close with confidence. This is already the strongest functioning loop in the codebase and the one recommended in the project plan.

## Ideal First Customer

The initial customer is a CA firm with 20 to 150 recurring client books, a small review team, and a painful month-end process involving statement imports, invoice matching, GST and TDS checks, and document chasing. A finance lead at a growing Indian business is the secondary buyer and champion, not the first distribution channel.

The buyer is paying for less reviewer time per client, faster close readiness, fewer missed exceptions, and an auditable record of the reviewer’s decision. The buyer is not paying for generic chat or speculative forecasting.

## Positioning

**Category:** controlled financial-close software for CAs and finance teams.

**Promise:** turn financial records into an evidence-backed decision queue.

**Proof mechanism:** deterministic calculations and reconciliation, source-linked recommendations, explicit confidence, role-based approval, and an audit trail.

**Boundary:** FinCopilot prepares and explains work. Chartered Accountants retain professional judgment and approval authority. It does not collect bank credentials, move money, or autonomously submit filings in the MVP.

## Commercial Model

The public site proposes a simple, measurable starting price:

| Offer | Price | Initial scope |
| --- | --- | --- |
| Business | ₹4,999 per entity per month | Up to two finance seats and one controlled close workflow |
| CA Firm | ₹1,999 per active entity per month | Multi-client review, approval trail, and compliance review queues |
| Design Partner | Custom | Guided onboarding, baseline measurement, and a founding-pilot commercial agreement |

Applicable taxes are additional. These are starting hypotheses, not validated market prices. Keep the first ten contracts simple: monthly subscription, assisted onboarding, a defined entity limit, and a written pilot success review after one or two closes.

The right price conversation is tied to client entities and close workload, rather than seats. A CA firm’s value rises with the portfolio it can review accurately, so active entities is the clearest initial value metric.

## Go to Market

1. Recruit ten design partners through founder-led outreach to CA firms, with a preference for firms already managing recurring startup and SME books.
2. Sell a six-week, paid close-automation pilot around one existing workflow. Do not offer an unlimited free trial.
3. Capture a baseline before onboarding: records per close, reviewer hours, unresolved exceptions, and close-ready date.
4. Run the imported records through FinCopilot beside the current workflow. The CA remains the decision maker.
5. Review the measured outcome after the close and convert only if the firm sees time saved without a control regression.

The pilot application at `/` deliberately asks for operating profile and portfolio size rather than financial records. Treat it as a sales-intake queue; never ask prospects to submit bank statements or tax documents before a contractual onboarding process exists.

## The Metrics That Matter

Track these metrics per pilot and at portfolio level:

- Close-ready days and reviewer hours per entity.
- Percentage of imported transactions automatically prepared with a reviewed-correct category.
- Reconciliation match rate and exception false-positive rate.
- Median time to resolve an exception.
- Percentage of recommendations needing manual override.
- Active entities, paid pilot conversion, monthly recurring revenue, and logo retention.

Do not use chat queries, raw uploads, or total transactions as the primary startup KPI. The core proof is a measurably faster close with no loss of review quality.

## 90 Day Execution Sequence

| Window | Outcome |
| --- | --- |
| Days 1 to 14 | Interview 20 CA firms; secure 3 paid design partners; choose one repeated close workflow and a single source format for each partner. |
| Days 15 to 45 | Complete assisted onboarding, record baseline metrics, and run the first live side-by-side close. Fix only workflow-blocking defects. |
| Days 46 to 70 | Convert successful pilots to per-entity subscriptions; publish anonymized outcome evidence only with written permission. |
| Days 71 to 90 | Reach 10 active pilot entities, refine onboarding, and decide which accounting-system or Account Aggregator integration is justified by repeated demand. |

## Release Gates Before Handling Live Customer Financial Data

The application has useful prototype controls and the automated suite currently covers financial math, import normalization, authorization, reconciliation, GST, TDS, and audit logging. It is not yet ready to claim production-grade financial-data handling. The following are launch gates, not backlog polish:

1. Replace embedded PGlite with managed PostgreSQL, encryption at rest, backups, and tested restoration. A local embedded database is not a multi-tenant production data store.
2. Add an identity provider, mandatory MFA for privileged roles, password-reset flows, and session revocation. The present demo credentials are not a production authentication system.
3. Add malware scanning, content-type verification, durable object storage, and background jobs for uploads. Do not process untrusted office files only in the web request path.
4. Obtain legal and CA-domain review for every current tax rule and filing deadline; version statutory logic with effective dates. The software must never imply that a static prototype rate table is current law.
5. Complete consent lifecycle, retention/deletion, incident response, privacy notice, and a regulated Account Aggregator integration assessment before connecting live bank data. Never collect bank passwords or OTPs.
6. Add independent penetration testing, dependency scanning, monitoring, alerting, immutable or tamper-evident audit-log storage, and security incident runbooks.
7. Establish a support owner and a secure onboarding process before accepting a customer’s records.

## Product Roadmap Discipline

Build in this order:

1. Reliable import, duplicate protection, categorization, matching, exception review, and close evidence.
2. CA portfolio workflow, client setup, approval policy, and outcome reporting.
3. Supported accounting-system exports and consent-based data connectivity.
4. Only then expand into deeper GST/TDS preparation, forecasting, and advisory.

Do not build payment initiation, autonomous filing, generic agent swarms, multi-country tax logic, or broad CFO analytics before the first close loop is demonstrably retained and paid for.
