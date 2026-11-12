package alice.server.routes

import alice.ha.ConfigJobService
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.sync.ConfigSyncService
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

fun Route.configSyncRoutes(configJobs: ConfigJobService, sync: ConfigSyncService) {
    route("/api/v1/admin/config-sync") {
        get {
            val member = Guards.requirePermission(call.requestAuth(), "admin.view")
            val s = configJobs.status(member.membership.householdId)
            call.respond(ConfigSyncStatusResponse(
                connected = s.connected,
                adminTokenSet = s.adminTokenSet,
                workerLastSeenAt = s.workerLastSeenAt,
                workerOnline = s.workerOnline,
                pendingJobs = s.pendingJobs,
                failedJobs = s.failedJobs,
                canApply = s.connected && s.adminTokenSet && s.workerOnline,
                drifted = sync.driftedCount(member.membership.householdId),
            ))
        }
        post("/verify") {
            val member = Guards.requirePermission(call.requestAuth(), "ha.manage")
            call.respond(QueuedResponse(sync.verify(member.membership.householdId)))
        }
        post("/resync") {
            val member = Guards.requirePermission(call.requestAuth(), "ha.manage")
            val thingCaller = alice.server.things.Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)
            val routineCaller = alice.server.routines.Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)
            val autoCaller = alice.server.automations.Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)
            val queued = sync.reconcileScenes(thingCaller) + sync.reconcileRoutines(routineCaller) + sync.reconcileAutomations(autoCaller)
            call.respond(ResyncResponse(queued))
        }
    }
}

@Serializable
data class ConfigSyncStatusResponse(
    val connected: Boolean,
    val adminTokenSet: Boolean,
    val workerLastSeenAt: Long? = null,
    val workerOnline: Boolean = false,
    val pendingJobs: Int,
    val failedJobs: Int,
    val canApply: Boolean,
    val drifted: Int,
)

@Serializable data class QueuedResponse(val queued: Boolean)
@Serializable data class ResyncResponse(val queued: Int)
