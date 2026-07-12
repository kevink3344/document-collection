import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import type { UserRole } from './types'
import ChangePasswordModal from './components/common/ChangePasswordModal'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import CollectionsPage from './pages/CollectionsPage'
import CollectionTypePage from './pages/CollectionTypePage'
import CollectionBuilderPage from './pages/CollectionBuilderPage'
import CollectionBranchingPage from './pages/CollectionBranchingPage'
import CollectionFillPage from './pages/CollectionFillPage'
import RecordsPage from './pages/RecordsPage'
import DashboardPage from './pages/DashboardPage'
import SettingsPage from './pages/SettingsPage'
import ReportsPage from './pages/ReportsPage'
import AISummaryPage from './pages/AISummaryPage'
import TicketDesignerPage from './pages/TicketDesignerPage'
import NotificationsPage from './pages/NotificationsPage'
import AboutPage from './pages/AboutPage'
import MySubmissionsPage from './pages/MySubmissionsPage'
import MySubmissionDetailPage from './pages/MySubmissionDetailPage'
import ApprovalsPage from './pages/ApprovalsPage'
import SignupSheetBuilderPage from './pages/SignupSheetBuilderPage'
import SignupSheetFillPage from './pages/SignupSheetFillPage'

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
  const { user, clearMustChangePassword } = useAuth()
  const defaultAuthenticatedRoute = user?.role === 'user'
    ? '/dashboard'
    : user?.role === 'reviewer'
      ? '/collections'
      : '/collections'

  return (
    <>
      {/* Force-change password modal — shown over everything until resolved */}
      {user?.mustChangePassword && (
        <ChangePasswordModal onSuccess={clearMustChangePassword} />
      )}
    <Routes>
      {/* Public */}
      <Route
        path="/login"
        element={!user ? <LoginPage /> : <Navigate to={defaultAuthenticatedRoute} replace />}
      />
      <Route path="/fill/:slug" element={<CollectionFillPage />} />
      <Route path="/signup/:slug" element={<SignupSheetFillPage />} />

      {/* Protected shell */}
      <Route element={<RequireAuth />}>
        <Route element={<HomePage />}>
          <Route index element={<Navigate to={defaultAuthenticatedRoute} replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/my-submissions" element={<MySubmissionsPage />} />
          <Route path="/my-submissions/:responseId" element={<MySubmissionDetailPage />} />

          {/* Reviewer-and-up read routes */}
          <Route element={<RequireRole allowed={['super_admin', 'administrator', 'team_manager', 'reviewer']} fallback="/dashboard" />}>
            <Route path="/collections" element={<CollectionsPage />} />
            <Route path="/records" element={<RecordsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
          </Route>

          {/* Management routes */}
          <Route element={<RequireRole allowed={['super_admin', 'administrator', 'team_manager']} fallback="/dashboard" />}>
            <Route path="/collections/new" element={<CollectionTypePage />} />
            <Route path="/collections/new/builder" element={<CollectionBuilderPage />} />
            <Route path="/collections/new/signup-builder" element={<SignupSheetBuilderPage />} />
            <Route path="/collections/:id/edit" element={<CollectionBuilderPage />} />
            <Route path="/collections/:id/signup-builder" element={<SignupSheetBuilderPage />} />
            <Route path="/collections/:id/branching" element={<CollectionBranchingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="ticket-designer" element={<TicketDesignerPage />} />
          </Route>

          <Route element={<RequireRole allowed={['super_admin', 'administrator']} fallback="/dashboard" />}>
            <Route path="/ai-summary" element={<AISummaryPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to={user ? defaultAuthenticatedRoute : '/login'} replace />} />
    </Routes>
    </>
  )
}
