package alice.server.households

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.error.AppException
import alice.core.security.TokenVault
import alice.core.security.Tokens
import alice.core.time.SystemTimeProvider
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals

class CodeHashingTest {
    private fun db() = Database(DatabaseFactory.open(":memory:")).also {
        it.write {
            identityQueries.insertUser("u1", "A", 1)
            identityQueries.insertHousehold("h1", "H", 1)
        }
    }

    @Test
    fun `a new invitation is stored under a keyed hash, not plain SHA-256`() {
        val db = db(); val vault = TokenVault.ephemeral()
        val svc = HouseholdService(db, SystemTimeProvider, vault)
        val created = svc.createInvitation("h1", "u1", Role.MEMBER)
        val stored = db.read { identityQueries.selectInvitationById(created.id).executeAsOne().code_hash }
        assertNotEquals(Tokens.sha256(Tokens.normalizeCode(created.code)), stored)
        assertEquals(created.id, svc.findValidInvitation(created.code).id)
        assertEquals(created.id, svc.findValidInvitation(" " + created.code.lowercase() + " ").id, "codes are matched ignoring case and spaces")
    }

    @Test
    fun `a leaked database cannot be checked against guesses without the key`() {
        val db = db()
        val created = HouseholdService(db, SystemTimeProvider, TokenVault.ephemeral()).createInvitation("h1", "u1", Role.MEMBER)
        assertFailsWith<AppException> { HouseholdService(db, SystemTimeProvider, TokenVault.ephemeral()).findValidInvitation(created.code) }
    }

    @Test
    fun `an invitation made before the upgrade, stored as plain SHA-256, still works`() {
        val db = db()
        val svc = HouseholdService(db, SystemTimeProvider, TokenVault.ephemeral())
        val code = Tokens.invitationCode()
        db.write { identityQueries.insertInvitation("old", "h1", Tokens.sha256(Tokens.normalizeCode(code)), "member", null, "u1", 1, System.currentTimeMillis() + 60_000) }
        assertEquals("old", svc.findValidInvitation(code).id)
    }
}
