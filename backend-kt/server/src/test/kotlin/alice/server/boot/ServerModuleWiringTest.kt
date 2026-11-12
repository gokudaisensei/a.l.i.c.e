package alice.server.boot

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.db.Database
import alice.core.di.coreModule
import alice.core.events.EventBus
import alice.core.http.Limits
import alice.core.security.TokenVault
import alice.core.time.SystemTimeProvider
import alice.core.time.TimeProvider
import alice.ha.ConfigJobService
import alice.ha.FakeGateway
import alice.ha.HomeAssistantGateway
import alice.ha.StateCache
import alice.ha.SwitchableGateway
import alice.server.actions.ActionService
import alice.server.activity.ActivityService
import alice.server.admin.AdminService
import alice.server.ai.AskAliceService
import alice.server.auth.AuthService
import alice.server.auth.passkey.PasskeyEngine
import alice.server.auth.passkey.SqlCredentialRepository
import alice.server.automations.AutomationsService
import alice.server.backups.BackupService
import alice.server.commands.CommandExecutor
import alice.server.commands.CommandStore
import alice.server.di.serverModule
import alice.server.energy.EnergyService
import alice.server.favorites.FavoritesService
import alice.server.groups.GroupsService
import alice.server.ha.HaConnectionAdminService
import alice.server.ha.HaRuntime
import alice.server.history.HistoryService
import alice.server.households.HouseholdService
import alice.server.insights.InsightsService
import alice.server.maintenance.HousekeepingScheduler
import alice.server.maintenance.Retention
import alice.server.modes.ModeMirrorService
import alice.server.modes.ModesService
import alice.server.notifications.AlertsService
import alice.server.notifications.NotificationsService
import alice.server.notifications.PushService
import alice.server.notifications.push.PushProvider
import alice.server.permissions.PermissionService
import alice.server.presence.PresenceService
import alice.server.realtime.RealtimeHub
import alice.server.routines.RoutinesService
import alice.server.scenes.ScenesService
import alice.server.smart.SmartService
import alice.server.support.OperatorService
import alice.server.support.SupportService
import alice.server.sync.ConfigJobApplier
import alice.server.sync.ConfigSyncService
import alice.server.sync.HaEventBridge
import alice.server.things.ThingsService
import alice.server.updates.UpdateInstaller
import alice.server.updates.UpdateService
import alice.server.updates.UpdateSource
import alice.server.users.UserService
import com.yubico.webauthn.CredentialRepository
import kotlinx.serialization.json.Json
import org.koin.dsl.koinApplication
import kotlin.test.Test
import kotlin.test.assertTrue

class ServerModuleWiringTest {
    @Test
    fun `every registered singleton resolves in the real module`() {
        val app = koinApplication {
            modules(coreModule(AppConfig(database = DatabaseConfig(path = ":memory:"))), serverModule())
        }
        try {
            val types = listOf(
                AppConfig::class, Database::class, TokenVault::class, SystemTimeProvider::class, TimeProvider::class,
                EventBus::class, Json::class, Limits::class,
                HouseholdService::class, SqlCredentialRepository::class, CredentialRepository::class, PasskeyEngine::class,
                PermissionService::class, PresenceService::class, FakeGateway::class, SwitchableGateway::class,
                HomeAssistantGateway::class, HaRuntime::class, FavoritesService::class, InsightsService::class,
                ModeMirrorService::class, ModesService::class, UserService::class, ThingsService::class,
                ActionService::class, GroupsService::class, ConfigJobService::class, ConfigJobApplier::class,
                ConfigSyncService::class, HaConnectionAdminService::class, ScenesService::class, RoutinesService::class,
                AutomationsService::class, HaEventBridge::class, SmartService::class, CommandStore::class,
                StateCache::class, CommandExecutor::class, PushService::class, NotificationsService::class,
                AlertsService::class, ActivityService::class, Retention::class, HousekeepingScheduler::class,
                HistoryService::class, EnergyService::class, SupportService::class, OperatorService::class,
                BackupService::class, AdminService::class, RealtimeHub::class, UpdateSource::class,
                UpdateInstaller::class, UpdateService::class, AskAliceService::class, AuthService::class,
            )
            assertTrue(types.size >= 50, "only ${types.size} types")
            for (type in types) app.koin.get<Any>(type)
            app.koin.get<List<PushProvider>>()
        } finally {
            app.close()
        }
    }
}
