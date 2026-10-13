const fs = require('fs');
const { PDFExtract } = require('pdf.js-extract');
const { parseMoney } = require('./money');
const { addImageText } = require('./image-text');

const pdfExtract = new PDFExtract();

async function loadPages(pdfPath) {
  if (!fs.existsSync(pdfPath)) throw new Error(`File not found: ${pdfPath}`);
  const data = await pdfExtract.extract(pdfPath, {});
  await addImageText(pdfPath, data.pages);
  return data.pages;
}

function groupRows(items) {
  const yThreshold = 2;
  const rows = {};
  for (const item of items) {
    const rowKey = Math.round(item.y / yThreshold) * yThreshold;
    (rows[rowKey] ||= []).push(item);
  }
  return Object.keys(rows)
    .map(Number)
    .sort((a, b) => a - b)
    .map((y) => rows[y].sort((a, b) => a.x - b.x));
}

function figureRightOf(items, label) {
  const sameRow = items
    .filter((item) => Math.abs(item.y - label.y) < 2 && item.x > label.x)
    .sort((a, b) => a.x - b.x);
  for (const [index, item] of sameRow.entries()) {
    const figure = parseMoney(item.str);
    if (!figure) continue;
    if (sameRow[index + 1]?.str.trim() === 'Cr') figure.credit = true;
    return figure;
  }
  return null;
}

/**
 * The first label matching `matches` that has a money figure to its right on
 * the same line, or failing that the first matching label with `figure: null`.
 */
function findFigure(pages, matches) {
  let found = null;
  for (const page of pages) {
    for (const item of page.content) {
      if (!matches(item.str.trim())) continue;
      const figure = figureRightOf(page.content, item);
      if (figure) return { label: item.str.trim(), figure };
      found ||= { label: item.str.trim(), figure: null };
    }
  }
  return found;
}

module.exports = { loadPages, groupRows, findFigure };
