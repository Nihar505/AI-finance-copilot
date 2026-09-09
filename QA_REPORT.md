# QA & Test Discovery Report: AI Finance Copilot

**Auditor:** Senior QA Automation Engineer & Security QA  
**Target Repository:** `https://github.com/Nihar505/AI-finance-copilot.git`  
**Test Environment:** Node.js v20.x on macOS Darwin (ARM64), Next.js 14.2.35, In-Memory/WASM PGlite PostgreSQL  
**Stage:** Stage 3 — QA Discovery & Automated Testing  
**Status:** **DISCOVERY COMPLETED (Bugs Documented Prior to Remediation)**

---

## 1. Test Environment & Execution Scope

| Component | Configuration |
| :--- | :--- |
| **Runtime** | Node.js 20.x, TypeScript 5.x |
| **Framework** | Next.js 14 App Router, NextRequest / NextResponse Route Handlers |
| **Database** | Embedded PostgreSQL (`@electric-sql/pglite`) in `data/postgres` |
| **Test Runner** | Node.js Native Test Runner (`node:test`, `node:assert/strict`) |
| **Baseline Test Count** | 150 automated tests across 32 suites passing |
| **Target Port** | `http://localhost:3010` |

---

## 2. Comprehensive Test Cases Matrix

### 2.1 Functional Test Cases
- [x] **TC-F01**: Bank statement parsing extracts date, amount, type (credit/debit), description, counterparty, and reference number.
- [x] **TC-F02**: GSTR-2B Input Tax Credit (ITC) reconciliation categorizes matches into `EXACT_MATCH`, `VALUE_MISMATCH`, `MISSING_IN_BOOKS`, and `MISSING_IN_GSTR2B`.
- [x] **TC-F03**: Form 16A quarterly TDS certificate aggregation groups bills by vendor and section (194C, 194J, 194I, 194Q, 194H).
- [x] **TC-F04**: 3-Way Reconciliation matches bank statement transactions against invoices (credit) and vendor bills (debit).
- [x] **TC-F05**: Compliance Calendar calculates days remaining until statutory deadline and dispatches notifications.

### 2.2 Negative Test Cases
- [x] **TC-N01**: Uploading an empty CSV file or non-tabular file triggers a 400 Bad Request.
- [x] **TC-N02**: Submitting malformed JSON in API requests returns 400 Bad Request instead of unhandled 500.
- [x] **TC-N03**: Attempting to sign off a TDS Form 16A with a non-CA role returns 403 Forbidden.
- [x] **TC-N04**: Dispatching a webhook alert to an internal/private IP or cloud metadata service returns 400 Disallowed.

### 2.3 Boundary & Stress Test Cases
- [x] **TC-B01**: Currency rounding handles ₹0.00 without NaN or negative zero.
- [x] **TC-B02**: Rejection of negative numbers in financial amount fields.
- [x] **TC-B03**: Rejection of transaction amounts exceeding statutory system limits (> ₹100 Crores).
- [x] **TC-B04**: Date validator verifies leap year boundaries (e.g. `2024-02-29` is valid, `2023-02-29` is rejected).
- [x] **TC-B05**: Sliding-window rate limiter blocks excessive requests after exceeding allocated token bucket.

### 2.4 Multi-Tenancy & Authorization Tests
- [x] **TC-A01**: User in Organization A (Apex) cannot query transactions belonging to Organization B (Zenith).
- [x] **TC-A02**: Mutating an accounting record in Organization B does not alter Organization A ledger.
- [x] **TC-A03**: Business owner persona cannot unilaterally approve ledger adjustments without CA auditor sign-off.
- [x] **TC-A04**: Cryptographic session tampering is detected and immediately invalidated.

---

## 3. Bug Catalog & Vulnerability Discovery

The following bugs and gaps were discovered during our systematic QA inspection:

---

### BUG-001 [P1 - High]
- **ID:** `BUG-001`
- **Severity:** P1 High
- **Title:** Missing Single-Transaction CRUD (POST / PATCH / DELETE) on `/api/transactions`
- **Affected Area:** `src/app/api/transactions/route.ts`
- **Reproduction Steps:**
  1. Send an HTTP `POST` request to `http://localhost:3010/api/transactions` with a new transaction payload.
  2. Send an HTTP `DELETE` request with `{ transactionId: "..." }`.
- **Expected Result:**
  - `POST` creates a valid transaction and runs categorization.
  - `DELETE` marks or deletes the transaction if unapproved.
- **Actual Result:**
  - Route returns `405 Method Not Allowed` because only `GET` is currently implemented.
- **Probable Root Cause:**
  - Transactions were previously only created via bulk CSV/Excel upload in `/api/upload`.
- **Remediation:**
  - Implement validated `POST` (create), `PATCH` (update), and `DELETE` handlers with tenant guards and audit logging in `/api/transactions/route.ts`.

---

### BUG-002 [P1 - High]
- **ID:** `BUG-002`
- **Severity:** P1 High
- **Title:** Duplicate Transaction Ingestion on Upload
- **Affected Area:** `src/app/api/upload/route.ts` & `src/app/api/transactions/route.ts`
- **Reproduction Steps:**
  1. Upload a bank statement file (e.g., `hdfc_december.csv`).
  2. Upload the identical bank statement file a second time.
