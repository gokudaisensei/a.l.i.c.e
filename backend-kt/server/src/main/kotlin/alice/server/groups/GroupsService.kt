package alice.server.groups

import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.error.notFound
import alice.core.error.validationError
import alice.core.ids.Ids
import alice.core.security.Audit
import alice.core.time.TimeProvider
import alice.ha.CapabilityDetector
import alice.server.actions.ActionService
import alice.server.actions.ActionSpec
import alice.server.actions.SkippedAction
import alice.server.commands.DeviceCommand
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

const val MAX_GROUP_MEMBERS = 100

@Serializable
data class GroupDevice(val id: String, val name: String, val available: Boolean)

@Serializable
data class GroupView(
    val id: String,
    val name: String,
    val icon: String? = null,
    val devices: List<GroupDevice> = emptyList(),
)

class GroupsService(
    private val db: Database,
    private val things: ThingsService,
    private val actions: ActionService,
    private val time: TimeProvider,
) {
    private fun row(householdId: String, id: String): alice.core.db.Groups {
        val g = db.read { identityQueries.selectGroupById(id).executeAsOneOrNull() }
        if (g == null || g.household_id != householdId) throw notFound("Group")
        return g
    }

    /** The thing a stored member ref points at now, also when the ref has drifted (a device re-paired, a hub swapped). */
    private fun matchThing(all: List<alice.ha.Thing>, ref: String): alice.ha.Thing? =
        all.firstOrNull { things.refMatches(it, ref) } ?: run {
            val refId = ref.removePrefix("device:").removePrefix("entity:")
            all.firstOrNull { t -> t.deviceIds.contains(refId) || t.entityIds.contains(refId) }
        }

    /** Reading a group never changes it: a drifted ref is resolved on the fly, and [relinkStaleMembers] repairs it later. */
    private suspend fun view(c: Caller, g: alice.core.db.Groups): GroupView {
        val members = db.read { identityQueries.selectGroupMembers(g.id).executeAsList() }
        val all = things.things(c.householdId, includeHidden = true)
        val devices = members.mapNotNull { m ->
            val thing = matchThing(all, m.ref) ?: return@mapNotNull null
            if (thing.hidden && c.role != alice.server.households.Role.ADMIN) return@mapNotNull null
            val ents = listOfNotNull(thing.primary) + thing.others + thing.controls + thing.sensors + thing.facets
            val canSeeAny = ents.any { actions.canSeeEntity(c, it.entityId) }
            if (!canSeeAny) return@mapNotNull null
            GroupDevice(thing.id, thing.name, available = thing.primary != null)
        }
        return GroupView(g.id, g.name, g.icon, devices)
    }

    /**
     * Points members whose stored ref has drifted at the current ref. Each group is rewritten in one transaction (all
     * its members or none), so a crash cannot leave a group empty. Returns how many members were changed.
     */
    suspend fun relinkStaleMembers(householdId: String): Int {
        val all = things.things(householdId, includeHidden = true)
        var changed = 0
        for (g in db.read { identityQueries.selectGroupsByHousehold(householdId).executeAsList() }) {
            val members = db.read { identityQueries.selectGroupMembers(g.id).executeAsList() }
            val relinked = members.map { m -> m to (matchThing(all, m.ref)?.ref ?: m.ref) }
            val stale = relinked.count { (m, ref) -> ref != m.ref }
            if (stale == 0) continue
            db.write {
                identityQueries.deleteGroupMembers(g.id)
                relinked.forEach { (m, ref) -> identityQueries.insertGroupMember(g.id, m.connection_id, ref, m.position) }
            }
            changed += stale
        }
        return changed
    }

    suspend fun list(c: Caller): List<GroupView> =
        db.read { identityQueries.selectGroupsByHousehold(c.householdId).executeAsList() }
            .map { view(c, it) }

    suspend fun get(c: Caller, id: String): GroupView = view(c, row(c.householdId, id))

    suspend fun create(c: Caller, name: String, icon: String?, thingIds: List<String>): GroupView {
        val n = name.trim()
        if (n.length < 1 || n.length > 60) throw validationError("Name must be 1 to 60 characters")
        if (thingIds.size > MAX_GROUP_MEMBERS) throw validationError("At most $MAX_GROUP_MEMBERS devices per group")
        val unique = thingIds.distinct()
        val refs = unique.map { id ->
            val t = things.things(c.householdId, includeHidden = true).firstOrNull { it.id == id } ?: throw notFound("Device")
            t.ref
        }
        val id = Ids.next("grp")
        val now = time.now()
        db.write {
            identityQueries.insertGroup(id, c.householdId, n, icon, c.userId, now)
            refs.forEachIndexed { idx, ref ->
                identityQueries.insertGroupMember(id, alice.ha.Connections.DEFAULT_ID, ref, idx.toLong())
            }
            Audit.write(this, action = "groups.created", householdId = c.householdId, actorId = c.userId, resource = id, now = now)
        }
        return get(c, id)
    }

    suspend fun update(c: Caller, id: String, name: String?, iconProvided: Boolean, icon: String?, thingIds: List<String>?): GroupView {
        val g = row(c.householdId, id)
        val n = (name ?: g.name).trim()
        if (n.length < 1 || n.length > 60) throw validationError("Name must be 1 to 60 characters")
        val newIcon = if (iconProvided) icon else g.icon
        val now = time.now()
        if (thingIds != null) {
            if (thingIds.size > MAX_GROUP_MEMBERS) throw validationError("At most $MAX_GROUP_MEMBERS devices per group")
            val unique = thingIds.distinct()
            val refs = unique.mapNotNull { tid -> things.things(c.householdId, includeHidden = true).firstOrNull { it.id == tid }?.ref }
            db.write {
                identityQueries.updateGroup(n, newIcon, id)
                identityQueries.deleteGroupMembers(id)
                refs.forEachIndexed { idx, ref -> identityQueries.insertGroupMember(id, alice.ha.Connections.DEFAULT_ID, ref, idx.toLong()) }
                Audit.write(this, action = "groups.updated", householdId = c.householdId, actorId = c.userId, resource = id, now = now)
            }
        } else {
            db.write {
                identityQueries.updateGroup(n, newIcon, id)
                Audit.write(this, action = "groups.updated", householdId = c.householdId, actorId = c.userId, resource = id, now = now)
            }
        }
        return get(c, id)
    }

    fun remove(c: Caller, id: String) {
        row(c.householdId, id)
        val now = time.now()
        db.write {
            identityQueries.deleteGroup(id)
            Audit.write(this, action = "groups.deleted", householdId = c.householdId, actorId = c.userId, resource = id, now = now)
        }
    }

    suspend fun command(c: Caller, id: String, action: String, parameters: Map<String, JsonElement>, target: String = "first"): Pair<List<DeviceCommand>, List<SkippedAction>> {
        row(c.householdId, id)
        val members = db.read { identityQueries.selectGroupMembers(id).executeAsList() }
        val all = things.things(c.householdId, includeHidden = true)
        val specs = mutableListOf<ActionSpec>()
        val skipped = mutableListOf<SkippedAction>()
        for (m in members) {
            var thing = all.firstOrNull { things.refMatches(it, m.ref) }
            if (thing == null) {
                val refId = m.ref.removePrefix("device:").removePrefix("entity:")
                thing = all.firstOrNull { t -> t.deviceIds.contains(refId) || t.entityIds.contains(refId) }
            }
            if (thing == null) { skipped.add(SkippedAction(ActionSpec(m.ref, action, parameters), "That device no longer exists")); continue }
            val ents = listOfNotNull(thing.primary) + thing.others + thing.controls + thing.sensors + thing.facets
            val visible = mutableListOf<alice.ha.ThingEntity>()
            for (e in ents) if (actions.canSeeEntity(c, e.entityId)) visible.add(e)
            val supporting = visible.filter { CapabilityDetector.supportsOperation(it.capabilities, action) }
            if (supporting.isEmpty()) {
                if (visible.isNotEmpty()) skipped.add(SkippedAction(ActionSpec(visible.first().entityId, action, parameters), "Not supported"))
                continue
            }
            val chosen = if (target == "all") supporting else listOf(supporting.first())
            chosen.forEach { e -> specs.add(ActionSpec(e.entityId, action, parameters)) }
        }
        if (specs.isEmpty() && skipped.isEmpty()) throw AppException(ErrorCode.VALIDATION_ERROR, "No devices in this group can do that", 400)
        val (cmds, runSkipped) = actions.run(c, specs)
        return cmds to (skipped + runSkipped)
    }
}
