package alice.server.notifications

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.db.Database
import alice.core.di.coreModule
import alice.core.error.AppException
import alice.core.events.EventBus
import alice.ha.FakeGateway
import alice.server.automations.AutomationsService
import alice.server.di.serverModule
import alice.server.sync.HaEventBridge
import alice.server.things.Caller
import alice.server.households.Role
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.koin.core.Koin
import org.koin.dsl.koinApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class NotifyRecipientsTest {
    // Returns Unit on purpose: JUnit silently skips a test method that returns anything else.
    private fun withApp(block: suspend (Koin) -> Unit) {
        val app = koinApplication { modules(coreModule(AppConfig(database = DatabaseConfig(path = ":memory:"))), serverModule()) }
        try {
            app.koin.get<Database>().write {
                for (u in listOf("u1", "u2", "u3")) { identityQueries.insertUser(u, u, 1); identityQueries.insertUserPreferences(u) }
                identityQueries.insertHousehold("h1", "Home", 1); identityQueries.insertHouseholdSettings("h1")
                identityQueries.insertHousehold("h2", "Elsewhere", 2); identityQueries.insertHouseholdSettings("h2")
                identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1)
                identityQueries.insertHouseholdMember("m2", "h1", "u2", "member", null, 1)
                identityQueries.insertHouseholdMember("m3", "h2", "u3", "admin", null, 1) // someone in another home
            }
            return runBlocking { block(app.koin) }
        } finally { app.close() }
    }

    private fun count(koin: Koin, userId: String) = koin.get<NotificationsService>().unreadCount(userId)

    @Test
    fun `only people in the home are notified, whoever the ids name`() = withApp { koin ->
        val shown = koin.get<NotificationsService>().notifyUsers("h1", listOf("u2", "u3", "ghost", "u2"), NewNotification("automation", "Hi", "There"))
        assertEquals(1, shown.size)
        assertEquals(1, count(koin, "u2")); assertEquals(0, count(koin, "u3")); assertEquals(0, count(koin, "ghost"))
    }

    @Test
    fun `an automation cannot be saved naming someone outside the home, and one naming a member can`() = withApp { koin ->
        val automations = koin.get<AutomationsService>()
        val caller = alice.server.automations.Caller("h1", "u1", Role.ADMIN, true)
        fun def(vararg ids: String) = buildJsonObject {
            put("version", 1)
            put("trigger", buildJsonObject { put("type", "time"); put("at", "22:30") })
            put("conditions", buildJsonArray { })
            put("actions", buildJsonArray { add(buildJsonObject { put("type", "notify"); put("message", "hello"); put("userIds", buildJsonArray { ids.forEach { add(JsonPrimitive(it)) } }) }) })
        }
        assertFailsWith<AppException> { automations.create(caller, "Bad", true, def("u2", "u3")) }
        automations.create(caller, "Good", true, def("u2"))
    }

    @Test
    fun `a Home Assistant event naming someone outside the home notifies only members`() = withApp { koin ->
        koin.get<HaEventBridge>().start()
        delay(200) // the bridge subscribes asynchronously
        koin.get<FakeGateway>().emitEvent("alice_notification", mapOf("title" to "Door", "message" to "open", "userIds" to listOf("u2", "u3")))
        withTimeout(3000) { while (count(koin, "u2") == 0) delay(20) }
        delay(100)
        assertEquals(1, count(koin, "u2")); assertEquals(0, count(koin, "u3"))
    }
}
