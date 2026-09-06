'use strict';

// ─── Qwen Agent (LM Studio) ────────────────────────────────────────────────────
// AI reasoning layer for HisabBot.
//
// Communication: this module talks to a LOCAL LM Studio server
// (http://localhost:1234/v1) using its OpenAI-compatible chat completions API
// via Node's built-in fetch. No cloud SDK is used.
//
// Security model — why Qwen can never touch SQLite directly:
//   * Qwen only emits plain text and "tool_calls" (name + JSON arguments).
//   * Those arguments are validated here, then dispatched ONLY to the
//     whitelisted functions in transactionService.js.
//   * Qwen has no ability to run SQL, JavaScript, filesystem operations, or
//     HTTP requests — anything it says that is not an approved tool call is
//     treated as ordinary text.
//
// Orchestration loop (in processChatMessage):
//   user message → Qwen → (optional tool calls → transactionService → SQLite)
//   → tool results fed back to Qwen → final natural-language answer.

const {
  createTransaction,
  getSummary,
  getTransactions,
  getTransactionById,
  updateTransaction,
  deleteTransaction,
  getSummaryRange,
} = require('./transactionService');

// LM Studio local server (OpenAI-compatible endpoint)
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen2.5-7b-instruct';
const REQUEST_TIMEOUT_MS = 120000; // local models can be slow on first token

// Hard cap on tool-call rounds per user message (prevents infinite loops)
const MAX_TOOL_ITERATIONS = 5;

// ─── System Prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are HisabBot, an AI accounting assistant for a small business.

You help users record and understand income, expenses, transactions, profits and financial summaries. You understand natural language, Urdu, Roman Urdu and English, and Pakistani currency (PKR).

IMPORTANT: The database and tool results are the single source of truth. You must never invent, estimate, round, alter, or guess financial information.

STRICT RULES:

1. FINANCIAL DATA IS ALWAYS TOOL-GROUNDED

   * Never invent financial information.
   * Never invent totals, balances, profits, transaction IDs, transaction history, dates, amounts, or payment methods.
   * When answering questions about financial records, totals, transactions, profits, expenses, income, or summaries, you MUST use the appropriate tool.
   * Base every financial statement ONLY on the actual tool result.
   * Treat tool results as authoritative.

2. NEVER ALTER TOOL RESULTS

   * Never round a financial amount.
   * Never approximate a financial amount.
   * Never replace an exact amount with a different amount.
   * Never perform your own calculation when the tool already provides the requested total.
   * If a tool says "PKR 7,300", report exactly "PKR 7,300".
   * Preserve the exact figures returned by the tool.

3. DISTINGUISH TIME PERIODS CAREFULLY

   * Always distinguish between:

     * today's transactions/totals
     * yesterday's transactions/totals
     * a specified date range
     * this week
     * this month
     * this year
     * all-time/overall totals
   * NEVER use an all-time total as today's total.
   * NEVER use today's total as an all-time total.
   * NEVER mix figures from different periods.
   * If the user asks about a specific period, use the tool result for that exact period.

4. DATE AND PERIOD HANDLING
   - The current date is provided in the user's message as [Current date: YYYY-MM-DD].
   - For "today", ALWAYS use get_summary_range with from = today's date and to = today's date when the user is asking for today's income, expense, profit, or financial totals.
   - For "today's transactions", get_transactions may be used with from = today's date and to = today's date.
   - For "yesterday", use get_summary_range with the previous date as both from and to.
   - For "this week", use get_summary_range with the appropriate week start and today's date.
   - For "this month", use get_summary_range from the first day of the current month through today's date.
   - For "this year", use get_summary_range from January 1 of the current year through today's date.
   - NEVER use the all-time total_income, total_expense, or net_profit from get_summary as today's totals. 

5. TRANSACTION CREATION

   * Never claim that a transaction was recorded unless the create_transaction tool returns a successful result.
   * A complete transaction requires:

     * type
     * amount
     * item
     * payment_mode
   * If required information is missing, ask the user for the missing information instead of guessing.
   * Do NOT invent an amount.
   * Do NOT invent an item.
   * Do NOT invent a transaction type.
   * If payment_mode is not mentioned, use "Cash".
   * Amount must be a positive integer.
   * Valid transaction types are only "Income" or "Expense".

