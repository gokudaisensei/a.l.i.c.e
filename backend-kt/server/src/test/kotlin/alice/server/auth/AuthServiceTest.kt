package alice.server.auth

import alice.core.error.AppException
import alice.core.config.AppConfig
import alice.core.config.AuthConfig
import alice.core.config.DatabaseConfig
import alice.core.config.WebAuthnConfig
import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.security.Tokens
import alice.core.time.TimeProvider
import alice.server.auth.passkey.YubicoPasskeyEngine
import alice.server.auth.passkey.SqlCredentialRepository
import alice.server.households.HouseholdService
import alice.server.households.Role
import alice.server.testing.VirtualAuthenticator
import alice.core.di.aliceJson
import io.ktor.util.date.GMTDate
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertContains
import kotlin.test.assertNull

private const val RP = "localhost"
private const val ORIGIN = "http://localhost:3000"

private class FakeTime(var now: Long) : TimeProvider {
    override fun now(): Long = now
}

private class MutableClock(var now: Long) : Clock() {
    override fun getZone() = ZoneOffset.UTC
    override fun withZone(zone: java.time.ZoneId) = this
    override fun instant() = Instant.ofEpochMilli(now)
}

private class AuthServiceTest {
    private lateinit var time: FakeTime
    private lateinit var db: Database
    private lateinit var households: HouseholdService
    private lateinit var auth: AuthService
    private lateinit var device: VirtualAuthenticator

    @BeforeEach
    fun setUp() {
        time = FakeTime(1_700_000_000_000)
        db = Database(DatabaseFactory.open(":memory:"))
        households = HouseholdService(db, time)
        auth = newAuth()
        device = VirtualAuthenticator(RP, ORIGIN)
    }

    @AfterEach
    fun tearDown() {
        db.close()
    }

    private fun newAuth(setupCode: String? = null, sessionTtlHours: Int = 24): AuthService {
        val config = AppConfig(
            auth = AuthConfig(sessionTtlHours = sessionTtlHours, setupCode = setupCode),
            webauthn = WebAuthnConfig(rpId = RP, rpName = "Alice", origin = ORIGIN),
        )
        val json = aliceJson()
        return AuthService(
            db,
            households,
            YubicoPasskeyEngine(config, SqlCredentialRepository(db, json), MutableClock(time.now)),
            config,
            time,
            json,
        )
    }

    private fun register(name: String, inviteCode: String? = null, dev: VirtualAuthenticator = device): RegistrationSignedIn {
        val result = auth.registrationOptions(RegistrationOptionsInput(name, inviteCode))
        return auth.verifyRegistration(
            VerifyRegistrationInput(result.challengeId, dev.create(result.options.challenge), deviceLabel = "test phone"),
        )
    }

    private fun login(dev: VirtualAuthenticator = device, credentialId: String? = null): SignedIn {
        val result = auth.loginOptions()
        return auth.verifyLogin(
            VerifyLoginInput(result.challengeId, dev.get(result.options.challenge, credentialId = credentialId)),
        )
    }

    private fun stepUp(token: String, dev: VirtualAuthenticator = device) {
        val s = auth.getSession(token)!!
        val result = auth.stepUpOptions(s)
        auth.verifyStepUp(s, VerifyLoginInput(result.challengeId, dev.get(result.options.challenge)))
    }

    private inline fun <T> fails(block: () -> T): String? = try {
        block()
        null
    } catch (t: Throwable) {
        (t as? AppException)?.code
    }

    @Test
    fun `with a setup code, the first person cannot register without it, and it is not needed afterwards`() {
        auth = newAuth(setupCode = "s3cret")
        assertTrue(auth.setupCodeRequired())
        assertEquals("setup_code_required", fails { auth.registrationOptions(RegistrationOptionsInput("Intruder")) })
        assertEquals("setup_code_required", fails { auth.registrationOptions(RegistrationOptionsInput("Intruder", setupCode = "wrong")) })
        val result = auth.registrationOptions(RegistrationOptionsInput("Owner", setupCode = "s3cret"))
        auth.verifyRegistration(
            VerifyRegistrationInput(result.challengeId, device.create(result.options.challenge)),
        )
        assertFalse(auth.setupCodeRequired())
    }

    @Test
    fun `the first user becomes the household admin and gets a session and 10 recovery codes`() {
        val r = register("Gokul")
        assertEquals("admin", r.household.role)
        assertEquals(10, r.recoveryCodes.size)
        assertTrue(r.recoveryCodes[0].matches(Regex("^[A-Z2-9]{5}-[A-Z2-9]{5}\$")))
        val session = auth.getSession(r.session.token)!!
        assertEquals(r.user.id, session.userId)
        assertTrue(session.steppedUp)
        assertFalse(session.restricted)
        val membership = households.getMembership(r.user.id)!!
        assertEquals("admin", membership.role.wire)
        val actions = db.read { coreQueries.selectAuditLogByAction("auth.first_user_registered").executeAsList() }
        assertTrue(actions.isNotEmpty())
    }

