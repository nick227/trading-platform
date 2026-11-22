import { forwardRef, useId } from 'react'

/**
 * Canonical Form primitives for TradeLoom:
 * Field wrapper, Input, and Select with accessible labels, errors, and help text.
 */

export function Field({
  label,
  help,
  error,
  id: explicitId,
  children,
  className = '',
  required = false,
}) {
  const generatedId = useId()
  const fieldId = explicitId || generatedId
  const helpId = help ? `${fieldId}-help` : undefined
  const errorId = error ? `${fieldId}-error` : undefined

  return (
    <div className={`tl-field ${className}`.trim()}>
      {label && (
        <label className="tl-label" htmlFor={fieldId}>
          {label}
          {required && <span className="tl-neg" aria-hidden="true"> *</span>}
        </label>
      )}
      {typeof children === 'function'
        ? children({ id: fieldId, 'aria-describedby': [helpId, errorId].filter(Boolean).join(' ') || undefined, 'aria-invalid': Boolean(error) })
        : children}
      {help && (
        <p className="tl-help" id={helpId}>
          {help}
        </p>
      )}
      {error && (
        <p className="tl-field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export const Input = forwardRef(function Input(
  { error, prefix, className = '', type = 'text', ...rest },
  ref
) {
  const inputEl = (
    <input
      ref={ref}
      type={type}
      aria-invalid={Boolean(error)}
      className={`tl-input ${className}`.trim()}
      {...rest}
    />
  )

  if (prefix) {
    return (
      <div className="tl-input-prefix">
        <span>{prefix}</span>
        {inputEl}
      </div>
    )
  }

  return inputEl
})

export const Select = forwardRef(function Select(
  { error, className = '', children, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      aria-invalid={Boolean(error)}
      className={`tl-input ${className}`.trim()}
      {...rest}
    >
      {children}
    </select>
  )
})
