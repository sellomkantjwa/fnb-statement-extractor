// Thousands are separated by commas on current accounts and spaces on credit cards.
const MONEY = /^((?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})\s*(Cr|Dr)?$/;

function parseMoney(text) {
  const money = text.trim().match(MONEY);
  return money && { value: money[1].replace(/[ ,]/g, ''), credit: money[2] === 'Cr' };
}

// FNB marks credits with "Cr"; an unmarked figure is a debit.
function signed({ value, credit }) {
  return credit || Number(value) === 0 ? value : `-${value}`;
}

const cents = (value) => Math.round(Number(value) * 100);
const rands = (amountInCents) => (amountInCents / 100).toFixed(2);

module.exports = { parseMoney, signed, cents, rands };
