import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ArrowLeftRight, BarChart3, MessageCircle, Settings, LogOut, X, ChevronRight,
} from 'lucide-react';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/chat', label: 'Chat with Hisab Bot', icon: MessageCircle },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();

  const linkClass = (isActive: boolean) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
      isActive
        ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/25'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`;

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" onClick={onClose} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 flex h-full w-72 flex-col bg-white border-r border-gray-200 shadow-xl transition-transform duration-300 lg:translate-x-0 lg:shadow-none lg:z-30 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white font-bold text-lg shadow-lg shadow-primary-600/25">
              H
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 tracking-tight">Hisab Bot</h1>
              <p className="text-xs text-gray-400">Financial Assistant</p>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden p-1 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
          <p className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Menu</p>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              className={({ isActive }) => linkClass(isActive)}
            >
              {({ isActive }) => (
                <>
                  <item.icon size={20} />
                  <span className="flex-1">{item.label}</span>
                  {isActive && <ChevronRight size={16} />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-100 p-4">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-primary-600 font-semibold text-sm">
              U
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">User</p>
              <p className="text-xs text-gray-400">Personal Account</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
