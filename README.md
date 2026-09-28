# AI Finance Compliance Copilot

Multi-entity financial operations and compliance copilot tailored for Indian accounting standards, GST (GSTR-2B ITC reconciliation), and statutory TDS compliance under the Income-tax Act.

## Key Capabilities

- **Automated Bookkeeping & Categorization**: Deterministic rules engine with fallback to grounded AI inference.
- **GSTR-2B Reconciliation Engine**: Integer-paise reconciliation against GSTN auto-drafted ITC statements with fuzzy invoice variant matching and Section 16(4)/17(5) statutory checks.
- **Statutory TDS Compliance Engine**: Versioned rule management for Income-tax Act, 1961 (Sections 194C, 194J, 194H, 194I, 194Q) and 2025 Act transition, Form 26Q worksheets, and Challan ITNS 281 tracking.
- **Deterministic 3-Way Reconciliation**: Suggestion engine supporting 1:1, partial payments, batched multi-bill payments, and TDS-net vendor settlement matching.
- **Role-Based Access Control (RBAC)**: Strict tenant isolation and multi-role portfolio management for CAs, Business Owners, and Firm Admins.

## Security Architecture & Operational Notes

- **Authentication & Sessions**: Cryptographically signed HMAC-SHA256 session tokens stored in secure HTTP-Only cookies. Passwords hashed using PBKDF2-SHA512 with configurable development seeds (`DEMO_USER_PASSWORD` / `SEED_CA_PASSWORD`, `SEED_OWNER_PASSWORD`, etc.).
- **Dev Auth Fallback**: Development auth fallback headers (`x-user-role`, `x-org-id`) are **strictly default-denied** and require `ALLOW_INSECURE_DEV_AUTH=true` explicitly in non-production environments.
- **LLM Data Boundary**: Bank narrations passed to Gemini are length-capped (500 characters), stripped of control characters, and wrapped in strict `<untrusted_bank_narration>` XML boundary tags. AI model outputs are validated against strict runtime schemas.
- **Rate Limiting Architecture Limitation**: The application employs an in-memory sliding-window token bucket limiter (`src/lib/rateLimiter.ts`). Rate limits are maintained per Node.js process instance. For horizontally scaled multi-instance or serverless deployments, replace the in-memory store with a shared distributed Redis backend (e.g. Upstash, Redis Cluster).