import React, { useState, useRef, useEffect } from 'react';
import { 
  RefreshCw, 
  Sparkles, 
  ShieldCheck, 
  Building2, 
  ChevronDown, 
  UserCheck, 
  Briefcase, 
  ShieldAlert, 
  Plus, 
  Check, 
  Eye, 
  SlidersHorizontal 
} from 'lucide-react';
import { UserRole, OrganizationInfo } from '@/lib/auth';

interface TopbarProps {
  activeTab: string;
  activeOrgId: string;
  organizations: OrganizationInfo[];
  currentRole: UserRole;
  materialityThreshold: number;
  suggestOnlyMode: boolean;
  onSwitchOrg: (orgId: string) => void;
  onSwitchRole: (role: UserRole) => void;
  onNewOrg: (orgData: { name: string; legalName: string; taxId: string; materialityThreshold: number }) => void;
  onRefresh: () => void;
  onLoadSeed: () => void;
  onRunPipeline: () => void;
  isLoading: boolean;
  toastMessage: string | null;
}

const tabTitles: Record<string, { label: string; sub: string }> = {
  dashboard:      { label: 'Executive Dashboard',        sub: 'Real-time liquidity · Ledger metrics · Runway' },
  review:         { label: 'CA Review Queue',            sub: 'Exception-driven · Human-in-the-loop approvals' },
  exceptions:     { label: 'Risk & Anomaly Matrix',      sub: 'Explainable flags · Statutory integrity checks' },
  reconciliation: { label: 'Reconciliation Matrix',      sub: 'Deterministic 3-way matching · Bank ↔ Documents' },
  upload:         { label: 'Data Hub & Ingestion',       sub: 'Bank statement adapter · Invoices · Payables' },
  copilot:        { label: 'AI Financial Copilot',       sub: 'Grounded RAG · Zero-hallucination citations' },
  audit:          { label: 'Immutable Audit Trail',      sub: 'Append-only PostgreSQL compliance log' },
  rules:          { label: 'Rules & Chart of Accounts',  sub: 'Pattern rules · Materiality thresholds' },
};

const roleDetails: Record<UserRole, { label: string; badge: string; subtitle: string; icon: any }> = {
  ca: {
    label: 'Senior CA / Reviewer',
    badge: 'CA Verified',
    subtitle: 'Full Approval & Ledger Override Authority',
    icon: Briefcase
  },
  business_owner: {
    label: 'Business Owner',
    badge: 'Executive View',
    subtitle: 'Insight-First · Approvals Guarded (4-Eyes Principle)',
    icon: Eye
  },
  admin: {
    label: 'Firm Administrator',
    badge: 'Admin',
    subtitle: 'System Config · Client Portfolio Onboarding',
    icon: ShieldCheck
  }
};

