import { logger } from "../logging/logger";
import type { AppEvent } from "./app-events";
import { InMemoryEventBus } from "./event-bus";

/** Process-wide application event bus. */
export const eventBus = new InMemoryEventBus<AppEvent>((err, event) =>
  logger.error({ err, eventType: event.type }, "event handler failed"),
);
