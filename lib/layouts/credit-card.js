const { groupRows, findFigure } = require('../pdf');
const { parseMoney, signed, cents, rands } = require('../money');
const { StatementReconciliationError, UnsupportedStatementError } = require('../errors');

const DATE = /^\d{2} [A-Z][a-z]{2}$/;
const CARD_HEADER = /^Card No\. (.+)$/;
// Merchant, place and country cells sit left of this margin before the "Straight" facility header.
const AMOUNT_COLUMN_MARGIN = 20;
const BUDGET_COLUMN_MARGIN = 10;

// Page 1's account summary also has a "Straight" column, so only a page with
// the "Transaction Details" header defines the transaction columns.
function findColumns(items) {
  if (!items.some((item) => item.str === 'Transaction Details')) return null;
  const straight = items.find((item) => item.str === 'Straight');
  const budget = items.find((item) => item.str === 'Budget');
  if (!straight) return null;
  return {
    amountX: straight.x - AMOUNT_COLUMN_MARGIN,
    budgetX: budget ? budget.x - BUDGET_COLUMN_MARGIN : Infinity,
  };
}

function amountIn(tokens, columns) {
  let figure = null;
  for (const token of tokens) {
    if (token.x < columns.amountX) continue;
    const text = token.str.trim();
    if (text === 'Cr' && figure) {
      figure.credit = true;
      continue;
    }
    const money = parseMoney(text);
    if (!money) continue;
    if (token.x >= columns.budgetX) {
      throw new UnsupportedStatementError(
        `Budget facility transactions are not supported: "${tokens.map((t) => t.str.trim()).join(' ')}"`,
      );
    }
    figure = money;
  }
  return figure;
}

function readSummary(pages) {
  const figure = (name) => {
    const found = findFigure(pages, (text) => text === name);
    return found && found.figure ? signed(found.figure) : null;
  };
  return {
    openingBalance: figure('Opening Balance'),
    closingBalance: figure('Closing Balance'),
    used: figure('Used'),
  };
}

/**
 * Transactions are grouped under "Card No." headers and closed by a
 * "Card Total" line; fees, interest and payments follow outside any card.
 */
function parse(pages) {
  const transactions = [];
  const cardTotals = [];
  let columns = null;
  let card = null;

  for (const page of pages) {
    columns = findColumns(page.content) || columns;
    if (!columns) continue;

    for (const row of groupRows(page.content)) {
      const tokens = row.filter((item) => item.str.trim());
      if (!tokens.length) continue;
      const first = tokens[0].str.trim();

      const cardHeader = first.match(CARD_HEADER);
      if (cardHeader) {
        card = cardHeader[1];
      } else if (first === 'Card Total') {
        const total = amountIn(tokens, columns);
        if (total) cardTotals.push({ card, total: signed(total) });
        card = null;
      } else if (DATE.test(first)) {
        const amount = amountIn(tokens.slice(1), columns);
        if (!amount) continue;
        const description = tokens
          .slice(1)
          .filter((t) => t.x < columns.amountX)
          .map((t) => t.str.trim())
          .join(' ');
        transactions.push({ date: first, description, amount: signed(amount), card });
      }
    }
  }

  return { summary: { ...readSummary(pages), cardTotals }, transactions };
}

/**
 * There is no running balance, so this checks each card against its card
 * total, all card transactions against the amount used, and every transaction
 * against the move from opening to closing balance.
 */
function reconcile({ transactions, summary: { openingBalance, closingBalance, used, cardTotals } }) {
  if (openingBalance == null) throw new StatementReconciliationError('Statement has no opening balance');
  if (closingBalance == null) throw new StatementReconciliationError('Statement has no closing balance');

  const sum = (rows) => rows.reduce((total, t) => total + cents(t.amount), 0);
  const cardTransactions = transactions.filter((t) => t.card);

  for (const card of new Set(cardTransactions.map((t) => t.card))) {
    if (!cardTotals.some((t) => t.card === card)) {
      throw new StatementReconciliationError(`Card ${card} has transactions but no card total on the statement`);
    }
  }
  for (const { card, total } of cardTotals) {
    const actual = sum(cardTransactions.filter((t) => t.card === card));
    if (actual !== cents(total)) {
      throw new StatementReconciliationError(
        `Card ${card}: transactions total ${rands(actual)}, statement card total shows ${total}`,
      );
    }
  }

  if (used != null && sum(cardTransactions) !== cents(used)) {
    throw new StatementReconciliationError(
      `Card transactions total ${rands(sum(cardTransactions))}, statement shows ${used} used`,
    );
  }

  const closing = cents(openingBalance) + sum(transactions);
  if (closing !== cents(closingBalance)) {
    throw new StatementReconciliationError(
      `Transactions end at ${rands(closing)} but the closing balance is ${closingBalance}`,
    );
  }
}

module.exports = { type: 'credit-card', detect: findColumns, parse, reconcile };
