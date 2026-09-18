# AI Finance Copilot — Security Architecture & Threat Model

> **Status**: Comprehensive Security Audit and Remediation Roadmap  
> **Applicable Compliance Standards**: Indian Digital Personal Data Protection (DPDP) Act 2023, CBIC GST Standards, Income Tax Act 1961

---

## 1. Authentication vs Authorization Model

The application enforces a two-tier defense model separating identity verification (**Authentication**) from privilege and tenancy scoping (**Authorization**).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AUTHENTICATION (Who are you?)                   │
│  - Cryptographic Session Cookie: copilot_session (HMAC-SHA256)         │
│  - Password Hashing: PBKDF2-SHA512                                     │
│  - Edge Verification: middleware.ts via auth-edge.ts                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        AUTHORIZATION (What can you do?)                │
│  - Tenancy Isolation: assertTenantAccess(auth, targetOrgId)            │
│  - Role Capabilities: checkRoleAccess(auth, allowedRoles)              │
│  - Materiality Guardrails: Materiality thresholds on batch actions     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Multi-Tenant Isolation Analysis

### Tenant Resolution Mechanics
When an API request arrives at `getAuthContext(req)`:
1. **Cryptographic Token Verification**: The `copilot_session` cookie is decoded and verified using HMAC-SHA256. If valid, the session yields `userId`, `userEmail`, `role`, and `orgId`.
2. **Organization Context Resolution**:
   - The user may request access to a client organization via header `x-org-id` or query parameter `orgId`.
   - **Crucial Security Requirement**: The requested `orgId` **MUST NEVER** be trusted blindly. It must be checked against `user_organizations` table:
     ```sql
     SELECT 1 FROM user_organizations WHERE user_id = $1 AND org_id = $2;
     ```
   - If no valid membership row exists and the user is not a `FIRM_ADMIN`, the system throws `403 Forbidden: Tenant Isolation Violation`.

### Tenant Scoping by Resource Table

| Resource | Tenant Identifier | DB Constraint / FK | Isolation Mechanism | Verified Status |
| :--- | :--- | :--- | :--- | :--- |
| **Users** | `org_id` | `REFERENCES organizations(id)` | User belongs to primary org + `user_organizations` memberships | **VERIFIED** |
| **Transactions** | `org_id` | `REFERENCES organizations(id)` | Every query filters `WHERE org_id = $1` | **VERIFIED** |
| **Invoices** | `org_id` | `REFERENCES organizations(id)` | Every query filters `WHERE org_id = $1` | **VERIFIED** |
| **Bills** | `org_id` | `REFERENCES organizations(id)` | Every query filters `WHERE org_id = $1` | **VERIFIED** |
| **Bank Accounts** | `org_id` | `REFERENCES organizations(id)` | Query scoped by `org_id` | **VERIFIED** |
| **Documents** | `org_id` | `REFERENCES organizations(id)` | File ingestion writes with authenticated `org_id` | **VERIFIED** |
| **Reconciliation** | `org_id` | `REFERENCES organizations(id)` | Joins `transactions` & `invoices`/`bills` within `org_id` | **VERIFIED** |
| **Exceptions** | `org_id` | `REFERENCES organizations(id)` | Scoped by `org_id` | **VERIFIED** |
| **Approvals** | `org_id` | `REFERENCES organizations(id)` | Scoped by `org_id` | **VERIFIED** |
| **Audit Logs** | `org_id` | `REFERENCES organizations(id)` | Scoped by `org_id` | **VERIFIED** |
| **Alerts / Filings** | `org_id` | `REFERENCES organizations(id)` | Scoped by `org_id` | **VERIFIED** |
| **GSTR-2B Data** | `org_id` | `REFERENCES organizations(id)` | Scoped by `org_id` and `period` | **VERIFIED** |
| **AI Copilot** | `org_id` | Application parameter | `askFinancialCopilot(orgId, ...)` only queries target `org_id` | **VERIFIED** |

---

## 3. Production-Blocking Security Defects & Fix Roadmap

### P0-1: Password Backdoor Bypass in `src/lib/auth.ts`
* **Vulnerability**: `verifyPassword` allows `'password123'` or checks `storedHash.startsWith('$2a$10$demoHashedPassword')` allowing hardcoded demo passwords.
* **Remediation**: Eliminate the string prefix branch completely. Enforce authentic PBKDF2-SHA512 hash verification for all accounts.

### P0-2: Static Password Salt in `src/lib/auth.ts`
* **Vulnerability**: `hashPassword` uses default static salt `'salt_copilot_2026'`.
* **Remediation**: Transition to cryptographically random 16-byte salts per hash in format `salt:iterations:hash` or store salts in the database.

### P0-3: Unauthenticated Fallback Leaks in `src/lib/auth.ts`
* **Vulnerability**: `getAuthContext` contains a fallback when unauthenticated that selects the first organization in the database (`LIMIT 1`) or creates a mock in-memory organization `org-apex-01`.
* **Remediation**: In production, if unauthenticated, throw immediately with 401. Remove all in-memory mock organization synthesis.

### P0-4: Missing Tenant Isolation in Select API Routes
* **Vulnerability**:
  - `src/app/api/chart-of-accounts/route.ts` lacks `assertTenantAccess(auth, orgId)`.
  - `src/app/api/transactions/process/route.ts` lacks `assertTenantAccess(auth, orgId)`.
  - `src/app/api/compliance/route.ts` lacks `assertTenantAccess` in `POST`.
* **Remediation**: Inject mandatory `assertTenantAccess` and role assertions into these route handlers.

---

## 4. Webhook & SSRF Defense Model

In `src/lib/security.ts`:
* **Function**: `isSafeExternalWebhookUrl(urlString: string): boolean`
* **Rules Enforced**:
  1. Only `https://` protocols permitted in production.
  2. Blocks DNS names resolving to loopback (`localhost`, `127.0.0.1`, `::1`).
  3. Blocks RFC 1918 private IPv4 addresses:
     - `10.0.0.0/8`
     - `172.16.0.0/12`
     - `192.168.0.0/16`
  4. Blocks link-local and cloud metadata addresses:
     - `169.254.169.254` (AWS/GCP/Azure instance metadata)
* **Required Addition**: Outbound fetch calls must enforce a 5000ms timeout (`AbortSignal.timeout(5000)`) to prevent denial-of-service hanging.

---

## 5. Session Security & Cookie Hardening

* **Cookie Name**: `copilot_session`
* **Attributes**:
  - `httpOnly: true` (Prevents client-side XSS cookie theft)
  - `secure: process.env.NODE_ENV === 'production'` (Forces TLS transmission)
  - `sameSite: 'lax'` (Provides CSRF protection for cross-site navigations)
  - `path: '/'`
  - `maxAge: 86400` (Strict 24-hour expiration)
