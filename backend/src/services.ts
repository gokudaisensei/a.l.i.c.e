import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { env } from "./core/config/env";
import type { Db } from "./core/database/client";
import type { AppEvent } from "./core/events/app-events";
import { eventBus } from "./core/events/bus";
import type { EventBus } from "./core/events/event-bus";
import { createLimits, type Limits } from "./core/http/rate-limit";
import { logger } from "./core/logging/logger";
import { parseKey } from "./core/security/secrets";
import { pemFromEnv } from "./core/security/sealed";
import { AuthService, type AuthConfig } from "./modules/authentication/auth.service";
import { CommandExecutor } from "./modules/devices/commands/command-executor";
import { DrizzleCommandStore } from "./modules/devices/commands/drizzle-command-store";
import { ActivityService } from "./modules/activity/activity.service";
import { BackupService } from "./modules/backups/backup.service";
import { parseBackupKey } from "./modules/backups/crypto";
import { UpdateService } from "./modules/updates/update.service";
import { ManifestUpdateSource, MarkerFileInstaller, NoUpdateSource, type UpdateInstaller, type UpdateSource } from "./modules/updates/sources";
import pkg from "../package.json" with { type: "json" };
import { AssistantService } from "./modules/ai/assistant.service";
import { AnthropicInterpreter, type Interpreter } from "./modules/ai/llm";
import { AdminService } from "./modules/administration/admin.service";
import { SupportService } from "./modules/administration/support.service";
import { OperatorService } from "./modules/administration/operator.service";
import { ActionService } from "./modules/devices/actions";
import { VoiceExposureService } from "./modules/devices/voice";
import { DevicesService } from "./modules/devices/devices.service";
import { FavoritesService } from "./modules/favorites/favorites.service";
import { GroupsService } from "./modules/groups/groups.service";
import { AutomationsService } from "./modules/automations/automations.service";
import { ModeMirror } from "./modules/household-modes/mode-mirror";
import { ModesService } from "./modules/household-modes/modes.service";
import { InsightsService } from "./modules/insights/insights.service";
import { AlertsService } from "./modules/notifications/alerts.service";
import { NotificationsService } from "./modules/notifications/notifications.service";
import { FcmProvider } from "./modules/notifications/push/fcm-provider";
import type { PushProvider } from "./modules/notifications/push/provider";
import { PushService } from "./modules/notifications/push/push.service";
import { WebPushProvider } from "./modules/notifications/push/webpush-provider";
import { RoutinesService } from "./modules/routines/routines.service";
import { ScenesService } from "./modules/scenes/scenes.service";
import { HaWebSocketGateway } from "./modules/home-assistant/clients/ha-ws-gateway";
import { ConnectionManager, type GatewayFactory } from "./modules/home-assistant/connections/connection-manager";
import { HaConnectionService } from "./modules/home-assistant/connection.service";
import { ConfigJobService } from "./modules/home-assistant/config-jobs.service";
import { HaSyncService } from "./modules/home-assistant/sync.service";
import { ThingsService } from "./modules/home-assistant/things/things.service";
import { EnergyService } from "./modules/energy/energy.service";
import { HistoryService } from "./modules/history/history.service";
import { HouseholdService } from "./modules/households/household.service";
import { PresenceService } from "./modules/households/presence.service";
import { PermissionService } from "./modules/permissions/permission.service";
import { UserService } from "./modules/users/user.service";
import { RealtimeHub } from "./realtime/hub";

export interface Services {
  db: Db;
  bus: EventBus<AppEvent>;
  households: HouseholdService;
  auth: AuthService;
  permissions: PermissionService;
  users: UserService;
  limits: Limits;
  manager: ConnectionManager;
  ha: HaConnectionService;
  configJobs: ConfigJobService;
  sync: HaSyncService;
  things: ThingsService;
  commands: CommandExecutor;
  devices: DevicesService;
  favorites: FavoritesService;
  actions: ActionService;
  groups: GroupsService;
  modes: ModesService;
  modeMirror: ModeMirror;
  insights: InsightsService;
  presence: PresenceService;
  scenes: ScenesService;
  notifications: NotificationsService;
  push: PushService;
  admin: AdminService;
  backups: BackupService;
  updates: UpdateService;
  assistant: AssistantService;
  support: SupportService;
  operators: OperatorService;
  activity: ActivityService;
  history: HistoryService;
  energy: EnergyService;
  alerts: AlertsService;
  routines: RoutinesService;
  automations: AutomationsService;
  realtime: RealtimeHub;
  /** Origins a browser may use this app from. */
  allowedOrigins: string[];
}

