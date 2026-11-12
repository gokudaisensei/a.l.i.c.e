package alice.server.routes

import alice.ha.Presentation
import alice.ha.StateCache
import alice.server.favorites.FavoritesService
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.things.Caller
import alice.server.things.ThingsService
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private fun thingKey(thing: alice.ha.Thing): Set<String> = buildSet {
    add(thing.id)
    add(thing.ref)
    thing.entityIds.forEach { add(it) }
}

private fun matchesRef(thing: alice.ha.Thing, ref: String): Boolean =
    thingsRefMatches(thing, ref) || thing.id == ref

private fun thingsRefMatches(thing: alice.ha.Thing, ref: String): Boolean {
    if (thing.ref == ref) return true
    if (ref.startsWith("device:")) return thing.deviceIds.contains(ref.removePrefix("device:"))
    return thing.entityIds.contains(ref.removePrefix("entity:")) && thing.deviceIds.isEmpty()
}

private suspend fun favoriteDeviceViews(
    things: ThingsService,
    favorites: FavoritesService,
    caller: Caller,
    stateCache: StateCache? = null,
): List<JsonObject> {
    val refs = favorites.idsFor(caller.userId)
    if (refs.isEmpty()) return emptyList()
    val policies = things.allPoliciesPublic(caller.householdId)
    val all = things.things(caller.householdId, includeHidden = true)
    val favIds = refs.toSet()
    val viewsByThingId = mutableMapOf<String, JsonObject>()
    val thingById = mutableMapOf<String, alice.ha.Thing>()
    for (t in all) {
        if (t.hidden) continue // a hidden device drops out of favorites (it comes back if it is shown again), as in the TypeScript service
        val canSeeFn: (String) -> Boolean = { eid -> things.canSee(caller, alice.ha.Connections.DEFAULT_ID, eid, t, policies) }
        val view = Presentation.presentThing(t, { id -> stateCache?.get(id) }, canSeeFn, false) ?: continue
        val hubVisible = t.hubThingId == null || things.canSee(caller, alice.ha.Connections.DEFAULT_ID, t.hubThingId!!, t, policies)
        val adjusted = if (!hubVisible) view.copy(hubThingId = null) else view
        val favorite = t.id in favIds || t.ref in favIds || t.entityIds.any { it in favIds }
        viewsByThingId[t.id] = deviceViewJson(adjusted, favorite, thingSettingsJson(things, caller.householdId, t))
        thingById[t.id] = t
    }
    val ordered = mutableListOf<JsonObject>()
    val seen = mutableSetOf<String>()
    for (ref in refs) {
        val thing = thingById.values.firstOrNull { matchesRef(it, ref) || things.refMatches(it, ref) } ?: continue
        if (!seen.add(thing.id)) continue
        viewsByThingId[thing.id]?.let { ordered += it }
    }
    return ordered
}

fun Route.favoriteRoutes(favorites: FavoritesService, things: ThingsService, stateCache: StateCache? = null) {
    route("/api/v1/favorites") {
        get {
            val member = Guards.requirePermission(call.requestAuth(), "device.view")
            val caller = Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)
            call.respond(buildJsonObject { put("devices", buildJsonArray { favoriteDeviceViews(things, favorites, caller, stateCache).forEach { add(it) } }) })
        }
        put {
            val member = Guards.requirePermission(call.requestAuth(), "device.view")
            val caller = Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)
            val body = call.receive<FavoritesBody>()
            val all = things.things(member.membership.householdId, includeHidden = true)
            val policies = things.allPoliciesPublic(caller.householdId)
            val unique = body.thingIds.distinct().take(50)
            val items = unique.mapNotNull { id ->
                val t = all.firstOrNull { it.id == id } ?: return@mapNotNull null
                val visible = (listOfNotNull(t.primary) + t.others + t.controls + t.sensors + t.facets).any { things.canSee(caller, alice.ha.Connections.DEFAULT_ID, it.entityId, t, policies) }
                if (!visible) return@mapNotNull null
                alice.ha.Connections.DEFAULT_ID to t.ref
            }
            favorites.save(member.session.userId, items)
            call.respond(buildJsonObject { put("devices", buildJsonArray { favoriteDeviceViews(things, favorites, caller, stateCache).forEach { add(it) } }) })
        }
    }
}

@Serializable data class FavoritesBody(val thingIds: List<String>)
