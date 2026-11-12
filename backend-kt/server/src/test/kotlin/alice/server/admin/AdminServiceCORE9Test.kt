package alice.server.admin

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.db.Database
import alice.core.di.coreModule
import alice.core.time.TimeProvider
import alice.server.di.serverModule
import org.koin.core.Koin
import org.koin.dsl.koinApplication
import kotlin.test.Test
import kotlin.test.assertEquals

class AdminServiceCORE9Test {
    private fun withApp(block: (Koin) -> Unit) {
        val app = koinApplication { modules(coreModule(AppConfig(database = DatabaseConfig(path = ":memory:"))), serverModule()) }
        try {
            app.koin.get<Database>().write {
                identityQueries.insertUser("u1", "Alex", 1)
                identityQueries.insertHousehold("h1", "Home", 1)
                identityQueries.insertHouseholdSettings("h1")
            }
            block(app.koin)
        } finally {
            app.close()
        }
    }

    @Test
    fun `health uptime comes from the injected clock`() = withApp { koin ->
        var clock = 1_700_000_000_000L
        val admin = AdminService(
            koin.get(),
            koin.get(),
            koin.get(),
            koin.get(),
            koin.get(),
            koin.get(),
            koin.get(),
            koin.get(),
            TimeProvider { clock },
        )
        clock += 65_000
        assertEquals(65L, admin.health("h1").uptimeSeconds)
    }
}
