package alice.core.events

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class EventBusTest {
    private data class E(override val type: String) : AppEvent

    @Test
    fun `a slow subscriber cannot make a fast one miss events and drops are counted`() = runBlocking<Unit> {
        repeat(20) { round ->
            val bus = InProcessEventBus(capacity = 4)
            val slowStarted = CompletableDeferred<Unit>()
            val fastStarted = CompletableDeferred<Unit>()
            val firstReceived = CompletableDeferred<Unit>()
            val fast = java.util.concurrent.CopyOnWriteArrayList<AppEvent>()
            val slow = launch(Dispatchers.Default) {
                bus.events.onStart { slowStarted.complete(Unit) }.collect {
                    firstReceived.complete(Unit)
                    delay(10_000)
                }
            }
            val fastJob = launch(Dispatchers.Default) {
                bus.events.onStart { fastStarted.complete(Unit) }.collect { fast += it }
            }
            try {
                slowStarted.await()
                fastStarted.await()
                withTimeout(2_000) { while (bus.subscriberCount < 2) delay(5) }
                bus.publish(E("first"))
                withTimeout(2_000) { while (fast.isEmpty()) delay(5) }
                firstReceived.await()
                repeat(20) {
                    bus.publish(E("e$it"))
                    delay(5) // give the fast collector time to drain, while the slow one stays in its delay
                }
                withTimeout(2_000) { while (fast.size < 21) delay(5) }
                assertEquals(listOf("first") + (0 until 20).map { "e$it" }, fast.map { it.type }, "round $round")
                assertEquals(16L, bus.droppedEvents, "round $round: 20 events with a 4-slot buffer")
            } finally {
                slow.cancelAndJoin()
                fastJob.cancelAndJoin()
            }
            withTimeout(2_000) { while (bus.subscriberCount != 0) delay(5) }
        }
    }

    @Test
    fun `cancelled collectors unregister and publishing without subscribers is harmless`() = runBlocking<Unit> {
        val bus = InProcessEventBus(capacity = 2)
        repeat(100) {
            val job = launch(Dispatchers.Default) { bus.events.take(1).collect { } }
            delay(1)
            job.cancelAndJoin()
        }
        withTimeout(2_000) { while (bus.subscriberCount != 0) delay(5) }
        repeat(10) { bus.publish(E("no-subscriber-$it")) }
        assertEquals(0, bus.subscriberCount)
        assertTrue(bus.droppedEvents >= 0)
    }
}
