const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
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
const PORT = Number(process.env.PORT) || 3000;
const MAX_CHAT_MESSAGE_LENGTH = 2000;

// ─── Security & reliability middleware ────────────────────────────────────────

// Don't advertise the framework in response headers
app.disable('x-powered-by');

// Only the local frontend may call this API from a browser.
// The Vite dev proxy is same-origin and needs no CORS at all, so this list
// stays minimal. Requests without an Origin header (curl, health checks,
// server-to-server calls) are allowed — they are not browser-driven.
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
app.use(
  cors({
    origin(origin, callback) {
      callback(null, !origin || ALLOWED_ORIGINS.has(origin));
    },
  })
);

// Every valid request body is small; reject oversized payloads early
app.use(express.json({ limit: '16kb' }));

// Rate limiting protects the API (and especially the expensive AI endpoint)
// from abuse and runaway loops. Defaults are generous for a local demo and
// can be overridden with environment variables for testing.
const RATE_LIMIT_MESSAGE = { error: 'Too many requests. Please wait a moment and try again.' };
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
});
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.CHAT_RATE_LIMIT_PER_MINUTE) || 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: RATE_LIMIT_MESSAGE,
});
app.use('/api', apiLimiter);

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
// Body:     { message: string, history?: Array<{ role: 'user'|'assistant', content: string }> }
//           The optional history carries the recent conversation turns so the
//           model can resolve follow-ups (e.g. "5000 ka" → the pending expense).
//           It is validated and capped inside processChatMessage.
// Response: { response: string, tools_used: string[] }
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const { message, history } = req.body || {};

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Message is too long (max ${MAX_CHAT_MESSAGE_LENGTH} characters)` });
    }

    const result = await processChatMessage(db, message.trim(), history);
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

// ─── Error handler ────────────────────────────────────────────────────────────
// Catches unexpected route errors (e.g. malformed payloads that reach SQLite)
// and returns clean JSON. Stack traces stay in the server log; clients never
// receive implementation details.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.type === 'entity.parse.failed' || err.status === 400) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'Request body is too large' });
  }

  console.error(`Unexpected error on ${req.method} ${req.path}:`, err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
// Bind to loopback only: this API is for this machine, not the local network.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`HisabBot backend running on http://127.0.0.1:${PORT}`);
});
