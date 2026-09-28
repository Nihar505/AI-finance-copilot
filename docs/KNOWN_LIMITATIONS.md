# AI Finance Compliance Copilot — Known Limitations & Scope Boundaries

> **Status**: Verified against current production codebase implementation (September 2026).

---

## 1. Rate Limiting Architecture Limitation

- **In-Memory Per-Instance Scope**:
  - The sliding-window token bucket rate limiter (`src/lib/rateLimiter.ts`) maintains state in local Node.js process memory.
  - In horizontally scaled, multi-container, or serverless deployments, rate limit buckets are not synchronized across workers.
  - **Remediation for Multi-Instance Deployments**: Replace the in-memory store with a distributed cache backend such as Redis (Upstash, AWS ElastiCache, Valkey).

---

## 2. Ingestion & File Formats

- **Supported Formats**: CSV (`.csv`) and Excel spreadsheets (`.xlsx`, `.xls`) for bank statements, sales invoices, vendor bills, and GSTR-2B offline exports.
- **PDF Statement Parsing (On Hold)**: Direct optical/text PDF bank statement parsing is currently out of scope and on hold. Users must upload structured CSV or Excel extracts.
- **File Deduplication**: Document ingestion stores file size, filename, and records in PostgreSQL; cryptographic whole-file SHA-256 deduplication is scheduled for a future release.

---

## 3. Integrations & Protocol Boundaries

- **Direct ERP API Sync (On Hold)**: Direct bidirectional synchronization with external accounting suites (Tally, SAP, Zoho Books) is not currently implemented. All data is ingested via standard CSV/Excel templates.
- **Account Aggregator (AA) Automated Bank Feeds (On Hold)**: Live automated banking protocol feeds (ReBIT AA framework) are not integrated. Bank statements are imported via file upload.
- **General Ledger Engine (On Hold)**: Full double-entry journal voucher posting and trial balance generation are on hold; current ledger reconciliation focuses on bank statement to invoice/bill matching.

---

## 4. GSTR-2B Schema Provenance

- **Public Best-Effort Documentation**: JSON keys and Excel column mappings are derived from official GST Developer Portal Returns APIs, GST Advisory No. 402, and portal user guides.
- **Field Annotations**: GSTR-2B field names in `src/lib/gstr2bEngine.ts` are annotated with `// NEEDS_VERIFICATION:` comments and handled defensively with multi-key fallbacks. Production deployments should validate against live portal JSON exports.
