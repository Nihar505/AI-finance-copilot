'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  RefreshCw,
  Upload,
  Download,
  Info,
  ArrowUpDown,
  FileText,
} from 'lucide-react';
import { UserRole } from '@/lib/auth';
import { ITCReconciliationRow, ITCSummary } from '@/lib/gstr2bEngine';

interface GSTR2BViewProps {
  currentRole?: UserRole;
  activeOrgId?: string;
  onShowToast?: (msg: string) => void;
}

const AVAILABLE_PERIODS = [
  '2024-10', '2024-09', '2024-08', '2024-07',
  '2024-06', '2024-05', '2024-04',
];

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  matched: {
    label: 'Matched',
    color: '#4ade80',
    bg: 'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.25)',
    icon: <CheckCircle2 size={13} />,
  },
  mismatched: {
    label: 'Mismatched',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.25)',
    icon: <AlertTriangle size={13} />,
  },
  missing_portal: {
    label: 'Not in Portal',
    color: '#f87171',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.25)',
    icon: <XCircle size={13} />,
  },
  missing_books: {
    label: 'Not in Books',
    color: '#60a5fa',
    bg: 'rgba(96,165,250,0.08)',
    border: 'rgba(96,165,250,0.25)',
    icon: <FileText size={13} />,
  },
};

