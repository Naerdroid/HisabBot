'use strict';

// ─── Transaction Service ───────────────────────────────────────────────────────
// Shared business/data layer for the transactions table.
//
// Both the REST endpoints (in index.js) and the Qwen AI tools (in qwenAgent.js)
// call these same functions, so there is exactly ONE source of business logic
// and SQLite access. The AI layer never touches SQLite directly — it can only
// invoke these approved operations.
//
// Every function returns { status, body } so HTTP routes can respond directly
// and AI tool results can be serialized for the model.

// ─── Create ────────────────────────────────────────────────────────────────────
function createTransaction(db, data) {
  const { type, amount, item, payment_mode } = data || {};

  // Validation — identical rules to the original POST /api/transaction endpoint
  if (!type || !amount || !item || !payment_mode) {
    return { status: 400, body: { error: 'Missing required fields: type, amount, item, payment_mode' } };
  }
  if (!['Income', 'Expense'].includes(type)) {
    return { status: 400, body: { error: "type must be 'Income' or 'Expense'" } };
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { status: 400, body: { error: 'amount must be a positive integer' } };
  }

  const result = db
    .prepare('INSERT INTO transactions (type, amount, item, payment_mode) VALUES (?, ?, ?, ?)')
    .run(type, amount, item, payment_mode);

  return {
    status: 201,
    body: {
      message: 'Transaction recorded successfully',
      transaction: { id: Number(result.lastInsertRowid), type, amount, item, payment_mode },
    },
  };
}

// ─── Summary (all-time totals + today's transactions) ──────────────────────────
function getSummary(db) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'Income'  THEN amount ELSE 0 END), 0) AS total_income,
         COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS total_expense
       FROM transactions`
    )
    .get();

  const todaysTransactions = db
    .prepare(
      `SELECT id, type, amount, item, payment_mode, created_at
       FROM transactions
       WHERE DATE(created_at) = ?
       ORDER BY created_at DESC`
    )
    .all(today);

  return {
    status: 200,
    body: {
      total_income: totals.total_income,
      total_expense: totals.total_expense,
      net_profit: totals.total_income - totals.total_expense,
      todays_transactions: todaysTransactions,
    },
  };
}

// ─── List (search / filter / sort / pagination) ────────────────────────────────
function getTransactions(db, query) {
  const { type, search, from, to, sort = 'created_at', order = 'desc', page = 1, limit = 20 } = query || {};

  const conditions = [];
  const params = [];

  if (type && ['Income', 'Expense'].includes(type)) {
    conditions.push('type = ?');
    params.push(type);
  }
  if (search) {
    conditions.push('(item LIKE ? OR payment_mode LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (from) {
    conditions.push('DATE(created_at) >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('DATE(created_at) <= ?');
    params.push(to);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const allowedSorts = ['created_at', 'amount', 'type', 'item', 'payment_mode'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = parseInt(limit) || 20;
  const offset = (pageNum - 1) * limitNum;

  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM transactions ${whereClause}`)
    .get(...params).count;

  const rows = db
    .prepare(
      `SELECT id, type, amount, item, payment_mode, created_at
       FROM transactions ${whereClause}
       ORDER BY ${sortCol} ${sortOrder}
       LIMIT ? OFFSET ?`
    )
    .all(...params, limitNum, offset);

  return {
    status: 200,
    body: {
      transactions: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    },
  };
}

// ─── Get by ID ─────────────────────────────────────────────────────────────────
function getTransactionById(db, id) {
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!row) return { status: 404, body: { error: 'Transaction not found' } };
  return { status: 200, body: row };
}

// ─── Update ────────────────────────────────────────────────────────────────────
function updateTransaction(db, id, data) {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) return { status: 404, body: { error: 'Transaction not found' } };

  const { type, amount, item, payment_mode } = data || {};

  const finalType = type ?? existing.type;
  const finalAmount = amount ?? existing.amount;
  const finalItem = item ?? existing.item;
  const finalPayment = payment_mode ?? existing.payment_mode;

  if (!['Income', 'Expense'].includes(finalType)) {
    return { status: 400, body: { error: "type must be 'Income' or 'Expense'" } };
  }
  if (!Number.isInteger(finalAmount) || finalAmount <= 0) {
    return { status: 400, body: { error: 'amount must be a positive integer' } };
  }

  db.prepare('UPDATE transactions SET type = ?, amount = ?, item = ?, payment_mode = ? WHERE id = ?')
    .run(finalType, finalAmount, finalItem, finalPayment, id);

  return {
    status: 200,
    body: {
      message: 'Transaction updated successfully',
      transaction: {
        id: Number(id),
        type: finalType,
        amount: finalAmount,
        item: finalItem,
        payment_mode: finalPayment,
      },
    },
  };
}

// ─── Delete ────────────────────────────────────────────────────────────────────
function deleteTransaction(db, id) {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) return { status: 404, body: { error: 'Transaction not found' } };

  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  return { status: 200, body: { message: 'Transaction deleted successfully' } };
}

// ─── Date-range summary (totals + daily + per-item breakdown) ──────────────────
function getSummaryRange(db, from, to) {
  if (!from || !to) {
    return { status: 400, body: { error: 'Both from and to query params are required (YYYY-MM-DD)' } };
  }

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'Income'  THEN amount ELSE 0 END), 0) AS total_income,
         COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS total_expense
       FROM transactions
       WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?`
    )
    .get(from, to);

  const daily = db
    .prepare(
      `SELECT DATE(created_at) AS date,
         COALESCE(SUM(CASE WHEN type = 'Income'  THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    )
    .all(from, to);

  const byItem = db
    .prepare(
      `SELECT type, item, SUM(amount) AS total
       FROM transactions
       WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
       GROUP BY type, item
       ORDER BY total DESC`
    )
    .all(from, to);

  return {
    status: 200,
    body: {
      total_income: totals.total_income,
      total_expense: totals.total_expense,
      net_profit: totals.total_income - totals.total_expense,
      daily_breakdown: daily,
      by_item: byItem,
    },
  };
}

module.exports = {
  createTransaction,
  getSummary,
  getTransactions,
  getTransactionById,
  updateTransaction,
  deleteTransaction,
  getSummaryRange,
};
