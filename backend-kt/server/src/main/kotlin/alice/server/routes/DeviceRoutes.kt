package alice.server.routes

import alice.core.error.AppException
import alice.core.error.notFound
import alice.core.error.validationError
import alice.ha.CapabilityDetector
import alice.ha.Presentation
import alice.ha.StateCache
import alice.ha.Thing
import alice.server.activity.ActivityService
import alice.server.commands.Actor
import alice.server.commands.CommandExecutor
import alice.server.commands.CommandInput
import alice.server.commands.CommandSource
import alice.server.commands.toPublicCommand
import alice.server.favorites.FavoritesService
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
import alice.server.things.Caller
import alice.server.things.EntityPatchBody
import alice.server.things.ThingsService
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

private fun callerOf(member: alice.server.http.MemberContext) =
    Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)

internal fun deviceAnyToJson(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is JsonElement -> v
    is String -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    is Int -> JsonPrimitive(v)
    is Long -> JsonPrimitive(v)
    is Float -> JsonPrimitive(v.toDouble())
    is Double -> JsonPrimitive(v)
    is Number -> JsonPrimitive(v.toDouble())
    is Map<*, *> -> buildJsonObject { v.forEach { (k, value) -> if (k is String) put(k, deviceAnyToJson(value)) } }
    is Iterable<*> -> buildJsonArray { v.forEach { add(deviceAnyToJson(it)) } }
    else -> JsonPrimitive(v.toString())
}

internal fun deviceViewJson(view: alice.ha.ThingView, favorite: Boolean, settings: JsonObject?): JsonObject = buildJsonObject {
    put("id", JsonPrimitive(view.id))
    put("name", JsonPrimitive(view.name))
    put("nameSource", JsonPrimitive(view.nameSource))
    put("sourceName", JsonPrimitive(view.sourceName))
    put("kind", JsonPrimitive(view.kind.name.lowercase()))
    put("areaId", if (view.areaId == null) JsonNull else JsonPrimitive(view.areaId))
    put("hidden", JsonPrimitive(view.hidden))
    put("manufacturer", if (view.manufacturer == null) JsonNull else JsonPrimitive(view.manufacturer))
    put("model", if (view.model == null) JsonNull else JsonPrimitive(view.model))
    put("hubThingId", if (view.hubThingId == null) JsonNull else JsonPrimitive(view.hubThingId))
    put("available", JsonPrimitive(view.available))
    put("favorite", JsonPrimitive(favorite))
    put("settings", settings ?: buildJsonObject { })
    put("primary", view.primary?.let { entityViewJson(it) } ?: JsonNull)
    put("others", buildJsonArray { view.others.forEach { add(entityViewJson(it)) } })
    put("controls", buildJsonArray { view.controls.forEach { add(entityViewJson(it)) } })
    put("facets", buildJsonArray {
        view.facets.forEach { f ->
            add(buildJsonObject {
                put("key", JsonPrimitive(f.key))
                put("entityId", JsonPrimitive(f.entityId))
                put("value", JsonPrimitive(f.value))
                put("label", JsonPrimitive(f.label))
                put("active", if (f.active == null) JsonNull else JsonPrimitive(f.active))
                put("tone", JsonPrimitive(f.tone))
                put("ambiguous", JsonPrimitive(f.ambiguous))
                put("basis", JsonPrimitive(f.basis))
                put("sensitive", JsonPrimitive(f.sensitive))
                put("suggestion", if (f.suggestion == null) JsonNull else JsonPrimitive(f.suggestion))
            })
        }
    })
    put("sensors", buildJsonArray { view.sensors.forEach { add(entityViewJson(it)) } })
    put("diagnosticCount", JsonPrimitive(view.diagnosticCount))
    if (view.diagnostics != null) put("diagnostics", buildJsonArray { view.diagnostics!!.forEach { add(entityViewJson(it)) } })
}

internal fun entityViewJson(e: alice.ha.EntityView): JsonObject = buildJsonObject {
    put("entityId", JsonPrimitive(e.entityId))
    put("name", JsonPrimitive(e.name))
    put("domain", JsonPrimitive(e.domain))
    put("role", JsonPrimitive(e.role.name.lowercase()))
    put("availability", JsonPrimitive(e.availability))
    put("values", buildJsonObject { e.values.forEach { (k, v) -> put(k, deviceAnyToJson(v)) } })
    put("capabilities", buildJsonArray {
        e.capabilities.forEach { c ->
            add(buildJsonObject {
                put("name", JsonPrimitive(c.name))
                put("readable", JsonPrimitive(c.readable))
                put("controllable", JsonPrimitive(c.controllable))
                put("operations", buildJsonArray { c.operations.forEach { add(JsonPrimitive(it)) } })
                put("metadata", buildJsonObject { c.metadata.forEach { (k, v) -> put(k, deviceAnyToJson(v)) } })
            })
        }
    })
}

