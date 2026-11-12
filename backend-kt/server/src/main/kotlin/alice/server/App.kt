package alice.server

import alice.core.config.AppConfig
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.http.Limits
import alice.server.api.ErrorBody
import alice.server.api.ErrorEnvelope
import alice.server.auth.AuthService
import alice.server.households.HouseholdService
import alice.server.permissions.PermissionService
import alice.server.presence.PresenceService
import alice.server.http.CorsPlugin
import alice.server.http.CsrfPlugin
import alice.server.http.RequestIdPlugin
import alice.server.http.SessionPlugin
import alice.server.http.requestId
import alice.server.http.requestId
import alice.server.routes.adminSecurityRoutes
import alice.server.routes.authRoutes
import alice.server.routes.healthRoutes
import alice.server.routes.householdRoutes
import alice.server.realtime.RealtimeHub
import alice.server.routes.permissionRoutes
import alice.server.commands.CommandExecutor
import alice.server.commands.CommandStore
import alice.server.routes.deviceRoutes
import alice.server.routes.favoriteRoutes
import alice.server.routes.groupRoutes
import alice.server.routes.sceneRoutes
import alice.server.routes.modeRoutes
import alice.server.routes.userRoutes
import alice.server.routes.realtimeRoutes
import alice.server.routes.routineRoutes
import alice.server.routes.automationRoutes
import alice.server.routes.smartRoutes
import alice.server.routes.configSyncRoutes
import alice.server.routes.haConnectionRoutes
import alice.server.admin.AdminService
import alice.server.energy.EnergyService
import alice.server.history.HistoryService
import alice.server.routes.adminRoutes
import alice.server.support.SupportService
import alice.server.backups.BackupService
import alice.server.routes.adminSupportRoutes
import alice.server.support.OperatorService
import alice.server.updates.UpdateService
import alice.server.ai.AskAliceService
import alice.server.routes.operatorRoutes
import alice.server.routes.adminOperatorRoutes
import alice.server.routes.updateRoutes
import alice.server.routes.askAliceRoutes
import alice.server.routes.backupRoutes
import alice.server.routes.energyRoutes
import alice.server.routes.historyRoutes
import alice.server.ha.HaConnectionAdminService
import alice.server.sync.ConfigSyncService
import alice.ha.StateCache
import alice.server.smart.SmartService
import alice.server.things.ThingsService
import alice.server.routes.thingsRoutes
import alice.server.routes.notificationRoutes
import alice.server.routes.alertRoutes
import alice.server.routes.activityRoutes
import alice.server.routes.insightsRoutes
import alice.server.favorites.FavoritesService
import alice.server.groups.GroupsService
import alice.server.scenes.ScenesService
import alice.server.insights.InsightsService
import alice.server.notifications.NotificationsService
import alice.server.notifications.AlertsService
import alice.server.notifications.PushService
import alice.server.activity.ActivityService
import alice.server.maintenance.HousekeepingScheduler
import alice.server.modes.ModeMirrorService
import alice.server.modes.ModesService
import alice.server.routines.RoutinesService
import alice.server.automations.AutomationsService
import alice.server.users.UserService
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import alice.server.http.BodyLimitPlugin
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import io.ktor.server.request.uri
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.pingPeriod
import io.ktor.server.websocket.timeout
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlin.time.Duration.Companion.seconds
import org.koin.core.Koin
import org.slf4j.LoggerFactory

private val log = LoggerFactory.getLogger("alice.server.http")

