import { Navigate } from 'react-router-dom'
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
      <div className="tl-admin-container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <div style={{
          display: 'inline-block',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          padding: '2rem 3rem',
          borderRadius: '12px',
          maxWidth: '500px'
        }}>
          <h2 style={{ color: '#f87171', margin: '0 0 1rem 0', fontSize: '1.5rem' }}>403 — Authorization Required</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: '1.5', margin: '0 0 1.5rem 0' }}>
            The Administration Dashboard is restricted to platform operators and administrators. Your current account role is <strong style={{ color: '#f1f5f9' }}>{role}</strong>.
          </p>
          <a
            href="/"
            className="tl-btn-primary"
            style={{ textDecoration: 'none' }}
          >
            Return to Trading Dashboard
          </a>
        </div>
      </div>
    )
  }

  return children
}