internal suspend fun visibleDeviceViews(
    things: ThingsService,
    caller: Caller,
    includeHidden: Boolean,
    includeDiagnostics: Boolean = false,
    stateCache: StateCache? = null,
): List<JsonObject> {
    val policies = things.allPoliciesPublic(caller.householdId)
    val all = things.things(caller.householdId, includeHidden = true)
    val favIds = runCatching { things.favoriteIdsFor(caller.userId) }.getOrDefault(emptySet())
    val out = mutableListOf<JsonObject>()
    for (t in all) {
        if (t.hidden && !includeHidden && caller.role != alice.server.households.Role.ADMIN) continue
        val canSeeFn: (String) -> Boolean = { eid -> things.canSee(caller, alice.ha.Connections.DEFAULT_ID, eid, t, policies) }
        val view = Presentation.presentThing(t, { id -> stateCache?.get(id) }, canSeeFn, includeDiagnostics) ?: continue
        val hubVisible = t.hubThingId == null || things.canSee(caller, alice.ha.Connections.DEFAULT_ID, t.hubThingId!!, t, policies)
        val adjusted = if (!hubVisible) view.copy(hubThingId = null) else view
        val settings = thingSettingsJson(things, caller.householdId, t)
        val favorite = t.id in favIds || t.ref in favIds || t.entityIds.any { it in favIds }
        out += deviceViewJson(adjusted, favorite, settings)
    }
    return out.sortedBy { (it["name"] as? JsonPrimitive)?.content?.lowercase() ?: "" }
}

internal fun thingSettingsJson(things: ThingsService, householdId: String, t: Thing): JsonObject {
    val primaryId = t.primary?.entityId ?: t.others.firstOrNull()?.entityId ?: t.entityIds.firstOrNull()
    val s = primaryId?.let { things.getSettings(householdId, alice.ha.Connections.DEFAULT_ID, it) }
    return buildJsonObject {
        put("powerLimitW", if (s?.powerLimitW == null) JsonNull else JsonPrimitive(s.powerLimitW))
        put("voiceExposed", JsonPrimitive(s?.voiceExposed ?: false))
        put("voiceSync", buildJsonObject {
            put("status", JsonPrimitive(s?.voiceSyncStatus ?: "none"))
            put("error", if (s?.voiceSyncError == null) JsonNull else JsonPrimitive(s.voiceSyncError))
        })
    }
}

