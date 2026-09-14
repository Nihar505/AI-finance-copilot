export type UserRole = 'CA' | 'BUSINESS_OWNER' | 'FIRM_ADMIN';

export type Permission =
  | 'view_financials'
  | 'approve_transactions'
  | 'override_ledger'
  | 'manage_rules'
  | 'sign_tds_certificates'
  | 'view_audit_trail'
  | 'manage_users'
  | 'manage_clients'
  | 'manage_permissions'
  | 'manage_firm_settings'
  | 'view_cash_flow'
  | 'manage_invoices'
  | 'view_reports'
  | 'view_compliance'
  | 'run_audit'
  | 'manage_tax'
  | 'ingest_data'
  | 'query_copilot';

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  CA: [
    'view_financials',
    'manage_clients',
    'run_audit',
    'manage_tax',
    'view_compliance',
    'approve_transactions',
    'override_ledger',
    'manage_rules',
    'sign_tds_certificates',
    'view_audit_trail',
    'view_reports',
    'ingest_data',
    'query_copilot'
  ],
  BUSINESS_OWNER: [
    'view_financials',
    'view_cash_flow',
    'manage_invoices',
    'view_reports',
    'ingest_data',
    'query_copilot'
  ],
  FIRM_ADMIN: [
    'manage_users',
    'manage_clients',
    'manage_permissions',
    'manage_firm_settings',
    'view_financials',
    'view_audit_trail',
    'sign_tds_certificates',
    'manage_rules',
    'view_reports',
    'query_copilot'
  ]
} as const;

export function normalizeRole(role?: string | null): UserRole {
  if (!role) return 'CA';
  const clean = role.trim().toUpperCase().replace(/[\s-]/g, '_');
  if (clean === 'CA' || clean === 'CHARTERED_ACCOUNTANT') return 'CA';
  if (clean === 'BUSINESS_OWNER' || clean === 'OWNER' || clean === 'BUSINESS') return 'BUSINESS_OWNER';
  if (clean === 'FIRM_ADMIN' || clean === 'ADMIN' || clean === 'SYSTEM_ADMIN') return 'FIRM_ADMIN';
  return 'CA';
}

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  const norm = normalizeRole(role);
  const permissions = ROLE_PERMISSIONS[norm] || [];
  return permissions.includes(permission);
}

export function canAccessWorkspace(userRole: string | null | undefined, targetWorkspace: UserRole): boolean {
  const norm = normalizeRole(userRole);
  return norm === targetWorkspace;
}

export function getWorkspaceDashboardPath(role: string | null | undefined): string {
  const norm = normalizeRole(role);
  switch (norm) {
    case 'CA':
      return '/ca/dashboard';
    case 'BUSINESS_OWNER':
      return '/business/dashboard';
    case 'FIRM_ADMIN':
      return '/admin/dashboard';
  }
}
