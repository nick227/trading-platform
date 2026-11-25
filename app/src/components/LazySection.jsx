import { useEffect, useRef, useState } from 'react'

export default function LazySection({ children, rootMargin = '200px', placeholder = null, style, className }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [rootMargin])

  return (
    <div ref={ref} style={style} className={className}>
      {visible ? children : placeholder}
    </div>
  )
}
