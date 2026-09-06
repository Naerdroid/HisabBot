import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from '../components/Sidebar';

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content */}
      <div className="lg:pl-72">
        {/* Mobile header */}
        <header className="sticky top-0 z-20 flex items-center gap-4 bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 py-3 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-600"
          >
            <Menu size={22} />
          </button>
          <h1 className="text-lg font-bold text-gray-900">Hisab Bot</h1>
        </header>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
