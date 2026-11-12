package alice.server.routes

import alice.ha.Presentation
import alice.ha.StateCache
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.things.Caller
import alice.server.things.ThingsService
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private fun jAny(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is JsonElement -> v
    is String -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    is Int -> JsonPrimitive(v)
    is Long -> JsonPrimitive(v)
    is Float -> JsonPrimitive(v.toDouble())
    is Double -> JsonPrimitive(v)
    is Number -> JsonPrimitive(v.toDouble())
    is Map<*, *> -> buildJsonObject { v.forEach { (k, value) -> if (k is String) put(k, jAny(value)) } }
    is Iterable<*> -> buildJsonArray { v.forEach { add(jAny(it)) } }
    else -> JsonPrimitive(v.toString())
}

fun Route.thingsRoutes(things: ThingsService, stateCache: StateCache? = null) {
    route("/api/v1/things") {
        get {
            val member = Guards.requireMember(call.requestAuth())
            val caller = Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)
            val policies = things.allPoliciesPublic(caller.householdId)
            val out = things.things(caller.householdId, includeHidden = false).mapNotNull { t ->
                val canSeeFn: (String) -> Boolean = { eid -> things.canSee(caller, alice.ha.Connections.DEFAULT_ID, eid, t, policies) }
                val view = Presentation.presentThing(t, { id -> stateCache?.get(id) }, canSeeFn, false) ?: return@mapNotNull null
                val hubVisible = t.hubThingId == null || things.canSee(caller, alice.ha.Connections.DEFAULT_ID, t.hubThingId!!, t, policies)
                val v = if (!hubVisible) view.copy(hubThingId = null) else view
                buildJsonObject {
                    put("id", JsonPrimitive(v.id))
                    put("name", JsonPrimitive(v.name))
                    put("nameSource", JsonPrimitive(v.nameSource))
                    put("sourceName", JsonPrimitive(v.sourceName))
                    put("kind", JsonPrimitive(v.kind.name.lowercase()))
                    put("areaId", if (v.areaId == null) JsonNull else JsonPrimitive(v.areaId))
                    put("hidden", JsonPrimitive(v.hidden))
                    put("manufacturer", if (v.manufacturer == null) JsonNull else JsonPrimitive(v.manufacturer))
                    put("model", if (v.model == null) JsonNull else JsonPrimitive(v.model))
                    put("hubThingId", if (v.hubThingId == null) JsonNull else JsonPrimitive(v.hubThingId))
                    put("available", JsonPrimitive(v.available))
                    fun ent(e: alice.ha.EntityView) = buildJsonObject {
                        put("entityId", JsonPrimitive(e.entityId))
                        put("name", JsonPrimitive(e.name))
                        put("domain", JsonPrimitive(e.domain))
                        put("role", JsonPrimitive(e.role.name.lowercase()))
                        put("availability", JsonPrimitive(e.availability))
                        put("values", buildJsonObject { e.values.forEach { (k, x) -> put(k, jAny(x)) } })
                        put("capabilities", buildJsonArray { e.capabilities.forEach { c -> add(buildJsonObject {
                            put("name", JsonPrimitive(c.name)); put("readable", JsonPrimitive(c.readable)); put("controllable", JsonPrimitive(c.controllable))
                            put("operations", buildJsonArray { c.operations.forEach { add(JsonPrimitive(it)) } })
                            put("metadata", buildJsonObject { c.metadata.forEach { (k, x) -> put(k, jAny(x)) } })
                        }) } })
                    }
                    put("primary", v.primary?.let { ent(it) } ?: JsonNull)
                    put("others", buildJsonArray { v.others.forEach { add(ent(it)) } })
                    put("controls", buildJsonArray { v.controls.forEach { add(ent(it)) } })
                    put("facets", buildJsonArray { v.facets.forEach { f -> add(buildJsonObject {
                        put("key", JsonPrimitive(f.key)); put("entityId", JsonPrimitive(f.entityId)); put("value", JsonPrimitive(f.value)); put("label", JsonPrimitive(f.label))
                        put("active", if (f.active == null) JsonNull else JsonPrimitive(f.active)); put("tone", JsonPrimitive(f.tone)); put("ambiguous", JsonPrimitive(f.ambiguous)); put("basis", JsonPrimitive(f.basis)); put("sensitive", JsonPrimitive(f.sensitive)); put("suggestion", if (f.suggestion == null) JsonNull else JsonPrimitive(f.suggestion))
                    }) } })
                    put("sensors", buildJsonArray { v.sensors.forEach { add(ent(it)) } })
                    put("diagnosticCount", JsonPrimitive(v.diagnosticCount))
                }
            }
            call.respond(buildJsonObject { put("things", buildJsonArray { out.forEach { add(it) } }) })
        }
        get("/areas") {
            val member = Guards.requireMember(call.requestAuth())
            val caller = Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)
            val policies = things.allPoliciesPublic(caller.householdId)
            val visible = things.things(caller.householdId, includeHidden = false).filter { t ->
                (listOfNotNull(t.primary) + t.others + t.controls + t.sensors + t.facets).any { things.canSee(caller, alice.ha.Connections.DEFAULT_ID, it.entityId, t, policies) }
            }
            val counts = visible.groupingBy { it.areaId }.eachCount()
            call.respond(buildJsonObject {
                put("areas", buildJsonArray {
                    things.areas().forEach { a ->
                        add(buildJsonObject {
                            put("id", JsonPrimitive(a.area_id))
                            put("name", JsonPrimitive(a.name))
                            put("deviceCount", JsonPrimitive(counts[a.area_id] ?: 0))
                        })
                    }
                })
            })
        }
    }
}
