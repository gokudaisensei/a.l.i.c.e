package alice.core.di

import alice.core.config.AppConfig
import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.events.EventBus
import alice.core.events.InProcessEventBus
import alice.core.time.SystemTimeProvider
import alice.core.time.TimeProvider
import kotlinx.serialization.json.Json
import org.koin.dsl.module

/**
 * The one JSON configuration used for the wire and for JSON columns. Nulls
 * are explicit (`{"household":null}` is meaningful in the auth contract);
 * fields that must disappear when absent opt out with `@EncodeDefault(NEVER)`.
 */
fun aliceJson(): Json = Json {
    encodeDefaults = true
    explicitNulls = true
    ignoreUnknownKeys = true
    prettyPrint = false
}

/**
 * Foundation wiring: config, time, JSON, events and the database. Domain
 * services register in their own modules as their phases land.
 */
fun coreModule(config: AppConfig) = module {
    single { config }
    single { SystemTimeProvider }
    single<TimeProvider> { get<SystemTimeProvider>() }
    single { aliceJson() }
    single<EventBus> { InProcessEventBus() }
    single { Database(DatabaseFactory.open(config.database.path)) }
    single { alice.core.security.TokenVault.resolve(config) }
}
