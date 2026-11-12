package alice.server.admin

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.db.Database
import alice.core.di.coreModule
import alice.core.security.Audit
import alice.server.di.serverModule
import org.koin.core.Koin
import org.koin.dsl.koinApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AuditPagingTest {
    private fun withApp(block: (Koin) -> Unit) {
        val app = koinApplication { modules(coreModule(AppConfig(database = DatabaseConfig(path = ":memory:"))), serverModule()) }
        try {
            app.koin.get<Database>().write {
                identityQueries.insertUser("u1", "Alex", 1)
                identityQueries.insertHousehold("h1", "One", 1); identityQueries.insertHouseholdSettings("h1")
                identityQueries.insertHousehold("h2", "Two", 2); identityQueries.insertHouseholdSettings("h2")
            }
            block(app.koin)
        } finally { app.close() }
    }

    private fun write(db: Database, household: String, action: String, at: Long, actor: String? = "u1") =
        db.write { Audit.write(this, action, household, actor, "user", null, null, at) }

    @Test
    fun `one home's entries are found however much another home has written since`() = withApp { koin ->
        val db = koin.get<Database>(); val admin = koin.get<AdminService>()
        repeat(3) { write(db, "h1", "login.ok", 1_000L + it) }
        db.write { repeat(2_500) { Audit.write(this, "noise", "h2", null, "system", null, null, 10_000L + it) } }
        val page = admin.audit("h1")
        assertEquals(3, page.items.size, "the other home's 2,500 newer rows must not push these out")
        assertTrue(page.items.all { it.action == "login.ok" })
    }

    @Test
    fun `pages follow on from each other with no gaps or repeats, even when many entries share a time`() = withApp { koin ->
        val db = koin.get<Database>(); val admin = koin.get<AdminService>()
        repeat(120) { write(db, "h1", "device.rename", 5_000L + it / 10) } // ten entries per timestamp
        val seen = mutableListOf<String>()
        var cursor: String? = null
        var pages = 0
        do {
            val page = admin.audit("h1", limit = 50, before = cursor)
            seen += page.items.map { it.id }
            cursor = page.nextCursor; pages++
        } while (cursor != null)
        assertEquals(3, pages)
        assertEquals(120, seen.size)
        assertEquals(120, seen.toSet().size, "no entry may appear twice")
    }

    @Test
    fun `an action prefix narrows the list and a household never sees another's entries`() = withApp { koin ->
        val db = koin.get<Database>(); val admin = koin.get<AdminService>()
        write(db, "h1", "backup.created", 1); write(db, "h1", "backup.deleted", 2); write(db, "h1", "login.ok", 3)
        write(db, "h2", "backup.created", 4)
        val backups = admin.audit("h1", action = "backup.")
        assertEquals(listOf("backup.deleted", "backup.created"), backups.items.map { it.action }, "newest first")
        assertEquals(3, admin.audit("h1").items.size)
        assertTrue(admin.audit("h1").items.none { it.action == "backup.created" && it.at == 4L })
    }

    @Test
    fun `actor names are shown and a missing actor is fine`() = withApp { koin ->
        val db = koin.get<Database>(); val admin = koin.get<AdminService>()
        write(db, "h1", "a", 1); write(db, "h1", "b", 2, actor = null)
        val items = admin.audit("h1").items
        assertEquals("Alex", items.first { it.action == "a" }.actor.name)
        assertEquals(null, items.first { it.action == "b" }.actor.name)
    }

    @Test
    fun `the support screens read their own home's entries, not a window of everyone's`() = withApp { koin ->
        val db = koin.get<Database>(); val support = koin.get<alice.server.support.SupportService>()
        write(db, "h1", "support.granted", 1)
        db.write { Audit.write(this, "support.operator_action", "h1", "tech-1", "support", null, null, 2) }
        db.write { repeat(800) { Audit.write(this, "noise", "h2", null, "system", null, null, 10_000L + it) } }
        db.write { repeat(800) { Audit.write(this, "support.operator_action", "h2", "tech-2", "support", null, null, 20_000L + it) } }
        assertEquals(2, support.householdLog("h1", limit = 50).size, "both of this home's support entries, none of the other home's 800")
        assertEquals(listOf("tech-1"), support.operatorTrail("h1").map { it.operator })
    }
}
