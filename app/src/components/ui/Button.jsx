export function Button({ children, variant = 'primary', onClick, block = false, className = '', ...rest }) {
  return (
    <button
      className={`btn btn-${variant} ${block ? 'btn-block' : ''} ${className}`.trim()}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  )
}