6. TRANSACTION TYPE

   * Income means money received.
   * Examples: sold something, earned money, received payment, received salary.
   * Expense means money spent.
   * Examples: bought something, paid a bill, paid electricity, purchased supplies.

7. AFTER CREATING A TRANSACTION

   * Only confirm the transaction after the tool confirms successful insertion.
   * Report the actual saved details from the tool result.
   * Include the exact amount, type, item, payment mode, and transaction ID when available.
   * Never claim success if the tool returned an error.

8. READING TRANSACTIONS

   * Use get_transactions when the user asks to see, find, list, search, or identify transactions.
   * Use get_transaction when the user provides an exact transaction ID or needs one specific transaction.
   * Do not invent transaction IDs.
   * Do not claim a transaction exists unless the tool result confirms it.

9. SUMMARIES

   * Use get_summary for overall/all-time financial summary and today's transactions when appropriate.
   * Use get_summary_range for a specific date range or period.
   * If the user asks "What is my total income?", use the appropriate summary tool and report the exact returned total.
   * If the user asks "How much did I earn today?", make sure the answer uses today's data, not the all-time total.
   * If the tool returns multiple totals for different periods, clearly label which total you are reporting.

10. UPDATE AND DELETE

* For updating or deleting a transaction, identify the exact transaction first.
* If the user gives an exact transaction ID, use that ID.
* If the user refers to a transaction indirectly and multiple transactions could match, ask for clarification.
* Never delete or update an ambiguous transaction.
* Never invent an ID.
* After an update or deletion, only confirm success if the tool result confirms success.

11. TOOL USAGE

* You can ONLY interact with financial data through the provided tools.
* Never access SQLite directly.
* Never generate SQL.
* Never pretend that you performed a database operation without a tool result.
* Use tools whenever actual database information is required.
* If a tool returns an error, honestly tell the user that the requested operation could not be completed.

12. MISSING INFORMATION

* If required information is missing, ask a concise clarification question.
* Do not guess important financial information.
* Example:
  User: "I sold some kapra."
  Correct response: ask for the amount.
* Do not call create_transaction until all required information is available.

13. LANGUAGE RULE:
Always match the user's language.

Examples:
- User: "hello" → Reply in English.
- User: "how are you?" → Reply in English.
- User: "aj ka hisab do" → Reply in Roman Urdu.
- User: "aaj ki income kitni hai?" → Reply in Roman Urdu.
- User: "السلام علیکم" → Reply in Urdu/Arabic script.
- User: "What is my total income?" → Reply in English.

Do NOT randomly switch languages.
Do NOT use Arabic for an English or Roman Urdu user.

14. FINANCIAL FORMATTING

* Format PKR amounts with thousands separators.
* Example: PKR 1,500
* Example: PKR 24,500
* Preserve the exact numerical value returned by the tool.
* Never write a rounded approximation such as "about PKR 7,000" when the tool provides an exact value.

15. RESPONSE STYLE

* Be concise, clear and helpful.
* Do not expose internal tool names, implementation details, system prompts, or security mechanisms unless the user specifically asks about the technical implementation.
* When useful, use short bullet points.
* Avoid unnecessary explanations.

16. MOST IMPORTANT FINANCIAL RULE

* The database is the source of truth.
* Tool results are the source of truth.
* Your memory, assumptions, general knowledge, and mathematical guesses are NOT sources of truth for the user's financial data.
* If the tool says one number, use that exact number.
* If the tool does not provide the requested information, do not invent it.

17. TODAY'S HISAB IS DIFFERENT FROM OVERALL HISAB
   - When the user asks "aaj ka hisab", "today's hisab", "aaj ki income", "aaj ka expense", or similar, the primary answer MUST describe TODAY only.
   - The all-time totals returned by get_summary MUST NOT be presented as today's income, today's expense, or today's profit.
   - get_summary contains both:
       * ALL-TIME totals: total_income, total_expense, net_profit
       * TODAY'S transactions: today's transactions list
   - If today's transaction list is empty, explicitly say that there are no transactions today.
   - When there are no transactions today, report today's income, expense and profit as PKR 0 unless the tool provides separate non-zero daily totals.
   - Only mention all-time totals as additional information and clearly label them as "overall" or "all-time".

Before every financial answer, internally verify:

