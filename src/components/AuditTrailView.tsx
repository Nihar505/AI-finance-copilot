import React, { useState } from 'react';
import { ShieldCheck, Eye, Search } from 'lucide-react';

interface AuditTrailViewProps {
  logs: any[];
}

export const AuditTrailView: React.FC<AuditTrailViewProps> = ({ logs }) => {
  const [selectedLog, setSelectedLog] = useState<any | null>(null);
  const [search, setSearch] = useState('');

  const filteredLogs = logs.filter((l) => {
    const text = `${l.action} ${l.user_name} ${l.explanation} ${l.entity_type} ${l.entity_id}`.toLowerCase();
    return text.includes(search.toLowerCase());
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
            Immutable Audit Trail &amp; Ledger Decisions
          </h1>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Append-only compliance log: Complete chronological record of every AI suggestion approved, overridden, or rejected by human reviewers.
          </p>
        </div>

        <div className="pill pill-approved">
          <ShieldCheck size={12} />
          <span>Tamper-Evident Storage</span>
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input 
          type="text" 
          className="chat-input"
          placeholder="Filter audit entries by action, reviewer, or entity..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', maxWidth: '380px', height: '34px' }}
        />
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-container" style={{ border: 'none' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '160px' }}>Timestamp</th>
                <th style={{ width: '150px' }}>Reviewer / Actor</th>
                <th style={{ width: '160px' }}>Action</th>
                <th style={{ width: '140px' }}>Target Entity</th>
                <th>Audit Justification</th>
                <th style={{ width: '90px', textAlign: 'center' }}>Diff</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    No audit records logged yet. Decisions made in the Review Queue will appear here immediately.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: '11.5px', fontFamily: 'var(--mono)' }}>
                      {new Date(log.timestamp).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      })}
                    </td>
                    <td style={{ fontWeight: 600, color: '#ffffff' }}>
                      {log.user_name}
                    </td>
                    <td>
                      <span className={`pill ${log.action.includes('REJECT') ? 'pill-critical' : log.action.includes('OVERRIDE') ? 'pill-high' : 'pill-rule'}`}>
                        {log.action}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11.5px' }}>
                      {log.entity_type} #{log.entity_id}
                    </td>
                    <td style={{ color: '#ffffff', lineHeight: 1.4 }}>
                      {log.explanation}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {(log.before_state || log.after_state) ? (
                        <button 
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelectedLog(log)}
                          title="Inspect state diff"
                        >
                          <Eye size={12} />
                          <span>Diff</span>
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* State Diff Modal */}
      {selectedLog && (
        <div className="modal-overlay" onClick={() => setSelectedLog(null)}>
          <div className="modal-content" style={{ maxWidth: '650px' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">
              Audit State Diff
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Action: {selectedLog.action} on {selectedLog.entity_type} #{selectedLog.entity_id} by {selectedLog.user_name}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                  BEFORE STATE
                </div>
                <pre style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px', fontSize: '11px', fontFamily: 'var(--mono)', overflowX: 'auto', border: '1px solid var(--border)' }}>
                  {JSON.stringify(selectedLog.before_state || { status: 'none' }, null, 2)}
                </pre>
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                  AFTER STATE
                </div>
                <pre style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px', fontSize: '11px', fontFamily: 'var(--mono)', overflowX: 'auto', border: '1px solid var(--border)' }}>
                  {JSON.stringify(selectedLog.after_state || { status: 'none' }, null, 2)}
                </pre>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedLog(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
