export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {
    if (!Number.isFinite(max) || max <= 0) {
      throw new RangeError('max must be a positive finite number');
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError('windowMs must be a positive finite number');
    }
    if (!Number.isFinite(maxKeys) || maxKeys <= 0) {
      throw new RangeError('maxKeys must be a positive finite number');
    }
  }

  consume(key: string, now = Date.now()): boolean {
    if (!this.hits.has(key) && this.hits.size >= Math.ceil(this.maxKeys)) {
      this.pruneExpired(now);
      if (this.hits.size >= Math.ceil(this.maxKeys)) {
        const oldestKey = this.hits.keys().next().value;
        if (oldestKey !== undefined) this.hits.delete(oldestKey);
      }
    }

    const recent = (this.hits.get(key) ?? []).filter(
      (timestamp) => now - timestamp < this.windowMs,
    );
    this.hits.delete(key);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }

  private pruneExpired(now: number): void {
    for (const [key, timestamps] of this.hits) {
      const recent = timestamps.filter((timestamp) => now - timestamp < this.windowMs);
      if (recent.length === 0) {
        this.hits.delete(key);
      } else if (recent.length !== timestamps.length) {
        this.hits.set(key, recent);
      }
    }
  }
}
