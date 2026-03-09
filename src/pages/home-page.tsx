import { useState, useRef, useEffect, useMemo, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { Send, MessageSquare } from 'lucide-react'
import useSWR from 'swr'
import { useChat } from '../hooks/use-chat'
import { ChatPanel } from '../components/chat/chat-panel'
import { useI18n } from '../lib/i18n'
import { fetcher } from '../lib/fetcher'

const RANDOM_GREETING_COUNT = 5

function getGreeting(t: (key: any) => string, name: string): string {
  const hour = new Date().getHours()

  // Narrow greeting windows with name
  if (hour >= 5 && hour < 10) return t('home.greeting.morning').replace('{name}', name)
  if (hour >= 12 && hour < 14) return t('home.greeting.afternoon').replace('{name}', name)
  if (hour >= 17 && hour < 21) return t('home.greeting.evening').replace('{name}', name)

  // Outside greeting windows — rotate hourly (deterministic, no storage needed)
  const epochHour = Math.floor(Date.now() / (1000 * 60 * 60))
  const idx = epochHour % RANDOM_GREETING_COUNT
  return t(`home.greeting.random.${idx}`)
}

export function HomePage() {
  const { t } = useI18n()
  const chatState = useChat()
  const { messages, streaming, sendMessage } = chatState
  const { data: profile } = useSWR<{ account_name: string }>('/api/settings/profile', fetcher)

  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const hasMessages = messages.length > 0

  // Stable greeting per mount (no re-roll on re-render)
  const greeting = useMemo(
    () => getGreeting(t, profile?.account_name ?? ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, profile?.account_name],
  )

  // Suggestion chips — dynamic from API, fallback to static
  const { data: suggestionsData } = useSWR<{ suggestions: Array<{ key: string; params?: Record<string, string | number> }> }>(
    '/api/chat/suggestions',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  )
  const suggestions = useMemo(() =>
    suggestionsData?.suggestions?.map(s => {
      const params = s.params ? Object.fromEntries(Object.entries(s.params).map(([k, v]) => [k, String(v)])) : undefined
      return { text: t(s.key as any, params), key: s.key }
    }) ?? [
      { text: t('chat.suggestion.home.recommend'), key: 'recommend' },
      { text: t('chat.suggestion.home.unread'), key: 'unread' },
      { text: t('chat.suggestion.home.trending'), key: 'trending' },
      { text: t('chat.suggestion.home.surprise'), key: 'surprise' },
      { text: t('chat.suggestion.home.digest'), key: 'digest' },
    ],
  [suggestionsData, t])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSend = () => {
    if (!input.trim() || streaming) return
    void sendMessage(input.trim())
    setInput('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }

  const handleSuggestionClick = (text: string, suggestionKey: string) => {
    void sendMessage(text, { suggestionKey })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 150) + 'px'
  }

  // Empty state: centered greeting + input + chips
  if (!hasMessages && !streaming) {
    return (
      <div className="relative min-h-[calc(100dvh-var(--header-height))]">
      <div className="flex flex-col items-center justify-center min-h-[calc(100dvh-var(--header-height))] px-4 -mt-36">
          {/* Greeting */}
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 mb-4">
            <img src="/icons/favicon-black.png" alt="" className="h-10 w-10 sm:h-14 sm:w-14 dark:hidden" />
            <img src="/icons/favicon-white.png" alt="" className="h-10 w-10 sm:h-14 sm:w-14 hidden dark:block" />
            <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold text-text select-none text-center sm:text-left">
              {greeting}
            </h1>
          </div>

          {/* Input box */}
          <div className="w-full max-w-2xl mb-4">
            <div className="border border-border rounded-xl bg-bg-card overflow-hidden">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={t('home.placeholder')}
                rows={2}
                className="w-full resize-none bg-transparent text-text text-[15px] px-4 pt-4 pb-2 outline-none min-h-[60px] max-h-[150px] placeholder:text-muted"
              />
              <div className="flex items-center justify-end px-3 pb-3">
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent text-accent-text disabled:opacity-30 transition-opacity"
                  aria-label={t('chat.send')}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Suggestion chips */}
          <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
            {suggestions.map((s) => (
              <button
                key={s.key}
                onClick={() => handleSuggestionClick(s.text, s.key)}
                className="px-3 py-1.5 rounded-full border border-border text-sm text-muted hover:text-text hover:border-text transition-colors select-none"
              >
                {s.text}
              </button>
            ))}
          </div>

      </div>

      {/* Chat history link — bottom of viewport */}
      <div className="absolute bottom-6 left-0 right-0 flex justify-center">
        <Link to="/chat" className="inline-flex items-center gap-1.5 text-sm text-muted underline hover:text-text transition-colors select-none">
          <MessageSquare size={14} strokeWidth={1.5} />
          {t('home.chatHistory')}
        </Link>
      </div>
      </div>
    )
  }

  // Conversation view — delegate to ChatPanel
  return (
    <div className="h-[calc(100dvh-var(--header-height))]">
      <ChatPanel variant="full" chatState={chatState} />
    </div>
  )
}
