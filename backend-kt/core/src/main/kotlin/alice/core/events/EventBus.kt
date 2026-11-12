package alice.core.events

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import org.slf4j.LoggerFactory
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * An application event, already normalized (raw Home Assistant events never
 * reach the bus). `type` is the wire name, e.g. `entity.updated`.
 */
interface AppEvent {
    val type: String
    val householdId: String? get() = null
    val timestamp: String? get() = null
}

/**
 * In-process pub/sub behind an interface, so a Redis/NATS adapter can replace
 * it without touching consumers (L55).
 */
interface EventBus {
    val events: Flow<AppEvent>
    fun publish(event: AppEvent)
}

class InProcessEventBus(private val capacity: Int = 512) : EventBus {
    private val log = LoggerFactory.getLogger(InProcessEventBus::class.java)
    private val subscribers = ConcurrentHashMap<Long, Subscriber>()
    private val nextId = AtomicLong()

    /** Total events dropped because a subscriber was too slow to read its bounded queue. */
    private val totalDropped = AtomicLong()
    val droppedEvents: Long get() = totalDropped.get()

    /** Live collectors; used by tests to prove cancellation unregisters a collector. */
    val subscriberCount: Int get() = subscribers.size

    private inner class Subscriber {
        val id: Long = nextId.incrementAndGet()
        val channel: Channel<AppEvent> = Channel(
            capacity = capacity,
            onBufferOverflow = BufferOverflow.DROP_OLDEST,
            onUndeliveredElement = { dropped() },
        )
        private val lastWarning = AtomicLong(0L)

        fun dropped() {
            totalDropped.incrementAndGet()
            val now = System.nanoTime()
            val last = lastWarning.get()
            if (now - last >= 1_000_000_000L && lastWarning.compareAndSet(last, now)) {
                log.warn("Event bus subscriber {} is falling behind; dropped {} event(s) so far", id, totalDropped.get())
            }
        }
    }

    override val events: Flow<AppEvent> = flow {
        val subscriber = Subscriber()
        subscribers[subscriber.id] = subscriber
        try {
            for (event in subscriber.channel) emit(event)
        } finally {
            subscribers.remove(subscriber.id)
            subscriber.channel.close()
        }
    }

    override fun publish(event: AppEvent) {
        for (subscriber in subscribers.values) subscriber.channel.trySend(event)
    }
}
