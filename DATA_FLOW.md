# AI Finance Copilot — Data Flow & Pipeline Architecture

> **Source Verification**: Verified against the implementation files in `src/app/api/`, `src/lib/`, and `src/components/`.

---

## 1. Authentication & Session Lifecycle

The authentication lifecycle strictly isolates authentication (identity verification) from authorization (permission and tenancy checks).

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Browser
    participant Page as /login (LoginForm)
    participant LoginAPI as POST /api/auth/login
    participant RateLimiter as rateLimiter.ts
    participant DB as PostgreSQL (users table)
    participant AuthLib as auth.ts (PBKDF2 & HMAC)
    participant Edge as middleware.ts
    participant AppAPI as Protected API (/api/transactions)

    User->>Page: Enters email, password & selects Role
    Page->>LoginAPI: POST { email, password, role }
    LoginAPI->>RateLimiter: checkRateLimit('auth_login', clientIp)
    alt Rate Limit Exceeded
        RateLimiter-->>LoginAPI: { allowed: false, resetSeconds }
        LoginAPI-->>User: 429 Too Many Requests (Retry-After header)
    end
    RateLimiter-->>LoginAPI: { allowed: true }

    LoginAPI->>DB: SELECT id, org_id, password_hash, role, is_active FROM users WHERE email = $1
    alt User not found or inactive
        DB-->>LoginAPI: Empty / Inactive
        LoginAPI-->>User: 401 Unauthorized (Generic "Invalid email or password")
    end

    LoginAPI->>AuthLib: verifyPassword(password, storedHash)
    alt Password Invalid
        AuthLib-->>LoginAPI: false
        LoginAPI-->>User: 401 Unauthorized
    end
    AuthLib-->>LoginAPI: true

    LoginAPI->>AuthLib: createSessionToken({ userId, userName, userEmail, role, orgId })
    AuthLib-->>LoginAPI: token = base64url(payload) + '.' + HMAC_SHA256(payload, secret)

    LoginAPI-->>User: 200 OK + Set-Cookie: copilot_session=token; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400

    Note over User,AppAPI: Subsequent Protected API Request
    User->>Edge: GET /api/transactions (Cookie: copilot_session=...)
    Edge->>Edge: verifySessionEdge(token)
    alt Invalid Signature or Expired
        Edge-->>User: 401 Unauthorized ("Authentication required")
    end
    Edge->>AppAPI: Forward verified request

    AppAPI->>AuthLib: getAuthContext(req)
    AuthLib->>DB: SELECT 1 FROM user_organizations WHERE user_id = $1 AND org_id = $2
    alt User Not Member of Org
        AuthLib-->>AppAPI: throw 403 Forbidden ("Tenant Isolation Violation")
        AppAPI-->>User: 403 Forbidden
    end
    AppAPI->>DB: SELECT * FROM transactions WHERE org_id = $1
    DB-->>AppAPI: Tenant-Isolated Data
    AppAPI-->>User: 200 OK
```

---

## 2. Ingestion & File Processing Pipeline

The upload pipeline ingests bank statements, sales invoices, and vendor bills.

```mermaid
flowchart TD
    Start([User uploads file in UploadView.tsx]) --> UIValidation{Client File Check}
    UIValidation -->|Size > 25MB| UIErr[Show error toast]
    UIValidation -->|Valid| SendReq[POST /api/upload multipart/form-data]

    SendReq --> AuthCheck{assertTenantAccess}
    AuthCheck -->|Failed| Res403[403 Forbidden]
    AuthCheck -->|Passed| TypeCheck{fileType valid?}
    TypeCheck -->|No| Res400[400 Bad Request]

    TypeCheck -->|Yes| ReadBuffer[Read ArrayBuffer & compute SHA-256]
    ReadBuffer --> FileDeduplication{file_hash exists in documents table?}
    FileDeduplication -->|Yes| Res409[409 Conflict: Identical file already ingested]

    FileDeduplication -->|No| ParseStep{fileType Branch}

    ParseStep -->|bank_statement| ParseBank[parseBankStatement CSV/XLSX]
    ParseStep -->|sales_invoices| ParseInv[parseSalesInvoices CSV/XLSX]
    ParseStep -->|vendor_bills| ParseBills[parseVendorBills CSV/XLSX]

    ParseBank --> RowValidation[Validate Date, Clean Narration, Sanitize Formulas]
    ParseInv --> RowValidation
    ParseBills --> RowValidation

    RowValidation --> TxnBlock[Begin Database Transaction]
    TxnBlock --> InsertDoc[INSERT INTO documents status='processed']
    InsertDoc --> RowLoop[Loop through parsed entities]

    RowLoop --> DedupCheck{Entity already exists in Org?}
    DedupCheck -->|Yes| SkipRow[Increment duplicatesSkipped]
    DedupCheck -->|No| InsertRow[INSERT INTO transactions / invoices / bills]

    SkipRow --> NextRow{More rows?}
    InsertRow --> NextRow
    NextRow -->|Yes| RowLoop

    NextRow -->|No| CommitTxn[COMMIT Transaction]
    CommitTxn --> AutoEngines[Trigger Background Batch Pipelines]

    AutoEngines --> CatBatch[runCategorizationBatch]
    AutoEngines --> RecBatch[runReconciliationBatch]
    AutoEngines --> ExcBatch[runExceptionDetection]

    AutoEngines --> AuditLog[logAuditEvent IMPORT_DATA]
    AuditLog --> Response[200 OK: Ingestion summary with row counts]
