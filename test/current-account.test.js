const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { extractTransactions } = require('..');

// An anonymised redraw of a real 2023 statement (see scripts/sample-statements/current-account.js):
// fictitious descriptions and figures that still reconcile; real dates and FNB's own fees.
const SAMPLE = path.join(__dirname, 'fixtures', 'sample-statement.pdf');
const sampleExpected = require('./fixtures/sample-statement.expected.json');

const cents = (s) => Math.round(parseFloat(s) * 100);
const find = (txs, date, description) =>
  txs.find((t) => t.date === date && t.description === description);

describe('sample-statement.pdf (2023 layout)', () => {
  let txs;
  before(async () => {
    txs = await extractTransactions(SAMPLE);
  });

  describe('positive cases', () => {
    it('extracts the date and description of a standard row', () => {
      assert.ok(find(txs, '01 Jul', 'FNB App Transfer To Cash Save'));
    });

    it('formats every date as "DD Mon"', () => {
      for (const t of txs) assert.match(t.date, /^\d{2} [A-Z][a-z]{2}$/);
    });

    it('captures accrued bank charges', () => {
      assert.equal(find(txs, '13 Jul', 'Send Money App Dr Send 0820000004').charges, '9.20');
    });

    it('leaves charges empty when the row has none', () => {
      assert.equal(find(txs, '01 Jul', 'FNB App Transfer To Cash Save').charges, '');
    });

    it('strips thousands separators from amounts and balances', () => {
      const t = find(txs, '01 Jul', 'FNB App Transfer To Cash Save');
      assert.equal(t.amount, '-11720.00');
      assert.equal(t.balance, '12901.18');
    });

    it('keeps a long numeric reference in the description', () => {
      assert.ok(find(txs, '01 Jul', 'FNB App Payment To Invest Co 9000000000001'));
    });

    it('makes credits positive', () => {
      assert.equal(find(txs, '01 Jul', 'FNB App Transfer From Salary').amount, '35000.00');
    });

    it('extracts fee rows that have no description', () => {
      assert.equal(txs.filter((t) => t.date === '28 Jul' && t.description === '').length, 3);
    });

    it('ignores summary rows such as the opening balance, closing balance and turnover', () => {
      assert.ok(txs.every((t) => !/Closing Balance|Turnover|Opening Balance/.test(t.description)));
    });
  });

  describe('regressions', () => {
    it('makes debits negative', () => {
      assert.equal(find(txs, '01 Jul', 'FNB App Transfer To Credit Card Repay').amount, '-28650.00');
    });

    it('makes an overdrawn balance (no Cr suffix) negative', () => {
      assert.equal(find(txs, '17 Jul', 'FNB App Payment To Bathroom Repairs J Doe').balance, '-5550.61');
    });

    it('does not mistake a short numeric reference for the amount', () => {
      const t = find(txs, '30 Jun', 'Scheduled Payment To Body Corp Levy 20');
      assert.ok(t, 'row not found with reference in description');
      assert.equal(t.amount, '-930.00');
      assert.equal(t.balance, '8132.74');
    });

    it('extracts the first transaction on page 1', () => {
      assert.equal(txs[0].date, '29 Jun');
    });

    it('extracts the first transaction on page 2', () => {
      assert.ok(find(txs, '11 Jul', 'Send Money App Dr Send 0820000003'));
    });

    it('reconciles every balance from opening to closing', () => {
      let balance = cents('9163.80');
      for (const t of txs) {
        balance += cents(t.amount);
        assert.equal(balance, cents(t.balance), `balance chain breaks at ${t.date} "${t.description}"`);
      }
      assert.equal(balance, cents('41438.84'));
    });

    it('matches the turnover summary (12 credits R228,920.00, 50 debits R196,644.96)', () => {
      const credits = txs.filter((t) => cents(t.amount) > 0);
      const debits = txs.filter((t) => cents(t.amount) < 0);
      assert.equal(credits.length, 12);
      assert.equal(debits.length, 50);
      assert.equal(credits.reduce((s, t) => s + cents(t.amount), 0), 22892000);
      assert.equal(debits.reduce((s, t) => s - cents(t.amount), 0), 19664496);
    });

    it('extracts the entire statement exactly', () => {
      assert.deepEqual(txs, sampleExpected);
    });
  });
});
