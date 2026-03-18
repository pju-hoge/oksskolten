import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { Layers } from 'lucide-react'
import { fetcher } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'
import { articleUrlToPath } from '../../lib/url'

interface SimilarArticle {
  id: number
  feed_name: string
  title: string
  url: string
  published_at: string | null
  read_at: string | null
  score: number
}

interface Props {
  articleId: number
  similarCount: number
}

export function ArticleSimilarBanner({ articleId, similarCount }: Props) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { data } = useSWR<{ similar: SimilarArticle[] }>(
    similarCount > 0 ? `/api/articles/${articleId}/similar` : null,
    fetcher,
  )

  if (!data || data.similar.length === 0) return null

  const similar = data.similar
  const feedNames = [...new Set(similar.map(s => s.feed_name))]
  const hasRead = similar.some(s => s.read_at)

  return (
    <div className="bg-bg-subtle border-l-4 border-accent rounded p-4 mb-8">
      <div className="flex items-start gap-2">
        <Layers size={16} className="text-accent mt-0.5 shrink-0" />
        <div className="text-sm text-text">
          {hasRead ? (
            <p>
              {t('article.similarAlreadyRead', { feedNames: feedNames.join(', ') })}
            </p>
          ) : (
            <p>
              {t('article.similarCoveredBy', { feedNames: feedNames.join(', ') })}
            </p>
          )}
          <details className="mt-2">
            <summary className="text-xs text-muted cursor-pointer hover:text-text transition-colors select-none">
              {t('article.similarShowSources', { count: String(similar.length) })}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {similar.map(s => {
                const path = articleUrlToPath(s.url)
                return (
                <li key={s.id} className="text-xs">
                  <a
                    href={path}
                    onClick={(e) => { e.preventDefault(); void navigate(path) }}
                    className="text-accent hover:underline"
                  >
                    {s.title}
                  </a>
                  <span className="text-muted"> — {s.feed_name}</span>
                  {s.read_at && <span className="text-muted"> ✓</span>}
                </li>
                )
              })}
            </ul>
          </details>
        </div>
      </div>
    </div>
  )
}
