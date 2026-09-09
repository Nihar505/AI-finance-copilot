import React, { useState } from 'react';
import { 
  UploadCloud, 
  CheckCircle, 
  Download, 
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface UploadViewProps {
  onUploadFile: (file: File, fileType: string) => Promise<{ success: boolean; rowCount?: number; message?: string }>;
  onLoadSeed: () => Promise<void>;
  isLoading: boolean;
}

export const UploadView: React.FC<UploadViewProps> = ({
  onUploadFile,
  onLoadSeed,
  isLoading
}) => {
  const [selectedType, setSelectedType] = useState<'bank_statement' | 'sales_invoices' | 'vendor_bills'>('bank_statement');
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setUploadStatus(null);
    }
  };

  const handleSubmitUpload = async () => {
    if (!file) return;
    setUploadStatus('Ingesting, normalizing, and running categorization pipeline...');
    const result = await onUploadFile(file, selectedType);
    if (result.success) {
      setUploadStatus(`Success: Ingested ${result.rowCount} records into database.`);
      setFile(null);
    } else {
      setUploadStatus(`Upload failed: ${result.message || 'Error parsing file'}`);
    }
  };

  const sampleCsvs = {
    bank_statement: `Date,Description,Debit,Credit,Reference,Counterparty
2024-10-02,POS-DB-AMAZON WEB SERVICES INDIA,42500.00,,POS-AWS-001,Amazon Web Services
2024-10-03,RTGS-CR-ZENITH FINTECH SOL-INV-101,,250000.00,RTGS-CR-9821,Zenith FinTech
2024-10-05,NEFT-DB-WEWORK INDIA MANAGEMENT,115000.00,,NEFT-WW-11,WeWork India
2024-10-10,BULK-SALARY PAYOUT OCTOBER 2024,480000.00,,PAY-OCT-24,Staff Payroll
2024-10-12,CARD-SWIPE UBER INDIA SYSTEMS,3450.00,,UBER-TR-881,Uber India`,
    sales_invoices: `Invoice Number,Customer Name,Date,Due Date,Total Amount,Tax Amount
INV-2024-101,Zenith FinTech Solutions Ltd,2024-10-01,2024-10-15,250000.00,38135.59
INV-2024-102,Horizon Cloud Labs Pvt Ltd,2024-10-04,2024-10-20,180000.00,27457.63
INV-2024-103,Bharat Mobility Enterprises,2024-10-06,2024-10-25,320000.00,48813.56`,
    vendor_bills: `Bill Number,Vendor Name,Date,Due Date,Total Amount,Tax Amount
AWS-OCT-9912,Amazon Web Services India Pvt Ltd,2024-10-01,2024-10-15,42500.00,6483.05
WW-BLR-0982,WeWork India Management Pvt Ltd,2024-10-05,2024-10-10,115000.00,17542.37
DELL-CORP-771,Dell India Enterprise Pvt Ltd,2024-10-14,2024-10-28,165000.00,25169.49`
  };

  const handleDownloadSample = () => {
    const text = sampleCsvs[selectedType];
    const blob = new Blob([text], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Sample_${selectedType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
            Data Ingestion &amp; Normalization Hub
          </h1>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Upload raw bank statements (CSV/Excel) and billing documents. Normalizes amounts, dates, and counterparties into relational PostgreSQL.
          </p>
        </div>

        <button className="btn btn-primary btn-sm" onClick={onLoadSeed} disabled={isLoading}>
          <Sparkles size={13} />
          <span>Load 1-Month Sandbox Dataset</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
        {/* Upload Card */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Upload Financial Files</h2>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Select Document Type:
            </label>
            <div className="tab-list">
              <button
                type="button"
                className={`tab-btn ${selectedType === 'bank_statement' ? 'active' : ''}`}
                onClick={() => setSelectedType('bank_statement')}
              >
                Bank Statement
              </button>
              <button
                type="button"
                className={`tab-btn ${selectedType === 'sales_invoices' ? 'active' : ''}`}
                onClick={() => setSelectedType('sales_invoices')}
              >
                Sales Invoices
              </button>
              <button
                type="button"
                className={`tab-btn ${selectedType === 'vendor_bills' ? 'active' : ''}`}
                onClick={() => setSelectedType('vendor_bills')}
              >
                Vendor Bills
              </button>
            </div>
          </div>

          {/* File Dropzone */}
          <div 
            style={{
              border: '2px dashed var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: '36px 20px',
              textAlign: 'center',
              background: 'rgba(255, 255, 255, 0.02)',
              cursor: 'pointer',
              marginBottom: '16px',
              transition: 'border-color 0.15s ease',
            }}
            onClick={() => document.getElementById('file-upload-input')?.click()}
          >
            <UploadCloud size={32} color="#ffffff" style={{ margin: '0 auto 10px auto' }} />
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#ffffff' }}>
              {file ? file.name : 'Click to select CSV or Excel file'}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Supports .csv, .xlsx, .xls statements with automatic column normalization
            </div>
            <input 
              id="file-upload-input"
              type="file"
              accept=".csv, .xlsx, .xls"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button 
              className="btn btn-secondary btn-sm"
              onClick={handleDownloadSample}
              type="button"
            >
              <Download size={12} />
              <span>Sample CSV</span>
            </button>

            <button 
              className="btn btn-primary btn-sm"
              onClick={handleSubmitUpload}
              disabled={!file || isLoading}
            >
              <span>Upload &amp; Process</span>
              <ArrowRight size={12} />
            </button>
          </div>

          {uploadStatus && (
            <div 
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)',
                padding: '8px 12px',
                fontSize: '11.5px',
                color: 'var(--text-secondary)',
                marginTop: '14px',
              }}
            >
              {uploadStatus}
            </div>
          )}
        </div>

        {/* Normalization Details Panel */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Data Normalization Rules</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <CheckCircle size={15} color="#ffffff" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ color: '#ffffff' }}>Date Standardization:</strong>
                <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Converts DD/MM/YYYY, MM/DD/YYYY, and Excel serial stamps into ISO standard format.</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <CheckCircle size={15} color="#ffffff" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ color: '#ffffff' }}>Debit / Credit Normalization:</strong>
                <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Automatically parses separate debit/credit columns or negative-signed values into strictly positive amounts with clear direction.</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <CheckCircle size={15} color="#ffffff" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ color: '#ffffff' }}>Counterparty Cleaning:</strong>
                <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Strips banking prefixes like RTGS, NEFT, IMPS, POS-DB, UPI to extract clean counterparty names.</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <CheckCircle size={15} color="#ffffff" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ color: '#ffffff' }}>Relational Integrity:</strong>
                <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>Persists documents into PostgreSQL with foreign key audit links to transactions and invoices.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
