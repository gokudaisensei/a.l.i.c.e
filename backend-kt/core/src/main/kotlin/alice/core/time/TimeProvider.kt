package alice.core.time

/** Unix milliseconds, injectable so expiry and sliding-session tests are deterministic. */
fun interface TimeProvider {
    fun now(): Long
}

object SystemTimeProvider : TimeProvider {
    override fun now(): Long = System.currentTimeMillis()
}
