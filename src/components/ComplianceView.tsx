'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  ShieldCheck, 
  FileText, 
  Search, 
  Filter, 
  ExternalLink,
  ChevronRight,
  Info,
  Save,
  Check,
  Bell,
  Send,
  X,
  Zap
} from 'lucide-react';
import { UserRole } from '@/lib/auth';

interface ComplianceFiling {
  id: string;
  org_id: string;
  filing_type: string;
  period: string;
  due_date: string;
  assigned_ca?: string;
  status: 'upcoming' | 'pending_review' | 'approved' | 'filed' | 'overdue';
  reference_ack_number?: string;
  notes?: string;
  days_until_due?: number;
  is_overdue: boolean;
}

interface ComplianceSummary {
  total: number;
  overdue: number;
  pending_review: number;
  upcoming: number;
  filed: number;
  approved: number;
  critical_within_7_days: number;
}

interface ComplianceViewProps {
  currentRole?: UserRole;
  activeOrgId?: string;
  onShowToast?: (msg: string) => void;
}

export const ComplianceView: React.FC<ComplianceViewProps> = ({
  currentRole = 'ca',
  activeOrgId = 'org-apex-01',
  onShowToast
}) => {
  const [filings, setFilings] = useState<ComplianceFiling[]>([]);
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'gst' | 'tds' | 'advtax' | 'roc'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'overdue' | 'pending_review' | 'upcoming' | 'filed'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Alert hooks drawer state
  const [isAlertDrawerOpen, setIsAlertDrawerOpen] = useState<boolean>(false);
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [isSendingAlert, setIsSendingAlert] = useState<boolean>(false);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [alertStatusMessage, setAlertStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('compliance_webhook_url');
      if (saved) setWebhookUrl(saved);
    }
  }, []);

  const handleSaveWebhook = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('compliance_webhook_url', webhookUrl.trim());
      onShowToast?.('✓ Alert Webhook URL saved to local preferences');
    }
  };

  const handleSendTestAlert = async () => {
    setIsSendingTest(true);
    setAlertStatusMessage(null);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': activeOrgId,
          'x-user-role': currentRole,
        },
        body: JSON.stringify({ action: 'test', webhookUrl: webhookUrl.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setAlertStatusMessage(data.message);
        onShowToast?.(data.message);
      } else {
        setAlertStatusMessage(`Error: ${data.error}`);
        onShowToast?.(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setAlertStatusMessage(`Failed: ${err.message}`);
      onShowToast?.(`Failed: ${err.message}`);
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleDispatchComplianceAlert = async () => {
    setIsSendingAlert(true);
    setAlertStatusMessage(null);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': activeOrgId,
          'x-user-role': currentRole,
        },
        body: JSON.stringify({ action: 'send_compliance_alert', webhookUrl: webhookUrl.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setAlertStatusMessage(data.message);
        onShowToast?.(data.message);
      } else {
        setAlertStatusMessage(`Error: ${data.error}`);
        onShowToast?.(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setAlertStatusMessage(`Failed: ${err.message}`);
      onShowToast?.(`Failed: ${err.message}`);
    } finally {
      setIsSendingAlert(false);
    }
  };
  
  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAck, setEditAck] = useState<string>('');
  const [editStatus, setEditStatus] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const fetchFilings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/compliance', {
        headers: {
          'x-org-id': activeOrgId,
          'x-user-role': currentRole
        }
      });
      const data = await res.json();
      if (data.success) {
        setFilings(data.filings || []);
        setSummary(data.summary || null);
      }
    } catch (err) {
      console.error('Error fetching compliance calendar:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeOrgId, currentRole]);

  useEffect(() => {
    fetchFilings();
  }, [fetchFilings]);

  const handleStartEdit = (f: ComplianceFiling) => {
    setEditingId(f.id);
    setEditAck(f.reference_ack_number || '');
    setEditStatus(f.status);
    setEditNotes(f.notes || '');
  };

  const handleSaveEdit = async (id: string) => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/compliance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': activeOrgId,
          'x-user-role': currentRole
        },
        body: JSON.stringify({
          id,
          status: editStatus,
          reference_ack_number: editAck,
          notes: editNotes
        })
      });
      const data = await res.json();
      if (data.success) {
        onShowToast?.(`✓ Filing ${id} updated`);
        setEditingId(null);
        await fetchFilings();
      } else {
        onShowToast?.(`Error: ${data.error}`);
      }
    } catch (err: any) {
      onShowToast?.(`Failed to save: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Filter filings
  const filteredFilings = filings.filter((f) => {
    // Category match
    if (categoryFilter === 'gst' && !['GSTR1', 'GSTR3B'].includes(f.filing_type)) return false;
    if (categoryFilter === 'tds' && !['TDS_DEPOSIT', 'TDS_RETURN_26Q'].includes(f.filing_type)) return false;
    if (categoryFilter === 'advtax' && !f.filing_type.startsWith('ADVANCE_TAX')) return false;
    if (categoryFilter === 'roc' && !f.filing_type.startsWith('ROC_')) return false;

    // Status match
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;

    // Search query match
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchType = f.filing_type.toLowerCase().includes(q);
      const matchPeriod = f.period.toLowerCase().includes(q);
      const matchNotes = (f.notes || '').toLowerCase().includes(q);
      const matchAck = (f.reference_ack_number || '').toLowerCase().includes(q);
      if (!matchType && !matchPeriod && !matchNotes && !matchAck) return false;
    }

    return true;
  });

  const getFilingCategoryBadge = (type: string) => {
    if (type.startsWith('GSTR')) return { label: 'GST Return', color: '#60a5fa' };
    if (type.startsWith('TDS')) return { label: 'Direct Tax (TDS)', color: '#f59e0b' };
    if (type.startsWith('ADVANCE_TAX')) return { label: 'Advance Tax', color: '#a78bfa' };
    if (type.startsWith('ROC')) return { label: 'MCA / ROC', color: '#34d399' };
    return { label: 'Statutory', color: '#94a3b8' };
  };

  const getStatusBadge = (status: string, days?: number) => {
    switch (status) {
      case 'overdue':
        return (
          <span style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: '4px',
            fontSize: '11px', 
            fontWeight: 600, 
            padding: '3px 8px', 
            borderRadius: '12px', 
            background: 'rgba(239, 68, 68, 0.15)', 
            border: '1px solid rgba(239, 68, 68, 0.35)', 
            color: '#f87171' 
          }}>
            <AlertTriangle size={11} /> Overdue {days !== undefined && Math.abs(days) > 0 ? `(${Math.abs(days)}d ago)` : ''}
          </span>
        );
      case 'pending_review':
        return (
          <span style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: '4px',
            fontSize: '11px', 
            fontWeight: 600, 
            padding: '3px 8px', 
            borderRadius: '12px', 
            background: 'rgba(245, 158, 11, 0.15)', 
            border: '1px solid rgba(245, 158, 11, 0.35)', 
            color: '#fbbf24' 
          }}>
            <Clock size={11} /> Due Soon ({days}d)
          </span>
        );
      case 'approved':
        return (
          <span style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: '4px',
            fontSize: '11px', 
            fontWeight: 600, 
            padding: '3px 8px', 
            borderRadius: '12px', 
            background: 'rgba(96, 165, 250, 0.15)', 
            border: '1px solid rgba(96, 165, 250, 0.35)', 
            color: '#60a5fa' 
          }}>
            <ShieldCheck size={11} /> CA Approved
          </span>
        );
      case 'filed':
        return (
          <span style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: '4px',
            fontSize: '11px', 
            fontWeight: 600, 
            padding: '3px 8px', 
            borderRadius: '12px', 
            background: 'rgba(34, 197, 94, 0.15)', 
            border: '1px solid rgba(34, 197, 94, 0.35)', 
            color: '#4ade80' 
          }}>
            <CheckCircle2 size={11} /> Filed
          </span>
        );
      default:
        return (
          <span style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: '4px',
            fontSize: '11px', 
            fontWeight: 500, 
            padding: '3px 8px', 
            borderRadius: '12px', 
            background: 'rgba(255, 255, 255, 0.05)', 
            border: '1px solid rgba(255, 255, 255, 0.12)', 
            color: 'var(--text-secondary)' 
          }}>
            Upcoming ({days}d)
          </span>
        );
    }
  };

  return (
    <div>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
              Statutory Compliance & Filings Calendar
            </h1>
            <span style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.08)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--mono)'
            }}>
              FY 2024-25 (India)
            </span>
          </div>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
            Automated statutory due date tracker for GST (GSTR-1, GSTR-3B), TDS Challan 281/26Q, Advance Tax, and MCA/ROC filings.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={() => setIsAlertDrawerOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Configure Slack / Teams webhook alerts"
          >
            <Bell size={13} />
            <span>Alert Hooks</span>
            {summary && summary.overdue > 0 && (
              <span style={{
                background: '#f87171',
                color: '#fff',
                fontSize: '10px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: '8px',
              }}>
                {summary.overdue}
              </span>
            )}
          </button>

          {summary && summary.overdue > 0 && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleDispatchComplianceAlert}
              disabled={isSendingAlert}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: '#dc2626',
                borderColor: '#b91c1c',
              }}
              title="Trigger urgent webhook alert for overdue filings"
            >
              <Zap size={13} />
              <span>{isSendingAlert ? 'Dispatching...' : 'Dispatch Alert Now'}</span>
            </button>
          )}

          <button 
            className="btn btn-secondary btn-sm" 
            onClick={fetchFilings}
            disabled={isLoading}
          >
            <Clock size={13} />
            <span>Refresh Deadlines</span>
          </button>
        </div>
      </div>

      {/* KPI Cards / Status Overview */}
      {summary && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
          gap: '12px', 
          marginBottom: '20px' 
        }}>
          <div className="panel" style={{ padding: '16px' }}>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total Statutory Filings
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#ffffff', fontFamily: 'var(--mono)', marginTop: '4px' }}>
              {summary.total}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Full FY 2024-25 schedule
            </div>
          </div>

          <div className="panel" style={{ padding: '16px', borderColor: summary.overdue > 0 ? 'rgba(239, 68, 68, 0.3)' : undefined }}>
            <div style={{ fontSize: '11.5px', color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertTriangle size={12} /> Overdue Deadlines
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#f87171', fontFamily: 'var(--mono)', marginTop: '4px' }}>
              {summary.overdue}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Immediate interest / penalty risk
            </div>
          </div>

          <div className="panel" style={{ padding: '16px', borderColor: summary.critical_within_7_days > 0 ? 'rgba(245, 158, 11, 0.3)' : undefined }}>
            <div style={{ fontSize: '11.5px', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} /> Due Within 7 Days
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#fbbf24', fontFamily: 'var(--mono)', marginTop: '4px' }}>
              {summary.critical_within_7_days}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Challan generation & CA sign-off
            </div>
          </div>

          <div className="panel" style={{ padding: '16px' }}>
            <div style={{ fontSize: '11.5px', color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle2 size={12} /> Completed & Filed
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#4ade80', fontFamily: 'var(--mono)', marginTop: '4px' }}>
              {summary.filed}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              ARN / Challan documented
            </div>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap' }}>
        {/* Category Tabs */}
        <div className="tab-list">
          <button 
            className={`tab-btn ${categoryFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            All Acts
          </button>
          <button 
            className={`tab-btn ${categoryFilter === 'gst' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('gst')}
          >
            GST Returns
          </button>
          <button 
            className={`tab-btn ${categoryFilter === 'tds' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('tds')}
          >
            TDS / Withholding
          </button>
          <button 
            className={`tab-btn ${categoryFilter === 'advtax' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('advtax')}
          >
            Advance Tax
          </button>
          <button 
            className={`tab-btn ${categoryFilter === 'roc' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('roc')}
          >
            MCA / ROC
          </button>
        </div>

        {/* Status Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="chat-input"
            style={{ height: '32px', padding: '0 10px', fontSize: '12px' }}
          >
            <option value="all">All Statuses</option>
            <option value="overdue">Overdue</option>
            <option value="pending_review">Due Soon (≤7d)</option>
            <option value="upcoming">Upcoming</option>
            <option value="filed">Filed</option>
          </select>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={13} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text"
            className="chat-input"
            style={{ paddingLeft: '34px', width: '100%', height: '32px', fontSize: '12px' }}
            placeholder="Search return type, period, ACK / ARN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Filings Table */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ background: 'var(--bg-card-subtle)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Filing Type & Scope</th>
              <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Period</th>
              <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Statutory Due Date</th>
              <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600 }}>ARN / Challan Reference</th>
              <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading compliance schedules...
                </td>
              </tr>
            ) : filteredFilings.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No statutory filings match the active filters.
                </td>
              </tr>
            ) : (
              filteredFilings.map((f) => {
                const cat = getFilingCategoryBadge(f.filing_type);
                const isEditing = editingId === f.id;

                return (
                  <tr 
                    key={f.id}
                    style={{ 
                      borderBottom: '1px solid var(--border)',
                      background: f.status === 'overdue' ? 'rgba(239, 68, 68, 0.02)' : 'transparent',
                      transition: 'background 0.15s ease'
                    }}
                  >
                    {/* Filing Type */}
                    <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ 
                          fontSize: '10px', 
                          padding: '2px 6px', 
                          borderRadius: '4px', 
                          background: 'rgba(255, 255, 255, 0.06)',
                          border: `1px solid ${cat.color}40`,
                          color: cat.color,
                          fontWeight: 600
                        }}>
                          {cat.label}
                        </span>
                        <span style={{ fontWeight: 600, color: '#ffffff', fontFamily: 'var(--mono)' }}>
                          {f.filing_type}
                        </span>
                      </div>
                      {f.notes && (
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0 0', maxWidth: '340px' }}>
                          {f.notes}
                        </p>
                      )}
                    </td>

                    {/* Period */}
                    <td style={{ padding: '14px 16px', verticalAlign: 'top', fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>
                      {f.period}
                    </td>

                    {/* Due Date */}
                    <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600, color: f.status === 'overdue' ? '#f87171' : '#ffffff', fontFamily: 'var(--mono)' }}>
                        {new Date(f.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {f.days_until_due !== undefined && f.days_until_due < 0 
                          ? `${Math.abs(f.days_until_due)} days past due`
                          : f.days_until_due !== undefined && f.days_until_due === 0
                          ? 'Due today'
                          : `${f.days_until_due} days remaining`}
                      </div>
                    </td>

                    {/* Status Badge or Inline Editor */}
                    <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                      {isEditing ? (
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value)}
                          className="chat-input"
                          style={{ height: '28px', padding: '0 6px', fontSize: '11.5px', width: '130px' }}
                        >
                          <option value="upcoming">Upcoming</option>
                          <option value="pending_review">Pending Review</option>
                          <option value="approved">CA Approved</option>
                          <option value="filed">Filed</option>
                          <option value="overdue">Overdue</option>
                        </select>
                      ) : (
                        getStatusBadge(f.status, f.days_until_due)
                      )}
                    </td>

                    {/* Reference / ARN / Challan */}
                    <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editAck}
                          onChange={(e) => setEditAck(e.target.value)}
                          placeholder="e.g. ARN AA270424..."
                          className="chat-input"
                          style={{ height: '28px', fontSize: '11.5px', width: '160px', fontFamily: 'var(--mono)' }}
                        />
                      ) : (
                        <span style={{ 
                          fontFamily: 'var(--mono)', 
                          fontSize: '11.5px', 
                          color: f.reference_ack_number ? '#ffffff' : 'var(--text-dim)' 
                        }}>
                          {f.reference_ack_number || '---'}
                        </span>
                      )}
                    </td>

                    {/* Action buttons */}
                    <td style={{ padding: '14px 16px', verticalAlign: 'top', textAlign: 'right' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ height: '28px', padding: '0 8px' }}
                            onClick={() => handleSaveEdit(f.id)}
                            disabled={isSaving}
                          >
                            <Save size={12} />
                            <span>Save</span>
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ height: '28px', padding: '0 8px' }}
                            onClick={() => setEditingId(null)}
                            disabled={isSaving}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ height: '28px', padding: '0 10px' }}
                          onClick={() => handleStartEdit(f)}
                          title="Record ARN acknowledgement or update filing status"
                        >
                          <span>Update</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Statutory Guidance Note Footer */}
      <div style={{
        marginTop: '20px',
        padding: '14px 18px',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px'
      }}>
        <Info size={16} color="#a1a1aa" style={{ marginTop: '2px', flexShrink: 0 }} />
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          <strong style={{ color: '#ffffff' }}>Chartered Accountant Statutory Notice:</strong> Late filing of GSTR-3B attracts late fees under CGST Act Section 47 (₹50/day; ₹20/day for NIL returns) plus 18% p.a. interest on net cash tax liability. TDS delayed payment attracts interest under Section 201(1A) at 1.5% per month or part month. All filings are tracked strictly against official CBDT / CBIC statutory schedules.
        </div>
      </div>

      {/* Alert Configuration Drawer / Modal */}
      {isAlertDrawerOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
          onClick={() => setIsAlertDrawerOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              height: '100%',
              backgroundColor: 'var(--bg-primary)',
              borderLeft: '1px solid var(--border)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              {/* Drawer Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Bell size={20} color="var(--brand-primary)" />
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    Compliance Alert Hooks
                  </h2>
                </div>
                <button
                  onClick={() => setIsAlertDrawerOpen(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
                Configure real-time notifications for overdue or urgent statutory filings. Alerts are formatted using Slack Block Kit and delivered to your operations channel.
              </p>

              {/* Status Alert Banner */}
              {alertStatusMessage && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 6,
                    backgroundColor: alertStatusMessage.startsWith('Error') || alertStatusMessage.startsWith('Failed')
                      ? 'rgba(239, 68, 68, 0.15)'
                      : 'rgba(34, 197, 94, 0.15)',
                    border: alertStatusMessage.startsWith('Error') || alertStatusMessage.startsWith('Failed')
                      ? '1px solid rgba(239, 68, 68, 0.3)'
                      : '1px solid rgba(34, 197, 94, 0.3)',
                    color: alertStatusMessage.startsWith('Error') || alertStatusMessage.startsWith('Failed')
                      ? '#f87171'
                      : '#4ade80',
                    fontSize: '0.8rem',
                    marginBottom: 16,
                  }}
                >
                  {alertStatusMessage}
                </div>
              )}

              {/* Webhook Input Section */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                  Incoming Webhook URL (Slack / Teams / Discord)
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="url"
                    placeholder="https://hooks.slack.com/services/T.../B.../..."
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 6,
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      fontSize: '0.82rem',
                    }}
                  />
                  <button
                    onClick={handleSaveWebhook}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 6,
                      background: 'var(--brand-primary)',
                      color: '#fff',
                      border: 'none',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Save
                  </button>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                  Leave blank to use environment default or run simulated dispatch in test mode.
                </div>
              </div>

              {/* Current Filing Status Overview */}
              <div
                style={{
                  padding: 14,
                  borderRadius: 8,
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  marginBottom: 20,
                }}
              >
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                  Statutory Queue Snapshot
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Overdue Deadlines:</span>
                  <span style={{ fontWeight: 700, color: (summary?.overdue || 0) > 0 ? '#f87171' : '#4ade80' }}>
                    {summary?.overdue || 0} filings
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Due within 48 Hours:</span>
                  <span style={{ fontWeight: 700, color: '#f59e0b' }}>
                    {summary?.critical_within_7_days || 0} filings
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Pending CA Review:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {summary?.pending_review || 0} filings
                  </span>
                </div>
              </div>

              {/* Sample Block Kit Preview */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                  Message Preview (Slack Block Kit)
                </div>
                <div
                  style={{
                    padding: 12,
                    borderRadius: 6,
                    backgroundColor: '#1e1e24',
                    border: '1px solid rgba(255,255,255,0.08)',
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    color: '#d4d4d8',
                    lineHeight: 1.5,
                  }}
                >
                  <div>⚠️ <strong style={{ color: '#fff' }}>Statutory Compliance Alert — Apex Global Advisory</strong></div>
                  <div style={{ color: '#f87171', marginTop: 4 }}>• GSTR-3B (Oct 2024): OVERDUE (19d ago)</div>
                  <div style={{ color: '#fbbf24' }}>• TDS Challan 281: DUE SOON (in 2 days)</div>
                  <div style={{ color: '#71717a', marginTop: 6 }}>Dispatched by AI Finance Copilot • Late fee §47 CGST</div>
                </div>
              </div>
            </div>

            {/* Drawer Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button
                onClick={handleSendTestAlert}
                disabled={isSendingTest}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 6,
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <Send size={14} />
                {isSendingTest ? 'Sending Test Alert...' : 'Send Test Notification'}
              </button>

              <button
                onClick={handleDispatchComplianceAlert}
                disabled={isSendingAlert || (summary?.overdue === 0 && summary?.critical_within_7_days === 0)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 6,
                  background: (summary?.overdue || 0) > 0 ? '#dc2626' : 'var(--brand-primary)',
                  color: '#fff',
                  border: 'none',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: isSendingAlert ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <Zap size={14} />
                {isSendingAlert ? 'Dispatching...' : 'Dispatch Compliance Alert Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
