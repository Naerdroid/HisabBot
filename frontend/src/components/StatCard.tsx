import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  color: 'green' | 'red' | 'blue' | 'purple';
  subtitle?: string;
}

const colorMap = {
  green: { bg: 'bg-emerald-50', icon: 'bg-emerald-500', shadow: 'shadow-emerald-500/20' },
  red: { bg: 'bg-red-50', icon: 'bg-red-500', shadow: 'shadow-red-500/20' },
  blue: { bg: 'bg-blue-50', icon: 'bg-blue-500', shadow: 'shadow-blue-500/20' },
  purple: { bg: 'bg-purple-50', icon: 'bg-purple-500', shadow: 'shadow-purple-500/20' },
};

export default function StatCard({ title, value, icon, color, subtitle }: StatCardProps) {
  const c = colorMap[color];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 hover:shadow-lg transition-shadow duration-300">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900 tracking-tight">{value}</p>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${c.icon} text-white shadow-lg ${c.shadow}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
