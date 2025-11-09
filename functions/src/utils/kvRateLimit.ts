import type { KVNamespace } from '@cloudflare/workers-types'

// KV-based fixed window rate limiter (best-effort, not atomic)
export class KVFixedWindowRateLimiter {
  constructor(private kv: KVNamespace, private max: number, private windowMs: number, private prefix = 'rl') {}

  private windowKey(key: string, now = Date.now()): string {
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs
    return `${this.prefix}:${key}:${windowStart}`
  }

  async allow(key: string): Promise<boolean> {
    const k = this.windowKey(key)
    const existing = await this.kv.get(k, 'json') as { c: number } | null
    const count = (existing?.c || 0) + 1
    await this.kv.put(k, JSON.stringify({ c: count }), { expirationTtl: Math.ceil(this.windowMs / 1000) + 5 })
    return count <= this.max
  }
}
