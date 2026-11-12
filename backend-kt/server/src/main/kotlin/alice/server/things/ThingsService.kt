package alice.server.things

import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.launch
import alice.core.db.Database
import alice.core.error.notFound
import alice.core.ids.Ids
import alice.core.time.SystemTimeProvider
import alice.core.time.TimeProvider
import alice.ha.Discovery
import alice.ha.HomeAssistantGateway
import alice.ha.Inventory
import alice.ha.Presentation
import alice.ha.StateCache
import alice.ha.Thing
import alice.ha.ThingBuilder
import alice.server.households.HouseholdService
import alice.server.households.Role
import alice.server.permissions.DevicePolicyRow
import alice.server.permissions.evaluateDeviceAccess
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.Json
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString

data class Caller(
    val householdId: String,
    val userId: String,
    val role: Role,
    val steppedUp: Boolean,
)

data class ThingOverride(val displayName: String? = null, val hidden: Boolean? = null, val areaId: String? = null)
data class EntityOverride(val role: String? = null, val displayName: String? = null, val attachTo: String? = null, val hidden: Boolean? = null, val onMeans: String? = null)

data class EntityPatchBody(
    val role: String? = null,
    val attachTo: String? = null,
    val onMeans: String? = null,
    val displayName: String? = null,
    val hidden: Boolean? = null,
)

data class EntitySettings(val connectionId: String, val entityId: String, val householdId: String, val powerLimitW: Int?, val leftOpenAfterMs: Long?, val voiceExposed: Boolean, val voiceSyncStatus: String, val voiceSyncError: String?)

