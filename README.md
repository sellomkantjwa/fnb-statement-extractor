# fnb-statement-extractor

Extracts transactions from FNB (First National Bank, South Africa) statement PDFs and checks that they add up
to the statement's own totals, so a wrong or missed row fails loudly instead of quietly skewing your numbers.

- Current account statements (e.g. Gold Business, First Business Zero, Aspire) and credit card statements
- Reconciles every statement: running balances, closing balance, turnover counts and totals, card totals
- Reads the descriptions FNB draws as images (any word containing `#`, such as `#Monthly Account Fee`) with OCR
- Runs entirely on your machine: no network calls, the OCR language data ships with the package

Not affiliated with or endorsed by FNB.

## Install

```bash
npm install github:sellomkantjwa/fnb-statement-extractor
```

Requires Node.js 22 or later. The package isn't on the npm registry yet; npm installs it from this repository,
and your `package-lock.json` pins the commit.

## Command line

```bash
npx github:sellomkantjwa/fnb-statement-extractor statement.pdf
```

Once installed in a project, `npx fnb-extract statement.pdf` does the same.

Prints the statement as JSON. Exits with status 1 and a message on stderr if the PDF isn't a recognised FNB
statement or its transactions don't reconcile.

## Library

```js
const { extractStatement, reconcile, StatementReconciliationError } = require('fnb-statement-extractor');

const statement = await extractStatement('statement.pdf');
reconcile(statement); // throws StatementReconciliationError if the rows don't add up
```

- `extractStatement(pdfPath)` parses without checking.
- `reconcile(statement)` throws `StatementReconciliationError` naming the first row or total that doesn't match.
- `extractTransactions(pdfPath)` does both and returns just the transactions.
- `UnsupportedStatementError` is thrown for a PDF with no recognised FNB transaction table.

### Output

A current account statement (figures made up):

```json
{
  "type": "current-account",
  "accountNumber": "62000000000",
  "period": { "from": "2026-06-19", "to": "2026-07-18" },
  "summary": {
    "openingBalance": "9163.80",
    "closingBalance": "41438.84",
    "turnover": {
      "credits": { "count": 12, "total": "228920.00" },
      "debits": { "count": 50, "total": "196644.96" }
    }
  },
  "transactions": [
    {
      "date": "29 Jun",
      "isoDate": "2026-06-29",
      "description": "Airtime Topup Airtime 0820000001",
      "amount": "-101.06",
      "balance": "9062.74",
      "charges": "2.00"
    }
  ],
  "unreadableImages": []
}
```

- Amounts are strings in rands with two decimals: credits positive, debits negative.
- `charges` is the accrued bank charge FNB prints beside a row, or `""`.
- `isoDate` takes its year from the statement period; it, `period` and `accountNumber` are `null` when the
  statement doesn't print a period (credit card statements don't).
- Credit card transactions have a `card` (the masked card number they're listed under, or `null` for fees,
  interest and payments) instead of `balance` and `charges`, and the summary has `used` and `cardTotals`.
- `unreadableImages` lists image text the OCR wasn't confident about (`{ page, text, confidence }`), so you can
  check those rows by eye.

## Limitations

- Budget facility transactions on credit card statements aren't supported and raise `UnsupportedStatementError`.
- Only English-language statements in FNB's current PDF layouts have been tested; a layout change shows up as
  a reconciliation error rather than wrong data.

## Development

```bash
git clone https://github.com/sellomkantjwa/fnb-statement-extractor.git
cd fnb-statement-extractor
npm install
npm test
```

The sample statements in `test/fixtures/` are redrawn from real statements by
`scripts/make-sample-statements.js`, with fictitious descriptions, card numbers and figures that still
reconcile. The script needs the original PDFs, which aren't in the repository.

## License

MIT
