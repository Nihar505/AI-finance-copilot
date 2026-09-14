'use client';

import { WorkspaceApp } from '@/components/WorkspaceApp';

export default function AdminDashboardPage() {
  return <WorkspaceApp expectedRole="FIRM_ADMIN" />;
}
