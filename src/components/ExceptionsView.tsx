import React, { useState } from 'react';
import { 
  AlertTriangle, 
  CheckCircle, 
  ShieldAlert, 
  XCircle, 
  AlertOctagon, 
  Info
} from 'lucide-react';

interface ExceptionsViewProps {
  exceptions: any[];
  onResolveException: (id: string, decision: 'resolve' | 'dismiss', notes?: string) => Promise<void>;
  isLoading: boolean;
}

export const ExceptionsView: React.FC<ExceptionsViewProps> = ({
  exceptions,
  onResolveException,
  isLoading
}) => {
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [activeModal, setActiveModal] = useState<any | null>(null);
  const [modalDecision, setModalDecision] = useState<'resolve' | 'dismiss'>('resolve');
  const [notes, setNotes] = useState('');

  const filtered = exceptions.filter(e => {
    if (tab === 'open') return e.status === 'open';
    return e.status !== 'open';
  });

  const openCount = exceptions.filter(e => e.status === 'open').length;
  const criticalCount = exceptions.filter(e => e.status === 'open' && e.severity === 'critical').length;

  const handleOpenAction = (exc: any, decision: 'resolve' | 'dismiss') => {
    setActiveModal(exc);
    setModalDecision(decision);
    setNotes(decision === 'resolve' ? 'Verified with supporting documentation.' : 'Cleared as false positive after review.');
  };

  const handleSubmitAction = async () => {
    if (!activeModal) return;
    await onResolveException(activeModal.id, modalDecision, notes);
    setActiveModal(null);
  };

  const getSeverityBadge = (severity: string) => {
    if (severity === 'critical') {
      return (
        <span className="pill pill-critical">
          <AlertOctagon size={11} /> Critical Risk
        </span>
      );
    }
    if (severity === 'high') {
      return (
        <span className="pill pill-high">
          <AlertTriangle size={11} /> High Risk
        </span>
      );
    }
    return (
      <span className="pill pill-medium">
        <Info size={11} /> Warning
      </span>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
            Audit &amp; Compliance Exception Center
          </h1>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Deterministic rule-based anomaly detection: duplicate invoices, exact-amount duplicate swipes, missing required fields.
          </p>
        </div>

        <div className="tab-list">
          <button 
            className={`tab-btn ${tab === 'open' ? 'active' : ''}`}
            onClick={() => setTab('open')}
          >
            Open Findings ({openCount})
          </button>
          <button 
            className={`tab-btn ${tab === 'resolved' ? 'active' : ''}`}
            onClick={() => setTab('resolved')}
          >
            Resolved History ({exceptions.length - openCount})
          </button>
        </div>
      </div>

      {criticalCount > 0 && tab === 'open' && (
        <div 
          className="alert-banner"
          style={{ marginBottom: '20px' }}
        >
          <div className="alert-banner-body">
            <ShieldAlert size={18} color="#ffffff" />
            <div>
              <div className="alert-banner-title">
                {criticalCount} Critical Compliance Issue(s) Detected
              </div>
              <div className="alert-banner-sub">
                Duplicate invoices or double debits must be resolved before finalizing trial balance and tax submissions.
              </div>
            </div>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <CheckCircle size={36} color="#ffffff" style={{ margin: '0 auto 12px auto' }} />
          <h3 style={{ fontSize: '15px', color: '#ffffff', fontWeight: 600 }}>No {tab === 'open' ? 'Open' : 'Resolved'} Exceptions</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginTop: '4px' }}>
            {tab === 'open' ? 'All records passed deterministic duplicate and compliance checks.' : 'Resolved items will appear here.'}
          </p>
        </div>
      ) : (
        filtered.map((exc) => {
          const isOpen = exc.status === 'open';

          return (
            <div 
              key={exc.id} 
              className="panel"
              style={{
                marginBottom: '14px',
                borderLeft: exc.severity === 'critical' ? '3px solid #ffffff' : '3px solid var(--border-strong)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {getSeverityBadge(exc.severity)}
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                    #{exc.id}
                  </span>
                  <span className="pill pill-rule">
                    {exc.entity_type.toUpperCase()}: #{exc.entity_id}
                  </span>
                </div>

                <div>
                  {isOpen ? (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        className="btn btn-primary btn-sm"
                        onClick={() => handleOpenAction(exc, 'resolve')}
                        disabled={isLoading}
                      >
                        <CheckCircle size={12} />
                        <span>Resolve Finding</span>
                      </button>
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenAction(exc, 'dismiss')}
                        disabled={isLoading}
                      >
                        <XCircle size={12} />
                        <span>Dismiss</span>
                      </button>
                    </div>
                  ) : (
                    <span className="pill pill-approved">
                      Resolved by {exc.resolved_by || 'Reviewer'}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ fontSize: '13px', color: '#ffffff', lineHeight: 1.5, marginBottom: '8px' }}>
                {exc.explanation}
              </div>

              {exc.resolution_notes && (
                <div 
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    padding: '8px 12px',
                    fontSize: '11.5px',
                    color: 'var(--text-secondary)',
                    marginTop: '8px',
                  }}
                >
                  <strong style={{ color: '#ffffff', marginRight: '6px' }}>Resolution Audit Note:</strong> {exc.resolution_notes}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Action Modal */}
      {activeModal && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">
              {modalDecision === 'resolve' ? 'Resolve Audit Exception' : 'Dismiss Exception as False Positive'}
            </h2>
            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              {activeModal.explanation}
            </p>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="form-label">
                Reviewer Audit Note (Required for Compliance Trail)
              </label>
              <textarea
                className="form-textarea"
                style={{ height: '70px', resize: 'vertical' }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter justification for the audit trail..."
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setActiveModal(null)}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSubmitAction}>
                Confirm Decision
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
