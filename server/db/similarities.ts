import { getDb } from './connection.js'

export interface SimilarArticle {
  id: number
  feed_name: string
  title: string
  url: string
  published_at: string | null
  read_at: string | null
  score: number
}

/**
 * Insert a bidirectional similarity relationship.
 * Silently ignores duplicates (ON CONFLICT DO NOTHING).
 */
export function insertSimilarity(articleId: number, similarToId: number, score: number): void {
  const db = getDb()
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO article_similarities (article_id, similar_to_id, score) VALUES (?, ?, ?)',
  )
  db.transaction(() => {
    stmt.run(articleId, similarToId, score)
    stmt.run(similarToId, articleId, score)
  })()
}

/**
 * Get similar articles for a given article ID.
 */
export function getSimilarArticles(articleId: number): SimilarArticle[] {
  return getDb()
    .prepare(
      `SELECT a.id, f.name AS feed_name, a.title, a.url, a.published_at, a.read_at, s.score
       FROM article_similarities s
       JOIN articles a ON a.id = s.similar_to_id
       JOIN feeds f ON f.id = a.feed_id
       WHERE s.article_id = ?
       ORDER BY s.score DESC`,
    )
    .all(articleId) as SimilarArticle[]
}

/**
 * Check if any similar article to the given one has been read.
 * Returns the first read similar article ID, or null.
 */
export function findReadSimilarArticle(articleId: number): number | null {
  const row = getDb()
    .prepare(
      `SELECT a.id
       FROM article_similarities s
       JOIN articles a ON a.id = s.similar_to_id
       WHERE s.article_id = ? AND a.read_at IS NOT NULL
       LIMIT 1`,
    )
    .get(articleId) as { id: number } | undefined
  return row?.id ?? null
}
