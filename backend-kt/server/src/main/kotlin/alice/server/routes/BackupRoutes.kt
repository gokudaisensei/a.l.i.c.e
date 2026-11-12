package alice.server.routes

import alice.server.backups.BackupService
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable data class BackupSettingsPatch(
    val enabled: Boolean? = null,
    val time: String? = null,
    val keep: Int? = null,
    val includeHa: Boolean? = null,
    val destination: String? = null,
    val nasPath: String? = null,
)

@Serializable data class CreateBackupBody(val kind: String = "app")

@Serializable data class BackupListResponse(val items: List<alice.server.backups.BackupView>, val settings: alice.server.backups.BackupSettings, val encryption: Boolean)

fun Route.backupRoutes(backups: BackupService) {
    route("/api/v1/backups") {
        get {
            val member = Guards.requirePermission(call.requestAuth(), Permission.BACKUP_MANAGE.wire)
            call.respond(BackupListResponse(backups.list(member.membership.householdId), backups.settings(member.membership.householdId), backups.encryptionEnabled()))
        }
        get("/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.BACKUP_MANAGE.wire)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Backup id is required")
            call.respond(backups.get(member.membership.householdId, id))
        }
        get("/settings") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.BACKUP_MANAGE.wire)
            call.respond(backups.settings(member.membership.householdId))
        }
        put("/settings") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.BACKUP_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = call.receive<BackupSettingsPatch>()
            val patch = buildMap<String, Any?> {
                body.enabled?.let { put("enabled", it) }
                body.time?.let { put("time", it) }
                body.keep?.let { put("keep", it) }
                body.includeHa?.let { put("includeHa", it) }
                body.destination?.let { put("destination", it) }
                if (body.nasPath != null) put("nasPath", body.nasPath) else Unit
            }
            call.respond(backups.updateSettings(member.membership.householdId, member.session.userId, patch))
        }
        post {
            val member = Guards.requirePermission(call.requestAuth(), Permission.BACKUP_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = runCatching { call.receive<CreateBackupBody>() }.getOrDefault(CreateBackupBody())
            val kind = body.kind
            val out = if (kind == "ha") backups.createHa(member.membership.householdId, "manual", member.session.userId)
            else backups.createApp(member.membership.householdId, "manual", member.session.userId)
            call.respond(out)
        }
        post("/{id}/verify") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.BACKUP_MANAGE.wire)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Backup id is required")
            call.respond(backups.verify(member.membership.householdId, id))
        }
        get("/{id}/download") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.BACKUP_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Backup id is required")
            val (name, bytes) = backups.download(member.membership.householdId, id, member.session.userId)
            call.response.header(HttpHeaders.ContentDisposition, "attachment; filename=\"$name\"")
            call.respondBytes(bytes, ContentType.Application.OctetStream)
        }
        post("/{id}/restore") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.BACKUP_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Backup id is required")
            val row = backups.get(member.membership.householdId, id)
            val out = if (row.kind == "ha") backups.restoreHa(member.membership.householdId, id, member.session.userId)
            else backups.stageRestore(member.membership.householdId, id, member.session.userId)
            call.respond(out.toJsonObject())
        }
        delete("/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.BACKUP_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Backup id is required")
            val out = backups.remove(member.membership.householdId, id, member.session.userId)
            call.respond(out.toJsonObject())
        }
    }
}
