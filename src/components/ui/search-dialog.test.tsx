import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchDialog } from './search-dialog'

// --- Mocks ---
const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('../../lib/fetcher', () => ({
  authHeaders: () => ({}),
  fetcher: vi.fn(),
}))

vi.mock('../../lib/url', () => ({
  articleUrlToPath: (url: string) => `/articles/${encodeURIComponent(url)}`,
}))

let swrData: { articles: Array<{ id: number; title: string; url: string; feed_name: string; published_at: string | null }> } | undefined

vi.mock('swr', () => ({
  default: () => ({ data: swrData }),
}))

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

describe('SearchDialog', () => {
  let onClose: () => void

  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    onClose = vi.fn()
    swrData = {
      articles: [
        { id: 1, title: 'Recent Article', url: 'https://example.com/1', feed_name: 'Blog', published_at: '2026-03-01T00:00:00Z' },
        { id: 2, title: 'Old Article', url: 'https://example.com/2', feed_name: 'News', published_at: null },
      ],
    }
  })

  function getInput() {
    return screen.getByRole('combobox')
  }

  it('renders search input', () => {
    render(<SearchDialog onClose={onClose} />)
    expect(getInput()).toBeTruthy()
  })

  it('shows recent articles when query is empty', () => {
    render(<SearchDialog onClose={onClose} />)
    expect(screen.getByText('Recent Article')).toBeTruthy()
    expect(screen.getByText('Old Article')).toBeTruthy()
  })

  it('calls onClose when overlay is clicked', async () => {
    render(<SearchDialog onClose={onClose} />)
    const overlay = document.querySelector('.fixed.inset-0')!
    await userEvent.click(overlay)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('navigates to article on click', async () => {
    render(<SearchDialog onClose={onClose} />)
    await userEvent.click(screen.getByText('Recent Article'))
    expect(onClose).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/articles/https%3A%2F%2Fexample.com%2F1')
  })

  it('clears query when X button is clicked', async () => {
    render(<SearchDialog onClose={onClose} />)
    const input = getInput()

    await userEvent.type(input, 'test')
    expect(input).toHaveProperty('value', 'test')

    // X button appears when query is non-empty
    const clearButton = input.closest('[cmdk-input-wrapper]')!.parentElement!.querySelector('button')!
    await userEvent.click(clearButton)
    expect(input).toHaveProperty('value', '')
  })

  it('performs search on debounced input', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        articles: [{ id: 3, title: 'Search Result', url: 'https://example.com/3', feed_name: 'Tech', published_at: null }],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(<SearchDialog onClose={onClose} />)
    const input = getInput()

    await userEvent.type(input, 'hello')

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/articles/search?q=hello'),
        expect.any(Object),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('Search Result')).toBeTruthy()
    })

    vi.unstubAllGlobals()
  })

  it('shows no results message after empty search', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ articles: [], has_more: false }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(<SearchDialog onClose={onClose} />)
    const input = getInput()

    await userEvent.type(input, 'nonexistent')

    // Wait for the debounced fetch to fire first
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(screen.getByText('No matching articles')).toBeTruthy()
    })

    vi.unstubAllGlobals()
  })

  it('navigates via Enter key on selected item', async () => {
    render(<SearchDialog onClose={onClose} />)

    await userEvent.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/articles/https%3A%2F%2Fexample.com%2F1')
  })

  it('arrow keys change selected index', async () => {
    render(<SearchDialog onClose={onClose} />)

    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    expect(mockNavigate).toHaveBeenCalledWith('/articles/https%3A%2F%2Fexample.com%2F2')
  })
})
