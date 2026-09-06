import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Wallet, ArrowUpRight, Plus, ArrowLeftRight, MessageCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import toast from 'react-hot-toast';
import { transactionApi, type Summary, type RangeSummary } from '../../services/api';
import { formatCurrency, formatDate, getDateRange } from '../../utils/helpers';
import StatCard from '../../components/StatCard';
import TransactionForm from '../../components/TransactionForm';
import { CardSkeleton, ChartSkeleton, TableSkeleton } from '../../components/LoadingSkeleton';
import type { CreateTransaction } from '../../services/api';

const periods = [
  { key: 'today' as const, label: 'Today' },
  { key: 'week' as const, label: 'This Week' },
  { key: 'month' as const, label: 'This Month' },
  { key: 'year' as const, label: 'This Year' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rangeData, setRangeData] = useState<RangeSummary | null>(null);
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'year'>('month');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<'Income' | 'Expense'>('Income');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, rangeRes] = await Promise.all([
        transactionApi.getSummary(),
        transactionApi.getRangeSummary(...Object.values(getDateRange(period))),
      ]);
      setSummary(summaryRes);
      setRangeData(rangeRes);
    } catch {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddTransaction = async (data: CreateTransaction) => {
    try {
      await transactionApi.create(data);
      toast.success('Transaction added successfully');
      setShowForm(false);
      fetchData();
    } catch {
      toast.error('Failed to add transaction');
    }
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Your financial overview at a glance</p>
        </div>
        <button
          onClick={() => { setFormType('Income'); setShowForm(true); }}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-xl shadow-lg shadow-primary-600/25 transition-all"
        >
          <Plus size={18} />
          Add Transaction
        </button>
      </div>

      {/* Stat cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Income"
            value={formatCurrency(summary.total_income)}
            icon={<TrendingUp size={22} />}
            color="green"
          />
          <StatCard
            title="Total Expenses"
            value={formatCurrency(summary.total_expense)}
            icon={<TrendingDown size={22} />}
            color="red"
          />
          <StatCard
            title="Net Profit"
            value={formatCurrency(summary.net_profit)}
            icon={<Wallet size={22} />}
            color={summary.net_profit >= 0 ? 'blue' : 'red'}
          />
          <StatCard
            title="Today's Transactions"
            value={summary.todays_transactions.length.toString()}
            icon={<ArrowUpRight size={22} />}
            color="purple"
            subtitle="transactions today"
          />
        </div>
      ) : null}

      {/* Chart */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <h2 className="text-lg font-semibold text-gray-900">Income vs Expenses</h2>
          <div className="flex rounded-xl bg-gray-100 p-1">
            {periods.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  period === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {loading || !rangeData ? (
          <ChartSkeleton />
        ) : rangeData.daily_breakdown.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <TrendingUp size={48} className="mb-3 opacity-50" />
            <p className="text-sm">No transactions in this period</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={rangeData.daily_breakdown} barGap={4}>
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
                contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                formatter={(value: number, name: string) => [formatCurrency(value), name === 'income' ? 'Income' : 'Expense']}
                labelFormatter={(v: string) => {
                  const d = new Date(v + 'T00:00:00');
                  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
                }}
              />
              <Legend formatter={(value: string) => value === 'income' ? 'Income' : 'Expense'} />
              <Bar dataKey="income" fill="#10b981" radius={[6, 6, 0, 0]} />
              <Bar dataKey="expense" fill="#ef4444" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Recent Transactions + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Transactions */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Recent Transactions</h2>
            <button
              onClick={() => navigate('/transactions')}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              View All
            </button>
          </div>
          {loading || !summary ? (
            <div className="p-4"><TableSkeleton rows={5} /></div>
          ) : summary.todays_transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <ArrowLeftRight size={40} className="mb-3 opacity-50" />
              <p className="text-sm">No transactions today</p>
              <button
                onClick={() => { setFormType('Income'); setShowForm(true); }}
                className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Add your first transaction
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {summary.todays_transactions.slice(0, 8).map((tx) => (
                <div key={tx.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                      tx.type === 'Income' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
                    }`}>
                      {tx.type === 'Income' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{tx.item}</p>
                      <p className="text-xs text-gray-400">{tx.payment_mode} · {formatDate(tx.created_at)}</p>
                    </div>
                  </div>
                  <span className={`text-sm font-semibold ${
                    tx.type === 'Income' ? 'text-emerald-600' : 'text-red-500'
                  }`}>
                    {tx.type === 'Income' ? '+' : '-'} {formatCurrency(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <button
              onClick={() => { setFormType('Income'); setShowForm(true); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors text-sm font-medium"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-white">
                <TrendingUp size={16} />
              </div>
              Add Income
            </button>
            <button
              onClick={() => { setFormType('Expense'); setShowForm(true); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 text-red-700 hover:bg-red-100 transition-colors text-sm font-medium"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500 text-white">
                <TrendingDown size={16} />
              </div>
              Add Expense
            </button>
            <button
              onClick={() => navigate('/transactions')}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors text-sm font-medium"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500 text-white">
                <ArrowLeftRight size={16} />
              </div>
              View All Transactions
            </button>
            <button
              onClick={() => navigate('/chat')}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors text-sm font-medium"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500 text-white">
                <MessageCircle size={16} />
              </div>
              Chat with Hisab Bot
            </button>
          </div>
        </div>
      </div>

      {/* Transaction Form Modal */}
      {showForm && (
        <TransactionForm
          defaultType={formType}
          onSubmit={handleAddTransaction}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
