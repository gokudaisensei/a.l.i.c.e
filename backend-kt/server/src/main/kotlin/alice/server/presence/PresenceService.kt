package alice.server.presence

import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.error.conflict
import alice.core.error.notFound
import alice.core.events.AppEvent
import alice.core.events.EventBus
import alice.core.time.TimeProvider
import alice.server.households.HouseholdService
import alice.server.things.ThingsService
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class PersonInfo(val connectionId: String, val entityId: String, val name: String, val home: Boolean)

@Serializable
data class PersonView(
    val userId: String,
    val displayName: String,
    val role: String,
    val personEntityId: String?,
    val home: Boolean?,
    val suggestedPersonEntityId: String?,
)

data class PeopleResult(val people: List<PersonView>, val unlinkedPersons: List<PersonInfo>)

class PresenceService(
    private val database: Database,
    private val households: HouseholdService,
    private val time: TimeProvider,
    private val things: ThingsService? = null,
    private val events: EventBus? = null,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    fun persons(householdId: String): List<PersonInfo> {
        // Best-effort: use inventory/entities and HA states through ThingsService gateway-backed inventory is async;
        // for sync callers return linked-known persons from cacheable inventory snapshot when available.
        // Actual async enrichment is provided via suspend helpers used by routes where possible.
        return emptyList()
    }

    suspend fun personsAsync(householdId: String): List<PersonInfo> {
        val out = mutableListOf<PersonInfo>()
        val svc = things ?: return out
        val inv = alice.core.concurrent.runCatchingNonCancellation { svc.inventory() }.getOrNull() ?: return out
        val states = alice.core.concurrent.runCatchingNonCancellation { svc.callServiceStates() }.getOrNull()
        for (e in inv.entities) {
            if (e.domain != "person") continue
            val home = states?.firstOrNull { it.entity_id == e.entityId }?.state == "home"
            out += PersonInfo(alice.ha.Connections.DEFAULT_ID, e.entityId, e.sourceName, home)
        }
        return out
    }

    suspend fun peopleAsync(householdId: String): PeopleResult {
        val members = households.listMembers(householdId).filter { !it.expired }
        val links = database.read { identityQueries.selectPersonLinksByHousehold(householdId).executeAsList() }
        val linkedIds = links.map { it.person_entity_id }.toSet()
        val persons = personsAsync(householdId)
        val byEntity = persons.associateBy { it.entityId }
        val unlinkedPersons = persons.filter { it.entityId !in linkedIds }
        val people = members.map { m ->
            val link = links.firstOrNull { it.user_id == m.userId }
            val person = link?.let { byEntity[it.person_entity_id] }
            val guess = if (link == null) unlinkedPersons.firstOrNull { it.name.trim().equals(m.displayName.trim(), ignoreCase = true) } else null
            PersonView(m.userId, m.displayName, m.role.wire, link?.person_entity_id, person?.home, guess?.entityId)
        }
        return PeopleResult(people, unlinkedPersons)
    }

    fun people(householdId: String): PeopleResult {
        val members = households.listMembers(householdId).filter { !it.expired }
        val links = database.read { identityQueries.selectPersonLinksByHousehold(householdId).executeAsList() }
        val people = members.map { m ->
            val link = links.firstOrNull { it.user_id == m.userId }
            PersonView(m.userId, m.displayName, m.role.wire, link?.person_entity_id, null, null)
        }
        return PeopleResult(people, emptyList())
    }

    suspend fun relevantAsync(householdId: String): List<PersonInfo> {
        val links = database.read { identityQueries.selectPersonLinksByHousehold(householdId).executeAsList() }
        val persons = personsAsync(householdId)
        if (links.isEmpty()) return persons
        val eligible = households.listMembers(householdId).filter { !it.expired && it.role != alice.server.households.Role.GUEST }.map { it.userId }.toSet()
        val allowed = links.filter { it.user_id in eligible }.map { it.person_entity_id }.toSet()
        return persons.filter { it.entityId in allowed }
    }

    suspend fun countsAsync(householdId: String): Pair<Int, Int> {
        val r = relevantAsync(householdId)
        return r.size to r.count { it.home }
    }

    fun personOf(householdId: String, userId: String): String? =
        database.read { identityQueries.selectPersonLinkByUser(householdId, userId).executeAsOneOrNull() }?.person_entity_id

    suspend fun isHome(householdId: String, userId: String): Boolean? {
        val id = personOf(householdId, userId) ?: return null
        return personsAsync(householdId).firstOrNull { it.entityId == id }?.home
    }

    suspend fun link(householdId: String, actorId: String, userId: String, personEntityId: String?) {
        if (households.listMembers(householdId).none { it.userId == userId }) throw notFound("Member not found")
        if (personEntityId == null) {
            database.write { identityQueries.deletePersonLink(householdId, userId) }
        } else {
            val persons = personsAsync(householdId)
            val person = persons.firstOrNull { it.entityId == personEntityId } ?: throw AppException(ErrorCode.NOT_FOUND, "That person is not in Home Assistant", 404)
            val taken = database.read { identityQueries.selectPersonLinksByHousehold(householdId).executeAsList() }.firstOrNull { it.person_entity_id == personEntityId }
            if (taken != null && taken.user_id != userId) throw conflict("That person is already linked to someone else")
            database.write {
                identityQueries.insertPersonLink(householdId, userId, person.connectionId, personEntityId, time.now())
            }
        }
        events?.publish(PresenceLinksChangedEvent(householdId = householdId, timestamp = time.now().toString(), actorId = actorId, userId = userId, personEntityId = personEntityId))
    }
}

data class PresenceLinksChangedEvent(
    override val householdId: String,
    override val timestamp: String,
    val actorId: String,
    val userId: String,
    val personEntityId: String?,
) : AppEvent {
    override val type: String = "presence.links_changed"
}
