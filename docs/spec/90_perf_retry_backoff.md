# Exponential Backoff for Article Retry

## Background

The cron job running every 5 minutes retries all articles with `last_error IS NOT NULL` and missing body text, without any limit. This causes CPU usage to spike to 99% even when there are zero new articles.

## Current Problem

`getRetryArticles()` in `server/db/articles.ts` uses the following query to select retry candidates:

```sql
SELECT * FROM articles
WHERE last_error IS NOT NULL
  AND (full_text IS NULL OR summary IS NULL
       OR full_text_translated IS NULL)
```

This query lacks the following controls:

- No upper limit on retry attempts (articles are retried indefinitely)
- No consideration of time elapsed since the last retry (all candidates are selected every time)
- No cap on the number of retry articles processed per cron run

Additionally, the `summary IS NULL OR full_text_translated IS NULL` conditions are inappropriate. Translation (`translateArticle`) and summarization (`summarizeArticle`) are not part of the cron pipeline — they are executed on-demand via API routes (`server/routes/articles.ts`) when a user opens an article in the frontend. Translation/summarization failures are not recorded in `last_error` (only HTTP error responses are returned). Since `processArticle()`'s sole responsibility is fetching `full_text`, the retry condition should be limited to `full_text IS NULL`.

Articles with partially fetched content (`full_text` is non-NULL but `last_error` is also non-NULL) are excluded from retry. Users can read articles with partial body text.

## Design

### Schema Changes

Add the following columns to the `articles` table:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `retry_count` | INTEGER | 0 | Counter for retry attempts |
| `last_retry_at` | TEXT | NULL | Timestamp of the last retry attempt (ISO 8601) |

Migration file: `migrations/0005_retry_backoff.sql`

```sql
ALTER TABLE articles ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN last_retry_at TEXT;
```

The existing `idx_articles_last_error` partial index is reused as-is. No additional indexes are needed for `retry_count` or `last_retry_at` (the number of retry-eligible articles is small after filtering by the `last_error IS NOT NULL` partial index).

Impact on existing data: After migration, existing articles with `last_error IS NOT NULL AND full_text IS NULL` will start with `retry_count = 0`. These will immediately become retry candidates, but `RETRY_BATCH_LIMIT` restricts the number processed per cron run.

### Configuration

Settings are exposed as environment variables, following the same pattern as `CONCURRENCY` in `server/fetcher/util.ts`.

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RETRY_MAX_ATTEMPTS` | 5 | Maximum retry count. Articles reaching this limit are excluded from retry |
| `RETRY_BATCH_LIMIT` | 3 | Maximum number of retry articles processed per cron run |

Backoff interval: `30 * 2^retry_count` minutes (30m, 1h, 2h, 4h, 8h). Clamped to a maximum of 32 hours when `retry_count >= 6` (via `MIN(retry_count, 6)`).

No manual reset mechanism is provided. If needed, reset directly via SQL: `UPDATE articles SET retry_count = 0, last_retry_at = NULL WHERE ...`

### Retry Selection Query

Backoff calculation is performed entirely in SQL.

```sql
SELECT * FROM articles
WHERE last_error IS NOT NULL
  AND full_text IS NULL
  AND retry_count < :max_attempts
  AND (
    last_retry_at IS NULL
    OR datetime(last_retry_at, '+' || (30 * (1 << MIN(retry_count, 6))) || ' minutes') <= datetime('now')
  )
ORDER BY retry_count ASC, last_retry_at ASC
LIMIT :batch_limit
```

- `retry_count ASC` prioritizes articles with fewer retries (higher chance of success)
- `last_retry_at ASC` prioritizes articles with longer wait times within the same retry count
- Uses SQLite's native bitwise shift operator `<<`

### Log Aggregation Query

A separate aggregation query provides visibility into retry status. Uses the `SUM(CASE WHEN)` pattern for libsql compatibility:

```sql
SELECT
  SUM(CASE WHEN retry_count < :max_attempts AND (
    last_retry_at IS NULL
    OR datetime(last_retry_at, '+' || (30 * (1 << MIN(retry_count, 6))) || ' minutes') <= datetime('now')
  ) THEN 1 ELSE 0 END) AS eligible,
  SUM(CASE WHEN retry_count < :max_attempts AND
    last_retry_at IS NOT NULL AND
    datetime(last_retry_at, '+' || (30 * (1 << MIN(retry_count, 6))) || ' minutes') > datetime('now')
  THEN 1 ELSE 0 END) AS backoff_waiting,
  SUM(CASE WHEN retry_count >= :max_attempts THEN 1 ELSE 0 END) AS exceeded
