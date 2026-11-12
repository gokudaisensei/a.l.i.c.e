package alice.server.routes

import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import kotlinx.serialization.Serializable

/**
 * Public liveness, wire-compatible with the existing backend:
 * `{ "status": "ok", "uptime": <seconds> }`.
 */
@Serializable
data class HealthResponse(
    val status: String,
    val uptime: Double,
)

fun Route.healthRoutes() {
    val startedAt = System.nanoTime()

    get("/health") {
        val uptimeSeconds = (System.nanoTime() - startedAt) / 1_000_000_000.0
        call.respond(HealthResponse(status = "ok", uptime = uptimeSeconds))
    }
}
