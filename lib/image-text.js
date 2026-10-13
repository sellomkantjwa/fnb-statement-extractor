const crypto = require('crypto');
const fs = require('fs');
require('pdf.js-extract');
const pdfjs = require('pdf.js-extract/lib/pdfjs/pdf.js');
const { createWorker, OEM, PSM } = require('tesseract.js');
const english = require('@tesseract.js-data/eng');

// Newer FNB statements draw any word containing "#" (e.g. "#Monthly Account Fee",
// "Microsoft#G07335006") as a 1-bit image mask instead of text. This reads those images
// with OCR and adds the result to the page as ordinary text items, so the layouts never
// see the difference.

const MIN_CONFIDENCE = 50;
const OCR_PADDING = 10;
const readingsByImage = new Map();

const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

// An image fills the unit square of its transform; returned in pdf.js-extract coordinates (y down).
function placed(image, matrix, pageHeight) {
  const xs = [matrix[4], matrix[0] + matrix[4]];
  const ys = [pageHeight - matrix[5], pageHeight - (matrix[3] + matrix[5])];
  return {
    image,
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

// pdf.js batches runs of small masks into Group and Repeat operations, so all three are handled.
function masksOn(operatorList, pageHeight) {
  const { OPS } = pdfjs;
  const masks = [];
  const saved = [];
  let ctm = [1, 0, 0, 1, 0, 0];

  operatorList.fnArray.forEach((fn, i) => {
    const args = operatorList.argsArray[i];
    if (fn === OPS.save) saved.push(ctm);
    else if (fn === OPS.restore) ctm = saved.pop() || ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, args);
    else if (fn === OPS.paintImageMaskXObject) masks.push(placed(args[0], ctm, pageHeight));
    else if (fn === OPS.paintImageMaskXObjectGroup) {
      for (const image of args[0]) masks.push(placed(image, multiply(ctm, image.transform), pageHeight));
    } else if (fn === OPS.paintImageMaskXObjectRepeat) {
      const [image, a, b, c, d, positions] = args;
      for (let p = 0; p < positions.length; p += 2) {
        masks.push(placed(image, multiply(ctm, [a, b, c, d, positions[p], positions[p + 1]]), pageHeight));
      }
    }
  });
  return masks;
}

async function imageMasksByPage(pdfPath) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)) }).promise;
  try {
    const pages = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const { height } = page.getViewport({ scale: 1 });
      pages.push(masksOn(await page.getOperatorList(), height));
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

// Mask bits are packed 8 to a byte, rows padded to whole bytes; a 0 bit is ink.
function toPgm({ data, width, height }) {
  const rowBytes = Math.ceil(width / 8);
  const paddedWidth = width + 2 * OCR_PADDING;
  const paddedHeight = height + 2 * OCR_PADDING;
  const pixels = Buffer.alloc(paddedWidth * paddedHeight, 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      if (bit === 0) pixels[(y + OCR_PADDING) * paddedWidth + x + OCR_PADDING] = 0;
    }
  }
  return Buffer.concat([Buffer.from(`P5\n${paddedWidth} ${paddedHeight}\n255\n`), pixels]);
}

async function read(worker, image) {
  const key = crypto
    .createHash('sha1')
    .update(`${image.width}x${image.height}:`)
    .update(image.data)
    .digest('hex');
  if (!readingsByImage.has(key)) {
    const { data } = await worker.recognize(toPgm(image));
    readingsByImage.set(key, { text: data.text.trim(), confidence: data.confidence });
  }
  return readingsByImage.get(key);
}

// Images sit slightly below the text baseline, so line the reading up with the text on its row.
function baselineFor(mask, items) {
  const onRow = items.filter((item) => item.y >= mask.top - 1 && item.y <= mask.bottom + 2);
  if (!onRow.length) return mask.bottom - 1;
  return onRow.reduce((best, item) => (Math.abs(item.y - mask.bottom) < Math.abs(best.y - mask.bottom) ? item : best)).y;
}

/** Adds OCR readings of each page's image masks to `pages[i].content`, in place. */
async function addImageText(pdfPath, pages) {
  const masksByPage = await imageMasksByPage(pdfPath);
  if (!masksByPage.some((masks) => masks.length)) return;

  const worker = await createWorker(english.code, OEM.LSTM_ONLY, {
    langPath: english.langPath,
    gzip: english.gzip,
    cacheMethod: 'none',
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    for (const [index, page] of pages.entries()) {
      const textItems = [...page.content];
      for (const mask of masksByPage[index] || []) {
        const { text, confidence } = await read(worker, mask.image);
        page.content.push({
          x: mask.left,
          y: baselineFor(mask, textItems),
          str: text,
          dir: 'ltr',
          width: mask.right - mask.left,
          height: mask.bottom - mask.top,
          fontName: 'ocr',
          ocrConfidence: confidence,
        });
      }
    }
  } finally {
    await worker.terminate();
  }
}

/** Images whose OCR reading is empty or doubtful, as { page, text, confidence }. */
function unreadableImages(pages) {
  return pages.flatMap((page, index) =>
    page.content
      .filter((item) => item.fontName === 'ocr' && (!item.str || item.ocrConfidence < MIN_CONFIDENCE))
      .map((item) => ({ page: index + 1, text: item.str, confidence: item.ocrConfidence })),
  );
}

module.exports = { addImageText, unreadableImages };
