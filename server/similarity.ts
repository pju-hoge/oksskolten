import { meiliSearch, buildMeiliFilter } from './search/client.js'
import { isSearchReady } from './search/sync.js'
import { getArticlesByIds, markArticleSeen } from './db.js'
import { insertSimilarity } from './db/similarities.js'
import { logger } from './logger.js'

const log = logger.child('similarity')

const SIMILARITY_THRESHOLD = 0.4
const TIME_WINDOW_DAYS = 3
const MAX_CANDIDATES = 10

/**
 * Compute bigram Dice coefficient between two strings.
 * Returns a value between 0 (no overlap) and 1 (identical bigrams).
 */
export function computeTitleSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim()

  const bigrams = (s: string): Set<string> => {
    const words = normalize(s).split(/\s+/)
    const set = new Set<string>()
    for (const w of words) {
      for (let i = 0; i < w.length - 1; i++) set.add(w.slice(i, i + 2))
    }
    return set
  }

  const setA = bigrams(a)
  const setB = bigrams(b)
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const bg of setA) if (setB.has(bg)) intersection++

  return (2 * intersection) / (setA.size + setB.size)
}

/**
 * Detect and store similar articles for a newly inserted article.
 * Runs asynchronously (fire-and-forget) after article insertion.
 */
export async function detectAndStoreSimilarArticles(
  articleId: number,
  title: string,
  feedId: number,
  publishedAt: string | null,
): Promise<void> {
  try {
    if (!isSearchReady()) return

    // Build time window filter: ±3 days around published_at
    const refDate = publishedAt ? new Date(publishedAt) : new Date()
    const since = new Date(refDate.getTime() - TIME_WINDOW_DAYS * 86_400_000).toISOString()
    const until = new Date(refDate.getTime() + TIME_WINDOW_DAYS * 86_400_000).toISOString()

    const filter = buildMeiliFilter({ since, until })
    const { hits } = await meiliSearch(title, {
      limit: MAX_CANDIDATES + 1,
      filter,
    })

    // Exclude self and same-feed articles
    const candidateIds = hits
      .map((h) => h.id)
      .filter((id) => id !== articleId)

    if (candidateIds.length === 0) return

    // Fetch candidate details to check feed_id and compute title similarity
    const candidates = getArticlesByIds(candidateIds)

    let markedSeen = false

    for (const candidate of candidates) {
      // Skip same-feed articles
      if (candidate.feed_id === feedId) continue

      const score = computeTitleSimilarity(title, candidate.title)
      if (score < SIMILARITY_THRESHOLD) continue

      insertSimilarity(articleId, candidate.id, score)

      // Auto-mark-read: if similar article was read, mark new article as seen
      if (!markedSeen && candidate.read_at) {
        markArticleSeen(articleId, true)
        markedSeen = true
        log.info(`Auto-marked article ${articleId} as seen (similar to read article ${candidate.id})`)
      }
    }
  } catch (err) {
    // Non-critical: log and move on
    log.warn(`Similarity detection failed for article ${articleId}: ${err instanceof Error ? err.message : err}`)
  }
}
