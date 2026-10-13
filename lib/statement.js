const path = require('path');
const { loadPages } = require('./pdf');
const { unreadableImages } = require('./image-text');
const { readPeriod, readAccountNumber, isoDate } = require('./period');
const { UnsupportedStatementError } = require('./errors');
const currentAccount = require('./layouts/current-account');
const creditCard = require('./layouts/credit-card');

const LAYOUTS = [currentAccount, creditCard];

function layoutOf(type) {
  const layout = LAYOUTS.find((l) => l.type === type);
  if (!layout) throw new UnsupportedStatementError(`Unknown statement type: ${type}`);
  return layout;
}

/**
 * Parse an FNB statement PDF without verifying it. Returns its type, account
 * number and period, the summary figures printed on it, its transactions, and
 * any text images OCR could not read confidently. Amounts are signed strings:
 * credits positive, debits negative. Account number, period and each
 * transaction's isoDate are null when the statement doesn't print a period.
 */
async function extractStatement(pdfPath) {
  const pages = await loadPages(pdfPath);
  const layout = LAYOUTS.find((l) => pages.some((page) => l.detect(page.content)));
  if (!layout) {
    throw new UnsupportedStatementError(`${path.basename(pdfPath)} has no recognised FNB transaction table`);
  }
  const { transactions, ...parsed } = layout.parse(pages);
  const period = readPeriod(pages);
  return {
    type: layout.type,
    accountNumber: readAccountNumber(pages),
    period,
    ...parsed,
    transactions: transactions.map((t) => ({ ...t, isoDate: isoDate(t.date, period) })),
    unreadableImages: unreadableImages(pages),
  };
}

/** Throws StatementReconciliationError unless the statement's transactions add up to its summary. */
function reconcile(statement) {
  layoutOf(statement.type).reconcile(statement);
}

/**
 * Extract the transactions from an FNB statement PDF, throwing
 * StatementReconciliationError if they don't reconcile with the statement.
 */
async function extractTransactions(pdfPath) {
  const statement = await extractStatement(pdfPath);
  reconcile(statement);
  return statement.transactions;
}

module.exports = { extractStatement, extractTransactions, reconcile };
