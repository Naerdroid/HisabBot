import { Routes, Route } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard/Dashboard';
import Transactions from './pages/Transactions/Transactions';
import Reports from './pages/Reports/Reports';
import Chat from './pages/Chat/Chat';
import SettingsPage from './pages/Settings/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
