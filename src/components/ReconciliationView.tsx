import React, { useState } from 'react';
import { 
  GitCompare, 
  ArrowRight, 
  CheckCircle2, 
  FileText, 
  CreditCard
} from 'lucide-react';

interface ReconciliationViewProps {
  reconciliationData: {
    matches: any[];
    unmatched: any[];
  };
  onApproveMatch: (transactionId: string) => Promise<void>;
  isLoading: boolean;
}

export const ReconciliationView: React.FC<ReconciliationViewProps> = ({
  reconciliationData,
  onApproveMatch,
  isLoading
}) => {
  const [subTab, setSubTab] = useState<'matches' | 'unmatched'>('matches');

  const { matches = [], unmatched = [] } = reconciliationData;
  const matchRate = (matches.length + unmatched.length) > 0 
    ? Math.round((matches.length / (matches.length + unmatched.length)) * 100) 
    : 0;

  const formatCurrency = (val: number) => {
    return '₹' + Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
            Reconciliation &amp; Matching Matrix
          </h1>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Multi-factor matching: Pairing bank transactions with sales invoices and vendor bills by amount, party, date proximity, and reference.
          </p>
        </div>

        <div className="tab-list">
          <button 
            className={`tab-btn ${subTab === 'matches' ? 'active' : ''}`}
            onClick={() => setSubTab('matches')}
          >
            Suggested &amp; Matched Pairs ({matches.length})
          </button>
          <button 
            className={`tab-btn ${subTab === 'unmatched' ? 'active' : ''}`}
            onClick={() => setSubTab('unmatched')}
          >
            Unreconciled Queue ({unmatched.length})
          </button>
        </div>
      </div>

      {/* Overview Stats (Monochrome) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '20px' }}>
        <div className="widget-card">
          <div className="widget-label">Match Rate</div>
          <div className="widget-hero-value" style={{ marginTop: '8px' }}>
            {matchRate}%
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {matches.length} matched out of {matches.length + unmatched.length} total
          </div>
        </div>

        <div className="widget-card">
          <div className="widget-label">Suggested Matches</div>
          <div className="widget-hero-value" style={{ marginTop: '8px' }}>
            {matches.filter(m => m.status === 'suggested').length}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Awaiting human confirmation
          </div>
        </div>

        <div className="widget-card">
          <div className="widget-label">Unmatched Balance</div>
          <div className="widget-hero-value" style={{ marginTop: '8px' }}>
            {formatCurrency(unmatched.reduce((s, u) => s + Number(u.amount), 0))}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Requires document creation
          </div>
        </div>
      </div>

      {/* Tab 1: Matched Pairs */}
      {subTab === 'matches' && (
        <div>
          {matches.length === 0 ? (
            <div className="panel" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <GitCompare size={36} color="#ffffff" style={{ margin: '0 auto 12px auto' }} />
              <h3 style={{ fontSize: '15px', color: '#ffffff', fontWeight: 600 }}>No Matched Records Found</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginTop: '4px' }}>
                Run the pipeline or upload statements and bills to perform automated transaction-to-document matching.
              </p>
            </div>
          ) : (
            matches.map((m) => {
              const isApproved = m.status === 'approved';
              const conf = Number(m.match_confidence || 0);
              const isCredit = m.transaction_type === 'credit';

              return (
                <div key={m.id} className="panel" style={{ marginBottom: '14px', padding: '18px 20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr auto 1.2fr auto', gap: '16px', alignItems: 'center' }}>
                    {/* Left: Bank Transaction */}
                    <div style={{ background: '#141418', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <CreditCard size={13} color="#ffffff" />
                        <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Bank Entry (#{m.transaction_id})
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                          {new Date(m.transaction_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#ffffff' }}>
                        {m.transaction_counterparty || 'Counterparty Unknown'}
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--mono)', marginTop: '2px' }}>
                        {m.transaction_desc}
                      </div>
                      {/* Amount: ONLY green or red */}
                      <div 
                        className={isCredit ? 'amount-positive' : 'amount-negative'}
                        style={{ fontSize: '14px', fontWeight: 700, marginTop: '6px' }}
                      >
                        {isCredit ? '+' : '−'}{formatCurrency(m.transaction_amount)}
                      </div>
                    </div>

                    {/* Center: Match Confidence Arrow */}
                    <div style={{ textAlign: 'center', padding: '0 8px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#ffffff', fontFamily: 'var(--mono)' }}>
                        {conf}% MATCH
                      </div>
                      <ArrowRight size={18} color="#ffffff" style={{ margin: '4px auto' }} />
                      <span className={`pill ${isApproved ? 'pill-approved' : 'pill-pending'}`} style={{ fontSize: '9.5px' }}>
                        {isApproved ? 'Confirmed' : 'Suggested'}
                      </span>
                    </div>

                    {/* Right: Matched Document (Invoice/Bill) */}
                    <div style={{ background: '#141418', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <FileText size={13} color="#ffffff" />
                        <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          {m.matched_entity_type === 'invoice' ? 'Sales Invoice' : 'Vendor Payable Bill'}
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                          {new Date(m.document_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#ffffff' }}>
                        {m.document_counterparty}
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--mono)', marginTop: '2px' }}>
                        Doc Ref: #{m.document_number}
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--mono)', color: '#ffffff', marginTop: '6px' }}>
                        {formatCurrency(m.document_amount)}
                      </div>
                    </div>

                    {/* Action */}
                    <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '8px' }}>
                      {!isApproved ? (
                        <button 
                          className="btn btn-primary btn-sm"
                          onClick={() => onApproveMatch(m.transaction_id)}
                          disabled={isLoading}
                        >
                          <CheckCircle2 size={12} />
                          <span>Approve</span>
                        </button>
                      ) : (
                        <span className="pill pill-approved">
                          <CheckCircle2 size={11} /> Settled
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Plain Language Grounded Match Reasoning */}
                  <div 
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-sm)',
                      padding: '8px 12px',
                      fontSize: '11.5px',
                      color: 'var(--text-secondary)',
                      marginTop: '10px',
                    }}
                  >
                    <strong style={{ color: '#ffffff', marginRight: '6px' }}>Match Logic:</strong> {m.match_reasoning}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab 2: Unreconciled Queue */}
      {subTab === 'unmatched' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Unreconciled Bank Transactions Queue</h2>
              <p className="panel-subtitle">Items lacking a matching sales invoice or vendor bill</p>
            </div>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>ID</th>
                  <th>Counterparty</th>
                  <th>Narration</th>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      All loaded bank transactions are successfully reconciled.
                    </td>
                  </tr>
                ) : (
                  unmatched.map((u) => {
                    const isCredit = u.type === 'credit';
                    return (
                      <tr key={u.id}>
                        <td>{new Date(u.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>#{u.id}</td>
                        <td style={{ fontWeight: 600, color: '#ffffff' }}>{u.counterparty || 'Unknown'}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '11.5px' }}>{u.description}</td>
                        <td>
                          <span className="pill pill-rule">{u.category_name || 'Pending'}</span>
                        </td>
                        <td style={{ textAlign: 'right' }} className={isCredit ? 'amount-positive' : 'amount-negative'}>
                          {isCredit ? '+' : '−'}{formatCurrency(u.amount)}
                        </td>
                        <td>
                          <span className="pill pill-pending">Unreconciled</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
