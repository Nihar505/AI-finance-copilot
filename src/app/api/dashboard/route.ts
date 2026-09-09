import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const orgId = auth.activeOrgId;
    const db = await getDb();

    // 1. Approved Transactions (The Ledger)
    const approvedTxnsRes = await db.query(
      `SELECT t.id, t.date, t.amount, t.type, t.counterparty, t.category_id,
              c.name as category_name, c.code as category_code, c.type as account_type, c.sub_type
       FROM transactions t
       JOIN chart_of_accounts c ON t.category_id = c.id
       WHERE t.org_id = $1 AND t.is_approved = TRUE;`,
      [orgId]
    );
    const approvedTxns = approvedTxnsRes.rows;

    // 2. All Transactions for operational metrics
    const allTxnsRes = await db.query(
      `SELECT id, amount, type, is_approved, reconciliation_status, categorization_confidence, categorization_method
       FROM transactions
       WHERE org_id = $1;`,
      [orgId]
    );
    const allTxns = allTxnsRes.rows;

    // 3. Open Exceptions
    const exceptionsRes = await db.query(
      `SELECT id, severity, exception_type FROM exceptions WHERE org_id = $1 AND status = 'open';`,
      [orgId]
    );

    // 4. Invoices & Bills
    const invoicesRes = await db.query(
      `SELECT id, total_amount, status FROM invoices WHERE org_id = $1;`,
      [orgId]
    );
    const billsRes = await db.query(
      `SELECT id, total_amount, status FROM bills WHERE org_id = $1;`,
      [orgId]
    );

    // Calculate P&L strictly from approved records
    const revenueItems: Record<string, { name: string; code: string; amount: number }> = {};
    const expenseItems: Record<string, { name: string; code: string; amount: number }> = {};

    let totalApprovedRevenue = 0;
    let totalApprovedExpenses = 0;

    for (const t of approvedTxns) {
      const amt = Number(t.amount);
      if (t.account_type === 'revenue' || t.type === 'credit') {
        totalApprovedRevenue += amt;
        const catKey = t.category_id || 'other-rev';
        if (!revenueItems[catKey]) {
          revenueItems[catKey] = { name: t.category_name || 'Operating Revenue', code: t.category_code || '4000', amount: 0 };
        }
        revenueItems[catKey].amount += amt;
      } else if (t.account_type === 'expense' || t.type === 'debit') {
        totalApprovedExpenses += amt;
        const catKey = t.category_id || 'other-exp';
        if (!expenseItems[catKey]) {
          expenseItems[catKey] = { name: t.category_name || 'General Expense', code: t.category_code || '5000', amount: 0 };
        }
        expenseItems[catKey].amount += amt;
      }
    }

    const netIncome = totalApprovedRevenue - totalApprovedExpenses;

    // Balance Sheet (Assets, Liabilities, Equity)
    const bankRes = await db.query(
      `SELECT opening_balance FROM bank_accounts WHERE org_id = $1 LIMIT 1;`,
      [orgId]
    );
    const openingBal = Number(bankRes.rows[0]?.opening_balance || 1000000);
    const currentBankBalance = openingBal + totalApprovedRevenue - totalApprovedExpenses;

    // Accounts Receivable = Unpaid Invoices total
    const accountsReceivable = invoicesRes.rows
      .filter(i => i.status !== 'paid')
      .reduce((sum, i) => sum + Number(i.total_amount), 0);

    // Accounts Payable = Unpaid Bills total
    const accountsPayable = billsRes.rows
      .filter(b => b.status !== 'paid')
      .reduce((sum, b) => sum + Number(b.total_amount), 0);

    const totalAssets = currentBankBalance + accountsReceivable;
    const totalLiabilities = accountsPayable;
    const initialEquity = openingBal;
    const accrualRevenue = totalApprovedRevenue + accountsReceivable;
    const accrualExpenses = totalApprovedExpenses + accountsPayable;
    const retainedEarnings = accrualRevenue - accrualExpenses;
    const totalEquity = initialEquity + retainedEarnings;

    // Cash Flow Summary (Direct Cash Method from approved transactions)
    const cashFlow = {
      operatingInflows: totalApprovedRevenue,
      operatingOutflows: totalApprovedExpenses,
      netCashFlow: totalApprovedRevenue - totalApprovedExpenses,
      startingCash: openingBal,
      endingCash: currentBankBalance
    };

    // Operational KPIs
    const pendingApprovalCount = allTxns.filter(t => !t.is_approved).length;
    const unreconciledTxns = allTxns.filter(t => t.reconciliation_status === 'unreconciled');
    const unreconciledTotal = unreconciledTxns.reduce((sum, t) => sum + Number(t.amount), 0);
    const suggestedMatchCount = allTxns.filter(t => t.reconciliation_status === 'suggested_match').length;

    return NextResponse.json({
      success: true,
      orgId,
      orgName: auth.activeOrgName,
      kpis: {
        approvedRevenue: totalApprovedRevenue,
        approvedExpenses: totalApprovedExpenses,
        netIncome,
        currentBankBalance,
        totalTransactions: allTxns.length,
        approvedCount: approvedTxns.length,
        pendingApprovalCount,
        unreconciledCount: unreconciledTxns.length,
        unreconciledTotal,
        suggestedMatchCount,
        openExceptionsCount: exceptionsRes.rows.length,
        criticalExceptionsCount: exceptionsRes.rows.filter(e => e.severity === 'critical').length
      },
      pnl: {
        revenueList: Object.values(revenueItems),
        expenseList: Object.values(expenseItems),
        totalRevenue: totalApprovedRevenue,
        totalExpenses: totalApprovedExpenses,
        netIncome
      },
      balanceSheet: {
        assets: {
          cashAndBank: currentBankBalance,
          accountsReceivable,
          total: totalAssets
        },
        liabilities: {
          accountsPayable,
          total: totalLiabilities
        },
        equity: {
          capital: initialEquity,
          retainedEarnings,
          total: totalEquity
        },
        inBalance: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1000
      },
      cashFlow
    });
  } catch (error: any) {
    console.error('Dashboard API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
