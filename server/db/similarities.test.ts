import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { insertSimilarity, getSimilarArticles, findReadSimilarArticle } from './similarities.js'
import { getDb } from './connection.js'

function seedFeedAndArticles() {
  const db = getDb()
  db.prepare('INSERT INTO categories (id, name) VALUES (1, \'Tech\')').run()
  db.prepare('INSERT INTO feeds (id, name, url, category_id) VALUES (1, \'Feed A\', \'https://a.com\', 1)').run()
  db.prepare('INSERT INTO feeds (id, name, url, category_id) VALUES (2, \'Feed B\', \'https://b.com\', 1)').run()
  db.prepare(
    'INSERT INTO articles (id, feed_id, title, url, category_id) VALUES (1, 1, \'Article A\', \'https://a.com/1\', 1)',
  ).run()
  db.prepare(
    'INSERT INTO articles (id, feed_id, title, url, category_id) VALUES (2, 2, \'Article B\', \'https://b.com/1\', 1)',
  ).run()
  db.prepare(
    'INSERT INTO articles (id, feed_id, title, url, category_id) VALUES (3, 2, \'Article C\', \'https://b.com/2\', 1)',
  ).run()
}

beforeEach(() => {
  setupTestDb()
  seedFeedAndArticles()
})

describe('insertSimilarity', () => {
  it('inserts bidirectional similarity', () => {
    insertSimilarity(1, 2, 0.85)
    const db = getDb()
    const rows = db.prepare('SELECT * FROM article_similarities').all() as any[]
    expect(rows).toHaveLength(2)
    expect(rows.map(r => [r.article_id, r.similar_to_id])).toEqual(
      expect.arrayContaining([[1, 2], [2, 1]]),
    )
  })

  it('ignores duplicate inserts', () => {
    insertSimilarity(1, 2, 0.85)
    insertSimilarity(1, 2, 0.90) // should not fail
    const db = getDb()
    const rows = db.prepare('SELECT * FROM article_similarities').all()
    expect(rows).toHaveLength(2) // still 2 (bidirectional)
  })
})

describe('getSimilarArticles', () => {
  it('returns similar articles with feed info', () => {
    insertSimilarity(1, 2, 0.85)
    const similar = getSimilarArticles(1)
    expect(similar).toHaveLength(1)
    expect(similar[0].id).toBe(2)
    expect(similar[0].feed_name).toBe('Feed B')
    expect(similar[0].score).toBe(0.85)
  })

  it('returns empty array when no similarities', () => {
    expect(getSimilarArticles(1)).toEqual([])
  })

  it('returns multiple similar articles ordered by score', () => {
    insertSimilarity(1, 2, 0.60)
    insertSimilarity(1, 3, 0.90)
    const similar = getSimilarArticles(1)
    expect(similar).toHaveLength(2)
    expect(similar[0].id).toBe(3) // higher score first
    expect(similar[1].id).toBe(2)
  })
})

describe('findReadSimilarArticle', () => {
  it('returns null when no similar articles are read', () => {
    insertSimilarity(1, 2, 0.85)
    expect(findReadSimilarArticle(1)).toBeNull()
  })

  it('returns the read similar article id', () => {
    insertSimilarity(1, 2, 0.85)
    const db = getDb()
    db.prepare("UPDATE articles SET read_at = datetime('now') WHERE id = 2").run()
    expect(findReadSimilarArticle(1)).toBe(2)
  })

  it('returns null when no similarities exist', () => {
    expect(findReadSimilarArticle(1)).toBeNull()
  })
})
