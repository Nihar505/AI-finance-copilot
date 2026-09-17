# Migration 001 — Manual Rollback Runbook

**Migration file**: `src/migrations/001_initial_schema.sql`  
**Purpose**: Creates all baseline tables and indices for the AI Finance & Compliance Copilot.

---

> [!CAUTION]
> This system holds **financial data** (transactions, invoices, bills, audit logs) and
> **Indian statutory identifiers** (PAN, GSTIN, bank UTRs).  
> **You MUST perform a full database backup before executing any rollback step.**
> Verify the backup is readable before dropping any table.

---

## Pre-Rollback Checklist

1. **Backup the database** (do this first, without exception):
   ```bash
   # For managed Postgres (Neon / Supabase / RDS):
   pg_dump "$DATABASE_URL" --format=custom --file=backups/pre_rollback_$(date +%Y%m%d_%H%M%S).dump

   # Verify the dump is readable:
   pg_restore --list backups/pre_rollback_*.dump | head -20
   ```
2. Confirm **no live pilot/customer data** is in the instance (check with the team lead before proceeding on a production DB).
3. Notify all active users that the system will be unavailable during rollback.
4. Stop the application server to prevent writes during the operation.

---

## Rollback Steps

> Execute these in order. Each step must succeed before proceeding to the next.

### Step 1 — Drop indices

Indices must be dropped before the tables they reference.

```sql
DROP INDEX IF EXISTS idx_gstr2b_supplier_inv;
DROP INDEX IF EXISTS idx_gstr2b_org_period;
DROP INDEX IF EXISTS idx_compliance_org_status;
DROP INDEX IF EXISTS idx_compliance_org_due;
DROP INDEX IF EXISTS idx_pilot_requests_created;
DROP INDEX IF EXISTS idx_audit_logs_timestamp;
DROP INDEX IF EXISTS idx_exceptions_org_status;
DROP INDEX IF EXISTS idx_bills_org_status;
DROP INDEX IF EXISTS idx_invoices_org_status;
DROP INDEX IF EXISTS idx_transactions_approved;
DROP INDEX IF EXISTS idx_transactions_status;
DROP INDEX IF EXISTS idx_transactions_org_date;
```

### Step 2 — Drop tables (leaf → root, respecting FK order)

```sql
DROP TABLE IF EXISTS gstr2b_entries          CASCADE;
DROP TABLE IF EXISTS compliance_filings       CASCADE;
DROP TABLE IF EXISTS pilot_requests           CASCADE;
DROP TABLE IF EXISTS audit_logs               CASCADE;
DROP TABLE IF EXISTS approvals                CASCADE;
DROP TABLE IF EXISTS categorization_rules     CASCADE;
DROP TABLE IF EXISTS exceptions               CASCADE;
DROP TABLE IF EXISTS reconciliation_records   CASCADE;
DROP TABLE IF EXISTS bills                    CASCADE;
DROP TABLE IF EXISTS invoices                 CASCADE;
DROP TABLE IF EXISTS transactions             CASCADE;
DROP TABLE IF EXISTS documents                CASCADE;
DROP TABLE IF EXISTS customers                CASCADE;
DROP TABLE IF EXISTS vendors                  CASCADE;
DROP TABLE IF EXISTS bank_accounts            CASCADE;
DROP TABLE IF EXISTS chart_of_accounts        CASCADE;
DROP TABLE IF EXISTS user_organizations       CASCADE;
DROP TABLE IF EXISTS users                    CASCADE;
DROP TABLE IF EXISTS organizations            CASCADE;
```

> **Note**: `CASCADE` is used to handle any residual FK dependencies.  
> It will also remove views or rules that reference these tables — verify there are none first with:
> ```sql
> SELECT viewname FROM pg_views WHERE schemaname = 'public';
> ```

### Step 3 — Remove migration tracking record

```sql
DELETE FROM _migrations WHERE name = '001_initial_schema.sql';
```

If you are rolling back ALL migrations (fresh start), you can also drop the migrations table:

```sql
DROP TABLE IF EXISTS _migrations;
```

### Step 4 — Verify rollback

```sql
-- Should return 0 rows if all tables were dropped:
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT IN ('_migrations');
```

---

## Post-Rollback Actions

1. Restart the application server.
2. Re-run `npm run db:migrate` to re-apply migrations from a clean state (if needed).
3. Record the rollback event in your incident log with timestamp, operator name, and reason.

---

## Data Safety Notes

- **PAN / GSTIN data** is stored in `organizations.tax_id`, `vendors.tax_id`, `customers.tax_id`, and `gstr2b_entries`. Ensure backup media is encrypted and access-controlled per DPDP Act requirements.
- **Audit logs** (`audit_logs`) are the compliance trail — never delete these without explicit sign-off from the CA partner and legal counsel.
- **Financial transactions** — if any live customer data was written before rollback, it must be exported and handed back to the client before the table is dropped.
