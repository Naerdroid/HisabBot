import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import toast from 'react-hot-toast';
import { transactionApi, type RangeSummary } from '../../services/api';
import { formatCurrency, getDateRange, toLocalDateString } from '../../utils/helpers';
import { CardSkeleton, ChartSkeleton } from '../../components/LoadingSkeleton';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const months = [
  { key: 'month', label: 'This Month' },
  { key: 'last3', label: 'Last 3 Months' },
  { key: 'year', label: 'This Year' },
];

function getRange(period: string): { from: string; to: string } {
  if (period === 'last3') {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return { from: toLocalDateString(from), to: toLocalDateString(now) };
  }
  return getDateRange(period as 'month' | 'year');
}

export default function Reports() {
  const [data, setData] = useState<RangeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('month');

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const range = getRange(period);
        const res = await transactionApi.getRangeSummary(range.from, range.to);
        setData(res);
      } catch {
        toast.error('Failed to load reports');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [period]);

  const incomeItems = data?.by_item.filter((i) => i.type === 'Income') ?? [];
  const expenseItems = data?.by_item.filter((i) => i.type === 'Expense') ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Financial analysis and insights</p>
        </div>
        <div className="flex rounded-xl bg-gray-100 p-1">
          {months.map((m) => (
            <button
              key={m.key}
              onClick={() => setPeriod(m.key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                period === m.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <p className="text-sm font-medium text-gray-500">Total Income</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{formatCurrency(data.total_income)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <p className="text-sm font-medium text-gray-500">Total Expenses</p>
            <p className="text-2xl font-bold text-red-500 mt-1">{formatCurrency(data.total_expense)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <p className="text-sm font-medium text-gray-500">Net Profit</p>
            <p className={`text-2xl font-bold mt-1 ${data.net_profit >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
              {formatCurrency(data.net_profit)}
            </p>
          </div>
        </div>
      ) : null}

      {/* Income vs Expense trend */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Income vs Expenses Over Time</h2>
        {loading || !data ? (
          <ChartSkeleton />
        ) : data.daily_breakdown.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <p className="text-sm">No data for this period</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={data.daily_breakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: string) => {
                  const d = new Date(v + 'T00:00:00');
                  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                }}
              />
              <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb' }}
                formatter={(value: number, name: string) => [formatCurrency(value), name === 'income' ? 'Income' : 'Expense']}
                labelFormatter={(v: string) => {
                  const d = new Date(v + 'T00:00:00');
                  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
                }}
              />
              <Legend formatter={(value: string) => value === 'income' ? 'Income' : 'Expense'} />
              <Line type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="expense" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Profit trend */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Profit Trend</h2>
        {loading || !data ? (
          <ChartSkeleton />
        ) : data.daily_breakdown.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <p className="text-sm">No data for this period</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.daily_breakdown.map((d) => ({ ...d, profit: d.income - d.expense }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: string) => {
                  const d = new Date(v + 'T00:00:00');
                  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                }}
              />
              <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb' }}
                formatter={(value: number) => [formatCurrency(value), 'Profit']}
                labelFormatter={(v: string) => {
                  const d = new Date(v + 'T00:00:00');
                  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
                }}
              />
              <Bar dataKey="profit" fill="#3b82f6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Pie charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Expense breakdown */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Expense Breakdown</h2>
          {loading || !data ? (
            <ChartSkeleton />
          ) : expenseItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <p className="text-sm">No expenses in this period</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={expenseItems}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={4}
                  dataKey="total"
                  nameKey="item"
                  label={({ item, total }: { item: string; total: number }) => `${item}: ${formatCurrency(total)}`}
                >
                  {expenseItems.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Income breakdown */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Income Breakdown</h2>
          {loading || !data ? (
            <ChartSkeleton />
          ) : incomeItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <p className="text-sm">No income in this period</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={incomeItems}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={4}
                  dataKey="total"
                  nameKey="item"
                  label={({ item, total }: { item: string; total: number }) => `${item}: ${formatCurrency(total)}`}
                >
                  {incomeItems.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
