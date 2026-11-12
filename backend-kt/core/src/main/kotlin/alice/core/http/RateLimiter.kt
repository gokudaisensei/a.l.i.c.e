package alice.core.http

import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.time.TimeProvider
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.ceil
import kotlin.math.max

/**
 * Fixed-window rate limiting, matching `backend/src/core/http/rate-limit.ts`:
 * 30 auth calls/minute per IP, 10 code guesses/15 minutes per IP and 100/hour
 * across everyone. Counters live in SQLite so a restart does not reset them,
 * and the SQLite store increments them atomically so processes can share them.
 */
data class RateLimitOptions(val limit: Int, val windowMs: Long)

data class HitResult(val allowed: Boolean, val remaining: Int, val retryAfterMs: Long)

data class Bucket(val count: Long, val resetAt: Long)

interface BucketStore {
    fun get(key: String): Bucket?
    fun set(key: String, bucket: Bucket)
    fun hit(key: String, now: Long, windowMs: Long): Bucket
    fun delete(key: String)
    fun sweep(now: Long)
}

class MemoryBucketStore : BucketStore {
    private val buckets = ConcurrentHashMap<String, Bucket>()

    override fun get(key: String): Bucket? = buckets[key]
    override fun set(key: String, bucket: Bucket) {
        buckets[key] = bucket
    }

    override fun hit(key: String, now: Long, windowMs: Long): Bucket =
        buckets.compute(key) { _, old ->
            if (old == null || old.resetAt <= now) Bucket(1, now + windowMs) else Bucket(old.count + 1, old.resetAt)
        }!!

    override fun delete(key: String) {
        buckets.remove(key)
    }

    override fun sweep(now: Long) {
        buckets.entries.removeIf { it.value.resetAt <= now }
    }
}

class SqliteBucketStore(private val database: Database) : BucketStore {
    override fun get(key: String): Bucket? = database.read {
        coreQueries.selectRateLimit(key).executeAsOneOrNull()
    }?.let { Bucket(it.count, it.reset_at) }

    override fun set(key: String, bucket: Bucket) {
        database.write { coreQueries.upsertRateLimit(key, bucket.count, bucket.resetAt) }
    }

    override fun hit(key: String, now: Long, windowMs: Long): Bucket = database.write {
        val resetAt = now + windowMs
        coreQueries.hitRateLimit(key, resetAt, now, now, resetAt).executeAsOne().let { Bucket(it.count, it.reset_at) }
    }

    override fun delete(key: String) {
        database.write { coreQueries.deleteRateLimit(key) }
    }

    override fun sweep(now: Long) {
        database.write { coreQueries.deleteExpiredRateLimits(now) }
    }
}

/** One fixed-window counter per key; `name` keeps several limiters apart in one shared store. */
class RateLimiter(
    private val options: RateLimitOptions,
    private val time: TimeProvider,
    private val store: BucketStore,
    private val name: String = "",
) {
    private val lock = Any()
    private var lastSweep = 0L

    fun hit(key: String): HitResult {
        val now = time.now()
        val sweep = synchronized(lock) {
            if (now - lastSweep > 60_000) {
                lastSweep = now
                true
            } else false
        }
        if (sweep) store.sweep(now)
        // The store performs the increment/reset atomically, so concurrent processes cannot lose hits.
        val bucket = store.hit(name + key, now, options.windowMs)
        return HitResult(
            allowed = bucket.count <= options.limit,
            remaining = max(0, options.limit - bucket.count.toInt()),
            retryAfterMs = max(0, bucket.resetAt - now),
        )
    }

    /** Forget a key, e.g. after a successful sign-in. */
    fun reset(key: String) = synchronized(lock) { store.delete(name + key) }
}

/** Counts a hit and throws 429 with `Retry-After` when over the limit. */
fun enforce(limiter: RateLimiter, key: String) {
    val result = limiter.hit(key)
    if (!result.allowed) {
        val seconds = max(1, ceil(result.retryAfterMs / 1000.0).toLong())
        throw AppException(
            code = ErrorCode.RATE_LIMITED,
            message = "Too many attempts. Try again in $seconds seconds",
            status = 429,
            headers = mapOf("Retry-After" to seconds.toString()),
        )
    }
}

data class Limits(
    /** All public auth endpoints, per IP. */
    val auth: RateLimiter,
    /** Endpoints where a guess wins something, per IP. */
    val secrets: RateLimiter,
    /** Same endpoints across all IPs, against distributed guessing. */
    val secretsGlobal: RateLimiter,
)

/** With a database the counters are kept in it; without one (limiter unit tests) they stay in memory. */
fun createLimits(time: TimeProvider, database: Database? = null): Limits {
    val store: BucketStore = database?.let(::SqliteBucketStore) ?: MemoryBucketStore()
    return Limits(
        auth = RateLimiter(RateLimitOptions(30, 60_000), time, store, "auth:"),
        secrets = RateLimiter(RateLimitOptions(10, 15 * 60_000), time, store, "secrets:"),
        secretsGlobal = RateLimiter(RateLimitOptions(100, 60 * 60_000), time, store, "secretsGlobal:"),
    )
}
