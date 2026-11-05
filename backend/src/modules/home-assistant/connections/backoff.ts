export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** 0..1 fraction of the delay randomised (full jitter at 1). */
  jitter?: number;
  random?: () => number;
}

/** Exponential backoff with jitter. `next()` returns the delay for the upcoming attempt. */
export class Backoff {
  private attempt = 0;
  private readonly base: number;
  private readonly max: number;
  private readonly jitter: number;
  private readonly random: () => number;

  constructor(opts: BackoffOptions = {}) {
    this.base = opts.baseMs ?? 1000;
    this.max = opts.maxMs ?? 60_000;
    this.jitter = opts.jitter ?? 0.3;
    this.random = opts.random ?? Math.random;
  }

  next(): number {
    const exp = Math.min(this.max, this.base * 2 ** this.attempt++);
    const spread = exp * this.jitter;
    return Math.round(exp - spread + this.random() * spread);
  }

  reset() {
    this.attempt = 0;
  }
}
