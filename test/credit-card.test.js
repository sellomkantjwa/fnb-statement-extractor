const { describe, it, before } = require('node:test');
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

// An anonymised redraw of a real credit card statement (see scripts/sample-statements/credit-card.js):
// fictitious merchants, card numbers and figures that still reconcile; real dates.
const SAMPLE = path.join(__dirname, 'fixtures', 'sample-credit-card.pdf');
const sampleExpected = require('./fixtures/sample-credit-card.expected.json');

const card = (n) => `4000 00** **** 000${n}`;
const find = (txs, date, description) =>
  txs.find((t) => t.date === date && t.description === description);

describe('sample-credit-card.pdf', () => {
  let statement;
  before(async () => {
    statement = await extractStatement(SAMPLE);
  });

  it('is recognised as a credit card statement', () => {
    assert.equal(statement.type, 'credit-card');
  });

  it('reads the account summary and every card total', () => {
    assert.deepEqual(statement.summary, {
      openingBalance: '1268.02',
      closingBalance: '-3599.86',
      used: '-19363.77',
      cardTotals: [
        { card: card(1), total: '-276.76' },
        { card: card(2), total: '-137.58' },
        { card: card(3), total: '-119.95' },
        { card: card(4), total: '-16988.09' },
        { card: card(5), total: '-5.90' },
        { card: card(6), total: '-1835.49' },
      ],
    });
  });

  it('joins merchant, place and country into the description', () => {
    assert.ok(find(statement.transactions, '04 Apr', 'Music Store Online Dublin IE'));
  });

  it('makes purchases negative and payments positive', () => {
    assert.equal(find(statement.transactions, '04 Apr', 'Music Store Online Dublin IE').amount, '-66.14');
    assert.equal(find(statement.transactions, '26 Apr', 'Transfer Savings Ref0000001 ABC').amount, '6180.00');
  });

  it('reads amounts that use a space as the thousands separator', () => {
    assert.ok(statement.transactions.some((t) => t.amount === '-3629.09'));
  });

  it('reads a Cr suffix attached to the amount', () => {
    assert.equal(find(statement.transactions, '03 May', 'Interest On Credit Balance').amount, '0.06');
  });

  it('records the card each purchase was made on', () => {
    assert.equal(find(statement.transactions, '13 Apr', 'Grocer Rewards Subs Cape Town ZA').card, card(2));
  });

  it('leaves the card empty for account-level fees and payments', () => {
    assert.equal(find(statement.transactions, '03 May', '#Credit Card Account Fee').card, null);
  });

  it('extracts the entire statement exactly', () => {
    assert.deepEqual(statement.transactions, sampleExpected);
  });

  it('reconciles', async () => {
    assert.equal((await extractTransactions(SAMPLE)).length, 64);
  });
});

describe('credit card reconciliation', () => {
  const transactions = [
    { date: '01 Jan', description: 'Shop', amount: '-30.00', card: 'A' },
    { date: '02 Jan', description: 'Cafe', amount: '-20.00', card: 'A' },
    { date: '03 Jan', description: 'Fuel', amount: '-50.00', card: 'B' },
    { date: '04 Jan', description: 'Payment', amount: '80.00', card: null },
  ];
  const summary = {
    openingBalance: '10.00',
    closingBalance: '-10.00',
    used: '-100.00',
    cardTotals: [{ card: 'A', total: '-50.00' }, { card: 'B', total: '-50.00' }],
  };
  const statement = (changes = {}, txs = transactions) => ({
    type: 'credit-card',
    transactions: txs,
    summary: { ...summary, ...changes },
  });

  it('accepts a statement that adds up', () => {
    assert.doesNotThrow(() => reconcile(statement()));
  });

  it('rejects a card whose transactions do not add up to its card total, naming the card', () => {
    const txs = transactions.map((t) => (t.description === 'Cafe' ? { ...t, amount: '-25.00' } : t));
    assert.throws(
      () => reconcile(statement({ closingBalance: '-15.00', used: '-105.00' }, txs)),
      (error) => error instanceof StatementReconciliationError && /card A/i.test(error.message),
    );
  });

  it('rejects card transactions that do not add up to the amount used', () => {
    assert.throws(() => reconcile(statement({ used: '-90.00' })), StatementReconciliationError);
  });

  it('rejects transactions that do not lead from the opening to the closing balance', () => {
    assert.throws(
      () => reconcile(statement({ closingBalance: '-20.00' })),
      (error) => error instanceof StatementReconciliationError && /closing balance/i.test(error.message),
    );
  });

  it('rejects card transactions with no card total on the statement', () => {
    assert.throws(
      () => reconcile(statement({ cardTotals: [{ card: 'A', total: '-50.00' }] })),
      (error) => error instanceof StatementReconciliationError && /card B/i.test(error.message),
    );
  });

  it('rejects a statement with no opening balance', () => {
    assert.throws(() => reconcile(statement({ openingBalance: null })), StatementReconciliationError);
  });
});

// Draws [x, y-from-top, text] cells onto one page, the way pdf.js-extract reports them.
async function writeCreditCardPdf(cells) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const header = [[136, 100, 'Transaction Details'], [312, 100, 'Straight'], [388, 100, 'Budget']];
  for (const [x, y, text] of [...header, ...cells]) page.drawText(text, { x, y: 842 - y, size: 8, font });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fnb-')), 'credit-card.pdf');
  fs.writeFileSync(file, await doc.save());
  return file;
}

describe('credit card PDFs that cannot be trusted', () => {
  it('throws from extractTransactions when the transactions do not add up to the card total', async () => {
    const file = await writeCreditCardPdf([
      [276, 50, 'Opening Balance'], [427, 50, '0.00'],
      [276, 60, 'Closing Balance'], [419, 60, '100.00'],
      [60, 120, 'Card No. 4000 00** **** 0001'],
      [23, 130, '01 Jan'], [59, 130, 'Appliance Store'], [325, 130, '100.00'],
      [60, 140, 'Card Total'], [325, 140, '120.00'],
    ]);
    await assert.rejects(extractTransactions(file), StatementReconciliationError);
  });

  it('refuses transactions in the budget facility column rather than misreading them', async () => {
    const file = await writeCreditCardPdf([
      [276, 50, 'Opening Balance'], [427, 50, '0.00'],
      [276, 60, 'Closing Balance'], [419, 60, '100.00'],
      [60, 120, 'Card No. 4000 00** **** 0001'],
      [23, 130, '01 Jan'], [59, 130, 'Appliance Store'], [400, 130, '100.00'],
    ]);
    await assert.rejects(extractStatement(file), UnsupportedStatementError);
  });
});
