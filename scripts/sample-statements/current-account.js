/**
 * Sample current account statement (2023 layout): the statement summary and
 * transaction table of a real statement with fictitious descriptions and
 * amounts. FNB's fees and the bank-charges column are kept.
 */

const path = require('path');
const { centsOf, fakeAmount, formatLike, rowsOfPage, isMoney, firstWorkingSeed } = require('./figures');

const AMOUNT_COLUMN_MARGIN = 20;
const SECTION_STARTS = ['Statement Balances', 'Transactions in RAND'];
const SECTION_END = 'No. Debit Transactions';
const DATE_PREFIX = /^\d{2} [A-Z][a-z]{2}\b/;

// One entry per transaction row, in statement order: [description, reference?].
// Rows whose description cell is blank in the source are [].
const fakeRows = [
  ['Airtime Topup Airtime 0820000001'],
  ['Scheduled Payment To Body Corp Levy', '20'],
  ['Internet Trf From Home Projects'],
  ['Internet Pmt To Body Corp Deposit'],
  ['FNB App Transfer From Salary'],
  ['DebiCheck Home Loan 4000000001'],
  ['Scheduled Payment To Monthly Account Fee'],
  ['FNB App Transfer From Salary'],
  ['FNB App Transfer To Credit Card Repay'],
  ['FNB App Payment To Invest Co', '9000000000001'],
  ['FNB App Transfer To Cash Save'],
  ['FNB App Transfer To Interest Saver'],
  ['FNB App Payment To Unit 12 Levies', 'Lev0012A'],
  ['FNB App Payment To Family', 'J Doe'],
  ['Payment To Investment Car Costs'],
  ['FNB App Transfer From Last Month Surplus'],
  ['Payment To Investment Last Month Surplus'],
  ['DebiCheck Home Loan 4000000002'],
  ['Airtime Topup Airtime 0820000001'],
  ['Airtime Topup Airtime 0820000001'],
  ['Send Money App Dr Send 0820000002'],
  ['Airtime Topup Airtime 0820000001'],
  ['FNB App Transfer From Project Phase 2'],
  ['FNB App Payment To Contractor 2'],
  ['FNB App Payment To Corner Shop'],
  ['Send Money App Dr Send 0820000003'],
  ['Airtime Topup Airtime 0820000001'],
  ['Send Money App Dr Send 0820000004'],
  ['FNB App Transfer From Project Phase 3'],
  ['FNB App Payment To Contractor 3'],
  ['Airtime Topup Airtime 0820000001'],
  ['Airtime Topup Airtime 0820000001'],
  ['Airtime Topup Airtime 0820000001'],
  ['FNB App Payment To Bathroom Repairs', 'J Doe'],
  ['FNB App Transfer From Salary'],
  ['Internet Trf From Project Renovations'],
  ['Internet Pmt To Contractor 4'],
  ['Send Money Dr Send 0820000005'],
  ['Internet Pmt To Business Account'],
  ['Internet Trf From Salary'],
  ['FNB App Payment To Contractor 5'],
  ['Send Money App Dr Send 0820000004'],
  ['Send Money Dr Send 0820000004'],
  ['Send Money App Dr Send 0820000004'],
  ['Electricity Prepaid Electricity 01000000001'],
  ['Send Money App Dr Send 0820000006'],
  ['Scheduled Payment To City Rates', '500000001'],
  ['Schd Trxn No Av Bal Pmt To Unit Levies'],
  [],
  ['Internet Trf From Salary'],
  ['Internet Trf To Credit Card Repayment'],
  ['Internet Pmt To Invest Co', '9000000000001'],
  ['Internet Trf To Interest Saver'],
  ['Payment To Investment Car Things'],
  ['Scheduled Payment To Storage Unit B12', 'Doe/B12'],
  ['FNB App Payment From Flat Rent'],
  ['Magtape Credit Example Tenant'],
  ['DebiCheck Vehicle Finance 7000000001'],
  ['Internal Debit Order Home Loan 00004000000000001'],
  ['Magtape Debit Mobile 0100000001 M0000001'],
  [],
  [],
  [],
];

