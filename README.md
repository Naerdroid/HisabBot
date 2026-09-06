# HisabBot — AI-Powered Personal Finance Assistant

> **Your money, understood. Your finances, simplified.**

HisabBot is an AI-powered personal finance assistant designed to make expense and income tracking as simple as having a conversation.

Instead of filling complicated forms or manually navigating finance applications, users can interact with HisabBot using natural language.

For example:

> **User:** "I spent 1,500 rupees on clothes today using cash."

HisabBot understands the request, extracts the transaction details, validates them, and records the transaction automatically.

---

## What is HisabBot?

Managing personal finances can be difficult when recording every transaction requires multiple fields and screens.

HisabBot provides a conversational interface for financial tracking.

Users can say things like:

* "I spent Rs. 2,000 on groceries."
* "Add Rs. 5,000 salary income."
* "How much did I spend today?"
* "What is my total income?"
* "How much profit do I have?"
* "Show me today's transactions."

The AI interprets the user's intent and converts natural-language requests into structured financial actions.

---

## Key Features

### Conversational Finance Tracking

Record income and expenses using natural language instead of manually completing forms.

### Local Qwen AI

HisabBot uses a locally hosted Qwen model through LM Studio for natural-language understanding and reasoning.

### Controlled AI Tool Calling

The AI does not directly access the database.

AI-generated tool calls pass through:

1. Tool whitelist
2. Argument validation
3. Transaction service
4. SQLite database

This provides a controlled boundary between AI reasoning and financial data operations.

### Income & Expense Management

Track:

* Income
* Expenses
* Amount
* Item/category
* Payment mode
* Transaction date

### Financial Summary

HisabBot can calculate:

* Total income
* Total expenses
* Net profit
* Today's transactions

### Local SQLite Database

Financial records are stored locally using SQLite through `better-sqlite3`.

---

# System Architecture

```text
                    ┌──────────────────┐
                    │      User        │
                    │ Natural Language │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │    HisabBot      │
                    │  Backend / API   │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Qwen 2.5 7B      │
                    │   via LM Studio  │
                    └────────┬─────────┘
                             │
                        Tool Call
                             │
                             ▼
                    ┌──────────────────┐
                    │  Tool Whitelist  │
                    │   & Validation   │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Transaction      │
                    │    Service       │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │     SQLite       │
                    │    hisab.db      │
                    └──────────────────┘
```

---

# AI Safety & Validation

A key design principle of HisabBot is that the language model is **not given unrestricted access to the database**.

The AI can only request predefined tools.

Tool calls are checked against an allowed-tool list before execution.

Transaction arguments are also validated before they reach the database.

For example:

```javascript
if (!Number.isInteger(amount) || amount <= 0) {
    return {
        ok: false,
        error: 'amount must be a positive integer'
    };
}
```

This creates a controlled architecture:

```text
AI Reasoning
     ↓
Allowed Tool?
     ↓
Arguments Valid?
     ↓
Transaction Service
     ↓
Database
```

---

# Technology Stack

| Technology     | Purpose                        |
| -------------- | ------------------------------ |
| Qwen 2.5 7B    | Natural-language reasoning     |
| LM Studio      | Local AI model serving         |
| Node.js        | Backend runtime                |
| Express.js     | API server                     |
| SQLite         | Local financial database       |
| better-sqlite3 | SQLite interface               |
| JavaScript     | Backend implementation         |
| REST API       | Frontend/backend communication |

---

# Project Structure

```text
HisabBot/
│
├── backend/
│   ├── services/
│   │   ├── qwenAgent.js
│   │   └── transactionService.js
│   │
│   ├── index.js
│   ├── package.json
│   └── package-lock.json
│
├── frontend/
│   └── ...
│
├── README.md
└── .gitignore
```

> `hisab.db`, `.env`, and `node_modules` are intentionally excluded from the public repository.

---

# Installation

## 1. Clone the repository

```bash
git clone https://github.com/Naerdroid/HisabBot.git
cd HisabBot
```

---

# AI Setup

HisabBot uses a **locally hosted Qwen model through LM Studio**.

## 1. Install LM Studio

Download and install LM Studio.

## 2. Download the required Qwen model

Load:

```text
qwen2.5-7b-instruct
```

in LM Studio.

## 3. Start the local server

By default, HisabBot expects LM Studio at:

```text
http://localhost:1234
```

The backend can also be configured using environment variables.

---

# Backend Setup

Open a terminal:

```bash
cd backend
```

Install dependencies:

```bash
npm install
```

Start the backend:

```bash
node index.js
```

The backend will start on its configured port.

---

# Frontend Setup

Open another terminal:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

---

# Environment Configuration

Create a `.env` file if you want to customize the AI configuration.

Example:

```env
LM_STUDIO_URL=http://localhost:1234
QWEN_MODEL=qwen2.5-7b-instruct
```

For security, `.env` is excluded from Git.

A `.env.example` file can be used to document the required configuration without exposing secrets.

---

# API

The backend provides REST endpoints for interacting with financial data.

Example transaction request:

```http
POST /api/transactions
```

Example:

```json
{
  "type": "Expense",
  "amount": 1500,
  "item": "Clothes",
  "payment_mode": "Cash"
}
```

The API stores the transaction in the local SQLite database.

---

# Example

### User

```text
I spent 1500 rupees on clothes using cash.
```

### HisabBot

The AI identifies:

```text
Type: Expense
Amount: 1500
Item: Clothes
Payment Mode: Cash
```

Then the validated transaction is stored in SQLite.

---

# Why HisabBot?

Traditional finance applications often require users to manually enter:

* Transaction type
* Amount
* Category
* Payment method
* Date

HisabBot removes much of this friction by allowing users to **talk naturally about their finances**.

The goal is simple:

> **Make financial tracking feel like a conversation, not paperwork.**

---

# Privacy by Design

HisabBot is designed around local-first processing.

The AI reasoning layer can run locally through LM Studio, while financial data is stored in a local SQLite database.

This reduces the need to send personal financial information to external cloud AI services.

---

# Hackathon Highlights

### AI Integration

Natural-language financial understanding powered by Qwen.

### Agentic Tool Calling

The AI can translate natural language into structured actions through controlled tools.

### Validation Layer

AI-generated actions are validated before database operations.

### Local-First Architecture

AI inference and financial storage can run locally.

### Simple User Experience

Users interact with their finances using everyday language.

---

# Future Improvements

* Voice-based expense recording
* Budget recommendations
* Multi-user authentication
* Mobile application
* Cloud synchronization as an optional feature

---

# Team

Built for the **Alibaba Cloud AI Hackathon Pakistan 2026**.

* Noor e Sehr Ali
* Mirha Shakeel

---

## License

This project is created as a hackathon project.
