import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Disclosure from '../Disclosure'

describe('Disclosure (shared progressive-disclosure pattern)', () => {
  it('is a real button with aria-expanded/controls, loads once on first open, and hides content when closed', () => {
    const onOpen = vi.fn()
    render(<Disclosure label="Details" meta="3 steps" onOpen={onOpen}><p>Trail</p></Disclosure>)
    const btn = screen.getByRole('button', { name: /Details/ })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Trail')).not.toBeInTheDocument()
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(btn.getAttribute('aria-controls'))).toHaveTextContent('Trail')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