export const Topbar: React.FC<TopbarProps> = ({
  activeTab,
  activeOrgId,
  organizations,
  currentRole,
  materialityThreshold,
  suggestOnlyMode,
  onSwitchOrg,
  onSwitchRole,
  onNewOrg,
  onRefresh,
  onLoadSeed,
  onRunPipeline,
  isLoading,
  toastMessage,
}) => {
  const meta = tabTitles[activeTab] ?? { label: 'Dashboard', sub: '' };
  const currentOrg = organizations.find(o => o.id === activeOrgId) || {
    id: activeOrgId,
    name: 'Apex Global Advisory & Co.',
    legal_name: 'Apex Global Advisory Services LLP',
    tax_id: '27AAACA9876Q1ZA',
    currency: 'INR',
    materiality_threshold: materialityThreshold || 50000,
    suggest_only_mode: suggestOnlyMode
  };

  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [showNewOrgModal, setShowNewOrgModal] = useState(false);
  
  // New Org Form State
  const [newOrgName, setNewOrgName] = useState('');
  const [newLegalName, setNewLegalName] = useState('');
  const [newTaxId, setNewTaxId] = useState('');
  const [newThreshold, setNewThreshold] = useState('50000');

  const orgRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (orgRef.current && !orgRef.current.contains(e.target as Node)) {
        setOrgDropdownOpen(false);
      }
      if (roleRef.current && !roleRef.current.contains(e.target as Node)) {
        setRoleDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCreateOrg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName) return;
    onNewOrg({
      name: newOrgName,
      legalName: newLegalName || newOrgName,
      taxId: newTaxId,
      materialityThreshold: parseFloat(newThreshold) || 50000
    });
    setNewOrgName('');
    setNewLegalName('');
    setNewTaxId('');
    setShowNewOrgModal(false);
    setOrgDropdownOpen(false);
  };

  const ActiveRoleIcon = roleDetails[currentRole].icon;

  return (
    <header className="topbar">
      {/* Left: Brand / Navigation Context & Client Organization Switcher */}
      <div className="topbar-left">
        <div className="topbar-brand">
          <span style={{ color: '#ffffff', letterSpacing: '-0.03em' }}>FinCopilot</span>
          <span className="topbar-divider">/</span>
          <span className="topbar-title">{meta.label}</span>
        </div>

        {/* Multi-Client Switcher Dropdown */}
        <div className="client-switcher-container" ref={orgRef} style={{ position: 'relative' }}>
          <button 
            className="client-switcher-btn"
            onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
            title="Switch Client Organization Portfolio"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: '#121216',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '20px',
              padding: '5px 12px',
              fontSize: '12px',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <Building2 size={13} style={{ color: '#a1a1aa' }} />
            <strong style={{ fontWeight: 600, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentOrg.name}
            </strong>
            <span style={{ color: '#52525b' }}>·</span>
            <span style={{ fontSize: '11px', color: '#a1a1aa' }}>
              {currentOrg.tax_id ? currentOrg.tax_id.slice(0, 7) + '···' : 'INR'}
            </span>
            <ChevronDown size={12} style={{ color: '#71717a', transform: orgDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
          </button>

          {/* Client Organizations Dropdown Menu */}
          {orgDropdownOpen && (
            <div 
              className="client-dropdown-menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                left: 0,
                width: '320px',
                background: '#0d0d11',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                borderRadius: '12px',
                boxShadow: '0 12px 32px rgba(0,0,0,0.85)',
                zIndex: 100,
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}
            >
              <div style={{ padding: '6px 10px', fontSize: '11px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                CA Client Portfolio ({organizations.length})
              </div>

              {organizations.map(org => {
                const isSelected = org.id === activeOrgId;
                return (
                  <button
                    key={org.id}
                    onClick={() => {
                      onSwitchOrg(org.id);
                      setOrgDropdownOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      background: isSelected ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                      border: isSelected ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.1s ease'
                    }}
                  >
                    <div>
                      <div style={{ color: '#ffffff', fontWeight: 600, fontSize: '12.5px' }}>{org.name}</div>
                      <div style={{ color: '#71717a', fontSize: '11px', marginTop: '2px' }}>
                        {org.tax_id ? `GSTIN: ${org.tax_id}` : 'Tax ID Pending'} · Limit: ₹{org.materiality_threshold.toLocaleString()}
                      </div>
                    </div>
                    {isSelected && <Check size={14} style={{ color: '#22c55e', marginTop: '2px' }} />}
                  </button>
                );
              })}

              <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

              <button
                onClick={() => setShowNewOrgModal(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'transparent',
                  border: 'none',
                  color: '#a1a1aa',
                  fontSize: '12px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <Plus size={14} />
                <span>+ Onboard New Client Company</span>
              </button>
            </div>
          )}
        </div>

        {/* Materiality Guardrail Indicator */}
        <div 
          className="guardrail-chip"
          title={`Materiality Threshold: ₹${(currentOrg.materiality_threshold || 50000).toLocaleString()}. Transactions above this strictly require CA sign-off.`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: '#121216',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '20px',
            padding: '4px 10px',
            fontSize: '11px',
            color: '#a1a1aa'
          }}
        >
          <ShieldCheck size={12} style={{ color: '#22c55e' }} />
          <span>Cap: ₹{(currentOrg.materiality_threshold || 50000).toLocaleString()}</span>
        </div>
      </div>

      {/* Right: Persona Role Switcher & Operational Actions */}
      <div className="topbar-right">
        {toastMessage && (
          <div className="toast-chip" style={{ animation: 'fadeIn 0.2s ease' }}>{toastMessage}</div>
        )}

        {/* Role / Persona Switcher */}
        <div className="role-switcher-container" ref={roleRef} style={{ position: 'relative' }}>
          <button
            className="role-switcher-btn"
            onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
            title="Switch User Role Persona"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: currentRole === 'ca' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255, 255, 255, 0.06)',
              border: `1px solid ${currentRole === 'ca' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 255, 255, 0.15)'}`,
              borderRadius: '20px',
              padding: '4px 11px',
              fontSize: '11.5px',
              color: '#ffffff',
              cursor: 'pointer'
            }}
          >
            <ActiveRoleIcon size={12} style={{ color: currentRole === 'ca' ? '#22c55e' : '#a1a1aa' }} />
            <span style={{ fontWeight: 600 }}>{roleDetails[currentRole].badge}</span>
            <ChevronDown size={11} style={{ color: '#71717a' }} />
          </button>

          {/* Role Dropdown */}
          {roleDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: '280px',
                background: '#0d0d11',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                borderRadius: '12px',
                boxShadow: '0 12px 32px rgba(0,0,0,0.85)',
                zIndex: 100,
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}
            >
              <div style={{ padding: '6px 10px', fontSize: '11px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Select Active Persona
              </div>

              {(['ca', 'business_owner', 'admin'] as UserRole[]).map(r => {
                const isSelected = currentRole === r;
                const detail = roleDetails[r];
                const Icon = detail.icon;

                return (
                  <button
                    key={r}
                    onClick={() => {
                      onSwitchRole(r);
                      setRoleDropdownOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      background: isSelected ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                      border: isSelected ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid transparent',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Icon size={14} style={{ marginTop: '2px', color: isSelected ? '#22c55e' : '#a1a1aa' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#ffffff', fontWeight: 600, fontSize: '12px' }}>{detail.label}</div>
                      <div style={{ color: '#71717a', fontSize: '10.5px', marginTop: '1px' }}>{detail.subtitle}</div>
                    </div>
                    {isSelected && <Check size={13} style={{ color: '#22c55e', marginTop: '2px' }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          className="btn btn-secondary btn-sm"
          onClick={onRunPipeline}
          disabled={isLoading}
          title="Re-run categorization, reconciliation & exception engines"
        >
          <RefreshCw size={12} className={isLoading ? 'spin' : ''} />
          <span>Run Pipeline</span>
        </button>

        <button
          className="btn btn-primary btn-sm"
          onClick={onLoadSeed}
          disabled={isLoading}
          title="Load multi-client sandbox dataset"
        >
          <Sparkles size={12} />
          <span>Reset Demo Data</span>
        </button>
      </div>

      {/* Onboard Client Modal */}
      {showNewOrgModal && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div 
            style={{
              background: '#0e0e12',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: '16px',
              padding: '24px',
              width: '420px',
              boxShadow: '0 24px 64px rgba(0,0,0,0.9)'
            }}
          >
            <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600, color: '#ffffff' }}>
              Onboard Client Organization
            </h3>
            <p style={{ margin: '0 0 18px 0', fontSize: '12px', color: '#71717a' }}>
              Create an isolated client workspace with custom materiality and compliance rules.
            </p>

            <form onSubmit={handleCreateOrg} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', color: '#a1a1aa', marginBottom: '4px' }}>
                  Company Display Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Tech Solutions Pvt Ltd"
                  value={newOrgName}
                  onChange={e => setNewOrgName(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#16161b',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#ffffff',
                    fontSize: '13px'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11.5px', color: '#a1a1aa', marginBottom: '4px' }}>
                  Full Legal Entity Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Acme Tech Solutions Private Limited"
                  value={newLegalName}
                  onChange={e => setNewLegalName(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#16161b',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#ffffff',
                    fontSize: '13px'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11.5px', color: '#a1a1aa', marginBottom: '4px' }}>
                  GSTIN / Tax ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. 27AAAAA0000A1Z5"
                  value={newTaxId}
                  onChange={e => setNewTaxId(e.target.value.toUpperCase())}
                  style={{
                    width: '100%',
                    background: '#16161b',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#ffffff',
                    fontSize: '13px'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11.5px', color: '#a1a1aa', marginBottom: '4px' }}>
                  Materiality Approval Threshold (₹ INR)
                </label>
                <input
                  type="number"
                  value={newThreshold}
                  onChange={e => setNewThreshold(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#16161b',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#ffffff',
                    fontSize: '13px'
                  }}
                />
                <span style={{ fontSize: '10.5px', color: '#71717a', marginTop: '2px', display: 'block' }}>
                  Amounts exceeding this strictly require human CA sign-off.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowNewOrgModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                >
                  Create Client Workspace
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
