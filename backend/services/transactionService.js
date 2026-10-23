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

// ─── Shared validation helpers ────────────────────────────────────────────────

const MAX_ITEM_LENGTH = 200;
const MAX_PAYMENT_MODE_LENGTH = 50;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ITEM_ALIAS_GROUPS = [
  ['clothes', 'clothing', 'garment', 'garments', 'کپڑا', 'کپڑے', 'کپڑوں', 'kapra', 'kapray', 'kapre'],
  ['food', 'meal', 'meals', 'کھانا', 'کھانے', 'khana', 'khane', 'khanay'],
  ['groceries', 'grocery', 'راشن', 'rashan'],
  ['petrol', 'fuel', 'پٹرول', 'پیٹرول', 'petroleum'],
  ['electricity', 'electric bill', 'بجلی', 'bijli'],
  ['rent', 'کرایہ', 'kiraya'],
  ['salary', 'تنخواہ', 'tankhwa', 'tankhwah'],
];

function normalizeItemName(item) {
  return item.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function getItemAliases(item) {
  const normalizedItem = normalizeItemName(item);
  const group = ITEM_ALIAS_GROUPS.find((aliases) =>
    aliases.some((alias) => normalizeItemName(alias) === normalizedItem)
  );
  return group || [item.trim()];
}

function findItemAlias(text) {
  const words = normalizeItemName(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const aliases of ITEM_ALIAS_GROUPS) {
    for (const alias of aliases) {
      const aliasWords = normalizeItemName(alias).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      if (aliasWords.length > 0 && words.some((_, index) =>
        aliasWords.every((word, offset) => words[index + offset] === word)
      )) {
        return aliases[0];
      }
    }
  }
  return undefined;
}

function addExactItemCondition(conditions, params, item) {
  const aliases = getItemAliases(item);
  conditions.push(`TRIM(item) COLLATE NOCASE IN (${aliases.map(() => '?').join(', ')})`);
  params.push(...aliases);
}

// Validates and trims free-text fields so malformed payloads (e.g. objects or
// empty strings) get a clean 400 instead of reaching SQLite and throwing.
function normalizeTextFields(item, payment_mode) {
  if (typeof item !== 'string' || !item.trim()) {
    return { ok: false, error: 'item must be a non-empty string' };
  }
  if (typeof payment_mode !== 'string' || !payment_mode.trim()) {
    return { ok: false, error: 'payment_mode must be a non-empty string' };
  }

  const trimmedItem = item.trim();
  const trimmedPayment = payment_mode.trim();

  if (trimmedItem.length > MAX_ITEM_LENGTH) {
    return { ok: false, error: `item must be at most ${MAX_ITEM_LENGTH} characters` };
  }
  if (trimmedPayment.length > MAX_PAYMENT_MODE_LENGTH) {
    return { ok: false, error: `payment_mode must be at most ${MAX_PAYMENT_MODE_LENGTH} characters` };
  }

  return { ok: true, item: trimmedItem, payment_mode: trimmedPayment };
}

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

  const text = normalizeTextFields(item, payment_mode);
  if (!text.ok) {
    return { status: 400, body: { error: text.error } };
  }

  const result = db
    .prepare('INSERT INTO transactions (type, amount, item, payment_mode) VALUES (?, ?, ?, ?)')
    .run(type, amount, text.item, text.payment_mode);

  return {
    status: 201,
    body: {
      message: 'Transaction recorded successfully',
      transaction: { id: Number(result.lastInsertRowid), type, amount, item: text.item, payment_mode: text.payment_mode },
    },
  };
}

// ─── Summary (all-time totals + today's totals + today's transactions) ────────
// `created_at` is stored in server-local time (datetime('now','localtime')), so
// "today" must also be computed in local time. Using toISOString() (UTC) points
// at the previous day between 00:00 and 04:59 PKT and hides today's records.
function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSummary(db) {
  const today = localDateString(); // YYYY-MM-DD (local)

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

  // Today's own totals, summed from the same date-filtered rows. Without these
  // the AI layer only had all-time totals + a raw list, so it reported the
  // all-time net_profit as "today's profit".
  const todayIncome = todaysTransactions.reduce(
    (sum, t) => (t.type === 'Income' ? sum + t.amount : sum),
    0
  );
  const todayExpense = todaysTransactions.reduce(
    (sum, t) => (t.type === 'Expense' ? sum + t.amount : sum),
    0
  );

  return {
    status: 200,
    body: {
      total_income: totals.total_income,
      total_expense: totals.total_expense,
      net_profit: totals.total_income - totals.total_expense,
      today_income: todayIncome,
      today_expense: todayExpense,
      today_net_profit: todayIncome - todayExpense,
      todays_transactions: todaysTransactions,
    },
  };
}

