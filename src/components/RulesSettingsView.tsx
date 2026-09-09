import React, { useState } from 'react';
import { Plus } from 'lucide-react';

interface RulesSettingsViewProps {
  rules: any[];
  accounts: any[];
  onCreateRule: (rule: { name: string; pattern: string; match_field: string; category_id: string; confidence: number }) => Promise<void>;
  isLoading: boolean;
}

export const RulesSettingsView: React.FC<RulesSettingsViewProps> = ({
  rules,
  accounts,
  onCreateRule,
  isLoading
}) => {
  const [subTab, setSubTab] = useState<'rules' | 'accounts'>('rules');
  const [showAddRule, setShowAddRule] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleField, setNewRuleField] = useState('description');
  const [newRuleCategory, setNewRuleCategory] = useState(accounts[0]?.id || '');
  const [newRuleConf, setNewRuleConf] = useState(100);

  const handleSubmitRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleName || !newRulePattern || !newRuleCategory) return;

    await onCreateRule({
      name: newRuleName,
      pattern: newRulePattern,
      match_field: newRuleField,
      category_id: newRuleCategory,
      confidence: Number(newRuleConf) || 100
    });

    setNewRuleName('');
    setNewRulePattern('');
    setShowAddRule(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
            Rules &amp; Chart of Accounts
          </h1>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Deterministic pattern matching and master ledger accounts for financial categorization.
          </p>
        </div>

        <div className="tab-list">
          <button 
            className={`tab-btn ${subTab === 'rules' ? 'active' : ''}`}
            onClick={() => setSubTab('rules')}
          >
            Categorization Rules ({rules.length})
          </button>
          <button 
            className={`tab-btn ${subTab === 'accounts' ? 'active' : ''}`}
            onClick={() => setSubTab('accounts')}
          >
            Chart of Accounts ({accounts.length})
          </button>
        </div>
      </div>

      {subTab === 'rules' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <button 
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddRule(!showAddRule)}
            >
              <Plus size={13} />
              <span>Add Custom Rule</span>
            </button>
          </div>

          {showAddRule && (
            <div className="panel" style={{ marginBottom: '18px' }}>
              <h2 className="panel-title" style={{ fontSize: '14px', marginBottom: '14px' }}>
                Create New Deterministic Categorization Rule
              </h2>
              <form onSubmit={handleSubmitRule}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                  <div>
                    <label className="form-label">
                      Rule Name
                    </label>
                    <input 
                      type="text" 
                      className="form-input"
                      placeholder="e.g. AWS Cloud Services"
                      value={newRuleName}
                      onChange={(e) => setNewRuleName(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="form-label">
                      Pattern (Regex / Keyword)
                    </label>
                    <input 
                      type="text" 
                      className="form-input font-mono"
                      placeholder="e.g. AWS|Amazon Web"
                      value={newRulePattern}
                      onChange={(e) => setNewRulePattern(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="form-label">
                      Target Ledger Account
                    </label>
                    <select
                      className="form-select"
                      value={newRuleCategory}
                      onChange={(e) => setNewRuleCategory(e.target.value)}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} - {a.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="form-label">
                      Confidence (%)
                    </label>
                    <input 
                      type="number" 
                      min="50" 
                      max="100"
                      className="form-input"
                      value={newRuleConf}
                      onChange={(e) => setNewRuleConf(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddRule(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={isLoading}>
                    Save Rule
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rule Name</th>
                  <th>Match Pattern</th>
                  <th>Field</th>
                  <th>Target Account</th>
                  <th>Confidence</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600, color: '#ffffff' }}>{r.name}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>{r.pattern}</td>
                    <td><span className="pill pill-rule">{r.match_field}</span></td>
                    <td style={{ color: '#ffffff', fontWeight: 500 }}>{r.category_name} ({r.category_code})</td>
                    <td><span className="pill pill-rule">{r.confidence}%</span></td>
                    <td><span className="pill pill-approved">Active</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'accounts' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>Code</th>
                <th>Account Name</th>
                <th style={{ width: '150px' }}>Classification</th>
                <th>Normal Balance</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: '#ffffff' }}>{a.code}</td>
                  <td style={{ fontWeight: 600, color: '#ffffff' }}>{a.name}</td>
                  <td>
                    <span className="pill pill-rule">{a.type.toUpperCase()}</span>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', textTransform: 'uppercase', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                    {a.normal_balance}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{a.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