    @Test
    fun `later users need an invitation`() {
        register("Gokul")
        assertEquals("invite_required", fails { auth.registrationOptions(RegistrationOptionsInput("Meera")) })
        assertEquals("invalid_invitation", fails { auth.registrationOptions(RegistrationOptionsInput("Meera", inviteCode = "NOPE-000000-NOPE-ABCD")) })
    }

    @Test
    fun `an invited user joins with the invited role, the code works once`() {
        val admin = register("Gokul")
        val invitation = households.createInvitation(admin.household.id, admin.user.id, Role.MEMBER)
        val meera = register("Meera", invitation.code, VirtualAuthenticator(RP, ORIGIN))
        assertEquals(admin.household.id, meera.household.id)
        assertEquals("member", meera.household.role)
        assertEquals("invalid_invitation", fails { auth.registrationOptions(RegistrationOptionsInput("Arjun", inviteCode = invitation.code)) })
    }

    @Test
    fun `a registration cannot be replayed, and a wrong origin is rejected`() {
        val result = auth.registrationOptions(RegistrationOptionsInput("Gokul"))
        assertEquals("invalid_credentials", fails {
            auth.verifyRegistration(
                VerifyRegistrationInput(result.challengeId, device.create(result.options.challenge, originOverride = "http://evil.example")),
            )
        })
        // the challenge is spent even though verification failed
        assertEquals("invalid_challenge", fails {
            auth.verifyRegistration(
                VerifyRegistrationInput(result.challengeId, device.create(result.options.challenge)),
            )
        })
    }

    @Test
    fun `validates the display name`() {
        assertEquals("validation_error", fails { auth.registrationOptions(RegistrationOptionsInput("  ")) })
    }

    @Test
    fun `a registered passkey signs in without a username, each login makes a new session`() {
        val reg = register("Gokul")
        val a = login()
        val b = login()
        assertEquals(reg.user.id, a.user.id)
        assertTrue(a.session.token != b.session.token)
        assertTrue(auth.getSession(a.session.token)!!.steppedUp)
        val passkey = db.read { identityQueries.selectPasskeysByUser(reg.user.id).executeAsOne() }
        assertTrue(passkey.counter > 0)
    }

    @Test
    fun `a challenge works once`() {
        register("Gokul")
        val result = auth.loginOptions()
        val response = device.get(result.options.challenge)
        auth.verifyLogin(VerifyLoginInput(result.challengeId, response))
        assertEquals("invalid_challenge", fails { auth.verifyLogin(VerifyLoginInput(result.challengeId, response)) })
    }

    @Test
    fun `unknown passkeys, wrong origins and expired challenges are refused`() {
        register("Gokul")
        val other = VirtualAuthenticator(RP, ORIGIN)
        other.create("x")
        val a = auth.loginOptions()
        assertEquals("invalid_credentials", fails { auth.verifyLogin(VerifyLoginInput(a.challengeId, other.get(a.options.challenge))) })
        val b = auth.loginOptions()
        assertEquals("invalid_credentials", fails {
            auth.verifyLogin(VerifyLoginInput(b.challengeId, device.get(b.options.challenge, originOverride = "http://evil.example")))
        })
        val c = auth.loginOptions()
        time.now += 6 * 60_000
        assertEquals("invalid_challenge", fails { auth.verifyLogin(VerifyLoginInput(c.challengeId, device.get(c.options.challenge))) })
    }

    @Test
    fun `an expired guest cannot sign in`() {
        val admin = register("Gokul")
        val invitation = households.createInvitation(admin.household.id, admin.user.id, Role.GUEST, guestAccessHours = 1)
        val guestDevice = VirtualAuthenticator(RP, ORIGIN)
        register("Lakshmi", invitation.code, guestDevice)
        time.now += 2 * 3_600_000
        assertEquals("access_expired", fails { login(guestDevice) })
    }

    @Test
    fun `tokens are stored only as hashes, sessions expire and can be logged out`() {
        val r = register("Gokul")
        val hashes = db.read { coreQueries.selectAllSessionTokenHashes().executeAsList() }
        assertTrue(hashes.none { it == r.session.token })
        val s = auth.getSession(r.session.token)!!
        auth.logout(s.sessionId)
        assertNull(auth.getSession(r.session.token))
        val again = login()
        time.now += 25 * 3_600_000
        assertNull(auth.getSession(again.session.token))
        assertNull(auth.getSession(null))
        assertNull(auth.getSession("garbage"))
    }

    @Test
    fun `a user lists and revokes their own sessions only`() {
        val a = register("Gokul")
        val b = login()
        assertEquals(2, auth.listSessions(a.user.id).size)
        val target = auth.getSession(b.session.token)!!
        auth.revokeSession(a.user.id, target.sessionId)
        assertNull(auth.getSession(b.session.token))
        assertThrows(Exception::class.java) {
            auth.revokeSession("someone-else", auth.getSession(a.session.token)!!.sessionId)
        }
    }