fun Application.configure(koin: Koin) {
    val config = koin.get<AppConfig>()
    val json = koin.get<Json>()
    val auth = koin.get<AuthService>()
    val households = koin.get<HouseholdService>()
    val limits = koin.get<Limits>()
    val permissions = koin.get<PermissionService>()
    val presence = koin.get<PresenceService>()
    val database = koin.get<alice.core.db.Database>()
    val things = koin.get<ThingsService>()
    val commandExecutor = koin.get<CommandExecutor>()
    val commandStore = koin.get<CommandStore>()
    val realtime = koin.get<RealtimeHub>()
    val favorites = koin.get<FavoritesService>()
    val stateCache = koin.get<StateCache>()
    val modes = koin.get<ModesService>()
    val insights = koin.get<InsightsService>()
    val notifications = koin.get<NotificationsService>()
    val alerts = koin.get<AlertsService>()
    val push = koin.get<PushService>()
    val activity = koin.get<ActivityService>()

    // Delivery talks to push services over the network: never make the request that created the notification wait for it.
    val pushScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.IO)
    notifications.onCreated = { p ->
        pushScope.launch {
            runCatching { push.deliver(p.id, p.householdId, p.userId, p.kind, p.title, p.body, p.urgent) }
                .onFailure { log.warn("push delivery failed: {}", it.message) }
        }
    }
    val modeMirror = koin.get<ModeMirrorService>()
    val users = koin.get<UserService>()
    val groups = koin.get<GroupsService>()
    val scenes = koin.get<ScenesService>()
    val routines = koin.get<RoutinesService>()
    val automations = koin.get<AutomationsService>()
    val smart = koin.get<SmartService>()
    val configJobs = koin.get<alice.ha.ConfigJobService>()
    val configSync = koin.get<ConfigSyncService>()
    val haConnectionAdmin = koin.get<HaConnectionAdminService>()
    val history = koin.get<HistoryService>()
    val energy = koin.get<EnergyService>()
    val admin = koin.get<AdminService>()
    val backups = koin.get<BackupService>()
    val support = koin.get<SupportService>()
    val operators = koin.get<OperatorService>()
    val updates = koin.get<UpdateService>()
    val askAlice = koin.get<AskAliceService>()


    install(RequestIdPlugin)
    install(ContentNegotiation) {
        json(json)
    }
    install(WebSockets) {
        // Phones drop connections without closing them: ping, and give up on peers that stop answering.
        pingPeriod = 15.seconds
        timeout = 30.seconds
        maxFrameSize = 64 * 1024L
    }
    install(CallLogging) {
        format { call ->
            val status = call.response.status()?.value ?: "-"
            val method = call.request.httpMethod.value
            val path = call.request.path()
            val rid = call.requestId()
            "$rid $method $path -> $status"
        }
    }

    // StatusPages first: it answers the error envelopes thrown by the guards,
    // the CSRF check and the routes themselves.
    install(StatusPages) {
        exception<AppException> { call, cause ->
            if (cause.headers.isNotEmpty()) {
                cause.headers.forEach { (name, value) -> call.response.headers.append(name, value) }
            }
            call.respond(
                HttpStatusCode.fromValue(cause.status),
                ErrorEnvelope(ErrorBody(cause.code, cause.message, cause.details)),
            )
        }
        // Elysia reports a request that does not match the declared schema as a
        // 422 validation error; unreadable JSON is a plain 400.
        exception<BadRequestException> { call, cause ->
            call.respond(
                HttpStatusCode.UnprocessableEntity,
                ErrorEnvelope(ErrorBody(ErrorCode.VALIDATION_ERROR, cause.message ?: "Invalid request")),
            )
        }
        status(HttpStatusCode.NotFound) { call, _ ->
            call.respond(
                HttpStatusCode.NotFound,
                ErrorEnvelope(ErrorBody(ErrorCode.NOT_FOUND, "Route not found")),
            )
        }
        exception<Throwable> { call, cause ->
            // A cancelled request is not an error, but an expired `withTimeout` (Home Assistant did not answer) is.
            if (cause is CancellationException && cause !is kotlinx.coroutines.TimeoutCancellationException) throw cause
            log.error("unhandled error on {}", call.request.uri, cause)
            call.respond(
                HttpStatusCode.InternalServerError,
                ErrorEnvelope(ErrorBody(ErrorCode.INTERNAL, "Internal server error")),
            )
        }
    }

    install(BodyLimitPlugin)
    install(SessionPlugin) {
        this.auth = auth
        this.households = households
        secureCookies = config.secureCookies
    }
    install(CsrfPlugin) {
        allowedOrigins = config.allowedOrigins
    }
    install(CorsPlugin) {
        allowedOrigins = config.allowedOrigins
    }

    routing {
        healthRoutes()
        authRoutes(auth, limits, config)
        householdRoutes(households, permissions, presence, database)
        permissionRoutes(permissions)
        adminSecurityRoutes(permissions)
        thingsRoutes(things, stateCache)
        deviceRoutes(things, commandExecutor, smart, activity, favorites, stateCache)
        realtimeRoutes(realtime, auth, households, config.allowedOrigins)
        favoriteRoutes(favorites, things, stateCache)
        notificationRoutes(notifications)
        alertRoutes(alerts)
        activityRoutes(activity)
        insightsRoutes(insights)
        userRoutes(users, push)
        groupRoutes(groups)
        sceneRoutes(scenes)
        routineRoutes(routines)
        automationRoutes(automations)
        modeRoutes(modes, insights, modeMirror)
        smartRoutes(smart)
        configSyncRoutes(configJobs, configSync)
        haConnectionRoutes(haConnectionAdmin, configSync)
        historyRoutes(history)
        energyRoutes(energy)
        adminRoutes(admin)
        adminSupportRoutes(support)
        backupRoutes(backups)
        operatorRoutes(operators)
        adminOperatorRoutes(operators)
        updateRoutes(updates)
        askAliceRoutes(askAlice)

    }
}