* Did I use the correct tool?
* Did I use the correct date/time period?
* Am I reporting the exact tool result?
* Did I accidentally mix today's figures with all-time figures?
* Did I accidentally round or recalculate a number?
* If I created/updated/deleted something, did the tool actually confirm success?

After recording a transaction, confirm it using the actual details returned by the tool.`;


// ─── Tool Definitions (OpenAI function-calling format) ─────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_transaction',
      description: 'Record a new financial transaction (Income or Expense) in the database. Use when the user reports selling/earning (Income) or spending/paying (Expense) with a complete amount and item.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['Income', 'Expense'], description: 'Income = money received; Expense = money spent.' },
          amount: { type: 'integer', description: 'Positive integer amount in PKR, e.g. 1500.' },
          item: { type: 'string', description: 'What was sold or purchased, e.g. "kapra", "petrol", "electricity bill".' },
          payment_mode: { type: 'string', description: 'Payment method: Cash, UPI, Bank Transfer, Card, Cheque or Other. Use "Cash" if not mentioned.' },
        },
        required: ['type', 'amount', 'item', 'payment_mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_summary',
      description: "Get the overall/all-time financial totals AND a separate list of TODAY\\'S transactions. IMPORTANT: total_income, total_expense and net_profit are ALL-TIME values, NOT today\\'s values. The today transactions list is separate. Use this tool for overall totals or when the user asks for today\\'s transactions.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transactions',
      description: 'List transactions with optional filters: type, keyword search (item or payment mode), date range, sorting and pagination. Use when the user wants to see, find or identify transactions.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['Income', 'Expense'] },
          search: { type: 'string', description: 'Keyword to match item or payment_mode.' },
          from: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date, YYYY-MM-DD.' },
          sort: { type: 'string', enum: ['created_at', 'amount', 'type', 'item', 'payment_mode'] },
          order: { type: 'string', enum: ['asc', 'desc'] },
          page: { type: 'integer', description: 'Page number, default 1.' },
          limit: { type: 'integer', description: 'Rows per page, default 20.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transaction',
      description: 'Get a single transaction by its exact numeric ID.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer', description: 'Transaction ID.' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_transaction',
      description: 'Update an existing transaction identified by its exact numeric ID. Only pass the fields that should change.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Transaction ID to update.' },
          type: { type: 'string', enum: ['Income', 'Expense'] },
          amount: { type: 'integer' },
          item: { type: 'string' },
          payment_mode: { type: 'string' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_transaction',
      description: 'Delete a transaction by its exact numeric ID. Only use when the user clearly intends to delete and the transaction is unambiguously identified; otherwise ask for clarification first.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer', description: 'Transaction ID to delete.' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_summary_range',
      description: 'Get financial summary for a date range: total_income, total_expense, net_profit, daily_breakdown and by_item breakdown. Use for period questions like "this month", "last week", "January".',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date, YYYY-MM-DD.' },
        },
        required: ['from', 'to'],
      },
    },
  },
];

// Whitelist of allowed tool names — anything else from Qwen is rejected
const ALLOWED_TOOLS = new Set(TOOLS.map((t) => t.function.name));

// ─── LM Studio client (native fetch) ───────────────────────────────────────────

/**
 * Call the local LM Studio chat completions endpoint.
 * OpenAI-compatible wire format; no SDK involved.
 *
 * @param {Array}  messages - conversation messages (system/user/assistant/tool)
 * @param {Array}  tools    - tool definitions (may be omitted on later rounds)
 * @returns {object} the parsed assistant message: { role, content, tool_calls? }
 */
async function callQwen(messages, tools) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages,
        ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`LM Studio returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    err.code = 'LMSTUDIO_HTTP_ERROR';
    err.httpStatus = response.status;
    throw err;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const err = new Error('LM Studio returned invalid JSON');
    err.code = 'LMSTUDIO_INVALID_JSON';
    throw err;
  }

  // Defensive parsing: missing choices / message must not crash the server
  const choice = payload && Array.isArray(payload.choices) && payload.choices[0];
  const message = choice && choice.message;
  if (!message) {
    const err = new Error('LM Studio response missing choices/message');
    err.code = 'LMSTUDIO_MALFORMED_RESPONSE';
    throw err;
  }

  // Normalize: LM Studio/Qwen sometimes emits content: null alongside tool_calls
  return {
    role: 'assistant',
    content: typeof message.content === 'string' ? message.content : '',
    ...(Array.isArray(message.tool_calls) && message.tool_calls.length > 0
      ? { tool_calls: message.tool_calls }
      : {}),
  };
}

