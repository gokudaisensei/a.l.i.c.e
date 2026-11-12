package alice.server.households

import alice.core.db.AliceDb
import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.error.conflict
import alice.core.error.forbidden
import alice.core.error.notFound
import alice.core.ids.Ids
import alice.core.security.Tokens
import alice.core.time.TimeProvider

const val HOUR_MS = 3_600_000L

enum class Role(val wire: String) {
    ADMIN("admin"),
    MEMBER("member"),
    GUEST("guest"),
    ;

    companion object {
        fun fromWire(value: String): Role =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("Unknown role: $value")
    }
}

data class Membership(
    val memberId: String,
    val householdId: String,
    val userId: String,
    val role: Role,
    val expiresAt: Long?,
)

data class ConsumedInvitation(
    val memberId: String,
    val householdId: String,
    val role: Role,
)

data class CreatedInvitation(
    val id: String,
    val role: Role,
    val expiresAt: Long,
    val guestAccessMs: Long?,
    /** Returned once; only its hash is stored. */
    val code: String,
)

data class MemberView(
    val id: String,
    val userId: String,
    val displayName: String,
    val avatarColor: Long,
    val role: Role,
    val expiresAt: Long?,
    val joinedAt: Long,
    val expired: Boolean,
)

/**
 * Household membership and invitations, ported from
 * `backend/src/modules/households/household.service.ts`. One household per
 * user for now.
 *
 * Methods that must participate in the caller's transaction take the
 * [AliceDb] `tx`; the rest open their own read/write through [Database].
 */