fun Route.deviceRoutes(things: ThingsService, executor: CommandExecutor, smart: alice.server.smart.SmartService? = null, activity: ActivityService? = null, favorites: FavoritesService? = null, stateCache: StateCache? = null) {
    route("/api/v1/devices") {
        get {
            val member = Guards.requireMember(call.requestAuth())
            val caller = callerOf(member)
            val area = call.request.queryParameters["area"]
            val type = call.request.queryParameters["type"]
            val q = call.request.queryParameters["q"]
            val includeHidden = call.request.queryParameters["includeHidden"] == "true"
            val favorite = call.request.queryParameters["favorite"] == "true"
            val favRefs = if (favorite) (favorites?.idsFor(member.session.userId) ?: emptyList()).toSet() else emptySet()
            var list = visibleDeviceViews(things, caller, includeHidden, stateCache = stateCache)
            if (area != null) list = list.filter { (it["areaId"] as? JsonPrimitive)?.content == area }
            if (type != null) list = list.filter { (it["primary"] as? JsonObject)?.let { p -> (p["domain"] as? JsonPrimitive)?.content } == type }
            if (q != null) list = list.filter { v ->
                val name = (v["name"] as? JsonPrimitive)?.content ?: ""
                name.contains(q, ignoreCase = true)
            }
            if (favorite) {
                list = list.filter { v ->
                    val id = (v["id"] as? JsonPrimitive)?.content
                    val fav = (v["favorite"] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() == true
                    fav || (id != null && id in favRefs)
                }
            }
            call.respond(buildJsonObject { put("devices", buildJsonArray { list.forEach { add(it) } }) })
        }
        get("/{id}") {
            val member = Guards.requireMember(call.requestAuth())
            val caller = callerOf(member)
            val id = call.parameters["id"] ?: throw validationError("Device id is required")
            val includeDiagnostics = call.request.queryParameters["include"] == "diagnostics"
            val views = visibleDeviceViews(things, caller, includeHidden = true, includeDiagnostics = includeDiagnostics, stateCache = stateCache)
            val found = views.firstOrNull { (it["id"] as? JsonPrimitive)?.content == id } ?: throw notFound("Device")
            smart?.recordView(member.membership.householdId, member.session.userId, id)
            call.respond(found)
        }
        get("/{id}/capabilities") {
            val member = Guards.requireMember(call.requestAuth())
            val caller = callerOf(member)
            val id = call.parameters["id"] ?: throw validationError("Device id is required")
            val vis = runCatching { things.visible(caller, id, includeDiagnostics = false) }.getOrNull() ?: throw notFound("Device")
            val entities = (listOfNotNull(vis.thing.primary) + vis.thing.others + vis.thing.controls + vis.thing.sensors + vis.thing.facets)
                .filter { vis.canSee(it.entityId) }
            call.respond(buildJsonObject {
                put("entities", buildJsonArray {
                    entities.forEach { e ->
                        add(buildJsonObject {
                            put("entityId", JsonPrimitive(e.entityId))
                            put("name", JsonPrimitive(e.name))
                            put("role", JsonPrimitive(e.role.name.lowercase()))
                            put("capabilities", buildJsonArray {
                                e.capabilities.forEach { c ->
                                    add(buildJsonObject {
                                        put("name", JsonPrimitive(c.name))
                                        put("readable", JsonPrimitive(c.readable))
                                        put("controllable", JsonPrimitive(c.controllable))
                                        put("operations", buildJsonArray { c.operations.forEach { add(JsonPrimitive(it)) } })
                                        put("metadata", buildJsonObject { c.metadata.forEach { (k, v) -> put(k, deviceAnyToJson(v)) } })
                                    })
                                }
                            })
                        })
                    }
                })
            })
        }
        get("/{id}/activity") {
            val member = Guards.requireMember(call.requestAuth())
            val caller = callerOf(member)
            val id = call.parameters["id"] ?: throw validationError("Device id is required")
            runCatching { things.visible(caller, id) }.getOrNull() ?: throw notFound("Device")
            val items = if (activity != null) activity.list(caller, limit = 20).items.filter { it.thingId == id } else emptyList()
            call.respond(mapOf("activity" to items))
        }
        patch("/{id}/name") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.DEVICE_RENAME.wire)
            val caller = callerOf(member)
            val id = call.parameters["id"] ?: throw validationError("Device id is required")
            val body = call.receive<NamePatchBody>()
            runCatching { things.visible(caller, id, includeDiagnostics = false) }.getOrNull() ?: throw notFound("Device")
            things.rename(member.membership.householdId, member.session.userId, id, body.name)
            val views = visibleDeviceViews(things, caller, includeHidden = true, stateCache = stateCache)
            call.respond(views.firstOrNull { (it["id"] as? JsonPrimitive)?.content == id } ?: throw notFound("Device"))
        }
        patch("/{id}/settings") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.DEVICE_MANAGE.wire)
            val caller = callerOf(member)
            val id = call.parameters["id"] ?: throw validationError("Device id is required")
            val body = call.receive<SettingsPatchBody>()
            val vis = runCatching { things.visible(caller, id, includeDiagnostics = false) }.getOrNull() ?: throw notFound("Device")
            val thing = vis.thing
            val entityId = body.entityId ?: thing.primary?.entityId ?: thing.others.firstOrNull()?.entityId ?: throw validationError("No entity to configure")
            if (body.powerLimitW != null && (body.powerLimitW < 1 || body.powerLimitW > 100000)) throw validationError("Power limit must be a whole number of watts between 1 and 100000")
            things.updateSettings(member.membership.householdId, alice.ha.Connections.DEFAULT_ID, entityId, body.powerLimitW, body.voiceExposed, body.leftOpenAfterMs)
            val saved = things.getSettings(member.membership.householdId, alice.ha.Connections.DEFAULT_ID, entityId)
            call.respond(DeviceSettingsResponse(entityId, saved?.powerLimitW, saved?.leftOpenAfterMs, saved?.voiceExposed ?: false, mapOf("status" to (saved?.voiceSyncStatus ?: "none"), "error" to saved?.voiceSyncError)))
        }
        post("/{id}/hide") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.DEVICE_MANAGE.wire)
            val caller = callerOf(member)
            val id = call.parameters["id"] ?: throw validationError("Device id is required")
            runCatching { things.visible(caller, id, includeDiagnostics = false) }.getOrNull() ?: throw notFound("Device")
            things.setHidden(member.membership.householdId, member.session.userId, id, true)
            call.respond(OkResponse())
        }
        post("/{id}/unhide") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.DEVICE_MANAGE.wire)
            val caller = callerOf(member)
            val id = call.parameters["id"] ?: throw validationError("Device id is required")
            // hidden device: allow admin/member with manage to see by includeHidden lookup
            val all = things.things(member.membership.householdId, includeHidden = true)
            if (all.none { it.id == id }) throw notFound("Device")
            things.setHidden(member.membership.householdId, member.session.userId, id, false)
            call.respond(OkResponse())
        }
        post("/{id}/split") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.DEVICE_MANAGE.wire)
            val caller = callerOf(member)
            val id = call.parameters["id"] ?: throw validationError("Device id is required")
            runCatching { things.visible(caller, id, includeDiagnostics = false) }.getOrNull() ?: throw notFound("Device")
            val body = call.receive<SplitBody>()
            things.split(member.membership.householdId, member.session.userId, id, body.entityIds)
            call.respond(OkResponse())
        }
        post("/merge") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.DEVICE_MANAGE.wire)
            val body = call.receive<MergeBody>()
            things.merge(member.membership.householdId, member.session.userId, body.ids)
            call.respond(OkResponse())
        }
        post("/unmerge") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.DEVICE_MANAGE.wire)
            val body = call.receive<UnmergeBody>()
            things.unmerge(member.membership.householdId, member.session.userId, body.ids)
            call.respond(OkResponse())
        }
        post("/{id}/commands") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.DEVICE_CONTROL.wire)
            val caller = callerOf(member)
            val id = call.parameters["id"] ?: throw validationError("Device id is required")
            val body = call.receive<CommandRequest>()
            val vis = runCatching { things.visible(caller, id, includeDiagnostics = false) }.getOrNull() ?: throw notFound("Device")
            val thing = vis.thing
            val entityId = body.entityId ?: thing.primary?.entityId ?: throw validationError("No primary entity")
            // The visibility check below only knows this device's policies, so the entity must belong to it.
            if (entityId !in thing.entityIds) throw notFound("Device entity")
            // per-entity visibility/policy check on target
            if (!vis.canSee(entityId)) throw AppException(alice.core.error.ErrorCode.FORBIDDEN, "You do not have permission to control this device", 403)
            val idemKey = call.request.headers["Idempotency-Key"]?.takeIf { it.isNotBlank() }
            if (idemKey != null) {
                val err = executor.validateIdempotencyKey(idemKey)
                if (err != null) throw validationError(err)
            }
            val cmd = executor.execute(
                CommandInput(
                    householdId = member.membership.householdId,
                    entityId = entityId,
                    action = body.action,
                    parameters = body.parameters,
                    actor = Actor(member.session.userId, CommandSource.USER, member.session.steppedUp),
                    idempotencyKey = idemKey,
                ),
            )
            call.respond(toPublicCommand(cmd))
        }
    }
    route("/api/v1/areas") {
        get {
            val member = Guards.requireMember(call.requestAuth())
            val caller = callerOf(member)
            val areas = things.areas()
            val devices = visibleDeviceViews(things, caller, includeHidden = false, stateCache = stateCache)
            val counts = devices.groupingBy { (it["areaId"] as? JsonPrimitive)?.content }.eachCount()
            call.respond(buildJsonObject {
                put("areas", buildJsonArray {
                    areas.forEach { a ->
                        add(buildJsonObject {
                            put("id", JsonPrimitive(a.area_id))
                            put("name", JsonPrimitive(a.name))
                            put("deviceCount", JsonPrimitive(counts[a.area_id] ?: 0))
                        })
                    }
                })
            })
        }
        get("/{id}/devices") {
            val member = Guards.requireMember(call.requestAuth())
            val caller = callerOf(member)
            val areaId = call.parameters["id"] ?: throw validationError("Area id is required")
            val list = visibleDeviceViews(things, caller, includeHidden = false, stateCache = stateCache)
                .filter { (it["areaId"] as? JsonPrimitive)?.content == areaId }
            call.respond(buildJsonObject { put("devices", buildJsonArray { list.forEach { add(it) } }) })
        }
    }
    route("/api/v1/entities") {
        put("/{entityId}/role") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.DEVICE_MANAGE.wire)
            val entityId = call.parameters["entityId"] ?: throw validationError("Entity id is required")
            val body = call.receive<EntityRoleBody>()
            things.setEntity(member.membership.householdId, member.session.userId, entityId, EntityPatchBody(body.role, body.attachTo, body.onMeans, body.displayName, body.hidden))
            call.respond(OkResponse())
        }
    }
    route("/api/v1/commands") {
        get {
            val member = Guards.requireMember(call.requestAuth())
            val state = call.request.queryParameters["state"]?.let { alice.server.commands.CommandState.fromWire(it) }
            val limit = call.request.queryParameters["limit"]?.toIntOrNull() ?: 100
            val cmds = executor.list { it.list(member.membership.householdId, state, null, limit) }
            call.respond(CommandsResponse(cmds.map { toPublicCommand(it) }))
        }
        get("/{id}") {
            val member = Guards.requireMember(call.requestAuth())
            val id = call.parameters["id"] ?: throw validationError("Command id is required")
            val cmd = executor.get(id) ?: throw notFound("Command")
            if (cmd.householdId != member.membership.householdId) throw notFound("Command")
            if (member.membership.role != alice.server.households.Role.ADMIN && cmd.requestedBy != member.session.userId) throw AppException(alice.core.error.ErrorCode.FORBIDDEN, "You do not have permission to view this command", 403)
            call.respond(toPublicCommand(cmd))
        }
        post("/{id}/cancel") {
            val member = Guards.requireMember(call.requestAuth())
            val id = call.parameters["id"] ?: throw validationError("Command id is required")
            val existing = executor.get(id) ?: throw notFound("Command")
            if (existing.householdId != member.membership.householdId) throw notFound("Command")
            if (member.membership.role != alice.server.households.Role.ADMIN && existing.requestedBy != member.session.userId) throw AppException(alice.core.error.ErrorCode.FORBIDDEN, "You do not have permission to cancel this command", 403)
            val cmd = executor.cancel(id) ?: throw notFound("Command")
            call.respond(toPublicCommand(cmd))
        }
        post("/{id}/undo") {
            val member = Guards.requireMember(call.requestAuth())
            val id = call.parameters["id"] ?: throw validationError("Command id is required")
            val existing = executor.get(id) ?: throw notFound("Command")
            if (existing.householdId != member.membership.householdId) throw notFound("Command")
            if (member.membership.role != alice.server.households.Role.ADMIN && existing.requestedBy != member.session.userId) throw AppException(alice.core.error.ErrorCode.FORBIDDEN, "You do not have permission to undo this command", 403)
            // A deny rule added after the original command must also stop its undo.
            val found = things.findEntity(member.membership.householdId, existing.entityId)
            if (found == null || !things.canSee(callerOf(member), found.connectionId, existing.entityId, found.thing)) throw notFound("Command")
            val cmd = executor.undo(id) ?: throw validationError("Cannot undo")
            call.respond(toPublicCommand(cmd))
        }
    }
}

