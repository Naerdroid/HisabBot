import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Filter, Edit2, Trash2, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { transactionApi, type Transaction, type TransactionFilters, type CreateTransaction, type PaginatedTransactions } from '../../services/api';
import { formatCurrency, formatDate } from '../../utils/helpers';
import TransactionForm from '../../components/TransactionForm';
import ConfirmDialog from '../../components/ConfirmDialog';
import { TableSkeleton } from '../../components/LoadingSkeleton';

export default function Transactions() {
  const [data, setData] = useState<PaginatedTransactions | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<TransactionFilters>({ page: 1, limit: 15, sort: 'created_at', order: 'desc' });
  const [searchInput, setSearchInput] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await transactionApi.getAll(filters);
      setData(res);
    } catch {
      toast.error('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput || undefined, page: 1 }));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleCreate = async (data: CreateTransaction) => {
    await transactionApi.create(data);
    toast.success('Transaction added');
    setShowForm(false);
    fetchData();
  };

  const handleUpdate = async (data: CreateTransaction) => {
    if (!editingTx) return;
    await transactionApi.update(editingTx.id, data);
    toast.success('Transaction updated');
    setEditingTx(null);
    fetchData();
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    setDeleting(true);
    try {
      await transactionApi.delete(deleteId);
      toast.success('Transaction deleted');
      setDeleteId(null);
      fetchData();
    } catch {
      toast.error('Failed to delete transaction');
    } finally {
      setDeleting(false);
    }
  };

  const toggleSort = (col: string) => {
    setFilters((f) => ({
      ...f,
      sort: col,
      order: f.sort === col && f.order === 'desc' ? 'asc' : 'desc',
    }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
          <p className="text-sm text-gray-500 mt-1">Manage all your financial records</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-xl shadow-lg shadow-primary-600/25 transition-all"
        >
          <Plus size={18} />
          Add Transaction
        </button>
      </div>

      {/* Filters bar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search transactions..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all text-sm"
            />
          </div>

          {/* Type filter */}
          <select
            value={filters.type ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, type: (e.target.value || undefined) as any, page: 1 }))}
            className="px-4 py-2.5 rounded-xl border border-gray-300 text-sm bg-white focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none"
          >
            <option value="">All Types</option>
            <option value="Income">Income</option>
            <option value="Expense">Expense</option>
          </select>

          {/* Date range */}
          <input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined, page: 1 }))}
            className="px-4 py-2.5 rounded-xl border border-gray-300 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none"
            placeholder="From"
          />
          <input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined, page: 1 }))}
            className="px-4 py-2.5 rounded-xl border border-gray-300 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none"
            placeholder="To"
          />
        </div>
      </div>

      {/* Transactions table */}
      {loading ? (
        <TableSkeleton rows={8} />
      ) : !data || data.transactions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 flex flex-col items-center justify-center py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 mb-4">
            <Filter size={28} />
          </div>
          <p className="text-gray-500 font-medium">No transactions found</p>
          <p className="text-sm text-gray-400 mt-1">Try adjusting your filters or add a new transaction</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-xl transition-all"
          >
            <Plus size={18} /> Add Transaction
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                    <button onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-gray-700">
                      Date <ArrowUpDown size={14} />
                    </button>
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                    <button onClick={() => toggleSort('item')} className="inline-flex items-center gap-1 hover:text-gray-700">
                      Description <ArrowUpDown size={14} />
                    </button>
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Type</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Payment</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                    <button onClick={() => toggleSort('amount')} className="inline-flex items-center gap-1 hover:text-gray-700 ml-auto">
                      Amount <ArrowUpDown size={14} />
                    </button>
                  </th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5 text-sm text-gray-600">{formatDate(tx.created_at)}</td>
                    <td className="px-5 py-3.5 text-sm font-medium text-gray-900">{tx.item}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg ${
                        tx.type === 'Income' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{tx.payment_mode}</td>
                    <td className={`px-5 py-3.5 text-sm font-semibold text-right ${
                      tx.type === 'Income' ? 'text-emerald-600' : 'text-red-500'
                    }`}>
                      {tx.type === 'Income' ? '+' : '-'} {formatCurrency(tx.amount)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditingTx(tx)}
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteId(tx.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-100">
            {data.transactions.map((tx) => (
              <div key={tx.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{tx.item}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(tx.created_at)} · {tx.payment_mode}</p>
                  </div>
                  <span className={`text-sm font-semibold ${
                    tx.type === 'Income' ? 'text-emerald-600' : 'text-red-500'
                  }`}>
                    {tx.type === 'Income' ? '+' : '-'} {formatCurrency(tx.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md ${
                    tx.type === 'Income' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {tx.type}
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => setEditingTx(tx)} className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => setDeleteId(tx.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} records)
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setFilters((f) => ({ ...f, page: Math.max(1, (f.page ?? 1) - 1) }))}
                  disabled={data.pagination.page <= 1}
                  className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={() => setFilters((f) => ({ ...f, page: Math.min(data.pagination.totalPages, (f.page ?? 1) + 1) }))}
                  disabled={data.pagination.page >= data.pagination.totalPages}
                  className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add form */}
      {showForm && <TransactionForm onSubmit={handleCreate} onClose={() => setShowForm(false)} />}

      {/* Edit form */}
      {editingTx && (
        <TransactionForm
          transaction={editingTx}
          onSubmit={handleUpdate}
          onClose={() => setEditingTx(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteId !== null && (
        <ConfirmDialog
          title="Delete Transaction"
          message="Are you sure you want to delete this transaction? This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
          loading={deleting}
        />
      )}
    </div>
  );
}