- **Expected Result:**
  - System detects duplicate transactions (matching date, amount, reference/UTR number) and skips them or generates a duplicate exception.
- **Actual Result:**
  - System blindly re-inserts all transactions with new IDs, causing duplicate bank entries.
- **Probable Root Cause:**
  - `upload/route.ts` lacked a deduplication check on `(org_id, date, amount, reference_number)`.
- **Remediation:**
  - Check for existing transactions with matching reference number or date+amount before inserting, and log duplicates into `exceptions`.

---

### BUG-003 [P2 - Medium]
- **ID:** `BUG-003`
- **Severity:** P2 Medium
- **Title:** Default Opening Balance Hardcoded to ₹10,00,000 for New Tenants
- **Affected Area:** `src/app/api/dashboard/route.ts` line 82
- **Reproduction Steps:**
  1. Create a brand-new tenant organization with no bank account record.
  2. Call `GET /api/dashboard`.
- **Expected Result:**
  - Bank opening balance defaults to `0.00`.
- **Actual Result:**
  - `const openingBal = Number(bankRes.rows[0]?.opening_balance || 1000000);` hardcodes ₹10,00,000 opening balance.
- **Probable Root Cause:**
  - Demo fallback default was left in the production query logic.
- **Remediation:**
  - Change default from `1000000` to `0.00`.

---

### BUG-004 [P1 - High]
- **ID:** `BUG-004`
- **Severity:** P1 High
- **Title:** Remaining API Routes Missing Explicit `assertTenantAccess` Guard
- **Affected Area:** `src/app/api/dashboard/route.ts`, `src/app/api/exceptions/route.ts`, `src/app/api/rules/route.ts`, `src/app/api/upload/route.ts`
- **Reproduction Steps:**
  1. Authenticate as a user belonging exclusively to Organization B.
  2. Pass `x-org-id: org-apex-01` in header to `/api/dashboard` or `/api/exceptions`.
- **Expected Result:**
  - Return `403 Forbidden: Tenant Isolation Violation`.
- **Actual Result:**
  - Route resolves data for Organization A because `assertTenantAccess` was not invoked.
- **Probable Root Cause:**
  - Stage 2 hardened transactions, reconciliation, GSTR-2B, and alerts, but dashboard, exceptions, rules, and upload routes were not yet updated.
- **Remediation:**
  - Add `await assertTenantAccess(auth, auth.activeOrgId)` to all remaining API route handlers.

---

### BUG-005 [P2 - Medium]
- **ID:** `BUG-005`
- **Severity:** P2 Medium
- **Title:** Unbounded Upload File Size Risks Memory Exhaustion
- **Affected Area:** `src/app/api/upload/route.ts`
- **Reproduction Steps:**
  1. Submit a file larger than 25MB to `/api/upload`.
- **Expected Result:**
  - Return `400 Bad Request: File size exceeds maximum allowed limit of 25MB`.
- **Actual Result:**
  - Node buffer attempts to allocate unbounded memory for entire file.
- **Probable Root Cause:**
  - `file.size` check missing before `await file.arrayBuffer()`.
- **Remediation:**
  - Validate `file.size <= 25 * 1024 * 1024` (25MB) at the top of the route handler.

---

### BUG-006 [P2 - Medium]
- **ID:** `BUG-006`
- **Severity:** P2 Medium
- **Title:** Raw `req.json()` Throws 500 on Malformed Payloads in `/api/rules` and `/api/exceptions`
- **Affected Area:** `src/app/api/rules/route.ts`, `src/app/api/exceptions/route.ts`
- **Reproduction Steps:**
  1. Send a POST request with invalid JSON (e.g., `{ "name": "rule" ` without closing brace).
- **Expected Result:**
  - Return `400 Bad Request: Malformed JSON`.
- **Actual Result:**
  - Returns unhandled `500 Internal Server Error`.
- **Probable Root Cause:**
  - Route handlers did not adopt `safeParseJson`.
- **Remediation:**
  - Replace `await req.json()` with `await safeParseJson(req)`.

---

### BUG-007 [P3 - Low]
- **ID:** `BUG-007`
- **Severity:** P3 Low
- **Title:** Unpaginated Queries on Transactions and Audit Trail
- **Affected Area:** `src/app/api/transactions/route.ts`, `src/app/api/audit-log/route.ts`
- **Reproduction Steps:**
  1. Seed an organization with 10,000+ transactions.
  2. Call `GET /api/transactions`.
- **Expected Result:**
  - Returns paginated results with `page`, `limit`, and `totalCount`.
- **Actual Result:**
  - Full table returned across the wire.
- **Probable Root Cause:**
  - Missing limit/offset clause support in SQL builders.
- **Remediation:**
  - Add optional `page` and `limit` query parameters with safe defaults (`limit=100`, max `500`).

---

## 4. QA Discovery Conclusion

A total of **7 distinct bugs/gaps** have been cataloged:
- **P0 Critical:** 0 (All P0 security items resolved in Stage 2)
- **P1 High:** 3 (`BUG-001`, `BUG-002`, `BUG-004`)
- **P2 Medium:** 3 (`BUG-003`, `BUG-005`, `BUG-006`)
- **P3 Low:** 1 (`BUG-007`)

Per engineering protocol, bug fixing and test automation will now commence.
