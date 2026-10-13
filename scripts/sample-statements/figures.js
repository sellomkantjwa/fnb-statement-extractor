/**
 * Helpers for replacing a real statement's figures with fictitious ones that still add up.
 */

const { parseMoney } = require('../../lib/money');
const { groupRows } = require('../../lib/pdf');

// mulberry32: a small seeded generator, so regenerating a sample gives the same figures.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const centsOf = (text) => Math.round(Number(parseMoney(text).value) * 100);

/** A random amount of roughly the same size and the same sign; round amounts stay round. */
function fakeAmount(cents, random) {
  if (cents === 0) return 0;
  const size = Math.abs(cents);
  let fake = Math.round(size * (0.55 + random() * 0.9));
  if (size >= 10000 && size % 1000 === 0) fake = Math.round(fake / 1000) * 1000;
  return Math.sign(cents) * Math.max(fake, 1);
}

/**
 * `cents` written the way `original` was written: same thousands separator, same padding and the same
 * "Cr"/"Dr" suffix, which the caller keeps valid by never changing a figure's sign.
 */
function formatLike(original, cents, separator) {
  const [, lead, , suffix] = original.match(/^(\s*)(.*?\d)(\s*(?:Cr|Dr)?\s*)$/);
  const [whole, fraction] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `${lead}${whole.replace(/\B(?=(\d{3})+$)/g, separator)}.${fraction}${suffix}`;
}

const rowsOfPage = (page) => groupRows(page.items).map((row) => row.filter((item) => item.str.trim()));
const isMoney = (item) => Boolean(parseMoney(item.str));

/** Tries seeds from `seed` upwards until `attempt(random)` returns a result rather than null. */
function firstWorkingSeed(seed, attempt) {
  for (let s = seed; s < seed + 10000; s++) {
    const result = attempt(seededRandom(s));
    if (result) return result;
  }
  throw new Error('No seed produced figures with the same signs as the source');
}

module.exports = { centsOf, fakeAmount, formatLike, rowsOfPage, isMoney, firstWorkingSeed };
