import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import type { UserRole } from './types'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import CollectionsPage from './pages/CollectionsPage'
import CollectionBuilderPage from './pages/CollectionBuilderPage'
import CollectionBranchingPage from './pages/CollectionBranchingPage'
import CollectionFillPage from './pages/CollectionFillPage'
import RecordsPage from './pages/RecordsPage'
import DashboardPage from './pages/DashboardPage'
import SettingsPage from './pages/SettingsPage'
import ReportsPage from './pages/ReportsPage'
import AISummaryPage from './pages/AISummaryPage'
import NotificationsPage from './pages/NotificationsPage'
import MySubmissionsPage from './pages/MySubmissionsPage'
import MySubmissionDetailPage from './pages/MySubmissionDetailPage'
import AcceptInvitePage from './pages/AcceptInvitePage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'

function RequireAuth() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

function RequireRole({ allowed, fallback = '/dashboard' }: { allowed: UserRole[]; fallback?: string }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!allowed.includes(user.role)) return <Navigate to={fallback} replace />
  return <Outlet />
}

export default function App() {
  const { user } = useAuth()

  return (
    <Routes>
      {/* Public */}
      <Route
        path="/login"
        element={!user ? <LoginPage /> : <Navigate to={user.role === 'user' ? '/dashboard' : user.role === 'reviewer' ? '/records' : '/collections'} replace />}
      />
      <Route path="/fill/:slug" element={<CollectionFillPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Protected shell */}
      <Route element={<RequireAuth />}>
        <Route element={<HomePage />}>
          <Route index element={<Navigate to={user?.role === 'user' ? '/dashboard' : user?.role === 'reviewer' ? '/records' : '/collections'} replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/my-submissions" element={<MySubmissionsPage />} />
          <Route path="/my-submissions/:responseId" element={<MySubmissionDetailPage />} />

          {/* Reviewer + above can view records */}
          <Route element={<RequireRole allowed={['super_admin', 'administrator', 'team_manager', 'reviewer']} fallback="/dashboard" />}>
            <Route path="/records" element={<RecordsPage />} />
          </Route>

          {/* Collections + admin routes: team_manager and above */}
          <Route element={<RequireRole allowed={['super_admin', 'administrator', 'team_manager']} fallback="/records" />}>
            <Route path="/collections" element={<CollectionsPage />} />
            <Route path="/collections/new" element={<CollectionBuilderPage />} />
            <Route path="/collections/:id/edit" element={<CollectionBuilderPage />} />
            <Route path="/collections/:id/branching" element={<CollectionBranchingPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route element={<RequireRole allowed={['super_admin', 'administrator']} fallback="/dashboard" />}>
            <Route path="/ai-summary" element={<AISummaryPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to={user ? (user.role === 'user' ? '/dashboard' : user.role === 'reviewer' ? '/records' : '/collections') : '/login'} replace />} />
    </Routes>
  )
}
