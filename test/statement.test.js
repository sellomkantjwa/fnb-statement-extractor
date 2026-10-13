const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const {
  extractStatement,
  extractTransactions,
  reconcile,
  StatementReconciliationError,
  UnsupportedStatementError,
} = require('..');

const SAMPLE = path.join(__dirname, 'fixtures', 'sample-statement.pdf');

const summary = {
  openingBalance: '100.00',
  closingBalance: '130.00',
  turnover: {
    credits: { count: 1, total: '50.00' },
    debits: { count: 1, total: '20.00' },
  },
};
const transactions = [
  { date: '01 Jan', description: 'Salary', amount: '50.00', balance: '150.00', charges: '' },
  { date: '02 Jan', description: 'Groceries', amount: '-20.00', balance: '130.00', charges: '' },
];
const statement = (txs, summaryFigures) => ({ type: 'current-account', transactions: txs, summary: summaryFigures });
const withRow = (index, changes) =>
  transactions.map((t, i) => (i === index ? { ...t, ...changes } : t));

// Draws [x, y-from-top, text] cells onto one page, the way pdf.js-extract reports them.
async function writeStatementPdf(cells) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  for (const [x, y, text] of cells) page.drawText(text, { x, y: 842 - y, size: 8, font });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fnb-')), 'statement.pdf');
  fs.writeFileSync(file, await doc.save());
  return file;
}

const header = [[16, 100, 'Date'], [209, 100, 'Description'], [437, 100, 'Amount'], [499, 100, 'Balance'], [554, 100, 'Bank']];
const row = (y, date, description, amount, balance) => [
  [12, y, date], [38, y, description], [444, y, amount], [507, y, balance],
];

describe('extractStatement', () => {
  it('reads the opening balance, closing balance and turnover from the statement', async () => {
    const { summary: read } = await extractStatement(SAMPLE);
    assert.deepEqual(read, {
      openingBalance: '9163.80',
      closingBalance: '41438.84',
      turnover: {
        credits: { count: 12, total: '228920.00' },
        debits: { count: 50, total: '196644.96' },
      },
    });
  });

  it('reads an overdrawn (Dr) opening balance as negative and allows a missing turnover section', async () => {
    const file = await writeStatementPdf([
      [20, 50, 'Opening Balance'], [175, 50, '100.00 Dr'],
      [20, 60, 'Closing Balance'], [175, 60, '50.00 Cr'],
      ...header,
      ...row(120, '01 Jan', 'Salary', '150.00 Cr', '50.00 Cr'),
    ]);
    const { summary: read, transactions: txs } = await extractStatement(file);
    assert.deepEqual(read, { openingBalance: '-100.00', closingBalance: '50.00', turnover: null });
    assert.equal(txs.length, 1);
  });
});

describe('unrecognised statements', () => {
  it('throws instead of reporting zero transactions for a PDF with no recognised transaction table', async () => {
    const file = await writeStatementPdf([
      [20, 50, 'Opening Balance'], [175, 50, '0.00'],
      [20, 60, 'Closing Balance'], [175, 60, '0.00'],
      [20, 80, 'Some Other Table'], [300, 80, 'Total'],
    ]);
    await assert.rejects(extractTransactions(file), UnsupportedStatementError);
  });

  it('reads summary figures that use a space as the thousands separator', async () => {
    const file = await writeStatementPdf([
      [20, 50, 'Opening Balance'], [175, 50, '1 359.18 Cr'], [300, 50, '0.00'],
      [20, 60, 'Closing Balance'], [175, 60, '2 359.18 Cr'], [300, 60, '0.00'],
      ...header,
      ...row(120, '01 Jan', 'Salary', '1 000.00 Cr', '2 359.18 Cr'),
    ]);
    const { summary: read } = await extractStatement(file);
    assert.equal(read.openingBalance, '1359.18');
    assert.equal(read.closingBalance, '2359.18');
  });
});

