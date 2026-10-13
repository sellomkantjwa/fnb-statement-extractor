/**
 * Redraws the parts of a real statement that a config selects onto blank
 * pages, at their original positions, replacing every transaction's
 * description cells with fictitious text and every figure with a fictitious
 * one that still reconciles. Dates are kept.
 *
 * A config provides:
 *   source, output        PDF paths
 *   section(page, index)  the text items of a page to carry over
 *   amountColumnX(items)  x where a page's figure columns start, or null to keep the previous page's
 *   rewrite(text)         replacement for carried-over text outside transaction rows
 *   fakeRows              per transaction row, in order: one string per description cell
 *   refigure(pages)       replaces the redrawn figures in place with fictitious ones
 */

const fs = require('fs');
const path = require('path');
const { PDFExtract } = require('pdf.js-extract');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const DATE_PREFIX = /^\d{2} [A-Z][a-z]{2}\b/;
const TITLE = 'SAMPLE STATEMENT - FICTITIOUS DATA FOR TESTING ONLY';

function rowsOf(items) {
  const rows = new Map();
  for (const item of items) {
    const key = Math.round(item.y);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(item);
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row.sort((a, b) => a.x - b.x));
}

function anonymise(pages, config) {
  let rowIndex = 0;
  let amountX = null;

  const result = pages.map((page, pageIndex) => {
    amountX = config.amountColumnX(page.content) ?? amountX;

    const items = [];
    for (const row of rowsOf(config.section(page, pageIndex))) {
      const firstText = row.find((i) => i.str.trim());
      if (!firstText || !DATE_PREFIX.test(firstText.str.trim())) {
        for (const item of row) items.push({ ...item, str: config.rewrite(item.str) });
        continue;
      }

      const fake = config.fakeRows[rowIndex];
      if (!fake) throw new Error(`No fake description for transaction row ${rowIndex + 1}`);
      const descriptionCells = row.filter((i) => i !== firstText && i.str.trim() && i.x < amountX);
      if (descriptionCells.length !== fake.length) {
        throw new Error(
          `Row ${rowIndex + 1} (${firstText.str}) has ${descriptionCells.length} description cells, fake has ${fake.length}`,
        );
      }

      for (const item of row) {
        const cell = descriptionCells.indexOf(item);
        items.push(cell === -1 ? item : { ...item, str: fake[cell] });
      }
      rowIndex++;
    }

    return { width: page.pageInfo.width, height: page.pageInfo.height, items };
  });

  if (rowIndex !== config.fakeRows.length) {
    throw new Error(`Source has ${rowIndex} transaction rows, fakeRows has ${config.fakeRows.length}`);
  }
  return result;
}

async function buildSample(config) {
  const source = await new PDFExtract().extract(config.source, {});
  const pages = anonymise(source.pages, config);
  config.refigure(pages);

  const doc = await PDFDocument.create();
  doc.setTitle('Sample statement - fictitious data');
  doc.setProducer('scripts/sample-statements');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  pages.forEach((p, index) => {
    const page = doc.addPage([p.width, p.height]);
    if (index === 0) {
      page.drawText(TITLE, { x: 20, y: p.height - 60, size: 14, font: bold, color: rgb(0.7, 0, 0) });
    }
    for (const item of p.items) {
      page.drawText(item.str, { x: item.x, y: p.height - item.y, size: item.height, font });
    }
  });

  fs.writeFileSync(config.output, await doc.save());
  console.log(`Wrote ${path.relative(process.cwd(), config.output)}`);
}

module.exports = { buildSample };
