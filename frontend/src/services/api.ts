import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Chat requests can take longer — local Qwen model may need extra time
// for tool-calling rounds (Qwen → tools → Qwen → final answer).
const chatClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 180000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Transaction {
  id: number;
  type: 'Income' | 'Expense';
  amount: number;
  item: string;
  payment_mode: string;
  created_at: string;
}

export interface CreateTransaction {
  type: 'Income' | 'Expense';
  amount: number;
  item: string;
  payment_mode: string;
}

export interface Summary {
  total_income: number;
  total_expense: number;
  net_profit: number;
  todays_transactions: Transaction[];
}

export interface PaginatedTransactions {
  transactions: Transaction[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface TransactionFilters {
  type?: 'Income' | 'Expense';
  search?: string;
  from?: string;
  to?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface RangeSummary {
  total_income: number;
  total_expense: number;
  net_profit: number;
  daily_breakdown: { date: string; income: number; expense: number }[];
  by_item: { type: string; item: string; total: number }[];
}

export interface ChatResponse {
  response: string;
  tools_used: string[];
}

// ─── API Calls ─────────────────────────────────────────────────────────────────

export const transactionApi = {
  getSummary: () => api.get<Summary>('/summary').then((r) => r.data),

  getRangeSummary: (from: string, to: string) =>
    api.get<RangeSummary>('/summary/range', { params: { from, to } }).then((r) => r.data),

  getAll: (filters: TransactionFilters = {}) =>
    api.get<PaginatedTransactions>('/transactions', { params: filters }).then((r) => r.data),

  getById: (id: number) =>
    api.get<Transaction>(`/transactions/${id}`).then((r) => r.data),

  create: (data: CreateTransaction) =>
    api.post<{ message: string; transaction: Transaction }>('/transaction', data).then((r) => r.data),

  update: (id: number, data: Partial<CreateTransaction>) =>
    api.put<{ message: string; transaction: Transaction }>(`/transactions/${id}`, data).then((r) => r.data),

  delete: (id: number) =>
    api.delete<{ message: string }>(`/transactions/${id}`).then((r) => r.data),
};

export const chatApi = {
  sendMessage: (message: string) =>
    chatClient.post<ChatResponse>('/chat', { message }).then((r) => r.data),
};

export default api;