    @Test
    fun `a fresh session is stepped up, then lapses, then a new assertion renews it`() {
        val r = register("Gokul")
        assertTrue(auth.getSession(r.session.token)!!.steppedUp)
        time.now += 6 * 60_000
        assertFalse(auth.getSession(r.session.token)!!.steppedUp)
        stepUp(r.session.token)
        assertTrue(auth.getSession(r.session.token)!!.steppedUp)
    }

    @Test
    fun `a step-up challenge cannot be used on another session or by another users passkey`() {
        val admin = register("Gokul")
        val invitation = households.createInvitation(admin.household.id, admin.user.id, Role.MEMBER)
        val otherDevice = VirtualAuthenticator(RP, ORIGIN)
        val meera = register("Meera", invitation.code, otherDevice)
        time.now += 6 * 60_000
        val mine = auth.getSession(admin.session.token)!!
        val result = auth.stepUpOptions(mine)
        assertEquals("invalid_credentials", fails {
            auth.verifyStepUp(mine, VerifyLoginInput(result.challengeId, otherDevice.get(result.options.challenge)))
        })
        val second = auth.stepUpOptions(mine)
        assertEquals("invalid_credentials", fails {
            auth.verifyStepUp(auth.getSession(meera.session.token)!!, VerifyLoginInput(second.challengeId, device.get(second.options.challenge)))
        })
        assertFalse(auth.getSession(admin.session.token)!!.steppedUp)
    }

    @Test
    fun `a step-up without user verification is refused`() {
        val r = register("Gokul")
        time.now += 6 * 60_000
        val s = auth.getSession(r.session.token)!!
        val result = auth.stepUpOptions(s)
        assertEquals("required", result.options.userVerification)
        assertEquals("invalid_credentials", fails {
            auth.verifyStepUp(s, VerifyLoginInput(result.challengeId, device.get(result.options.challenge, userVerified = false)))
        })
        assertFalse(auth.getSession(r.session.token)!!.steppedUp)
    }

    @Test
    fun `adding a passkey needs a recent step-up, the last passkey cannot be removed`() {
        val r = register("Gokul")
        val second = VirtualAuthenticator(RP, ORIGIN)
        time.now += 6 * 60_000
        assertEquals("step_up_required", fails { auth.addPasskeyOptions(auth.getSession(r.session.token)!!) })
        stepUp(r.session.token)
        val s = auth.getSession(r.session.token)!!
        val result = auth.addPasskeyOptions(s)
        auth.verifyAddPasskey(s, VerifyRegistrationInput(result.challengeId, second.create(result.options.challenge), deviceLabel = "laptop"))
        val list = auth.listPasskeys(r.user.id)
        assertEquals(listOf("test phone", "laptop"), list.map { it.deviceLabel })
        auth.deletePasskey(r.user.id, list[1].id)
        assertThrows(Exception::class.java) { auth.deletePasskey(r.user.id, list[0].id) }
        assertThrows(Exception::class.java) { auth.deletePasskey(r.user.id, "nope") }
    }

    @Test
    fun `a recovery code gives a restricted session that can only add a passkey, then it is lifted`() {
        val r = register("Gokul")
        val rec = auth.recoveryLogin(r.recoveryCodes[0].lowercase(), null)
        val s = auth.getSession(rec.session.token)!!
        assertTrue(s.restricted)
        assertFalse(s.steppedUp)
        assertEquals("invalid_credentials", fails { auth.recoveryLogin(r.recoveryCodes[0], null) }) // single use
        val fresh = VirtualAuthenticator(RP, ORIGIN)
        val result = auth.addPasskeyOptions(s)
        auth.verifyAddPasskey(s, VerifyRegistrationInput(result.challengeId, fresh.create(result.options.challenge), deviceLabel = "new phone"))
        val renewed = auth.getSession(rec.session.token)!!
        assertFalse(renewed.restricted)
        assertTrue(renewed.steppedUp)
        assertEquals(r.user.id, login(fresh).user.id)
        val recoveries = db.read { coreQueries.selectAuditLogByAction("auth.recovery_used").executeAsList() }
        assertEquals(1, recoveries.size)
    }

    @Test
    fun `regenerating codes needs a step-up and invalidates the old codes`() {
        val r = register("Gokul")
        val s = auth.getSession(r.session.token)!!
        val fresh = auth.regenerateRecoveryCodes(s)
        assertEquals(10, fresh.size)
        assertThrows(Exception::class.java) { auth.recoveryLogin(r.recoveryCodes[1], null) }
        val signed = auth.recoveryLogin(fresh[0], null)
        assertEquals(r.user.id, signed.user.id)
        time.now += 6 * 60_000
        assertThrows(Exception::class.java) { auth.regenerateRecoveryCodes(auth.getSession(r.session.token)!!) }
    }
}
