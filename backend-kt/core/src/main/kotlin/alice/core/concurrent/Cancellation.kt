package alice.core.concurrent

import kotlin.coroutines.cancellation.CancellationException

/**
 * Like [runCatching], but never swallows cancellation. Plain `runCatching` around a suspend call also catches the
 * `CancellationException` that stops the coroutine, so a cancelled job keeps running and a shutdown can hang. An expired
 * `withTimeout` is the one cancellation-typed exception that is NOT passed on: it is returned as a failure.
 */
inline fun <T> runCatchingNonCancellation(block: () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
        // A `withTimeout` that expired inside the block is a failure of that work (Home Assistant did not answer),
        // not a request to stop; it only looks like a cancellation because the type is a subclass of one.
        Result.failure(e)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Throwable) {
        Result.failure(e)
    }
