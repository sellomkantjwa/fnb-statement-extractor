class StatementReconciliationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StatementReconciliationError';
  }
}

class UnsupportedStatementError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedStatementError';
  }
}

module.exports = { StatementReconciliationError, UnsupportedStatementError };
