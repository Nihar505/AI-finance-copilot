'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { UserRole } from '@/lib/auth';
import { TDSCertificate } from '@/app/api/tds-certificates/route';

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
  const [quarter, setQuarter] = useState<'Q1' | 'Q2' | 'Q3' | 'Q4'>('Q3');
  const [financialYear, setFinancialYear] = useState<string>('2024-25');
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
      }
    } catch (err) {
      console.error('Error fetching TDS certificates:', err);
      onShowToast?.('Failed to load TDS certificates');
    } finally {
      setIsLoading(false);
    }
  }, [quarter, financialYear, currentRole, activeOrgId, onShowToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSignOff = async (cert: TDSCertificate) => {
    if (currentRole === 'business_owner') {
      onShowToast?.('Only Chartered Accountants have statutory authority to sign off Form 16A.');
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
        }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast?.(`✓ Form 16A for ${cert.vendorName} signed off!`);
        fetchData();
      } else {
        onShowToast?.(`Error: ${data.error}`);
      }
    } catch (err) {
      onShowToast?.('Failed to sign off certificate');
    } finally {
      setSigningId(null);
    }
  };

  const handleDownloadSingle = (cert: TDSCertificate) => {
    const csvContent = [
      'FORM 16A - CERTIFICATE UNDER SECTION 203 OF THE INCOME TAX ACT 1961',
      `Certificate No: ${cert.id}`,
      `Financial Year: ${cert.financialYear} | Quarter: ${cert.quarter}`,
      '',
      `Deductor: ${deductor?.name || 'Apex Global Advisory LLP'}`,
      `Deductor TAN: ${deductor?.tan || 'MUMA99821C'}`,
      `Deductor PAN: ${deductor?.pan || 'AABCA1234F'}`,
      '',
      `Deductee: ${cert.vendorName}`,
      `Deductee PAN: ${cert.vendorPan}`,
      `Deductee GSTIN: ${cert.vendorGstin}`,
      `Section: ${cert.section} (${cert.sectionDescription})`,
      '',
      'Gross Amount Paid (INR),TDS Rate (%),TDS Deducted (INR),Challan BSR,Challan Serial,Deposit Date,Status',
      `"${cert.grossAmount.toFixed(2)}","${cert.tdsRate}%","${cert.tdsAmount.toFixed(2)}","${cert.challanBsr}","${cert.challanNumber}","${cert.depositDate}","${cert.status === 'signed_off' ? 'Signed Off by CA' : 'Generated'}"`,
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Form16A_${cert.vendorName.replace(/[^a-zA-Z0-9]/g, '_')}_${cert.quarter}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onShowToast?.(`Downloaded Form 16A summary for ${cert.vendorName}`);
  };

  const handleDownloadAll = () => {
    if (certificates.length === 0) return;

    const headers = [
      'Certificate ID',
      'Vendor Name',
      'Vendor PAN',
      'Vendor GSTIN',
      'Section',
      'Quarter',
      'FY',
      'Gross Paid (INR)',
      'TDS Rate (%)',
      'TDS Deducted (INR)',
      'Challan No',
      'Deposit Date',
      'CA Sign-Off',
    ];

    const rows = certificates.map((c) => [
      c.id,
      `"${c.vendorName}"`,
      c.vendorPan,
      c.vendorGstin,
      c.section,
      c.quarter,
      c.financialYear,
      c.grossAmount.toFixed(2),
      `${c.tdsRate}%`,
      c.tdsAmount.toFixed(2),
      c.challanNumber,
      c.depositDate,
      c.status === 'signed_off' ? `Signed (${c.signedBy || 'CA'})` : 'Pending',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `TDS_Form16A_Register_${quarter}_${financialYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onShowToast?.('Exported TDS Form 16A register CSV');
  };

  const filteredCertificates = certificates.filter((c) => {
    const matchesSearch =
      c.vendorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.vendorPan.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.section.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSection = sectionFilter === 'ALL' || c.section === sectionFilter;
    return matchesSearch && matchesSection;
  });

  const getSectionBadgeStyle = (sec: string) => {
    switch (sec) {
      case '194I':
        return { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.3)' };
      case '194J':
        return { color: '#38bdf8', bg: 'rgba(56,189,248,0.1)', border: 'rgba(56,189,248,0.3)' };
      case '194C':
        return { color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.3)' };
      case '194Q':
        return { color: '#fb923c', bg: 'rgba(251,146,60,0.1)', border: 'rgba(251,146,60,0.3)' };
      case '194H':
        return { color: '#f472b6', bg: 'rgba(244,114,182,0.1)', border: 'rgba(244,114,182,0.3)' };
      default:
        return { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.3)' };
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header & Controls */}
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
              TDS Certificate Generation
            </h1>
            <span
              style={{
                fontSize: '0.72rem',
                padding: '2px 8px',
                borderRadius: 4,
                backgroundColor: 'rgba(59,130,246,0.15)',
                color: 'var(--brand-primary)',
                fontWeight: 600,
                border: '1px solid rgba(59,130,246,0.3)',
              }}
            >
              Form 16A • Sec 203 IT Act
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Deterministic quarterly tax deducted at source register for vendor payouts. Review, sign off, and export TRACES-compliant Form 16A summaries.
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
            Export All Form 16A
          </button>
        </div>
      </div>

      {/* Deductor Identity Banner */}
      {deductor && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: 8,
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: '0.82rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Building size={18} color="var(--brand-primary)" />
            <div>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{deductor.name}</span>
              <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>({deductor.address})</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18, color: 'var(--text-secondary)' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>TAN: </span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--brand-primary)' }}>
                {deductor.tan}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>PAN: </span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
                {deductor.pan}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>GSTIN: </span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
                {deductor.gstin}
              </span>
            </div>
          </div>
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
            Vendors with TDS in {quarter}
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>GROSS PAYOUTS</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            ₹{(summary?.totalGrossPaid || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            Total base payments
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>TOTAL TDS DEDUCTED</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#38bdf8' }}>
            ₹{(summary?.totalTdsDeducted || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            To be remitted by 7th of next month
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>DEPOSITED VIA CHALLAN</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#4ade80' }}>
            ₹{(summary?.totalTdsDeposited || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            Reconciled with bank challans
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>CA SIGN-OFF STATUS</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: summary?.pendingSignOff === 0 ? '#4ade80' : '#f59e0b' }}>
            {summary?.signedCount || 0} / {summary?.totalDeductees || 0}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            {summary?.pendingSignOff === 0 ? 'All certificates signed off' : `${summary?.pendingSignOff} awaiting CA review`}
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
          {['ALL', '194C', '194J', '194I', '194Q', '194H'].map((sec) => (
            <button
              key={sec}
              onClick={() => setSectionFilter(sec)}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: '0.75rem',
                fontWeight: 600,
                border: sectionFilter === sec ? '1px solid var(--brand-primary)' : '1px solid var(--border)',
                background: sectionFilter === sec ? 'rgba(59,130,246,0.15)' : 'var(--bg-secondary)',
                color: sectionFilter === sec ? 'var(--brand-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {sec === 'ALL' ? 'All Sections' : `Sec ${sec}`}
            </button>
          ))}
        </div>
      </div>

      {/* Table Container */}
      <div
        className="card"
        style={{
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-secondary)',
                  textAlign: 'left',
                  color: 'var(--text-muted)',
                }}
              >
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>DEDUCTEE / VENDOR</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>PAN / GSTIN</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>SECTION</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>GROSS PAID</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>RATE</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>TDS DEDUCTED</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>CHALLAN & DEPOSIT</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>SIGN-OFF STATUS</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'center' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredCertificates.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    {isLoading ? 'Loading TDS certificates...' : 'No TDS deductions matching criteria for this quarter.'}
                  </td>
                </tr>
              ) : (
                filteredCertificates.map((cert) => {
                  const secStyle = getSectionBadgeStyle(cert.section);
                  const isSigned = cert.status === 'signed_off';

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

                      {/* PAN / GSTIN */}
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {cert.vendorPan}
                        </div>
                        <div style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                          {cert.vendorGstin}
                        </div>
                      </td>

                      {/* Section */}
                      <td style={{ padding: '12px 14px' }}>
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
                        <div
                          style={{
                            fontSize: '0.7rem',
                            color: 'var(--text-muted)',
                            marginTop: 2,
                            maxWidth: 150,
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
                        {cert.tdsRate}%
                      </td>

                      {/* TDS Deducted */}
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#38bdf8' }}>
                        ₹{cert.tdsAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Challan */}
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                          {cert.challanNumber}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          BSR: {cert.challanBsr} • {cert.depositDate}
                        </div>
                      </td>

                      {/* Sign-Off Status */}
                      <td style={{ padding: '12px 14px' }}>
                        {isSigned ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#4ade80' }}>
                            <ShieldCheck size={14} />
                            <div>
                              <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>Signed by CA</div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                {cert.signedBy || 'Priya Sharma, FCA'}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#f59e0b' }}>
                            <Clock size={14} />
                            <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Pending CA Review</span>
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          {!isSigned && currentRole !== 'business_owner' && (
                            <button
                              onClick={() => handleSignOff(cert)}
                              disabled={signingId === cert.id}
                              style={{
                                padding: '4px 8px',
                                borderRadius: 4,
                                background: 'rgba(34,197,94,0.15)',
                                color: '#4ade80',
                                border: '1px solid rgba(34,197,94,0.3)',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                              title="Sign off Form 16A as CA"
                            >
                              {signingId === cert.id ? 'Signing...' : 'Sign Off'}
                            </button>
                          )}

                          <button
                            onClick={() => handleDownloadSingle(cert)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: 4,
                              background: 'var(--bg-secondary)',
                              color: 'var(--text-secondary)',
                              border: '1px solid var(--border)',
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title="Download Form 16A summary (CSV)"
                          >
                            <Download size={12} />
                            16A
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
