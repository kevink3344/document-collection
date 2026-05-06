import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import CollectionsPage from './pages/CollectionsPage'
import CollectionBuilderPage from './pages/CollectionBuilderPage'
import CollectionFillPage from './pages/CollectionFillPage'
import RecordsPage from './pages/RecordsPage'
import DashboardPage from './pages/DashboardPage'
import SettingsPage from './pages/SettingsPage'

function RequireAuth() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

export default function App() {
  const { user } = useAuth()

  return (
    <Routes>
      {/* Public */}
      <Route
        path="/login"
        element={!user ? <LoginPage /> : <Navigate to="/collections" replace />}
      />
      <Route path="/fill/:slug" element={<CollectionFillPage />} />

      {/* Protected shell */}
      <Route element={<RequireAuth />}>
        <Route element={<HomePage />}>
          <Route index element={<Navigate to="/collections" replace />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/collections/new" element={<CollectionBuilderPage />} />
          <Route path="/collections/:id/edit" element={<CollectionBuilderPage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to={user ? '/collections' : '/login'} replace />} />
    </Routes>
  )
}
