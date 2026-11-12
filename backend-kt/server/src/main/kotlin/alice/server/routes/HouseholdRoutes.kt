package alice.server.routes

import alice.core.db.AliceDb
import alice.core.error.validationError
import alice.server.households.HouseholdService
import alice.server.households.Role
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.PermissionService
import alice.server.permissions.Permission
import alice.server.presence.PresenceService
import io.ktor.http.HttpHeaders
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

private const val MAX_INVITE_HOURS = 24 * 30

/** An unknown role is a bad request, not a server error (`Role.fromWire` throws IllegalArgumentException). */
private fun parseRole(value: String): Role =
    Role.entries.firstOrNull { it.wire == value } ?: throw validationError("Role must be admin, member or guest")

fun Route.householdRoutes(
    households: HouseholdService,
    permissions: PermissionService,
    presence: PresenceService,
    database: alice.core.db.Database,
) {
    route("/api/v1/household") {
        get {
            val member = Guards.requireMember(call.requestAuth())
            val h = households.get(member.membership.householdId)
            val mode = database.read { identityQueries.selectHouseholdSettings(member.membership.householdId).executeAsOneOrNull()?.mode ?: "home" }
            call.respond(HouseholdResponse(h.id, h.name, h.timezone, mode, member.membership.role.wire))
        }

        patch {
            val member = Guards.requirePermission(call.requestAuth(), Permission.MEMBERS_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = call.receive<HouseholdPatchBody>()
            if (body.name == null && body.timezone == null) throw validationError("Nothing to update")
            val timezone = body.timezone?.trim()
            if (timezone != null && runCatching { java.time.ZoneId.of(timezone) }.isFailure) throw validationError("Unknown timezone")
            val h = households.update(member.membership.householdId, body.name, timezone)
            val mode = database.read { identityQueries.selectHouseholdSettings(h.id).executeAsOneOrNull()?.mode ?: "home" }
            call.respond(HouseholdResponse(h.id, h.name, h.timezone, mode, member.membership.role.wire))
        }

        get("/members") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.MEMBERS_VIEW.wire)
            val members = households.listMembers(member.membership.householdId).map { m ->
                MemberResponse(m.id, m.userId, m.displayName, m.avatarColor, m.role.wire, m.expiresAt, m.joinedAt, m.expired, m.userId == member.session.userId)
            }
            call.respond(MembersResponse(members))
        }

        patch("/members/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.MEMBERS_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val id = call.parameters["id"] ?: throw validationError("Member id is required")
            // Read the raw body: "expiresAt": null clears the expiry, an absent key must leave it alone.
            val raw = call.receive<JsonObject>()
            val role = raw["role"]?.takeIf { it !is JsonNull }?.let { parseRole(it.jsonPrimitive.content) }
            val expiresAt = if (raw.containsKey("expiresAt")) {
                raw["expiresAt"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.longOrNull
            } else {
                households.listMembers(member.membership.householdId).firstOrNull { it.id == id }?.expiresAt
            }
            val m = households.updateMember(member.membership.householdId, id, role, expiresAt)
            call.respond(MemberUpdateResponse(m.id, m.role, m.expires_at))
        }

        delete("/members/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.MEMBERS_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val id = call.parameters["id"] ?: throw validationError("Member id is required")
            households.removeMember(member.membership.householdId, id)
            call.respond(OkResponse())
        }

        get("/people") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.MEMBERS_VIEW.wire)
            val r = presence.peopleAsync(member.membership.householdId)
            call.respond(PeopleResponse(r.people.map { PersonResponse(it.userId, it.displayName, it.role, it.personEntityId, it.home, it.suggestedPersonEntityId) }, r.unlinkedPersons))
        }

        put("/people/{userId}") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.MEMBERS_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val userId = call.parameters["userId"] ?: throw validationError("User id is required")
            val body = call.receive<PersonLinkBody>()
            presence.link(member.membership.householdId, member.session.userId, userId, body.personEntityId)
            val r = presence.peopleAsync(member.membership.householdId)
            call.respond(PeopleResponse(r.people.map { PersonResponse(it.userId, it.displayName, it.role, it.personEntityId, it.home, it.suggestedPersonEntityId) }, r.unlinkedPersons))
        }

        get("/invitations") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.MEMBERS_MANAGE.wire)
            val list = households.listInvitations(member.membership.householdId)
            call.respond(InvitationsResponse(list.map { InvitationResponse(it.id, it.role, it.expires_at, it.created_at) }))
        }

        post("/invitations") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.MEMBERS_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = call.receive<InvitationBody>()
            val role = parseRole(body.role)
            val expiresInHours = body.expiresInHours ?: 24
            val guestAccessHours = body.guestAccessHours ?: 72
            if (expiresInHours !in 1..MAX_INVITE_HOURS) throw validationError("expiresInHours must be between 1 and $MAX_INVITE_HOURS")
            if (guestAccessHours !in 1..MAX_INVITE_HOURS) throw validationError("guestAccessHours must be between 1 and $MAX_INVITE_HOURS")
            val r = households.createInvitation(member.membership.householdId, member.session.userId, role, expiresInHours, guestAccessHours)
            call.respond(InvitationCreatedResponse(r.id, r.role.wire, r.expiresAt, r.code))
        }

        delete("/invitations/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.MEMBERS_MANAGE.wire)
            val id = call.parameters["id"] ?: throw validationError("Invitation id is required")
            households.revokeInvitation(member.membership.householdId, id)
            call.respond(OkResponse())
        }
    }
}

@Serializable data class HouseholdResponse(val id: String, val name: String, val timezone: String, val mode: String, val role: String)
@Serializable data class HouseholdPatchBody(val name: String? = null, val timezone: String? = null)
@Serializable data class MemberResponse(val id: String, val userId: String, val displayName: String, val avatarColor: Long, val role: String, val expiresAt: Long?, val joinedAt: Long, val expired: Boolean, val me: Boolean)
@Serializable data class MembersResponse(val members: List<MemberResponse>)
@Serializable data class MemberPatchBody(val role: String? = null, val expiresAt: Long? = null)
@Serializable data class MemberUpdateResponse(val id: String, val role: String, val expiresAt: Long?)
@Serializable data class PersonResponse(val userId: String, val displayName: String, val role: String, val personEntityId: String?, val home: Boolean?, val suggestedPersonEntityId: String?)
@Serializable data class PeopleResponse(val people: List<PersonResponse>, val unlinkedPersons: List<alice.server.presence.PersonInfo>)
@Serializable data class PersonLinkBody(val personEntityId: String? = null)
@Serializable data class InvitationResponse(val id: String, val role: String, val expiresAt: Long, val createdAt: Long)
@Serializable data class InvitationsResponse(val invitations: List<InvitationResponse>)
@Serializable data class InvitationBody(val role: String, val expiresInHours: Int? = null, val guestAccessHours: Int? = null)
@Serializable data class InvitationCreatedResponse(val id: String, val role: String, val expiresAt: Long, val code: String)