// ─── List (search / filter / sort / pagination) ────────────────────────────────
function getTransactions(db, query) {
  const { type, search, from, to, sort = 'created_at', order = 'desc', page = 1, limit = 20 } = query || {};

  if (search !== undefined && typeof search !== 'string') {
    return { status: 400, body: { error: 'search must be a single string value' } };
  }
  for (const [field, value] of [['from', from], ['to', to]]) {
    if (value !== undefined && (typeof value !== 'string' || !DATE_PATTERN.test(value))) {
      return { status: 400, body: { error: `${field} must be a YYYY-MM-DD date string` } };
    }
  }

  const conditions = [];
  const params = [];

  if (type && ['Income', 'Expense'].includes(type)) {
    conditions.push('type = ?');
    params.push(type);
  }
  if (search) {
    const aliases = ITEM_ALIAS_GROUPS.find((group) =>
      group.some((alias) => normalizeItemName(alias) === normalizeItemName(search))
    );
    if (aliases) {
      conditions.push(`(TRIM(item) COLLATE NOCASE IN (${aliases.map(() => '?').join(', ')}) OR payment_mode LIKE ? ESCAPE '\\')`);
      // Escape LIKE wildcards so payment-mode text is matched literally.
      params.push(...aliases, `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    } else {
      // Escape LIKE wildcards so user input is matched literally.
      const escaped = search.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      conditions.push(`(item LIKE ? ESCAPE '\\' OR payment_mode LIKE ? ESCAPE '\\')`);
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
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

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  // Cap the page size so one request can never dump the whole table
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
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

  const text = normalizeTextFields(finalItem, finalPayment);
  if (!text.ok) {
    return { status: 400, body: { error: text.error } };
  }

  db.prepare('UPDATE transactions SET type = ?, amount = ?, item = ?, payment_mode = ? WHERE id = ?')
    .run(finalType, finalAmount, text.item, text.payment_mode, id);

  return {
    status: 200,
    body: {
      message: 'Transaction updated successfully',
      transaction: {
        id: Number(id),
        type: finalType,
        amount: finalAmount,
        item: text.item,
        payment_mode: text.payment_mode,
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
function getSummaryRange(db, from, to, filters = {}) {
  if (!from || !to) {
    return { status: 400, body: { error: 'Both from and to query params are required (YYYY-MM-DD)' } };
  }
  if (typeof from !== 'string' || !DATE_PATTERN.test(from) || typeof to !== 'string' || !DATE_PATTERN.test(to)) {
    return { status: 400, body: { error: 'from and to must be YYYY-MM-DD date strings' } };
  }

  const { item, type } = filters;
  if (item !== undefined && (typeof item !== 'string' || !item.trim())) {
    return { status: 400, body: { error: 'item must be a non-empty string' } };
  }
  if (type !== undefined && !['Income', 'Expense'].includes(type)) {
    return { status: 400, body: { error: "type must be 'Income' or 'Expense'" } };
  }

  const conditions = ['DATE(created_at) >= ?', 'DATE(created_at) <= ?'];
  const params = [from, to];
  if (item !== undefined) addExactItemCondition(conditions, params, item);
  if (type !== undefined) {
    conditions.push('type = ?');
    params.push(type);
  }
  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  if (item !== undefined) {
    const transactions = db
      .prepare(
        `SELECT id, type, amount, item, created_at
         FROM transactions
         ${whereClause}
         ORDER BY created_at ASC, id ASC`
      )
      .all(...params);
    const totalIncome = transactions.reduce(
      (sum, transaction) => sum + (transaction.type === 'Income' ? transaction.amount : 0),
      0
    );
    const totalExpense = transactions.reduce(
      (sum, transaction) => sum + (transaction.type === 'Expense' ? transaction.amount : 0),
      0
    );
    const dailyMap = new Map();
    const itemMap = new Map();

    for (const transaction of transactions) {
      const date = transaction.created_at.slice(0, 10);
      const daily = dailyMap.get(date) || { date, income: 0, expense: 0 };
      daily[transaction.type === 'Income' ? 'income' : 'expense'] += transaction.amount;
      dailyMap.set(date, daily);

      const itemKey = `${transaction.type}\0${transaction.item}`;
      const byItem = itemMap.get(itemKey) || { type: transaction.type, item: transaction.item, total: 0 };
      byItem.total += transaction.amount;
      itemMap.set(itemKey, byItem);
    }

    return {
      status: 200,
      body: {
        total_income: totalIncome,
        total_expense: totalExpense,
        net_profit: totalIncome - totalExpense,
        daily_breakdown: [...dailyMap.values()],
        by_item: [...itemMap.values()].sort((a, b) => b.total - a.total),
        transactions,
        filters: { from, to, item, ...(type ? { type } : {}) },
      },
    };
  }

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'Income'  THEN amount ELSE 0 END), 0) AS total_income,
         COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS total_expense
       FROM transactions
       ${whereClause}`
    )
    .get(...params);

  const daily = db
    .prepare(
      `SELECT DATE(created_at) AS date,
         COALESCE(SUM(CASE WHEN type = 'Income'  THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       ${whereClause}
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    )
    .all(...params);

  const byItem = db
    .prepare(
      `SELECT type, item, SUM(amount) AS total
       FROM transactions
       ${whereClause}
       GROUP BY type, item
       ORDER BY total DESC`
    )
    .all(...params);

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
  findItemAlias,
};
