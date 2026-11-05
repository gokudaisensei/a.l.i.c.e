import { eventBus } from "@/core/events/bus";
import { logger } from "@/core/logging/logger";
import { HaWebSocketGateway } from "./clients/ha-ws-gateway";
import { ConnectionManager } from "./connections/connection-manager";

/** Process-wide manager. Connections are registered from stored configuration once households exist. */
export const connectionManager = new ConnectionManager(
  (config) => new HaWebSocketGateway(config),
  eventBus,
  logger.child({ module: "home-assistant" }),
);

export const homeAssistantService = {
  statuses: () => connectionManager.statuses(),
};
