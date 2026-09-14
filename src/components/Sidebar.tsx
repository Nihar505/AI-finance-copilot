'use client';

import React from 'react';
import {
  LayoutDashboard,
  CheckSquare,
  AlertTriangle,
  GitCompare,
  UploadCloud,
  Sparkles,
  History,
  Settings,
  Calendar,
  FileSpreadsheet,
  FileCheck,
} from 'lucide-react';
import { UserRole } from '@/lib/auth';
import { normalizeRole } from '@/lib/permissions';

export type ActiveTab =
  | 'dashboard'
  | 'review'
  | 'exceptions'
  | 'reconciliation'
  | 'gstr2b'
  | 'tds'
  | 'compliance'
  | 'upload'
  | 'copilot'
  | 'audit'
  | 'rules';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  pendingCount: number;
  exceptionsCount: number;
  complianceCount?: number;
  currentRole?: UserRole | string;
  userName?: string;
}

const navItems = [
  { id: 'dashboard',      label: 'Executive Dashboard',      icon: LayoutDashboard },
  { id: 'review',         label: 'CA Review Queue',           icon: CheckSquare },
  { id: 'exceptions',     label: 'Risk & Exceptions',         icon: AlertTriangle },
  { id: 'reconciliation', label: 'Reconciliation Matrix',     icon: GitCompare },
  { id: 'gstr2b',         label: 'GSTR-2B ITC Match',         icon: FileSpreadsheet },
  { id: 'tds',            label: 'TDS Certificates (16A)',   icon: FileCheck },
  { id: 'compliance',     label: 'Compliance Calendar',       icon: Calendar },
  { id: 'upload',         label: 'Ingestion & Data Hub',      icon: UploadCloud },
  { id: 'copilot',        label: 'AI Financial Copilot',      icon: Sparkles },
  { id: 'audit',          label: 'Immutable Audit Trail',     icon: History },
  { id: 'rules',          label: 'Rules & Chart of Accounts', icon: Settings },
] as const;

const ROLE_ALLOWED_TABS: Record<UserRole, readonly ActiveTab[]> = {
  CA: [
    'dashboard',
    'review',
    'exceptions',
    'reconciliation',
    'gstr2b',
    'tds',
    'compliance',
    'upload',
    'copilot',
    'audit',
    'rules'
  ],
  BUSINESS_OWNER: [
    'dashboard',
    'reconciliation',
    'upload',
    'copilot'
  ],
  FIRM_ADMIN: [
    'dashboard',
    'reconciliation',
    'compliance',
    'upload',
    'copilot',
    'audit',
    'rules'
  ]
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  pendingCount,
  exceptionsCount,
  complianceCount = 0,
  currentRole,
  userName
}) => {
  const normRole = normalizeRole(currentRole);
  const allowedTabs = ROLE_ALLOWED_TABS[normRole] || ROLE_ALLOWED_TABS.CA;
  const visibleNavItems = navItems.filter(item => allowedTabs.includes(item.id));

  const initials = userName
    ? userName.split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : (normRole === 'CA' ? 'PS' : normRole === 'BUSINESS_OWNER' ? 'RG' : 'VS');

  return (
    <aside className="sidebar">
      {/* Brand Mark */}
      <div className="sidebar-logo">
        <div className="logo-mark" title="AI Finance Copilot">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
      </div>

      {/* Nav Icons filtered by Role Permissions */}
      <nav className="sidebar-nav">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const hasDot =
            (item.id === 'review' && pendingCount > 0) ||
            (item.id === 'exceptions' && exceptionsCount > 0) ||
            (item.id === 'compliance' && (complianceCount ?? 0) > 0);

          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              data-tooltip={item.label}
              onClick={() => setActiveTab(item.id as ActiveTab)}
              aria-label={item.label}
            >
              <Icon size={18} />
              {hasDot && <span className="nav-dot" />}
            </button>
          );
        })}
      </nav>

      {/* User Avatar */}
      <div className="sidebar-avatar" title={`Active Workspace: ${normRole}`}>
        <div className="avatar-circle">
          {initials}
          <span className="online-dot" />
        </div>
      </div>
    </aside>
  );
};
