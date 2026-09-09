import { getDb } from './db';

export const ORG_ID = 'org-apex-01';
export const ORG_ZENITH_ID = 'org-zenith-02';

export const DEFAULT_ACCOUNTS = [
  // Assets
  { id: 'acc-1010', code: '1010', name: 'HDFC Main Operational Bank Account', type: 'asset', sub_type: 'current_asset', description: 'Primary business checking account' },
  { id: 'acc-1100', code: '1100', name: 'Accounts Receivable', type: 'asset', sub_type: 'current_asset', description: 'Money owed by clients for invoices' },
  { id: 'acc-1200', code: '1200', name: 'Prepayments & Security Deposits', type: 'asset', sub_type: 'current_asset', description: 'Office lease deposits, advance retainers' },
  { id: 'acc-1500', code: '1500', name: 'Office Equipment & Computers', type: 'asset', sub_type: 'fixed_asset', description: 'Laptops, monitors, IT equipment' },
  // Liabilities
  { id: 'acc-2010', code: '2010', name: 'Accounts Payable', type: 'liability', sub_type: 'current_liability', description: 'Unpaid vendor bills and supplier dues' },
  { id: 'acc-2050', code: '2050', name: 'GST & Statutory Taxes Payable', type: 'liability', sub_type: 'current_liability', description: 'GST collected on sales minus input credit' },
  { id: 'acc-2060', code: '2060', name: 'TDS Payable', type: 'liability', sub_type: 'current_liability', description: 'Tax deducted at source from vendors & salaries' },
  { id: 'acc-2100', code: '2100', name: 'Accrued Salaries & Benefits', type: 'liability', sub_type: 'current_liability', description: 'Month-end salary liabilities' },
  // Equity
  { id: 'acc-3010', code: '3010', name: "Partners' Capital Account", type: 'equity', sub_type: 'equity', description: 'Initial invested capital' },
  { id: 'acc-3020', code: '3020', name: 'Retained Earnings', type: 'equity', sub_type: 'equity', description: 'Cumulative net profit / loss' },
  // Revenue
  { id: 'acc-4010', code: '4010', name: 'Client Retainer & Advisory Fees', type: 'revenue', sub_type: 'direct_income', description: 'Recurring monthly retainer fees' },
  { id: 'acc-4020', code: '4020', name: 'Audit & Compliance Assurance Fees', type: 'revenue', sub_type: 'direct_income', description: 'Statutory audit and tax filing revenue' },
  { id: 'acc-4030', code: '4030', name: 'Special CFO & Valuation Projects', type: 'revenue', sub_type: 'direct_income', description: 'One-off corporate advisory projects' },
  { id: 'acc-4090', code: '4090', name: 'Bank Interest & Other Income', type: 'revenue', sub_type: 'indirect_income', description: 'Fixed deposit and savings interest' },
  // Expenses
  { id: 'acc-5010', code: '5010', name: 'Cloud Infrastructure & Servers', type: 'expense', sub_type: 'operating_expense', description: 'AWS, GCP, Azure infrastructure' },
  { id: 'acc-5020', code: '5020', name: 'SaaS Subscriptions & Software', type: 'expense', sub_type: 'operating_expense', description: 'Google Workspace, Slack, Figma, Zoom' },
  { id: 'acc-5030', code: '5030', name: 'Staff Salaries & Professional Stipends', type: 'expense', sub_type: 'operating_expense', description: 'Payroll and professional retainers' },
  { id: 'acc-5040', code: '5040', name: 'Office Rent & Maintenance', type: 'expense', sub_type: 'operating_expense', description: 'Lease rent, society maintenance, co-working' },
  { id: 'acc-5050', code: '5050', name: 'Legal, Audit & Compliance Expenses', type: 'expense', sub_type: 'operating_expense', description: 'External counsel, regulatory filings' },
  { id: 'acc-5060', code: '5060', name: 'Travel, Conveyance & Lodging', type: 'expense', sub_type: 'operating_expense', description: 'Uber, flights, client visit transport' },
  { id: 'acc-5070', code: '5070', name: 'Marketing, Events & Business Development', type: 'expense', sub_type: 'operating_expense', description: 'Conferences, website, marketing campaigns' },
  { id: 'acc-5080', code: '5080', name: 'Internet, Telecom & Utilities', type: 'expense', sub_type: 'operating_expense', description: 'Airtel broadband, mobile, electricity' },
  { id: 'acc-5090', code: '5090', name: 'Bank Charges & Payment Gateway Fees', type: 'expense', sub_type: 'operating_expense', description: 'Bank processing fees, Razorpay charges' },
  { id: 'acc-5100', code: '5100', name: 'Office Supplies & Meals', type: 'expense', sub_type: 'operating_expense', description: 'Stationery, team pantry, client refreshments' }
];

