import type { FastifyInstance } from 'fastify'
import { fetchAllFeeds, fetchProgress, getFeedState, type FetchProgressEvent } from '../fetcher.js'
import { NumericIdParams } from '../lib/validation.js'

export async function adminRoutes(api: FastifyInstance): Promise<void> {
  api.post(
    '/api/admin/fetch-all',
    async (_request, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })

      await fetchAllFeeds((event) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      })

      reply.raw.end()
    },
  )

  // --- Single feed fetch progress (EventEmitter subscribe) ---

  api.get('/api/feeds/:id/fetch-progress', async (request, reply) => {
    const feedId = NumericIdParams.parse(request.params).id

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    // Late subscriber: replay current state
    const currentState = getFeedState(feedId)
    if (currentState) {
      reply.raw.write(`data: ${JSON.stringify({
        type: 'feed-articles-found', feed_id: feedId, total: currentState.total
      })}\n\n`)
      if (currentState.fetched > 0) {
        reply.raw.write(`data: ${JSON.stringify({
          type: 'article-done', feed_id: feedId,
          fetched: currentState.fetched, total: currentState.total
        })}\n\n`)
      }
      if (currentState.done) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'feed-complete', feed_id: feedId })}\n\n`)
        reply.raw.end()
        return
      }
    }

    const handler = (event: FetchProgressEvent) => {
      if ('feed_id' in event && event.feed_id !== feedId) return
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      if (event.type === 'feed-complete' && event.feed_id === feedId) {
        cleanup()
      }
    }

    function cleanup() {
      fetchProgress.off('event', handler)
      reply.raw.end()
    }

    fetchProgress.on('event', handler)
    request.raw.on('close', cleanup)
  })

}