function section(page) {
  const items = page.content;
  const start = items.find((i) => SECTION_STARTS.some((s) => i.str.startsWith(s)));
  if (!start) return [];
  const end = items.find((i) => i.str.startsWith(SECTION_END));
  const dateRows = items.filter((i) => DATE_PREFIX.test(i.str));
  const endY = end ? end.y : Math.max(...dateRows.map((i) => i.y));
  const footer = items.filter((i) => /^Page \d+ of \d+$/.test(i.str));
  return [...items.filter((i) => i.y >= start.y - 1 && i.y <= endY + 1), ...footer];
}

function amountColumnX(items) {
  const header = items.find((i) => i.str === 'Amount');
  return header ? header.x - AMOUNT_COLUMN_MARGIN : null;
}

const SEED = 2026;
const SALARY = 3500000;
const isCr = (item) => item.str.trim() === 'Cr';

// Every transaction amount gets a fictitious value, and every salary the same fixed one; balances, the
// closing balance and the turnover totals are recomputed from them so the sample still reconciles. Bank
// charges are FNB's published fees and stay.
function refigure(pages) {
  const rows = [];
  const summary = { opening: [], closing: [], credits: [], debits: [] };
  let columns = null;

  for (const page of pages) {
    const amount = page.items.find((i) => i.str === 'Amount');
    const bank = page.items.find((i) => i.str === 'Bank');
    if (amount) columns = { amountX: amount.x - AMOUNT_COLUMN_MARGIN, chargesX: bank ? bank.x : Infinity };

    for (const tokens of rowsOfPage(page)) {
      const first = tokens[0]?.str.trim() ?? '';
      const money = tokens.filter(isMoney);
      if (first === 'Opening Balance') summary.opening.push(money[0]);
      else if (first === 'Closing Balance') summary.closing.push(money[0]);
      else if (/^No\. Credit Transactions/.test(first)) summary.credits.push(money[0]);
      else if (/^No\. Debit Transactions/.test(first)) summary.debits.push(money[0]);
      else if (columns && DATE_PREFIX.test(first)) {
        const [amountItem, balanceItem] = money.filter((i) => i.x >= columns.amountX && i.x < columns.chargesX);
        const creditAfter = (item, before) =>
          parseCredit(item) || tokens.some((t) => isCr(t) && t.x > item.x && t.x < before);
        rows.push({
          salary: tokens.some((t) => /From Salary/.test(t.str)),
          amountItem,
          balanceItem,
          amount: centsOf(amountItem.str) * (creditAfter(amountItem, balanceItem.x) ? 1 : -1),
          balance: centsOf(balanceItem.str) * (creditAfter(balanceItem, columns.chargesX) ? 1 : -1),
        });
      }
    }
  }

  const opening = centsOf(summary.opening[0].str) * (parseCredit(summary.opening[0]) ? 1 : -1);
  const fake = firstWorkingSeed(SEED, (random) => {
    const newOpening = fakeAmount(opening, random);
    let balance = newOpening;
    const result = rows.map((row) => {
      const amount = row.salary && row.amount > 0 ? SALARY : fakeAmount(row.amount, random);
      balance += amount;
      return { amount, balance };
    });
    const signsMatch = result.every((r, i) => Math.sign(r.balance) === Math.sign(rows[i].balance));
    return signsMatch ? { opening: newOpening, rows: result } : null;
  });

  rows.forEach((row, i) => {
    row.amountItem.str = formatLike(row.amountItem.str, fake.rows[i].amount, ',');
    row.balanceItem.str = formatLike(row.balanceItem.str, fake.rows[i].balance, ',');
  });
  const closing = fake.rows[fake.rows.length - 1].balance;
  const sum = (filter) => fake.rows.map((r) => r.amount).filter(filter).reduce((a, b) => a + b, 0);
  for (const item of summary.opening) item.str = formatLike(item.str, fake.opening, ',');
  for (const item of summary.closing) item.str = formatLike(item.str, closing, ',');
  for (const item of summary.credits) item.str = formatLike(item.str, sum((a) => a > 0), ',');
  for (const item of summary.debits) item.str = formatLike(item.str, sum((a) => a < 0), ',');
}

const parseCredit = (item) => /Cr\s*$/.test(item.str);

const rewrite = (text) => (text.startsWith('Transactions in RAND') ? 'Transactions in RAND (ZAR)' : text);

module.exports = {
  name: 'current account',
  source: path.join(__dirname, '..', '..', 'jul23.pdf'),
  output: path.join(__dirname, '..', '..', 'test', 'fixtures', 'sample-statement.pdf'),
  section,
  amountColumnX,
  rewrite,
  refigure,
  fakeRows,
};