export async function seedBaseData() {
  const db = await getDb();

  // 1. Organizations
  await db.query(
    `INSERT INTO organizations (id, name, legal_name, tax_id, currency, fiscal_year_start, materiality_threshold, suggest_only_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       legal_name = EXCLUDED.legal_name,
       tax_id = EXCLUDED.tax_id,
       materiality_threshold = EXCLUDED.materiality_threshold,
       suggest_only_mode = EXCLUDED.suggest_only_mode;`,
    [
      ORG_ID,
      'Apex Global Advisory & Co.',
      'Apex Global Advisory Services LLP',
      '27AAACA9876Q1ZA',
      'INR',
      '04-01',
      50000.00,
      true
    ]
  );

  await db.query(
    `INSERT INTO organizations (id, name, legal_name, tax_id, currency, fiscal_year_start, materiality_threshold, suggest_only_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       legal_name = EXCLUDED.legal_name,
       tax_id = EXCLUDED.tax_id,
       materiality_threshold = EXCLUDED.materiality_threshold,
       suggest_only_mode = EXCLUDED.suggest_only_mode;`,
    [
      ORG_ZENITH_ID,
      'Zenith Tech Labs Pvt Ltd',
      'Zenith Tech Labs Private Limited',
      '29AABCT1234K1Z0',
      'INR',
      '04-01',
      25000.00,
      true
    ]
  );

  // 2. Users & Multi-Tenant Roles
  await db.query(
    `INSERT INTO users (id, org_id, name, email, role, password_hash)
     VALUES 
       ('user-lead-ca', $1, 'Priya Sharma, FCA', 'priya.sharma@apexadvisory.com', 'ca', '$2a$10$demoHashedPasswordSeniorCA12345'),
       ('user-business-owner', $2, 'Rajesh Gupta (Founder)', 'rajesh.gupta@zenithtech.io', 'business_owner', '$2a$10$demoHashedPasswordOwner12345'),
       ('user-admin', $1, 'Vikram Seth (Admin)', 'admin@financecopilot.internal', 'admin', '$2a$10$demoHashedPasswordAdmin12345')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       role = EXCLUDED.role;`,
    [ORG_ID, ORG_ZENITH_ID]
  );

  // User-Organization mappings (for CA portfolio management)
  await db.query(
    `INSERT INTO user_organizations (user_id, org_id, role)
     VALUES
       ('user-lead-ca', $1, 'ca'),
       ('user-lead-ca', $2, 'ca'),
       ('user-business-owner', $2, 'business_owner'),
       ('user-admin', $1, 'admin'),
       ('user-admin', $2, 'admin')
     ON CONFLICT (user_id, org_id) DO NOTHING;`,
    [ORG_ID, ORG_ZENITH_ID]
  );

  // 3. Bank Accounts
  await db.query(
    `INSERT INTO bank_accounts (id, org_id, account_name, account_number_mask, bank_name, currency, opening_balance, current_balance)
     VALUES ($1, $2, 'HDFC Main Operational A/C', '····8492', 'HDFC Bank Ltd.', 'INR', 1500000.00, 1500000.00)
     ON CONFLICT (id) DO NOTHING;`,
    ['bank-hdfc-01', ORG_ID]
  );

  await db.query(
    `INSERT INTO bank_accounts (id, org_id, account_name, account_number_mask, bank_name, currency, opening_balance, current_balance)
     VALUES ($1, $2, 'ICICI Current A/C (Tech Startup)', '····4019', 'ICICI Bank Ltd.', 'INR', 850000.00, 850000.00)
     ON CONFLICT (id) DO NOTHING;`,
    ['bank-icici-02', ORG_ZENITH_ID]
  );

  // 4. Chart of Accounts
  for (const acc of DEFAULT_ACCOUNTS) {
    await db.query(
      `INSERT INTO chart_of_accounts (id, org_id, code, name, type, sub_type, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING;`,
      [acc.id, ORG_ID, acc.code, acc.name, acc.type, acc.sub_type, acc.description]
    );
  }

  // 5. Categorization Rules
  const defaultRules = [
    { id: 'rule-01', name: 'AWS Cloud Services', pattern: 'AWS|Amazon Web Services|AMZN', match_field: 'description', category_id: 'acc-5010', confidence: 100, priority: 1 },
    { id: 'rule-02', name: 'Google Suite & Cloud', pattern: 'Google|GSUITE|GOOGLE WORKSPACE', match_field: 'description', category_id: 'acc-5020', confidence: 98, priority: 1 },
    { id: 'rule-03', name: 'Office Rent - WeWork', pattern: 'WeWork|Awfis|Co-working', match_field: 'description', category_id: 'acc-5040', confidence: 99, priority: 1 },
    { id: 'rule-04', name: 'Uber Travel / Conveyance', pattern: 'Uber|Ola|Ride|Taxi', match_field: 'description', category_id: 'acc-5060', confidence: 95, priority: 2 },
    { id: 'rule-05', name: 'Payment Gateway & Bank Fees', pattern: 'Razorpay Fees|Payment Gateway|HDFC Bank Charges', match_field: 'description', category_id: 'acc-5090', confidence: 100, priority: 1 },
    { id: 'rule-06', name: 'Broadband & Telecom', pattern: 'Airtel|Jio|Broadband|Telecom', match_field: 'description', category_id: 'acc-5080', confidence: 96, priority: 2 },
    { id: 'rule-07', name: 'Payroll & Salaries', pattern: 'Salary Payout|Monthly Payroll|Staff Wages', match_field: 'description', category_id: 'acc-5030', confidence: 100, priority: 1 },
    { id: 'rule-08', name: 'Client Retainer Fees', pattern: 'Client Retainer|Monthly Advisory|Retainer Fee', match_field: 'description', category_id: 'acc-4010', confidence: 98, priority: 1 },
    { id: 'rule-09', name: 'Statutory Audit Fee', pattern: 'Statutory Audit|Tax Audit|Assurance', match_field: 'description', category_id: 'acc-4020', confidence: 98, priority: 1 },
    { id: 'rule-10', name: 'Dell IT Hardware', pattern: 'Dell Technologies|Dell India|Apple Store', match_field: 'description', category_id: 'acc-1500', confidence: 94, priority: 2 }
  ];

  for (const r of defaultRules) {
    await db.query(
      `INSERT INTO categorization_rules (id, org_id, name, pattern, match_field, category_id, confidence, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         pattern = EXCLUDED.pattern,
         category_id = EXCLUDED.category_id,
         confidence = EXCLUDED.confidence;`,
      [r.id, ORG_ID, r.name, r.pattern, r.match_field, r.category_id, r.confidence, r.priority]
    );
  }

  // 6. Vendors
  const vendors = [
    { id: 'ven-01', name: 'Amazon Web Services India Pvt Ltd', tax_id: '27AABCA1234D1ZP', default_category_id: 'acc-5010' },
    { id: 'ven-02', name: 'Google Cloud India Pvt Ltd', tax_id: '27AABCG5678M1ZQ', default_category_id: 'acc-5020' },
    { id: 'ven-03', name: 'WeWork India Management Pvt Ltd', tax_id: '27AACCW9988L1ZT', default_category_id: 'acc-5040' },
    { id: 'ven-04', name: 'Dell India Enterprise Pvt Ltd', tax_id: null, default_category_id: 'acc-1500' }, // Missing Tax ID deliberate exception
    { id: 'ven-05', name: 'Bharti Airtel Limited', tax_id: '27AAACB0011F1ZX', default_category_id: 'acc-5080' },
    { id: 'ven-06', name: 'Razorpay Software Pvt Ltd', tax_id: '27AABCR4433P1ZR', default_category_id: 'acc-5090' },
    { id: 'ven-07', name: 'Slack Technologies Inc.', tax_id: '9920USA998811AA', default_category_id: 'acc-5020' }
  ];

  for (const v of vendors) {
    await db.query(
      `INSERT INTO vendors (id, org_id, name, tax_id, default_category_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING;`,
      [v.id, ORG_ID, v.name, v.tax_id, v.default_category_id]
    );
  }

  // 7. Customers
  const customers = [
    { id: 'cust-01', name: 'Zenith FinTech Solutions Ltd', tax_id: '27AAACZ1122K1ZM', default_category_id: 'acc-4010' },
    { id: 'cust-02', name: 'Horizon Cloud Labs Pvt Ltd', tax_id: '27AABCH3344J1ZN', default_category_id: 'acc-4010' },
    { id: 'cust-03', name: 'Bharat Mobility Enterprises', tax_id: '27AACCB5566G1ZO', default_category_id: 'acc-4020' },
    { id: 'cust-04', name: 'Quantum Retail Dynamics Ltd', tax_id: '27AADCO7788H1ZP', default_category_id: 'acc-4030' }
  ];

  for (const c of customers) {
    await db.query(
      `INSERT INTO customers (id, org_id, name, tax_id, default_category_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING;`,
      [c.id, ORG_ID, c.name, c.tax_id, c.default_category_id]
    );
  }
}

