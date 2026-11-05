import { Elysia } from "elysia";
import type { Services } from "@/services";
import { authController } from "./authentication";
import { usersController } from "./users";
import { householdsController } from "./households";
import { adminSecurityController, permissionsController } from "./permissions";
import { homeAssistantController } from "./home-assistant";
import { areasController, commandsController, devicesController, entitiesController } from "./devices";
import { groupsController } from "./groups";
import { favoritesController } from "./favorites";
import { scenesController } from "./scenes";
import { routinesController } from "./routines";
import { automationsController } from "./automations";
import { householdModesController } from "./household-modes";
import { activityController } from "./activity";
import { notificationsController } from "./notifications";
import { energyController } from "./energy";
import { insightsController } from "./insights";
import { historyController } from "./history";
import { aiController } from "./ai";
import { backupsController } from "./backups";
import { updatesController } from "./updates";
import { administrationController } from "./administration";

/** Everything under /api/v1. Modules that are still stubs answer GET / with "not_implemented". */
export const buildModules = (s: Services) =>
  new Elysia({ name: "modules", prefix: "/api/v1" })
    .use(authController(s))
    .use(usersController(s))
    .use(householdsController(s))
    .use(permissionsController(s))
    .use(adminSecurityController(s))
    .use(homeAssistantController(s))
    .use(devicesController(s))
    .use(entitiesController(s))
    .use(commandsController(s))
    .use(areasController(s))
    .use(groupsController)
    .use(favoritesController)
    .use(scenesController)
    .use(routinesController)
    .use(automationsController)
    .use(householdModesController)
    .use(activityController)
    .use(notificationsController)
    .use(energyController)
    .use(insightsController)
    .use(historyController)
    .use(aiController)
    .use(backupsController)
    .use(updatesController)
    .use(administrationController);
