import { env } from "@/core/config/env";
import type { Db } from "@/core/database/client";
import type { AppEvent } from "@/core/events/app-events";
import { eventBus } from "@/core/events/bus";
import type { EventBus } from "@/core/events/event-bus";
import { createLimits, type Limits } from "@/core/http/rate-limit";
import { logger } from "@/core/logging/logger";
import { parseKey } from "@/core/security/secrets";
import { AuthService, type AuthConfig } from "@/modules/authentication/auth.service";
import { CommandExecutor } from "@/modules/devices/commands/command-executor";
import { DrizzleCommandStore } from "@/modules/devices/commands/drizzle-command-store";
import { DevicesService } from "@/modules/devices/devices.service";
import { HaWebSocketGateway } from "@/modules/home-assistant/clients/ha-ws-gateway";
import { ConnectionManager, type GatewayFactory } from "@/modules/home-assistant/connections/connection-manager";
import { HaConnectionService } from "@/modules/home-assistant/connection.service";
import { ThingsService } from "@/modules/home-assistant/things/things.service";
import { HouseholdService } from "@/modules/households/household.service";
import { PermissionService } from "@/modules/permissions/permission.service";
import { UserService } from "@/modules/users/user.service";

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
  things: ThingsService;
  commands: CommandExecutor;
  devices: DevicesService;
}

export const defaultAuthConfig = (): AuthConfig => ({
  rpId: env.webauthn.rpId, rpName: env.webauthn.rpName, origin: env.webauthn.origin, sessionTtlHours: env.sessionTtlHours,
});

export interface ServiceOptions {
  now?: () => number;
  auth?: AuthConfig;
  bus?: EventBus<AppEvent>;
  /** Tests inject a fake Home Assistant here. */
  gatewayFactory?: GatewayFactory;
  /** Base64 32-byte key for stored HA tokens. Defaults to SECRETS_KEY. */
  secretsKey?: string | null;
}

/** Wires everything that shares one database. Tests pass an in-memory db and their own clock, bus and gateway. */
export function createServices(db: Db, opts: ServiceOptions = {}): Services {
  const bus = opts.bus ?? eventBus;
  const log = logger.child({ module: "services" });
  const gatewayFactory: GatewayFactory = opts.gatewayFactory ?? ((c) => new HaWebSocketGateway(c));

  const households = new HouseholdService(db, opts.now);
  const permissions = new PermissionService(db, households, opts.now);
  const manager = new ConnectionManager(gatewayFactory, bus, logger.child({ module: "home-assistant" }));
  const things = new ThingsService(db, manager, opts.now);
  const commands = new CommandExecutor({
    manager, bus, log, store: new DrizzleCommandStore(db), authorizer: permissions.authorizer(), sensitivity: permissions.sensitivityPolicy(), now: opts.now,
  });

  return {
    db, bus, households, permissions, manager, things, commands,
    auth: new AuthService(db, households, opts.auth ?? defaultAuthConfig(), opts.now),
    users: new UserService(db),
    limits: createLimits(opts.now),
    ha: new HaConnectionService(db, manager, bus, gatewayFactory, () => parseKey(opts.secretsKey === undefined ? env.secretsKey : opts.secretsKey), log, opts.now),
    devices: new DevicesService(things, permissions, commands),
  };
}
