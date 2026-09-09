import React, { useState } from 'react';
import {
  TrendingUp,
  ArrowUpRight,
  FileText,
  Scale,
  GitMerge,
  ArrowRight,
  Filter,
  CheckCircle2,
  Clock,
  AlertOctagon,
  Copy,
  Maximize2
} from 'lucide-react';
import { ActiveTab } from './Sidebar';

interface DashboardViewProps {
  data: any;
  transactions?: any[];
  onNavigate: (tab: ActiveTab) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  data,
  transactions = [],
  onNavigate,
}) => {
  const [stmtTab, setStmtTab] = useState<'pnl' | 'balanceSheet' | 'cashFlow'>('pnl');
  const [txnFilter, setTxnFilter] = useState<'all' | 'inflow' | 'outflow'>('all');

  const kpis = data?.kpis ?? {
    approvedRevenue: 14500,
    approvedExpenses: 878350,
    netIncome: -863850,
    currentBankBalance: 636150,
    totalTransactions: 20,
    approvedCount: 12,
    pendingApprovalCount: 8,
    unreconciledCount: 10,
    unreconciledTotal: 425000,
    openExceptionsCount: 8,
    criticalExceptionsCount: 2,
  };

  const pnl = data?.pnl ?? {
    revenueList: [{ code: '4090', name: 'Bank Interest & Other Income', amount: 14500 }],
    expenseList: [
      { code: '5010', name: 'Cloud Infrastructure & Servers', amount: 42500 },
      { code: '5020', name: 'SaaS Subscriptions & Software', amount: 18400 },
      { code: '5040', name: 'Office Rent & Maintenance', amount: 115000 },
      { code: '1500', name: 'Office Equipment & Computers', amount: 165000 },
      { code: '5080', name: 'Internet, Telecom & Utilities', amount: 12800 },
      { code: '5060', name: 'Local Conveyance & Travel', amount: 3450 },
      { code: '5000', name: 'Staff Salaries & Benefits', amount: 480000 },
      { code: '5090', name: 'Bank Charges & Payment Fees', amount: 41200 },
    ],
    totalRevenue: 14500,
    totalExpenses: 878350,
    netIncome: -863850,
  };

  const bs = data?.balanceSheet ?? {
    assets: { cashAndBank: 636150, accountsReceivable: 750000, total: 1386150 },
    liabilities: { accountsPayable: 183400, total: 183400 },
    equity: { capital: 2000000, retainedEarnings: -797250, total: 1202750 },
    inBalance: true,
  };

  const cf = data?.cashFlow ?? {
    operatingInflows: 14500,
    operatingOutflows: 878350,
    netCashFlow: -863850,
    startingCash: 1500000,
    endingCash: 636150,
  };

  // Currency formatters
  const fmt = (v: number) =>
    '₹' + Math.abs(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const fmtF = (v: number) =>
    '₹' + Math.abs(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Filtered transactions for stream
  const filteredTxns = transactions.filter((t) => {
    if (txnFilter === 'inflow') return t.type === 'credit';
    if (txnFilter === 'outflow') return t.type === 'debit';
    return true;
  });

  const displayTxns = filteredTxns.length > 0 ? filteredTxns.slice(0, 6) : [
    { id: '1', date: '2024-10-02', counterparty: 'Amazon Web Services', category_name: 'Cloud Infrastructure', type: 'debit', amount: 42500, is_approved: true },
    { id: '2', date: '2024-10-03', counterparty: 'Zenith FinTech Solutions', category_name: 'Sales Revenue', type: 'credit', amount: 250000, is_approved: true },
    { id: '3', date: '2024-10-05', counterparty: 'WeWork India Management', category_name: 'Office Rent', type: 'debit', amount: 115000, is_approved: true },
    { id: '4', date: '2024-10-10', counterparty: 'Staff Payroll Services', category_name: 'Salaries & Wages', type: 'debit', amount: 480000, is_approved: true },
    { id: '5', date: '2024-10-12', counterparty: 'Uber India Systems', category_name: 'Conveyance & Travel', type: 'debit', amount: 3450, is_approved: false },
    { id: '6', date: '2024-10-14', counterparty: 'Dell Enterprise India', category_name: 'Equipment & Computers', type: 'debit', amount: 165000, is_approved: true },
  ];

  const approvalRate = kpis.totalTransactions > 0
    ? Math.round((kpis.approvedCount / kpis.totalTransactions) * 100)
    : 60;

  return (
    <div>
      {/* ── Pending Alert Banner (Monochromatic) ── */}
      {kpis.pendingApprovalCount > 0 && (
        <div className="alert-banner" style={{ marginBottom: '18px' }}>
          <div className="alert-banner-body">
            <Clock size={16} color="#ffffff" />
            <div>
              <div className="alert-banner-title">
                {kpis.pendingApprovalCount} Transactions Pending CA Approval Gate
              </div>
              <div className="alert-banner-sub">
                Rules &amp; AI suggestions are buffered. Financial ledger reflects only verified entries.
              </div>
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onNavigate('review')}
          >
            <span>Review Queue ({kpis.pendingApprovalCount})</span>
            <ArrowRight size={12} />
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          TOP ROW: 3 HERO WIDGETS (Matching Reference Design)
         ═══════════════════════════════════════════════════════════════ */}
      <div className="dash-top-grid">

        {/* ── Widget 1: Total Bank Balance & Area Trend ── */}
        <div className="widget-card">
          <div className="widget-header">
            <div className="widget-label">Total Bank Balance</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Copy size={13} className="widget-action-icon" aria-label="Copy Account Details" />
              <Maximize2 size={13} className="widget-action-icon" aria-label="Expand View" />
            </div>
          </div>

          <div className="widget-hero-value">
            {fmt(kpis.currentBankBalance)}
            <span className="widget-currency-tag">INR</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
            <span className="widget-badge">
              HDFC Bank ····8492
            </span>
            <span style={{ fontSize: '11.5px', color: 'var(--green)', fontWeight: 600 }}>
              +12.56% ↗
            </span>
          </div>

          {/* Smooth SVG Area Sparkline Chart (Monochromatic White Gradient) */}
          <div style={{ marginTop: '20px', width: '100%', height: '110px' }}>
            <svg viewBox="0 0 320 100" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
              <defs>
                <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.20" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {/* Fill area */}
              <path
                d="M 0,82 C 40,82 70,88 100,75 C 130,62 160,84 190,74 C 230,60 260,20 290,28 C 305,32 315,22 320,16 L 320,100 L 0,100 Z"
                fill="url(#balanceGrad)"
              />
              {/* Curve Line */}
              <path
                d="M 0,82 C 40,82 70,88 100,75 C 130,62 160,84 190,74 C 230,60 260,20 290,28 C 305,32 315,22 320,16"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              {/* Active data point */}
              <circle cx="320" cy="16" r="3.5" fill="#ffffff" stroke="#000000" strokeWidth="1.5" />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px' }}>
              <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
            </div>
          </div>
        </div>

        {/* ── Widget 2: Spending Breakdown (Multi-Arc Ring Visualization) ── */}
        <div className="widget-card">
          <div className="widget-header">
            <div className="widget-label">Top Operating Spending</div>
            <ArrowUpRight size={14} className="widget-action-icon" />
          </div>

          {/* Semi-Circle Concentric Arc Graphic */}
          <div style={{ position: 'relative', width: '100%', height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 220 120" style={{ width: '210px', height: '115px' }}>
              {/* Arc 1: Largest (Payroll & Facilities) */}
              <path
                d="M 20,115 A 90,90 0 0,1 200,115"
                fill="none"
                stroke="rgba(255, 255, 255, 0.12)"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M 20,115 A 90,90 0 0,1 185,85"
                fill="none"
                stroke="#ffffff"
                strokeWidth="8"
                strokeLinecap="round"
              />

              {/* Arc 2: Equipment & Tech */}
              <path
                d="M 42,115 A 68,68 0 0,1 178,115"
                fill="none"
                stroke="rgba(255, 255, 255, 0.10)"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M 42,115 A 68,68 0 0,1 155,75"
                fill="none"
                stroke="rgba(255, 255, 255, 0.65)"
                strokeWidth="8"
                strokeLinecap="round"
              />

              {/* Arc 3: Cloud & SaaS */}
              <path
                d="M 64,115 A 46,46 0 0,1 156,115"
                fill="none"
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M 64,115 A 46,46 0 0,1 135,82"
                fill="none"
                stroke="rgba(255, 255, 255, 0.35)"
                strokeWidth="8"
                strokeLinecap="round"
              />
            </svg>

            {/* Total Expense in Center */}
            <div style={{ position: 'absolute', bottom: '0px', textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                {fmt(kpis.approvedExpenses)}
              </div>
              <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
                Disbursements
              </div>
            </div>
          </div>

          {/* Breakdown Legend (Monochrome Dots & Labels) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ffffff' }} />
              <span>Payroll: ₹4.80L</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'rgba(255,255,255,0.65)' }} />
              <span>Equipment: ₹1.65L</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'rgba(255,255,255,0.35)' }} />
              <span>Rent: ₹1.15L</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
              <span>Cloud: ₹42.5K</span>
            </div>
          </div>
        </div>

        {/* ── Widget 3: Compliance & Control Center (Inspired by Cards in Reference) ── */}
        <div className="widget-card">
          <div className="widget-header">
            <div className="widget-label">Compliance &amp; Controls</div>
            <ArrowUpRight size={14} className="widget-action-icon" />
          </div>

          {/* Mini Card Surface */}
          <div
            style={{
              background: '#15151a',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--r-lg)',
              padding: '16px',
              marginBottom: '14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                CA Approval Progress
              </span>
              <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#ffffff' }}>
                {approvalRate}%
              </span>
            </div>

            {/* Progress Bar */}
            <div className="progress-track" style={{ marginBottom: '12px' }}>
              <div className="progress-fill" style={{ width: `${approvalRate}%` }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
              <span>{kpis.approvedCount} Approved</span>
              <span>{kpis.totalTransactions - kpis.approvedCount} Pending</span>
            </div>
          </div>

          {/* Quick Metrics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--white-4)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertOctagon size={13} color="#ffffff" />
                <span style={{ color: 'var(--text-secondary)' }}>Open Exceptions</span>
              </div>
              <span style={{ fontWeight: 700, color: '#ffffff' }}>
                {kpis.openExceptionsCount} ({kpis.criticalExceptionsCount} critical)
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--white-4)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <GitMerge size={13} color="#ffffff" />
                <span style={{ color: 'var(--text-secondary)' }}>Reconciliation Queue</span>
              </div>
              <span style={{ fontWeight: 700, color: '#ffffff' }}>
                {kpis.unreconciledCount} unmatched
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1 }}
              onClick={() => onNavigate('review')}
            >
              Review Queue
            </button>
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1 }}
              onClick={() => onNavigate('reconciliation')}
            >
              Reconcile
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          BOTTOM SECTION: 2 COLUMNS (Statements & Live Transactions)
         ═══════════════════════════════════════════════════════════════ */}
      <div className="dash-bottom-grid">

        {/* ── Left Column: Deterministic Financial Statements ── */}
        <div className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">Deterministic Financial Statements</div>
              <div className="panel-subtitle">Computed strictly from approved ledger transactions</div>
            </div>

            {/* Statement Tabs */}
            <div className="tab-list">
              <button
                className={`tab-btn ${stmtTab === 'pnl' ? 'active' : ''}`}
                onClick={() => setStmtTab('pnl')}
              >
                <FileText size={12} /> P&amp;L
              </button>
              <button
                className={`tab-btn ${stmtTab === 'balanceSheet' ? 'active' : ''}`}
                onClick={() => setStmtTab('balanceSheet')}
              >
                <Scale size={12} /> Balance Sheet
              </button>
              <button
                className={`tab-btn ${stmtTab === 'cashFlow' ? 'active' : ''}`}
                onClick={() => setStmtTab('cashFlow')}
              >
                <GitMerge size={12} /> Cash Flow
              </button>
            </div>
          </div>

          {/* P&L Statement */}
          {stmtTab === 'pnl' && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '80px' }}>Code</th>
                    <th>Category Description</th>
                    <th style={{ width: '160px', textAlign: 'right' }}>Amount (INR)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Revenue Header (Monochrome) */}
                  <tr style={{ background: 'rgba(255, 255, 255, 0.03)' }}>
                    <td colSpan={2} style={{ fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#ffffff' }}>
                      Revenue &amp; Inflows
                    </td>
                    <td style={{ textAlign: 'right' }} className="amount-positive">
                      +{fmtF(pnl.totalRevenue)}
                    </td>
                  </tr>
                  {pnl.revenueList.map((item: any, i: number) => (
                    <tr key={i}>
                      <td className="font-mono text-muted">{item.code}</td>
                      <td style={{ color: 'var(--text-primary)' }}>{item.name}</td>
                      <td className="amount-positive" style={{ textAlign: 'right' }}>
                        +{fmtF(item.amount)}
                      </td>
                    </tr>
                  ))}

                  {/* Expenses Header (Monochrome) */}
                  <tr style={{ background: 'rgba(255, 255, 255, 0.03)' }}>
                    <td colSpan={2} style={{ fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#ffffff' }}>
                      Operating Expenses
                    </td>
                    <td style={{ textAlign: 'right' }} className="amount-negative">
                      −{fmtF(pnl.totalExpenses)}
                    </td>
                  </tr>
                  {pnl.expenseList.slice(0, 5).map((item: any, i: number) => (
                    <tr key={i}>
                      <td className="font-mono text-muted">{item.code}</td>
                      <td style={{ color: 'var(--text-primary)' }}>{item.name}</td>
                      <td className="amount-negative" style={{ textAlign: 'right' }}>
                        −{fmtF(item.amount)}
                      </td>
                    </tr>
                  ))}

                  {/* Net Operating Income Row */}
                  <tr style={{ background: 'rgba(255, 255, 255, 0.04)', fontWeight: 700 }}>
                    <td colSpan={2} style={{ color: '#ffffff', fontSize: '13px' }}>
                      Net Operating Income / (Loss)
                    </td>
                    <td
                      style={{ textAlign: 'right', fontSize: '13px' }}
                      className={pnl.netIncome >= 0 ? 'amount-positive' : 'amount-negative'}
                    >
                      {pnl.netIncome < 0 ? '−' : '+'}{fmtF(pnl.netIncome)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Balance Sheet Statement */}
          {stmtTab === 'balanceSheet' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th colSpan={2}>Assets</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Cash &amp; Bank (HDFC ····8492)</td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-white">{fmtF(bs.assets.cashAndBank)}</td>
                    </tr>
                    <tr>
                      <td>Accounts Receivable</td>
                      <td style={{ textAlign: 'right' }} className="amount-positive">+{fmtF(bs.assets.accountsReceivable)}</td>
                    </tr>
                    <tr style={{ fontWeight: 700, background: 'rgba(255,255,255,0.03)' }}>
                      <td style={{ color: '#ffffff' }}>Total Assets</td>
                      <td style={{ textAlign: 'right', color: '#ffffff' }} className="font-mono">{fmtF(bs.assets.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th colSpan={2}>Liabilities &amp; Equity</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Accounts Payable</td>
                      <td style={{ textAlign: 'right' }} className="amount-negative">−{fmtF(bs.liabilities.accountsPayable)}</td>
                    </tr>
                    <tr>
                      <td>Partners' Capital</td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-white">{fmtF(bs.equity.capital)}</td>
                    </tr>
                    <tr>
                      <td>Retained Earnings</td>
                      <td style={{ textAlign: 'right' }} className={bs.equity.retainedEarnings >= 0 ? 'amount-positive' : 'amount-negative'}>
                        {bs.equity.retainedEarnings < 0 ? '−' : '+'}{fmtF(bs.equity.retainedEarnings)}
                      </td>
                    </tr>
                    <tr style={{ fontWeight: 700, background: 'rgba(255,255,255,0.03)' }}>
                      <td style={{ color: '#ffffff' }}>Total Liab. &amp; Equity</td>
                      <td style={{ textAlign: 'right', color: '#ffffff' }} className="font-mono">{fmtF(bs.liabilities.total + bs.equity.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cash Flow Statement */}
          {stmtTab === 'cashFlow' && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cash Flow Activity</th>
                    <th style={{ width: '180px', textAlign: 'right' }}>Amount (INR)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Operating Inflows (Customer Receipts)</td>
                    <td style={{ textAlign: 'right' }} className="amount-positive">+{fmtF(cf.operatingInflows)}</td>
                  </tr>
                  <tr>
                    <td>Operating Outflows (Vendor Disbursements)</td>
                    <td style={{ textAlign: 'right' }} className="amount-negative">−{fmtF(cf.operatingOutflows)}</td>
                  </tr>
                  <tr style={{ fontWeight: 700 }}>
                    <td style={{ color: '#ffffff' }}>Net Operating Cash Flow</td>
                    <td style={{ textAlign: 'right' }} className={cf.netCashFlow >= 0 ? 'amount-positive' : 'amount-negative'}>
                      {cf.netCashFlow < 0 ? '−' : '+'}{fmtF(cf.netCashFlow)}
                    </td>
                  </tr>
                  <tr>
                    <td>Opening Cash Position</td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-white">{fmtF(cf.startingCash)}</td>
                  </tr>
                  <tr style={{ fontWeight: 700, background: 'rgba(255,255,255,0.03)' }}>
                    <td style={{ color: '#ffffff' }}>Closing Bank Cash Position</td>
                    <td style={{ textAlign: 'right', color: '#ffffff' }} className="font-mono">{fmtF(cf.endingCash)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Right Column: Live Transaction History (Matching Reference Layout) ── */}
        <div className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">Transaction History</div>
              <div className="panel-subtitle">Feed from bank statement &amp; ledger</div>
            </div>

            {/* Inflow / Outflow Filter Pills */}
            <div className="tab-list">
              <button
                className={`tab-btn ${txnFilter === 'all' ? 'active' : ''}`}
                onClick={() => setTxnFilter('all')}
              >
                All
              </button>
              <button
                className={`tab-btn ${txnFilter === 'inflow' ? 'active' : ''}`}
                onClick={() => setTxnFilter('inflow')}
              >
                Inflows
              </button>
              <button
                className={`tab-btn ${txnFilter === 'outflow' ? 'active' : ''}`}
                onClick={() => setTxnFilter('outflow')}
              >
                Outflows
              </button>
            </div>
          </div>

          {/* List of Transactions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {displayTxns.map((t, idx) => {
              const isCredit = t.type === 'credit';
              const initials = (t.counterparty || 'TX')
                .split(' ')
                .map((w: string) => w[0])
                .slice(0, 2)
                .join('')
                .toUpperCase();

              return (
                <div
                  key={t.id || idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 'var(--r-md)',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border)',
                    transition: 'background 0.12s ease',
                  }}
                >
                  {/* Left: Avatar & Details */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: '#18181b',
                        border: '1px solid var(--border-strong)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        fontWeight: 700,
                        color: '#ffffff',
                      }}
                    >
                      {initials}
                    </div>

                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#ffffff' }}>
                        {t.counterparty || 'Counterparty Unassigned'}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · {t.category_name || 'Operating Expense'}
                      </div>
                    </div>
                  </div>

                  {/* Right: Status & Colored Amount */}
                  <div style={{ textAlign: 'right' }}>
                    <div
                      className={isCredit ? 'amount-positive' : 'amount-negative'}
                      style={{ fontSize: '13px', fontWeight: 600 }}
                    >
                      {isCredit ? '+' : '−'}{fmtF(t.amount)}
                    </div>
                    <div>
                      {t.is_approved ? (
                        <span className="pill pill-approved" style={{ fontSize: '9px', padding: '1px 6px' }}>
                          Approved
                        </span>
                      ) : (
                        <span className="pill pill-pending" style={{ fontSize: '9px', padding: '1px 6px' }}>
                          Pending CA
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: '14px', textAlign: 'center' }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: '100%' }}
              onClick={() => onNavigate('review')}
            >
              <span>View All Transactions in Review Queue →</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