class ThingsService(
    private val gateway: HomeAssistantGateway,
    private val database: Database,
    private val households: HouseholdService,
    private val favorites: alice.server.favorites.FavoritesService? = null,
    private val configJobs: alice.ha.ConfigJobService? = null,
    private val bus: alice.core.events.EventBus? = null,
    private val inventoryTtlMs: Long = 30_000,
    private val stateCache: StateCache? = null,
    private val time: TimeProvider = SystemTimeProvider,
) {
    /** One household's renames, hides, merges and splits. Never shared between households. */
    private class Overlay {
        val things = java.util.concurrent.ConcurrentHashMap<String, ThingOverride>()
        val entities = java.util.concurrent.ConcurrentHashMap<String, EntityOverride>()
        val merges = java.util.concurrent.CopyOnWriteArrayList<MutableList<String>>()
        val splits: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()
    }

    private val overlays = java.util.concurrent.ConcurrentHashMap<String, Overlay>()

    private fun overlay(householdId: String): Overlay = overlays.computeIfAbsent(householdId) { loadOverlay(it) }

    private fun loadOverlay(householdId: String): Overlay {
        val ov = Overlay()
        runCatching {
            for (r in database.read { identityQueries.selectThingOverridesByHousehold(householdId).executeAsList() }) {
                ov.things[r.ref] = ThingOverride(r.display_name, r.hidden?.let { it != 0L }, r.area_id)
            }
        }
        runCatching {
            for (r in database.read { identityQueries.selectEntityOverridesByHousehold(householdId).executeAsList() }) {
                ov.entities[r.entity_id] = EntityOverride(r.role, r.display_name, r.attach_to, r.hidden?.let { it != 0L }, r.on_means)
            }
        }
        runCatching {
            for (l in database.read { identityQueries.selectThingLinksByHousehold(householdId, alice.ha.Connections.DEFAULT_ID).executeAsList() }) {
                if (l.kind == "merge") {
                    val refs = runCatching { Json.decodeFromString<List<String>>(l.refs ?: "[]") }.getOrDefault(emptyList())
                    if (refs.size >= 2) ov.merges.add(refs.toMutableList())
                } else if (l.kind == "split") {
                    l.entity_id?.let { ov.splits.add(it) }
                }
            }
        }
        return ov
    }

    suspend fun areas(): List<alice.ha.HaAreaRegistryEntry> = gateway.getAreas()

    // Building the inventory asks Home Assistant for areas, devices, the entity registry and every state, so it
    // is cached briefly and rebuilt when the registry changes (a `things.changed` event) or the entry gets old.
    private class CachedInventory(val at: Long, val value: Inventory)
    private val inventoryCache = java.util.concurrent.atomic.AtomicReference<CachedInventory?>()
    private val inventoryLock = kotlinx.coroutines.sync.Mutex()
    private val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Default)

    init {
        bus?.let { b -> scope.launch { b.events.collect { if (it.type == "things.changed") invalidateInventory() } } }
    }

    fun invalidateInventory() = inventoryCache.set(null)

    private fun fresh(c: CachedInventory?) = c != null && System.nanoTime() / 1_000_000 - c.at < inventoryTtlMs

    suspend fun inventory(): Inventory {
        inventoryCache.get()?.takeIf(::fresh)?.let { return it.value }
        return inventoryLock.withLock {
            inventoryCache.get()?.takeIf(::fresh)?.value ?: Discovery(gateway).inventory().also {
                inventoryCache.set(CachedInventory(System.nanoTime() / 1_000_000, it))
            }
        }
    }

    private fun overrides(householdId: String): ThingBuilder.ThingOverrides {
        val ov = overlay(householdId)
        return ThingBuilder.ThingOverrides(
            things = ov.things.mapValues { (_, v) -> ThingBuilder.ThingOverride(v.displayName, v.hidden, v.areaId) },
            entities = ov.entities.mapValues { (_, v) -> ThingBuilder.EntityOverride(v.role?.let { runCatching { alice.ha.EntityRole.valueOf(it) }.getOrNull() }, v.displayName, v.attachTo, v.hidden, v.onMeans) },
            merges = ov.merges.map { it.toMutableList() },
            splits = ov.splits.toList(),
        )
    }

    suspend fun things(householdId: String, includeHidden: Boolean = false): List<Thing> {
        val inv = inventory()
        val all = ThingBuilder.buildThings(inv, alice.ha.Connections.DEFAULT_ID, overrides(householdId))
        return all.filter { t ->
            if (t.hidden && !includeHidden) false else true
        }
    }

    suspend fun find(householdId: String, thingId: String): Thing? =
        things(householdId, includeHidden = true).firstOrNull { it.id == thingId }

    /** Overrides are stored by ref (that is what the builder looks up); the API speaks in thing ids. */
    private suspend fun refOf(householdId: String, idOrRef: String): String =
        things(householdId, includeHidden = true).firstOrNull { it.id == idOrRef || it.ref == idOrRef }?.ref ?: idOrRef

    suspend fun rename(householdId: String, userId: String, thingId: String, name: String?) {
        val ref = refOf(householdId, thingId)
        val things = overlay(householdId).things
        val cur = (things[ref] ?: ThingOverride()).copy(displayName = name)
        things[ref] = cur
        persistThingOverride(householdId, userId, ref, cur)
        auditOverride("thing.renamed", householdId, userId, thingId)
    }

    suspend fun setHidden(householdId: String, userId: String, thingId: String, hidden: Boolean) {
        val ref = refOf(householdId, thingId)
        val things = overlay(householdId).things
        val cur = (things[ref] ?: ThingOverride()).copy(hidden = hidden)
        things[ref] = cur
        persistThingOverride(householdId, userId, ref, cur)
    }

    private fun persistThingOverride(householdId: String, userId: String, ref: String, o: ThingOverride) {
        val now = time.now()
        runCatching {
            val existing = database.read { identityQueries.selectThingOverridesByHousehold(householdId).executeAsList().firstOrNull { it.ref == ref } }
            val id = existing?.id ?: Ids.next("tov")
            database.write {
                identityQueries.upsertThingOverride(
                    id,
                    householdId,
                    alice.ha.Connections.DEFAULT_ID,
                    ref,
                    o.displayName,
                    o.hidden?.let { if (it) 1L else 0L },
                    o.areaId,
                    userId,
                    now,
                )
            }
        }
    }

    fun merge(householdId: String, userId: String, ids: List<String>) {
        val distinct = ids.distinct()
        if (distinct.size < 2) return
        overlay(householdId).merges.add(distinct.toMutableList())
        val now = time.now()
        runCatching {
            val refsJson = Json.encodeToString(distinct)
            database.write {
                identityQueries.insertThingLink(alice.core.ids.Ids.next("tlnk"), householdId, alice.ha.Connections.DEFAULT_ID, "merge", refsJson, null, userId, now)
            }
        }
        auditOverride("thing.merged", householdId, userId, distinct.joinToString(","))
    }

    fun unmerge(householdId: String, userId: String, ids: List<String>) {
        if (ids.isEmpty()) return
        val set = ids.toSet()
        val merges = overlay(householdId).merges
        val removed = merges.filter { group -> group.any { it in set } }.toList()
        merges.removeIf { group -> group.any { it in set } }
        runCatching {
            database.write {
                for (g in removed) {
                    val refsJson = Json.encodeToString(g.toList())
                    identityQueries.deleteThingLinksByRefs(householdId, alice.ha.Connections.DEFAULT_ID, refsJson)
                }
            }
        }
        auditOverride("thing.unmerged", householdId, userId, ids.joinToString(","))
    }

    fun split(householdId: String, userId: String, thingId: String, entityIds: List<String>) {
        if (entityIds.isEmpty()) return
        overlay(householdId).splits.addAll(entityIds)
        val now = time.now()
        runCatching {
            database.write {
                for (eid in entityIds.distinct()) {
                    identityQueries.insertThingLink(alice.core.ids.Ids.next("tlnk"), householdId, alice.ha.Connections.DEFAULT_ID, "split", null, eid, userId, now)
                }
            }
        }
        auditOverride("thing.split", householdId, userId, thingId)
    }

    fun setEntity(householdId: String, userId: String, entityId: String, body: EntityPatchBody) {
        val entities = overlay(householdId).entities
        val cur = entities[entityId] ?: EntityOverride()
        val next = cur.copy(
            role = body.role ?: cur.role,
            displayName = body.displayName ?: cur.displayName,
            attachTo = body.attachTo ?: cur.attachTo,
            hidden = body.hidden ?: cur.hidden,
            onMeans = body.onMeans ?: cur.onMeans,
        )
        entities[entityId] = next
        persistEntityOverride(householdId, userId, entityId, next)
        auditOverride("entity.updated", householdId, userId, entityId)
    }


    private fun auditOverride(action: String, householdId: String, actorId: String, ref: String) {
        runCatching {
            alice.core.security.Audit.write(database, action, householdId, actorId, "user", ref, null, time.now())
        }
        runCatching {
            if (bus != null) {
                bus.publish(object : alice.core.events.AppEvent {
                    override val type: String = "things.changed"
                    override val householdId: String? = householdId
                })
            }
        }
    }

    private fun persistEntityOverride(householdId: String, userId: String, entityId: String, o: EntityOverride) {
        val now = time.now()
        runCatching {
            database.write {
                identityQueries.upsertEntityOverride(householdId, alice.ha.Connections.DEFAULT_ID, entityId, o.role, o.displayName, o.attachTo, o.hidden?.let { if (it) 1L else 0L }, o.onMeans, userId, now)
            }
        }
    }

    fun getSettings(householdId: String, connectionId: String, entityId: String): EntitySettings? {
        val row = database.read { identityQueries.selectEntitySettings(householdId, connectionId, entityId).executeAsOneOrNull() } ?: return null
        return EntitySettings(row.connection_id, row.entity_id, row.household_id, row.power_limit_w?.toInt(), row.left_open_after_ms, row.voice_exposed != 0L, row.voice_sync_status, row.voice_sync_error)
    }

    fun updateSettings(householdId: String, connectionId: String, entityId: String, powerLimitW: Int?, voiceExposed: Boolean?, leftOpenAfterMs: Long? = null) {
        val now = time.now()
        val current = getSettings(householdId, connectionId, entityId)
        val voiceChanged = voiceExposed != null && voiceExposed != (current?.voiceExposed ?: false)
        var voiceSyncStatus = when {
            voiceExposed == null -> current?.voiceSyncStatus ?: "none"
            !voiceChanged -> current?.voiceSyncStatus ?: "none"
            else -> "pending"
        }
        var voiceSyncError = if (voiceSyncStatus == "pending" && voiceChanged) "Home Assistant sync not configured" else current?.voiceSyncError
        if (voiceChanged && configJobs != null) {
            val st = configJobs.status(householdId)
            if (st.connected && st.adminTokenSet) {
                configJobs.enqueue(householdId, "voice.expose", """{"entityIds":["$entityId"],"expose":${voiceExposed == true}}""", "voice:$entityId", null)
                voiceSyncStatus = "pending"; voiceSyncError = null
            } else {
                voiceSyncStatus = "not_synced"; voiceSyncError = if (!st.connected) "Home Assistant is not connected" else "Add a Home Assistant admin token so this can also run from Home Assistant"
            }
        }
        database.write {
            identityQueries.upsertEntitySettings(
                connection_id = connectionId,
                entity_id = entityId,
                household_id = householdId,
                power_limit_w = (if (powerLimitW != null) powerLimitW else current?.powerLimitW)?.toLong(),
                left_open_after_ms = leftOpenAfterMs ?: current?.leftOpenAfterMs,
                voice_exposed = if (voiceExposed != null) (if (voiceExposed) 1L else 0L) else if (current?.voiceExposed == true) 1L else 0L,
                voice_sync_status = voiceSyncStatus,
                voice_sync_error = voiceSyncError,
                updated_at = now,
            )
        }
    }

    fun policyTargetsFor(entityId: String, thing: Thing? = null): Set<String> {
        val targets = mutableSetOf(entityId, "entity:$entityId")
        if (thing != null) {
            targets.add(thing.ref)
            thing.deviceIds.forEach { targets.add("device:$it") }
            thing.entityIds.forEach { targets.add(it); targets.add("entity:$it") }
        }
        return targets
    }

    fun allPoliciesPublic(householdId: String): List<DevicePolicyRow> = allPolicies(householdId)

    private fun allPolicies(householdId: String): List<DevicePolicyRow> =
        database.read { identityQueries.selectDevicePoliciesByHousehold(householdId).executeAsList() }
            .map { DevicePolicyRow(it.id, it.household_id, it.connection_id, it.entity_id, it.subject_type, it.subject_id, it.effect, it.operations?.let { ops -> ops.split(",").map { s -> s.trim() }.filter { s -> s.isNotEmpty() } }) }

    fun favoriteIdsFor(userId: String): Set<String> = (favorites?.idsFor(userId) ?: emptyList()).toSet()

    fun canSee(caller: Caller, connectionId: String, entityId: String, thing: Thing? = null, policies: List<DevicePolicyRow>? = null): Boolean {
        val targets = policyTargetsFor(entityId, thing)
        val pool = (policies ?: allPolicies(caller.householdId)).filter { it.connectionId == connectionId && it.entityId in targets }
        return evaluateDeviceAccess(alice.server.permissions.AccessRequest(
            role = caller.role, userId = caller.userId, connectionId = connectionId, entityId = entityId,
            policies = pool, targetIds = targets,
        )).allowed
    }

    suspend fun visible(caller: Caller, thingId: String, includeDiagnostics: Boolean = false): VisibleResult {
        val thing = find(caller.householdId, thingId) ?: throw alice.core.error.notFound("Device")
        val policies = allPolicies(caller.householdId)
        val canSeeFn: (String) -> Boolean = { entityId -> canSee(caller, alice.ha.Connections.DEFAULT_ID, entityId, thing, policies) }
        val lookup: (String) -> alice.ha.EntityProjection? = { id -> stateCache?.get(id) }
        val view = Presentation.presentThing(thing, lookup, canSeeFn, includeDiagnostics)
            ?: throw alice.core.error.notFound("Device")
        if (thing.hidden && caller.role != alice.server.households.Role.ADMIN) throw alice.core.error.notFound("Device")
        val hubVisible = thing.hubThingId == null || canSee(caller, alice.ha.Connections.DEFAULT_ID, thing.hubThingId!!, thing, policies)
        val adjustedView = if (!hubVisible) view.copy(hubThingId = null) else view
        return VisibleResult(thing, adjustedView, canSeeFn)
    }

    data class VisibleResult(val thing: Thing, val view: alice.ha.ThingView, val canSee: (String) -> Boolean)

    suspend fun favoriteList(caller: Caller): List<Thing> {
        val favIds = favorites?.idsFor(caller.userId) ?: emptyList()
        return things(caller.householdId).filter { it.id in favIds }
    }

    suspend fun setFavorites(caller: Caller, thingIds: List<String>) {
        val unique = thingIds.distinct().take(50)
        val items = unique.mapNotNull { id ->
            val t = things(caller.householdId, includeHidden = true).firstOrNull { it.id == id } ?: return@mapNotNull null
            alice.ha.Connections.DEFAULT_ID to t.ref
        }
        favorites?.save(caller.userId, items)
    }

    data class FoundEntity(val connectionId: String, val thing: Thing, val entity: alice.ha.ThingEntity)

    suspend fun findEntity(householdId: String, entityId: String): FoundEntity? {
        val all = things(householdId, includeHidden = true)
        for (t in all) {
            val ents = listOfNotNull(t.primary) + t.others + t.controls + t.sensors + t.facets + t.diagnostics
            val e = ents.firstOrNull { it.entityId == entityId }
            if (e != null) return FoundEntity(alice.ha.Connections.DEFAULT_ID, t, e)
        }
        return null
    }

    suspend fun forHouseholdThings(householdId: String, includeHidden: Boolean = true): List<Thing> =
        things(householdId, includeHidden)

    fun refMatches(thing: Thing, ref: String): Boolean {
        if (thing.ref == ref) return true
        if (ref.startsWith("device:")) return thing.deviceIds.contains(ref.removePrefix("device:"))
        return thing.entityIds.contains(ref.removePrefix("entity:")) && thing.deviceIds.isEmpty()
    }

    suspend fun callService(domain: String, service: String, entityId: String?): alice.ha.HaServiceCallResult =
        gateway.callService(alice.ha.HaServiceCallInput(domain, service, target = if (entityId != null) alice.ha.HaServiceTarget(entity_id = listOf(entityId)) else null))

    suspend fun callServiceStates(): List<alice.ha.HaEntityState> = gateway.getStates()
}
