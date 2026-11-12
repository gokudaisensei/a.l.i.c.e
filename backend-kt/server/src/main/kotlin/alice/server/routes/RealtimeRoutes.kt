package alice.server.routes

import alice.server.auth.AuthService
import alice.server.households.HouseholdService
import alice.server.realtime.ClientSocket
import alice.server.realtime.RealtimeHub
import io.ktor.http.HttpHeaders
import io.ktor.server.routing.Route
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.channels.consumeEach
import java.util.UUID

fun Route.realtimeRoutes(hub: RealtimeHub, auth: AuthService, households: HouseholdService, allowedOrigins: Set<String>) {
    webSocket("/ws") {
        val origin = call.request.headers[HttpHeaders.Origin]
        if (origin != null && allowedOrigins.isNotEmpty() && origin !in allowedOrigins) {
            close(CloseReason(4403, "Origin not allowed"))
            return@webSocket
        }
        // cookie first, then bearer token
        val cookieToken = call.request.cookies["alice_session"]
        var sessionCtx = auth.getSession(cookieToken)
        if (sessionCtx == null) {
            val bearer = call.request.headers[HttpHeaders.Authorization]?.removePrefix("Bearer ")?.trim()
            if (!bearer.isNullOrBlank()) sessionCtx = auth.getSession(bearer)
        }
        val membership = sessionCtx?.let { households.getMembership(it.userId) }
        if (sessionCtx == null || membership == null) {
            close(CloseReason(4401, "Unauthenticated"))
            return@webSocket
        }
        val socket = object : ClientSocket {
            override val id = UUID.randomUUID().toString()
            // Bytes handed to the connection that it has not yet accepted: `send` suspends while its buffer is full.
            private val pending = java.util.concurrent.atomic.AtomicInteger()
            override suspend fun send(msg: kotlinx.serialization.json.JsonObject) {
                val text = msg.toString()
                pending.addAndGet(text.length)
                try { this@webSocket.send(Frame.Text(text)) } finally { pending.addAndGet(-text.length) }
            }
            override suspend fun close(code: Int, reason: String) { this@webSocket.close(CloseReason(code.toShort(), reason)) }
            override fun bufferedAmount(): Int = pending.get()
        }
        if (!hub.connect(socket, sessionCtx, membership)) return@webSocket
        try {
            incoming.consumeEach { frame ->
                if (frame is Frame.Text) hub.receive(socket.id, frame.readText())
            }
        } finally {
            hub.disconnect(socket.id)
        }
    }
}