```

---

## 3. Financial Reconciliation Flow

```mermaid
sequenceDiagram
    autonumber
    participant UI as ReconciliationView.tsx
    participant API as GET /api/reconciliation
    participant Engine as reconciliationEngine.ts
    participant DB as PostgreSQL

    UI->>API: GET /api/reconciliation (headers: activeOrgId)
    API->>DB: Query suggested & approved matches from reconciliation_records
    API->>DB: Query unreconciled queue from transactions
    DB-->>API: Matches & Unmatched rows
    API-->>UI: 200 OK { matches, unmatched }

    Note over UI,DB: Execution of Automated Batch Matching
    Engine->>DB: SELECT * FROM transactions WHERE org_id = $1 AND reconciliation_status = 'unreconciled'
    loop For each unreconciled transaction
        alt Transaction is Credit (+)
            Engine->>DB: SELECT * FROM invoices WHERE org_id = $1 AND status != 'paid'
        else Transaction is Debit (-)
            Engine->>DB: SELECT * FROM bills WHERE org_id = $1 AND status != 'paid'
        end
        Engine->>Engine: Score multi-factor criteria (Amount, TDS, Party, Proximity, Ref)
        alt Score >= 65% Confidence
            Engine->>DB: INSERT INTO reconciliation_records (status='suggested', match_confidence, reasoning)
            Engine->>DB: UPDATE transactions SET reconciliation_status='suggested_match'
        end
    end
```

---

## 4. AI Copilot Data Flow & Security Boundary

```mermaid
flowchart TD
    UserQ([User Question in CopilotChatView]) --> RateLimit{Rate Limit: 30 req/min}
    RateLimit -->|Exceeded| Res429[429 Too Many Requests]
    RateLimit -->|Permitted| Sanitization[sanitizeString: strip control chars & length <= 1500]

    Sanitization --> TenancyGuard{assertTenantAccess}
    TenancyGuard -->|Denied| Res403[403 Forbidden]
    TenancyGuard -->|Allowed| ContextQuery[Query PostgreSQL for active org_id only]

    ContextQuery --> DataMinimization[Data Minimization: Mask PII, Strip internal auth tokens]
    DataMinimization --> PromptConstruction[Construct Grounded Prompt with System Instruction]

    PromptConstruction --> KeyCheck{GEMINI_API_KEY Configured?}
    KeyCheck -->|Yes| GeminiCall[Call GoogleGenAI gemini-2.5-flash with timeout]
    KeyCheck -->|No / Error| LocalFallback[Deterministic Local Grounded Copilot Engine]

    GeminiCall --> Validation[Validate response structure: Direct Answer + Citations]
    LocalFallback --> Validation
    Validation --> Disclaimer[Inject Statutory Disclaimer: AI suggestion only, human review mandatory]
    Disclaimer --> ReturnResponse[Return 200 OK to User]
```

---

## 5. Webhook Alerting & SSRF Protection Flow

```mermaid
sequenceDiagram
    autonumber
    participant UI as ComplianceView / WorkspaceApp
    participant Route as POST /api/alerts
    participant Sec as security.ts (isSafeExternalWebhookUrl)
    participant Ext as External Webhook (Slack / Teams)
    participant Audit as audit_logs

    UI->>Route: POST { action: 'send_compliance_alert', webhookUrl }
    Route->>Route: assertTenantAccess(auth, activeOrgId)
    Route->>Sec: isSafeExternalWebhookUrl(targetUrl)

    alt Target is Loopback (127.0.0.1) or Private IP (10.x, 192.168.x) or Cloud Metadata (169.254.169.254)
        Sec-->>Route: false
        Route-->>UI: 400 Bad Request ("Disallowed webhook URL. Only public HTTPS endpoints permitted.")
    end
    Sec-->>Route: true

    Route->>Route: Build Slack Block Kit summary of overdue filings
    Route->>Ext: fetch(targetUrl, { method: 'POST', body, signal: AbortSignal.timeout(5000) })
    Ext-->>Route: HTTP 200 OK
    Route->>Audit: logAuditEvent('DISPATCH_COMPLIANCE_ALERT')
    Route-->>UI: 200 OK { delivered: true, alertCount }
```
