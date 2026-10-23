'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { processChatMessage } = require('../services/qwenAgent');

function mockQwen(responses, inspectRequest) {
  const originalFetch = global.fetch;
  let index = 0;
  global.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    inspectRequest?.(payload, index);
    const message = responses[index++];
    assert.ok(message, 'unexpected additional model request');
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  };
  return () => {
    global.fetch = originalFetch;
  };
}

test('simple English, Urdu, and Roman Urdu text is passed as the current message without stale chat recap', async () => {
  const cases = [
    ['Good morning, how are you?', 'Good morning! I am ready to help.'],
    ['aj ka hisab do', 'Aaj ka hisab bata deta hoon.'],
  ];

  for (const [input, expected] of cases) {
    let userContent;
    const restoreFetch = mockQwen([{ role: 'assistant', content: expected }], (payload) => {
      userContent = payload.messages[1].content;
    });
    try {
      const result = await processChatMessage({}, input);
      assert.equal(result.response, expected);
      assert.equal(result.tools_used.length, 0);
      assert.match(userContent, new RegExp(input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(userContent, /Recent conversation for context/);
    } finally {
      restoreFetch();
    }
  }
});

test('hello receives a natural English greeting without depending on the model', async () => {
  const result = await processChatMessage({}, 'hello');
  assert.equal(result.response, 'Hello! How can I help you today?');
  assert.deepEqual(result.tools_used, []);
});

test('an Urdu-script greeting receives an Urdu-script response', async () => {
  const result = await processChatMessage({}, 'السلام علیکم');
  assert.match(result.response, /وعلیکم السلام/);
  assert.match(result.response, /[\u0600-\u06ff]/);
});

test('model replies that switch away from Urdu or Roman Urdu are replaced with safe matching-language text', async () => {
  const cases = [
    {
      message: 'آپ کیسے ہیں؟',
      modelResponse: 'Hello! I can assist you today.',
      expected: /معذرت/,
      forbidden: /Hello|assist/i,
    },
    {
      message: 'aap kaise hain?',
      modelResponse: 'Hello! I can assist you today.',
      expected: /Maazrat/,
      forbidden: /Hello|assist/i,
    },
    {
      message: 'Please reply to this.',
      modelResponse: 'وعلیکم السلام، میں مدد کے لیے حاضر ہوں۔',
      expected: /Sorry/,
      forbidden: /[\u0600-\u06ff]/,
    },
  ];

  for (const scenario of cases) {
    const restoreFetch = mockQwen([{ role: 'assistant', content: scenario.modelResponse }]);
    try {
      const result = await processChatMessage({}, scenario.message);
      assert.match(result.response, scenario.expected);
      assert.doesNotMatch(result.response, scenario.forbidden);
    } finally {
      restoreFetch();
    }
  }
});

test('transaction action, not item or amount, determines the saved type and response language', async () => {
  const cases = [
    {
      message: 'I sold clothes for 1500 rupees today.',
      expectedType: 'Income',
      expectedAmount: 1500,
      item: 'clothes',
      responsePattern: /Income recorded: clothes, PKR 1,500/i,
    },
    {
      message: 'I got paid 1500 rupees for clothes today.',
      expectedType: 'Income',
      expectedAmount: 1500,
      item: 'clothes',
      responsePattern: /Income recorded: clothes, PKR 1,500/i,
    },
    {
      message: 'I bought clothes for 2000 rupees.',
      expectedType: 'Expense',
      expectedAmount: 2000,
      item: 'clothes',
      responsePattern: /Expense recorded: clothes, PKR 2,000/i,
    },
    {
      message: 'میں نے 2000 کا کپڑا بیچا',
      expectedType: 'Income',
      expectedAmount: 2000,
      item: 'کپڑا',
      responsePattern: /آمدنی درج کر دی گئی/,
    },
    {
      message: 'میں نے 2000 روپے کا کپڑا فروخت کیا',
      expectedType: 'Income',
      expectedAmount: 2000,
      item: 'کپڑا',
      responsePattern: /آمدنی درج کر دی گئی/,
    },
    {
      message: 'Maine 2000 ka kapra becha',
      expectedType: 'Income',
      expectedAmount: 2000,
      item: 'kapra',
      responsePattern: /Aamdani darj kar di gayi/,
    },
    {
      message: 'میں نے 2000 کا کپڑا خریدا',
      expectedType: 'Expense',
      expectedAmount: 2000,
      item: 'کپڑا',
      responsePattern: /خرچ درج کر دیا گیا/,
    },
    {
      message: 'Maine 2000 ka kapra khareeda',
      expectedType: 'Expense',
      expectedAmount: 2000,
      item: 'kapra',
      responsePattern: /Kharcha darj kar diya gaya/,
    },
    {
      message: '500 petrol ka expense hua',
      expectedType: 'Expense',
      expectedAmount: 500,
      item: 'petrol',
      responsePattern: /Kharcha darj kar diya gaya/,
    },
  ];

  for (const scenario of cases) {
    const inserted = [];
    const fakeDb = {
      prepare(sql) {
        assert.match(sql, /INSERT INTO transactions/);
        return {
          run: (...values) => {
            inserted.push(values);
            return { lastInsertRowid: 42 };
          },
        };
      },
    };

    const result = await processChatMessage(fakeDb, scenario.message);
    assert.match(result.response, scenario.responsePattern);
    assert.deepEqual(result.tools_used, ['create_transaction']);
    assert.deepEqual(inserted, [[
      scenario.expectedType,
      scenario.expectedAmount,
      scenario.item,
      'Cash',
    ]]);
    if (/[\u0600-\u06ff]/.test(scenario.message)) {
      assert.match(result.response, /[\u0600-\u06ff]/);
    }
    if (/Maine/.test(scenario.message)) {
      assert.doesNotMatch(result.response, /[\u0600-\u06ff]/);
    }
  }
});

test('ambiguous transaction intent is clarified without calling Qwen or saving', async () => {
  const result = await processChatMessage({}, 'I sold and bought clothes for 2000 rupees.');
  assert.match(result.response, /received or spent/i);
  assert.deepEqual(result.tools_used, []);
});

test('an item and amount without a clear transaction action are never saved', async () => {
  let insertCalls = 0;
  const restoreFetch = mockQwen([{
    role: 'assistant',
    tool_calls: [{
      id: 'create-call',
      function: {
        name: 'create_transaction',
        arguments: JSON.stringify({ type: 'Expense', amount: 2000, item: 'clothes', payment_mode: 'Cash' }),
      },
    }],
  }]);
  const fakeDb = {
    prepare() {
      insertCalls += 1;
      throw new Error('A transaction without a clear action must not be saved');
    },
  };

  try {
    const result = await processChatMessage(fakeDb, 'clothes for 2000 rupees');
    assert.match(result.response, /received or spent/i);
    assert.deepEqual(result.tools_used, []);
    assert.equal(insertCalls, 0);
  } finally {
    restoreFetch();
  }
});

test('a database error during transaction creation propagates without a success response', async () => {
  const fakeDb = {
    prepare() {
      return { run() { throw new Error('database unavailable'); } };
    },
  };
  await assert.rejects(
    processChatMessage(fakeDb, 'I bought clothes for 2000 rupees.'),
    /database unavailable/
  );
});

test('a short clarification reply keeps the pending transaction action', async () => {
  const inserted = [];
  const restoreFetch = mockQwen([{
    role: 'assistant',
    tool_calls: [{
      id: 'create-call',
      function: {
        name: 'create_transaction',
        arguments: JSON.stringify({ type: 'Income', amount: 2000, item: 'kapra', payment_mode: 'Cash' }),
      },
    }],
  }]);
  const fakeDb = {
    prepare() {
      return {
        run: (...values) => {
          inserted.push(values);
          return { lastInsertRowid: 43 };
        },
      };
    },
  };

  try {
    const result = await processChatMessage(fakeDb, '2000', [
      { role: 'user', content: 'Maine kapra khareeda' },
      { role: 'assistant', content: 'Kitni raqam thi?' },
    ]);
    assert.match(result.response, /Kharcha darj kar diya gaya/);
    assert.deepEqual(inserted, [['Expense', 2000, 'kapra', 'Cash']]);
  } finally {
    restoreFetch();
  }
});

test('read-only accounting questions still use the summary tool', async () => {
  const calls = [];
  const restoreFetch = mockQwen([
    {
      role: 'assistant',
      tool_calls: [{
        id: 'summary-call',
        function: { name: 'get_summary', arguments: '{}' },
      }],
    },
    { role: 'assistant', content: 'Your net profit is PKR 800.' },
  ], (_payload, index) => calls.push(index));

  const fakeDb = {
    prepare(sql) {
      if (sql.includes('total_income')) return { get: () => ({ total_income: 1000, total_expense: 200 }) };
      return { all: () => [] };
    },
  };

  try {
    const result = await processChatMessage(fakeDb, 'What is my total profit?');
    assert.match(result.response, /net profit: PKR 800/i);
    assert.deepEqual(result.tools_used, ['get_summary']);
    assert.deepEqual(calls, [0, 1]);
  } finally {
    restoreFetch();
  }
});

test('summary tool results are returned in Urdu and Roman Urdu without model-written translation', async () => {
  const cases = [
    {
      message: 'آج کا حساب بتائیں',
      responsePattern: /مجموعی آمدنی: PKR 1,000/,
      scriptPattern: /[\u0600-\u06ff]/,
    },
    {
      message: 'aj ka hisab do',
      responsePattern: /Majmoi aamdani PKR 1,000/,
      scriptPattern: /^[\x00-\x7f]+$/,
    },
  ];

  for (const scenario of cases) {
    const restoreFetch = mockQwen([
      {
        role: 'assistant',
        tool_calls: [{
          id: 'summary-call',
          function: { name: 'get_summary', arguments: '{}' },
        }],
      },
      { role: 'assistant', content: 'An intentionally English answer.' },
    ]);
    const fakeDb = {
      prepare(sql) {
        if (sql.includes('total_income')) {
          return { get: () => ({ total_income: 1000, total_expense: 200 }) };
        }
        return { all: () => [] };
      },
    };

    try {
      const result = await processChatMessage(fakeDb, scenario.message);
      assert.match(result.response, scenario.responsePattern);
      assert.match(result.response, scenario.scriptPattern);
      assert.deepEqual(result.tools_used, ['get_summary']);
    } finally {
      restoreFetch();
    }
  }
});

test('current-month item questions use exact multilingual aliases, type, dates, and matching detail totals', async () => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month] = today.split('-');
  const monthStart = `${year}-${month}-01`;
  const previousMonth = new Date(`${monthStart}T00:00:00.000Z`);
  previousMonth.setUTCDate(0);
  const outsideDate = previousMonth.toISOString().slice(0, 10);
  const cases = [
    {
      message: 'How much did I earn from clothes this month?',
      type: 'Income',
      item: 'clothes',
      expectedTotal: 2000,
      expectedAmounts: [1200, 800],
      responsePattern: /Total earned from clothing this month: PKR 2,000/i,
    },
    {
      message: 'اس مہینے کپڑوں پر کتنا خرچہ ہوا',
      type: 'Expense',
      item: 'clothes',
      expectedTotal: 2800,
      expectedAmounts: [2000, 500, 300],
      responsePattern: /اس مہینے کپڑوں پر کل خرچ: PKR 2,800/,
    },
    {
      message: 'Is mahine kapray par kitna kharcha hua?',
      type: 'Expense',
      item: 'clothes',
      expectedTotal: 2800,
      expectedAmounts: [2000, 500, 300],
      responsePattern: /Is mahine kapron par kul kharch PKR 2,800 hua hai/i,
    },
  ];

  for (const scenario of cases) {
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
    insert.run('Income', 1200, 'کپڑا', 'Cash', `${today} 10:00:00`);
    insert.run('Income', 800, 'kapray', 'Cash', `${today} 11:00:00`);
    insert.run('Expense', 2000, 'کپڑوں', 'Cash', `${today} 12:00:00`);
    insert.run('Expense', 500, 'kapra', 'Cash', `${today} 13:00:00`);
    insert.run('Expense', 300, 'clothes', 'Cash', `${today} 14:00:00`);
    insert.run('Expense', 999, 'clothes', 'Cash', `${outsideDate} 10:00:00`);
    insert.run('Expense', 900, 'shoes', 'Cash', `${today} 15:00:00`);
    const originalPrepare = db.prepare.bind(db);
    const toolQueries = [];
    db.prepare = (sql) => {
      const statement = originalPrepare(sql);
      return {
        all: (...params) => {
          toolQueries.push({ sql, params });
          return statement.all(...params);
        },
      };
    };

    try {
      const result = await processChatMessage(db, scenario.message);
      assert.deepEqual(result.tools_used, ['get_summary_range']);
      assert.match(result.response, scenario.responsePattern);
      const responseAmounts = [...result.response.matchAll(/PKR ([\d,]+)/g)]
        .map((match) => Number(match[1].replace(/,/g, '')));
      assert.equal(responseAmounts[0], scenario.expectedTotal);
      assert.equal(responseAmounts.slice(1).reduce((sum, amount) => sum + amount, 0), scenario.expectedTotal);
      assert.deepEqual(responseAmounts.slice(1), scenario.expectedAmounts);
      assert.equal(toolQueries.length, 1);
      assert.match(toolQueries[0].sql, /DATE\(created_at\) >= \? AND DATE\(created_at\) <= \?/);
      assert.deepEqual(toolQueries[0].params.slice(0, 2), [monthStart, today]);
      assert.ok(toolQueries[0].params.includes(scenario.type));
      assert.ok(toolQueries[0].params.includes('کپڑوں'));
      assert.ok(toolQueries[0].params.includes('kapray'));
      assert.ok(toolQueries[0].params.includes('clothes'));
      assert.deepEqual(
        db.prepare('SELECT item FROM transactions ORDER BY id').all().map(({ item }) => item),
        ['کپڑا', 'kapray', 'کپڑوں', 'kapra', 'clothes', 'clothes', 'shoes']
      );
    } finally {
      db.close();
    }
  }
});

test('complete transaction requests still pass through the existing validated tool', async () => {
  const inserted = [];
  const restoreFetch = mockQwen([
    {
      role: 'assistant',
      tool_calls: [{
        id: 'create-call',
        function: {
          name: 'create_transaction',
          arguments: JSON.stringify({ type: 'Expense', amount: 500, item: 'petrol', payment_mode: 'Cash' }),
        },
      }],
    },
    { role: 'assistant', content: 'Expense recorded.' },
  ]);
  const fakeDb = {
    prepare() {
      return { run: (...values) => { inserted.push(values); return { lastInsertRowid: 42 }; } };
    },
  };

  try {
    const result = await processChatMessage(fakeDb, 'I spent PKR 500 on petrol using cash.');
    assert.match(result.response, /Expense recorded: petrol, PKR 500/i);
    assert.deepEqual(result.tools_used, ['create_transaction']);
    assert.deepEqual(inserted, [['Expense', 500, 'petrol', 'Cash']]);
  } finally {
    restoreFetch();
  }
});