export const defaultAuthConfig = (): AuthConfig => ({
  rpId: env.webauthn.rpId, rpName: env.webauthn.rpName, origin: env.webauthn.origin, sessionTtlHours: env.sessionTtlHours, setupCode: env.setupCode,
});

/** The push channels the environment is set up for. */
export function defaultPushProviders(): PushProvider[] {
  const out: PushProvider[] = [];
  if (env.vapid) out.push(new WebPushProvider(env.vapid));
  if (env.fcmServiceAccount) {
    try { out.push(new FcmProvider(JSON.parse(Buffer.from(env.fcmServiceAccount, "base64").toString("utf8")))); } catch { logger.error("FCM_SERVICE_ACCOUNT is not valid base64 JSON; Firebase push is off"); }
  }
  return out;
}

export interface ServiceOptions {
  now?: () => number;
  auth?: AuthConfig;
  bus?: EventBus<AppEvent>;
  /** Tests inject a fake Home Assistant here. */
  gatewayFactory?: GatewayFactory;
  /** Push channels. Defaults to the ones configured in the environment (VAPID, FCM). */
  pushProviders?: PushProvider[];
  /** Lets tests replace real waiting in routines. Receives the delay and a way to register a wake-up. */
  sleep?: (ms: number, wake: (fn: () => void) => void) => Promise<void>;
  /** PEM public key that seals the HA admin token. Defaults to ADMIN_SEAL_PUBLIC_KEY (base64 PEM). */
  adminSealPublicKey?: string | null;
  /** Run timers that apply finished config-worker jobs. The server turns this on; tests apply results by hand. */
  background?: boolean;
  /** Base64 32-byte key for stored HA tokens. Defaults to SECRETS_KEY. */
  secretsKey?: string | null;
  /** Where local backups go and the live database path (null = in memory). */
  backupDir?: string;
  dbPath?: string | null;
  /** Base64 32-byte key for Alice's own backups. Defaults to BACKUP_ENCRYPTION_KEY. */
  backupKey?: string | null;
  /** Update source and installer. Default: the manifest in UPDATE_MANIFEST_URL and a marker file next to the database. */
  updateSource?: UpdateSource;
  updateInstaller?: UpdateInstaller;
  /** A model-backed reader for Ask Alice. Defaults to Claude when AI_API_KEY is set, otherwise none. */
  interpreter?: Interpreter | null;
  /** Where browsers may call from (CSRF and WebSocket origin checks). Defaults to the passkey origin and CORS_ORIGINS. */
  allowedOrigins?: string[];
  currentVersion?: string;
  allowUnsignedUpdates?: boolean;
}