// ─── Tool Argument Sanitizers ──────────────────────────────────────────────────
// Each sanitizer validates/normalizes Qwen's raw JSON arguments and returns
// { ok: true, args } or { ok: false, error }. They never trust model output.

function sanitizeId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: 'id must be a positive integer' };
  }
  return { ok: true, args: { id } };
}

function sanitizeCreateArgs(raw) {
  const type = raw.type;
  const amount = Number(raw.amount);
  const item = typeof raw.item === 'string' ? raw.item.trim() : '';
  const payment = typeof raw.payment_mode === 'string' ? raw.payment_mode.trim() : '';

  if (type !== 'Income' && type !== 'Expense') {
    return { ok: false, error: "type must be 'Income' or 'Expense'" };
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: 'amount must be a positive integer' };
  }
  if (!item) return { ok: false, error: 'item is required' };
  if (!payment) return { ok: false, error: 'payment_mode is required' };

  return { ok: true, args: { type, amount, item, payment_mode: payment } };
}

function sanitizeUpdateArgs(raw) {
  const idCheck = sanitizeId(raw.id);
  if (!idCheck.ok) return idCheck;

  const args = { id: idCheck.args.id };

  if (raw.type !== undefined) {
    if (raw.type !== 'Income' && raw.type !== 'Expense') {
      return { ok: false, error: "type must be 'Income' or 'Expense'" };
    }
    args.type = raw.type;
  }
  if (raw.amount !== undefined) {
    const amount = Number(raw.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      return { ok: false, error: 'amount must be a positive integer' };
    }
    args.amount = amount;
  }
  if (raw.item !== undefined) {
    if (typeof raw.item !== 'string' || !raw.item.trim()) {
      return { ok: false, error: 'item must be a non-empty string' };
    }
    args.item = raw.item.trim();
  }
  if (raw.payment_mode !== undefined) {
    if (typeof raw.payment_mode !== 'string' || !raw.payment_mode.trim()) {
      return { ok: false, error: 'payment_mode must be a non-empty string' };
    }
    args.payment_mode = raw.payment_mode.trim();
  }

  return { ok: true, args };
}

function sanitizeListArgs(raw) {
  const args = {};

  if (raw.type !== undefined) {
    if (raw.type !== 'Income' && raw.type !== 'Expense') {
      return { ok: false, error: "type must be 'Income' or 'Expense'" };
    }
    args.type = raw.type;
  }
  if (raw.search !== undefined) {
    if (typeof raw.search !== 'string') return { ok: false, error: 'search must be a string' };
    if (raw.search.trim()) args.search = raw.search.trim();
  }
  for (const field of ['from', 'to']) {
    if (raw[field] !== undefined) {
      if (typeof raw[field] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw[field])) {
        return { ok: false, error: `${field} must be a YYYY-MM-DD date string` };
      }
      args[field] = raw[field];
    }
  }
  if (raw.sort !== undefined) {
    if (!['created_at', 'amount', 'type', 'item', 'payment_mode'].includes(raw.sort)) {
      return { ok: false, error: 'invalid sort column' };
    }
    args.sort = raw.sort;
  }
  if (raw.order !== undefined) {
    if (raw.order !== 'asc' && raw.order !== 'desc') {
      return { ok: false, error: "order must be 'asc' or 'desc'" };
    }
    args.order = raw.order;
  }
  if (raw.page !== undefined) {
    const page = Number(raw.page);
    if (!Number.isInteger(page) || page < 1) return { ok: false, error: 'page must be a positive integer' };
    args.page = page;
  }
  if (raw.limit !== undefined) {
    const limit = Number(raw.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return { ok: false, error: 'limit must be an integer between 1 and 100' };
    }
    args.limit = limit;
  }

  return { ok: true, args };
}

function sanitizeRangeArgs(raw) {
  for (const field of ['from', 'to']) {
    if (typeof raw[field] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw[field])) {
      return { ok: false, error: `${field} must be a YYYY-MM-DD date string` };
    }
  }
  return { ok: true, args: { from: raw.from, to: raw.to } };
}