FROM articles
WHERE last_error IS NOT NULL AND full_text IS NULL
```

Example output:
```
[fetcher] Retry: 2 eligible, 3 backoff-waiting, 1 exceeded max attempts
```

Log level: `info`. Individual article URLs/IDs are not logged (counts only).

### Processing Flow

Phase B retry article processing is modified as follows:

1. **Log aggregation**: Call `getRetryStats()` to log retry status
2. **Fetch retry candidates**: Call `getRetryArticles()` to get eligible articles
3. **Before each retry**: Update `updateArticleContent(id, { last_retry_at: now })` before calling `processArticle()`
4. **On success**: The existing `updateArticleContent(id, { last_error: null, full_text: ..., ... })` works as-is. `retry_count` is not reset (the article exits the retry pool because `last_error IS NOT NULL` no longer matches)
5. **On failure**: Update `updateArticleContent(id, { last_error: msg, retry_count: article.retry_count + 1 })`

`updateArticleContent()` is a generic function that dynamically updates fields. Adding `retry_count?: number` and `last_retry_at?: string | null` to its data parameter type is sufficient.

## Target Files

- `migrations/0005_retry_backoff.sql` — Schema changes
- `server/fetcher/util.ts` — `RETRY_MAX_ATTEMPTS`, `RETRY_BATCH_LIMIT` constants
- `server/db/articles.ts` — `getRetryArticles()` query update, `getRetryStats()` addition, `updateArticleContent()` type extension
- `server/fetcher.ts` — Phase B retry processing (last_retry_at update, retry_count increment, log output)
- `server/db/articles.test.ts` — getRetryArticles / getRetryStats query tests
- `server/fetcher.test.ts` — Phase B integration tests
- `docs/spec/90_perf_retry_backoff.md` — English spec (this file)
- `docs/spec/10_schema.ja.md` / `docs/spec/10_schema.md` — Add columns to articles table documentation

## Test Plan

### DB Query Tests (`server/db/articles.test.ts`)

- `getRetryArticles()` returns only articles with `retry_count < max_attempts`
- Articles within backoff period are excluded
- `LIMIT` is applied
- Results are sorted by `retry_count ASC, last_retry_at ASC`
- `full_text IS NULL` condition works correctly (`summary IS NULL` alone does not qualify)
- Partially fetched articles (`full_text` non-NULL, `last_error` non-NULL) are excluded from retry
- `getRetryStats()` correctly aggregates eligible / backoff_waiting / exceeded counts

### Fetcher Integration Tests (`server/fetcher.test.ts`)

- `retry_count` is incremented on failure
- `last_error` is set to NULL on success
- `last_retry_at` is updated before `processArticle()` is called

## Out of Scope

- Admin UI for retry reset
- API endpoint for listing retry-eligible articles
- Translation/summarization retry (these are on-demand processes requiring a separate mechanism)
- Reprocessing articles with partially fetched `full_text`

## Expected Impact

- No CPU spikes during cron runs with zero new articles
- Permanently unfetchable articles stop consuming resources
- Graduated backoff intervals still allow recovery from temporary failures

## Current Status

Implementation ready. Implementors MUST keep this section updated as they work.

### Checklist

- [ ] `migrations/0005_retry_backoff.sql` — Add `retry_count`, `last_retry_at` columns
- [ ] `server/fetcher/util.ts` — Define `RETRY_MAX_ATTEMPTS`, `RETRY_BATCH_LIMIT` constants
- [ ] `server/db/articles.ts` — Update `getRetryArticles()` query
- [ ] `server/db/articles.ts` — Add `getRetryStats()` aggregation function
- [ ] `server/db/articles.ts` — Extend `updateArticleContent()` type (`retry_count`, `last_retry_at`)
- [ ] `server/fetcher.ts` — Modify Phase B retry processing (last_retry_at update, retry_count increment, log output)
- [ ] `server/db/articles.test.ts` — getRetryArticles / getRetryStats tests
- [ ] `server/fetcher.test.ts` — Phase B integration tests
- [ ] `docs/spec/10_schema.ja.md` / `10_schema.md` — Add columns to articles table documentation
- [ ] `docs/spec/90_perf_retry_backoff.md` — English spec

### Updates

- 2026-03-19: Spec interview completed. All design decisions finalized.
