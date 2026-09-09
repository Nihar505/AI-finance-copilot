import React, { useState } from 'react';
import { 
  Check, 
  X, 
  Edit3, 
  Zap, 
  Bot, 
  CheckCircle2, 
  FileCheck, 
  Search,
  Sparkles
} from 'lucide-react';

import { UserRole } from '@/lib/auth';

interface ReviewQueueViewProps {
  transactions: any[];
  accounts: any[];
  currentRole?: UserRole;
  materialityThreshold?: number;
  onApprove: (id: string, notes?: string) => Promise<void>;
  onOverride: (id: string, newCategoryId: string, notes?: string) => Promise<void>;
  onReject: (id: string, notes?: string) => Promise<void>;
  onBatchApprove: () => Promise<void>;
  isLoading: boolean;
}

export const ReviewQueueView: React.FC<ReviewQueueViewProps> = ({
  transactions,
  accounts,
  currentRole = 'ca',
  materialityThreshold = 50000,
  onApprove,
  onOverride,
  onReject,
  onBatchApprove,
  isLoading
}) => {
  const isOwner = currentRole === 'business_owner';
  const [filter, setFilter] = useState<'pending' | 'high_conf' | 'rule' | 'ai' | 'approved' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [overrideModalTxn, setOverrideModalTxn] = useState<any | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [overrideNotes, setOverrideNotes] = useState('');

  // Filter transactions
  const filtered = transactions.filter((t) => {
    const textMatch = 
      t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.counterparty || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.category_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.reference_number || '').toLowerCase().includes(searchQuery.toLowerCase());

    if (!textMatch) return false;

    if (filter === 'pending') return !t.is_approved;
    if (filter === 'approved') return t.is_approved;
    if (filter === 'high_conf') return !t.is_approved && Number(t.categorization_confidence) >= 85;
    if (filter === 'rule') return t.categorization_method === 'rule';
    if (filter === 'ai') return t.categorization_method === 'ai';
    return true;
  });

  const pendingCount = transactions.filter(t => !t.is_approved).length;
  const highConfPending = transactions.filter(t => !t.is_approved && Number(t.categorization_confidence) >= 85).length;

  const handleOpenOverride = (txn: any) => {
    setOverrideModalTxn(txn);
    setSelectedAccount(txn.category_id || accounts[0]?.id || '');
    setOverrideNotes('');
  };

  const submitOverride = async () => {
    if (!overrideModalTxn || !selectedAccount) return;
    await onOverride(overrideModalTxn.id, selectedAccount, overrideNotes);
    setOverrideModalTxn(null);
  };

  const formatCurrency = (val: number) => {
    return '₹' + Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  };

  return (
    <div>
      {/* Business Owner Segregation of Duties Banner */}
      {isOwner && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '18px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span style={{ fontSize: '18px' }}>🔒</span>
          <div>
            <strong style={{ color: '#ffffff', fontSize: '12.5px' }}>
              Business Owner Mode (Reviewer Segregation of Duties)
            </strong>
            <p style={{ color: '#a1a1aa', fontSize: '11.5px', margin: '2px 0 0 0' }}>
              Under Indian Chartered Accountant compliance standards and Internal Financial Controls (ICFR), consequential ledger approvals and categorization overrides require a licensed Chartered Accountant. Approvals are disabled in this view. Switch to the CA persona to approve.
            </p>
          </div>
        </div>
      )}

      {/* Top Header & Batch Action */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
            Chartered Accountant Review Queue
          </h1>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Human-in-the-loop approval gate: Review proposed rules and AI categorizations before ledger posting.
          </p>
        </div>

        {highConfPending > 0 && !isOwner && (
          <button 
            className="btn btn-primary btn-sm" 
            onClick={onBatchApprove}
            disabled={isLoading || isOwner}
            title={`Batch approve high confidence items below materiality limit (₹${materialityThreshold.toLocaleString()})`}
          >
            <Sparkles size={13} />
            <span>Batch Approve High Confidence ({highConfPending})</span>
          </button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap' }}>
        <div className="tab-list">
          <button 
            className={`tab-btn ${filter === 'pending' ? 'active' : ''}`}
            onClick={() => setFilter('pending')}
          >
            Pending ({pendingCount})
          </button>
          <button 
            className={`tab-btn ${filter === 'high_conf' ? 'active' : ''}`}
            onClick={() => setFilter('high_conf')}
          >
            High Conf ({highConfPending})
          </button>
          <button 
            className={`tab-btn ${filter === 'rule' ? 'active' : ''}`}
            onClick={() => setFilter('rule')}
          >
            Rules
          </button>
          <button 
            className={`tab-btn ${filter === 'ai' ? 'active' : ''}`}
            onClick={() => setFilter('ai')}
          >
            AI Assisted
          </button>
          <button 
            className={`tab-btn ${filter === 'approved' ? 'active' : ''}`}
            onClick={() => setFilter('approved')}
          >
            Approved
          </button>
          <button 
            className={`tab-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({transactions.length})
          </button>
        </div>

        <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
          <Search size={13} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text"
            className="chat-input"
            style={{ paddingLeft: '34px', width: '100%', height: '34px' }}
            placeholder="Search narration, counterparty, account..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Review Queue Cards */}
      {filtered.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <CheckCircle2 size={36} color="#ffffff" style={{ margin: '0 auto 12px auto' }} />
          <h3 style={{ fontSize: '15px', color: '#ffffff', fontWeight: 600 }}>Review Queue Cleared</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginTop: '4px' }}>
            No transactions match the selected filter. Load the sandbox dataset or upload statements to process new transactions.
          </p>
        </div>
      ) : (
        filtered.map((t) => {
          const isRule = t.categorization_method === 'rule';
          const isCredit = t.type === 'credit';
          const confidence = Number(t.categorization_confidence || 0);

          return (
            <div 
              key={t.id} 
              className={`review-card ${t.is_approved ? 'approved' : 'pending'}`}
            >
              <div className="review-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    #{t.id}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  {t.is_approved ? (
                    <span className="pill pill-approved">
                      <Check size={11} /> Approved
                    </span>
                  ) : (
                    <span className="pill pill-pending">
                      Pending CA
                    </span>
                  )}
                  {t.matched_document_number && (
                    <span className="pill pill-rule">
                      <FileCheck size={11} /> Matched: {t.matched_document_number} ({t.match_confidence}%)
                    </span>
                  )}
                  {Number(t.amount) >= materialityThreshold && (
                    <span 
                      style={{ 
                        fontSize: '10.5px', 
                        padding: '2px 8px', 
                        borderRadius: '12px', 
                        background: 'rgba(234, 179, 8, 0.12)', 
                        border: '1px solid rgba(234, 179, 8, 0.3)', 
                        color: '#facc15',
                        fontWeight: 500
                      }}
                      title={`Transaction amount exceeds the ₹${materialityThreshold.toLocaleString()} materiality threshold. Mandatory CA verification required.`}
                    >
                      Materiality Flag (≥ ₹{materialityThreshold.toLocaleString()})
                    </span>
                  )}
                </div>

                {/* Amount in strict green (+) or red (-) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span 
                    className={isCredit ? 'amount-positive' : 'amount-negative'}
                    style={{ 
                      fontSize: '17px', 
                      fontWeight: 700, 
                      fontFamily: 'var(--mono)'
                    }}
                  >
                    {isCredit ? '+' : '−'}{formatCurrency(t.amount)}
                  </span>
                </div>
              </div>

              <div className="review-body">
                {/* Left: Transaction details */}
                <div>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#ffffff', marginBottom: '3px' }}>
                    {t.counterparty || 'Counterparty Unidentified'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--mono)' }}>
                    {t.description}
                  </div>
                  {t.reference_number && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Ref: {t.reference_number}
                    </div>
                  )}
                </div>

                {/* Center: Proposed Category & Confidence */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    {isRule ? (
                      <span className="pill pill-rule">
                        <Zap size={10} /> Rule Match
                      </span>
                    ) : (
                      <span className="pill pill-ai">
                        <Bot size={10} /> AI Layer
                      </span>
                    )}
                    <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#ffffff' }}>
                      {confidence}% confidence
                    </span>
                  </div>

                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#ffffff' }}>
                    {t.category_name || 'Unassigned Account'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Account Code: {t.category_code || '---'}
                  </div>

                  {/* Confidence bar (Monochrome) */}
                  <div style={{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginTop: '6px' }}>
                    <div 
                      style={{ 
                        width: `${confidence}%`, 
                        height: '100%', 
                        background: '#ffffff',
                        borderRadius: '2px'
                      }} 
                    />
                  </div>
                </div>

                {/* Right: Actions */}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  {!t.is_approved ? (
                    <>
                      <button 
                        className="btn btn-primary btn-sm" 
                        onClick={() => onApprove(t.id)}
                        disabled={isLoading || isOwner}
                        title={isOwner ? "Approval restricted to licensed Chartered Accountants (4-eyes principle)" : "Approve and post to official ledger"}
                      >
                        <Check size={12} />
                        <span>Approve</span>
                      </button>
                      <button 
                        className="btn btn-secondary btn-sm" 
                        onClick={() => handleOpenOverride(t)}
                        disabled={isLoading || isOwner}
                        title={isOwner ? "Override restricted to CA persona" : "Select a different category"}
                      >
                        <Edit3 size={12} />
                        <span>Override</span>
                      </button>
                      <button 
                        className="btn btn-secondary btn-sm" 
                        onClick={() => onReject(t.id)}
                        disabled={isLoading || isOwner}
                        title={isOwner ? "Action restricted to CA persona" : "Reject proposal"}
                      >
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <button 
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpenOverride(t)}
                      disabled={isLoading || isOwner}
                      title={isOwner ? "Re-categorization restricted to CA persona" : "Change category"}
                    >
                      <Edit3 size={12} />
                      <span>Re-categorize</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Grounded Plain-Language Explanation */}
              {t.categorization_reasoning && (
                <div 
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    padding: '8px 12px',
                    fontSize: '11.5px',
                    color: 'var(--text-secondary)',
                    marginTop: '10px',
                    lineHeight: 1.5,
                  }}
                >
                  <strong style={{ color: '#ffffff', marginRight: '6px' }}>
                    {isRule ? 'Deterministic Logic:' : 'AI Inference Grounding:'}
                  </strong>
                  {t.categorization_reasoning}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Override Category Modal */}
      {overrideModalTxn && (
        <div className="modal-overlay" onClick={() => setOverrideModalTxn(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">
              Override Ledger Category
            </h2>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Assign transaction #{overrideModalTxn.id} ({formatCurrency(overrideModalTxn.amount)} - {overrideModalTxn.counterparty}) to an explicit Chart of Accounts ledger.
            </p>

            <div className="form-group">
              <label className="form-label">
                Select Ledger Account
              </label>
              <select
                className="form-select"
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.code} - {acc.name} ({acc.type})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="form-label">
                Reviewer Audit Note (Optional)
              </label>
              <textarea
                className="form-textarea"
                style={{ height: '70px', resize: 'vertical' }}
                placeholder="Explain why this account was selected (will be recorded in immutable audit log)..."
                value={overrideNotes}
                onChange={(e) => setOverrideNotes(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button 
                className="btn btn-secondary btn-sm" 
                onClick={() => setOverrideModalTxn(null)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary btn-sm" 
                onClick={submitOverride}
              >
                Confirm &amp; Post to Ledger
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
