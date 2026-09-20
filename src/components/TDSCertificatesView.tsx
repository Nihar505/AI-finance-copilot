'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileCheck,
  Download,
  Search,
  Filter,
  CheckCircle,
  Clock,
  ShieldCheck,
  Building,
  CreditCard,
  FileSpreadsheet,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { UserRole } from '@/lib/auth';
import { TDSCertificate } from '@/app/api/tds-certificates/route';
import { getCurrentTaxPeriod, STATUTORY_FORM_CONFIG } from '@/lib/statutoryRules';

interface TDSCertificatesViewProps {
  currentRole?: UserRole;
  activeOrgId?: string;
  onShowToast?: (msg: string) => void;
}

export const TDSCertificatesView: React.FC<TDSCertificatesViewProps> = ({
  currentRole = 'ca',
  activeOrgId,
  onShowToast,
}) => {
  const defaultPeriod = useMemo(() => getCurrentTaxPeriod(), []);
  const [quarter, setQuarter] = useState<'Q1' | 'Q2' | 'Q3' | 'Q4'>(defaultPeriod.quarter);
  const [financialYear, setFinancialYear] = useState<string>(defaultPeriod.financialYear);
  const [certificates, setCertificates] = useState<TDSCertificate[]>([]);
  const [deductor, setDeductor] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sectionFilter, setSectionFilter] = useState<string>('ALL');
  const [signingId, setSigningId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const headers: Record<string, string> = {
        'x-user-role': currentRole,
      };
      if (activeOrgId) headers['x-org-id'] = activeOrgId;

      const res = await fetch(
        `/api/tds-certificates?quarter=${quarter}&financialYear=${financialYear}`,
        { headers }
      );
      const data = await res.json();
      if (data.success) {
        setCertificates(data.certificates || []);
        setDeductor(data.deductor);
        setSummary(data.summary);
      } else {
        onShowToast?.(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error('Error fetching TDS register:', err);
      onShowToast?.('Failed to load TDS deduction register');
    } finally {
      setIsLoading(false);
    }
  }, [quarter, financialYear, currentRole, activeOrgId, onShowToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSignOff = async (cert: TDSCertificate) => {
    if (currentRole === 'business_owner') {
      onShowToast?.('Only Chartered Accountants have statutory authority to sign off TDS registers.');
      return;
    }

    if (cert.status === 'data_missing') {
      onShowToast?.(`Cannot sign off: Missing statutory data (${(cert.missingFields || []).join(', ')}).`);
      return;
    }

    setSigningId(cert.id);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-role': currentRole,
      };
      if (activeOrgId) headers['x-org-id'] = activeOrgId;

      const res = await fetch('/api/tds-certificates', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'sign_off',
          certificateId: cert.id,
          quarter,
          financialYear,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast?.(`✓ Deduction line for ${cert.vendorName} signed off!`);
        fetchData();
      } else {
        onShowToast?.(`Error: ${data.error}`);
      }
    } catch (err) {
      onShowToast?.('Failed to sign off deduction line');
    } finally {
      setSigningId(null);
    }
  };

  const handleDownloadSingle = (cert: TDSCertificate) => {
    const csvContent = [
      'TDS DEDUCTION REGISTER / 26Q PREPARATION WORKSHEET',
      `Certificate No: ${cert.id}`,
      `Period: ${cert.periodLabel} (${cert.legalRegime})`,
      '',
      `Deductor: ${deductor?.name || 'Organization Name Not Set'}`,
      `Deductor TAN: ${deductor?.tan || 'DATA MISSING'}`,
      `Deductor PAN: ${deductor?.pan || 'DATA MISSING'}`,
      '',
      `Deductee: ${cert.vendorName}`,
      `Deductee PAN: ${cert.vendorPan || 'DATA MISSING'}`,
      `Deductee GSTIN: ${cert.vendorGstin || 'DATA MISSING'}`,
      `Section: ${cert.section || 'PENDING CA REVIEW'} - ${cert.sectionDescription}`,
      '',
      'Gross Amount Paid (INR),TDS Rate (%),TDS Deducted (INR),Challan BSR,Challan Serial,Deposit Date,Status',
      `"${cert.grossAmount.toFixed(2)}","${cert.tdsRate !== null ? cert.tdsRate + '%' : 'DATA MISSING'}","${cert.tdsAmount.toFixed(2)}","${cert.challanBsr || 'UNALLOCATED'}","${cert.challanNumber || 'UNALLOCATED'}","${cert.depositDate || 'UNALLOCATED'}","${cert.status === 'signed_off' ? 'Signed Off by CA' : cert.status === 'data_missing' ? 'Data Missing' : 'Generated'}"`,
      '',
      'Statutory Notice: Form 16A certificates are issued via TRACES post quarterly 26Q filing.',
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `TDS_Register_${cert.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onShowToast?.(`Downloaded deduction summary for ${cert.vendorName}`);
  };

  const handleDownloadAll = () => {
    if (certificates.length === 0) return;

    const headers = [
      'Deduction ID',
      'Vendor / Deductee',
      'PAN',
      'GSTIN',
      'Section',
      'Section Description',
      'Gross Amount (INR)',
      'TDS Rate (%)',
      'TDS Deducted (INR)',
      'Challan No',
      'BSR Code',
      'Deposit Date',
      'Status',
      'Signed By',
      'Signed At',
    ];

    const rows = certificates.map((c) => [
      c.id,
      `"${c.vendorName}"`,
      c.vendorPan || 'DATA MISSING',
      c.vendorGstin || 'DATA MISSING',
      c.section || 'PENDING_REVIEW',
      `"${c.sectionDescription}"`,
      c.grossAmount.toFixed(2),
      c.tdsRate !== null ? `${c.tdsRate}%` : 'DATA MISSING',
      c.tdsAmount.toFixed(2),
      c.challanNumber || 'UNALLOCATED',
      c.challanBsr || 'UNALLOCATED',
      c.depositDate || 'UNALLOCATED',
      c.status,
      c.signedBy || '',
      c.signedAt || '',
    ]);

    const csvContent = [
      '# TDS DEDUCTION REGISTER / 26Q PREPARATION WORKSHEET',
      `# Deductor: ${deductor?.name || ''} | TAN: ${deductor?.tan || 'DATA MISSING'} | Period: ${quarter} ${financialYear}`,
      `# Total Deducted: INR ${summary?.totalTdsDeducted || 0} | Total Deposited: INR ${summary?.totalTdsDeposited || 0}`,
      headers.join(','),
      ...rows.map((r) => r.join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `TDS_26Q_Register_${quarter}_${financialYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onShowToast?.('Exported TDS 26Q deduction register CSV');
  };

  const filteredCertificates = certificates.filter((c) => {
    const matchesSearch =
      c.vendorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.vendorPan || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.section || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.challanNumber || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesSection = sectionFilter === 'ALL' || c.section === sectionFilter;
    return matchesSearch && matchesSection;
  });

  const getSectionBadgeStyle = (section: string | null) => {
    switch (section) {
      case '194C':
        return { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: 'rgba(59,130,246,0.3)' };
      case '194J(a)':
      case '194J(b)':
      case '194J':
        return { bg: 'rgba(168,85,247,0.15)', color: '#c084fc', border: 'rgba(168,85,247,0.3)' };
      case '194I':
        return { bg: 'rgba(234,179,8,0.15)', color: '#facc15', border: 'rgba(234,179,8,0.3)' };
      case '194Q':
        return { bg: 'rgba(34,197,94,0.15)', color: '#4ade80', border: 'rgba(34,197,94,0.3)' };
      case '194H':
        return { bg: 'rgba(249,115,22,0.15)', color: '#fb923c', border: 'rgba(249,115,22,0.3)' };
      default:
        return { bg: 'rgba(239,68,68,0.15)', color: '#f87171', border: 'rgba(239,68,68,0.3)' };
    }
  };

  const isPost2026 = parseInt(financialYear.split('-')[0], 10) >= 2026;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              {STATUTORY_FORM_CONFIG.preparationWorksheetTitle}
            </h1>
            <span
              style={{
                fontSize: '0.72rem',
                padding: '2px 8px',
                borderRadius: 4,
                backgroundColor: isPost2026 ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                color: isPost2026 ? '#f59e0b' : 'var(--brand-primary)',
                fontWeight: 600,
                border: `1px solid ${isPost2026 ? 'rgba(245,158,11,0.3)' : 'rgba(59,130,246,0.3)'}`,
              }}
            >
              {isPost2026 ? 'Income-tax Act 2025 • Sec 393' : 'Income-tax Act 1961 • 26Q Return Prep'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Deterministic withholding tax deduction register and challan reconciliation worksheet.
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
              (Note: Official Form 16A certificates are issued via TRACES only after quarterly Form 26Q return filing).
            </span>
          </p>
        </div>

        {/* Controls: FY, Quarter, Download */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select
            value={financialYear}
            onChange={(e) => setFinancialYear(e.target.value)}
            style={{
              padding: '7px 12px',
              borderRadius: 6,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            <option value="2026-27">Tax Year 2026-27 (2025 Act)</option>
            <option value="2025-26">FY 2025-26</option>
            <option value="2024-25">FY 2024-25</option>
            <option value="2023-24">FY 2023-24</option>
          </select>

          {/* Quarter Pill Selector */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-secondary)',
              borderRadius: 6,
              padding: 2,
              border: '1px solid var(--border)',
            }}
          >
            {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map((q) => (
              <button
                key={q}
                onClick={() => setQuarter(q)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 4,
                  fontSize: '0.8rem',
                  fontWeight: quarter === q ? 600 : 500,
                  border: 'none',
                  background: quarter === q ? 'var(--brand-primary)' : 'transparent',
                  color: quarter === q ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {q}
              </button>
            ))}
          </div>

          <button
            onClick={fetchData}
            style={{
              padding: '7px 10px',
              borderRadius: 6,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Refresh"
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={handleDownloadAll}
            disabled={certificates.length === 0}
            style={{
              padding: '7px 14px',
              borderRadius: 6,
              background: 'var(--brand-primary)',
              color: '#fff',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: certificates.length > 0 ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <FileSpreadsheet size={15} />
            Export 26Q Register (CSV)
          </button>
        </div>
      </div>

      {/* 2025 Act Alert Banner */}
      {isPost2026 && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: 8,
            backgroundColor: 'rgba(245,158,11,0.1)',
            border: '1px solid rgba(245,158,11,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: '0.82rem',
            color: '#f59e0b',
          }}
        >
          <AlertTriangle size={18} />
          <div>
            <strong>Income-tax Act 2025 Regime Active:</strong> Payments on or after 1 April 2026 fall under the Section 393 framework.
            Statutory section mappings and payment codes are marked <code>NEEDS_CA_REVIEW</code> with mapping pending.
          </div>
        </div>
      )}

      {/* Deductor Identity Banner */}
      {deductor && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: 8,
            backgroundColor: deductor.isDataMissing ? 'rgba(239,68,68,0.08)' : 'var(--bg-secondary)',
            border: `1px solid ${deductor.isDataMissing ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: '0.82rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Building size={16} color="var(--brand-primary)" />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{deductor.name}</span>
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              PAN:{' '}
              <strong style={{ color: deductor.pan ? 'var(--text-primary)' : '#f87171' }}>
                {deductor.pan || 'DATA MISSING'}
              </strong>
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              TAN:{' '}
              <strong style={{ color: deductor.tan ? 'var(--text-primary)' : '#f87171' }}>
                {deductor.tan || 'DATA MISSING'}
              </strong>
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              Address:{' '}
              <span style={{ color: deductor.address ? 'var(--text-muted)' : '#f87171' }}>
                {deductor.address || 'DATA MISSING'}
              </span>
            </div>
          </div>
          {deductor.isDataMissing && (
            <div style={{ color: '#f87171', fontWeight: 600, fontSize: '0.75rem' }}>
              ⚠️ Deductor TAN / Address Missing — CA Sign-off Blocked
            </div>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 14,
        }}
      >
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>DEDUCTEES (VENDORS)</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {summary?.totalDeductees || 0}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            Vendors with bills in {quarter}
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>TOTAL TDS DEDUCTED</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#38bdf8' }}>
            ₹{(summary?.totalTdsDeducted || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            Computed from bill amounts
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>DEPOSITED VIA CHALLAN</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#4ade80' }}>
            ₹{(summary?.totalTdsDeposited || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            From recorded ITNS 281 challans
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>CHALLAN VARIANCE</div>
          <div
            style={{
              fontSize: '1.4rem',
              fontWeight: 700,
              color: (summary?.depositedVsDeductedVariance || 0) < 0 ? '#f87171' : '#4ade80',
            }}
          >
            ₹{Math.abs(summary?.depositedVsDeductedVariance || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}{' '}
            <span style={{ fontSize: '0.75rem' }}>
              {(summary?.depositedVsDeductedVariance || 0) < 0 ? 'Shortfall' : 'Reconciled'}
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            Deposited minus deducted
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>RETURN STATUS</div>
          <div
            style={{
              fontSize: '1.1rem',
              fontWeight: 700,
              color: summary?.returnReady ? '#4ade80' : '#f59e0b',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {summary?.returnReady ? (
              <>
                <CheckCircle size={18} />
                <span>Return-Ready (26Q)</span>
              </>
            ) : (
              <>
                <Clock size={18} />
                <span>Allocations Needed</span>
              </>
            )}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            {summary?.signedCount || 0} / {summary?.totalDeductees || 0} signed off
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ position: 'relative', minWidth: 260 }}>
          <Search
            size={15}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            type="text"
            placeholder="Search vendor, PAN, section..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 10px 7px 32px',
              borderRadius: 6,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              fontSize: '0.82rem',
            }}
          />
        </div>

        {/* Section Filter Pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['ALL', '194C', '194J(a)', '194J(b)', '194I', '194Q', '194H'].map((sec) => (
            <button
              key={sec}
              onClick={() => setSectionFilter(sec)}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: '0.75rem',
                fontWeight: sectionFilter === sec ? 600 : 400,
                border: `1px solid ${sectionFilter === sec ? 'var(--brand-primary)' : 'var(--border)'}`,
                background: sectionFilter === sec ? 'rgba(59,130,246,0.15)' : 'var(--bg-secondary)',
                color: sectionFilter === sec ? 'var(--brand-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {sec}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          borderRadius: 8,
          border: '1px solid var(--border)',
          overflow: 'hidden',
          backgroundColor: 'var(--bg-secondary)',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--border)',
                  backgroundColor: 'rgba(255,255,255,0.02)',
                  color: 'var(--text-secondary)',
                  textAlign: 'left',
                }}
              >
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>DEDUCTEE / VENDOR</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>PAN</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>SECTION</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>GROSS PAID</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>RATE</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>TDS DEDUCTED</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>CHALLAN & DEPOSIT</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>STATUS</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'center' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredCertificates.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    {isLoading ? 'Loading TDS register...' : 'No bills with TDS deductions found for this quarter.'}
                  </td>
                </tr>
              ) : (
                filteredCertificates.map((cert) => {
                  const secStyle = getSectionBadgeStyle(cert.section);
                  const isSigned = cert.status === 'signed_off';
                  const isMissing = cert.status === 'data_missing';

                  return (
                    <tr
                      key={cert.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        transition: 'background 0.15s ease',
                      }}
                      className="table-row-hover"
                    >
                      {/* Vendor */}
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{cert.vendorName}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{cert.id}</div>
                      </td>

                      {/* PAN */}
                      <td style={{ padding: '12px 14px' }}>
                        <div
                          style={{
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            color: cert.vendorPan ? 'var(--text-primary)' : '#f87171',
                          }}
                        >
                          {cert.vendorPan || 'DATA MISSING'}
                        </div>
                        {cert.vendorGstin && (
                          <div style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                            {cert.vendorGstin}
                          </div>
                        )}
                      </td>

                      {/* Section */}
                      <td style={{ padding: '12px 14px' }}>
                        {cert.section ? (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 4,
                              backgroundColor: secStyle.bg,
                              color: secStyle.color,
                              border: `1px solid ${secStyle.border}`,
                            }}
                          >
                            Sec {cert.section}
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 4,
                              backgroundColor: 'rgba(239,68,68,0.15)',
                              color: '#f87171',
                              border: '1px solid rgba(239,68,68,0.3)',
                            }}
                          >
                            Mapping Pending
                          </span>
                        )}
                        <div
                          style={{
                            fontSize: '0.7rem',
                            color: 'var(--text-muted)',
                            marginTop: 2,
                            maxWidth: 160,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={cert.sectionDescription}
                        >
                          {cert.sectionDescription}
                        </div>
                      </td>

                      {/* Gross Paid */}
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                        ₹{cert.grossAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Rate */}
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        {cert.tdsRate !== null ? `${cert.tdsRate}%` : '—'}
                      </td>

                      {/* TDS Deducted */}
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#38bdf8' }}>
                        ₹{cert.tdsAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Challan */}
                      <td style={{ padding: '12px 14px' }}>
                        {cert.isAllocated ? (
                          <>
                            <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                              {cert.challanNumber}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              BSR: {cert.challanBsr} • {cert.depositDate}
                            </div>
                          </>
                        ) : (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              color: '#f59e0b',
                              fontWeight: 600,
                              backgroundColor: 'rgba(245,158,11,0.1)',
                              padding: '2px 6px',
                              borderRadius: 4,
                            }}
                          >
                            Unallocated Challan
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '12px 14px' }}>
                        {isSigned ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#4ade80' }}>
                            <ShieldCheck size={14} />
                            <div>
                              <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>Signed by CA</div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                {cert.signedBy}
                              </div>
                            </div>
                          </div>
                        ) : isMissing ? (
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#f87171' }}
                            title={`Missing data: ${(cert.missingFields || []).join(', ')}`}
                          >
                            <AlertTriangle size={14} />
                            <div>
                              <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>Data Missing</div>
                              <div style={{ fontSize: '0.68rem', color: '#f87171' }}>
                                Sign-off Blocked
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#f59e0b' }}>
                            <Clock size={14} />
                            <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Pending Sign-Off</span>
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          {!isSigned && currentRole !== 'business_owner' && (
                            <button
                              onClick={() => handleSignOff(cert)}
                              disabled={signingId === cert.id || isMissing}
                              style={{
                                padding: '4px 8px',
                                borderRadius: 4,
                                border: '1px solid rgba(59,130,246,0.3)',
                                background: isMissing ? 'rgba(255,255,255,0.04)' : 'rgba(59,130,246,0.15)',
                                color: isMissing ? 'var(--text-muted)' : 'var(--brand-primary)',
                                cursor: isMissing ? 'not-allowed' : 'pointer',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                              title={
                                isMissing
                                  ? `Cannot sign off: Missing ${(cert.missingFields || []).join(', ')}`
                                  : 'Sign off deduction line as CA'
                              }
                            >
                              <CheckCircle size={12} />
                              {signingId === cert.id ? 'Signing...' : 'Sign Off'}
                            </button>
                          )}

                          <button
                            onClick={() => handleDownloadSingle(cert)}
                            style={{
                              padding: '4px 7px',
                              borderRadius: 4,
                              border: '1px solid var(--border)',
                              background: 'transparent',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Download deduction summary (CSV)"
                          >
                            <Download size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
