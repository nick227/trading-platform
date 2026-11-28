import { Button, Field, Sheet } from '../../components/ui'

export const SCOPE_META = {
  customer: {
    label: 'Customer Activity',
    className: 'tl-scope-badge tl-scope-badge--customer',
  },
  internal: {
    label: 'Internal Trading',
    className: 'tl-scope-badge tl-scope-badge--internal',
  },
  infra: {
    label: 'System Infrastructure',
    className: 'tl-scope-badge tl-scope-badge--infra',
  },
}

/** Explicit operational scope badge required on every Admin section & action dialog. */
export function ScopeBadge({ scope = 'infra', label }) {
  const meta = SCOPE_META[scope] || SCOPE_META.infra
  return <span className={meta.className}>{label || meta.label}</span>
}

/** Semantic status pill aligned with product.css sentiment palette. */
export function AdminPill({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`tl-pill tl-pill--${tone} ${className}`.trim()}>
      {children}
    </span>
  )
}

/** Consistent light-theme pagination footer for Admin data tables. */
export function AdminPagination({ page = 0, pageSize = 20, total = 0, itemLabel = 'records', onPageChange }) {
  const start = total > 0 ? page * pageSize + 1 : 0
  const end = Math.min((page + 1) * pageSize, total)
  return (
    <div className="tl-admin-pagination">
      <span className="tl-num">
        Showing {start}–{end} of {total} {itemLabel}
      </span>
      <div className="tl-admin-pagination-actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={(page + 1) * pageSize >= total}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

/**
 * Pattern 4: Standardized Administrative Action Confirmation Dialog
 * Communicates purpose, affected scope, consequences, required role, and explicit confirmation.
 */
export function AdminConfirmDialog({
  dialog,
  inputValue,
  onInputChange,
  onCancel,
  busy = false,
}) {
  if (!dialog) return null

  const isDanger = dialog.confirmVariant === 'danger'
  const scopeMeta = SCOPE_META[dialog.scope] || SCOPE_META.infra

  return (
    <Sheet
      title={dialog.title}
      onClose={() => {
        if (!busy) onCancel()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={isDanger ? 'danger-solid' : 'primary'}
            onClick={() => dialog.onConfirm(inputValue)}
            disabled={busy}
          >
            {busy ? 'Processing…' : dialog.confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
        {dialog.message || dialog.description}
      </p>

      <div className="tl-admin-dialog-facts">
        <div>
          <span>Affected scope</span>
          <strong>{dialog.scopeLabel || scopeMeta.label}</strong>
        </div>
        <div>
          <span>Required permission</span>
          <strong>{dialog.permissionLabel || 'Administrator (recorded in Audit History)'}</strong>
        </div>
        {dialog.consequence && (
          <div>
            <span>Operational impact</span>
            <strong>{dialog.consequence}</strong>
          </div>
        )}
      </div>

      {dialog.showInput && (
        <Field label={dialog.inputLabel || 'Reason (recorded in audit log)'}>
          {({ id }) => (
            <textarea
              id={id}
              className="tl-input"
              style={{ minHeight: '84px', padding: '10px 12px', height: 'auto' }}
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={dialog.inputPlaceholder || 'Enter reason…'}
            />
          )}
        </Field>
      )}
    </Sheet>
  )
}

export function formatMoney(value) {
  const num = Number(value ?? 0)
  if (!Number.isFinite(num)) return '—'
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

export function isPlatformAccount(userId, email) {
  return userId === 'usr_platform_canonical' || email === 'tradeloom-ai@tradeloom.internal'
}
