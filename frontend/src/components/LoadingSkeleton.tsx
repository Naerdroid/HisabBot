export function CardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-3 flex-1">
          <div className="h-4 bg-gray-200 rounded-lg w-24" />
          <div className="h-7 bg-gray-200 rounded-lg w-32" />
        </div>
        <div className="h-11 w-11 bg-gray-200 rounded-xl" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden animate-pulse">
      <div className="p-4 border-b border-gray-100">
        <div className="h-5 bg-gray-200 rounded-lg w-40" />
      </div>
      <div className="divide-y divide-gray-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="h-4 bg-gray-200 rounded w-20" />
            <div className="h-4 bg-gray-200 rounded flex-1" />
            <div className="h-4 bg-gray-200 rounded w-16" />
            <div className="h-4 bg-gray-200 rounded w-24" />
            <div className="h-4 bg-gray-200 rounded w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 animate-pulse">
      <div className="h-5 bg-gray-200 rounded-lg w-48 mb-6" />
      <div className="flex items-end gap-2 h-48">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex-1 bg-gray-200 rounded-t-lg" style={{ height: `${30 + Math.random() * 70}%` }} />
        ))}
      </div>
    </div>
  );
}
