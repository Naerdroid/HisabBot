export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr.replace(' ', 'T'));
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr.replace(' ', 'T'));
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr.replace(' ', 'T'));
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function getDateRange(period: 'today' | 'week' | 'month' | 'year'): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  let from: Date;

  switch (period) {
    case 'today':
      from = new Date(now);
      break;
    case 'week':
      from = new Date(now);
      from.setDate(from.getDate() - 7);
      break;
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'year':
      from = new Date(now.getFullYear(), 0, 1);
      break;
  }

  return { from: from.toISOString().slice(0, 10), to };
}
