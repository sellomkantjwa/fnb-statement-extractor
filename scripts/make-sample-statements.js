/**
 * Regenerates the anonymised sample statements in test/fixtures from the real
 * statements they are based on. Statements whose source PDF is missing are skipped.
 *
 * Usage: node scripts/make-sample-statements.js
 */

const fs = require('fs');
const { buildSample } = require('./sample-statements/redraw');

const SAMPLES = [require('./sample-statements/current-account'), require('./sample-statements/credit-card')];

(async () => {
  for (const sample of SAMPLES) {
    if (!fs.existsSync(sample.source)) {
      console.log(`Skipping ${sample.name}: ${sample.source} not found`);
      continue;
    }
    await buildSample(sample);
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
