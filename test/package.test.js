const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const extractor = require('..');

const CLI = path.join(__dirname, '..', 'bin', 'fnb-extract.js');
const SAMPLE = path.join(__dirname, 'fixtures', 'sample-statement.pdf');

describe('package entry point', () => {
  it('exports the extraction functions and error classes', () => {
    for (const name of ['extractStatement', 'extractTransactions', 'reconcile']) {
      assert.equal(typeof extractor[name], 'function', name);
    }
    assert.ok(new extractor.StatementReconciliationError('x') instanceof Error);
    assert.ok(new extractor.UnsupportedStatementError('x') instanceof Error);
  });
});

describe('fnb-extract', () => {
  it('prints the reconciled statement as JSON', () => {
    const statement = JSON.parse(execFileSync('node', [CLI, SAMPLE], { encoding: 'utf8' }));
    assert.equal(statement.type, 'current-account');
    assert.equal(statement.transactions.length, 63);
    assert.equal(statement.summary.openingBalance, '9163.80');
  });

  it('explains its usage when given no statement', () => {
    const run = spawnSync('node', [CLI], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /Usage: fnb-extract <statement\.pdf>/);
  });

  it('fails with a message for a PDF that is not an FNB statement', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fnb-')), 'blank.pdf');
    fs.writeFileSync(file, await doc.save());
    const run = spawnSync('node', [CLI, file], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /no recognised FNB transaction table/);
  });
});
