import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../app/AuthProvider'
import PageSkeleton from '../../components/PageSkeleton'

export default function AdminRoute({ children }) {
  const { user, sessionLoading } = useAuth()

  if (sessionLoading) {
    return <PageSkeleton />
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  const role = user.role || 'user'
  if (role !== 'admin' && role !== 'operator') {
    return (
      <main className="tl-page">
        <div className="tl-card-shell" style={{ maxWidth: '520px', margin: '48px auto' }}>
          <h1 className="tl-section-title" style={{ marginBottom: '8px' }}>
            403 — Authorization Required
          </h1>
          <p className="tl-muted" style={{ margin: '0 0 20px' }}>
            The Administration Dashboard is restricted to platform operators and administrators. Your current account role is <strong className="tl-ink">{role}</strong>.
          </p>
          <Link to="/" className="tl-btn tl-btn--primary">
            Return to Trading Dashboard
          </Link>
        </div>
      </main>
    )
  }

  return children
}
