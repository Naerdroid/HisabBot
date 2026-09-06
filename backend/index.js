const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

// Shared business/data layer — used by BOTH the REST routes below and the
// Qwen AI tools, so there is exactly one source of validation + SQLite logic.
const {
  createTransaction,
  getSummary,
  getTransactions,
  getTransactionById,
  updateTransaction,
  deleteTransaction,
  getSummaryRange,
} = require('./services/transactionService');

// AI reasoning layer (LM Studio / Qwen) — calls transactionService internally.
const { processChatMessage } = require('./services/qwenAgent');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ─── Database Setup ────────────────────────────────────────────────────────────
const dbPath = path.join(__dirname, 'hisab.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create transactions table
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT    NOT NULL CHECK(type IN ('Income', 'Expense')),
    amount       INTEGER NOT NULL,
    item         TEXT    NOT NULL,
    payment_mode TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

// ─── POST /api/transaction ─────────────────────────────────────────────────────
// Body: { type: "Income"|"Expense", amount: number, item: string, payment_mode: string }
app.post('/api/transaction', (req, res) => {
  const { status, body } = createTransaction(db, req.body);
  res.status(status).json(body);
});

// ─── GET /api/summary ──────────────────────────────────────────────────────────
// Returns: total income, total expenses, net profit, and today's transactions
app.get('/api/summary', (req, res) => {
  const { status, body } = getSummary(db);
  res.status(status).json(body);
});

// ─── GET /api/transactions ─────────────────────────────────────────────────────
// List all transactions with optional search, filter, sort, and pagination
// Query params: ?type=Income|Expense&search=keyword&from=YYYY-MM-DD&to=YYYY-MM-DD
//               &sort=created_at|amount&order=asc|desc&page=1&limit=20
app.get('/api/transactions', (req, res) => {
  const { status, body } = getTransactions(db, req.query);
  res.status(status).json(body);
});

// ─── GET /api/transactions/:id ─────────────────────────────────────────────────
app.get('/api/transactions/:id', (req, res) => {
  const { status, body } = getTransactionById(db, req.params.id);
  res.status(status).json(body);
});

// ─── PUT /api/transactions/:id ─────────────────────────────────────────────────
// Body: { type?, amount?, item?, payment_mode? }
app.put('/api/transactions/:id', (req, res) => {
  const { status, body } = updateTransaction(db, req.params.id, req.body);
  res.status(status).json(body);
});

// ─── DELETE /api/transactions/:id ──────────────────────────────────────────────
app.delete('/api/transactions/:id', (req, res) => {
  const { status, body } = deleteTransaction(db, req.params.id);
  res.status(status).json(body);
});

// ─── GET /api/summary/range ────────────────────────────────────────────────────
// Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns totals and daily breakdown for charts within a date range
app.get('/api/summary/range', (req, res) => {
  const { status, body } = getSummaryRange(db, req.query.from, req.query.to);
  res.status(status).json(body);
});

// ─── POST /api/chat ────────────────────────────────────────────────────────────
// AI chatbot endpoint backed by the local Qwen model via LM Studio.
//
// Flow: user message → Qwen (LM Studio) → optional approved tool calls →
// transactionService → SQLite → tool results back to Qwen → final answer.
//
// Body:     { message: string }
// Response: { response: string, tools_used: string[] }
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body || {};

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const result = await processChatMessage(db, message.trim());
    res.json(result);
  } catch (err) {
    // Log technical details server-side only; never leak stack traces to the client
    console.error('POST /api/chat error:', err.code ? `[${err.code}] ${err.message}` : err.message);

    // LM Studio unreachable (not running / connection refused / timeout)
    const networkErrors = ['LMSTUDIO_HTTP_ERROR', 'LMSTUDIO_INVALID_JSON', 'LMSTUDIO_MALFORMED_RESPONSE'];
    const isFetchFailure = err.code === 'LMSTUDIO_HTTP_ERROR' || err.name === 'AbortError' ||
      err.code === 'ECONNREFUSED' || err.code === 'FetchError' || err.cause;
    if (networkErrors.includes(err.code) || isFetchFailure) {
      return res.status(503).json({
        error: 'AI service is unavailable. Please make sure LM Studio is running.',
      });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`HisabBot backend running on http://localhost:${PORT}`);
});