export const GSTR2BView: React.FC<GSTR2BViewProps> = ({ currentRole = 'ca', activeOrgId = 'org-apex-01', onShowToast }) => {
  const [period, setPeriod] = useState('2024-10');
  const [rows, setRows] = useState<ITCReconciliationRow[]>([]);
  const [summary, setSummary] = useState<ITCSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'matched' | 'mismatched' | 'missing_portal' | 'missing_books'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = useCallback(async (p = period) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/gstr2b?period=${p}`, {
        headers: { 'x-org-id': activeOrgId, 'x-user-role': currentRole },
      });
      const data = await res.json();
      if (data.success) {
        setRows(data.rows || []);
        setSummary(data.summary || null);
      } else {
        onShowToast?.(`Error: ${data.error}`);
      }
    } catch (err: any) {
      onShowToast?.(`Failed to load GSTR-2B: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId, currentRole, onShowToast, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handlePeriodChange = (p: string) => {
    setPeriod(p);
    fetchData(p);
  };

  const handleClearPeriod = async () => {
    if (!confirm(`Clear all GSTR-2B entries for ${period}? The demo data will be re-seeded on next load.`)) return;
    await fetch('/api/gstr2b', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-org-id': activeOrgId, 'x-user-role': currentRole },
      body: JSON.stringify({ action: 'clear', period }),
    });
    onShowToast?.(`Cleared GSTR-2B for ${period}`);
    fetchData();
  };

  const handleExportCSV = () => {
    const headers = ['Status', 'Supplier Name', 'GSTIN', 'Invoice Number', 'Invoice Date', 'Invoice Value', 'Tax (Portal)', 'Tax (Books)', 'ITC Eligible', 'ITC Blocked', 'Reason'];
    const csvRows = rows.map(r => [
      r.status,
      r.portal?.supplier_name || r.book?.vendor_name || '',
      r.portal?.supplier_gstin || r.book?.vendor_gstin || '',
      r.portal?.invoice_number || r.book?.bill_number || '',
      r.portal?.invoice_date || r.book?.date || '',
      r.portal?.invoice_value || r.book?.total_amount || 0,
      r.portal?.total_tax || '',
      r.book?.tax_amount || '',
      r.itc_eligible.toFixed(2),
      r.itc_blocked.toFixed(2),
      r.mismatch_reason || '',
    ]);
    const csv = [headers, ...csvRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR2B_ITC_Reconciliation_${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast?.('CSV exported');
  };

  const filtered = rows.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    const name = (r.portal?.supplier_name || r.book?.vendor_name || '').toLowerCase();
    const gstin = (r.portal?.supplier_gstin || r.book?.vendor_gstin || '').toLowerCase();
    const inv = (r.portal?.invoice_number || r.book?.bill_number || '').toLowerCase();
    return name.includes(q) || gstin.includes(q) || inv.includes(q);
  });

  const fmt = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
              GSTR-2B Input Tax Credit Reconciliation
            </h1>
            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)', fontFamily: 'var(--mono)' }}>
              Section 16(2)(aa) CGST Act
            </span>
          </div>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
            Match purchase register against GSTN auto-populated supplier credit to determine eligible ITC for the period.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={period}
            onChange={e => handlePeriodChange(e.target.value)}
            className="chat-input"
            style={{ height: '34px', padding: '0 10px', fontSize: '13px', fontFamily: 'var(--mono)' }}
          >
            {AVAILABLE_PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={() => fetchData()} disabled={isLoading}>
            <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportCSV} disabled={!rows.length}>
            <Download size={13} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          <div className="panel" style={{ padding: '16px', borderColor: 'rgba(34,197,94,0.2)' }}>
            <div style={{ fontSize: '11px', color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Eligible ITC to Claim</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#4ade80', fontFamily: 'var(--mono)', marginTop: '4px' }}>{fmt(summary.total_itc_eligible)}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{summary.matched} matched invoices</div>
          </div>
          <div className="panel" style={{ padding: '16px', borderColor: summary.total_itc_blocked > 0 ? 'rgba(239,68,68,0.2)' : undefined }}>
            <div style={{ fontSize: '11px', color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ITC Blocked / At Risk</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#f87171', fontFamily: 'var(--mono)', marginTop: '4px' }}>{fmt(summary.total_itc_blocked)}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{summary.missing_portal} portal-missing invoices</div>
          </div>
          <div className="panel" style={{ padding: '16px', borderColor: summary.mismatched > 0 ? 'rgba(245,158,11,0.2)' : undefined }}>
            <div style={{ fontSize: '11px', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mismatch Risk</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#fbbf24', fontFamily: 'var(--mono)', marginTop: '4px' }}>{fmt(summary.total_itc_mismatch_risk)}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{summary.mismatched} mismatched invoices</div>
          </div>
          <div className="panel" style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Net ITC Position</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: summary.net_itc_position >= 0 ? '#4ade80' : '#f87171', fontFamily: 'var(--mono)', marginTop: '4px' }}>
              {summary.net_itc_position >= 0 ? '+' : ''}{fmt(summary.net_itc_position)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{summary.total_portal_entries} portal entries</div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div className="tab-list">
          {(['all', 'matched', 'mismatched', 'missing_portal', 'missing_books'] as const).map(s => (
            <button
              key={s}
              className={`tab-btn ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? `All (${rows.length})` :
               s === 'matched' ? `✓ Matched (${rows.filter(r => r.status === 'matched').length})` :
               s === 'mismatched' ? `⚠ Mismatched (${rows.filter(r => r.status === 'mismatched').length})` :
               s === 'missing_portal' ? `✗ Not in Portal (${rows.filter(r => r.status === 'missing_portal').length})` :
               `? Not in Books (${rows.filter(r => r.status === 'missing_books').length})`}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={13} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="chat-input"
            style={{ paddingLeft: '34px', width: '100%', height: '32px', fontSize: '12px' }}
            placeholder="Search supplier, GSTIN, invoice number..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-card-subtle)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap' }}>Status</th>
                <th style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'left' }}>Supplier / Vendor</th>
                <th style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap' }}>Invoice No.</th>
                <th style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>Invoice Value</th>
                <th style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>Tax (GST)</th>
                <th style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>ITC Eligible</th>
                <th style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>ITC Blocked</th>
                <th style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'left' }}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Reconciling GSTR-2B portal data with purchase register...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No entries match the current filters.</td></tr>
              ) : (
                filtered.map((r, idx) => {
                  const meta = STATUS_META[r.status];
                  const supplierName = r.portal?.supplier_name || r.book?.vendor_name || '—';
                  const gstin = r.portal?.supplier_gstin || r.book?.vendor_gstin || '—';
                  const invNum = r.portal?.invoice_number || r.book?.bill_number || '—';
                  const invValue = r.portal?.invoice_value ?? r.book?.total_amount ?? 0;
                  const tax = r.portal?.total_tax ?? r.book?.tax_amount ?? 0;

                  return (
                    <tr
                      key={idx}
                      style={{ borderBottom: '1px solid var(--border)', background: r.status === 'mismatched' ? 'rgba(245,158,11,0.02)' : r.status === 'missing_portal' ? 'rgba(239,68,68,0.02)' : 'transparent' }}
                    >
                      <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '10px', background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color, whiteSpace: 'nowrap' }}>
                          {meta.icon} {meta.label}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: 600, color: '#ffffff' }}>{supplierName}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: '2px' }}>{gstin}</div>
                      </td>
                      <td style={{ padding: '12px 14px', verticalAlign: 'top', fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>
                        {invNum}
                        <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                          {r.portal?.invoice_date || r.book?.date || ''}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', verticalAlign: 'top', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: '#ffffff' }}>
                        {fmt(Number(invValue))}
                        {r.status === 'mismatched' && r.amount_diff !== undefined && (
                          <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '2px' }}>
                            Δ {r.amount_diff > 0 ? '+' : ''}{fmt(r.amount_diff)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', verticalAlign: 'top', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>
                        {fmt(Number(tax))}
                      </td>
                      <td style={{ padding: '12px 14px', verticalAlign: 'top', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: '#4ade80' }}>
                        {r.itc_eligible > 0 ? fmt(r.itc_eligible) : '—'}
                      </td>
                      <td style={{ padding: '12px 14px', verticalAlign: 'top', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: r.itc_blocked > 0 ? '#f87171' : 'var(--text-dim)' }}>
                        {r.itc_blocked > 0 ? fmt(r.itc_blocked) : '—'}
                      </td>
                      <td style={{ padding: '12px 14px', verticalAlign: 'top', maxWidth: '260px' }}>
                        {r.mismatch_reason && (
                          <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{r.mismatch_reason}</p>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legal note */}
      <div style={{ marginTop: '16px', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: '10px', display: 'flex', gap: '10px' }}>
        <Info size={15} color="#a1a1aa" style={{ marginTop: '1px', flexShrink: 0 }} />
        <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', margin: 0 }}>
          <strong style={{ color: '#ffffff' }}>ITC Rule per CGST Act Section 16(2)(aa):</strong> Input Tax Credit is available only when the supplier has filed their GSTR-1 and the credit appears in the buyer's GSTR-2B. Missing entries (supplier non-filer) and mismatched amounts cannot be claimed until reconciled. Reversed ITC under Rule 42/43 not shown here.
        </p>
      </div>
    </div>
  );
};
