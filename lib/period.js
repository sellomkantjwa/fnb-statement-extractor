const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PERIOD = /^Statement Period : (\d{1,2}) ([A-Za-z]+) (\d{4}) to (\d{1,2}) ([A-Za-z]+) (\d{4})$/;
const ACCOUNT = /^[A-Za-z ]+ Account : (\d+)$/;

const pad = (n) => String(n).padStart(2, '0');
const monthNumber = (name) => MONTHS.indexOf(name.slice(0, 3)) + 1;
const isoDay = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

function firstMatch(pages, pattern) {
  for (const page of pages) {
    for (const item of page.content) {
      const match = item.str.trim().match(pattern);
      if (match) return match;
    }
  }
  return null;
}

/** The statement's "Statement Period" as { from, to } ISO dates, or null if it isn't printed. */
function readPeriod(pages) {
  const match = firstMatch(pages, PERIOD);
  if (!match) return null;
  const [, fromDay, fromMonth, fromYear, toDay, toMonth, toYear] = match;
  return {
    from: isoDay(fromYear, monthNumber(fromMonth), fromDay),
    to: isoDay(toYear, monthNumber(toMonth), toDay),
  };
}

function readAccountNumber(pages) {
  const match = firstMatch(pages, ACCOUNT);
  return match ? match[1] : null;
}

/**
 * Converts a "DD Mon" transaction date to ISO using the statement period for the year. A period
 * that crosses a year end puts months from the start month onwards in the start year.
 */
function isoDate(date, period) {
  if (!period) return null;
  const [day, monthName] = date.split(' ');
  const month = monthNumber(monthName);
  const fromYear = Number(period.from.slice(0, 4));
  const fromMonth = Number(period.from.slice(5, 7));
  const toYear = Number(period.to.slice(0, 4));
  const year = fromYear !== toYear && month >= fromMonth ? fromYear : toYear;
  return isoDay(year, month, day);
}

module.exports = { readPeriod, readAccountNumber, isoDate };
