# AI Finance Copilot — Known Limitations & Technical Debt

> **Audit Timestamp**: September 2026  
> **Status**: Verified against current codebase implementation.

---

## 1. Prioritized Defect Classification

### Critical / Blocking (P0)

1. **Password Verification Backdoor (`src/lib/auth.ts`)**:
   - `verifyPassword()` accepts `'password123'` and checks for legacy string prefix `$2a$10$demoHashedPassword`, allowing demo accounts to log in with hardcoded bypasses.
   - **Impact**: Any account seeded with demo hashes can be compromised if credentials are leaked or guessed.
   - **Remediation**: Remove demo string bypasses; enforce authentic PBKDF2-SHA512 hash verification.

2. **Static Password Salt (`src/lib/auth.ts`)**:
   - `hashPassword()` uses a single static default salt `'salt_copilot_2026'`.
   - **Impact**: Vulnerable to rainbow table attacks if user password hashes are exposed.
   - **Remediation**: Use per-user random salts (`crypto.randomBytes(16)`).

3. **Missing Tenant Access Assertion on Selected Routes**:
   - `GET /api/chart-of-accounts`: Reads accounts for `auth.activeOrgId` without verifying that `auth.userId` has membership in that organization.
   - `POST /api/transactions/process`: Triggers categorization and reconciliation without `assertTenantAccess` or role authorization check.
   - `POST /api/compliance`: Updates compliance filings without explicit `assertTenantAccess` check.
   - **Impact**: Cross-tenant data leakage or mutation via header manipulation.
   - **Remediation**: Add `await assertTenantAccess(auth, orgId)` and `checkRoleAccess()` to these handlers.

---

### High Priority (P1)

4. **Lack of File Hash Deduplication (`src/app/api/upload/route.ts`)**:
   - The upload handler does not compute a SHA-256 hash of incoming files and the `documents` table lacks a `file_hash` column.
   - **Impact**: Uploading the same statement or invoice spreadsheet multiple times creates duplicate document rows, and unless every row has a reference number, creates duplicate financial transactions.
   - **Remediation**: Add `file_hash VARCHAR(64)` to `documents` table and check for existing hash before processing.

5. **Non-Transactional Upload Ingestion (`src/app/api/upload/route.ts`)**:
   - Ingestion inserts rows in a standard `for` loop without an enclosing `db.transaction()` block.
   - **Impact**: If row 50 fails out of 100, the first 49 rows are committed, leaving partial, corrupt data states.
   - **Remediation**: Wrap all upload ingestion parsing and insertions in `db.transaction()`.

6. **In-Memory Storage of TDS Certificate Sign-offs (`src/app/api/tds-certificates/route.ts`)**:
   - CA sign-offs on quarterly Form 16A certificates are stored in an in-memory `Map`:
     ```typescript
     const signedOffCerts = new Map<string, { signedBy: string; signedAt: string }>();
     ```
   - **Impact**: Server restarts or serverless container recycling erase statutory sign-off state.
   - **Remediation**: Persist sign-off records in PostgreSQL (`approvals` or `tds_signoffs` table).

7. **Outbound Webhook Missing Timeout (`src/app/api/alerts/route.ts`)**:
   - `fetch(targetUrl, { method: 'POST', body })` does not specify an `AbortSignal.timeout(5000)`.
   - **Impact**: A slow or malicious external webhook endpoint can tie up the Node.js event loop and cause API request starvation.
   - **Remediation**: Add `signal: AbortSignal.timeout(5000)`.

---

### Medium Priority (P2)

8. **Missing Interactive Reconciliation POST Handler (`src/app/api/reconciliation/route.ts`)**:
   - Currently, `/api/reconciliation` only implements `GET`. Approvals are routed through `/api/approvals`, but there is no dedicated REST route for rejecting, manually pairing, or unmatching bank transactions with invoices/bills.
   - **Remediation**: Implement `POST /api/reconciliation` supporting `CONFIRM_MATCH`, `REJECT_MATCH`, `MANUAL_MATCH`, and `UNMATCH`.

9. **Silent Date Fallback in Normalizer (`src/lib/normalizer.ts`)**:
   - `normalizeDate()` falls back to today's date (`new Date().toISOString().split('T')[0]`) if an unrecognized date format is encountered.
   - **Impact**: Corrupted or unparseable spreadsheet dates silently become today's date instead of being flagged as errors.
   - **Remediation**: Return `null` or an explicit error when date parsing fails.

10. **Client-Side Role and Org Header Transmission (`src/components/WorkspaceApp.tsx`)**:
    - The client sends `'x-org-id'` and `'x-user-role'` on every fetch request.
    - While the backend currently overrides `role` with the verified session, relying on client-supplied headers creates confusion and potential drift.
    - **Remediation**: Pure session-derived identity and server-side cookie context.

---

### Low Priority (P3)

11. **Duplicate UI Visualizer Component**:
    - `components/ui/gateway-flow.tsx` and `src/components/ui/gateway-flow.tsx` are identical duplicate files.
    - **Remediation**: Consolidate into `src/components/ui/gateway-flow.tsx` and delete the redundant root folder copy.
