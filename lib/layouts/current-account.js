const { groupRows, findFigure } = require('../pdf');
const { parseMoney, signed, cents, rands } = require('../money');
const { StatementReconciliationError } = require('../errors');

const DATE_PREFIX = /^(\d{2} [A-Z][a-z]{2})\b\s*(.*)$/;
const TURNOVER_LABEL = /^No\. (Credit|Debit) Transactions (\d+)$/;
// Reference numbers sit in their own column just left of the amounts; anything
// starting this far left of the "Amount" header belongs to the description.
const AMOUNT_COLUMN_MARGIN = 20;

function findColumns(items) {
  const amount = items.find((item) => item.str === 'Amount');
  const charges = items.find((item) => item.str === 'Bank');
  if (!amount) return null;
  return {
    amountX: amount.x - AMOUNT_COLUMN_MARGIN,
    chargesX: charges ? charges.x : Infinity,
  };
}

function parseRow(row, columns) {
  const tokens = row.filter((item) => item.str.trim());
  if (!tokens.length) return null;

  const date = tokens[0].str.trim().match(DATE_PREFIX);
  if (!date) return null;

  const descriptionParts = date[2] ? [date[2]] : [];
  const figures = [];
  let charges = '';

  for (const token of tokens.slice(1)) {
    const text = token.str.trim();
    if (token.x < columns.amountX) {
      descriptionParts.push(text);
    } else if (token.x >= columns.chargesX) {
      charges = text;
    } else if (text === 'Cr' && figures.length) {
      figures[figures.length - 1].credit = true;
    } else {
      const money = parseMoney(text);
      if (money) figures.push(money);
    }
  }

  if (figures.length < 2) return null;

  return {
    date: date[1],
    description: descriptionParts.join(' ').trim(),
    amount: signed(figures[0]),
    balance: signed(figures[1]),
    charges,
  };
}

function readSummary(pages) {
  const balance = (name) => {
    const found = findFigure(pages, (text) => text === name);
    return found && found.figure ? signed(found.figure) : null;
  };
  const turnover = (kind) => {
    const found = findFigure(pages, (text) => TURNOVER_LABEL.test(text) && text.includes(kind));
    if (!found || !found.figure) return null;
    return { count: Number(found.label.match(TURNOVER_LABEL)[2]), total: found.figure.value };
  };

  const credits = turnover('Credit');
  const debits = turnover('Debit');
  return {
    openingBalance: balance('Opening Balance'),
    closingBalance: balance('Closing Balance'),
    turnover: credits && debits ? { credits, debits } : null,
  };
}

function parse(pages) {
  const transactions = [];
  let columns = null;

  for (const page of pages) {
    columns = findColumns(page.content) || columns;
    if (!columns) continue;

    for (const row of groupRows(page.content)) {
      const transaction = parseRow(row, columns);
      if (transaction) transactions.push(transaction);
    }
  }

  return { summary: readSummary(pages), transactions };
}

/**
 * Throws StatementReconciliationError unless the transactions walk from the
 * opening to the closing balance row by row and match the turnover summary.
 */
function reconcile({ transactions, summary: { openingBalance, closingBalance, turnover } }) {
  if (openingBalance == null) throw new StatementReconciliationError('Statement has no opening balance');
  if (closingBalance == null) throw new StatementReconciliationError('Statement has no closing balance');

  let balance = cents(openingBalance);
  for (const t of transactions) {
    balance += cents(t.amount);
    if (balance !== cents(t.balance)) {
      throw new StatementReconciliationError(
        `${t.date} "${t.description}": amount ${t.amount} gives balance ${rands(balance)}, statement shows ${t.balance}`,
      );
    }
  }
  if (balance !== cents(closingBalance)) {
    throw new StatementReconciliationError(
      `Transactions end at ${rands(balance)} but the closing balance is ${closingBalance}`,
    );
  }

  if (!turnover) return;
  const checkTurnover = (kind, rows, expected) => {
    const total = Math.abs(rows.reduce((sum, t) => sum + cents(t.amount), 0));
    if (rows.length !== expected.count || total !== cents(expected.total)) {
      throw new StatementReconciliationError(
        `Found ${rows.length} ${kind} transactions totalling ${rands(total)}, statement turnover shows ${expected.count} totalling ${expected.total}`,
      );
    }
  };
  checkTurnover('credit', transactions.filter((t) => cents(t.amount) > 0), turnover.credits);
  checkTurnover('debit', transactions.filter((t) => cents(t.amount) < 0), turnover.debits);
}

module.exports = { type: 'current-account', detect: findColumns, parse, reconcile };
