'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Briefcase,
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Mail,
  ArrowRight,
  AlertCircle,
  Sparkles
} from 'lucide-react';
import { UserRole } from '@/lib/auth';
import { getWorkspaceDashboardPath } from '@/lib/permissions';

interface WorkspaceOption {
  role: UserRole;
  title: string;
  subtitle: string;
  description: string;
  icon: any;
  badge: string;
  demoAccount: {
    email: string;
    label: string;
  };
}

const WORKSPACE_OPTIONS: WorkspaceOption[] = [
  {
    role: 'CA',
    title: 'Chartered Accountant',
    subtitle: 'Accounting & Tax',
    description: 'Professional accounting, auditing, taxation, compliance and client-management workspace.',
    icon: Briefcase,
    badge: 'Statutory Sign-off',
    demoAccount: {
      email: 'demo.ca@example.com',
      label: 'Demo CA'
    }
  },
  {
    role: 'BUSINESS_OWNER',
    title: 'Business Owner',
    subtitle: 'Business Finance',
    description: 'Business financial overview, cash flow, transactions, invoices, financial insights and business planning.',
    icon: TrendingUp,
    badge: 'Executive Insight',
    demoAccount: {
      email: 'demo.owner@example.com',
      label: 'Demo Business Owner'
    }
  },
  {
    role: 'FIRM_ADMIN',
    title: 'Firm Administrator',
    subtitle: 'Firm Administration',
    description: 'Firm-level administration, users, clients, permissions, configuration and operational management.',
    icon: ShieldCheck,
    badge: 'System Admin',
    demoAccount: {
      email: 'demo.admin@example.com',
      label: 'Demo Firm Admin'
    }
  }
];

// Demo account passwords — DEVELOPMENT / DEMO ONLY
const DEMO_PASSWORDS: Record<UserRole, string> = {
  CA: 'DemoCA@12345',
  BUSINESS_OWNER: 'DemoOwner@12345',
  FIRM_ADMIN: 'DemoAdmin@12345'
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const preselectedRole = (searchParams.get('role')?.toUpperCase() as UserRole) || 'CA';
  const validInitialRole = ['CA', 'BUSINESS_OWNER', 'FIRM_ADMIN'].includes(preselectedRole)
    ? preselectedRole
    : 'CA';

  const [selectedRole, setSelectedRole] = useState<UserRole>(validInitialRole);
  const [email, setEmail] = useState<string>('demo.ca@example.com');
  const [password, setPassword] = useState<string>('DemoCA@12345');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Update credentials when role card changes if user was using demo credentials
  const handleSelectRole = (role: UserRole) => {
    setSelectedRole(role);
    setErrorMessage(null);
    const target = WORKSPACE_OPTIONS.find(w => w.role === role);
    if (target) {
      setEmail(target.demoAccount.email);
      setPassword(DEMO_PASSWORDS[role]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          role: selectedRole
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.error || 'Authentication failed. Please verify your credentials.');
        return;
      }

      // Successful authentication -> redirect directly to role-specific workspace
      const destination = getWorkspaceDashboardPath(data.user.role);
      router.push(destination);
    } catch (err: any) {
      setErrorMessage(err.message || 'Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickFill = (role: UserRole) => {
    handleSelectRole(role);
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#000000',
      padding: '32px 20px',
      fontFamily: "'Inter', -apple-system, sans-serif"
    }}>
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 14px',
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '999px',
          marginBottom: '16px'
        }}>
          <Sparkles size={14} style={{ color: '#22c55e' }} />
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#e4e4e7', letterSpacing: '0.04em' }}>
            ENTERPRISE ACCESS CONTROL
          </span>
        </div>
        <h1 style={{
          fontSize: '26px',
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: '-0.02em',
          margin: '0 0 8px 0'
        }}>
          Sign in to AI Finance Copilot
        </h1>
        <p style={{ fontSize: '13.5px', color: '#71717a', margin: 0 }}>
          Select your dedicated workspace and authenticate with your verified credentials.
        </p>
      </div>

      {/* Main Login Card */}
      <div style={{
        maxWidth: '820px',
        width: '100%',
        background: '#0a0a0d',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '20px',
        padding: '36px',
        boxShadow: '0 32px 80px rgba(0, 0, 0, 0.95)'
      }}>
        {/* Step 1: Workspace Selector */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{
            fontSize: '11.5px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#a1a1aa',
            marginBottom: '12px'
          }}>
            1. Select Your Target Workspace
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '14px'
          }}>
            {WORKSPACE_OPTIONS.map((opt) => {
              const isSelected = selectedRole === opt.role;
              const Icon = opt.icon;

              return (
                <div
                  key={opt.role}
                  onClick={() => handleSelectRole(opt.role)}
                  style={{
                    background: isSelected ? '#14141a' : '#0e0e12',
                    border: isSelected ? '1.5px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '14px',
                    padding: '20px 18px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    position: 'relative',
                    boxShadow: isSelected ? '0 8px 24px rgba(255, 255, 255, 0.06)' : 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      background: isSelected ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isSelected ? '#ffffff' : '#a1a1aa'
                    }}>
                      <Icon size={18} />
                    </div>
                    {isSelected ? (
                      <CheckCircle2 size={18} style={{ color: '#ffffff' }} />
                    ) : (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: '#71717a'
                      }}>
                        {opt.badge}
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', marginBottom: '2px' }}>
                    {opt.title}
                  </div>
                  <div style={{ fontSize: '11px', color: isSelected ? '#a1a1aa' : '#71717a', fontWeight: 500, marginBottom: '8px' }}>
                    {opt.subtitle}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#71717a', lineHeight: '1.45' }}>
                    {opt.description}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 2: Credentials Form */}
        <div>
          <div style={{
            fontSize: '11.5px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#a1a1aa',
            marginBottom: '14px'
          }}>
            2. Enter Workspace Credentials
          </div>

          {errorMessage && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '10px',
              color: '#f87171',
              fontSize: '12.5px',
              marginBottom: '18px'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <div>{errorMessage}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '6px' }}>
                Corporate Email Address
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#71717a' }} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  style={{
                    width: '100%',
                    background: '#141418',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '8px',
                    padding: '10px 12px 10px 36px',
                    color: '#ffffff',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '6px' }}>
                Security Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#71717a' }} />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  style={{
                    width: '100%',
                    background: '#141418',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '8px',
                    padding: '10px 12px 10px 36px',
                    color: '#ffffff',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '13px',
                background: '#ffffff',
                color: '#000000',
                fontWeight: 600,
                fontSize: '13.5px',
                borderRadius: '9px',
                border: 'none',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.7 : 1,
                marginTop: '6px',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{isLoading ? 'Verifying Authorization...' : `Sign In to ${selectedRole === 'CA' ? 'CA Workspace' : selectedRole === 'BUSINESS_OWNER' ? 'Business Workspace' : 'Admin Workspace'}`}</span>
              <ArrowRight size={15} />
            </button>
          </form>
        </div>

        {/* Demo Accounts Quick-Fill bar */}
        <div style={{
          marginTop: '28px',
          paddingTop: '20px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <div style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            Quick-Fill Seeded Demo Personas:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {WORKSPACE_OPTIONS.map(opt => (
              <button
                key={opt.role}
                type="button"
                onClick={() => handleQuickFill(opt.role)}
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  color: '#a1a1aa',
                  fontSize: '11.5px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }} />
                <span>{opt.demoAccount.label} ({opt.role})</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a' }}>
        Loading sign in checkpoint...
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