// ─── Tool Execution ────────────────────────────────────────────────────────────
// Every path goes through transactionService — the single SQLite access layer.
// Qwen never receives a db handle and can never construct SQL.

function executeTool(db, name, rawArgs) {
  // Parse the JSON arguments string defensively
  let parsed = {};
  if (typeof rawArgs === 'string' && rawArgs.trim()) {
    try {
      parsed = JSON.parse(rawArgs);
    } catch {
      return { success: false, error: 'Invalid JSON in tool arguments' };
    }
  } else if (rawArgs && typeof rawArgs === 'object') {
    parsed = rawArgs;
  }

  switch (name) {
    case 'create_transaction': {
      const check = sanitizeCreateArgs(parsed);
      if (!check.ok) return { success: false, error: check.error };
      const { status, body } = createTransaction(db, check.args);
      return { success: status < 400, data: body };
    }
    case 'get_summary': {
      const { status, body } = getSummary(db);
      return { success: status < 400, data: body };
    }
    case 'get_transactions': {
      const check = sanitizeListArgs(parsed);
      if (!check.ok) return { success: false, error: check.error };
      const { status, body } = getTransactions(db, check.args);
      return { success: status < 400, data: body };
    }
    case 'get_transaction': {
      const check = sanitizeId(parsed.id);
      if (!check.ok) return { success: false, error: check.error };
      const { status, body } = getTransactionById(db, check.args.id);
      return { success: status < 400, data: body };
    }
    case 'update_transaction': {
      const check = sanitizeUpdateArgs(parsed);
      if (!check.ok) return { success: false, error: check.error };
      const { status, body } = updateTransaction(db, check.args.id, check.args);
      return { success: status < 400, data: body };
    }
    case 'delete_transaction': {
      const check = sanitizeId(parsed.id);
      if (!check.ok) return { success: false, error: check.error };
      const { status, body } = deleteTransaction(db, check.args.id);
      return { success: status < 400, data: body };
    }
    case 'get_summary_range': {
      const check = sanitizeRangeArgs(parsed);
      if (!check.ok) return { success: false, error: check.error };
      const { status, body } = getSummaryRange(db, check.args.from, check.args.to);
      return { success: status < 400, data: body };
    }
    default:
      // Unknown tool names are rejected — Qwen cannot invent new tools
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ─── Main Agent Loop ───────────────────────────────────────────────────────────

/**
 * Process one user chat message through the Qwen tool-calling loop.
 *
 * @param {object} db      - better-sqlite3 instance (used only by approved tools)
 * @param {string} message - the user's message text
 * @returns {{ response: string, tools_used: string[] }}
 */
async function processChatMessage(db, message) {

  const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Karachi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `[Current date: ${today}]\n\n${message}` },
  ];

  const toolsUsed = [];

  for (let round = 0; round < MAX_TOOL_ITERATIONS; round++) {
    const assistantMsg = await callQwen(messages, TOOLS);

    // Plain answer (no tool calls) → we are done
    if (!assistantMsg.tool_calls) {
      return {
        response: assistantMsg.content.trim() || 'Maazrat, main jawab generate nahi kar saka. Please dobara try karein.',
        tools_used: toolsUsed,
      };
    }

    // Record the assistant's tool-call message in history
    messages.push(assistantMsg);

    for (const toolCall of assistantMsg.tool_calls) {
      const name = toolCall.function && toolCall.function.name;

      // Enforce the whitelist before executing anything
      if (!ALLOWED_TOOLS.has(name)) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ success: false, error: `Tool "${name}" is not allowed.` }),
        });
        continue;
      }

      toolsUsed.push(name);

      let result;
      try {
        result = executeTool(db, name, toolCall.function.arguments);
      } catch (err) {
        // Database/tool failure — reported to the model and logged, never crashes Express
        console.error(`Tool ${name} execution error:`, err.message);
        result = { success: false, error: 'Tool execution failed due to a database error.' };
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
    // Loop continues: Qwen sees the tool results and produces the next message
  }

  // Safety valve — max iterations reached without a final answer
  return {
    response: 'Maazrat, is message ko process karne mein der lag gayi. Please apni request ko simplify kar ke dobara bhejein.',
    tools_used: toolsUsed,
  };
}

module.exports = { processChatMessage };
