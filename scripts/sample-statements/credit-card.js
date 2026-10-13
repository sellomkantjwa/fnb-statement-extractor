/**
 * Sample credit card statement: the account summary and per-card transaction
 * details of a real statement with fictitious merchants, card numbers, limits and
 * amounts.
 */

const path = require('path');
const { centsOf, fakeAmount, formatLike, rowsOfPage, isMoney, firstWorkingSeed } = require('./figures');

const AMOUNT_COLUMN_MARGIN = 20;
const DETAILS_TOP = 140;
const LAST_ROW_BOTTOM = 790;

// One entry per transaction row, in statement order: merchant, then any
// further cells (place, country, reference) the source row has.
const fakeRows = [
  ['Music Store Online', 'Dublin', 'IE'],
  ['Ride Share Trip', 'Cape Town', 'ZA'],
  ['Streaming Audio', 'Stockholm', 'SE'],
  ['Video Streaming Plus', 'London', 'GB'],
  ['Grocer Rewards Subs', 'Cape Town', 'ZA'],
  ['Example Insurance', 'Metro City ZA'],
  ['Farm Stall One', 'Springfield', 'ZA'],
  ['Farm Stall One', 'Springfield', 'ZA'],
  ['Chicken Shack 1', 'Springfield', 'ZA'],
  ['Bottle Store One', 'Springfield', 'ZA'],
  ['Supermarket One', 'Springfield', 'ZA'],
  ['Hardware Store 100001', 'Riverside', 'ZA'],
  ['Bakery Two', 'Hilltown', 'ZA'],
  ['Supermarket Two', 'Hilltown', 'ZA'],
  ['Homeware Plaza', 'Hilltown', 'ZA'],
  ['Pharmacy Two', 'Hilltown', 'ZA'],
  ['Corner Cafe', 'Hilltown', 'ZA'],
  ['Fuel Stop Two', 'Hilltown', 'ZA'],
  ['Chicken Shack 2', 'Hilltown', 'ZA'],
  ['Supermarket Three', 'Hilltown', 'ZA'],
  ['Home Goods 0001', 'Hilltown', 'ZA'],
  ['Department Store', 'Hilltown', 'ZA'],
  ['Butchery Three', 'Lakeside', 'ZA'],
  ['Supermarket Four', 'Lakeside', 'ZA'],
  ['Supermarket Five', 'Lakeside', 'ZA'],
  ['Fresh Market', 'Northtown', 'ZA'],
  ['Chicken Shack 3', 'Westtown', 'ZA'],
  ['Bottle Store Two', 'Metro City ZA'],
  ['Grill House', 'Easttown', 'ZA'],
  ['Grill House', 'Easttown', 'ZA'],
  ['Butchery Four', 'Northtown', 'ZA'],
  ['Fuel Stop Three', 'Metro City ZA'],
  ['Hot Dog Stand', '100002', 'Northtown', 'ZA'],
  ['Department Store', 'Northtown', 'ZA'],
  ['Chicken Shack 4', 'Southtown', 'ZA'],
  ['Pharmacy Three', 'Northtown', 'ZA'],
  ['Cocktail Bar', 'Midtown', 'ZA'],
  ['Card Reader', '*Dumpling Bar', 'Midtown', 'ZA'],
  ['Chicken Shack 4', 'Southtown', 'ZA'],
  ['Coffee Corner', 'Metro City ZA'],
  ['Coffee Corner', 'Metro City ZA'],
  ['Medical Centre', 'Northtown', 'ZA'],
  ['Fresh Market', 'Northtown', 'ZA'],
  ['Fuel Stop Four', 'Northtown', 'ZA'],
  ['Chicken Shack 5', 'Northtown', 'ZA'],
  ['Grill House', 'Easttown', 'ZA'],
  ['Grill House', 'Easttown', 'ZA'],
  ['#Int Pymt Fee-music.Sto', 'Re'],
  ['#Int Pymt Fee-video.Str', 'Eam'],
  ['#Int Pymt Fee-streaming', 'Plus'],
  ['Bottle Store One', 'Springfield'],
  ['Farm Stall One', 'Springfield'],
  ['Supermarket Two', 'Hilltown'],
  ['Supermarket Two', 'Hilltown'],
  ['Clothing Store', 'Southtown'],
  ['Shopping Plaza', 'Southtown'],
  ['Tap And Go Kiosk', 'Easttown'],
  ['#Credit Card Account Fee'],
  ['#Credit Facility Service Fee'],
  ['#Cash Transaction Fee'],
  ['Interest On Credit Balance'],
  ['Interest'],
  ['Transfer Savings', 'Ref0000001', 'ABC'],
  ['Transfer Household', 'Ref0000002', 'ABC'],
];

const fakeCards = new Map();
function fakeCard(real) {
  if (!fakeCards.has(real)) fakeCards.set(real, `4000 00** **** ${String(fakeCards.size + 1).padStart(4, '0')}`);
  return fakeCards.get(real);
}

// Page 1: only the account summary table (right of the spending chart).
// Later pages: the transaction details, without page headers, footers or the account number.
function section(page, pageIndex) {
  const items = page.content;
  if (pageIndex === 0) {
    const top = items.find((i) => i.str === 'Straight');
    const bottom = items.find((i) => i.str === 'Overdue Amount');
    if (!top || !bottom) return [];
    return items.filter((i) => i.x >= 270 && i.y >= top.y - 1 && i.y <= bottom.y + 1);
  }
  const closing = items.find((i) => i.str === 'Closing Balance');
  const bottom = closing ? closing.y + 1 : LAST_ROW_BOTTOM;
  return items.filter((i) => i.y >= DETAILS_TOP && i.y <= bottom);
}

