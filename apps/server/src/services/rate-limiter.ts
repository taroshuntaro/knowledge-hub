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
        // 現在ブロック中（上限到達）のキーは evict しない。攻撃者が大量の新規キーで
        // マップを溢れさせ、ブロック中の被害者キーをフラッシュしてレート制限を
        // リセットする攻撃を防ぐ。ブロック中でない最古のキーを退避対象にする。
        const evictable = this.oldestEvictableKey();
        if (evictable !== undefined) {
          this.hits.delete(evictable);
        } else {
          // 全キーがブロック中（大規模攻撃下）: 新規キーは安全側で拒否する
          return false;
        }
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

  // 挿入順（最古）で、かつ現在ブロック中でない最初のキーを返す。
  // 呼び出し直前に pruneExpired 済みなので残る timestamps はすべてウィンドウ内。
  // よって timestamps.length がそのまま現在のヒット数になる。
  private oldestEvictableKey(): string | undefined {
    for (const [key, timestamps] of this.hits) {
      if (timestamps.length < this.max) return key;
    }
    return undefined;
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
