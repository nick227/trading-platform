import { Navigate, Route, Routes } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import AdminOverviewPage from './pages/AdminOverviewPage'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminTradingPage from './pages/AdminTradingPage'
import AdminAiDataPage from './pages/AdminAiDataPage'
import AdminSystemPage from './pages/AdminSystemPage'
import '../../styles/admin.css'

export default function AdminDashboard() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AdminOverviewPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="users/:userId" element={<AdminUsersPage />} />
        <Route path="trading" element={<AdminTradingPage />} />
        <Route path="ai" element={<AdminAiDataPage />} />
        <Route path="system" element={<AdminSystemPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  )
}
