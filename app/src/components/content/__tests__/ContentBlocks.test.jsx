import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PageIdentity, ContentSection, FactGrid, ContentState, TechnicalDetail } from '../ContentBlocks'

describe('canonical information composition', () => {
  it('separates the page title from supporting attributes', () => {
    render(<PageIdentity title="Momentum strategy" description="Reviews market data after close." tags={<span>Simulated</span>} />)
    expect(screen.getByRole('heading', { name: 'Momentum strategy', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Simulated')).toBeInTheDocument()
    expect(screen.getByText('Reviews market data after close.')).toBeInTheDocument()
  })
  it('exposes a named section and deduplicated fact cells', () => {
    render(<ContentSection title="Trading limits"><FactGrid items={[{ label: 'Capital', value: '$10,000' }, { label: 'Capital', value: null, key: 'unset' }]} /></ContentSection>)
    expect(screen.getByRole('region', { name: 'Trading limits' })).toBeInTheDocument()
    expect(screen.getAllByText('$10,000')).toHaveLength(1)
  })
  it('explains unavailable content and reveals technical evidence on demand', () => {
    render(<><ContentState title="Results not available yet" description="No completed sessions." /><TechnicalDetail><p>Version SHA: abc</p></TechnicalDetail></>)
    expect(screen.getByRole('status')).toHaveTextContent('No completed sessions.')
    expect(screen.queryByText('Version SHA: abc')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Technical details/ }))
    expect(screen.getByText('Version SHA: abc')).toBeInTheDocument()
  })
})
