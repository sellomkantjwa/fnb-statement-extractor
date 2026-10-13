#!/usr/bin/env node
const { extractStatement, reconcile } = require('..');

const USAGE = 'Usage: fnb-extract <statement.pdf>\n  Prints the statement as JSON after checking its transactions add up to its summary.';

async function main([pdfPath, ...rest]) {
  if (!pdfPath || rest.length) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const statement = await extractStatement(pdfPath);
  reconcile(statement);
  console.log(JSON.stringify(statement, null, 2));
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`fnb-extract: ${error.message}`);
  process.exitCode = 1;
});
