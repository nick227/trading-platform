import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  fetchAdminUserDrilldown,
  fetchAdminUsers,
  updateAdminUserRole,
  updateAdminUserStatus,
} from '../../../api/adminClient'
import { Button, Input, Select, Sheet } from '../../../components/ui'
import { useAdminShell } from '../AdminLayout'
import {
  AdminPagination,
  AdminPill,
  formatDateTime,
  formatMoney,
  isPlatformAccount,
  ScopeBadge,
} from '../adminShared'

export default function AdminUsersPage() {
  const { user: currentUser, isAdmin, actionLoading, setActionLoading, showFeedback, openConfirmDialog, closeConfirmDialog, refreshShell } = useAdminShell()
  const { userId: routeUserId } = useParams()
  const navigate = useNavigate()

  const [users, setUsers] = useState([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)

  const [selectedUser, setSelectedUser] = useState(null)
  const [drilldownLoading, setDrilldownLoading] = useState(false)

  const loadUsers = useCallback(
    async (query = '', targetPage = 0) => {
      setLoading(true)
      try {
        const data = await fetchAdminUsers({ limit: 20, offset: targetPage * 20, search: query })
        setUsers(data?.users || [])
        setUsersTotal(data?.total || 0)
        setPage(targetPage)
      } catch (err) {
        showFeedback('error', `Failed to load users: ${err.serverMessage || err.message}`)
      } finally {
        setLoading(false)
      }
    },
    [showFeedback]
  )

  const inspectUser = useCallback(
    async (targetId) => {
      setDrilldownLoading(true)
      try {
        const res = await fetchAdminUserDrilldown(targetId)
        setSelectedUser(res?.data || res)
      } catch (err) {
        showFeedback('error', `Failed to load account details: ${err.serverMessage || err.message}`)
      } finally {
        setDrilldownLoading(false)
      }
    },
    [showFeedback]
  )

  useEffect(() => {
    loadUsers('', 0)
  }, [loadUsers])

  useEffect(() => {
    if (routeUserId) {
      inspectUser(routeUserId)
    }
  }, [routeUserId, inspectUser])

  const closeDrawer = () => {
    setSelectedUser(null)
    if (routeUserId) {
      navigate('/admin/users', { replace: true })
    }
  }

  const handleRoleChange = (targetUser, newRole) => {
    if (newRole === (targetUser.role || 'user')) return
    openConfirmDialog({
      title: `Change Role: ${targetUser.email}`,
      message: `Update administrative access for ${targetUser.email} from '${targetUser.role || 'user'}' to '${newRole}'?`,
      scope: 'customer',
      scopeLabel: `Customer Account (${targetUser.email})`,
      consequence:
        newRole === 'admin'
          ? 'Grants full read and state-changing administrative permissions.'
          : newRole === 'operator'
          ? 'Grants read-only access to Admin telemetry and support views.'
          : 'Removes all Admin workspace access.',
      confirmLabel: `Set Role to ${newRole}`,
      confirmVariant: 'primary',
      onConfirm: async () => {
        setActionLoading(true)
        try {
          await updateAdminUserRole(targetUser.id, newRole)
          showFeedback('success', `Updated role for ${targetUser.email} to '${newRole}'.`)
          await Promise.all([loadUsers(search, page), refreshShell()])
          closeConfirmDialog()
        } catch (err) {
          showFeedback('error', `Failed to update role: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const handleToggleStatus = (targetUser) => {
    const currentStatus = targetUser.status || 'active'
    const newStatus = currentStatus === 'suspended' ? 'active' : 'suspended'
    openConfirmDialog({
      title: newStatus === 'suspended' ? `Suspend Account: ${targetUser.email}` : `Reactivate Account: ${targetUser.email}`,
      message:
        newStatus === 'suspended'
          ? `Suspend ${targetUser.email}? Authenticated API sessions will be rejected immediately with 403 Forbidden. Note: pause any active bots owned by this customer separately under Trading if you also want to halt background bot evaluations.`
          : `Restore normal sign-in and trading API access for ${targetUser.email}?`,
      scope: 'customer',
      scopeLabel: `Customer Account (${targetUser.email})`,
      consequence:
        newStatus === 'suspended'
          ? 'Blocks customer API requests immediately; existing bots remain in their current state unless paused.'
          : 'Restores authenticated platform access.',
      confirmLabel: newStatus === 'suspended' ? 'Suspend Account' : 'Reactivate Account',
      confirmVariant: newStatus === 'suspended' ? 'danger' : 'primary',
      onConfirm: async () => {
        setActionLoading(true)
        try {
          await updateAdminUserStatus(targetUser.id, newStatus)
          showFeedback('success', `Account status for ${targetUser.email} updated to '${newStatus}'.`)
          await Promise.all([loadUsers(search, page), refreshShell()])
          if (selectedUser?.user?.id === targetUser.id) {
            await inspectUser(targetUser.id)
          }
          closeConfirmDialog()
        } catch (err) {
          showFeedback('error', `Failed to update account status: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  return (
    <>
      <header className="tl-admin-page-head">
        <div>
          <h1>Users</h1>
          <p className="tl-admin-page-sub">
            Customer accounts, support inspection, and role permissions
          </p>
        </div>
        <div className="tl-admin-head-actions">
          <Button variant="secondary" onClick={() => loadUsers(search, page)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      <section className="tl-admin-section" aria-labelledby="users-directory-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="users-directory-heading">
                Account directory
              </h2>
              <ScopeBadge scope="customer" />
            </div>
            <p className="tl-admin-section-desc">
              Inspect customer portfolios, bots, and recent orders, or manage administrative roles. TradeLoom&apos;s internal system account is explicitly badged and protected.
            </p>
          </div>
        </div>

        <div className="tl-admin-table-card">
          <div className="tl-admin-toolbar">
            <div className="tl-admin-toolbar-filters">
              <Input
                placeholder="Search by email or name…"
                aria-label="Search users by email or name"
                value={search}
                onChange={(e) => {
                  const next = e.target.value
                  setSearch(next)
                  loadUsers(next, 0)
                }}
              />
            </div>
            <span className="tl-small tl-muted tl-num">
              Total accounts: <strong>{usersTotal}</strong>
            </span>
          </div>

          <div className="tl-admin-table-scroll">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Scope</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length > 0 ? (
                  users.map((u) => {
                    const isSuspended = u.status === 'suspended'
                    const isSystem = isPlatformAccount(u.id, u.email)
                    const isSelf = u.id === currentUser?.id
                    const roleTone =
                      u.role === 'admin' ? 'accent' : u.role === 'operator' ? 'warn' : 'neutral'

                    return (
                      <tr key={u.id}>
                        <td>
                          <span className="tl-admin-cell-primary">{u.fullName || '—'}</span>
                          <span className="tl-admin-cell-sub">{u.email}</span>
                        </td>
                        <td>
                          {isSystem ? (
                            <ScopeBadge scope="internal" label="Internal System" />
                          ) : (
                            <ScopeBadge scope="customer" label="Customer" />
                          )}
                        </td>
                        <td>
                          <AdminPill tone={roleTone}>{u.role || 'user'}</AdminPill>
                        </td>
                        <td>
                          <AdminPill tone={isSuspended ? 'neg' : 'pos'}>
                            {isSuspended ? 'Suspended' : 'Active'}
                          </AdminPill>
                        </td>
                        <td>
                          <span>{u.subscription?.plan || 'BASIC'}</span>
                          <span className="tl-admin-cell-sub">
                            {u.subscription?.status || 'INACTIVE'}
                          </span>
                        </td>
                        <td className="tl-num tl-nowrap">
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                        </td>
                        <td>
                          <div className="tl-admin-row-actions">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => inspectUser(u.id)}
                              disabled={drilldownLoading}
                            >
                              Inspect
                            </Button>
                            {isAdmin && !isSystem && !isSelf && (
                              <>
                                <Button
                                  variant={isSuspended ? 'primary' : 'danger'}
                                  size="sm"
                                  onClick={() => handleToggleStatus(u)}
                                  disabled={actionLoading}
                                >
                                  {isSuspended ? 'Reactivate' : 'Suspend'}
                                </Button>
                                <Select
                                  aria-label={`Change role for ${u.email}`}
                                  className="tl-input--inline"
                                  value={u.role || 'user'}
                                  onChange={(e) => handleRoleChange(u, e.target.value)}
                                >
                                  <option value="user">User</option>
                                  <option value="operator">Operator</option>
                                  <option value="admin">Admin</option>
                                </Select>
                              </>
                            )}
                            {isSystem && <span className="tl-small tl-muted">Protected</span>}
                            {isSelf && <span className="tl-small tl-muted">You</span>}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="tl-admin-empty">
                      {loading ? 'Loading accounts…' : 'No accounts match your search.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <AdminPagination
            page={page}
            pageSize={20}
            total={usersTotal}
            itemLabel="users"
            onPageChange={(nextPage) => loadUsers(search, nextPage)}
          />
        </div>
      </section>

      {/* Pattern 3: Customer Support Detail Drawer */}
      {selectedUser && (
        <Sheet
          title={`Account Support: ${selectedUser.user?.fullName || selectedUser.user?.email || 'User'}`}
          className="sheet--admin-drawer"
          onClose={closeDrawer}
        >
          <div className="tl-admin-drawer-meta">
            <ScopeBadge
              scope={isPlatformAccount(selectedUser.user?.id, selectedUser.user?.email) ? 'internal' : 'customer'}
            />
            <span>Email: <strong>{selectedUser.user?.email}</strong></span>
            <span>ID: <code className="tl-admin-code">{selectedUser.user?.id}</code></span>
            <span>Role: <strong>{selectedUser.user?.role || 'user'}</strong></span>
          </div>

          <div className="tl-admin-kpi-grid">
            <div className="tl-admin-kpi">
              <span className="tl-admin-kpi-label">Status</span>
              <div className="tl-admin-kpi-value" style={{ fontSize: '20px' }}>
                {selectedUser.user?.status === 'suspended' ? 'Suspended' : 'Active'}
              </div>
            </div>
            <div className="tl-admin-kpi">
              <span className="tl-admin-kpi-label">Subscription</span>
              <div className="tl-admin-kpi-value" style={{ fontSize: '20px' }}>
                {selectedUser.user?.subscription?.plan || 'Free'}
              </div>
              <div className="tl-admin-kpi-meta">
                <span>{selectedUser.user?.subscription?.status || 'Active'}</span>
              </div>
            </div>
            <div className="tl-admin-kpi">
              <span className="tl-admin-kpi-label">Portfolios</span>
              <div className="tl-admin-kpi-value" style={{ fontSize: '20px' }}>
                {selectedUser.portfolios?.length || 0}
              </div>
            </div>
            <div className="tl-admin-kpi">
              <span className="tl-admin-kpi-label">Bots</span>
              <div className="tl-admin-kpi-value" style={{ fontSize: '20px' }}>
                {selectedUser.bots?.length || 0}
              </div>
            </div>
          </div>

          <div className="tl-admin-drawer-section">
            <h3>Portfolios</h3>
            {selectedUser.portfolios?.length > 0 ? (
              <div className="tl-admin-table-card">
                <div className="tl-admin-table-scroll">
                  <table className="tl-admin-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Cash Balance</th>
                        <th>Total Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedUser.portfolios.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <span className="tl-admin-cell-primary">{p.name}</span>
                            <span className="tl-admin-cell-sub">{p.id}</span>
                          </td>
                          <td className="tl-num">{formatMoney(p.cashBalance)}</td>
                          <td className="tl-num">{formatMoney(p.totalValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="tl-small tl-muted m0">No portfolios recorded for this account.</p>
            )}
          </div>

          <div className="tl-admin-drawer-section">
            <h3>Trading bots</h3>
            {selectedUser.bots?.length > 0 ? (
              <div className="tl-admin-table-card">
                <div className="tl-admin-table-scroll">
                  <table className="tl-admin-table">
                    <thead>
                      <tr>
                        <th>Bot</th>
                        <th>Type</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedUser.bots.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <span className="tl-admin-cell-primary">{b.name}</span>
                            <span className="tl-admin-cell-sub">{b.templateId || 'Custom'}</span>
                          </td>
                          <td>{b.botType}</td>
                          <td>
                            <AdminPill tone={b.enabled ? 'pos' : 'warn'}>
                              {b.enabled ? 'Running' : 'Paused'}
                            </AdminPill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="tl-small tl-muted m0">No bots configured.</p>
            )}
          </div>

          <div className="tl-admin-drawer-section">
            <h3>Recent orders</h3>
            {selectedUser.recentExecutions?.length > 0 ? (
              <div className="tl-admin-table-card">
                <div className="tl-admin-table-scroll">
                  <table className="tl-admin-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Symbol</th>
                        <th>Side / Qty</th>
                        <th>Status</th>
                        <th>Executed Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedUser.recentExecutions.map((ex) => (
                        <tr key={ex.id}>
                          <td className="tl-num tl-nowrap">{formatDateTime(ex.createdAt)}</td>
                          <td className="tl-admin-cell-primary">{ex.ticker}</td>
                          <td className="tl-num">
                            {ex.direction?.toUpperCase()} {ex.quantity}
                          </td>
                          <td>
                            <AdminPill tone={ex.status === 'filled' ? 'pos' : ex.status === 'cancelled' || ex.status === 'failed' ? 'neg' : 'warn'}>
                              {ex.status}
                            </AdminPill>
                          </td>
                          <td className="tl-num">
                            {ex.filledPrice != null ? formatMoney(ex.filledPrice) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="tl-small tl-muted m0">No recent orders recorded.</p>
            )}
          </div>
        </Sheet>
      )}
    </>
  )
}
