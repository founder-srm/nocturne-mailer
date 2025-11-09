export class FixedWindowRateLimiter {
  private windowStart = Date.now()
  private counters = new Map<string, number>()
  constructor(private max: number, private windowMs: number) {}

  allow(key: string): boolean {
    const now = Date.now()
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now
      this.counters.clear()
    }
    const count = (this.counters.get(key) || 0) + 1
    this.counters.set(key, count)
    return count <= this.max
  }
}
