package alice.server.di

import alice.core.config.AppConfig
import alice.core.http.createLimits
import alice.server.auth.AuthService
import alice.server.auth.passkey.PasskeyEngine
import alice.server.auth.passkey.SqlCredentialRepository
import alice.server.auth.passkey.YubicoPasskeyEngine
import alice.server.households.HouseholdService
import alice.ha.FakeGateway
import alice.ha.HomeAssistantGateway
import alice.server.permissions.PermissionService
import alice.server.favorites.FavoritesService
import alice.ha.ConfigJobService
import alice.server.sync.ConfigJobApplier
import alice.server.sync.ConfigSyncService
import alice.server.ha.HaConnectionAdminService
import alice.server.sync.HaEventBridge
import alice.server.actions.ActionService
import alice.server.groups.GroupsService
import alice.server.scenes.ScenesService

import alice.ha.StateCache
import alice.server.commands.CommandExecutor
import alice.server.commands.CommandStore
import alice.server.commands.InMemoryCommandStore
import alice.core.events.EventBus
import alice.core.time.TimeProvider
import alice.server.realtime.RealtimeHub
import alice.server.insights.InsightsService
import alice.server.modes.ModeMirrorService
import alice.server.modes.ModesService
import alice.server.presence.PresenceService
import alice.server.automations.AutomationsService
import alice.server.routines.RoutinesService
import alice.server.things.ThingsService
import alice.server.notifications.NotificationsService
import alice.server.notifications.PushService
import alice.server.notifications.AlertsService
import alice.server.notifications.push.PushProvider
import alice.server.notifications.push.WebPushProvider
import alice.server.notifications.push.FcmProvider
import alice.server.activity.ActivityService
import alice.server.maintenance.HousekeepingScheduler
import alice.server.smart.SmartService
import alice.server.users.UserService
import alice.server.history.HistoryService
import alice.server.energy.EnergyService
import alice.server.admin.AdminService
import alice.server.backups.BackupService
import alice.server.support.SupportService
import alice.server.support.OperatorService
import com.yubico.webauthn.CredentialRepository
import org.koin.dsl.module
import alice.server.updates.UpdateService
import alice.server.updates.UpdateSource
import alice.server.updates.UpdateInstaller
import alice.server.updates.NoUpdateSource
import alice.server.updates.ManifestUpdateSource
import alice.server.updates.MarkerFileInstaller
import alice.server.ai.AskAliceService
import alice.server.ai.AskAliceInterpreter
import alice.server.ai.AnthropicInterpreter

/**
 * HTTP-facing services: the passkey engine, auth, households and rate limits.
 * Everything here is a singleton; the services themselves are stateless beyond
 * the database and the shared rate-limit counters.
 */
