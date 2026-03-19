export const CONCURRENCY = Number(process.env.FETCH_CONCURRENCY) || 5
export const RETRY_MAX_ATTEMPTS = Number(process.env.RETRY_MAX_ATTEMPTS) || 5
export const RETRY_BATCH_LIMIT = Number(process.env.RETRY_BATCH_LIMIT) || 3

export class Semaphore {
  private queue: (() => void)[] = []
  private active = 0
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>(resolve => this.queue.push(resolve))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}

/** Extract a meaningful error message, unwinding `cause` chains (e.g. Node fetch). */
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  let msg = err.message
  let cause = err.cause
  while (cause instanceof Error) {
    if (cause.message && cause.message !== msg) {
      msg += `: ${cause.message}`
    }
    cause = cause.cause
  }
  return msg
}

export function normalizeDate(pubDate: string | undefined | null): string | null {
  if (!pubDate) return null
  const d = new Date(pubDate)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