/** Wires everything that shares one database. Tests pass an in-memory db and their own clock, bus and gateway. */
export function createServices(db: Db, opts: ServiceOptions = {}): Services {
  const bus = opts.bus ?? eventBus;
  const log = logger.child({ module: "services" });
  const gatewayFactory: GatewayFactory = opts.gatewayFactory ?? ((c) => new HaWebSocketGateway(c));

  const households = new HouseholdService(db, opts.now);
  const permissions = new PermissionService(db, households, opts.now, bus);
  const manager = new ConnectionManager(gatewayFactory, bus, logger.child({ module: "home-assistant" }));
  const things = new ThingsService(db, manager, opts.now, bus);
  const commands = new CommandExecutor({
    manager, bus, log, store: new DrizzleCommandStore(db), authorizer: permissions.authorizer(), sensitivity: permissions.sensitivityPolicy(), now: opts.now,
  });

  const auth = new AuthService(db, households, opts.auth ?? defaultAuthConfig(), opts.now);
  const configJobs = new ConfigJobService(db, opts.now);
  const sync = new HaSyncService(db, configJobs, opts.now);
  if (opts.background) configJobs.start();
  const favorites = new FavoritesService(db, things);
  const voice = new VoiceExposureService(db, configJobs, sync, opts.now);
  const devices = new DevicesService(things, permissions, commands, db, favorites, opts.now, bus, voice);
  const notifications = new NotificationsService(db, bus, households, opts.now);
  notifications.start();
  const push = new PushService(db, opts.pushProviders ?? defaultPushProviders(), households, logger.child({ module: "push" }), opts.now);
  notifications.onCreated((n) => void push.deliver(n));
  const alerts = new AlertsService(db, bus, things, notifications, devices, opts.now);
  alerts.start();
  if (opts.background) setInterval(() => alerts.sweepAll(), 60_000).unref();
  const actions = new ActionService(things, permissions, commands);
  const groups = new GroupsService(db, things, devices, actions, opts.now);
  const modes = new ModesService(db, bus, opts.now);
  const presence = new PresenceService(db, bus, things, households, opts.now);
  presence.start();
  const activity = new ActivityService(db, bus, things, households, permissions, opts.now);
  activity.start();
  const modeMirror = new ModeMirror(bus, manager, modes, configJobs, logger.child({ module: "mode-mirror" }));
  modeMirror.start();
  sync.onReconcile((householdId) => modeMirror.reconcile(householdId));
  const insights = new InsightsService(db, bus, things, modes, presence, opts.now);
  insights.start(opts.background ? 5 * 60_000 : null);
  const scenes = new ScenesService(db, actions, opts.now, sync, bus);
  const routines = new RoutinesService(db, actions, scenes, modes, households, opts.now, opts.sleep, sync, bus);
  const realtime = new RealtimeHub({ bus, things, permissions, households, auth, devices, alerts, notifications, activity, log: logger.child({ module: "realtime" }), now: opts.now });
  realtime.start();

  const support = new SupportService(db, notifications, opts.now);
  if (opts.background) support.start();
  const interpreter = opts.interpreter !== undefined ? opts.interpreter : env.aiApiKey ? new AnthropicInterpreter(env.aiApiKey, env.aiModel) : null;
  const assistant = new AssistantService(devices, scenes, routines, interpreter, (e) => log.warn({ err: e instanceof Error ? e.message : String(e) }, "the model could not read that sentence"), opts.now);
  const automations = new AutomationsService(db, bus, configJobs, sync, things, actions, modeMirror, households, scenes, routines, presence, notifications, opts.now);
  automations.start();
  const tellAdmins = (householdId: string, names: string[]) => notifications.notifyAdmins(householdId, { kind: "config_drift", title: "Changed in Home Assistant", body: `${names.map((n) => `“${n}”`).join(", ")} ${names.length === 1 ? "was" : "were"} edited or removed in Home Assistant. Restore ${names.length === 1 ? "it" : "them"} from the sync settings.` });
  automations.drift = tellAdmins;
  sync.onDrift(tellAdmins);
  if (opts.background) setInterval(() => sync.verifyAll(), 15 * 60_000).unref();
  const ha = new HaConnectionService(
    db, manager, bus, gatewayFactory, () => parseKey(opts.secretsKey === undefined ? env.secretsKey : opts.secretsKey),
    () => (opts.adminSealPublicKey !== undefined ? opts.adminSealPublicKey : env.adminSealPublicKey ? pemFromEnv(env.adminSealPublicKey) : null), log, opts.now,
  );
  const history = new HistoryService(things, devices, opts.now);
  const energy = new EnergyService(db, things, devices, opts.now);
  const dbPath = opts.dbPath !== undefined ? opts.dbPath : env.databaseUrl === ":memory:" ? null : env.databaseUrl;
  const backups = new BackupService(db, configJobs, notifications, {
    now: opts.now, dbPath, dir: opts.backupDir ?? env.backupDir ?? join(dbPath ? dirname(dbPath) : tmpdir(), "backups"),
    key: parseBackupKey(opts.backupKey === undefined ? env.backupEncryptionKey : opts.backupKey),
  });
  if (opts.background) backups.start();
  const updates = new UpdateService(db, backups, notifications, {
    now: opts.now, currentVersion: opts.currentVersion ?? pkg.version, allowUnsigned: opts.allowUnsignedUpdates ?? env.updateAllowUnsigned,
    source: opts.updateSource ?? (env.updateManifestUrl ? new ManifestUpdateSource(env.updateManifestUrl, env.updateSigningPublicKey ? pemFromEnv(env.updateSigningPublicKey) : null) : new NoUpdateSource()),
    installer: opts.updateInstaller ?? new MarkerFileInstaller(join(dbPath ? dirname(dbPath) : tmpdir(), "update-requested.json"), opts.now),
  });
  if (opts.background) updates.startTimer();
  const admin = new AdminService(db, ha, configJobs, push, things, households, opts.now, backups, updates);
  const operators = new OperatorService(db, support, admin, devices, opts.now);
  ha.afterAdminToken((householdId, userId) => sync.reconcile(householdId, userId));

  return {
    db, bus, households, permissions, manager, things, commands, auth, devices, favorites, actions, groups, modes, modeMirror, insights, presence, scenes, routines, automations, notifications, push, admin, backups, updates, assistant, support, operators, activity, history, energy, alerts, realtime,
    allowedOrigins: opts.allowedOrigins ?? [...new Set([(opts.auth ?? defaultAuthConfig()).origin, ...env.corsOrigins])],
    users: new UserService(db),
    limits: createLimits(opts.now, db),
    ha,
    configJobs,
    sync,
  };
}
