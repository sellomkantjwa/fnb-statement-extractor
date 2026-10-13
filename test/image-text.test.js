const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PDFDocument,
  StandardFonts,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  drawObject,
} = require('pdf-lib');
const { extractStatement } = require('..');

// 1-bit image masks of labels cut from real FNB statements, which draw any word containing "#"
// as an image instead of text.
const LABELS = require('./fixtures/fnb-label-images.json');
const PAGE_HEIGHT = 842;
const POINTS_PER_PIXEL = 72 / 300;

// Draws [x, y-from-top, text] cells and [x, y-from-top, { image }] cells onto one page. Images are
// placed with their bottom edge just below the text baseline, as FNB does.
async function writeStatementPdf(cells) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, PAGE_HEIGHT]);
  for (const [x, y, content] of cells) {
    if (typeof content === 'string') {
      page.drawText(content, { x, y: PAGE_HEIGHT - y, size: 8, font });
      continue;
    }
    const { width, height, bits } = content.image;
    const mask = doc.context.register(
      doc.context.stream(Buffer.from(bits, 'base64'), {
        Type: 'XObject',
        Subtype: 'Image',
        Width: width,
        Height: height,
        ImageMask: true,
        BitsPerComponent: 1,
      }),
    );
    const name = page.node.newXObject('Mask', mask);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(width * POINTS_PER_PIXEL, 0, 0, height * POINTS_PER_PIXEL, x, PAGE_HEIGHT - y - 1.2),
      drawObject(name),
      popGraphicsState(),
    );
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fnb-')), 'statement.pdf');
  fs.writeFileSync(file, await doc.save());
  return file;
}

const label = (text) => ({ image: LABELS[text] });
const summary = [
  [20, 50, 'Opening Balance'], [175, 50, '500.00 Cr'],
  [20, 60, 'Closing Balance'], [175, 60, '381.00 Cr'],
];
const header = [[16, 100, 'Date'], [209, 100, 'Description'], [437, 100, 'Amount'], [499, 100, 'Balance'], [554, 100, 'Bank']];

describe('descriptions drawn as images', () => {
  it('reads a description drawn entirely as an image', async () => {
    const file = await writeStatementPdf([
      ...summary,
      ...header,
      [12, 120, '18 May'], [38, 120, label('#Monthly Account Fee')], [444, 120, '85.00'], [507, 120, '415.00 Cr'],
      [12, 130, '18 May'], [38, 130, label('#Service Fees')], [444, 130, '34.00'], [507, 130, '381.00 Cr'],
    ]);
    const { transactions } = await extractStatement(file);
    assert.deepEqual(
      transactions.map((t) => [t.description, t.amount]),
      [['#Monthly Account Fee', '-85.00'], ['#Service Fees', '-34.00']],
    );
  });

  it('stitches an image word into the text around it', async () => {
    const file = await writeStatementPdf([
      ...summary,
      ...header,
      [12, 120, '18 Jan'], [38, 120, label('#Service')], [65, 120, 'Fees'], [444, 120, '119.00'], [507, 120, '381.00 Cr'],
    ]);
    const { transactions } = await extractStatement(file);
    assert.equal(transactions[0].description, '#Service Fees');
  });

  it('reports nothing when every image reads confidently', async () => {
    const file = await writeStatementPdf([
      ...summary,
      ...header,
      [12, 120, '18 May'], [38, 120, label('#Service Fees')], [444, 120, '119.00'], [507, 120, '381.00 Cr'],
    ]);
    const { unreadableImages } = await extractStatement(file);
    assert.deepEqual(unreadableImages, []);
  });

  it('reports an image it cannot read', async () => {
    const blank = { width: 64, height: 20, bits: Buffer.alloc(8 * 20, 0xff).toString('base64') };
    const file = await writeStatementPdf([
      ...summary,
      ...header,
      [12, 120, '18 May'], [38, 120, { image: blank }], [444, 120, '119.00'], [507, 120, '381.00 Cr'],
    ]);
    const { unreadableImages } = await extractStatement(file);
    assert.equal(unreadableImages.length, 1);
    assert.equal(unreadableImages[0].page, 1);
  });

  it('leaves statements without images untouched', async () => {
    const file = await writeStatementPdf([
      ...summary,
      ...header,
      [12, 120, '18 May'], [38, 120, 'Groceries'], [444, 120, '119.00'], [507, 120, '381.00 Cr'],
    ]);
    const { transactions, unreadableImages } = await extractStatement(file);
    assert.equal(transactions[0].description, 'Groceries');
    assert.deepEqual(unreadableImages, []);
  });
});