function amountColumnX(items) {
  if (!items.some((i) => i.str === 'Transaction Details')) return null;
  return items.find((i) => i.str === 'Straight').x - AMOUNT_COLUMN_MARGIN;
}

function rewrite(text) {
  const card = text.match(/^Card No\. (.+)$/);
  return card ? `Card No. ${fakeCard(card[1])}` : text;
}

const SEED = 2025;
const BUDGET_COLUMN_MARGIN = 10;
const DATE = /^\d{2} [A-Z][a-z]{2}$/;
const FAKE_LIMIT = 6000000;
const FAKE_BUDGET_LIMIT = 500000;
const signedCents = (item) => centsOf(item.str) * (/Cr\s*$/.test(item.str) ? 1 : -1);

// Every transaction gets a fictitious amount; card totals, "Used", its breakdown, the opening and closing
// balances and the limits are rewritten to match. Rows starting "Transfer" are the account's payments.
function refigure(pages) {
  const summary = {};
  const repeated = { opening: [], closing: [] };
  const transactions = [];
  const cardTotals = [];
  let columns = null;
  let card = null;

  pages.forEach((page, pageIndex) => {
    const details = page.items.some((i) => i.str === 'Transaction Details');
    if (details) {
      const straight = page.items.find((i) => i.str === 'Straight');
      const budget = page.items.find((i) => i.str === 'Budget');
      columns = { amountX: straight.x - AMOUNT_COLUMN_MARGIN, budgetX: budget ? budget.x - BUDGET_COLUMN_MARGIN : Infinity };
    }
    for (const tokens of rowsOfPage(page)) {
      const first = tokens[0]?.str.trim() ?? '';
      if (pageIndex === 0) {
        const budgetX = page.items.find((i) => i.str === 'Budget').x - BUDGET_COLUMN_MARGIN;
        const money = tokens.filter(isMoney);
        summary[first] = { straight: money.find((i) => i.x < budgetX), budget: money.find((i) => i.x >= budgetX) };
        continue;
      }
      if (!columns) continue;
      const amountItem = tokens.filter((t) => isMoney(t) && t.x >= columns.amountX && t.x < columns.budgetX).pop();
      if (first === 'Opening Balance') repeated.opening.push(amountItem);
      else if (first === 'Closing Balance') repeated.closing.push(amountItem);
      else if (/^Card No\. /.test(first)) card = first;
      else if (first === 'Card Total') {
        cardTotals.push({ card, item: amountItem });
        card = null;
      } else if (DATE.test(first) && amountItem) {
        const description = tokens.slice(1).map((t) => t.str.trim()).join(' ');
        transactions.push({ card, item: amountItem, amount: signedCents(amountItem), payment: description.startsWith('Transfer') });
      }
    }
  });

  const opening = signedCents(summary['Opening Balance'].straight);
  const closing = signedCents(summary['Closing Balance'].straight);
  const fake = firstWorkingSeed(SEED, (random) => {
    const newOpening = fakeAmount(opening, random);
    const amounts = transactions.map((t) => fakeAmount(t.amount, random));
    const newClosing = newOpening + amounts.reduce((a, b) => a + b, 0);
    if (Math.sign(newClosing) !== Math.sign(closing)) return null;
    return { opening: newOpening, closing: newClosing, amounts };
  });

  transactions.forEach((t, i) => {
    t.item.str = formatLike(t.item.str, fake.amounts[i], ' ');
  });
  const total = (filter) => transactions.reduce((sum, t, i) => (filter(t) ? sum + fake.amounts[i] : sum), 0);
  for (const { card: c, item } of cardTotals) item.str = formatLike(item.str, total((t) => t.card === c), ' ');

  const used = -total((t) => t.card);
  const cashOut = Math.min(Math.round(centsOf(summary['Cash / Transfers Out'].straight.str) * 0.8), used);
  const set = (label, cents, facility = 'straight') => {
    const item = summary[label][facility];
    item.str = formatLike(item.str, cents, ' ');
  };
  set('Limit', FAKE_LIMIT);
  set('Limit', FAKE_BUDGET_LIMIT, 'budget');
  set('Opening Balance', fake.opening);
  set('Used', used);
  set('Goods & Services', used - cashOut);
  set('Cash / Transfers Out', cashOut);
  set('Interest / Fees', -total((t) => !t.card && !t.payment));
  set('Payments Received', total((t) => t.payment));
  set('Closing Balance', fake.closing);
  set('Available Balance', FAKE_LIMIT + Math.min(fake.closing, 0));
  set('Available Balance', FAKE_BUDGET_LIMIT, 'budget');
  for (const item of repeated.opening) item.str = formatLike(item.str, fake.opening, ' ');
  for (const item of repeated.closing) item.str = formatLike(item.str, fake.closing, ' ');
}

module.exports = {
  name: 'credit card',
  source: path.join(__dirname, '..', '..', 'credit2025.pdf'),
  output: path.join(__dirname, '..', '..', 'test', 'fixtures', 'sample-credit-card.pdf'),
  section,
  amountColumnX,
  rewrite,
  refigure,
  fakeRows,
  fakeCard,
};
