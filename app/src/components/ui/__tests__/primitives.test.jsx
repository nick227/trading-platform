import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sheet, Disclosure, Button, StatusBadge, Notice, Field, Input } from '../index'

describe('Canonical UI Primitives', () => {
  describe('Sheet', () => {
    it('renders with accessibility attributes and handles escape/close', () => {
      const onClose = vi.fn()
      render(
        <Sheet title="Edit Settings" onClose={onClose} footer={<button type="button">Save</button>}>
          <p>Sheet content</p>
        </Sheet>
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
      expect(screen.getByText('Edit Settings')).toBeInTheDocument()
      expect(screen.getByText('Sheet content')).toBeInTheDocument()

      // Close button
      const closeBtn = screen.getByRole('button', { name: 'Close dialog' })
      fireEvent.click(closeBtn)
      expect(onClose).toHaveBeenCalledTimes(1)

      // Escape key
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(2)
    })
  })

  describe('Disclosure', () => {
    it('toggles expansion with keyboard/click accessibility', () => {
      render(
        <Disclosure label="Diagnostic trail" meta="2 steps">
          <p>Payload data</p>
        </Disclosure>
      )

      const toggle = screen.getByRole('button', { name: /Diagnostic trail/ })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('Payload data')).not.toBeInTheDocument()

      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Payload data')).toBeInTheDocument()
    })
  })

  describe('Button', () => {
    it('applies semantic variant and size classes', () => {
      const { rerender } = render(<Button variant="primary" size="sm">Action</Button>)
      const btn = screen.getByRole('button', { name: 'Action' })
      expect(btn).toHaveClass('tl-btn', 'tl-btn--primary', 'tl-btn--sm')

      rerender(<Button variant="quiet">Quiet</Button>)
      expect(screen.getByRole('button', { name: 'Quiet' })).toHaveClass('tl-btn--quiet')

      rerender(<Button variant="link">Link</Button>)
      expect(screen.getByRole('button', { name: 'Link' })).toHaveClass('tl-link-btn')
    })
  })

  describe('Badge & Notice', () => {
    it('renders status indicators and notices', () => {
      render(<StatusBadge status="running" label="Running" />)
      expect(screen.getByTestId('status-badge')).toHaveClass('tl-status', 'tl-status--running')

      render(<Notice tone="error">Something went wrong</Notice>)
      expect(screen.getByRole('alert')).toHaveClass('tl-notice', 'tl-notice--error')
    })
  })

  describe('Field & Input', () => {
    it('connects label, input, and errors', () => {
      render(
        <Field label="Bot Name" error="Name is required">
          {({ id, 'aria-invalid': invalid }) => <Input id={id} error={invalid} defaultValue="Alpha Bot" />}
        </Field>
      )

      expect(screen.getByLabelText(/Bot Name/)).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Name is required')
      expect(screen.getByDisplayValue('Alpha Bot')).toHaveAttribute('aria-invalid', 'true')
    })
  })
})
