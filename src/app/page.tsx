'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, ActiveTab } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { DashboardView } from '@/components/DashboardView';
import { ReviewQueueView } from '@/components/ReviewQueueView';
import { ExceptionsView } from '@/components/ExceptionsView';
import { ReconciliationView } from '@/components/ReconciliationView';
import { UploadView } from '@/components/UploadView';
import { CopilotChatView } from '@/components/CopilotChatView';
import { AuditTrailView } from '@/components/AuditTrailView';
import { RulesSettingsView } from '@/components/RulesSettingsView';
import { ComplianceView } from '@/components/ComplianceView';
import { GSTR2BView } from '@/components/GSTR2BView';
import { TDSCertificatesView } from '@/components/TDSCertificatesView';
import { UserRole, OrganizationInfo } from '@/lib/auth';

export default function Home() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Tenancy & RBAC States
  const [activeOrgId, setActiveOrgId] = useState<string>('org-apex-01');
  const [currentRole, setCurrentRole] = useState<UserRole>('ca');
  const [organizations, setOrganizations] = useState<OrganizationInfo[]>([]);
  const [materialityThreshold, setMaterialityThreshold] = useState<number>(50000);
  const [suggestOnlyMode, setSuggestOnlyMode] = useState<boolean>(true);

  // Core Financial Data States
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [reconciliationData, setReconciliationData] = useState<{ matches: any[]; unmatched: any[] }>({ matches: [], unmatched: [] });
  const [accounts, setAccounts] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [complianceOverdueCount, setComplianceOverdueCount] = useState<number>(0);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Helper to build tenant & role headers
  const getHeaders = useCallback(() => {
    return {
      'x-org-id': activeOrgId,
      'x-user-role': currentRole
    };
  }, [activeOrgId, currentRole]);

  // Fetch Auth & Organizations
  const fetchAuthContext = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setOrganizations(data.organizations || []);
        if (data.activeOrganization) {
          setMaterialityThreshold(data.activeOrganization.materialityThreshold || 50000);
          setSuggestOnlyMode(data.activeOrganization.suggestOnlyMode !== false);
        }
      }
    } catch (err) {
      console.error('Error fetching auth context:', err);
    }
  }, [getHeaders]);

  // Fetch all app data for active organization & role
  const fetchData = useCallback(async () => {
    try {
      const headers = getHeaders();
      const [dashRes, txnRes, excRes, recRes, accRes, ruleRes, logRes, compRes] = await Promise.all([
        fetch('/api/dashboard', { headers }),
        fetch('/api/transactions?filter=all', { headers }),
        fetch('/api/exceptions?status=all', { headers }),
        fetch('/api/reconciliation', { headers }),
        fetch('/api/chart-of-accounts', { headers }),
        fetch('/api/rules', { headers }),
        fetch('/api/audit-log', { headers }),
        fetch('/api/compliance', { headers })
      ]);

      const [dash, txn, exc, rec, acc, rule, logs, comp] = await Promise.all([
        dashRes.json(),
        txnRes.json(),
        excRes.json(),
        recRes.json(),
        accRes.json(),
        ruleRes.json(),
        logRes.json(),
        compRes.json()
      ]);

      if (dash.success) setDashboardData(dash);
      if (txn.success) setTransactions(txn.transactions);
      if (exc.success) setExceptions(exc.exceptions);
      if (rec.success) setReconciliationData({ matches: rec.matches, unmatched: rec.unmatched });
      if (acc.success) setAccounts(acc.accounts);
      if (rule.success) setRules(rule.rules);
      if (logs.success) setAuditLogs(logs.logs);
      if (comp.success && comp.summary) setComplianceOverdueCount(comp.summary.overdue || 0);
    } catch (err) {
      console.error('Error loading financial data:', err);
    }
  }, [getHeaders]);

  useEffect(() => {
    fetchAuthContext();
    fetchData();
  }, [fetchAuthContext, fetchData]);

  // Switch Active Client Organization
  const handleSwitchOrg = async (newOrgId: string) => {
    setActiveOrgId(newOrgId);
    const org = organizations.find(o => o.id === newOrgId);
    if (org) {
      setMaterialityThreshold(org.materiality_threshold || 50000);
      setSuggestOnlyMode(org.suggest_only_mode !== false);
      showToast(`Switched client to: ${org.name}`);
    }
  };

  // Switch Active User Role
  const handleSwitchRole = (newRole: UserRole) => {
    setCurrentRole(newRole);
    if (newRole === 'business_owner') {
      setActiveTab('dashboard'); // Switch to executive dashboard view
      showToast(`Switched to Business Owner persona (Insight-first view)`);
    } else if (newRole === 'ca') {
      showToast(`Switched to Senior CA persona (Full review & override authority)`);
    } else {
      showToast(`Switched to Firm Admin persona`);
    }
  };

  // Onboard New Client Organization
  const handleOnboardOrg = async (orgData: { name: string; legalName: string; taxId: string; materialityThreshold: number }) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getHeaders()
        },
        body: JSON.stringify(orgData)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✓ Onboarded client ${data.organization.name}`);
        await fetchAuthContext();
        setActiveOrgId(data.organization.id);
        await fetchData();
      } else {
        showToast(`Error: ${data.error}`);
      }
    } catch (err: any) {
      showToast(`Failed to create client: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handlers with RBAC and Tenancy
  const handleApprove = async (id: string, notes?: string) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getHeaders()
        },
        body: JSON.stringify({ action: 'APPROVE', transactionId: id, notes })
      });
      const data = await res.json();
      if (data.success) {
        showToast('✓ Approved & posted to ledger');
        await fetchData();
      } else {
        showToast(`Access Denied: ${data.error}`);
      }
    } catch (err) {
      console.error('Approve error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOverride = async (id: string, newCategoryId: string, notes?: string) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getHeaders()
        },
        body: JSON.stringify({ action: 'OVERRIDE', transactionId: id, newCategoryId, notes })
      });
      const data = await res.json();
      if (data.success) {
        showToast('✓ Category overridden & posted to ledger');
        await fetchData();
      } else {
        showToast(`Access Denied: ${data.error}`);
      }
    } catch (err) {
      console.error('Override error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReject = async (id: string, notes?: string) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getHeaders()
        },
        body: JSON.stringify({ action: 'REJECT', transactionId: id, notes })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Flagged & withheld from ledger');
        await fetchData();
      } else {
        showToast(`Access Denied: ${data.error}`);
      }
    } catch (err) {
      console.error('Reject error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBatchApprove = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getHeaders()
        },
        body: JSON.stringify({ action: 'BATCH_APPROVE' })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✓ Batch approved ${data.count} high-confidence items below ₹${materialityThreshold.toLocaleString()}!`);
        await fetchData();
      } else {
        showToast(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error('Batch approve error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResolveException = async (id: string, decision: 'resolve' | 'dismiss', notes?: string) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/exceptions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getHeaders()
        },
        body: JSON.stringify({ exceptionId: id, decision, notes })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✓ Exception marked as ${decision === 'dismiss' ? 'dismissed' : 'resolved'}`);
        await fetchData();
      } else {
        showToast(`Access Denied: ${data.error}`);
      }
    } catch (err) {
      console.error('Resolve exception error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApproveMatch = async (transactionId: string) => {
    await handleApprove(transactionId, 'Confirmed suggested document match');
  };

  const handleUploadFile = async (file: File, fileType: string) => {
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fileType', fileType);

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: getHeaders(),
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✓ Ingested ${data.rowCount} records into ${activeOrgId}`);
        await fetchData();
      }
      return data;
    } catch (err: any) {
      console.error('Upload error:', err);
      return { success: false, message: err.message };
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadSeed = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/seed', { 
        method: 'POST',
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.success) {
        showToast('✓ Multi-Client Sandbox Dataset Seeded!');
        await fetchAuthContext();
        await fetchData();
      }
    } catch (err) {
      console.error('Seed error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunPipeline = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/transactions/process', { 
        method: 'POST',
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✓ Pipeline completed: ${data.categorized} categorized, ${data.reconciled} matched`);
        await fetchData();
      }
    } catch (err) {
      console.error('Pipeline error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQueryCopilot = async (question: string) => {
    const res = await fetch('/api/ai/query', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...getHeaders()
      },
      body: JSON.stringify({ question })
    });
    return await res.json();
  };

  const handleCreateRule = async (newRule: any) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getHeaders()
        },
        body: JSON.stringify(newRule)
      });
      const data = await res.json();
      if (data.success) {
        showToast('✓ New rule saved!');
        await fetchData();
      } else {
        showToast(`Access Denied: ${data.error}`);
      }
    } catch (err) {
      console.error('Create rule error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const pendingCount = transactions.filter(t => !t.is_approved).length;
  const openExceptionsCount = exceptions.filter(e => e.status === 'open').length;

  return (
    <div className="app-container">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        pendingCount={pendingCount}
        exceptionsCount={openExceptionsCount}
        complianceCount={complianceOverdueCount}
      />

      <div className="main-wrapper">
        <Topbar
          activeTab={activeTab}
          activeOrgId={activeOrgId}
          organizations={organizations}
          currentRole={currentRole}
          materialityThreshold={materialityThreshold}
          suggestOnlyMode={suggestOnlyMode}
          onSwitchOrg={handleSwitchOrg}
          onSwitchRole={handleSwitchRole}
          onNewOrg={handleOnboardOrg}
          onRefresh={fetchData}
          onLoadSeed={handleLoadSeed}
          onRunPipeline={handleRunPipeline}
          isLoading={isLoading}
          toastMessage={toastMessage}
        />

        <main className="content-body">
          <div key={activeTab} className="tab-view-container animate-fade-in">
            {activeTab === 'dashboard' && (
              <DashboardView
                data={dashboardData}
                transactions={transactions}
                onNavigate={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === 'review' && (
              <ReviewQueueView
                transactions={transactions}
                accounts={accounts}
                currentRole={currentRole}
                materialityThreshold={materialityThreshold}
                onApprove={handleApprove}
                onOverride={handleOverride}
                onReject={handleReject}
                onBatchApprove={handleBatchApprove}
                isLoading={isLoading}
              />
            )}

            {activeTab === 'exceptions' && (
              <ExceptionsView
                exceptions={exceptions}
                onResolveException={handleResolveException}
                isLoading={isLoading}
              />
            )}

            {activeTab === 'reconciliation' && (
              <ReconciliationView
                reconciliationData={reconciliationData}
                onApproveMatch={handleApproveMatch}
                isLoading={isLoading}
              />
            )}

            {activeTab === 'gstr2b' && (
              <GSTR2BView
                currentRole={currentRole}
                activeOrgId={activeOrgId}
                onShowToast={showToast}
              />
            )}

            {activeTab === 'tds' && (
              <TDSCertificatesView
                currentRole={currentRole}
                activeOrgId={activeOrgId}
                onShowToast={showToast}
              />
            )}

            {activeTab === 'compliance' && (
              <ComplianceView
                currentRole={currentRole}
                activeOrgId={activeOrgId}
                onShowToast={showToast}
              />
            )}

            {activeTab === 'upload' && (
              <UploadView
                onUploadFile={handleUploadFile}
                onLoadSeed={handleLoadSeed}
                isLoading={isLoading}
              />
            )}

            {activeTab === 'copilot' && (
              <CopilotChatView
                onQueryCopilot={handleQueryCopilot}
                isLoading={isLoading}
              />
            )}

            {activeTab === 'audit' && (
              <AuditTrailView
                logs={auditLogs}
              />
            )}

            {activeTab === 'rules' && (
              <RulesSettingsView
                rules={rules}
                accounts={accounts}
                onCreateRule={handleCreateRule}
                isLoading={isLoading}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
