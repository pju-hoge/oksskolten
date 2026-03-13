import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ErrorBoundary } from './error-boundary'

// Suppress React error boundary console.error noise
const originalError = console.error
beforeAll(() => { console.error = vi.fn() })
afterAll(() => { console.error = originalError })

function ThrowingChild({ error }: { error: Error }): React.ReactNode {
  throw error
}

describe('ErrorBoundary', () => {
  afterEach(cleanup)

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('Hello')).toBeTruthy()
  })

  it('renders error message when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild error={new Error('Something broke')} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByText('Something broke')).toBeTruthy()
  })

  it('renders error stack', () => {
    const err = new Error('Test error')
    err.stack = 'Error: Test error\n    at TestComponent'
    render(
      <ErrorBoundary>
        <ThrowingChild error={err} />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/at TestComponent/)).toBeTruthy()
  })
})
