'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  Layers3,
  LockKeyhole,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UsersRound,
  X
} from 'lucide-react';

type PilotForm = {
  name: string;
  email: string;
  organizationName: string;
  customerProfile: string;
  clientVolume: string;
  message: string;
  consent: boolean;
};

const INITIAL_FORM: PilotForm = {
  name: '', email: '', organizationName: '', customerProfile: 'CA firm',
  clientVolume: '11–50 client books', message: '', consent: false
};

const proofPoints = [
  { icon: ScanSearch, title: 'One exception queue', text: 'Turn statements, invoices and bills into the finite set of items that need a human decision.' },
  { icon: FileCheck2, title: 'Evidence-first close', text: 'Every recommendation keeps its source record, reasoning and reviewer decision attached.' },
  { icon: ShieldCheck, title: 'CA stays accountable', text: 'Rules prepare; a qualified reviewer approves consequential ledger and compliance actions.' }
];

const plans = [
  { name: 'Business', price: '₹4,999', cadence: '/ entity / month', note: 'For a finance lead who wants a controlled close, not another spreadsheet.', items: ['Up to 2 finance seats', 'Bank, invoice and bill imports', 'Reconciliation and exception queue', 'Monthly close dashboard'] },
  { name: 'CA Firm', price: '₹1,999', cadence: '/ active entity / month', note: 'For firms running an exception-driven portfolio workflow.', items: ['CA review workspace', 'Multi-client access controls', 'Approval and audit trail', 'GST and TDS review queues'], featured: true },
  { name: 'Design Partner', price: 'Custom', cadence: 'for the first cohort', note: 'For hands-on rollout, migrations and a workflow tailored to your firm.', items: ['Guided onboarding', 'Priority product access', 'Outcome baseline and pilot review', 'Founding pricing for the pilot term'] }
];