@Serializable data class DevicesResponse(val devices: List<Thing>)
@Serializable data class CapabilitiesResponse(val capabilities: List<alice.ha.DeviceCapability>)
@Serializable data class NamePatchBody(val name: String? = null)
@Serializable data class SettingsPatchBody(val entityId: String? = null, val powerLimitW: Int? = null, val leftOpenAfterMs: Long? = null, val voiceExposed: Boolean? = null)
@Serializable data class DeviceSettingsResponse(val entityId: String?, val powerLimitW: Int?, val leftOpenAfterMs: Long? = null, val voiceExposed: Boolean, val voiceSync: Map<String, String?> = emptyMap())
@Serializable data class SplitBody(val entityIds: List<String>)
@Serializable data class EntityRoleBody(val role: String? = null, val attachTo: String? = null, val onMeans: String? = null, val displayName: String? = null, val hidden: Boolean? = null)
@Serializable data class MergeBody(val ids: List<String>)
@Serializable data class UnmergeBody(val ids: List<String>)
@Serializable data class ActivityResponse(val activity: List<String>)
@Serializable data class CommandsResponse(val commands: List<alice.server.commands.PublicCommand>)
@Serializable data class CommandRequest(val entityId: String? = null, val action: String, val parameters: Map<String, JsonElement> = emptyMap())
