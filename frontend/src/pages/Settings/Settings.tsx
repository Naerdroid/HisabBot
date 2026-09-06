import { User, Globe, Bell, Shield, Info } from 'lucide-react';
import { useState } from 'react';

export default function SettingsPage() {
  const [currency, setCurrency] = useState('PKR');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account and preferences</p>
      </div>

      {/* Profile Section */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <User size={18} className="text-gray-400" />
            Profile
          </h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100 text-primary-600 text-2xl font-bold">
              U
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">User</p>
              <p className="text-sm text-gray-400">Personal Account</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Display Name</label>
              <input
                type="text"
                defaultValue="User"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
              <input
                type="email"
                defaultValue="user@example.com"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Globe size={18} className="text-gray-400" />
            Preferences
          </h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all text-sm bg-white"
            >
              <option value="PKR">PKR - Pakistani Rupee</option>
              <option value="USD">USD - US Dollar</option>
              <option value="INR">INR - Indian Rupee</option>
              <option value="EUR">EUR - Euro</option>
              <option value="GBP">GBP - British Pound</option>
            </select>
          </div>
          <button
            onClick={handleSave}
            className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-xl shadow-lg shadow-primary-600/25 transition-all"
          >
            {saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* About */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Info size={18} className="text-gray-400" />
            About
          </h2>
        </div>
        <div className="p-6">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Application</span>
              <span className="font-medium text-gray-900">Hisab Bot</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Version</span>
              <span className="font-medium text-gray-900">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Backend</span>
              <span className="font-medium text-gray-900">Node.js / Express / SQLite</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Frontend</span>
              <span className="font-medium text-gray-900">React / Vite / Tailwind CSS</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
