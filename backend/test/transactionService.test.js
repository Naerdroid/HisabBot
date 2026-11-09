'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { getSummaryRange, getTransactions } = require('../services/transactionService');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      item TEXT NOT NULL,
      payment_mode TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  const insert = db.prepare(
    'INSERT INTO transactions (type, amount, item, payment_mode, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  insert.run('Expense', 2000, 'کپڑا', 'Cash', '2026-10-05 12:00:00');
  insert.run('Income', 1500, 'کپڑا', 'Cash', '2026-10-06 12:00:00');
  insert.run('Expense', 300, 'Shoes', 'Cash', '2026-10-07 12:00:00');
  insert.run('Expense', 50, 'کپڑوں کی مرمت', 'Cash', '2026-10-08 12:00:00');
  insert.run('Expense', 700, 'کپڑا', 'Cash', '2026-09-30 12:00:00');
  return db;
}

test('clothes history search matches Urdu item names exactly across transaction types and dates', () => {
  const db = createDatabase();
  try {
    const result = getTransactions(db, {
      search: 'clothes',
      from: '2026-10-01',
      to: '2026-10-31',
      limit: 100,
    });

    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.transactions.map(({ type, amount, item }) => ({ type, amount, item })),
      [
        { type: 'Income', amount: 1500, item: 'کپڑا' },
        { type: 'Expense', amount: 2000, item: 'کپڑا' },
      ]
    );
    assert.equal(result.body.pagination.total, 2);
  } finally {
    db.close();
  }
});

test('item-specific monthly summaries include Urdu records by requested type and exclude unrelated items', () => {
  const db = createDatabase();
  try {
    const expense = getSummaryRange(db, '2026-10-01', '2026-10-31', {
      item: 'clothes',
      type: 'Expense',
    });
    const income = getSummaryRange(db, '2026-10-01', '2026-10-31', {
      item: 'clothing',
      type: 'Income',
    });

    assert.equal(expense.status, 200);
    assert.equal(expense.body.total_expense, 2000);
    assert.equal(expense.body.total_income, 0);
    assert.deepEqual(expense.body.by_item, [{ type: 'Expense', item: 'کپڑا', total: 2000 }]);

    assert.equal(income.status, 200);
    assert.equal(income.body.total_income, 1500);
    assert.equal(income.body.total_expense, 0);
    assert.deepEqual(income.body.by_item, [{ type: 'Income', item: 'کپڑا', total: 1500 }]);
  } finally {
    db.close();
  }
});

test('Roman Urdu item aliases find transactions recorded in Urdu script', () => {
  const db = createDatabase();
  try {
    const result = getTransactions(db, { search: 'kapray', limit: 100 });

    assert.equal(result.status, 200);
    assert.equal(result.body.pagination.total, 3);
    assert.ok(result.body.transactions.every(({ item }) => item === 'کپڑا'));
  } finally {
    db.close();
  }
});