fun serverModule() = module {
    single { createLimits(get(), get()) }
    single { HouseholdService(get(), get(), get()) }
    single { SqlCredentialRepository(get(), get()) }
    single<CredentialRepository> { get<SqlCredentialRepository>() }
    single<PasskeyEngine> { YubicoPasskeyEngine(get(), get()) }
    single { PermissionService(get(), get(), get(), get()) }
    single { PresenceService(get(), get(), get(), get(), get()) }
    single { FakeGateway() }
    // One shared instance: a second `FakeGateway()` here would hand out a different gateway per type.
    // The app holds this switch; HaRuntime points it at the real Home Assistant once a connection is configured.
    single { alice.ha.SwitchableGateway(get<FakeGateway>()) }
    single<alice.ha.HomeAssistantGateway> { get<alice.ha.SwitchableGateway>() }
    single { alice.server.ha.HaRuntime(get(), get(), get(), get(), get(), get()) }
    single { FavoritesService(get()) }
    single { InsightsService(get(), get(), get(), get()) }
    single { ModeMirrorService(get(), get(), get()) }
    single { ModesService(get(), get(), get(), get(), lazy { get<ActivityService>() }, lazy { get<InsightsService>() }) }
    single { UserService(get(), get()) }
    single { ThingsService(get(), get(), get(), get(), get(), get(), stateCache = get(), time = get()) }
    single { ActionService(get(), get(), get()) }
    single { GroupsService(get(), get(), get(), get()) }
    single { ConfigJobService(get(), time = get()) }
    single { ConfigJobApplier(get(), get(), get(), time = get()) }
    single { ConfigSyncService(get(), get(), get(), get(), get()) }
    single { HaConnectionAdminService(get(), get(), get(), get(), get(), get()) }
    single { ScenesService(get(), get(), get(), get(), configJobs = get(), activity = lazy { get<ActivityService>() }) }
    single { RoutinesService(get(), get(), get(), get(), get(), get(), get(), get(), lazy { get<ActivityService>() }, get()) }
    single { AutomationsService(
            get(), get(), get(), get(), activity = lazy { get<ActivityService>() },
            presenceRef = lazy { get<PresenceService>() }, thingsRef = lazy { get<ThingsService>() },
            scenesRef = lazy { get<ScenesService>() }, routinesRef = lazy { get<RoutinesService>() },
            modesRef = lazy { get<ModesService>() }, notificationsRef = lazy { get<NotificationsService>() },
        )
    }
    single {
        HaEventBridge(
            get(), get(), get(), get(), get(), get(),
            lazy { get<ActivityService>() }, lazy { get<AlertsService>() }, lazy { get<NotificationsService>() },
            lazy { get<InsightsService>() }, lazy { get<ThingsService>() },
            lazy { get<HistoryService>() }, lazy { get<ConfigJobApplier>() },
        )
    }

    single { SmartService(get(), get(), get(), get(), get<AppConfig>().smart, get(), get(), get()) }
    single<CommandStore> { alice.server.commands.SqlCommandStore(get()) }
    single { StateCache() }
    single { CommandExecutor(get(), get(), get(), get(), get(), get(), get(), get<PermissionService>().sensitivityPolicy(), lazy { get<ActivityService>() }, lazy { get<ThingsService>() }) }
    single<List<PushProvider>> {
        val cfg = get<alice.core.config.AppConfig>().push
        val out = mutableListOf<PushProvider>()
        val pub = cfg.vapidPublicKey
        val priv = cfg.vapidPrivateKey
        if (!pub.isNullOrBlank() && !priv.isNullOrBlank()) {
            runCatching { WebPushProvider(pub, priv, cfg.vapidSubject) }
                .onSuccess { out += it }
                .onFailure { org.slf4j.LoggerFactory.getLogger("PushDI").warn("WebPush provider not configured: {}", it.message) }
        }
        val fcm = cfg.fcmServiceAccount
        if (!fcm.isNullOrBlank()) {
            runCatching {
                val json = String(java.util.Base64.getDecoder().decode(fcm), Charsets.UTF_8)
                FcmProvider(json)
            }.onSuccess { out += it }.onFailure {
                org.slf4j.LoggerFactory.getLogger("PushDI").warn("FCM provider not configured: {}", it.message)
            }
        }
        out
    }
    single { PushService(get(), get(), get(), webPushHostAllowlist = get<alice.core.config.AppConfig>().push.webPushHostAllowlist) }
    single { NotificationsService(get(), get(), get(), get()) }
    single { AlertsService(get(), get(), get(), get(), get(), get(), activity = lazy { get<ActivityService>() }) }
    single { ActivityService(get(), get(), get(), get(), get()) }
    single { alice.server.maintenance.Retention(get(), get()) }
    single { HousekeepingScheduler(get(), get(), get(), get(), get(), get(), get(), get(), lazy { get<GroupsService>() }) }

    single { HistoryService(get(), get(), get(), get()) }
    single { EnergyService(get(), get(), get(), get()) }
    single { SupportService(get(), get(), get()) }
    single { OperatorService(get(), get(), get(), get(), get()) }
    single { BackupService(get(), get(), get(), get(), get()) }
    single { AdminService(get(), get(), get(), get(), get(), get(), get(), get(), get()) }
    single { RealtimeHub(get(), get(), get(), get(), get(), get(), get()) }

    single<UpdateSource> {
        val cfg = get<AppConfig>().updates
        val url = cfg.manifestUrl
        if (url.isNullOrBlank()) NoUpdateSource() else ManifestUpdateSource(url, cfg.signingPublicKey)
    }
    single<UpdateInstaller> {
        val dbPath = get<AppConfig>().database.path
        val marker = if (dbPath == ":memory:") "data/update-requested.json" else java.io.File(java.io.File(dbPath).absoluteFile.parentFile ?: java.io.File("."), "update-requested.json").path
        MarkerFileInstaller(marker)
    }
    single {
        val cfg = get<AppConfig>()
        UpdateService(get(), get(), get(), get(), cfg.app.version, get(), get(), cfg.updates.allowUnsigned)
    }
    single {
        val cfg = get<AppConfig>().ai
        val key = cfg.apiKey
        val model: AskAliceInterpreter? = if (!cfg.enabled || key.isNullOrBlank()) null else AnthropicInterpreter(key, cfg.model)
        AskAliceService(get(), get(), get(), get(), get(), get(), model)
    }
    single { AuthService(get(), get(), get(), get(), get(), get()) }
}