class HouseholdService(
    private val database: Database,
    private val time: TimeProvider,
    private val vault: alice.core.security.TokenVault = alice.core.security.TokenVault.ephemeral(),
) {
    /** What to store for a code, and the older unkeyed form that rows from earlier builds still have. */
    data class CodeHashes(val current: String, val legacy: String)

    fun codeHashes(code: String): CodeHashes {
        val normalized = Tokens.normalizeCode(code)
        return CodeHashes(vault.keyedHash("code", normalized), Tokens.sha256(normalized))
    }

    // ---- households -------------------------------------------------------

    /** Call inside a transaction. Returns the new household id. */
    fun createHousehold(tx: AliceDb, name: String, adminUserId: String): String {
        val now = time.now()
        val id = Ids.next("hh")
        tx.identityQueries.insertHousehold(id, name, now)
        tx.identityQueries.insertHouseholdSettings(id)
        tx.identityQueries.insertHouseholdMember(Ids.next("mem"), id, adminUserId, Role.ADMIN.wire, null, now)
        return id
    }

    fun get(householdId: String): alice.core.db.Households =
        database.read { identityQueries.selectHouseholdById(householdId).executeAsOneOrNull() }
            ?: throw notFound("Household")

    fun update(householdId: String, name: String?, timezone: String?): alice.core.db.Households = database.write {
        identityQueries.updateHousehold(name, timezone, householdId)
        identityQueries.selectHouseholdById(householdId).executeAsOne()
    }

    // ---- memberships ------------------------------------------------------

    /** The user's active membership. An expired guest has none. */
    fun getMembership(userId: String): Membership? = database.read { lookupMembership(this, userId) }

    /** Same lookup against an open transaction. */
    fun lookupMembership(tx: AliceDb, userId: String): Membership? {
        val row = tx.identityQueries.selectMembershipByUser(userId).executeAsOneOrNull() ?: return null
        val expiresAt = row.expires_at
        if (expiresAt != null && expiresAt <= time.now()) return null
        return Membership(row.id, row.household_id, row.user_id, Role.fromWire(row.role), expiresAt)
    }

    fun listMembers(householdId: String): List<MemberView> {
        val now = time.now()
        return database.read {
            identityQueries.selectHouseholdMembersWithUsers(householdId).executeAsList()
        }.map {
            val expiresAt = it.expires_at
            MemberView(
                id = it.id,
                userId = it.user_id,
                displayName = it.display_name,
                avatarColor = it.avatar_color,
                role = Role.fromWire(it.role),
                expiresAt = expiresAt,
                joinedAt = it.joined_at,
                expired = expiresAt != null && expiresAt <= now,
            )
        }
    }

    private fun member(tx: AliceDb, householdId: String, memberId: String) =
        tx.identityQueries.selectHouseholdMember(memberId, householdId).executeAsOneOrNull()
            ?: throw notFound("Member")

    fun updateMember(householdId: String, memberId: String, role: Role?, expiresAt: Long?): alice.core.db.Household_members =
        database.write {
            val current = member(this, householdId, memberId)
            if (role != null && role != Role.ADMIN && Role.fromWire(current.role) == Role.ADMIN) {
                val admins = identityQueries.countHouseholdAdmins(householdId).executeAsOne()
                if (admins <= 1) throw conflict("A household needs at least one admin")
            }
            if (role != null) identityQueries.updateHouseholdMemberRole(role.wire, memberId)
            // `expiresAt` is a full replacement when supplied; callers pass null
            // to clear it. Expressing "leave alone" would need a sentinel, so
            // the route decides before calling.
            identityQueries.updateHouseholdMemberExpiry(expiresAt, memberId)
            member(this, householdId, memberId)
        }

    fun removeMember(householdId: String, memberId: String) {
        database.write {
            val current = member(this, householdId, memberId)
            if (Role.fromWire(current.role) == Role.ADMIN) {
                val admins = identityQueries.countHouseholdAdmins(householdId).executeAsOne()
                if (admins <= 1) throw conflict("A household needs at least one admin")
            }
            identityQueries.deleteHouseholdMemberById(memberId)
        }
    }

    // ---- invitations ------------------------------------------------------

    fun createInvitation(
        householdId: String,
        createdBy: String,
        role: Role,
        expiresInHours: Int = 24,
        guestAccessHours: Int = 72,
    ): CreatedInvitation {
        val now = time.now()
        val code = Tokens.invitationCode()
        val guestAccessMs = if (role == Role.GUEST) guestAccessHours * HOUR_MS else null
        val id = Ids.next("inv")
        val expiresAt = now + expiresInHours * HOUR_MS
        database.write {
            identityQueries.insertInvitation(
                id = id,
                household_id = householdId,
                code_hash = codeHashes(code).current,
                role = role.wire,
                guest_access_ms = guestAccessMs,
                created_by = createdBy,
                created_at = now,
                expires_at = expiresAt,
            )
        }
        return CreatedInvitation(id, role, expiresAt, guestAccessMs, code)
    }

    fun listInvitations(householdId: String): List<alice.core.db.Invitations> =
        database.read {
            identityQueries.selectActiveInvitations(householdId, time.now()).executeAsList()
        }

    /** Uniform message avoids leaking which codes exist. */
    fun findValidInvitation(code: String, tx: AliceDb): alice.core.db.Invitations {
        val hashes = codeHashes(code)
        val invitation = tx.identityQueries.selectInvitationByCodeHash(hashes.current).executeAsOneOrNull()
            ?: tx.identityQueries.selectInvitationByCodeHash(hashes.legacy).executeAsOneOrNull()
        return requireUsable(invitation)
    }

    /** For a registration that has already shown the code once: the id is enough and the code need not be kept. */
    fun findValidInvitationById(id: String, tx: AliceDb): alice.core.db.Invitations =
        requireUsable(tx.identityQueries.selectInvitationById(id).executeAsOneOrNull())

    private fun requireUsable(invitation: alice.core.db.Invitations?): alice.core.db.Invitations {
        if (invitation == null ||
            invitation.used_at != null ||
            invitation.revoked_at != null ||
            invitation.expires_at <= time.now()
        ) {
            throw AppException(
                code = ErrorCode.INVALID_INVITATION,
                message = "That invitation code is not valid",
                status = 400,
            )
        }
        return invitation
    }

    fun findValidInvitation(code: String): alice.core.db.Invitations =
        database.read { findValidInvitation(code, this) }

    fun revokeInvitation(householdId: String, id: String) {
        val changed = database.write {
            identityQueries.revokeInvitation(time.now(), id, householdId).value
        }
        if (changed == 0L) throw notFound("Invitation")
    }

    /** Marks the invitation used and creates the membership. Call inside a transaction. */
    fun consumeInvitation(tx: AliceDb, code: String, userId: String): ConsumedInvitation =
        consume(tx, findValidInvitation(code, tx), userId)

    fun consumeInvitationById(tx: AliceDb, invitationId: String, userId: String): ConsumedInvitation =
        consume(tx, findValidInvitationById(invitationId, tx), userId)

    private fun consume(tx: AliceDb, invitation: alice.core.db.Invitations, userId: String): ConsumedInvitation {
        val now = time.now()
        tx.identityQueries.markInvitationUsed(userId, now, invitation.id)
        val memberId = Ids.next("mem")
        val expiresAt = invitation.guest_access_ms?.let { now + it }
        tx.identityQueries.insertHouseholdMember(
            memberId,
            invitation.household_id,
            userId,
            invitation.role,
            expiresAt,
            now,
        )
        return ConsumedInvitation(memberId, invitation.household_id, Role.fromWire(invitation.role))
    }

    /** Throws unless the membership is an active admin. */
    fun requireAdmin(membership: Membership?) {
        if (membership == null || membership.role != Role.ADMIN) throw forbidden("Admins only")
    }
}