export async function seedRealisticSandboxData() {
  const db = await getDb();
  await seedBaseData();

  // Clear existing transactions, invoices, bills, exceptions, audit logs for a fresh sandbox demo
  await db.exec(`
    DELETE FROM audit_logs WHERE org_id IN ('${ORG_ID}', '${ORG_ZENITH_ID}');
    DELETE FROM approvals WHERE org_id IN ('${ORG_ID}', '${ORG_ZENITH_ID}');
    DELETE FROM exceptions WHERE org_id IN ('${ORG_ID}', '${ORG_ZENITH_ID}');
    DELETE FROM reconciliation_records WHERE org_id IN ('${ORG_ID}', '${ORG_ZENITH_ID}');
    DELETE FROM transactions WHERE org_id IN ('${ORG_ID}', '${ORG_ZENITH_ID}');
    DELETE FROM invoices WHERE org_id IN ('${ORG_ID}', '${ORG_ZENITH_ID}');
    DELETE FROM bills WHERE org_id IN ('${ORG_ID}', '${ORG_ZENITH_ID}');
    DELETE FROM documents WHERE org_id IN ('${ORG_ID}', '${ORG_ZENITH_ID}');
  `);

  // Create document batches
  const docBankId = 'doc-bank-oct2024';
  const docInvId = 'doc-inv-oct2024';
  const docBillsId = 'doc-bills-oct2024';

  await db.query(
    `INSERT INTO documents (id, org_id, filename, file_type, file_size, status, row_count, uploaded_by)
     VALUES 
       ($1, $2, 'HDFC_Bank_Statement_Oct2024.csv', 'bank_statement', 14200, 'processed', 24, 'user-lead-ca'),
       ($3, $2, 'Sales_Invoices_Q3_Batch.csv', 'sales_invoices', 8500, 'processed', 6, 'user-lead-ca'),
       ($4, $2, 'Vendor_Payables_Oct2024.csv', 'vendor_bills', 9100, 'processed', 7, 'user-lead-ca')
     ON CONFLICT (id) DO NOTHING;`,
    [docBankId, ORG_ID, docInvId, docBillsId]
  );

  // Sales Invoices
  const invoices = [
    { id: 'inv-101', customer_id: 'cust-01', customer_name: 'Zenith FinTech Solutions Ltd', invoice_number: 'INV-2024-101', date: '2024-10-01', due_date: '2024-10-15', total_amount: 250000.00, tax_amount: 38135.59, status: 'unpaid' },
    { id: 'inv-102', customer_id: 'cust-02', customer_name: 'Horizon Cloud Labs Pvt Ltd', invoice_number: 'INV-2024-102', date: '2024-10-04', due_date: '2024-10-20', total_amount: 180000.00, tax_amount: 27457.63, status: 'unpaid' },
    { id: 'inv-103', customer_id: 'cust-03', customer_name: 'Bharat Mobility Enterprises', invoice_number: 'INV-2024-103', date: '2024-10-06', due_date: '2024-10-25', total_amount: 320000.00, tax_amount: 48813.56, status: 'unpaid' },
    { id: 'inv-104', customer_id: 'cust-04', customer_name: 'Quantum Retail Dynamics Ltd', invoice_number: 'INV-2024-104', date: '2024-10-11', due_date: '2024-10-30', total_amount: 140000.00, tax_amount: 21355.93, status: 'unpaid' },
    { id: 'inv-105', customer_id: 'cust-01', customer_name: 'Zenith FinTech Solutions Ltd', invoice_number: 'INV-2024-105', date: '2024-10-18', due_date: '2024-11-02', total_amount: 95000.00, tax_amount: 14491.53, status: 'unpaid' },
    // Deliberate duplicate invoice number to trigger exception rule!
    { id: 'inv-106-dup', customer_id: 'cust-02', customer_name: 'Horizon Cloud Labs Pvt Ltd', invoice_number: 'INV-2024-102', date: '2024-10-28', due_date: '2024-11-12', total_amount: 180000.00, tax_amount: 27457.63, status: 'flagged' }
  ];

  for (const inv of invoices) {
    await db.query(
      `INSERT INTO invoices (id, org_id, document_id, customer_id, customer_name, invoice_number, date, due_date, total_amount, tax_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
      [inv.id, ORG_ID, docInvId, inv.customer_id, inv.customer_name, inv.invoice_number, inv.date, inv.due_date, inv.total_amount, inv.tax_amount, inv.status]
    );
  }

  // Vendor Bills
  const bills = [
    { id: 'bill-801', vendor_id: 'ven-01', vendor_name: 'Amazon Web Services India Pvt Ltd', bill_number: 'AWS-OCT-9912', date: '2024-10-01', due_date: '2024-10-15', total_amount: 42500.00, tax_amount: 6483.05, status: 'unpaid' },
    { id: 'bill-802', vendor_id: 'ven-02', vendor_name: 'Google Cloud India Pvt Ltd', bill_number: 'GCP-IND-4410', date: '2024-10-03', due_date: '2024-10-18', total_amount: 18400.00, tax_amount: 2806.78, status: 'unpaid' },
    { id: 'bill-803', vendor_id: 'ven-03', vendor_name: 'WeWork India Management Pvt Ltd', bill_number: 'WW-BLR-0982', date: '2024-10-05', due_date: '2024-10-10', total_amount: 115000.00, tax_amount: 17542.37, status: 'unpaid' },
    { id: 'bill-804', vendor_id: 'ven-04', vendor_name: 'Dell India Enterprise Pvt Ltd', bill_number: 'DELL-CORP-771', date: '2024-10-14', due_date: '2024-10-28', total_amount: 165000.00, tax_amount: 25169.49, status: 'unpaid' },
    { id: 'bill-805', vendor_id: 'ven-05', vendor_name: 'Bharti Airtel Limited', bill_number: 'AIRTEL-LL-99201', date: '2024-10-17', due_date: '2024-10-31', total_amount: 12800.00, tax_amount: 1952.54, status: 'unpaid' },
    { id: 'bill-806', vendor_id: 'ven-06', vendor_name: 'Razorpay Software Pvt Ltd', bill_number: 'RZP-STMT-OCT24', date: '2024-10-24', due_date: '2024-10-26', total_amount: 6450.00, tax_amount: 983.90, status: 'unpaid' },
    { id: 'bill-807', vendor_id: 'ven-07', vendor_name: 'Slack Technologies Inc.', bill_number: 'SLACK-INV-5510', date: '2024-10-19', due_date: '2024-11-03', total_amount: 24000.00, tax_amount: 0.00, status: 'unpaid' }
  ];

  for (const b of bills) {
    await db.query(
      `INSERT INTO bills (id, org_id, document_id, vendor_id, vendor_name, bill_number, date, due_date, total_amount, tax_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
      [b.id, ORG_ID, docBillsId, b.vendor_id, b.vendor_name, b.bill_number, b.date, b.due_date, b.total_amount, b.tax_amount, b.status]
    );
  }

  // 24 Real Bank Transactions (October 2024)
  const rawTxns = [
    // Revenue Inflows
    { id: 'txn-101', date: '2024-10-03', desc: 'RTGS-CR-ZENITH FINTECH SOL-INV-2024-101', amount: 250000.00, type: 'credit', counterparty: 'Zenith FinTech Solutions Ltd', ref: 'RTGS-CR-9821' },
    { id: 'txn-102', date: '2024-10-08', desc: 'NEFT-CR-BHARAT MOBILITY ENTERPRISES-INV-103', amount: 320000.00, type: 'credit', counterparty: 'Bharat Mobility Enterprises', ref: 'NEFT-CR-1192' },
    { id: 'txn-103', date: '2024-10-15', desc: 'CMS-CR-QUANTUM RETAIL DYNAMICS-INV-104', amount: 140000.00, type: 'credit', counterparty: 'Quantum Retail Dynamics Ltd', ref: 'CMS-CR-7721' },
    { id: 'txn-104', date: '2024-10-22', desc: 'NEFT-CR-8932014-UNIDENTIFIED REMITTANCE', amount: 75000.00, type: 'credit', counterparty: 'Unknown Remitter', ref: 'NEFT-CR-8932' },
    { id: 'txn-105', date: '2024-10-31', desc: 'INTEREST CREDIT HDFC Q3 FIXED DEPOSIT', amount: 14500.00, type: 'credit', counterparty: 'HDFC Bank Ltd', ref: 'INT-CR-OCT24' },

    // Operating Expenses & Outflows
    { id: 'txn-201', date: '2024-10-02', desc: 'POS-DB-AMAZON WEB SERVICES INDIA CLOUD', amount: 42500.00, type: 'debit', counterparty: 'Amazon Web Services India Pvt Ltd', ref: 'POS-AWS-001' },
    { id: 'txn-202', date: '2024-10-04', desc: 'ACH-DB-GOOGLE WORKSPACE INDIA SUBSCRIPTION', amount: 18400.00, type: 'debit', counterparty: 'Google Cloud India Pvt Ltd', ref: 'ACH-GGL-41' },
    { id: 'txn-203', date: '2024-10-05', desc: 'NEFT-DB-WEWORK INDIA MANAGEMENT PVT LTD', amount: 115000.00, type: 'debit', counterparty: 'WeWork India Management Pvt Ltd', ref: 'NEFT-WW-11' },
    { id: 'txn-204', date: '2024-10-10', desc: 'BULK-SALARY PAYOUT OCTOBER 2024 EMPLOYEES', amount: 480000.00, type: 'debit', counterparty: 'Staff Payroll Account', ref: 'PAY-OCT-24' },
    { id: 'txn-205', date: '2024-10-12', desc: 'CARD-SWIPE UBER INDIA SYSTEMS BANGALORE', amount: 3450.00, type: 'debit', counterparty: 'Uber India Systems', ref: 'UBER-TR-881' },
    // Deliberate exact duplicate swipe within 12 hours to trigger exception!
    { id: 'txn-206-dup', date: '2024-10-12', desc: 'CARD-SWIPE UBER INDIA SYSTEMS BANGALORE', amount: 3450.00, type: 'debit', counterparty: 'Uber India Systems', ref: 'UBER-TR-882' },
    { id: 'txn-207', date: '2024-10-16', desc: 'RTGS-DB-DELL INDIA ENTERPRISE SYSTEMS', amount: 165000.00, type: 'debit', counterparty: 'Dell India Enterprise Pvt Ltd', ref: 'RTGS-DEL-99' },
    { id: 'txn-208', date: '2024-10-18', desc: 'AUTO-DEBIT AIRTEL BROADBAND FIBRE LEASED', amount: 12800.00, type: 'debit', counterparty: 'Bharti Airtel Limited', ref: 'ACH-AIR-33' },
    { id: 'txn-209', date: '2024-10-20', desc: 'CARD-DB-SLACK TECHNOLOGIES INC TEAM PLAN', amount: 24000.00, type: 'debit', counterparty: 'Slack Technologies Inc.', ref: 'SLACK-SUB-9' },
    { id: 'txn-210', date: '2024-10-24', desc: 'UPI-DB-THE BOMBAY CANTEEN CLIENT LUNCH', amount: 4850.00, type: 'debit', counterparty: 'The Bombay Canteen', ref: 'UPI-REST-12' },
    { id: 'txn-211', date: '2024-10-25', desc: 'AUTO-DEBIT RAZORPAY PLATFORM SOFTWARE CHARGES', amount: 6450.00, type: 'debit', counterparty: 'Razorpay Software Pvt Ltd', ref: 'RZP-FEE-88' },
    { id: 'txn-212', date: '2024-10-26', desc: 'CARD-SWIPE BLUEDART COURIER DOC DISPATCH', amount: 1250.00, type: 'debit', counterparty: 'BlueDart Express', ref: 'BD-EXP-77' },
    { id: 'txn-213', date: '2024-10-28', desc: 'HDFC BANK CHARGES & GST RECOVERY FOR Q3', amount: 1500.00, type: 'debit', counterparty: 'HDFC Bank Ltd', ref: 'HDFC-CHG-10' },
    { id: 'txn-214', date: '2024-10-29', desc: 'CARD-POS UNKNOWN MERCHANT POS-78912 MUMBAI', amount: 18500.00, type: 'debit', counterparty: '', ref: 'POS-UNK-78' }, // Missing counterparty!
    { id: 'txn-215', date: '2024-10-30', desc: 'NEFT-DB-CHAMBERS LEGAL CONSULTING ADVISORY', amount: 35000.00, type: 'debit', counterparty: 'Chambers Legal Advisory', ref: 'NEFT-LEG-55' }
  ];

  for (const t of rawTxns) {
    await db.query(
      `INSERT INTO transactions (
         id, org_id, bank_account_id, document_id, date, description, raw_description, 
         amount, type, counterparty, reference_number, status, is_approved
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'unreconciled', FALSE);`,
      [
        t.id,
        ORG_ID,
        'bank-hdfc-01',
        docBankId,
        t.date,
        t.desc,
        t.desc,
        t.amount,
        t.type,
        t.counterparty,
        t.ref
      ]
    );
  }

  // Initial audit log entry
  await db.query(
    `INSERT INTO audit_logs (id, org_id, user_id, user_name, action, entity_type, entity_id, explanation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
    [
      'audit-init-01',
      ORG_ID,
      'user-lead-ca',
      'Priya Sharma, FCA',
      'IMPORT_DATA',
      'dataset',
      'sandbox-oct2024',
      'Imported October 2024 realistic financial dataset: 20 transactions, 6 sales invoices, 7 vendor bills.'
    ]
  );

  // --- Seed Organization 2: Zenith Tech Labs Pvt Ltd ---
  for (const acc of DEFAULT_ACCOUNTS) {
    await db.query(
      `INSERT INTO chart_of_accounts (id, org_id, code, name, type, sub_type, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING;`,
      [`zenith-${acc.id}`, ORG_ZENITH_ID, acc.code, acc.name, acc.type, acc.sub_type, acc.description]
    );
  }

  const zenithTxns = [
    { id: 'zenith-txn-01', date: '2024-10-04', desc: 'STRIPE PAYMENTS US - SAAS SUBSCRIPTIONS OCT', amount: 185000.00, type: 'credit', counterparty: 'Stripe Payments', ref: 'STRIPE-OCT-88' },
    { id: 'zenith-txn-02', date: '2024-10-09', desc: 'POS-DB-AMAZON WEB SERVICES US EAST HOSTING', amount: 34200.00, type: 'debit', counterparty: 'Amazon Web Services India Pvt Ltd', ref: 'AWS-ZEN-01' },
    { id: 'zenith-txn-03', date: '2024-10-14', desc: 'ACH-DB-GITHUB ENTERPRISE DEVELOPER SEATS', amount: 12500.00, type: 'debit', counterparty: 'GitHub Inc', ref: 'GH-OCT-22' },
    { id: 'zenith-txn-04', date: '2024-10-18', desc: 'IMPS-CR-FOUNDER SEED CAPITAL LOAN INFUSION', amount: 500000.00, type: 'credit', counterparty: 'Rajesh Gupta', ref: 'IMPS-CAP-99' },
    { id: 'zenith-txn-05', date: '2024-10-25', desc: 'NEFT-DB-INDIABULLS TECH HUB CO-WORKING LEASE', amount: 45000.00, type: 'debit', counterparty: 'Indiabulls Co-working', ref: 'NEFT-IB-77' }
  ];

  for (const t of zenithTxns) {
    await db.query(
      `INSERT INTO transactions (
         id, org_id, bank_account_id, date, description, raw_description,
         amount, type, counterparty, reference_number, status, is_approved
       ) VALUES ($1, $2, 'bank-icici-02', $3, $4, $4, $5, $6, $7, $8, 'unreconciled', FALSE)
       ON CONFLICT (id) DO NOTHING;`,
      [t.id, ORG_ZENITH_ID, t.date, t.desc, t.amount, t.type, t.counterparty, t.ref]
    );
  }

  await db.query(
    `INSERT INTO audit_logs (id, org_id, user_id, user_name, action, entity_type, entity_id, explanation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING;`,
    [
      'zenith-audit-01',
      ORG_ZENITH_ID,
      'user-business-owner',
      'Rajesh Gupta (Founder)',
      'IMPORT_DATA',
      'dataset',
      'zenith-oct2024',
      'Seeded Zenith Tech Labs SaaS operational data: 5 transactions.'
    ]
  );
}
