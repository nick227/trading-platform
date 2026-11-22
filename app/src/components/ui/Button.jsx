import { forwardRef } from 'react'

/**
 * Canonical Button primitive for TradeLoom:
 * Maps clean semantic variants to the product design language:
 *   variant: 'primary' | 'secondary' | 'quiet' | 'danger' | 'danger-solid' | 'link'
 *   size: 'sm' | 'md'
 *   block: full-width
 */
export const Button = forwardRef(function Button(
  {
    children,
    variant = 'secondary',
    size = 'md',
    block = false,
    className = '',
    type = 'button',
    disabled = false,
    ...rest
  },
  ref
) {
  if (variant === 'link') {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={`tl-link-btn ${className}`.trim()}
        {...rest}
      >
        {children}
      </button>
    )
  }

  const classes = [
    'tl-btn',
    variant === 'primary' && 'tl-btn--primary',
    variant === 'quiet' && 'tl-btn--quiet',
    variant === 'danger' && 'tl-btn--quiet tl-btn--danger',
    variant === 'danger-solid' && 'tl-btn--danger-solid',
    size === 'sm' && 'tl-btn--sm',
    block && 'tl-btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button ref={ref} type={type} disabled={disabled} className={classes} {...rest}>
      {children}
    </button>
  )
})

export default Button
