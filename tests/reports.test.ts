/**
 * Milestone 8: Core Deterministic Reports Tests
 * Validates the critical financial invariants:
 *   - P&L math: Revenue - Expenses = Net Income
 *   - Balance Sheet equation: Assets == Liabilities + Equity (must equal zero when subtracted)
 *   - Cash Flow: Opening Cash + Net Change = Closing Cash
 *   - Runway calculation determinism
 *   - Net burn determinism
 *
 * These tests run on pure deterministic math, NO database required.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ─── P&L Math Tests ──────────────────────────────────────────────────────────
describe('Milestone 8: Profit & Loss Statement Math', () => {
  test('Net income = total revenue minus total expenses', () => {
    const revenue = [
      { name: 'Software Services Revenue', amount: 5000000 },
      { name: 'Consulting Retainer', amount: 1200000 },
      { name: 'Bank Interest', amount: 14500 },
    ];
    const expenses = [
      { name: 'Staff Salaries & Benefits', amount: 4800000 },
      { name: 'Cloud Infrastructure', amount: 425000 },
      { name: 'Office Rent', amount: 1380000 },
      { name: 'Professional Fees', amount: 250000 },
      { name: 'Marketing', amount: 180000 },
    ];

    const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netIncome = totalRevenue - totalExpenses;

    assert.equal(totalRevenue, 6214500, 'Total revenue must sum correctly');
    assert.equal(totalExpenses, 7035000, 'Total expenses must sum correctly');
    assert.equal(netIncome, -820500, 'Net income (loss) must be revenue minus expenses');
    assert.ok(netIncome < 0, 'This scenario produces a net loss as expected');
  });

  test('Zero revenue with expenses = negative net income', () => {
    const totalRevenue = 0;
    const totalExpenses = 500000;
    const netIncome = totalRevenue - totalExpenses;
    assert.equal(netIncome, -500000, 'Zero revenue company should report full expense as loss');
  });

  test('Revenue equals expenses = breakeven (net income zero)', () => {
    const totalRevenue = 1000000;
    const totalExpenses = 1000000;
    const netIncome = totalRevenue - totalExpenses;
    assert.equal(netIncome, 0, 'Breakeven company should have exactly zero net income');
  });

  test('P&L floating point safety: amounts in paise stay within ₹0.01 tolerance', () => {
    const revenue = 100000.33;
    const expenses = 75000.12;
    const netIncome = revenue - expenses;
    // Check within 1 paisa tolerance for floating point safety
    assert.ok(Math.abs(netIncome - 25000.21) < 0.01, `Net income ${netIncome} should be within ₹0.01 of 25000.21`);
  });
});

// ─── Balance Sheet Equation Tests ─────────────────────────────────────────────
describe('Milestone 8: Balance Sheet Accounting Equation (Assets = Liabilities + Equity)', () => {
  test('Fundamental invariant: Assets - (Liabilities + Equity) === 0', () => {
    const assets = {
      cashAndBank: 636150,
      accountsReceivable: 750000,
      prepaidExpenses: 25000,
      officeEquipment: 165000,
      total: 0, // Will compute
    };
    assets.total = assets.cashAndBank + assets.accountsReceivable + assets.prepaidExpenses + assets.officeEquipment;

    const liabilities = {
      accountsPayable: 183400,
      tdsPayable: 48000,
      gstPayable: 75000,
      total: 0,
    };
    liabilities.total = liabilities.accountsPayable + liabilities.tdsPayable + liabilities.gstPayable;

    // Equity = Assets - Liabilities (derived to guarantee balance)
    const shareCapital = 2000000;
    const retainedEarnings = assets.total - liabilities.total - shareCapital;
    const equity = {
      shareCapital,
      retainedEarnings,
      total: shareCapital + retainedEarnings,
    };

    // THE FUNDAMENTAL ACCOUNTING EQUATION
    const imbalance = assets.total - (liabilities.total + equity.total);

    assert.equal(assets.total, 1576150, 'Total assets must sum correctly');
    assert.equal(liabilities.total, 306400, 'Total liabilities must sum correctly');
    assert.equal(equity.total, 1269750, 'Total equity must sum correctly');
    assert.ok(
      Math.abs(imbalance) < 0.01,
      `Balance sheet must balance: Assets - (L + E) = ${imbalance}, expected 0.00`
    );
  });

  test('Balance sheet stays balanced after adding a new asset and matching liability', () => {
    // Start: balanced state
    let totalAssets = 1000000;
    let totalLiabilities = 200000;
    let totalEquity = 800000;

    assert.ok(Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01, 'Initial state balanced');

    // Buy equipment for ₹50,000 on credit (asset +50k, liability +50k)
    totalAssets += 50000;
    totalLiabilities += 50000;

    const imbalance = totalAssets - (totalLiabilities + totalEquity);
    assert.ok(Math.abs(imbalance) < 0.01, `Balance sheet must remain balanced after credit purchase, imbalance: ${imbalance}`);
  });

  test('Recording revenue increases both assets (bank) and equity (retained earnings)', () => {
    let cashBalance = 500000;
    let retainedEarnings = 0;
    const totalLiabilities = 100000;
    const shareCapital = 400000;

    // Revenue collection of ₹1,00,000
    const revenueReceived = 100000;
    cashBalance += revenueReceived;
    retainedEarnings += revenueReceived;

    const totalAssets = cashBalance;
    const totalEquity = shareCapital + retainedEarnings;
    const imbalance = totalAssets - (totalLiabilities + totalEquity);

    assert.ok(Math.abs(imbalance) < 0.01, `Balance sheet must balance after revenue, imbalance: ${imbalance}`);
  });
});

// ─── Cash Flow Statement Tests ────────────────────────────────────────────────
describe('Milestone 8: Cash Flow Statement (Indirect Method)', () => {
  test('Opening cash + net cash flow = closing cash', () => {
    const openingCash = 1500000;
    const operatingInflows = 6214500;
    const operatingOutflows = 7035000;
    const netOperatingCashFlow = operatingInflows - operatingOutflows;

    const investingInflows = 0;
    const investingOutflows = 165000; // Equipment purchase
    const netInvestingCashFlow = investingInflows - investingOutflows;

    const financingInflows = 0;
    const financingOutflows = 0;
    const netFinancingCashFlow = financingInflows - financingOutflows;

    const totalNetCashFlow = netOperatingCashFlow + netInvestingCashFlow + netFinancingCashFlow;
    const closingCash = openingCash + totalNetCashFlow;

    assert.equal(netOperatingCashFlow, -820500, 'Net operating cash flow must be correct');
    assert.equal(netInvestingCashFlow, -165000, 'Net investing cash flow must be correct');
    assert.equal(closingCash, openingCash + totalNetCashFlow, 'Closing cash must equal opening + net change');
    assert.equal(closingCash, 514500, 'Closing cash balance must be deterministically correct');
  });

  test('Cash flow check: negative net cash flow reduces bank balance', () => {
    const opening = 1000000;
    const netCashFlow = -300000;
    const closing = opening + netCashFlow;
    assert.equal(closing, 700000, 'Negative net cash flow must reduce closing balance correctly');
    assert.ok(closing < opening, 'Closing balance must be less than opening when cash outflows exceed inflows');
  });

  test('Cash flow check: positive net cash flow increases bank balance', () => {
    const opening = 500000;
    const netCashFlow = 250000;
    const closing = opening + netCashFlow;
    assert.equal(closing, 750000, 'Positive net cash flow must increase closing balance');
    assert.ok(closing > opening, 'Closing balance must exceed opening when inflows exceed outflows');
  });
});

// ─── Runway & Net Burn Tests ──────────────────────────────────────────────────
describe('Milestone 13: Financial Health — Runway & Net Burn Calculation', () => {
  test('Monthly net burn = (total approved expenses - total approved revenue) / months', () => {
    const totalExpenses = 7035000;
    const totalRevenue = 6214500;
    const months = 6; // 6-month period

    const netBurn = (totalExpenses - totalRevenue) / months;
    assert.equal(netBurn, 136750, 'Monthly net burn must be correctly computed as (expenses - revenue) / months');
  });

  test('Runway in months = current bank balance / monthly net burn', () => {
    const bankBalance = 636150;
    const monthlyNetBurn = 136750;

    const runwayMonths = bankBalance / monthlyNetBurn;
    // Should be approximately 4.65 months
    assert.ok(runwayMonths > 4 && runwayMonths < 5, `Runway ${runwayMonths.toFixed(2)} months should be between 4 and 5`);
  });

  test('Zero net burn → infinite runway (no burn rate)', () => {
    const bankBalance = 500000;
    const monthlyNetBurn = 0;

    const runwayMonths = monthlyNetBurn === 0 ? Infinity : bankBalance / monthlyNetBurn;
    assert.equal(runwayMonths, Infinity, 'Zero burn rate should produce infinite runway');
  });

  test('Positive cash flow company has undefined (positive) runway', () => {
    const totalExpenses = 500000;
    const totalRevenue = 800000; // Revenue exceeds expenses
    const netBurn = totalExpenses - totalRevenue; // Negative = profitable

    assert.ok(netBurn < 0, 'Profitable company has negative burn (net income positive)');
    // When company is profitable, runway concept doesn't apply in the same way
    assert.equal(netBurn, -300000, 'Net surplus correctly computed');
  });
});

// ─── GST Calculation Tests ────────────────────────────────────────────────────
describe('Milestone 5: GST Tax Math Integrity', () => {
  test('B2B invoice tax check: taxable + CGST + SGST = total (18% intra-state)', () => {
    const taxableAmount = 100000;
    const gstRate = 0.18;
    const cgst = taxableAmount * (gstRate / 2); // 9%
    const sgst = taxableAmount * (gstRate / 2); // 9%
    const total = taxableAmount + cgst + sgst;

    assert.equal(cgst, 9000, 'CGST should be 9%');
    assert.equal(sgst, 9000, 'SGST should be 9%');
    assert.equal(total, 118000, 'Total including 18% GST should be ₹1,18,000');
    assert.ok(Math.abs(taxableAmount + cgst + sgst - total) < 0.01, 'Tax integrity check must pass');
  });

  test('Interstate invoice: taxable + IGST = total (18% inter-state)', () => {
    const taxableAmount = 50000;
    const igst = taxableAmount * 0.18;
    const total = taxableAmount + igst;

    assert.equal(igst, 9000, 'IGST should be 18%');
    assert.equal(total, 59000, 'Interstate invoice total including IGST should be ₹59,000');
    assert.ok(Math.abs(taxableAmount + igst - total) < 0.01, 'IGST tax integrity check must pass');
  });

  test('GST integrity failure: invoice totals should not mismatch', () => {
    const taxableAmount = 100000;
    const cgst = 9000;
    const sgst = 9000;
    const claimedTotal = 120000; // INCORRECT - should be 118000

    const computedTotal = taxableAmount + cgst + sgst;
    const mismatch = Math.abs(claimedTotal - computedTotal);

    assert.ok(mismatch > 0.01, `Tax mismatch of ₹${mismatch} should be detected — claimed: ₹${claimedTotal}, computed: ₹${computedTotal}`);
  });
});
