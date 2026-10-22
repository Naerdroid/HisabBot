import { User, Info } from 'lucide-react';
import { useState } from 'react';

const SETTINGS_KEY = 'hisabbot.settings';

interface StoredSettings {
  displayName: string;
  email: string;
}

function readStoredSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredSettings>;
      return {
        displayName:
          typeof parsed.displayName === 'string' && parsed.displayName.trim()
            ? parsed.displayName
            : 'User',
        email: typeof parsed.email === 'string' ? parsed.email : '',
      };
    }
  } catch {
    // Ignore unreadable or malformed stored settings and fall back to defaults
  }
  return { displayName: 'User', email: '' };
}

export default function SettingsPage() {
  const [displayName, setDisplayName] = useState(() => readStoredSettings().displayName);
  const [email, setEmail] = useState(() => readStoredSettings().email);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleSave = () => {
    const settings: StoredSettings = {
      displayName: displayName.trim() || 'User',
      email: email.trim(),
    };

    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      setDisplayName(settings.displayName);
      setEmail(settings.email);
      setSaveError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Persisting failed (e.g. storage disabled) — never claim success
      setSaved(false);
      setSaveError('Could not save changes. Please try again.');
    }
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
              {displayName.trim().charAt(0).toUpperCase() || 'U'}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{displayName.trim() || 'User'}</p>
              <p className="text-sm text-gray-400">Personal Account</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setSaved(false); }}
                placeholder="User"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setSaved(false); }}
                placeholder="user@example.com"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-xl shadow-lg shadow-primary-600/25 transition-all"
            >
              Save Changes
            </button>
            <span aria-live="polite" className="text-sm">
              {saved && <span className="text-emerald-600">Saved!</span>}
              {saveError && <span className="text-red-600">{saveError}</span>}
            </span>
          </div>
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
