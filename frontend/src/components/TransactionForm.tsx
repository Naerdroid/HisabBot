import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Transaction, CreateTransaction } from '../services/api';

interface TransactionFormProps {
  transaction?: Transaction | null;
  onSubmit: (data: CreateTransaction) => Promise<void>;
  onClose: () => void;
  defaultType?: 'Income' | 'Expense';
}

export default function TransactionForm({ transaction, onSubmit, onClose, defaultType }: TransactionFormProps) {
  const [type, setType] = useState<'Income' | 'Expense'>(transaction?.type ?? defaultType ?? 'Income');
  const [amount, setAmount] = useState(transaction?.amount?.toString() ?? '');
  const [item, setItem] = useState(transaction?.item ?? '');
  const [paymentMode, setPaymentMode] = useState(transaction?.payment_mode ?? '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseInt(amount);
    if (!item.trim() || !paymentMode.trim() || isNaN(parsedAmount) || parsedAmount <= 0) return;

    setSubmitting(true);
    try {
      await onSubmit({ type, amount: parsedAmount, item: item.trim(), payment_mode: paymentMode.trim() });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {transaction ? 'Edit Transaction' : 'Add Transaction'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Type toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
            <div className="flex rounded-xl bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setType('Income')}
                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
                  type === 'Income'
                    ? 'bg-emerald-500 text-white shadow-md'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Income
              </button>
              <button
                type="button"
                onClick={() => setType('Expense')}
                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
                  type === 'Expense'
                    ? 'bg-red-500 text-white shadow-md'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Expense
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Amount (PKR)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 5000"
              min="1"
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all text-sm"
            />
          </div>

          {/* Item / Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <input
              type="text"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="e.g. Freelance Payment"
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all text-sm"
            />
          </div>

          {/* Payment Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method</label>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all text-sm bg-white"
            >
              <option value="">Select method</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Card">Card</option>
              <option value="Cheque">Cheque</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl shadow-lg shadow-primary-600/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {submitting ? 'Saving...' : transaction ? 'Update Transaction' : 'Add Transaction'}
          </button>
        </form>
      </div>
    </div>
  );
}
