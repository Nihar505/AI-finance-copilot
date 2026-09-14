'use client';

import React, { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ShieldAlert, ArrowLeft, LogOut } from 'lucide-react';
import { getWorkspaceDashboardPath, normalizeRole } from '@/lib/permissions';

function UnauthorizedContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const roleParam = searchParams.get('role');
  const userRole = normalizeRole(roleParam);

  const roleDisplayNames: Record<string, string> = {
    CA: 'Chartered Accountant (CA)',
    BUSINESS_OWNER: 'Business Owner',
    FIRM_ADMIN: 'Firm Administrator'
  };

  const handleReturnDashboard = () => {
    const dest = getWorkspaceDashboardPath(userRole);
    router.push(dest);
  };

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#000000',
      padding: '24px',
      fontFamily: "'Inter', -apple-system, sans-serif"
    }}>
      <div style={{
        maxWidth: '480px',
        width: '100%',
        background: '#0e0e12',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '16px',
        padding: '36px 32px',
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.9)',
        textAlign: 'center'
      }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px auto',
          color: '#ef4444'
        }}>
          <ShieldAlert size={28} />
        </div>

        <h1 style={{
          fontSize: '20px',
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          margin: '0 0 10px 0'
        }}>
          Access Restricted
        </h1>

        <p style={{
          fontSize: '13px',
          color: '#a1a1aa',
          lineHeight: '1.6',
          margin: '0 0 24px 0'
        }}>
          You do not have authorization to access this workspace. Access is strictly partitioned by verified operational roles and statutory boundaries.
        </p>

        <div style={{
          background: '#141418',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '14px 18px',
          marginBottom: '28px',
          textAlign: 'left'
        }}>
          <div style={{
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#71717a',
            fontWeight: 600,
            marginBottom: '4px'
          }}>
            Your Current Access
          </div>
          <div style={{
            fontSize: '14px',
            fontWeight: 600,
            color: '#ffffff'
          }}>
            {roleDisplayNames[userRole] || userRole}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={handleReturnDashboard}
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '11px 18px',
              background: '#ffffff',
              color: '#000000',
              fontWeight: 600,
              fontSize: '13px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease'
            }}
          >
            <ArrowLeft size={15} />
            Return to Dashboard
          </button>

          <button
            onClick={handleSignOut}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '11px 18px',
              background: 'rgba(255, 255, 255, 0.06)',
              color: '#a1a1aa',
              fontWeight: 500,
              fontSize: '13px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <LogOut size={15} />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UnauthorizedPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a' }}>
        Loading access checkpoint...
      </div>
    }>
      <UnauthorizedContent />
    </Suspense>
  );
}