describe('statement period', () => {
  const balances = [[20, 50, 'Opening Balance'], [175, 50, '100.00 Cr'], [20, 60, 'Closing Balance'], [175, 60, '130.00 Cr']];

  it('reads the period and account number and gives each transaction a full date across a year end', async () => {
    const file = await writeStatementPdf([
      [380, 20, 'Gold Business Account : 12345678901'],
      [380, 30, 'Statement Period : 19 December 2024 to 18 January 2025'],
      ...balances,
      ...header,
      ...row(120, '22 Dec', 'Salary', '50.00 Cr', '150.00 Cr'),
      ...row(130, '05 Jan', 'Groceries', '20.00', '130.00 Cr'),
    ]);
    const { period, accountNumber, transactions: txs } = await extractStatement(file);
    assert.deepEqual(period, { from: '2024-12-19', to: '2025-01-18' });
    assert.equal(accountNumber, '12345678901');
    assert.deepEqual(txs.map((t) => [t.date, t.isoDate]), [['22 Dec', '2024-12-22'], ['05 Jan', '2025-01-05']]);
  });

  it('dates transactions within a single year', async () => {
    const file = await writeStatementPdf([
      [380, 30, 'Statement Period : 19 June 2026 to 18 July 2026'],
      ...balances,
      ...header,
      ...row(120, '02 Jul', 'Salary', '50.00 Cr', '150.00 Cr'),
      ...row(130, '18 Jul', 'Groceries', '20.00', '130.00 Cr'),
    ]);
    const { transactions: txs } = await extractStatement(file);
    assert.deepEqual(txs.map((t) => t.isoDate), ['2026-07-02', '2026-07-18']);
  });

  it('leaves the period, account number and full dates empty when the statement does not print them', async () => {
    const file = await writeStatementPdf([...balances, ...header, ...row(120, '22 Dec', 'Salary', '30.00 Cr', '130.00 Cr')]);
    const { period, accountNumber, transactions: txs } = await extractStatement(file);
    assert.equal(period, null);
    assert.equal(accountNumber, null);
    assert.equal(txs[0].isoDate, null);
  });
});

describe('reconcile', () => {
  it('accepts transactions that add up', () => {
    assert.doesNotThrow(() => reconcile(statement(transactions, summary)));
  });

  it('rejects a balance that does not follow from the previous one, naming the row', () => {
    assert.throws(
      () => reconcile(statement(withRow(1, { amount: '-25.00' }), summary)),
      (error) =>
        error instanceof StatementReconciliationError &&
        error.message.includes('02 Jan') &&
        error.message.includes('Groceries'),
    );
  });

  it('rejects transactions that do not end at the closing balance', () => {
    assert.throws(
      () => reconcile(statement(transactions.slice(0, 1), { ...summary, turnover: null })),
      (error) => error instanceof StatementReconciliationError && /closing balance/i.test(error.message),
    );
  });

  it('rejects a credit count that differs from the turnover summary', () => {
    const turnover = { ...summary.turnover, credits: { count: 2, total: '50.00' } };
    assert.throws(() => reconcile(statement(transactions, { ...summary, turnover })), StatementReconciliationError);
  });

  it('rejects a debit total that differs from the turnover summary', () => {
    const turnover = { ...summary.turnover, debits: { count: 1, total: '21.00' } };
    assert.throws(() => reconcile(statement(transactions, { ...summary, turnover })), StatementReconciliationError);
  });

  it('rejects a statement with no opening balance', () => {
    assert.throws(
      () => reconcile(statement(transactions, { ...summary, openingBalance: null })),
      (error) => error instanceof StatementReconciliationError && /opening balance/i.test(error.message),
    );
  });
});

describe('extractTransactions', () => {
  it('returns the transactions of a statement that reconciles', async () => {
    assert.equal((await extractTransactions(SAMPLE)).length, 63);
  });

  it('throws when the extracted rows do not add up', async () => {
    const file = await writeStatementPdf([
      [20, 50, 'Opening Balance'], [175, 50, '100.00 Cr'],
      [20, 60, 'Closing Balance'], [175, 60, '130.00 Cr'],
      ...header,
      ...row(120, '01 Jan', 'Salary', '50.00 Cr', '150.00 Cr'),
      ...row(130, '02 Jan', 'Groceries', '25.00', '130.00 Cr'),
    ]);
    await assert.rejects(extractTransactions(file), StatementReconciliationError);
  });
});
