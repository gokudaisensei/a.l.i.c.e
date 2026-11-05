import { Elysia } from "elysia";
import { authenticationController } from "./authentication";
import { usersController } from "./users";
import { householdsController } from "./households";
import { membershipsController } from "./memberships";
import { permissionsController } from "./permissions";
import { homeAssistantController } from "./home-assistant";
import { devicesController } from "./devices";
import { areasController } from "./areas";
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

export const modules = new Elysia({ name: "modules", prefix: "/api" })
  .use(authenticationController)
  .use(usersController)
  .use(householdsController)
  .use(membershipsController)
  .use(permissionsController)
  .use(homeAssistantController)
  .use(devicesController)
  .use(areasController)
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