function PilotApplication({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<PilotForm>(INITIAL_FORM);
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const update = <K extends keyof PilotForm>(key: K, value: PilotForm[K]) => setForm((previous) => ({ ...previous, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState('submitting');
    setMessage('');
    try {
      const response = await fetch('/api/pilot-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'We could not submit your application.');
      setState('success');
      setMessage(data.message);
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'We could not submit your application.');
    }
  };

  return (
    <div className="market-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section aria-labelledby="pilot-title" aria-modal="true" className="market-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <button className="market-modal-close" onClick={onClose} type="button" aria-label="Close application"><X size={18} /></button>
        {state === 'success' ? (
          <div className="market-success">
            <div className="market-success-icon"><Check size={25} /></div>
            <p className="market-eyebrow">Application received</p>
            <h2 id="pilot-title">You&apos;re on the pilot shortlist.</h2>
            <p>{message}</p>
            <button className="market-button market-button-primary" onClick={onClose} type="button">Done</button>
          </div>
        ) : <>
          <p className="market-eyebrow">Design partner application</p>
          <h2 id="pilot-title">Bring us your hardest monthly-close workflow.</h2>
          <p className="market-modal-copy">We are looking for Indian CA firms and finance teams willing to measure the hours, handoffs and exceptions in a real close.</p>
          <form className="market-form" onSubmit={submit}>
            <div className="market-form-grid">
              <label>Your name<input required value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Asha Mehta" /></label>
              <label>Work email<input required type="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="asha@firm.in" /></label>
            </div>
            <label>Firm or company<input required value={form.organizationName} onChange={(event) => update('organizationName', event.target.value)} placeholder="Mehta & Co." /></label>
            <div className="market-form-grid">
              <label>You are a<select value={form.customerProfile} onChange={(event) => update('customerProfile', event.target.value)}><option>CA firm</option><option>Startup finance team</option><option>SMB finance team</option><option>Other professional services firm</option></select></label>
              <label>Portfolio size<select value={form.clientVolume} onChange={(event) => update('clientVolume', event.target.value)}><option>1–10 client books</option><option>11–50 client books</option><option>51–150 client books</option><option>150+ client books</option></select></label>
            </div>
            <label>What makes month-end painful today? <span>Optional</span><textarea value={form.message} onChange={(event) => update('message', event.target.value)} placeholder="For example: matching UTRs to invoices, chasing documents, or reviewing vendor spend." rows={3} /></label>
            <label className="market-consent"><input checked={form.consent} onChange={(event) => update('consent', event.target.checked)} type="checkbox" /><span>I agree that FinCopilot may contact me about this design-partner application. Do not include financial records in this form.</span></label>
            {state === 'error' && <p className="market-form-error"><CircleAlert size={15} /> {message}</p>}
            <button className="market-button market-button-primary market-form-submit" disabled={state === 'submitting'} type="submit">{state === 'submitting' ? 'Submitting…' : 'Apply for the pilot'} <ArrowRight size={16} /></button>
          </form>
        </>}
      </section>
    </div>
  );
}

export function MarketingSite() {
  const [pilotOpen, setPilotOpen] = useState(false);
  return (
    <main className="market-site">
      <header className="market-nav">
        <Link className="market-brand" href="/" aria-label="FinCopilot home"><span className="market-brand-mark">F</span><span>FinCopilot</span></Link>
        <nav aria-label="Primary navigation" className="market-nav-links"><a href="#workflow">How it works</a><a href="#pricing">Pricing</a><a href="#security">Controls</a></nav>
        <div className="market-nav-actions"><Link className="market-login" href="/login">Sign in</Link><button className="market-button market-button-small" onClick={() => setPilotOpen(true)} type="button">Apply for pilot</button></div>
      </header>

      <section className="market-hero">
        <div className="market-hero-copy">
          <div className="market-launch-pill"><Sparkles size={14} /> India design-partner cohort now open</div>
          <h1>The close is not a data-entry problem. It&apos;s a decision problem.</h1>
          <p className="market-hero-lede">FinCopilot turns bank statements, invoices and bills into a clear, evidence-backed review queue—so CAs and finance teams spend their time on exceptions, not chasing every line item.</p>
          <div className="market-hero-actions"><button className="market-button market-button-primary" onClick={() => setPilotOpen(true)} type="button">Apply as a design partner <ArrowRight size={17} /></button><Link className="market-button market-button-secondary" href="/login?role=CA">Explore the live demo <ChevronRight size={17} /></Link></div>
          <p className="market-hero-note"><LockKeyhole size={14} /> Read-only data workflows. No bank credentials. Human approval for consequential actions.</p>
        </div>

        <div className="market-close-preview" aria-label="Example exception-driven close workflow">
          <div className="market-preview-bar"><span className="market-preview-live" /> October close <span>Ready for review</span></div>
          <div className="market-preview-title-row"><div><span>Close control centre</span><strong>7 decisions need attention</strong></div><BadgeCheck size={21} /></div>
          <div className="market-preview-stats"><div><small>Matched</small><b>128</b><span>evidence linked</span></div><div><small>Proposed</small><b>21</b><span>awaiting review</span></div><div><small>Exceptions</small><b>7</b><span>need a decision</span></div></div>
          <div className="market-preview-queue"><p>Priority review queue</p><div><i className="market-dot market-dot-high" /><span>Invoice INV-4102 has no matching receipt</span><em>High</em></div><div><i className="market-dot" /><span>GST input mismatch needs evidence</span><em>Review</em></div><div><i className="market-dot" /><span>Vendor payment categorised with 96% confidence</span><em>Proposed</em></div></div>
          <div className="market-preview-footer"><span>Source-linked • Reviewable • Auditable</span><span>CA sign-off required</span></div>
        </div>
      </section>

      <section className="market-section market-value-grid">{proofPoints.map(({ icon: Icon, title, text }) => <article className="market-value-card" key={title}><span className="market-icon"><Icon size={20} /></span><h2>{title}</h2><p>{text}</p></article>)}</section>

      <section className="market-section market-workflow" id="workflow">
        <div className="market-section-heading"><p className="market-eyebrow">The product wedge</p><h2>From incoming records to a controlled monthly close.</h2><p>We start with the workflow that repeats across every client book: ingest, match, flag, review, and retain the decision trail.</p></div>
        <div className="market-flow"><div><span>01</span><Banknote size={22} /><strong>Ingest</strong><p>Import bank statements and supporting records.</p></div><ArrowRight className="market-flow-arrow" size={19} /><div><span>02</span><Layers3 size={22} /><strong>Prepare</strong><p>Normalize, classify and reconcile deterministically.</p></div><ArrowRight className="market-flow-arrow" size={19} /><div><span>03</span><CircleAlert size={22} /><strong>Focus</strong><p>Surface only the missing, mismatched and unusual items.</p></div><ArrowRight className="market-flow-arrow" size={19} /><div><span>04</span><UsersRound size={22} /><strong>Approve</strong><p>Route consequential decisions to the right reviewer.</p></div></div>
      </section>

      <section className="market-section market-security" id="security">
        <div className="market-security-copy"><p className="market-eyebrow">Built for a workflow that must be defensible</p><h2>Automation prepares the work. Professionals own the decision.</h2><p>FinCopilot is not an autonomous Chartered Accountant. Its rules engine performs calculations, its AI explains and retrieves from loaded records, and the CA stays in the approval loop.</p><ul><li><Check size={17} /> Tenant-aware access and role-based approval boundaries</li><li><Check size={17} /> Evidence, recommendation and reviewer decision captured together</li><li><Check size={17} /> No payment initiation or bank-credential collection in the MVP</li></ul></div>
        <aside className="market-security-card"><ShieldCheck size={27} /><strong>Designed for reviewability</strong><p>A recommendation is never the final ledger action. It must carry its source records and fit the organization&apos;s approval policy.</p><div><span>AI</span><ArrowRight size={15} /><span>Evidence</span><ArrowRight size={15} /><span>CA review</span></div></aside>
      </section>

      <section className="market-section market-pricing" id="pricing">
        <div className="market-section-heading market-pricing-heading"><p className="market-eyebrow">Simple value-based pricing</p><h2>Price the close, not the number of logins.</h2><p>Start with a per-entity subscription that scales with a firm&apos;s managed portfolio. Pilot pricing is agreed before any data migration; applicable taxes are additional.</p></div>
        <div className="market-plan-grid">{plans.map((plan) => <article className={`market-plan ${plan.featured ? 'market-plan-featured' : ''}`} key={plan.name}>{plan.featured && <span className="market-plan-badge">Recommended for CA firms</span>}<h3>{plan.name}</h3><div className="market-plan-price">{plan.price}<small>{plan.cadence}</small></div><p>{plan.note}</p><ul>{plan.items.map((item) => <li key={item}><Check size={16} /> {item}</li>)}</ul><button className={plan.featured ? 'market-button market-button-primary' : 'market-button market-button-secondary'} onClick={() => setPilotOpen(true)} type="button">Discuss this plan <ArrowRight size={15} /></button></article>)}</div>
      </section>

      <section className="market-section market-final-cta"><TimerReset size={25} /><div><h2>Measure one close with us.</h2><p>Bring one real workflow. We will baseline the manual effort, configure the review loop, and decide together whether it earns a permanent place in your stack.</p></div><button className="market-button market-button-primary" onClick={() => setPilotOpen(true)} type="button">Apply for the pilot <ArrowRight size={17} /></button></section>
      <footer className="market-footer"><span>© {new Date().getFullYear()} FinCopilot</span><span>AI-assisted finance operations for India&apos;s CAs and growing businesses.</span><Link href="/login">Workspace sign in</Link></footer>
      {pilotOpen && <PilotApplication onClose={() => setPilotOpen(false)} />}
    </main>
  );
}
